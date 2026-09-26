// One open roll — the Develop tool's EDITOR store, the web's `RollEditor.tsx`
// + `PictureWorkbench.tsx` + `DevelopTool.tsx` minus what they draw.
//
// Rules kept (`develop-roll.md`):
//
// - **ONE updater** over the latest roll (`update`): a develop, a look and a
//   batch landing in the same tick compose instead of the last replacing a
//   roll the others already moved on. Every writer goes through it, and it is
//   what the undo stack WATCHES.
// - **No Done.** The develop is a DRAFT written through 200 ms after it rests
//   and when the picture is left (`WriteThrough`), and the draft is kept LEVEL
//   with the roll both ways: an undo, a paste, a batch or a preset landing on
//   the open picture RESEEDS it and drops what it owed, or the next nudge
//   would write the undone numbers straight back.
// - **Undo is a stack of whole rolls** (the kernel's `History`), labelled by
//   the picture being worked on so one picture's slider never merges into the
//   next's; the same steps are registered on the window's `UndoManager`, so
//   ⌘Z, the Edit menu and a shake are the platform's own. An undo OPENS the
//   picture it changed (`pictureAfterRestore`): the stack is the roll's, and a
//   step taken on another picture must be seen.
// - **What is a TOOL, not the picture's** — the open tab, the stage tool, the
//   facts, the compare switch — lives here, so stepping to the next picture
//   keeps it; what is the picture's (its drafts, the stage render) is re-seeded
//   per picture, so a develop is never inherited.

import CoreGraphics
import CoreImage
import Foundation
import Observation
import SwiftUI
import AtelierKit

/// What the stage renders, handed back from the render task.
private struct RenderedStage {
    let image: CGImage?
    let before: CGImage?
    let histogram: Histogram?
    let size: CGSize
}

/// A key the ACTIVE TOOL answers (the crop's `X`, the mask's `P` / `M`, the
/// repair's ⌫ / Esc): the editor forwards it, the tool's overlay observes it.
struct ToolCommand: Equatable {
    let serial: Int
    let action: EditorKeyAction
}

@MainActor
@Observable
final class RollEditor {
    let rollId: String
    let store: RollStore
    let pool: PicturePool
    let presets: PresetBookStore
    /// How the stage turns a picture into pixels — ONE seam (`DevelopRenderPlan`).
    @ObservationIgnored private(set) var renderPlan: DevelopRenderPlan = DefaultDevelopRenderPlan()
    /// The window's undo manager, handed in by the editor's view.
    @ObservationIgnored weak var undoManager: UndoManager?

    // MARK: the open picture and the batch selection

    private(set) var openId: String?
    /// Pictures marked for a batch (Shift/⌘-click), never the "open" one.
    var selected: Set<String> = []
    @ObservationIgnored var anchor: String?

    // MARK: tools — the editor's, never the picture's

    var tab: WorkbenchTab = .adjust
    /// A phone's docked drawer is up.
    var inspectorOpen = false
    private(set) var activeTool: DevelopTool = .none
    var helpOpen = false
    var settingsOpen = false
    var confirmRemove: RollPicture?
    /// Painting what is clipped on the picture (`J`).
    var clipping = false
    private(set) var showFacts: Bool
    private(set) var compareOn: Bool
    private(set) var showIgnored: Bool
    /// `\` or the pill: the picture as shot, whole.
    private(set) var holding = false
    /// The divider's position across the frame — the picture AS SHOT to its
    /// left. 0 is no split (`develop-roll.md`, «before → after»).
    var wipe: Double = 0
    /// Remembered ticks of the sections picker (`atelier.develop.sections`).
    private(set) var tickedSections: [PictureSection]

    // MARK: what the editor says

    /// The status line's last word (`added 3 · found 2 again`).
    var notice: String?
    /// A short word beside the picture's name (`· copied`), gone after a moment.
    private(set) var told: String?
    @ObservationIgnored private var toldTask: Task<Void, Never>?

    // MARK: history and the develop draft

