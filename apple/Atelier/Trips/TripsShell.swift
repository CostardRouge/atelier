// The Trips tool's shell — the native twin of the web's `RoadTripTool.tsx`
// (the route, the banners, the verbs that open a trip) and of the gallery's
// document plumbing in `TripGallery.tsx` (create, import, export, cover,
// move, delete). The trip OPEN in the tool and its save machine are
// `TripsStore`'s; this holds where you are and the verbs that cross a source.
//
// Rules kept (`roadtrip.md`):
// - WHERE YOU ARE LIVES IN THE PATH (`TripsRoute`), not in a screen's state:
//   a piece is opened on top of its trip, so Back lands on the day you were
//   on. The overview's open day is kept here per trip, beside the path, so a
//   day change never replaces the screen it happens on.
// - A new trip wears the bundled HOUSE STYLE when this build carries one
//   (`readHouseStyle`); an import, a move or an existing trip never does.
// - A trip file always becomes a NEW trip, never an overwrite: importing the
//   same backup twice must not replace the trip told for months.
// - A cover picked from the gallery is a trip edit: the OPEN trip takes it
//   through the store's funnel (one undo step, saved and pushed like any
//   edit); another trip is written where it is KEPT first, then mirrored.
// - A delete of a trip kept on an instance happens there first and is
//   refused while it cannot be reached; the hooks go with the trip.
// - The trip being left is written and pushed before another opens or a new
//   one is made (`sync.flushAll`), so no debounce lands on the wrong trip.
// - Reading preferences are this device's, never the document's: Cards or
//   Bands (`atelier.roadtrip.gallery.view`) and the trip opened last
//   (`atelier.roadtrip.lastOpened`), the web's own keys.

import Foundation
import Observation
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

/// How the gallery lays its trips out — a reading preference of this device.
enum TripGalleryMode: String, CaseIterable {
    /// Each trip as a card with its cover — the default.
    case cards
    /// Progress rows under the band of the trip you were on.
    case bands
}

@MainActor
@Observable
final class TripsShell {
    /// The one shell, and with it the one `TripsStore`, for the whole app.
    static let shared = TripsShell(store: TripsStore(connections: ConnectionStore.shared),
                                   connections: ConnectionStore.shared)

    /// The web's `LAST_OPENED_KEY` and `VIEW_KEY`.
    static let lastOpenedKey = "atelier.roadtrip.lastOpened"
    static let viewKey = "atelier.roadtrip.gallery.view"

    let store: TripsStore
    /// The gallery's lists: the mirrors here beside every instance's.
    let gallery: DocumentGalleryModel<TripDoc>

    /// Where you are: empty is the gallery.
    var path: [TripsRoute] = []
    /// Cards or Bands, remembered on this device (`choose(_:)`).
    private(set) var mode: TripGalleryMode
    /// The trip this device opened last — the card's `last opened` tag.
    private(set) var lastOpenedId: String?
    /// A cover being written where its trip is kept, by trip id.
    private(set) var busy: [String: String] = [:]
    /// The sentence the timeline and deduce sheets leave when a trip's dates
    /// grew to hold a leg (the web's `spanNote`), until dismissed.
    var spanNote: String?

    /// The open day of each trip visited, written by its overview. A value
    /// of nil is kept (no day open) — distinct from a trip never visited.
    /// Observed: the overview reads its day through `dayBinding`.
    private var days: [String: String?] = [:]

    init(store: TripsStore, connections: ConnectionStore) {
        self.store = store
        gallery = DocumentGalleryModel(store: store.documents, connections: connections)
        let defaults = UserDefaults.standard
        mode = TripGalleryMode(rawValue: defaults.string(forKey: TripsShell.viewKey) ?? "") ?? .cards
        lastOpenedId = defaults.string(forKey: TripsShell.lastOpenedKey)
        // A trip deleted under the tool (the pill's "Delete here") takes its
        // screens with it; a trip REPLACED under it keeps the overview but
        // leaves a piece the new copy no longer holds.
        store.onDeleted = { [weak self] in self?.path = [] }
        store.onReplaced = { [weak self] doc in self?.leaveMissingPiece(doc) }
    }

    /// Cards or Bands, from now on and on this device.
    func choose(_ next: TripGalleryMode) {
        mode = next
        UserDefaults.standard.set(next.rawValue, forKey: TripsShell.viewKey)
    }

    // MARK: - where you are

    /// The overview's open day, as a binding: the route's day until the
    /// overview writes one, then what it wrote.
    func dayBinding(tripId: String, initial: String?) -> Binding<String?> {
        Binding(
            get: { self.days[tripId] ?? initial },
            set: { self.days.updateValue($0, forKey: tripId) }
        )
    }

