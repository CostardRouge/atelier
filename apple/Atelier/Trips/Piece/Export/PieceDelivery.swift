// WHERE a piece's files go — the native half of the web's
// `pickDeliveryTarget` + `deliverFilesTo` as `use-post-exports.ts` calls them:
// the three exports (`TripPieceExport`) write into a fresh temporary folder,
// and this hands that set on, then lets the folder go (`discard()`).
//
// Two ways, a choice of THIS DEVICE and never of the document
// (`UserDefaults`, `atelier.trips.exportInto`):
// - **A folder** — picked AT THE CLICK, before a pixel is rendered: the verb
//   asks (`requestExport`), the Export tab's picker answers, the run starts
//   from the answer, and the files are written into that folder the moment it
//   ends — a file of the same name replaced, as the web's `{ replace: true }`.
//   Nothing times the click out here as Chrome does; the order is kept for
//   the person's sake: they say where before they wait.
// - **Share** — the run starts at once; when it ends its files are HELD and
//   the Export tab raised on them, with the share sheet one tap away (Photos,
//   AirDrop, Files, another app) and a Done that lets them go. The default on
//   an iPhone or an iPad, whose pieces leave for a phone's apps; a folder is
//   the Mac's.
//
// Every export goes through `requestExport` — the header's one word and the
// Export tab's escapes alike — so the choice holds wherever it was pressed.
// A run started around it (a future caller of `exportPiece()` directly) is
// not claimed and falls back to the workbench's own file mover.

import Foundation
import Observation
import AtelierKit

/// Where a piece's files go on this device.
enum PieceDeliveryInto: String, CaseIterable, Identifiable {
    case folder, share

    var id: String { rawValue }

    var title: String { self == .folder ? "A folder" : "Share" }

    /// A phone's pieces leave for a phone's apps; the Mac keeps a folder.
    static var deviceDefault: PieceDeliveryInto {
        #if os(iOS)
        return .share
        #else
        return .folder
        #endif
    }
}

/// One of the three exports, named so the picker's answer can start it.
enum PieceExportVerb: Equatable {
    /// Every slide in the format it is; `imagesOnly` the one override.
    case piece(imagesOnly: Bool)
    /// Every slide as a PNG.
    case deck
    /// The hook burned into a clip.
    case hookClip
}

@MainActor
@Observable
final class PieceDelivery {
    static let intoKey = "atelier.trips.exportInto"

    /// Where the files go — this device's choice.
    private(set) var into: PieceDeliveryInto
    /// A verb waiting for its folder: the Export tab's picker is up for it.
    private(set) var asking: PieceExportVerb?
    /// The last run's files are held for the share sheet.
    private(set) var holding = false
    /// The folder the files are being written into, while they are.
    private(set) var writing: String?
    /// The folder the last files landed in.
    private(set) var landed: String?
    /// What could not be written, one line each.
    private(set) var failures: [String] = []

    /// The verb the picker was opened for — kept past the dialog's dismissal,
    /// which SwiftUI may report before or after the pick itself.
    @ObservationIgnored private var askedFor: PieceExportVerb?
    /// Where the run in flight lands.
    @ObservationIgnored private var armed: Armed?

    private enum Armed {
        case folder(URL)
        case share
    }

    init(defaults: UserDefaults = .standard) {
        into = defaults.string(forKey: PieceDelivery.intoKey).flatMap(PieceDeliveryInto.init(rawValue:))
            ?? PieceDeliveryInto.deviceDefault
    }

    /// Change where the files go, and remember it on this device.
    func setInto(_ next: PieceDeliveryInto) {
        into = next
        UserDefaults.standard.set(next.rawValue, forKey: PieceDelivery.intoKey)
    }

    // MARK: - before the run

    /// A verb pressed with a folder to pick first.
    func ask(_ verb: PieceExportVerb) {
        clearLast()
        asking = verb
        askedFor = verb
    }

    /// The picker went away — picked or not.
    func askDismissed() {
        asking = nil
    }