    private(set) var history: HistoryState<RollDoc>
    private(set) var developDraft: DevelopSettings = .default
    @ObservationIgnored private var developWrite: WriteThrough<DevelopSettings> = newWriteThrough(nil)
    @ObservationIgnored private var developRest: Task<Void, Never>?

    // MARK: the stage

    private(set) var stage: CGImage?
    private(set) var before: CGImage?
    private(set) var histogram: Histogram?
    private(set) var stageSize: CGSize = .zero
    private(set) var loading = false
    private(set) var problem: String?
    /// The open picture's decoded pixels, once read.
    private(set) var decodedSize: CGSize?
    @ObservationIgnored private var renderGeneration = 0
    @ObservationIgnored private var rendering = false
    @ObservationIgnored private var renderDirty = false
    @ObservationIgnored private var beforeKey: String?
    @ObservationIgnored private var snapshotTask: Task<Void, Never>?

    // MARK: clipboards and commands

    private(set) var canPasteDevelop = hasCopiedDevelop()
    private(set) var heldSettings: CopiedSettings? = copiedSettings()
    private(set) var toolCommand: ToolCommand?
    @ObservationIgnored private var commandSerial = 0
    @ObservationIgnored private var unsubscribe: [() -> Void] = []
    /// When each picture last left, on this device (`export-marks.ts`).
    private(set) var exportMarks: ExportMarks = [:]
    /// A text field of the editor has the keyboard: every key is its.
    var textEditing = false
    /// The Crop tab's session — the lit chip, the intent, the crop stage's view (`RollEditor+Crop.swift`).
    let cropSession = CropSession()
    /// The pixel under the pointer, said under the histogram — held OUTSIDE
    /// the editor's observed state (`readout-store.ts`), so a hover re-renders
    /// the one line that subscribes and nothing else.
    let readoutStore = ReadoutStore()
    /// The Layers task's state and caches — read through `layerState` (`RollEditor+Layers.swift`).
    let layerEdit = LayerEditState()

    /// Pictures that LANDED, marked on this device as they were rendered —
    /// never an edit, never undone.
    func markExported(_ delivered: [RollPicture]) {
        store.recordExported(rollId, delivered)
        exportMarks = store.marks(rollId)
    }

    init(store: RollStore, pool: PicturePool, presets: PresetBookStore, rollId: String, openId: String? = nil) {
        self.store = store
        self.pool = pool
        self.presets = presets
        self.rollId = rollId
        let defaults = UserDefaults.standard
        showFacts = defaults.object(forKey: RollEditor.factsKey) as? Bool ?? false
        compareOn = defaults.object(forKey: RollEditor.compareKey) as? Bool ?? true
        showIgnored = defaults.object(forKey: RollEditor.showIgnoredKey) as? Bool ?? true
        tickedSections = RollEditor.readStoredSections()
        let doc = store.roll(rollId) ?? createRollDoc(name: "")
        history = newHistory(doc)
        exportMarks = store.marks(rollId)
        self.openId = AtelierKit.openPictureId(doc.pictures, openId)
        seedDrafts()
        unsubscribe.append(subscribeDevelopClipboard { [weak self] in
            self?.canPasteDevelop = hasCopiedDevelop()
        })
        unsubscribe.append(subscribeCopiedSettings { [weak self] in
            self?.heldSettings = copiedSettings()
        })
        requestRender()
    }

    /// The editor is going away: write what is owed, let go of the listeners
    /// and of the steps this editor registered on the window.
    func close() {
        flushDrafts()
        store.flush()
        for off in unsubscribe { off() }
        unsubscribe = []
        undoManager?.removeAllActions(withTarget: self)
        snapshotTask?.cancel()
    }

    // MARK: - reading

    var roll: RollDoc? { store.roll(rollId) }
    var pictures: [RollPicture] { roll?.pictures ?? [] }
    var picture: RollPicture? { openId.flatMap { id in pictures.first { $0.id == id } } }
    /// The picture as the stage draws it: the open one with its drafts on.
    var draftedPicture: RollPicture? {
        guard var p = picture else { return nil }
        p.develop = isDefaultDevelop(developDraft) ? nil : developDraft
        return p
    }
    var asShot: Bool { isDefaultDevelop(developDraft) }