    /// Open a piece of the trip on screen, from `day`: the day is kept, so
    /// Back lands on it.
    func openPiece(tripId: String, postId: String, day: String?) {
        days.updateValue(day, forKey: tripId)
        var next = path
        if let i = next.firstIndex(where: { if case .trip(let id, _) = $0 { return id == tripId } else { return false } }) {
            next = Array(next[...i])
        } else {
            next = [.trip(id: tripId, day: day)]
        }
        next.append(.piece(tripId: tripId, day: day, postId: postId))
        path = next
    }

    /// Back to the trips — the web's `onShowTrips`.
    func showTrips() {
        path = []
    }

    private func leaveMissingPiece(_ doc: TripDoc) {
        guard case .piece(let tripId, _, let postId)? = path.last, tripId == doc.id,
              !doc.posts.contains(where: { $0.id == postId }) else { return }
        path.removeLast()
    }

    // MARK: - opening

    /// Open a trip: the screen at once, the document behind it — the copy in
    /// memory when it is as new, and for a trip kept on an instance, whether
    /// it moved there (`TripsStore.openTrip`). Opening from the gallery starts
    /// on the trip's own default day, as the web's link without a date does.
    func open(_ doc: TripDoc) {
        remember(doc.id)
        days.removeValue(forKey: doc.id)
        path = [.trip(id: doc.id, day: nil)]
        // The trip already open is resumed as it is — its history and its
        // record stay, as the web's resume runs once per opened trip.
        if store.open?.id == doc.id { return }
        Task { await store.openTrip(doc) }
    }

    /// A trip kept there and not here yet: mirror it, then open it.
    func openRemote(_ row: RemoteDocRow<TripDoc>) {
        let doc = gallery.mirrorRemote(row)
        store.reload()
        open(doc)
    }

    private func remember(_ id: String) {
        lastOpenedId = id
        UserDefaults.standard.set(id, forKey: TripsShell.lastOpenedKey)
    }

    // MARK: - the gallery's lists

    /// The mirrors and every instance's list, read again.
    func refresh() async {
        await gallery.refresh()
        store.reload()
    }

    /// A trip as the tool holds it: the open copy — which may carry edits
    /// the debounce has not written yet — over the listed one.
    func current(_ doc: TripDoc) -> TripDoc {
        if let open = store.open, open.id == doc.id { return open }
        return doc
    }

    /// What a card is doing right now, or nil.
    func busyLine(_ id: String) -> String? {
        busy[id] ?? gallery.busy[id]
    }

    // MARK: - creating

    /// The house style this build ships: `roadtrip-house-style.json` in the
    /// bundle when there is one, else nil — the factory look. The web commits
    /// none today (`src/shared/roadtrip/house-style.json` is absent), so a
    /// new trip starts from the factory look here as there.
    static let houseStyle: TripHouseStyle? = {
        guard let url = Bundle.main.url(forResource: "roadtrip-house-style", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else { return nil }
        return readHouseStyle(JSONValue.parse(text))
    }()

    /// Make a trip from the creation sheet — written where it is KEPT first
    /// (a remote trip is pushed on creation; nothing is kept here if the
    /// instance refused, and the gallery says so) — and open it.
    func create(_ details: TripDetails) async {
        gallery.notice = nil
        let made = createTripDoc(details.name, details.startDate, details.endDate, sourceId: details.sourceId)
        let doc = applyHouseStyle(made, TripsShell.houseStyle)
        // The trip being left is written and pushed first: a debounced write
        // must not land after the new trip is open.
        await store.sync.flushAll()
        guard await gallery.createOn(doc, verb: "created") else { return }
        store.adoptCreated(doc)
        remember(doc.id)
        days.removeValue(forKey: doc.id)
        path = [.trip(id: doc.id, day: nil)]
    }

    // MARK: - the trip file

    /// The whole trip as a `.roadtrip.json` — a backup, and how it reaches
    /// another machine: the document minus its id, timestamps, source and
    /// every piece's Studio link (`toTripFile`), written by the kernel.
    func exportFile(_ doc: TripDoc) -> TripFileDocument {
        let trip = current(doc)
        return TripFileDocument(text: serializeTripFile(toTripFile(trip)), fileName: tripFileName(trip.name))
    }

    /// A trip file becomes a NEW trip on `targetSourceId` (this device when
    /// that source cannot hold one), named after the file when it carries no
    /// name. A file that is not one is said, never half-imported.
    func importFile(_ url: URL, to targetSourceId: String) async {
        gallery.notice = nil
        let scoped = url.startAccessingSecurityScopedResource()
        let data = try? Data(contentsOf: url)
        if scoped { url.stopAccessingSecurityScopedResource() }
        guard let data, let text = String(data: data, encoding: .utf8) else {
            gallery.notice = "That file is not valid JSON."
            return
        }
        switch parseTripFile(text) {
        case .failure(let error):
            gallery.notice = error.message
        case .success(let file):
            let sources = gallery.documentSources.map(\.id)
            let target = sources.contains(targetSourceId) ? targetSourceId : defaultSourceId
            var doc = tripDocFromFile(file, now: nowMillis(), sourceId: target)
            if doc.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                doc.name = TripsShell.nameFromFile(url.lastPathComponent)
            }
            if await gallery.createOn(doc, verb: "imported") {
                await refresh()
            }
        }
    }

