// THE CAPTURE'S FILES for a roll's picture — the web's `PictureWorkbench.tsx`
// around `captureInput`, `sensorSourceFor` and the delivered fetch
// (`renditions.md`; `renditions-build.md` R3a, R3b, R4;
// `docs/capture-renditions.md` §9, §13, §14).
//
// A photograph is rarely one file: a DJI writes `DJI_0101.JPG` beside
// `DJI_0101.DNG`, a Sony `DSC08463.HIF` beside `.ARW`, a Winnow adds its own
// proxy over whichever it ingested. The fidelity chip's menu is the LIST OF
// THOSE FILES — the proxy, what the camera delivered, the sensor with its RAW
// rungs nested under it — and this file is where the roll knows them:
//
// - A LOCAL picture's SIBLINGS (`AssetParts.siblings`, R2): the files of its
//   folder sharing its base name, and the ones the Library's asset kept
//   beside it — each listed only once its HEAD is read (its `Software` tag,
//   so an export of ours is never offered as the camera's file; a RAW's two
//   sizes and its calibration). An instance's picture has none: it carries
//   its COMPANION on its origin instead.
// - An INSTANCE's picture: the proxy's own original and the capture's
//   companion, from what the instance vouched for (`RollEditor.vouched`), the
//   render inside a RAW among them read from a megabyte of its head once —
//   never assumed (a DJI's is 960 × 540).
// - The choice is STORED on the picture (`RollPicture.rendition`, nil for
//   where it opens); the develop's `base` is the material ABOVE it. Picking a
//   file drops the base; picking a rung keeps the file choice under it.
// - The STAGE draws from the chosen file (`stageFile`): a sibling in hand
//   with no fetch — a folder's DNG beside its JPEG IS the sensor —, a file the
//   session holds (`SessionOriginals`, shared with the lightbox and the
//   export), else fetched ONCE as a task on the picture's edge, with its
//   bytes and a Cancel, held under ITS OWN asset id; a fetch that fails is
//   said and the picture goes back to where it opens.
// - The export takes the SAME files (`CaptureSiblings.forRun`, the run's
//   `RunFetch`): the workbench and the export must be handed the same
//   siblings or they disagree.

import Foundation
import Observation
import AtelierKit

/// One file of a picture's capture beside it — in its folder, or in the
/// Library's asset — and where this device reads it.
struct CaptureSiblingFile {
    let ref: SavedMediaRef
    let source: PictureBytesSource
}

/// The file the stage reads for a picture when it is not the picture's own.
struct ShownFile {
    /// What it is — a rendition id (`delivered:<name>`, `sensor:<name>`): the pool's key.
    let key: String
    /// Its own name: what the decoder reads its kind from.
    let name: String
    let source: PictureBytesSource
}

/// What the stage measured of a picture's OWN file, the last time it drew from it.
struct OpenedFileFacts: Equatable {
    /// Its pixels — the file's, or the render inside a RAW.
    var measured: PixelSize?
    /// A RAW in hand: its sensor plane, as shown.
    var sensor: PixelSize?
}

/// What the roll knows of its pictures' capture files, this session.
@MainActor
@Observable
final class RollRenditions {
    /// Each LOCAL picture's capture files beside it, once looked for.
    fileprivate(set) var siblings: [String: [CaptureSiblingFile]] = [:]
    /// What each sibling's head said, by its file identity — nothing is listed before.
    fileprivate(set) var facts: [String: SiblingFacts] = [:]
    /// The render inside an instance's RAW, by its asset id: absent is not
    /// read, `.some(nil)` read and it carries none.
    fileprivate(set) var renders: [String: PixelSize?] = [:]
    /// Each picture's own file, as the stage last measured it.
    fileprivate(set) var opened: [String: OpenedFileFacts] = [:]
    /// The name of the capture file the stage shows for a picture, where it
    /// is not the picture's own — what the fidelity chip names.
    fileprivate(set) var shownNames: [String: String] = [:]
    /// The capture files being fetched for the stage, by their session key.
    fileprivate(set) var fetching: Set<String> = []
    /// A sibling RAW's own calibration, read from the same head.
    @ObservationIgnored fileprivate var calibrations: [String: RawCalibration] = [:]
    /// Pictures (with what vouched for them) whose capture was looked up.
    @ObservationIgnored fileprivate var looked: Set<String> = []
    /// The file the stage last drew each picture from — its key, "" for its own.
    @ObservationIgnored fileprivate var drawnFrom: [String: String] = [:]