    /// What a picture's bytes are on this device.
    func availability(_ p: RollPicture) -> PictureAvailability {
        store.availability(rollId, p)
    }

    // MARK: - opening

    /// Open a picture — a click, a step, an undo. What the picture owed is
    /// written first; its drafts never follow it to the next.
    func open(_ id: String?) {
        guard id != openId else { return }
        flushDrafts()
        openId = id
        // The anchor of a Shift-click is the picture actually open.
        anchor = nil
        seedDrafts()
        told = nil
        renderGeneration += 1
        stage = nil
        before = nil
        beforeKey = nil
        histogram = nil
        decodedSize = nil
        problem = nil
        requestRender()
    }

    /// ←/→: along the strip, stepping over an ignored picture (and, later,
    /// one Winnow's filter took off it), held at the ends.
    func step(_ by: Int) {
        let next = stepPicture(pictures, openId, by, skip: isIgnored)
        if let next, next != openId { open(next) }
    }

    private func seedDrafts() {
        developRest?.cancel()
        developRest = nil
        let stored = picture?.develop
        developDraft = stored ?? .default
        developWrite = newWriteThrough(stored)
    }

    // MARK: - the ONE updater

    /// The label one step is merged under: the picture being worked on.
    private var historyLabel: String { openId.map { "picture:\($0)" } ?? "roll" }

    /// Every write of the roll. The same roll back is no write and no step.
    func update(_ change: (RollDoc) -> RollDoc) {
        guard let current = roll else { return }
        let next = change(current)
        if next == current { return }
        let openBefore = current.pictures.first { $0.id == openId }
        store.put(next)
        remember(next)
        reconcileDrafts()
        if next.pictures.first(where: { $0.id == openId }) != openBefore { requestRender() }
        if openId == nil || !next.pictures.contains(where: { $0.id == openId }) {
            open(AtelierKit.openPictureId(next.pictures, nil))
        }
    }

    /// The store was written directly (a file added through `RollStore`): the
    /// history takes the roll as it now stands.
    func adoptStoreChange() {
        guard let current = roll, current != history.present else { return }
        remember(current)
        reconcileDrafts()
        if openId == nil || !current.pictures.contains(where: { $0.id == openId }) {
            open(AtelierKit.openPictureId(current.pictures, nil))
        }
    }

    private func remember(_ doc: RollDoc) {
        let now = nowMillis()
        let label = historyLabel
        // The kernel's own merge rule, read before it runs: a merged step is
        // no new undo action on the window.
        let merges = label == history.label && now - history.at <= coalesceMs
        history = AtelierKit.record(history, doc, RecordOptions(now: now, label: label))
        if !merges { registerUndoStep() }
    }

    // MARK: - undo and redo

    var canUndoRoll: Bool { AtelierKit.canUndo(history) }
    var canRedoRoll: Bool { AtelierKit.canRedo(history) }

    func undo() {
        flushDrafts()
        if let manager = undoManager, manager.canUndo {
            manager.undo()
        } else {
            performUndo()
        }
    }

    func redo() {
        flushDrafts()
        if let manager = undoManager, manager.canRedo {
            manager.redo()
        } else {
            performRedo()
        }
    }

    private func registerUndoStep() {
        guard let manager = undoManager else { return }
        manager.registerUndo(withTarget: self) { target in
            MainActor.assumeIsolated { target.performUndo() }
        }
        manager.setActionName("Edit")
    }

    func performUndo() {
        guard AtelierKit.canUndo(history) else { return }
        let before = roll
        history = AtelierKit.undo(history)
        restore(history.present, from: before)
        if let manager = undoManager, manager.isUndoing {
            manager.registerUndo(withTarget: self) { target in
                MainActor.assumeIsolated { target.performRedo() }
            }
        }
    }

    func performRedo() {
        guard AtelierKit.canRedo(history) else { return }
        let before = roll
        history = AtelierKit.redo(history)
        restore(history.present, from: before)
        if let manager = undoManager, manager.isRedoing {
            manager.registerUndo(withTarget: self) { target in
                MainActor.assumeIsolated { target.performUndo() }
            }
        }
    }