    /// The verb the picked folder is for, taken once.
    func takeAsked() -> PieceExportVerb? {
        let verb = askedFor
        askedFor = nil
        asking = nil
        return verb
    }

    /// The picker itself failed — said, nothing run.
    func refused(_ error: Error) {
        asking = nil
        askedFor = nil
        failures = ["No folder could be chosen — \(error.localizedDescription)"]
    }

    func arm(folder: URL) {
        clearLast()
        armed = .folder(folder)
    }

    func armShare() {
        clearLast()
        armed = .share
    }

    /// The run did not start after all.
    func disarm() {
        armed = nil
    }

    private func clearLast() {
        landed = nil
        failures = []
        holding = false
    }

    // MARK: - after the run

    /// A run ended. True when this delivery took its files — written into the
    /// folder picked at the click, or held for the share sheet (`raise` then
    /// brings the Export tab up on them); false leaves them to the caller.
    func finish(_ exports: TripPieceExport, raise: () -> Void) -> Bool {
        if exports.running { return true }
        let armed = self.armed
        self.armed = nil
        let files = exports.delivered
        switch armed {
        case .folder(let folder)?:
            if !files.isEmpty { write(files, into: folder, exports: exports) }
            return true
        case .share?:
            hold(files, raise)
            return true
        case nil:
            guard into == .share else { return false }
            hold(files, raise)
            return true
        }
    }

    /// The share sheet is done with the files: the run's folder let go.
    func done(_ exports: TripPieceExport) {
        holding = false
        exports.discard()
    }

    private func hold(_ files: [TripDeliveredFile], _ raise: () -> Void) {
        holding = !files.isEmpty
        if holding { raise() }
    }

    private func write(_ files: [TripDeliveredFile], into folder: URL, exports: TripPieceExport) {
        let name = folder.lastPathComponent
        writing = name
        let items = files.map { (name: $0.name, url: $0.url) }
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                PieceDelivery.copy(items, into: folder)
            }.value
            exports.discard()
            guard let self else { return }
            self.writing = nil
            self.failures = result.failed
            self.landed = result.written > 0 ? name : nil
        }
    }

    /// Write each file into `folder` under its own name, replacing a file of
    /// that name — the web's `{ replace: true }`. Blocking: off the main actor.
    nonisolated static func copy(_ items: [(name: String, url: URL)],
                                 into folder: URL) -> (written: Int, failed: [String]) {
        let scoped = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        let manager = FileManager.default
        var written = 0
        var failed: [String] = []
        for item in items {
            let target = folder.appendingPathComponent(item.name)
            do {
                if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
                try manager.copyItem(at: item.url, to: target)
                written += 1
            } catch {
                failed.append("\(item.name): \(error.localizedDescription)")
            }
        }
        return (written, failed)
    }
}

// MARK: - the model's side

extension PieceEditorModel {
    /// An export pressed — the header's word or one of the Export tab's
    /// escapes. With a folder, the Export tab comes up and asks for it first;
    /// with the share sheet, the run starts now.
    func requestExport(_ verb: PieceExportVerb) {
        guard !exports.running, delivery.writing == nil else { return }
        switch delivery.into {
        case .share:
            delivery.armShare()
            runExport(verb)
        case .folder:
            tab = .export
            inspectorOpen = true
            delivery.ask(verb)
        }
    }

    /// The folder the Export tab's picker answered with: the run starts from it.
    func folderPicked(_ folder: URL) {
        guard let verb = delivery.takeAsked(), !exports.running else { return }
        delivery.arm(folder: folder)
        runExport(verb)
    }

    /// A run ended: its files go where the person said. True when the
    /// delivery took them; the workbench's file mover stands down.
    func handOnDelivered() -> Bool {
        delivery.finish(exports) { self.openTab(.export) }
    }

    private func runExport(_ verb: PieceExportVerb) {
        switch verb {
        case .piece(let imagesOnly): exportPiece(imagesOnly: imagesOnly)
        case .deck: exportDeck()
        case .hookClip: exportHookClip()
        }
        // No inputs (no Library in reach): nothing ran, nothing is waited for.
        if !exports.running { delivery.disarm() }
    }
}
