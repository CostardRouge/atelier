// The Studio's EXPORT RUN and what it leaves on screen — the web's
// `handleExport` and its state in `StudioEditor.tsx` (`exporting`,
// `exportStep`, `exportRatio`, `liveExport`, `variantStats`, `runStats`,
// `lastRun`, `renderFromProxy`), for this device:
//
// 1. WHERE first: the folder is picked at the click (`StudioExportPanel`),
//    its security scope held for the run — pick, then render, then write.
// 2. The look and the OPEN media's develop baked into one cube, fresh (the
//    stage's may lag an edit), the player paused — a preview and an export
//    are two consumers of one machine.
// 3. A clip an instance handed over as its PROXY: the capture fetched ONCE,
//    before the first variant, unless *Render from the proxy* is on — a task
//    of its own, cancellable. A still's original is fetched only where the
//    proxy could not fill the largest frame the variants ask for, and a fetch
//    that fails costs the extra pixels, never the delivery. (Instances do not
//    reach the Studio yet — the Library brings them — so today every file is
//    one on this device and nothing is fetched.)
// 4. Every variant in turn through ONE pipeline (`StudioVariantExport`),
//    each written into the folder as it lands under `variantFileName`, a
//    file of that name replaced; what it cost measured around the whole of it,
//    delivery included, and kept with the settings that produced it.
// 5. ONE task for the run (`TaskCenter`): its bar the variants, its Cancel
//    ending the variant in flight — the pipeline leaves no partial file — and
//    starting no other; what was written stays, and the note says how much.
// 6. After a finished run of media an instance handed over, the finals can
//    go HOME (`sendFinals`): refused before a byte moves on a viewer account,
//    a file over the instance's upload limit or a capture picked on another
//    instance (`finalsPlan`), one request per file, each with its capture's
//    id, then one reconcile.
//
// The run belongs to the PROJECT, not to a view: a registry keyed by project
// id (Develop's `RollRunState.forRoll`), so it survives the inspector
// changing tab and the editor being rebuilt. What it measured is this
// machine's, today — session state, never the document — and it is dropped
// the moment it could lie: a row whose settings changed shows no figure, and
// another media open shows none of them.

import CoreImage
import Foundation
import Observation
import AtelierKit

/// The variant being rendered, and when it started — its row counts up.
struct StudioLiveVariant: Equatable {
    let id: String
    let startedAt: Date
}

/// What one variant cost, with the settings that produced it.
struct StudioVariantMeasure: Equatable {
    let variant: ExportVariant
    let stat: ExportStat
}

/// A file the last run wrote.
struct StudioDeliveredFile: Equatable {
    let url: URL
    let name: String
    let bytes: Int
}

/// Where the finals of a run would go home to: the instance its media came
/// from, and the capture that instance vouched for.
struct StudioFinalsTarget: Equatable {
    let sourceId: String
    let assetId: String?
}

/// The web's `Sending` of `SendFinalsPanel.tsx`.
enum StudioFinalsSending: Equatable {
    case idle
    case sending(index: Int)
    case done(sent: Int)
    case failed(message: String, login: String?, sent: Int)
}

/// A capture to fetch before rendering — the web's `fetchOriginal` thunk,
/// resolved to the instance that can answer it.
struct StudioOriginalFetch {
    let sourceId: String
    let url: String
    let name: String
    let bytes: Int?
    let type: String
    let client: WinnowClient
}

/// Everything a run needs, captured on the main actor when Export is pressed.
struct StudioExportJob {
    let mediaId: String
    let isPhoto: Bool
    /// The file names' base: the custom name, else the media's.
    let base: String
    let variants: [ExportVariant]
    /// The drawing, minus the cube — baked when the run starts.
    let input: StudioRenderInput
    let grade: RollGrade?
    let develop: DevelopSettings?
    let file: SavedMediaRef
    let url: URL
    /// What a clip's variants encode — the cut, else the clip — for the
    /// realtime ratio; nil for a still.
    let clipSeconds: Double?
    /// The media's task scope — its edge draws the run.
    let scope: String
    let original: StudioOriginalFetch?
    let finals: StudioFinalsTarget?
    /// What the media's source said of the capture's EXIF.
    let vouched: ExifData?