    /// A whole roll put back — not an edit: written as it was, the picture it
    /// changed opened, the drafts reseeded from it.
    private func restore(_ doc: RollDoc, from before: RollDoc?) {
        store.put(doc)
        let target = pictureAfterRestore(before?.pictures ?? [], doc.pictures, openId)
        if let target {
            // Its drafts were already flushed; open it without writing again.
            developRest?.cancel()
            developWrite = newWriteThrough(developWrite.written)
            open(target)
        } else if openId == nil || !doc.pictures.contains(where: { $0.id == openId }) {
            open(AtelierKit.openPictureId(doc.pictures, nil))
        }
        reconcileDrafts()
        requestRender()
    }

    // MARK: - the develop draft

    /// The sliders' binding: the draft, rendered at once, written through after a rest.
    var developBinding: Binding<DevelopSettings> {
        Binding(get: { self.developDraft }, set: { self.setDevelopDraft($0) })
    }

    func setDevelopDraft(_ d: DevelopSettings) {
        guard picture != nil else { return }
        developDraft = d
        let stored: DevelopSettings? = isDefaultDevelop(d) ? nil : d
        developWrite = drafted(developWrite, stored, sameDevelop)
        scheduleDevelopWrite()
        requestRender()
    }

    /// The draft's rest — the web's 200 ms.
    static let draftRestNanos: UInt64 = 200_000_000

    private func scheduleDevelopWrite() {
        developRest?.cancel()
        guard developWrite.pending != nil else {
            developRest = nil
            return
        }
        developRest = Task { [weak self] in
            try? await Task.sleep(nanoseconds: RollEditor.draftRestNanos)
            guard !Task.isCancelled else { return }
            self?.flushDevelop()
        }
    }

    private func flushDevelop() {
        developRest?.cancel()
        developRest = nil
        let flush = flushed(developWrite)
        developWrite = flush.state
        guard flush.owed, let id = openId else { return }
        let value = flush.value
        update { r in
            guard let p = r.pictures.first(where: { $0.id == id }), !sameDevelop(p.develop, value) else { return r }
            return patchPicture(r, id) { $0.develop = value }
        }
    }

    /// Everything the drafts owe, written now — leaving a picture, an undo,
    /// the app going to the background.
    func flushDrafts() {
        flushDevelop()
    }

    /// The roll moved under the drafts: take it, and drop what was owed.
    private func reconcileDrafts() {
        let stored = picture?.develop
        let arrival = arrived(developWrite, stored, sameDevelop)
        developWrite = arrival.state
        if arrival.reseed {
            developRest?.cancel()
            developRest = nil
            developDraft = stored ?? .default
            requestRender()
        }
    }

    // MARK: - bindings the sections write through

    /// A field of the open picture, written straight through the updater —
    /// merged into one undo step while the same picture is worked on.
    func binding<T>(_ keyPath: WritableKeyPath<RollPicture, T>, fallback: T) -> Binding<T> {
        Binding(
            get: { self.picture?[keyPath: keyPath] ?? fallback },
            set: { value in
                guard let id = self.openId else { return }
                self.update { patchPicture($0, id) { $0[keyPath: keyPath] = value } }
            }
        )
    }

    /// A record the app carries as the web wrote it (`border`, `keystone`,
    /// `lens`, `lensProfile`, `detail`, `vignette`, `repair`, `layers`): nil
    /// takes it off the picture.
    func carriedBinding(_ key: String) -> Binding<JSONValue?> {
        Binding(
            get: { self.picture?.carried[key] },
            set: { value in
                guard let id = self.openId else { return }
                self.update { patchPicture($0, id) { $0.carried[key] = value } }
            }
        )
    }

