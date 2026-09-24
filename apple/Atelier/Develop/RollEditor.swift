// One open roll: the selection, the stage's render, the histogram, and every
// edit written THROUGH to the store — there is no Done, as on the web.

import CoreGraphics
import Foundation
import Observation
import UniformTypeIdentifiers
import AtelierKit

enum WorkbenchSection: String, CaseIterable, Identifiable {
    case develop, crop, export
    var id: String { rawValue }
    var title: String {
        switch self {
        case .develop: return "Develop"
        case .crop: return "Crop"
        case .export: return "Export"
        }
    }
}

enum ExportFormat: String, CaseIterable, Identifiable {
    case jpeg, heic
    var id: String { rawValue }
    var title: String { self == .jpeg ? "JPEG" : "HEIC" }
    var type: UTType { self == .jpeg ? .jpeg : .heic }
    var fileExtension: String { self == .jpeg ? "jpg" : "heic" }
}

@MainActor
@Observable
final class RollEditor {
    let rollId: String
    private let store: RollStore

    var selectedId: String?
    var section: WorkbenchSection = .develop
    /// Show the picture AS SHOT — held on the stage, or latched from the bar.
    var compare = false
    var showInfo = false
    var exportFormat: ExportFormat = .jpeg

    private(set) var stage: CGImage?
    private(set) var stageIsOriginal = false
    private(set) var histogram: Histogram?
    private(set) var loading = false
    private(set) var problem: String?
    /// The open picture's pixels, once decoded.
    private(set) var pictureSize: (width: Int, height: Int)?
    private(set) var thumbnails: [String: CGImage] = [:]
    /// What the last Auto verb said.
    private(set) var note: String?

    private var decoded: [String: DecodedPicture] = [:]
    private var decodedOrder: [String] = []
    private var sourceStats: [String: SourceStats] = [:]
    private var renderTask: Task<Void, Never>?
    private var generation = 0

    init(store: RollStore, rollId: String) {
        self.store = store
        self.rollId = rollId
        self.selectedId = store.roll(rollId)?.pictures.first?.id
        render()
    }

    var roll: RollDoc? { store.roll(rollId) }
    var pictures: [RollPicture] { roll?.pictures ?? [] }
    var picture: RollPicture? { pictures.first { $0.id == selectedId } }
    var develop: DevelopSettings { picture?.develop ?? .default }
    var framing: Framing { picture?.framing ?? .default }

    // MARK: - selection

    func select(_ id: String?) {
        guard id != selectedId else { return }
        selectedId = id
        note = nil
        render()
    }

    func selectFirstIfNone() {
        if picture == nil { select(pictures.first?.id) }
    }

    func step(_ delta: Int) {
        guard let i = pictures.firstIndex(where: { $0.id == selectedId }) else { return }
        let next = max(0, min(pictures.count - 1, i + delta))
        select(pictures[next].id)
    }

    func remove(_ id: String) {
        let index = pictures.firstIndex { $0.id == id }
        store.removePicture(rollId, id)
        thumbnails[id] = nil
        decoded[id] = nil
        sourceStats[id] = nil
        if id == selectedId {
            let remaining = pictures
            let at = min(index ?? 0, remaining.count - 1)
            selectedId = at >= 0 ? remaining[at].id : nil
            render()
        }
    }

    // MARK: - edits, written through

    func setDevelop(_ change: (inout DevelopSettings) -> Void) {
        guard let id = selectedId else { return }
        var d = develop
        change(&d)
        let next: DevelopSettings? = isDefaultDevelop(d) ? nil : d
        store.update(rollId) { $0 = patchPicture($0, id) { $0.develop = next } }
        render()
    }

    func value(_ key: DevelopKey) -> Double {
        develop[key]
    }

    func set(_ key: DevelopKey, _ value: Double) {
        let range = DevelopRange.of(key)
        let clamped = min(range.max, max(range.min, value))
        guard clamped != develop[key] else { return }
        setDevelop { $0[key] = clamped }
    }

    func resetDevelop() {
        guard picture?.develop != nil else { return }
        setDevelop { $0 = .default }
    }