    /// `ete-en-corse.roadtrip.json` → `ete-en-corse`; nothing left → `Imported trip`.
    static func nameFromFile(_ fileName: String) -> String {
        var stem = fileName
        let lower = stem.lowercased()
        if lower.hasSuffix(".roadtrip.json") {
            stem = String(stem.dropLast(".roadtrip.json".count))
        } else if lower.hasSuffix(".json") {
            stem = String(stem.dropLast(".json".count))
        }
        return stem.isEmpty ? "Imported trip" : stem
    }

    // MARK: - the cover

    /// A cover picked from the gallery. The open trip takes it through the
    /// funnel; another trip is written where it is kept first — refused, and
    /// said, when its instance cannot be reached or refuses it.
    func setCover(_ doc: TripDoc, _ cover: TripCover) async {
        gallery.notice = nil
        var next = current(doc)
        next.cover = cover
        next.updatedAt = nowMillis()
        if let open = store.open, open.id == next.id {
            store.change(next)
            return
        }
        if isRemoteSource(next.sourceId) {
            guard let remote = gallery.connections.remote(for: next.sourceId, kind: TripDoc.bucketKind) else {
                gallery.notice = "Connect \(next.sourceId) to change this cover — the trip is kept there."
                return
            }
            busy[next.id] = "saving on \(remote.label)…"
            let prior = store.documents.getSyncRecord(next.id)
            let record = await DocumentRemote<TripDoc>.pushNew(remote, next, prior, store: store.documents,
                                                                now: nowMillis(), clock: nowMillis)
            busy[next.id] = nil
            if record.status != .synced {
                // The cover is unchanged, so the record goes back as it was.
                if let prior { store.documents.putSyncRecord(prior) } else { store.documents.deleteSyncRecord(next.id) }
                let why = record.error.map { ": \($0)" } ?? ""
                gallery.notice = "Could not save to \(remote.label)\(why) — the cover is unchanged."
                return
            }
        }
        store.documents.put(next)
        await refresh()
    }

    // MARK: - moving and deleting

    /// Keep a trip on another source. The open trip is written and pushed
    /// first, and takes the moved copy afterwards (its pill now speaks for
    /// the new source). Its pictures never travel.
    func move(_ doc: TripDoc, to targetSourceId: String) async {
        let wasOpen = store.open?.id == doc.id
        if wasOpen { await store.sync.flushAll() }
        await gallery.moveTo(current(doc), targetSourceId)
        if wasOpen, let moved = store.documents.get(doc.id), moved.sourceId == targetSourceId {
            store.adoptCreated(moved)
        }
        store.reload()
    }

    /// Delete here, and there when the trip is kept on an instance — guarded
    /// by the revision this device holds, and refused while the instance
    /// cannot be reached. The hooks go with the trip.
    func delete(_ doc: TripDoc, etagHint: String? = nil) async {
        guard await gallery.remove(doc, etagHint: etagHint) else { return }
        store.deleteLocal(doc.id)
        if lastOpenedId == doc.id {
            lastOpenedId = nil
            UserDefaults.standard.removeObject(forKey: TripsShell.lastOpenedKey)
        }
        days.removeValue(forKey: doc.id)
        path.removeAll { route in
            switch route {
            case .trip(let id, _): return id == doc.id
            case .piece(let tripId, _, _): return tripId == doc.id
            }
        }
    }

    // MARK: - the timeline seed

    /// The connected Winnows the creation sheet may offer as a seed. Empty
    /// while the kernel's `timelineSyncEnabled` switch is off — the row goes
    /// rather than drawing greyed buttons for something that cannot light up.
    var seedSources: [TripSeedSource] {
        guard timelineSyncEnabled else { return [] }
        return gallery.connections.connections.map { TripSeedSource(id: $0.id, hasTimeline: hasTimeline($0.capabilities)) }
    }
}

/// A `.roadtrip.json` as the file exporter carries it — the kernel's bytes.
struct TripFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    static var writableContentTypes: [UTType] { [.json] }

    var text: String
    var fileName: String

    init(text: String, fileName: String) {
        self.text = text
        self.fileName = fileName
    }

    init(configuration: ReadConfiguration) throws {
        text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? ""
        fileName = configuration.file.filename ?? tripFileName("trip")
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