    init() {}
}

extension RollEditor {
    // MARK: - what the capture holds

    /// The capture files beside `p` found so far and READ — a LOCAL
    /// picture's only, and never an export of ours (`isAtelierMade`): the
    /// stage, the chip and the run all take this one list.
    func captureSiblings(_ p: RollPicture) -> [CaptureSiblingFile] {
        guard isLocalCapture(p) else { return [] }
        let facts = renditions.facts
        return (renditions.siblings[p.id] ?? []).filter { sibling in
            guard let read = facts[fileIdentity(sibling.ref)] else { return false }
            return !isAtelierMade(read.software)
        }
    }

    /// A picture this device holds itself: no instance vouched for it.
    private func isLocalCapture(_ p: RollPicture) -> Bool {
        vouched(p) == nil && !RollStore.isRemote(p.ref)
    }

    /// What this device knows of `p`'s capture, for the kernel's readers
    /// (`captureInput` → `renditionsOf`).
    func captureFacts(_ p: RollPicture) -> CaptureFacts {
        // A file that lands in the session turns its row "in hand".
        _ = SessionOriginals.shared.version
        let identity = vouched(p)
        let origin = identity?.origin
        let assetId = identity?.assetId
        let held = SessionOriginals.shared
        let opened = renditions.opened[p.id]
        var original: CaptureFacts.Original?
        if origin?.fidelity == .proxy {
            let inHand = assetId.map { held.isHeld($0) } ?? false
            original = CaptureFacts.Original(assetId: assetId, held: inHand, render: renderRead(assetId))
        }
        let companion = origin?.companion.map { c in
            CaptureFacts.Companion(held: held.isHeld(c.assetId), render: renderRead(c.assetId))
        }
        let known = captureSiblings(p).compactMap { s -> CaptureFacts.Sibling? in
            renditions.facts[fileIdentity(s.ref)].map { CaptureFacts.Sibling(file: s.ref, facts: $0) }
        }
        return CaptureFacts(file: p.ref, origin: origin, measured: opened?.measured, sensor: opened?.sensor,
                            original: original, companion: companion, siblings: known)
    }

    /// The render inside the RAW held under `key`, in the three states the kernel reads.
    private func renderRead(_ key: String?) -> PixelSize?? {
        guard let key, let known = renditions.renders[key] else { return nil }
        return .some(known)
    }

    /// Every file of `p`'s capture, in the order the chip lists them.
    func captureRows(_ p: RollPicture) -> [Rendition] {
        renditionsOf(captureInput(captureFacts(p)))
    }

    /// Where `p`'s sensor data would come from — the file, a sibling, the
    /// proxy's original, the companion — or nil.
    func sensorSource(_ p: RollPicture) -> SensorSource? {
        let identity = vouched(p)
        return sensorSourceFor(p.ref, identity?.origin, captureSiblings(p).map(\.ref), identity?.assetId,
                               canFetchOriginal: identity?.originalUrl != nil)
    }

    /// The delivered file `p` is set to, where it is not where it opens — nil
    /// while its develop stands on the sensor.
    func wantedDelivered(_ p: RollPicture, rows: [Rendition]) -> Rendition? {
        guard !isRawDevelop(p.develop) else { return nil }
        let opening = openingRendition(rows)
        guard let chosen = renditionById(rows, p.rendition), chosen.role == .delivered, chosen.blocked == nil,
              chosen.id != opening?.id else { return nil }
        return chosen
    }