    /// The run as the editor holds it now, or why there is none.
    @MainActor
    static func make(_ editor: StudioEditor, renderFromProxy: Bool) throws -> StudioExportJob {
        guard let active = editor.active, let file = editor.activeFile else { throw StudioExportError.nothingToExport }
        let edit = editor.edit
        guard !edit.variants.isEmpty else { throw StudioExportError.nothingToExport }
        guard let url = editor.library.url(for: file) else { throw StudioExportError.unreachable(file.name) }
        let isPhoto = editor.isPhoto
        if isPhoto && editor.photoSize == nil {
            throw editor.photoProblem == nil ? StudioExportError.notDecoded : StudioExportError.undecodable
        }
        let custom = edit.exportFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let duration = editor.playback.duration
        let input = StudioRenderInput(
            elements: isPhoto ? editor.stageElements : edit.elements,
            cues: editor.cues,
            cube: nil,
            interpolation: LookLibrary.shared.interpolation,
            film: edit.film,
            theme: edit.theme,
            timeShift: edit.timeShift,
            scenes: isPhoto ? [] : edit.scenes,
            trim: isPhoto ? nil : exportTrim(editor.range, duration),
            outro: isPhoto ? nil : edit.outro
        )
        let encoded = editor.trimmed ? trimDuration(editor.range) : duration
        let identity = knownIdentity(file)
        let origin = mediaOrigin(file)
        return StudioExportJob(
            mediaId: active.id,
            isPhoto: isPhoto,
            base: custom.isEmpty ? active.baseName : custom,
            variants: edit.variants,
            input: input,
            grade: edit.grade,
            develop: editor.activeDevelop,
            file: file,
            url: url,
            clipSeconds: isPhoto || encoded <= 0 ? nil : encoded,
            scope: identity?.assetId ?? fileIdentity(file),
            original: editor.exportOriginalFetch(renderFromProxy: renderFromProxy),
            finals: origin.map { StudioFinalsTarget(sourceId: $0.sourceId, assetId: identity?.assetId) },
            vouched: identity?.exif
        )
    }
}

/// Keeps a bar's reports to one per half percent — the exporter reports once
/// per decoded frame, on the thread that is decoding and encoding.
private final class StudioProgressThrottle {
    private let lock = NSLock()
    private var last = -1.0

    func pass(_ ratio: Double) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if ratio < 1 && ratio - last < 0.005 { return false }
        last = ratio
        return true
    }
}

@MainActor
@Observable
final class StudioExportModel {
    /// *Render from the proxy* — a session choice, off by default: fidelity
    /// is what an export is for; on is the escape hatch for a quick look.
    var renderFromProxy = false

    // MARK: the run in flight

    private(set) var running = false
    /// The variant being rendered, from 1.
    private(set) var index: Int?
    private(set) var total: Int?
    /// 0…1 through the variant in flight.
    private(set) var ratio = 0.0
    /// Pulling a capture down before the first variant — said as such.
    private(set) var fetching = false
    private(set) var fetchingFrom: String?
    private(set) var live: StudioLiveVariant?

    // MARK: what the last run left

    /// The media the figures below belong to.
    private(set) var mediaId: String?
    private(set) var error: String?
    /// A cancelled run's sentence.
    private(set) var note: String?
    /// What the file could not carry as asked (sound, a look), once each.
    private(set) var notes: [String] = []
    private(set) var measures: [String: StudioVariantMeasure] = [:]
    private(set) var runStats: [ExportStat] = []
    /// The matrix the run rendered — its summary stands while it still is the project's.
    private(set) var runVariants: [ExportVariant] = []
    private(set) var done = false
    private(set) var delivered: [StudioDeliveredFile] = []
    private(set) var folder: URL?
    private(set) var finalsTarget: StudioFinalsTarget?
    private(set) var sending: StudioFinalsSending = .idle

    @ObservationIgnored private var flag: RunCancelFlag?
    @ObservationIgnored private var work: Task<Void, Never>?

    init() {}