    func setFraming(_ change: (inout Framing) -> Void) {
        guard let id = selectedId else { return }
        var f = framing
        change(&f)
        let next: Framing? = isDefaultFraming(f) ? nil : f
        store.update(rollId) { $0 = patchPicture($0, id) { $0.framing = next } }
        render()
    }

    func setAspect(_ aspect: String) {
        guard let id = selectedId, aspect != picture?.aspect else { return }
        store.update(rollId) { $0 = patchPicture($0, id) { $0.aspect = aspect } }
        render()
    }

    func resetCrop() {
        guard let id = selectedId else { return }
        store.update(rollId) { $0 = patchPicture($0, id) { $0.framing = nil; $0.aspect = "original" } }
        render()
    }

    func setExport(_ change: (inout RollExport) -> Void) {
        store.update(rollId) { change(&$0.export) }
    }

    func setCompare(_ on: Bool) {
        guard on != compare else { return }
        compare = on
        render()
    }

    // MARK: - auto

    func applyAutoTone() {
        Task { [weak self] in
            guard let self, let stats = await self.statsOfOpenPicture() else { return }
            if let levels = autoTone(stats) {
                self.setDevelop { $0.levels = levels }
                self.note = "Auto tone: \(describeAutoTone(levels))"
            } else {
                self.note = "Auto tone: \(describeAutoTone(nil))"
            }
        }
    }

    func applyAutoColour() {
        Task { [weak self] in
            guard let self, let stats = await self.statsOfOpenPicture() else { return }
            let colour = autoColour(stats)
            self.setDevelop { $0.temperature = colour.temperature; $0.tint = colour.tint }
            self.note = colour.clamped
                ? "Auto colour: the cast is past the sliders' reach — as far as they go."
                : "Auto colour: temperature \(signed(colour.temperature)) · tint \(signed(colour.tint))"
        }
    }

    /// The picture AS SHOT, measured once — so a second press is the same
    /// answer, never a compound.
    private func statsOfOpenPicture() async -> SourceStats? {
        guard let pic = picture else { return nil }
        if let hit = sourceStats[pic.id] { return hit }
        guard let decodedPicture = try? await decodedPicture(for: pic) else { return nil }
        let stats = await Task.detached(priority: .userInitiated) { () -> SourceStats? in
            guard let bytes = PictureRenderer.shared.rgbaBytes(decodedPicture.image, longEdge: histogramSampleEdge) else { return nil }
            return measureSource(bytes)
        }.value
        if let stats { sourceStats[pic.id] = stats }
        return stats
    }

    // MARK: - decoding

    private func decodedPicture(for pic: RollPicture) async throws -> DecodedPicture {
        if let hit = decoded[pic.id] { return hit }
        guard let locator = store.locator(rollId, pic.id) else { throw PictureError.noLocator }
        let mediaDirectory = store.mediaDirectory
        let name = pic.ref.name
        let result = try await Task.detached(priority: .userInitiated) { () throws -> DecodedPicture in
            let data = try RollStore.bytes(of: locator, mediaDirectory: mediaDirectory)
            guard let picture = PictureDecoder.decode(data, name: name) else { throw PictureError.undecodable }
            return picture
        }.value
        decoded[pic.id] = result
        decodedOrder.removeAll { $0 == pic.id }
        decodedOrder.append(pic.id)
        // Three decoded pictures at most: a RAW is the one source decoded in
        // the app's own memory, and it is where a phone runs out of it.
        while decodedOrder.count > 3 {
            let old = decodedOrder.removeFirst()
            decoded[old] = nil
        }
        return result
    }

    // MARK: - the stage