    /// The sensor's own calibration, where it can be read before it is on
    /// screen: the RAW the stage decoded, else a sibling's head.
    func sensorCalibration(_ p: RollPicture, _ sensor: SensorSource) -> RawCalibration? {
        let wanted = sensor.name.lowercased()
        if let raw = openRaw, raw.name.lowercased() == wanted { return raw.calibration }
        guard let sibling = captureSiblings(p).first(where: { $0.ref.name.lowercased() == wanted }) else { return nil }
        return renditions.calibrations[fileIdentity(sibling.ref)]
    }

    /// The file on screen as the fidelity chip reads it: the capture file
    /// the stage shows, or the picture's own — a proxy said as one.
    func shownFidelityFile(_ p: RollPicture) -> FidelityFile {
        if let name = renditions.shownNames[p.id] { return FidelityFile(name: name) }
        return FidelityFile(name: p.ref.name, origin: vouched(p)?.origin)
    }

    /// The pixels the picture's OWN file holds beyond what is on screen — a
    /// RAW's sensor, a proxy's original — nil while another file is shown:
    /// a delivered file IS the capture's pixels.
    func fullPixels(_ p: RollPicture, _ decoded: DecodedPicture?) -> PixelSize? {
        guard renditions.shownNames[p.id] == nil else { return nil }
        if let sensor = decoded?.raw?.sensor {
            return PixelSize(width: Int(sensor.width.rounded()), height: Int(sensor.height.rounded()))
        }
        guard let origin = vouched(p)?.origin, origin.fidelity == .proxy,
              let w = origin.width, let h = origin.height, w > 0, h > 0 else { return nil }
        return PixelSize(width: w, height: h)
    }

    // MARK: - the choice, above the photograph

    /// A file below the sensor, chosen on the chip — the web's `onRendition`:
    /// the base comes off with it, and the opening row is stored as nothing.
    func setRendition(_ id: String) {
        guard let p = draftedPicture else { return }
        if isRawDevelop(developDraft) {
            var d = developDraft
            d.base = nil
            d.rawGain = nil
            d.carried["rawWb"] = nil
            setDevelopDraft(d)
        }
        let opening = openingRendition(captureRows(p))
        let stored: String? = id == opening?.id ? nil : id
        guard p.rendition != stored else { return }
        update { patchPicture($0, p.id) { $0.rendition = stored } }
    }

    // MARK: - what the stage reads

    /// The file the stage draws `p` from when it is not its own: the RAW its
    /// develop stands on, else the file set above the photograph — in hand
    /// (a sibling, a file the session holds), or nil while it is fetched.
    /// Looks the capture up the first time it is asked.
    func stageFile(_ p: RollPicture) -> ShownFile? {
        lookUpCapture(p)
        if isRawDevelop(p.develop), let sensor = sensorSource(p) {
            guard sensor.reach != .file else { return nil }
            return capturedFile(sensor, key: "sensor:\(sensor.name.lowercased())", p, sensorWanted: true)
        }
        let rows = captureRows(p)
        guard let row = wantedDelivered(p, rows: rows) else { return nil }
        let identity = vouched(p)
        guard let source = deliveredSourceFor(p.rendition, p.ref, identity?.origin, captureSiblings(p).map(\.ref),
                                              identity?.assetId, canFetchOriginal: identity?.originalUrl != nil),
              source.reach != .file else { return nil }
        return capturedFile(source, key: row.id, p, sensorWanted: false)
    }

    /// The stage drew `p` from `shown` (nil: its own file) — what its own
    /// file measured is kept for the chip's rows.
    func noteStageRead(_ p: RollPicture, shown: ShownFile?, _ read: PictureRead) {
        renditions.drawnFrom[p.id] = shown?.key ?? ""
        if renditions.shownNames[p.id] != shown?.name { renditions.shownNames[p.id] = shown?.name }
        guard shown == nil else { return }
        let decoded = read.decoded
        let sensor = decoded.raw?.sensor.map { PixelSize(width: Int($0.width.rounded()), height: Int($0.height.rounded())) }
        let facts = OpenedFileFacts(measured: PixelSize(width: decoded.width, height: decoded.height), sensor: sensor)
        // Written only when it moved: every render lands here, and the chip reads it.
        if renditions.opened[p.id] != facts { renditions.opened[p.id] = facts }
    }