    private static var byProject: [String: StudioExportModel] = [:]

    /// The project's export — the same object for as long as the app runs.
    static func forProject(_ projectId: String) -> StudioExportModel {
        if let hit = byProject[projectId] { return hit }
        let made = StudioExportModel()
        byProject[projectId] = made
        return made
    }

    // MARK: - reading

    /// The last run's figures belong to this media.
    func owns(_ media: String?) -> Bool {
        guard let media else { return false }
        return mediaId == media
    }

    /// What this row cost last time, while its settings are the ones that produced it.
    func measure(_ variant: ExportVariant, media: String?) -> ExportStat? {
        guard owns(media), let held = measures[variant.id], held.variant == variant else { return nil }
        return held.stat
    }

    /// The run finished over this very matrix, on this media.
    func finished(_ variants: [ExportVariant], media: String?) -> Bool {
        owns(media) && done && !runStats.isEmpty && runVariants == variants
    }

    var folderName: String? { folder?.lastPathComponent }

    /// A sentence of the panel's own (a folder that could not be chosen).
    func say(_ sentence: String, media: String?) {
        if mediaId != media {
            measures = [:]
            runStats = []
            delivered = []
            done = false
        }
        mediaId = media
        error = sentence
        note = nil
    }

    // MARK: - the run

    /// Render every variant of the open media into `folder`, one after the other.
    func start(_ editor: StudioEditor, into folder: URL) {
        guard !running else { return }
        let job: StudioExportJob
        do {
            job = try StudioExportJob.make(editor, renderFromProxy: renderFromProxy)
        } catch {
            say(error.localizedDescription, media: editor.active?.id)
            return
        }
        editor.playback.pause()
        if mediaId != job.mediaId { measures = [:] }
        mediaId = job.mediaId
        running = true
        error = nil
        note = nil
        notes = []
        done = false
        runStats = []
        runVariants = job.variants
        delivered = []
        sending = .idle
        self.folder = folder
        finalsTarget = job.finals
        index = nil
        total = job.variants.count
        ratio = 0
        let flag = RunCancelFlag()
        self.flag = flag
        let count = job.variants.count
        // The pill's Cancel may come from any thread: the flag at once, the
        // rest on the main actor.
        let stop: @Sendable () -> Void = { [weak self] in
            flag.set()
            let owner = self
            Task { @MainActor in owner?.cancel() }
        }
        let handle = TaskCenter.start("Exporting \(job.base)", scope: job.scope, progress: 0,
                                      detail: "\(count) variant\(count == 1 ? "" : "s")", cancel: stop)
        work = Task { [weak self] in
            await self?.run(job, into: folder, flag: flag, handle: handle)
            handle.done()
        }
    }

    /// Stop: the variant in flight ends (no partial file), no other starts,
    /// and what was written stays.
    func cancel() {
        guard running, let flag else { return }
        flag.set()
        work?.cancel()
    }

    private func remember(_ sentence: String) {
        let said = deviceWords(sentence)
        if !notes.contains(said) { notes.append(said) }
    }

