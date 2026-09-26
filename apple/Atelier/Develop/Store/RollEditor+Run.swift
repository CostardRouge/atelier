// The Export tab's STATE and its verbs — the web's `use-roll-export.ts` and the
// export half of `RollEditor.tsx`, minus what they draw (`Develop/Export/`).
//
// Rules kept (`develop-roll.md`, `develop-output.md`, `renditions-build.md`):
//
// - **The run is SAID before a byte moves**: the kernel's `planRun` over the
//   pictures that LEAVE (`delivers`) is the *Delivers* sentence, and every
//   picture's own line — leaving or not — is the *Pictures* table's.
// - ***Proxies only, for this run*** is the editor's and never the roll's —
//   "not now, not on this connection" is about this machine. So are the two
//   choices this app adds: the FORMAT (a HEIC beside the web's JPEG) and WHERE
//   (a folder, or Photos). None of the three is ever written on the document:
//   a roll this app writes is the web's `RollDoc` v6, byte for byte.
// - **The run outlives the screen**: its state is kept per ROLL for the app's
//   session (`RollRunState.forRoll`), never on the editor, so an export goes
//   on while he walks back to the gallery — the web's task registry is module
//   state for the same reason — and the tab shows it again when he returns.
// - **The folder is picked AT THE CLICK**, before a pixel is rendered: the verb
//   asks the Deliver section for a folder and the run starts from the answer
//   (`startExport`). Photos is asked for its permission at the click too.

import Foundation
import Observation
import SwiftUI
import AtelierKit

/// Where a run lands, as this device prefers it — never on the roll.
enum RunDestinationKind: String, CaseIterable, Identifiable {
    case folder, photos
    var id: String { rawValue }
    var title: String { self == .folder ? "A folder" : "Photos" }
}

/// Where ONE run lands: the folder picked at the click, or the photo library.
enum RunDestination {
    case folder(URL)
    case photos
}

/// The last run's HDR outcome — the web's `RollRun['hdr']`.
struct RollRunHdr: Equatable {
    /// Pictures that could carry a gain map (developed from a RAW).
    var asked = 0
    /// Files that left as Ultra HDR, read back within tolerance.
    var ultra = 0
    /// The most any map lifts, in stops.
    var headroom = 0.0
    /// The worst read-back stray, in stops, where one was checked.
    var checked: Double?
}

/// One export verb — the web's `ExportVerb`, its pictures named rather than a
/// closure, so the view that asks for the folder can start the run from its answer.
struct ExportVerb: Identifiable {
    let id: String
    let label: String
    let hint: String?
    let ids: [String]
}

/// A flag the render thread reads and the main thread sets: Cancel stops the
/// run BETWEEN two pictures, never half-way through a picture's files.
final class RunCancelFlag {
    private let lock = NSLock()
    private var value = false

    var isSet: Bool {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func set() {
        lock.lock()
        value = true
        lock.unlock()
    }
}

/// One roll's export, for the app's session.
@MainActor
@Observable
final class RollRunState {
    /// *Proxies only, for this run* — a run-time choice, never on the roll.
    var proxiesOnly = false
    /// JPEG (the web's) or HEIC (this app's) — this device's, never the roll's.
    private(set) var format: ExportFormat
    /// A folder or Photos — this device's, never the roll's.
    private(set) var destination: RunDestinationKind
    /// A running export's progress line, or nil when idle.
    private(set) var exporting: String?
    /// 0…1 across the run, nil while nothing is measured.
    private(set) var progress: Double?
    /// The last run's outcome, in a sentence.
    var note: String?
    /// The last run's HDR outcome, when the roll asked for one.
    private(set) var hdr: RollRunHdr?
    /// Every line of the last run's sentence — the sentence names the first.
    private(set) var details: [String] = []

    @ObservationIgnored private var flag: RunCancelFlag?
    @ObservationIgnored private var handle: TaskHandle?
    @ObservationIgnored private var work: Task<Void, Never>?

    static let formatKey = "atelier.develop.exportFormat"
    static let destinationKey = "atelier.develop.exportTo"

    init() {
        let defaults = UserDefaults.standard
        format = defaults.string(forKey: RollRunState.formatKey).flatMap(ExportFormat.init(rawValue:)) ?? .jpeg
        destination = defaults.string(forKey: RollRunState.destinationKey).flatMap(RunDestinationKind.init(rawValue:)) ?? .folder
    }

    var running: Bool { exporting != nil }

    func setFormat(_ next: ExportFormat) {
        format = next
        UserDefaults.standard.set(next.rawValue, forKey: RollRunState.formatKey)
    }

    func setDestination(_ next: RunDestinationKind) {
        destination = next
        UserDefaults.standard.set(next.rawValue, forKey: RollRunState.destinationKey)
    }