    /// A capture file as the stage reads it, or nil while it is fetched.
    private func capturedFile(_ source: SensorSource, key: String, _ p: RollPicture, sensorWanted: Bool) -> ShownFile? {
        switch source.reach {
        case .file:
            return nil
        case .sibling:
            let wanted = source.name.lowercased()
            guard let s = captureSiblings(p).first(where: { $0.ref.name.lowercased() == wanted }) else { return nil }
            return ShownFile(key: key, name: s.ref.name, source: s.source)
        case .original, .companion:
            if let held = source.key, let url = SessionOriginals.shared.url(held) {
                return ShownFile(key: key, name: source.name, source: .file(url))
            }
            fetchCaptureFile(source, p, sensorWanted: sensorWanted)
            return nil
        }
    }

    /// One of the capture's files fetched from its instance — a task named
    /// after it, on the picture's edge, with its bytes and a Cancel — and held
    /// for the session under its own asset id.
    private func fetchCaptureFile(_ source: SensorSource, _ p: RollPicture, sensorWanted: Bool) {
        guard let key = source.key, !renditions.fetching.contains(key) else { return }
        guard let identity = vouched(p), let client = captureClient(identity.assetId) else { return }
        let url: String?
        switch source.fetch {
        case .original?:
            url = identity.originalUrl
        case .companion?:
            url = identity.origin?.companion.flatMap { client.originalUrl(of: $0) }
        case nil:
            url = nil
        }
        guard let url else { return }
        renditions.fetching.insert(key)
        let name = source.name
        let weight: Int64? = source.bytes.map { Int64($0) }
        let pictureId = p.id
        let modified = p.ref.lastModified
        Task { [weak self] in
            var failure: String?
            do {
                let file = try await TaskCenter.tracked("Fetching \(name)", scope: pictureId, bytes: weight) {
                    try await client.fetchFile(url, name: name, type: "", lastModified: modified)
                }
                if SessionOriginals.shared.hold(key, name: name, data: file.data) == nil {
                    failure = "\(name) could not be kept on this device"
                }
            } catch is CancellationError {
                failure = TaskCenter.cancelledSentence("Fetching \(name)")
            } catch {
                let said = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
                failure = "\(name) could not be fetched: \(deviceWords(said))"
            }
            self?.captureFetched(key, pictureId: pictureId, failure: failure, sensorWanted: sensorWanted)
        }
    }

    /// A capture file landed, or could not be had: the stage draws again —
    /// and on a failure the picture goes back to where it opens, said.
    private func captureFetched(_ key: String, pictureId: String, failure: String?, sensorWanted: Bool) {
        renditions.fetching.remove(key)
        guard pictureId == openId else { return }
        if let failure {
            tell(failure)
            if sensorWanted {
                var d = developDraft
                d.base = nil
                d.rawGain = nil
                d.carried["rawWb"] = nil
                setDevelopDraft(d)
            } else {
                update { patchPicture($0, pictureId) { $0.rendition = nil } }
            }
        }
        requestRender()
    }

    /// The instance an asset id names, as a client — a connected one only.
    private func captureClient(_ assetId: String?) -> WinnowClient? {
        guard let connections = winnow.connections, let host = splitAssetId(assetId)?.host,
              let conn = connections.connection(host) else { return nil }
        return connections.client(for: conn)
    }

    // MARK: - looking the capture up

    /// Once per picture and per what vouched for it: a local picture's
    /// siblings found and their heads read; an instance's RAWs' renders read
    /// from their heads.
    func lookUpCapture(_ p: RollPicture) {
        let identity = vouched(p)
        let mark = "\(p.id)|\(identity?.assetId ?? "")"
        guard !renditions.looked.contains(mark) else { return }
        renditions.looked.insert(mark)
        if isLocalCapture(p) {
            findSiblings(p)
        } else if let identity {
            readRemoteRenders(identity)
        }
    }