    private func run(_ job: StudioExportJob, into folder: URL, flag: RunCancelFlag, handle: TaskHandle) async {
        let scoped = folder.startAccessingSecurityScopedResource()
        let mediaScoped = job.url.startAccessingSecurityScopedResource()
        var fetched: URL?
        defer {
            if scoped { folder.stopAccessingSecurityScopedResource() }
            if mediaScoped { job.url.stopAccessingSecurityScopedResource() }
            if let fetched { try? FileManager.default.removeItem(at: fetched) }
        }

        // The look and this media's develop, one cube, baked now.
        let resolved = await LookLibrary.shared.resolve(job.grade ?? RollGrade())
        let develop = job.develop
        let interpolation = job.input.interpolation
        let cube = await Task.detached(priority: .userInitiated) {
            resolved.cube(develop: develop, interpolation: interpolation)
        }.value
        var input = job.input
        input.cube = cube
        for reason in resolved.missing.values.sorted() {
            remember("\(reason) — the files left without it.")
        }

        // The capture, before the first variant.
        var sourceURL = job.url
        if let original = job.original, !flag.isSet {
            fetching = true
            fetchingFrom = original.sourceId
            do {
                let landed = try await StudioExportModel.fetch(original, scope: job.scope)
                fetched = landed
                sourceURL = landed
            } catch {
                fetching = false
                fetchingFrom = nil
                if flag.isSet || error is CancellationError {
                    finish(job, written: 0, cancelled: true)
                    return
                }
                if job.isPhoto {
                    // A still's original costs the extra pixels, never the delivery.
                    remember("The original could not be fetched from \(original.sourceId), so the proxy was delivered.")
                } else {
                    self.error = deviceWords(error.localizedDescription)
                    finish(job, written: 0, cancelled: false)
                    return
                }
            }
            fetching = false
            fetchingFrom = nil
        }

        // The source, opened once for every variant.
        var clip: VideoSource?
        var still: CIImage?
        var head: [UInt8]?
        do {
            if job.isPhoto {
                let url = sourceURL
                let name = sourceURL == job.url ? job.file.name : (job.original?.name ?? job.file.name)
                let decoded = await Task.detached(priority: .userInitiated) { () -> (CIImage, [UInt8]?)? in
                    guard let data = try? Data(contentsOf: url),
                          let picture = PictureDecoder.decode(data, name: name) else { return nil }
                    return (picture.image, InstrumentImages.head(url, count: exifSliceBytes))
                }.value
                guard let decoded else { throw StudioExportError.undecodable }
                still = decoded.0
                head = decoded.1
            } else {
                clip = try await VideoSource.open(sourceURL)
            }
        } catch {
            self.error = deviceWords(error.localizedDescription)
            finish(job, written: 0, cancelled: false)
            return
        }

        let total = job.variants.count
        let now = nowMillis()
        let medium: VariantMedium = job.isPhoto ? .photo : .video
        let stillHead = head
        let vouched = job.vouched
        var written = 0
        for (i, variant) in job.variants.enumerated() {
            // Checked per variant, not only inside the encoder: a still renders
            // in one pass and never looks at the flag.
            if flag.isSet { break }
            let name = variantFileName(job.base, variant, medium)
            index = i + 1
            ratio = 0
            handle.update(TaskPatch(progress: .some(Double(i) / Double(total)), detail: .some("\(i + 1) of \(total) · \(name)")))
            let started = Date()
            live = StudioLiveVariant(id: variant.id, startedAt: started)
            do {
                let landed: URL
                if let still {
                    let rendered = input
                    let data = try await Task.detached(priority: .userInitiated) {
                        try StudioVariantExport.still(still, variant, rendered, head: stillHead, vouched: vouched, now: now)
                    }.value
                    landed = try StudioVariantExport.write(data, named: name, into: folder)
                    ratio = 1
                } else if let clip {
                    let temporary = try await render(clip, variant, input, step: i, of: total, flag: flag, handle: handle)
                    landed = try StudioVariantExport.move(temporary, named: name, into: folder)
                } else {
                    throw StudioExportError.nothingToExport
                }
                let size = StudioVariantExport.bytes(landed)
                let stat = ExportStat(bytes: size, seconds: Date().timeIntervalSince(started), clipSeconds: job.clipSeconds)
                measures[variant.id] = StudioVariantMeasure(variant: variant, stat: stat)
                runStats.append(stat)
                delivered.append(StudioDeliveredFile(url: landed, name: name, bytes: size))
                written += 1
            } catch {
                if flag.isSet || error is CancellationError { break }
                self.error = deviceWords(error.localizedDescription)
                break
            }
        }
        finish(job, written: written, cancelled: flag.isSet)
    }