    // MARK: - the run's life

    /// A run begins: one TASK, named after what was asked, its Cancel real.
    func begin(label: String, flag: RunCancelFlag) {
        note = nil
        hdr = nil
        details = []
        exporting = "Preparing…"
        progress = 0
        self.flag = flag
        handle = TaskRegistry.shared.startTask(label: label, progress: 0, cancel: { [weak self] in
            // Called from whoever cancels — the pill, one day — so the flag is
            // set here and the rest waits for the main actor.
            flag.set()
            Task { @MainActor in self?.cancel() }
        })
    }

    /// Hold the work so a Cancel can reach it.
    func hold(_ task: Task<Void, Never>) {
        work = task
    }

    /// What the run is doing now, on the tab and on its task.
    func say(_ line: String, progress: Double? = nil, detail: String? = nil) {
        exporting = line
        if let progress { self.progress = progress }
        var patch = TaskPatch()
        if let progress { patch.progress = .some(progress) }
        if let detail { patch.detail = .some(detail) }
        handle?.update(patch)
    }

    /// Cancel: the picture in flight finishes its files, the next never starts.
    func cancel() {
        guard running else { return }
        flag?.set()
        exporting = "Cancelling — the picture in hand finishes first…"
    }

    var cancelRequested: Bool { flag?.isSet ?? false }

    /// The run ended, however it ended. `details` is every line the sentence
    /// could only count (`… (+3 more)`), for the tab to unfold.
    func finish(note: String?, hdr: RollRunHdr?, details: [String]) {
        self.note = note
        self.hdr = hdr
        self.details = details
        exporting = nil
        progress = nil
        flag = nil
        work = nil
        handle?.done()
        handle = nil
    }

    // MARK: - one per roll, for the session

    private static var byRoll: [String: RollRunState] = [:]

    /// The roll's run state — the same object for as long as the app runs.
    static func forRoll(_ rollId: String) -> RollRunState {
        if let hit = byRoll[rollId] { return hit }
        let made = RollRunState()
        byRoll[rollId] = made
        return made
    }
}

extension RollEditor {
    /// This roll's export run.
    var exportRun: RollRunState { RollRunState.forRoll(rollId) }

    /// The roll's export settings as stored.
    var exportSettings: RollExport { roll?.export ?? .default }

    /// One write to the roll's export settings — the web's `handleExportSettings`.
    func setExport(_ change: (inout RollExport) -> Void) {
        update { r in
            var out = r
            change(&out.export)
            if out.export == r.export { return r }
            out.updatedAt = nowMillis()
            return out
        }
    }

    // MARK: - the plan, said before a byte moves

    /// What the run knows of one picture's files on THIS device: the file
    /// itself, when the device can reach it. The app has no Winnow client yet,
    /// so no picture is a proxy and none has an original to fetch.
    func runFacts(_ p: RollPicture) -> PictureFacts {
        guard availability(p) == .ready else { return PictureFacts(file: nil) }
        return PictureFacts(
            file: p.ref,
            proxy: false,
            sensor: sensorSourceFor(p.ref, nil),
            delivered: deliveredSourceFor(p.rendition, p.ref, nil),
            original: nil
        )
    }

    /// The run the roll's own verb makes — the pictures that LEAVE; the
    /// sentence never counts one held or ignored.
    var runPlan: RunPlan {
        let leaving = pictures.filter(delivers)
        return planRun(leaving, { self.runFacts($0) }, exportRun.proxiesOnly, { formatBytes($0) })
    }

    /// Every picture's own line, leaving or not — a picture held back still
    /// says what it WOULD leave from, which is what decides it.
    var runLines: [String: String] {
        let every = planRun(pictures, { self.runFacts($0) }, exportRun.proxiesOnly, { formatBytes($0) })
        var out: [String: String] = [:]
        for p in every.pictures { out[p.id] = p.line }
        return out
    }

    /// Whether the plan draws `section` (`border`, `look`…) — what it does not
    /// draw is left out of the file's arithmetic too, and said.
    func planDraws(_ section: String, _ p: RollPicture) -> Bool {
        !renderPlan.unrendered(picture: p).contains(section)
    }