    /// The Library's asset's own siblings for `p`, where the Library holds it.
    func librarySiblings(_ p: RollPicture) -> [CaptureSiblingFile] {
        guard let library = winnow.library,
              let asset = library.assets.first(where: { a in a.parts.image.map { sameMediaRef($0, p.ref) } ?? false })
        else { return [] }
        return (asset.parts.siblings ?? []).compactMap { s in
            library.location(of: s).map { CaptureSiblingFile(ref: s, source: $0.pictureBytesSource) }
        }
    }

    private func findSiblings(_ p: RollPicture) {
        let locator = store.locator(rollId, p.id)
        let beside = librarySiblings(p)
        let media = store.mediaDirectory
        let id = p.id
        let ref = p.ref
        Task { [weak self] in
            let found = await CaptureSiblings.find(ref, locator: locator, library: beside)
            guard let self else { return }
            self.renditions.siblings[id] = found
            for s in found {
                let key = fileIdentity(s.ref)
                if self.renditions.facts[key] != nil { continue }
                let read = await Task.detached(priority: .utility) {
                    CaptureSiblings.facts(s, mediaDirectory: media)
                }.value
                guard let read else { continue }
                self.renditions.facts[key] = read.facts
                if let calibration = read.calibration { self.renditions.calibrations[key] = calibration }
            }
            self.captureChanged(id)
        }
    }

    /// The render inside the proxy's own original and inside the companion,
    /// where either is a RAW — a megabyte of its head, once, never assumed.
    private func readRemoteRenders(_ identity: WinnowIdentity) {
        guard let origin = identity.origin, let client = captureClient(identity.assetId) else { return }
        var heads: [(key: String, url: String)] = []
        if isProxyOverRaw(origin), let url = identity.originalUrl, renditions.renders[identity.assetId] == nil {
            heads.append((identity.assetId, url))
        }
        if let companion = origin.companion, isRawImage(companion.name), renditions.renders[companion.assetId] == nil,
           let url = client.originalUrl(of: companion) {
            heads.append((companion.assetId, url))
        }
        guard !heads.isEmpty else { return }
        Task { [weak self] in
            for head in heads {
                let bytes: [UInt8]?
                if let held = SessionOriginals.shared.url(head.key) {
                    bytes = await Task.detached(priority: .utility) { InstrumentImages.head(held, count: rawProbeBytes) }.value
                } else {
                    bytes = (try? await client.fetchHead(head.url, bytes: rawProbeBytes)).map { [UInt8]($0) }
                }
                guard let bytes, let self else { continue }
                let render = rawSizesFrom(bytes).render.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
                self.renditions.renders[head.key] = .some(render)
            }
        }
    }

    /// Something about `id`'s capture landed: the stage draws again where
    /// the file it should draw from is not the one it drew.
    private func captureChanged(_ id: String) {
        guard id == openId, let p = draftedPicture else { return }
        let now = stageFile(p)?.key ?? ""
        if renditions.drawnFrom[id] != now { requestRender() }
    }
}

// MARK: - the files beside a picture

extension LibraryLocation {
    /// Where the roll reads a Library file's bytes.
    var pictureBytesSource: PictureBytesSource {
        switch self {
        case .bookmark(let bookmark): return .locator(.bookmark(bookmark))
        case .folder(let bookmark, let path): return .locator(.folder(bookmark, path))
        case .session(let path): return .file(URL(fileURLWithPath: path))
        }
    }
}

enum CaptureSiblings {
    /// The capture files beside a picture: the Library's asset's own, then
    /// its folder's files sharing its base name — each file once.
    static func find(_ ref: SavedMediaRef, locator: PictureLocator?, library: [CaptureSiblingFile]) async -> [CaptureSiblingFile] {
        var out = library
        if case .folder(let bookmark, let path)? = locator {
            let beside = await Task.detached(priority: .utility) {
                CaptureSiblings.inFolder(ref, bookmark: bookmark, path: path)
            }.value
            for s in beside where !out.contains(where: { $0.ref.name.lowercased() == s.ref.name.lowercased() }) {
                out.append(s)
            }
        }
        return out
    }