    /// One clip variant off the main actor, its bar moving the run's.
    private func render(_ clip: VideoSource, _ variant: ExportVariant, _ input: StudioRenderInput, step: Int, of total: Int,
                        flag: RunCancelFlag, handle: TaskHandle) async throws -> URL {
        let throttle = StudioProgressThrottle()
        // Called on the encoder's thread: `@Sendable`, so neither closure is
        // taken for the main actor's, and the main actor is reached by a hop.
        let progress: @Sendable (ExportProgress) -> Void = { [weak self] p in
            guard p.phase == .encoding, let r = p.ratio, throttle.pass(r) else { return }
            handle.update(TaskPatch(progress: .some((Double(step) + r) / Double(total))))
            let owner = self
            Task { @MainActor in owner?.ratio = r }
        }
        let skipped: @Sendable (String) -> Void = { [weak self] reason in
            let owner = self
            Task { @MainActor in owner?.remember(reason) }
        }
        return try await Task.detached(priority: .userInitiated) {
            try await StudioVariantExport.video(clip, variant, input, onAudioSkipped: skipped, onProgress: progress,
                                                isCancelled: { flag.isSet })
        }.value
    }

    private func finish(_ job: StudioExportJob, written: Int, cancelled: Bool) {
        running = false
        index = nil
        live = nil
        fetching = false
        fetchingFrom = nil
        flag = nil
        work = nil
        if cancelled {
            note = studioExportCancelledNote(written: written, total: job.variants.count)
            done = false
        } else {
            done = error == nil && written == job.variants.count
        }
    }

    /// The capture fetched into a temporary file, as a task of its own — its
    /// name and weight on the pill, cancellable there.
    nonisolated private static func fetch(_ original: StudioOriginalFetch, scope: String) async throws -> URL {
        let client = original.client
        let file = try await TaskCenter.tracked("Fetching \(original.name)", scope: scope,
                                                bytes: original.bytes.map(Int64.init)) {
            try await client.fetchFile(original.url, name: original.name, type: original.type, lastModified: 0)
        }
        let safe = original.name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-original-\(UUID().uuidString)-\(safe)")
        try file.data.write(to: url, options: .atomic)
        return url
    }

    // MARK: - the finals, home

    /// Upload the last run's files to the instance their media came from,
    /// one request per file, then one reconcile. Refused up front where the
    /// plan is unsound or the account is a viewer.
    func sendFinals(_ plan: FinalsPlan, to target: StudioFinalsTarget) {
        if case .sending = sending { return }
        let connections = ConnectionStore.shared
        guard plan.problems.isEmpty, let connection = connections.connection(target.sourceId),
              canWriteBack(connection.capabilities) else { return }
        let client = connections.client(for: connection)
        let files = delivered
        let folder = self.folder
        let scope = target.assetId
        Task { [weak self] in
            let scoped = folder?.startAccessingSecurityScopedResource() ?? false
            defer { if scoped { folder?.stopAccessingSecurityScopedResource() } }
            var sent = 0
            do {
                for (i, item) in plan.items.enumerated() where i < files.count {
                    self?.sending = .sending(index: i)
                    let file = files[i]
                    let upload = UploadItem(name: file.name, contents: .file(path: file.url.path), path: item.path)
                    let options = UploadOptions(originalAssetId: item.originalAssetId, chapterId: plan.chapterId)
                    try await TaskCenter.tracked("Sending \(file.name) to \(target.sourceId)", scope: scope,
                                                 bytes: Int64(file.bytes)) {
                        _ = try await client.upload([upload], options)
                    }
                    sent += 1
                }
                _ = try await client.reconcile()
                self?.sending = .done(sent: sent)
            } catch {
                let login = (error as? WinnowError)?.kind == .unauthenticated ? client.loginUrl() : nil
                let message = error is CancellationError
                    ? TaskCenter.cancelledSentence("Sending the finals")
                    : deviceWords(error.localizedDescription)
                self?.sending = .failed(message: message, login: login, sent: sent)
            }
        }
    }
}

// MARK: - what the editor says about the export

extension StudioEditor {
    /// This project's export run.
    var exporter: StudioExportModel { StudioExportModel.forProject(projectId) }

    /// What is ON THE STAGE: the still's own pixels, upright, or the clip's
    /// display size — the header's numbers, never the export's.
    var exportStageSize: AtelierKit.Size? {
        if isPhoto {
            guard let size = photoSize, size.width > 0, size.height > 0 else { return nil }
            return AtelierKit.Size(Double(size.width), Double(size.height))
        }
        guard let w = clipWidth, let h = clipHeight, w > 0, h > 0 else { return nil }
        return AtelierKit.Size(Double(w), Double(h))
    }