    /// What the OPEN picture will deliver into the roll's FIRST target — the
    /// folder itself — or nil until its size is known.
    var openDelivery: DeliverySummary? {
        guard let p = draftedPicture, let size = decodedSize, size.width > 0, size.height > 0 else { return nil }
        let src = Size(Double(size.width), Double(size.height))
        let ratio = pictureAspectRatio(p.aspect, src.width, src.height)
        let border = planDraws("border", p) ? readBorder(p.carried["border"]) : nil
        let proxiesOnly = exportRun.proxiesOnly
        let settings = DeliverySettings(size: exportSettings.primary.size, pixels: proxiesOnly ? .proxies : .auto)
        var summary = deliverySummary(src, false, nil, p.framing, ratio, border, settings)
        let chosen = proxiesOnly ? nil : deliveredSourceFor(p.rendition, p.ref, nil)
        let raw = pool.held(p.id)?.decoded.isRaw ?? false
        if let chosen, !isRawDevelop(p.develop) {
            // The picture's own answer: the file set above the photograph, at its own size.
            summary.from = .original
            summary.line = "\(chosen.name) · as chosen"
            summary.reason = "delivered from the file chosen above the photograph, at its own size"
        } else if proxiesOnly && isRawDevelop(p.develop) {
            summary.reason = "proxies only for this run — its RAW base is set aside and the numbers act on the file’s render"
        } else if raw {
            summary.reason = "a RAW — delivered from the sensor’s data, demosaiced by the system’s RAW developer at its own size"
        }
        return summary
    }

    // MARK: - the verbs

    /// The web's four: this picture, the selection, what leaves, and — when it
    /// is a real subset — what never left from here or changed since.
    var exportVerbs: [ExportVerb] {
        guard let openId else { return [] }
        var verbs = [ExportVerb(id: "open", label: "Export this picture", hint: nil, ids: [openId])]
        if !visibleSelected.isEmpty {
            let ids = pictures.filter { visibleSelected.contains($0.id) }.map(\.id)
            verbs.append(ExportVerb(id: "selection", label: "Export \(ids.count) selected",
                                    hint: "the pictures marked in the filmstrip, in the strip’s order", ids: ids))
        }
        let leaving = pictures.filter(delivers).map(\.id)
        if !leaving.isEmpty {
            verbs.append(ExportVerb(id: "roll", label: "Export \(leaving.count) picture\(leaving.count == 1 ? "" : "s")",
                                    hint: "the pictures that leave — edited ones, and those marked to send — in the strip’s order",
                                    ids: leaving))
            let marks = exportMarks
            let due = pictures.filter { delivers($0) && needsExport($0, marks) }.map(\.id)
            if !due.isEmpty && due.count < leaving.count {
                verbs.append(ExportVerb(id: "changed", label: "Export \(due.count) new or changed",
                                        hint: "the pictures that leave and were never exported from this device, or were edited since",
                                        ids: due))
            }
        }
        return verbs
    }

    /// Start a run into `destination` — called once the folder was picked (or
    /// straight from the click, for Photos). The drafts are written first, so
    /// what leaves is what the stage showed.
    func startExport(_ ids: [String], to destination: RunDestination) {
        let state = exportRun
        guard !state.running else { return }
        flushDrafts()
        guard let doc = roll else { return }
        let chosen = ids.compactMap { id in doc.pictures.first { $0.id == id } }
        guard !chosen.isEmpty else { return }
        var locators: [String: PictureLocator] = [:]
        for p in chosen {
            if let locator = store.locator(rollId, p.id) { locators[p.id] = locator }
        }
        let input = RollExportRun.Input(
            rollId: rollId,
            pictures: chosen,
            export: doc.export,
            identity: presets.book.identity,
            format: state.format,
            proxiesOnly: state.proxiesOnly,
            destination: destination,
            plan: renderPlan,
            locators: locators,
            mediaDirectory: store.mediaDirectory
        )
        let run = RollExportRun(input: input, state: state, store: store, editor: self)
        run.start()
    }

    /// Cancel the running export: between two pictures.
    func cancelExport() {
        exportRun.cancel()
    }

    // MARK: - what the file says

    /// Who signs the files — the identity kept with the preset book.
    var deliveryIdentity: DeliveryIdentity { presets.book.identity ?? emptyIdentity }

    /// Which groups leave (`RollExport.metadata`, absent = All).
    var metaChoice: MetaChoice { readMetaChoice(exportSettings.metadata) }

    func setMetaChoice(_ choice: MetaChoice) {
        setExport { $0.metadata = choice.json }
    }

    /// The roll's watermark style (`RollExport.watermark`, absent = the default).
    var watermarkStyle: Watermark { readWatermark(exportSettings.watermark) }

    func setWatermark(_ mark: Watermark) {
        setExport { $0.watermark = mark.json }
    }

    /// The open picture's words — one undo step per field left, none when nothing changed.
    func setWords(title: String? = nil, caption: String? = nil) {
        guard let id = openId else { return }
        update { setPictureWords($0, id, title: title, caption: caption) }
    }

    /// The year the open picture was TAKEN, else this one.
    var openCaptureYear: Int {
        let now = Calendar.current.component(.year, from: Date())
        guard let id = openId else { return now }
        return captureYear(pool.exif[id]?.dateTimeOriginal, now)
    }
}
