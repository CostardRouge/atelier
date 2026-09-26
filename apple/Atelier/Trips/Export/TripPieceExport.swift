// What leaves the piece editor as files — the web's `use-post-exports.ts`:
// the piece's ONE primary export (every slide in the format the deck says it
// is: stills for what is still, MP4s for what moves, in swipe order), the
// deck as stills, and the hook burned into a clip. Only one runs at a time,
// and each reports through one progress line and one note, because the
// author reads them in the same place.
//
// Rules kept (`roadtrip.md`, `docs/roadtrip-export.md`, `tasks.md`):
// - The plan is the kernel's (`exportPlan`): the medium of every slide was
//   settled where the piece is composed; this names each file and says what
//   would stop it, BEFORE a byte moves. `imagesOnly` is the one override.
// - Every run is a TASK (`TaskRegistry`): its line and ratio on the pill, its
//   Cancel real — it stops between two slides, ends the clip in flight, and
//   KEEPS what was made, said in the note ("cancelled after 3 of 5").
// - A clip that fails must not cost the slides that already rendered: each
//   is caught, and what went wrong is said with the delivery rather than
//   instead of it. A departure from what was composed (ticks that could not
//   be encoded) is reported the same way.
// - The files are written into a fresh folder under the temporary directory
//   (`delivered`, `folder`); the screen hands them on — a folder picker, the
//   share sheet, Photos — and then `discard()`s the folder.

import AtelierKit
import Foundation
import Observation

/// What a piece export reads, gathered by the editor as the stage has it.
struct TripExportInputs: @unchecked Sendable {
    var trip: TripDoc
    var post: TripPost
    /// The opener's pictures, decoded — the same the stage paints.
    var pictures: [String: HookPicture]?
    /// The hook picture's effective EXIF, when the piece credits its camera.
    var exif: ExifData?
    /// The badge's settled second: a still of the hook is taken there.
    var hookSeconds: Double
    /// Where this device finds a slide's picture — the Library, a folder, an
    /// instance's fetch — or nil when it cannot.
    var resolve: @Sendable (SavedMediaRef) async -> URL?
    var looks: TripSlideLooks

    init(trip: TripDoc, post: TripPost, pictures: [String: HookPicture]? = nil, exif: ExifData? = nil,
         hookSeconds: Double, resolve: @escaping @Sendable (SavedMediaRef) async -> URL?,
         looks: TripSlideLooks = TripSlideLooks()) {
        self.trip = trip; self.post = post; self.pictures = pictures; self.exif = exif
        self.hookSeconds = hookSeconds; self.resolve = resolve; self.looks = looks
    }

    /// The slug a piece's files are named by: its title, else its day.
    var slug: String {
        let title = post.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? "day-\(post.date)" : title
    }

    func renderer() -> SlideRenderer {
        SlideRenderer(trip: trip, post: post, pictures: pictures, exif: exif, looks: looks)
    }
}

enum TripExportError: LocalizedError {
    case missing(String)

    var errorDescription: String? {
        switch self {
        case .missing(let why): return why
        }
    }
}

/// Lines said during a run, from whichever thread says them.
private final class TripRunNotes: @unchecked Sendable {
    private let lock = NSLock()
    private var lines: [String] = []

    func add(_ line: String) {
        lock.lock()
        lines.append(line)
        lock.unlock()
    }

    var all: [String] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }
}

/// How a run ended: the files it wrote and the sentence it says.
struct TripExportOutcome {
    var files: [TripDeliveredFile]
    var folder: URL?
    var note: String?
}

@MainActor
@Observable
final class TripPieceExport {
    /// A running export's line, or nil when idle.
    private(set) var exporting: String?
    /// How far through the WHOLE job, 0…1, or nil while a step has no measure.
    private(set) var progress: Double?
    /// The last export's outcome, in a sentence.
    private(set) var note: String?
    /// What the last run wrote, and where — for the screen to hand on.
    private(set) var delivered: [TripDeliveredFile] = []
    private(set) var folder: URL?

    @ObservationIgnored private var work: Task<Void, Never>?
    @ObservationIgnored private var handle: TaskHandle?
    @ObservationIgnored private var flag: RunCancelFlag?

    var running: Bool { work != nil }

    // MARK: - the three verbs

    /// The piece's ONE primary export: every slide in the format it is.
    func exportPiece(_ inputs: TripExportInputs, imagesOnly: Bool = false) {
        start("Exporting the piece", inputs) { flag, say in
            await TripPieceRuns.runPiece(inputs, imagesOnly: imagesOnly, flag: flag, say: say)
        }
    }