    /// The clip's source when it handed the clip over as its PROXY and knows
    /// where the capture is — nil for every file on this device.
    var exportClipProxy: MediaOrigin? {
        guard !isPhoto, let video = activeVideo else { return nil }
        return StudioEditor.proxyOrigin(video)
    }

    /// The same for a still.
    var exportPhotoProxy: MediaOrigin? {
        guard let image = activeImage else { return nil }
        return StudioEditor.proxyOrigin(image)
    }

    private static func proxyOrigin(_ file: SavedMediaRef) -> MediaOrigin? {
        guard let origin = mediaOrigin(file), origin.fidelity == .proxy,
              let from = knownIdentity(file)?.originalUrl, !from.isEmpty else { return nil }
        return origin
    }

    /// What the EXPORT will encode from — a different file when it fetches the
    /// capture first. Only the variant maths reads it: a variant measured
    /// against the proxy would promise 1080 from a file it is not going to use.
    func exportSourceSize(renderFromProxy: Bool) -> AtelierKit.Size? {
        guard let stage = exportStageSize else { return nil }
        let origin = isPhoto ? exportPhotoProxy : (renderFromProxy ? nil : exportClipProxy)
        guard let origin, let w = origin.width, let h = origin.height, w > 0, h > 0 else { return stage }
        return AtelierKit.Size(Double(w), Double(h))
    }

    /// The largest frame the variants will write, from that source.
    func exportLargestFrame(renderFromProxy: Bool) -> AtelierKit.Size? {
        guard let source = exportSourceSize(renderFromProxy: renderFromProxy) else { return nil }
        return largestVariantFrame(edit.variants, source.width, source.height)
    }

    /// A still's delivery decision over its proxy — the *Delivers* row's and
    /// the run's, the same arithmetic.
    func exportStillDelivery() -> DeliverySummary? {
        guard isPhoto, let stage = exportStageSize, let origin = exportPhotoProxy,
              let frame = exportLargestFrame(renderFromProxy: false) else { return nil }
        // A RAW's render is not measured here: the proxy delivers (`deliveryDecision`).
        return deliveryDecision(measured: stage, origin: origin, render: nil, framing: nil, out: frame)
    }

    /// The capture a run fetches before rendering, or nil: a clip's unless
    /// *Render from the proxy* is on; a still's only where its proxy could not
    /// fill the frame; either only from an instance connected here.
    func exportOriginalFetch(renderFromProxy: Bool) -> StudioOriginalFetch? {
        let file: SavedMediaRef?
        let origin: MediaOrigin?
        if isPhoto {
            guard exportStillDelivery()?.from == .original else { return nil }
            file = activeImage
            origin = exportPhotoProxy
        } else {
            guard !renderFromProxy else { return nil }
            file = activeVideo
            origin = exportClipProxy
        }
        guard let file, let origin, let from = knownIdentity(file)?.originalUrl,
              let connection = ConnectionStore.shared.connection(origin.sourceId) else { return nil }
        let name = origin.name ?? file.name
        return StudioOriginalFetch(sourceId: origin.sourceId, url: from, name: name, bytes: origin.bytes,
                                   type: isPhoto ? "image/jpeg" : "video/mp4",
                                   client: ConnectionStore.shared.client(for: connection))
    }

    // MARK: the matrix, written through the funnel

    /// One row's settings changed.
    func updateExportVariant(_ id: String, _ change: (inout ExportVariant) -> Void) {
        update { e in
            guard let i = e.variants.firstIndex(where: { $0.id == id }) else { return }
            change(&e.variants[i])
        }
    }

    /// A new row starts from the project's destination format — the reason
    /// the format lives in the settings.
    func addExportVariant() {
        let made = createVariant(edit.aspectId)
        update { $0.variants.append(made) }
    }

    /// A row goes; the last one never does.
    func removeExportVariant(_ id: String) {
        update { e in
            guard e.variants.count > 1 else { return }
            e.variants.removeAll { $0.id == id }
        }
    }
}