    /// Denoise, defringe, sharpen, texture, clarity, dehaze — nil on the
    /// picture when every number is at rest (`detailOrNull` / `.json`).
    var detailBinding: Binding<DetailSettings?> {
        Binding(
            get: { detailOrNull(self.picture?.carried["detail"]) },
            set: { value in
                let json: JSONValue? = value.flatMap { isDefaultDetail($0) ? nil : $0.json }
                self.carriedBinding("detail").wrappedValue = json
            }
        )
    }

    /// The post-crop vignette — nil on the picture when its amount is 0. The
    /// kernel's record has no writer, so its five keys are written here, as
    /// the web writes them.
    var vignetteBinding: Binding<PostCropVignette?> {
        Binding(
            get: { postVignetteOrNull(self.picture?.carried["vignette"]) },
            set: { value in
                guard let value, !isDefaultPostVignette(value) else {
                    self.carriedBinding("vignette").wrappedValue = nil
                    return
                }
                self.carriedBinding("vignette").wrappedValue = .object([
                    "amount": .number(value.amount), "midpoint": .number(value.midpoint),
                    "roundness": .number(value.roundness), "feather": .number(value.feather),
                    "highlights": .number(value.highlights),
                ])
            }
        )
    }

    // MARK: - tools and preferences

    func setTool(_ tool: DevelopTool) {
        guard tool != activeTool else { return }
        let reframes = tool.showsWholePicture != activeTool.showsWholePicture
        activeTool = tool
        if reframes {
            renderGeneration += 1
            beforeKey = nil
            requestRender()
        }
    }

    /// The dropper's binding, for the Auto section's "pick grey".
    var pickingBinding: Binding<Bool> {
        Binding(get: { self.activeTool == .eyedropper }, set: { self.setTool($0 ? .eyedropper : .none) })
    }

    func setShowFacts(_ on: Bool) {
        showFacts = on
        UserDefaults.standard.set(on, forKey: RollEditor.factsKey)
    }

    func setCompareOn(_ on: Bool) {
        compareOn = on
        UserDefaults.standard.set(on, forKey: RollEditor.compareKey)
        if on { requestRender() }
    }

    func setShowIgnored(_ on: Bool) {
        showIgnored = on
        UserDefaults.standard.set(on, forKey: RollEditor.showIgnoredKey)
    }

    func setHolding(_ on: Bool) {
        guard on != holding else { return }
        holding = on
        if on && before == nil { requestRender() }
    }

    /// The divider is live: a picture, compare on, nothing holding the pointer.
    var comparing: Bool {
        stage != nil && !holding && compareOn && !activeTool.suspendsCompare
    }

    /// The wipe as the stage shows it: suspended → 0, remembered underneath.
    var shownWipe: Double { comparing ? wipe : 0 }

    static let factsKey = "atelier.develop.facts"
    static let compareKey = "atelier.develop.compare"
    static let showIgnoredKey = "atelier.develop.showIgnored"
    static let sectionsKey = "atelier.develop.sections"

    private static func readStoredSections() -> [PictureSection] {
        let raw = UserDefaults.standard.string(forKey: sectionsKey).flatMap { JSONValue.parse($0) }
        return readSections(raw)
    }

    /// Tick sections in the picker — kept in the inspector's order, remembered
    /// on this device (a convenience like a remembered tab).
    func setTickedSections(_ sections: [PictureSection]) {
        let ordered = readSections(.array(sections.map { .string($0.rawValue) }))
        tickedSections = ordered
        let json = JSONValue.array(ordered.map { .string($0.rawValue) })
        UserDefaults.standard.set(json.serialized(), forKey: RollEditor.sectionsKey)
    }

    // MARK: - what the editor says