    /// A picture's siblings for a RUN — the ones the editor found, else
    /// looked for now (a picture never opened this session), so the export
    /// leaves from the same files the stage would. Only a local picture has any.
    @MainActor
    static func forRun(_ p: RollPicture, rollId: String, store: RollStore, editor: RollEditor?) async -> [CaptureSiblingFile] {
        if let editor, editor.vouched(p) != nil { return [] }
        if RollStore.isRemote(p.ref) { return [] }
        if let editor, editor.renditions.siblings[p.id] != nil {
            return editor.captureSiblings(p)
        }
        let found = await find(p.ref, locator: store.locator(rollId, p.id), library: editor?.librarySiblings(p) ?? [])
        let media = store.mediaDirectory
        var out: [CaptureSiblingFile] = []
        for s in found {
            // An export of ours beside the capture is never one of its files.
            let read = await Task.detached(priority: .utility) { CaptureSiblings.facts(s, mediaDirectory: media) }.value
            if let read, !isAtelierMade(read.facts.software) { out.append(s) }
        }
        return out
    }

    /// The files of a picture's own folder sharing its base name — images
    /// only, the picture itself left out. Blocking: call it off the main actor.
    static func inFolder(_ ref: SavedMediaRef, bookmark: Data, path: String) -> [CaptureSiblingFile] {
        guard let folder = try? RollStore.resolveBookmark(bookmark) else { return [] }
        let scoped = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        let dir = (path as NSString).deletingLastPathComponent
        let at = dir.isEmpty ? folder : folder.appendingPathComponent(dir, isDirectory: true)
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        let listed = (try? FileManager.default.contentsOfDirectory(at: at, includingPropertiesForKeys: keys,
                                                                   options: [.skipsHiddenFiles])) ?? []
        let base = fileBaseName(ref.name).lowercased()
        let own = ref.name.lowercased()
        var out: [CaptureSiblingFile] = []
        for file in listed {
            let name = file.lastPathComponent
            guard name.lowercased() != own, fileBaseName(name).lowercased() == base, classifyPart(name) == .image,
                  (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            let inside = dir.isEmpty ? name : "\(dir)/\(name)"
            out.append(CaptureSiblingFile(ref: RollStore.mediaRef(of: file), source: .locator(.folder(bookmark, inside))))
        }
        return out.sorted { $0.ref.name < $1.ref.name }
    }

    /// What a sibling's head says — its `Software` tag, a RAW's two sizes
    /// and its calibration, a drawable file's pixels. Blocking.
    static func facts(_ s: CaptureSiblingFile, mediaDirectory: URL) -> (facts: SiblingFacts, calibration: RawCalibration?)? {
        let raw = isRawImage(s.ref.name)
        return withFile(s.source, mediaDirectory: mediaDirectory) { url -> (facts: SiblingFacts, calibration: RawCalibration?)? in
            guard let head = InstrumentImages.head(url, count: raw ? rawProbeBytes : exifSliceBytes) else { return nil }
            let software = parseExif(head).software
            if raw {
                let sizes = rawSizesFrom(head)
                let render = sizes.render.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
                let sensor = sizes.sensor.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
                let facts = SiblingFacts(software: software, render: .some(render), sensor: sensor)
                return (facts, rawCalibrationFrom(head: head))
            }
            let pixels = InstrumentImages.shownSize(url).map { PixelSize(width: $0.width, height: $0.height) }
            return (SiblingFacts(software: software, pixels: pixels), nil)
        }
    }

    /// `body` over the file behind a bytes source, its security scope held
    /// for the length of the call. Blocking.
    static func withFile<T>(_ source: PictureBytesSource, mediaDirectory: URL, _ body: (URL) -> T?) -> T? {
        switch source {
        case .file(let url):
            return body(url)
        case .locator(.container(let path)):
            return body(mediaDirectory.appendingPathComponent(path))
        case .locator(.bookmark(let bookmark)):
            guard let url = try? RollStore.resolveBookmark(bookmark) else { return nil }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return body(url)
        case .locator(.folder(let bookmark, let path)):
            guard let folder = try? RollStore.resolveBookmark(bookmark) else { return nil }
            let scoped = folder.startAccessingSecurityScopedResource()
            defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
            return body(folder.appendingPathComponent(path))
        }
    }
}