    /// Every slide as a still (PNG unless asked), in swipe order.
    func exportDeck(_ inputs: TripExportInputs, format: TripStillFormat = .png) {
        start("Exporting the slides", inputs) { flag, say in
            await TripPieceRuns.runDeck(inputs, format: format, flag: flag, say: say)
        }
    }

    /// The hook burned into a clip: the version that PLAYS the entrance.
    func exportHookClip(_ inputs: TripExportInputs) {
        start("Encoding the hook", inputs) { flag, say in
            await TripPieceRuns.runHookClip(inputs, flag: flag, say: say)
        }
    }

    /// Stop between two slides, and end the clip in flight.
    func cancel() {
        guard running else { return }
        flag?.set()
        exporting = "Cancelling…"
    }

    /// The folder the last run wrote into, removed — once the screen has handed its files on.
    func discard() {
        if let folder { try? FileManager.default.removeItem(at: folder) }
        folder = nil
        delivered = []
    }

    // MARK: - the run's life

    private func start(_ label: String, _ inputs: TripExportInputs,
                       _ body: @escaping @Sendable (RunCancelFlag, @escaping @Sendable (String?, Double?) -> Void) async -> TripExportOutcome) {
        guard work == nil else { return }
        discard()
        note = nil
        exporting = "Rendering…"
        progress = 0
        let flag = RunCancelFlag()
        self.flag = flag
        let handle = TaskRegistry.shared.startTask(label: label, scope: "piece:\(inputs.post.id)", progress: 0,
                                                   cancel: { [weak self] in
            flag.set()
            let owner = self
            Task { @MainActor in owner?.exporting = "Cancelling…" }
        })
        self.handle = handle
        let say: @Sendable (String?, Double?) -> Void = { [weak self] line, ratio in
            var patch = TaskPatch(progress: .some(ratio))
            if let line { patch.detail = .some(line) }
            handle.update(patch)
            let owner = self
            Task { @MainActor in owner?.report(line, ratio) }
        }
        work = Task.detached(priority: .userInitiated) { [weak self] in
            let outcome = await body(flag, say)
            await self?.finish(outcome)
        }
    }

    private func report(_ line: String?, _ ratio: Double?) {
        guard work != nil else { return }
        exporting = line
        progress = ratio
    }

    private func finish(_ outcome: TripExportOutcome) {
        delivered = outcome.files
        folder = outcome.folder
        note = outcome.note
        exporting = nil
        progress = nil
        work = nil
        flag = nil
        handle?.done()
        handle = nil
    }
}

/// The runs themselves, off the main actor: they paint, decode and encode.
enum TripPieceRuns {
    /// What a progress event says, in the web's words.
    private static func line(_ p: ExportProgress, prefix: String = "Encoding ") -> String {
        if let ratio = p.ratio, p.phase == .encoding { return "\(prefix)\(Int((ratio * 100).rounded()))%…" }
        switch p.phase {
        case .demuxing: return "demuxing…"
        case .encoding: return "encoding…"
        case .finalizing: return "finalizing…"
        }
    }

    private static func plural(_ n: Int, _ word: String) -> String {
        "\(n) \(word)\(n == 1 ? "" : "s")"
    }