    /// A word beside the name, gone after a moment — `copied`, `pasted`.
    func tell(_ word: String) {
        told = word
        toldTask?.cancel()
        toldTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            guard !Task.isCancelled else { return }
            self?.told = nil
        }
    }

    /// Forward a key the active tool answers.
    func sendToTool(_ action: EditorKeyAction) {
        commandSerial += 1
        toolCommand = ToolCommand(serial: commandSerial, action: action)
    }

    // MARK: - the stage

    /// Swap how the stage renders — the integration task's seam.
    func setRenderPlan(_ plan: DevelopRenderPlan) {
        renderPlan = plan
        renderGeneration += 1
        beforeKey = nil
        requestRender()
    }

    /// The sections this picture carries that the stage does not draw yet.
    var unrendered: [String] {
        draftedPicture.map { renderPlan.unrendered(picture: $0) } ?? []
    }

    /// The picture as the stage draws it now — whole while the crop has it.
    private var stagePicture: RollPicture? {
        guard var p = draftedPicture else { return nil }
        if activeTool.showsWholePicture {
            p.framing = nil
            p.aspect = "original"
        }
        return p
    }

    /// Render again — at most one render in flight and one owed, so a slider
    /// dragged at sixty steps a second never piles work up on the GPU.
    func requestRender() {
        renderDirty = true
        if !rendering { startRender() }
    }

    private func startRender() {
        renderDirty = false
        guard let pic = stagePicture else {
            stage = nil
            before = nil
            histogram = nil
            decodedSize = nil
            loading = false
            problem = nil
            return
        }
        rendering = true
        let generation = renderGeneration
        let plan = renderPlan
        let rollId = self.rollId
        let wantsBefore = compareOn || holding
        let key = "\(pic.id)|\(pic.aspect)|\(pic.framing?.json.serialized() ?? "")|\(pic.develop?.base?.rawValue ?? "")"
        let needsBefore = wantsBefore && (beforeKey != key || before == nil)
        if stage == nil { loading = true }
        Task { [weak self] in
            guard let self else { return }
            do {
                let read = try await self.pool.read(rollId, pic)
                let decoded = read.decoded
                let out = await Task.detached(priority: .userInitiated) { () -> RenderedStage in
                    let renderer = PictureRenderer.shared
                    let composed = plan.render(picture: pic, decoded: decoded, budget: .stage)
                    let image = renderer.cgImage(composed)
                    let histogram = renderer.rgbaBytes(composed, longEdge: histogramSampleEdge).map { luminanceHistogram($0) }
                    var beforeImage: CGImage?
                    if needsBefore {
                        beforeImage = renderer.cgImage(plan.render(picture: asShotForCompare(pic), decoded: decoded, budget: .stage))
                    }
                    return RenderedStage(image: image, before: beforeImage, histogram: histogram,
                                         size: CGSize(width: image?.width ?? 0, height: image?.height ?? 0))
                }.value
                if generation == self.renderGeneration && pic.id == self.openId {
                    self.stage = out.image
                    if needsBefore {
                        self.before = out.before
                        self.beforeKey = key
                    }
                    self.histogram = out.histogram
                    self.stageSize = out.size
                    self.decodedSize = CGSize(width: decoded.width, height: decoded.height)
                    self.loading = false
                    self.problem = out.image == nil ? "This picture could not be rendered." : nil
                    self.scheduleSnapshot()
                }
            } catch {
                if generation == self.renderGeneration && pic.id == self.openId {
                    self.stage = nil
                    self.before = nil
                    self.histogram = nil
                    self.loading = false
                    self.problem = self.availability(pic) == .ready ? error.localizedDescription : nil
                }
            }
            self.rendering = false
            if self.renderDirty { self.startRender() }
        }
    }

    /// The open picture's cell redrawn AS DELIVERED once it rests (700 ms) —
    /// never while the crop shows the whole picture.
    private func scheduleSnapshot() {
        snapshotTask?.cancel()
        guard let id = openId, !activeTool.showsWholePicture else { return }
        snapshotTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled, let self, self.openId == id, let image = self.stage else { return }
            self.pool.snapshot(id, from: image)
        }
    }

    // MARK: - the grey dropper

    /// Solve the white balance on the picture AS SHOT at `[u, v]` of the
    /// source, write it into the draft and put the dropper down.
    func pickGrey(u: Double, v: Double) {
        guard let pic = picture, let read = pool.held(pic.id) else { return }
        let decoded = read.decoded
        Task { [weak self] in
            let linear = await Task.detached(priority: .userInitiated) { () -> (Double, Double, Double)? in
                RollEditor.sampleLinear(decoded, u: u, v: v)
            }.value
            guard let self, self.openId == pic.id, let linear else { return }
            let wb = whiteBalanceFor(linear)
            var d = self.developDraft
            d.temperature = wb.temperature
            d.tint = wb.tint
            self.setDevelopDraft(d)
            self.tell("picked grey · temperature \(Int(wb.temperature)), tint \(Int(wb.tint))"
                + (wb.clamped ? " · as far as the sliders reach" : ""))
            self.setTool(.none)
        }
    }

    /// The average of a 5 × 5 patch of the source at `[u, v]`, in linear light.
    nonisolated static func sampleLinear(_ decoded: DecodedPicture, u: Double, v: Double) -> (Double, Double, Double)? {
        let x = u * Double(decoded.width)
        // Core Image counts y up from the bottom; the source's shares count down.
        let y = (1 - v) * Double(decoded.height)
        let patch = CGRect(x: x - 2.5, y: y - 2.5, width: 5, height: 5)
            .intersection(CGRect(x: 0, y: 0, width: decoded.width, height: decoded.height))
        guard !patch.isEmpty else { return nil }
        let average = decoded.image.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: patch)])
        // One pixel, wherever the filter put it.
        let origin = average.extent.isInfinite ? .zero : average.extent.origin
        let bounds = CGRect(origin: origin, size: CGSize(width: 1, height: 1))
        var pixel = [Float](repeating: 0, count: 4)
        pixel.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            RenderContexts.shared.render(average, toBitmap: base, rowBytes: 16, bounds: bounds, format: .RGBAf, colorSpace: nil)
        }
        let r = toLinear(Double(pixel[0]), .srgb)
        let g = toLinear(Double(pixel[1]), .srgb)
        let b = toLinear(Double(pixel[2]), .srgb)
        return (r, g, b)
    }

    // MARK: - the picture's facts (`I`)

    /// What the camera did — `ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV` — or nil.
    var captureFacts: String? {
        guard let id = openId, let exif = pool.exif[id] else { return nil }
        let line = captureLine(exif)
        return line.isEmpty ? nil : line
    }

    /// What this session did, one fact per line — `developLines` first.
    var factLines: [String] {
        guard let p = picture else { return [] }
        var lines = developLines(developDraft)
        let layers = drawingLayers(readLayers(p.carried["layers"])).count
        if layers > 0 { lines.append("\(layers) layer\(layers == 1 ? "" : "s")") }
        let detail = describeDetail(normaliseDetail(p.carried["detail"]))
        if !detail.isEmpty { lines.append(detail) }
        let vignette = describePostVignette(postVignetteOrNull(p.carried["vignette"]))
        if !vignette.isEmpty { lines.append(vignette) }
        let repair = describePatches(readPatches(p.carried["repair"]))
        if !repair.isEmpty { lines.append(repair) }
        if let note = fidelityNote { lines.append(note) }
        return lines
    }

    /// What the bytes on screen ARE, beside the name — `JPEG · 8-bit · 4032 × 3024`.
    var fidelityChip: String? {
        guard let p = picture else { return nil }
        if let read = pool.held(p.id), read.decoded.isRaw {
            return "RAW · system developer · \(read.decoded.width) × \(read.decoded.height)"
        }
        let pixels = decodedSize.map { FidelityPixels(width: Int($0.width), height: Int($0.height)) }
        return pictureFidelity(FidelityFile(name: p.ref.name), developDraft.base, pixels).chip
    }

    /// What the bytes on screen can give back. A RAW here is demosaiced by the
    /// system's developer, which the kernel's sentence (written for the web's
    /// embedded render) would misname — so it is said in its own words.
    var fidelityNote: String? {
        guard let p = picture, let size = decodedSize else { return nil }
        let pixels = FidelityPixels(width: Int(size.width), height: Int(size.height))
        if let read = pool.held(p.id), read.decoded.isRaw {
            return "the sensor’s data, demosaiced by the system’s RAW developer — not yet the web app’s LibRaw decode"
        }
        return pictureFidelity(FidelityFile(name: p.ref.name), developDraft.base, pixels).note
    }
}