    func render() {
        renderTask?.cancel()
        generation += 1
        let gen = generation
        guard let pic = picture else {
            stage = nil
            histogram = nil
            pictureSize = nil
            loading = false
            problem = nil
            return
        }
        let recipe = PictureRenderer.Recipe(
            develop: compare ? nil : pic.develop,
            framing: pic.framing,
            aspect: pic.aspect,
            longEdge: PictureRenderer.stageLongEdge
        )
        let asShot = compare
        loading = stage == nil
        renderTask = Task { [weak self] in
            guard let self else { return }
            do {
                let decodedPicture = try await self.decodedPicture(for: pic)
                let rendered = await Task.detached(priority: .userInitiated) { () -> (CGImage?, Histogram?) in
                    let renderer = PictureRenderer.shared
                    let composed = renderer.compose(decodedPicture, recipe: recipe)
                    let image = renderer.cgImage(composed)
                    let histogram = renderer.rgbaBytes(composed, longEdge: histogramSampleEdge).map { luminanceHistogram($0) }
                    return (image, histogram)
                }.value
                guard !Task.isCancelled, gen == self.generation else { return }
                self.pictureSize = (decodedPicture.width, decodedPicture.height)
                self.stage = rendered.0
                self.stageIsOriginal = asShot
                self.histogram = rendered.1
                self.loading = false
                self.problem = rendered.0 == nil ? "This picture could not be rendered." : nil
            } catch {
                guard gen == self.generation else { return }
                self.stage = nil
                self.histogram = nil
                self.loading = false
                self.problem = error.localizedDescription
            }
        }
    }

    // MARK: - the filmstrip

    func loadThumbnail(_ id: String) async {
        guard thumbnails[id] == nil, let pic = pictures.first(where: { $0.id == id }) else { return }
        guard let decodedPicture = try? await decodedPicture(for: pic) else { return }
        let thumb = await Task.detached(priority: .utility) { () -> CGImage? in
            let renderer = PictureRenderer.shared
            return renderer.cgImage(renderer.scaled(decodedPicture.image, longEdge: PictureRenderer.thumbnailLongEdge))
        }.value
        if let thumb { thumbnails[id] = thumb }
    }

    // MARK: - export

    /// The delivered pixels, at the roll's cap — what the export panel says
    /// before a byte moves.
    var deliveredSize: (width: Int, height: Int)? {
        guard let size = pictureSize, let pic = picture else { return nil }
        var out = PictureRenderer.deliveredSize(width: size.width, height: size.height, aspect: pic.aspect)
        if let cap = longEdgeFor(roll?.export.primary.size, width: Double(out.width), height: Double(out.height)) {
            let scale = Double(cap) / Double(max(out.width, out.height))
            out = (Int((Double(out.width) * scale).rounded()), Int((Double(out.height) * scale).rounded()))
        }
        return out
    }

    /// The stages of the open picture's develop this app cannot render yet —
    /// said on the stage, so a picture developed on the web is never shown as
    /// something it is not.
    var unrenderedStages: [String] {
        picture?.develop?.unrenderedStages ?? []
    }

    /// A delivered picture is named EXACTLY after the picture it came from —
    /// `DJI_0101.JPG` → `DJI_0101.jpg`, no word added.
    var exportFileName: String {
        let base = ((picture?.ref.name ?? "picture") as NSString).deletingPathExtension
        return "\(base).\(exportFormat.fileExtension)"
    }

    /// The open picture rendered whole and encoded, or nil with the reason in `problem`.
    func exportData() async -> Data? {
        guard let pic = picture, let doc = roll else { return nil }
        guard let decodedPicture = try? await decodedPicture(for: pic) else { return nil }
        // The FIRST target's size and quality — the one a run writes into the chosen folder.
        let target = doc.export.primary
        let delivered = PictureRenderer.deliveredSize(width: decodedPicture.width, height: decodedPicture.height, aspect: pic.aspect)
        let cap = longEdgeFor(target.size, width: Double(delivered.width), height: Double(delivered.height))
        let recipe = PictureRenderer.Recipe(develop: pic.develop, framing: pic.framing, aspect: pic.aspect, longEdge: cap)
        let quality = target.quality
        let type = exportFormat.type
        return await Task.detached(priority: .userInitiated) { () -> Data? in
            let renderer = PictureRenderer.shared
            return renderer.encode(renderer.compose(decodedPicture, recipe: recipe), as: type, quality: quality, source: decodedPicture)
        }.value
    }
}