    /// Move a finished clip from the pipeline's temporary file into the run's
    /// folder, under the name the plan gave it.
    private static func keep(_ temp: URL, as name: String, in folder: URL) -> TripDeliveredFile? {
        let target = folder.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: target)
        do {
            try FileManager.default.moveItem(at: temp, to: target)
            return TripDeliveredFile(name: name, url: target)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            return nil
        }
    }

    /// ONE video for one slide, whatever it is made of: a collage and a still
    /// are painted, a clip is cut and re-timed.
    private static func renderSlideVideo(_ renderer: SlideRenderer, _ slide: DeckSlide, seconds: Double,
                                         _ inputs: TripExportInputs, notes: TripRunNotes, label: String,
                                         flag: RunCancelFlag,
                                         progress: @escaping (ExportProgress) -> Void) async throws -> URL {
        let cancelled: () -> Bool = { flag.isSet || Task.isCancelled }
        let skipped: (String) -> Void = { reason in notes.add("\(label): \(reason)") }
        if slide.collage != nil {
            let sources = await DeckStillsExport.sources(slide, resolve: inputs.resolve)
            return try await SlideVideoExport.painted(renderer, slide, sources, seconds: seconds, onAudioSkipped: skipped,
                                                      onProgress: progress, isCancelled: cancelled)
        }
        guard let ref = slide.media, let url = await inputs.resolve(ref) else {
            throw TripExportError.missing("\(slide.media?.name ?? "This slide") is not in the Library.")
        }
        if !BadgeSources.isClip(ref.name) {
            let lead = try await BadgeSources.load(url, name: ref.name)
            return try await SlideVideoExport.painted(renderer, slide, SlideSources(lead: lead), seconds: seconds,
                                                      onAudioSkipped: skipped, onProgress: progress, isCancelled: cancelled)
        }
        return try await SlideVideoExport.clip(renderer, slide, url: url, seconds: seconds, onAudioSkipped: skipped,
                                               onProgress: progress, isCancelled: cancelled)
    }

    static func runPiece(_ inputs: TripExportInputs, imagesOnly: Bool, flag: RunCancelFlag,
                                     say: @escaping @Sendable (String?, Double?) -> Void) async -> TripExportOutcome {
        let slides = deckSlides(inputs.trip, inputs.post)
        var found: Set<Int> = []
        for slide in slides {
            if let ref = slide.media, await inputs.resolve(ref) != nil { found.insert(slide.position) }
        }
        let known = found
        let plan = exportPlan(inputs.trip, inputs.post, ExportPlanOptions(
            canEncode: true,
            hasPicture: { $0.media == nil || known.contains($0.position) },
            imagesOnly: imagesOnly
        ))
        if plan.files == 0 {
            return TripExportOutcome(files: [], folder: nil, note: plan.blockers.first ?? "Nothing in this piece can be written.")
        }
        let folder: URL
        do {
            folder = try TripDeliveryFolder.make(tripRunFolderName(inputs))
        } catch {
            return TripExportOutcome(files: [], folder: nil, note: error.localizedDescription)
        }

        let items = plan.items.filter { $0.blocker == nil }
        let renderer = inputs.renderer()
        await inputs.looks.prepare(inputs.trip, inputs.post)
        var rendered: [TripDeliveredFile] = []
        let notes = TripRunNotes()

        // The stills in one pass: a carousel of photographs costs one decode each.
        let stills = items.filter { $0.medium == .image }
        if !stills.isEmpty {
            let wanted = Set(stills.map(\.position))
            let total = Double(items.count)
            say("Rendering…", 0)
            let out = await DeckStillsExport.render(
                renderer, hookSeconds: inputs.hookSeconds, include: { wanted.contains($0.position) }, into: folder,
                resolve: inputs.resolve,
                onProgress: { done, all in say("Rendering \(done)/\(all)…", Double(done) / total) },
                isCancelled: { flag.isSet }
            )
            rendered += out
        }

        let clips = items.filter { $0.medium == .video }
        for (i, item) in clips.enumerated() {
            if flag.isSet { break }
            let base = Double(items.count - clips.count + i)
            let total = Double(items.count)
            do {
                let temp = try await renderSlideVideo(
                    renderer, item.slide, seconds: item.seconds, inputs, notes: notes, label: item.name, flag: flag
                ) { p in
                    let text = TripPieceRuns.line(p, prefix: "Encoding \(i + 1)/\(clips.count) · ")
                    say(text, (base + (p.ratio ?? 0)) / total)
                }
                if let file = keep(temp, as: item.name, in: folder) { rendered.append(file) }
            } catch is CancellationError {
                break
            } catch {
                if flag.isSet { break }
                notes.add(error.localizedDescription)
            }
        }

        if rendered.isEmpty {
            try? FileManager.default.removeItem(at: folder)
            let said = notes.all.first ?? "Nothing could be rendered — check the pictures are loaded."
            return TripExportOutcome(files: [], folder: nil,
                                     note: flag.isSet ? "Export cancelled — nothing was written." : said)
        }
        // A cancelled run keeps what it made and says so.
        let short = plan.items.count - rendered.count
        var told: [String] = []
        if flag.isSet { told.append("cancelled after \(rendered.count) of \(items.count)") }
        told += plan.blockers
        told += notes.all
        let tail = (short > 0 ? " · \(short) could not be written" : "") + (told.first.map { " — \($0)" } ?? "")
        return TripExportOutcome(files: rendered, folder: folder, note: "\(plural(rendered.count, "file")) written" + tail)
    }

    static func runDeck(_ inputs: TripExportInputs, format: TripStillFormat, flag: RunCancelFlag,
                                    say: @escaping @Sendable (String?, Double?) -> Void) async -> TripExportOutcome {
        let folder: URL
        do {
            folder = try TripDeliveryFolder.make(tripRunFolderName(inputs))
        } catch {
            return TripExportOutcome(files: [], folder: nil, note: error.localizedDescription)
        }
        let renderer = inputs.renderer()
        let count = renderer.slides.count
        say("Rendering…", 0)
        let rendered = await DeckStillsExport.render(
            renderer, hookSeconds: inputs.hookSeconds, format: format, into: folder, resolve: inputs.resolve,
            onProgress: { done, total in say("Rendering \(done)/\(total)…", Double(done) / Double(max(1, total))) },
            isCancelled: { flag.isSet }
        )
        if rendered.isEmpty {
            try? FileManager.default.removeItem(at: folder)
            return TripExportOutcome(files: [], folder: nil, note: flag.isSet
                ? "Export cancelled — nothing was written."
                : "Nothing could be rendered — check the pictures are loaded.")
        }
        let short = count - rendered.count
        let tail = flag.isSet
            ? " · cancelled after \(rendered.count) of \(count)"
            : (short > 0 ? " · \(short) could not be rendered" : "")
        return TripExportOutcome(files: rendered, folder: folder, note: "\(plural(rendered.count, "slide")) written" + tail)
    }

    static func runHookClip(_ inputs: TripExportInputs, flag: RunCancelFlag,
                                        say: @escaping @Sendable (String?, Double?) -> Void) async -> TripExportOutcome {
        let post = inputs.post
        guard let slide = deckSlides(inputs.trip, post).first(where: { $0.kind == .hook }) else {
            return TripExportOutcome(files: [], folder: nil, note: "This piece has no hook to encode.")
        }
        var seconds = post.badge.hookSeconds
        if let ref = slide.media, BadgeSources.isClip(ref.name) {
            if let problem = hookSourceProblem(ref.name) { return TripExportOutcome(files: [], folder: nil, note: problem) }
            // The length offered is never longer than the clip in hand.
            if let url = await inputs.resolve(ref), let source = try? await VideoSource.open(url) {
                seconds = hookSecondsWithin(post.badge.hookSeconds, post.badge.durationSeconds, source.metadata.duration,
                                            slide.videoTimeSeconds, slide.speed)
            }
        }
        let folder: URL
        do {
            folder = try TripDeliveryFolder.make(tripRunFolderName(inputs))
        } catch {
            return TripExportOutcome(files: [], folder: nil, note: error.localizedDescription)
        }
        say("Encoding…", 0)
        let renderer = inputs.renderer()
        await inputs.looks.prepare(inputs.trip, post)
        let notes = TripRunNotes()
        let name = hookVideoName(inputs.trip.name, inputs.slug, SlideVideoExport.variant(post, slide))
        do {
            let temp = try await renderSlideVideo(renderer, slide, seconds: seconds, inputs, notes: notes,
                                                  label: name, flag: flag) { p in
                say(TripPieceRuns.line(p), p.ratio)
            }
            guard let file = keep(temp, as: name, in: folder) else {
                try? FileManager.default.removeItem(at: folder)
                return TripExportOutcome(files: [], folder: nil, note: "\(name) could not be written.")
            }
            // A clip that went out without the ticks it was composed with says so.
            let skipped = notes.all.first.map { line -> String in
                let prefix = "\(name): "
                return line.hasPrefix(prefix) ? String(line.dropFirst(prefix.count)) : line
            }
            return TripExportOutcome(files: [file], folder: folder,
                                     note: skipped.map { "\(name) written — \($0)" } ?? "\(name) written")
        } catch {
            try? FileManager.default.removeItem(at: folder)
            if flag.isSet || error is CancellationError {
                return TripExportOutcome(files: [], folder: nil, note: "Encoding cancelled — nothing was written.")
            }
            return TripExportOutcome(files: [], folder: nil, note: error.localizedDescription)
        }
    }
}

/// The slug the run's folder is named by — the piece's files' own.
private func tripRunFolderName(_ inputs: TripExportInputs) -> String {
    let words = inputs.slug.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }
    let slug = String(words).split(separator: "-").joined(separator: "-")
    return slug.isEmpty ? "piece" : String(slug.prefix(48))
}
