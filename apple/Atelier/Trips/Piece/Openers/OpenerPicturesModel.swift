// What the opener's picture chooser offers and what the author ticked — the
// state half of the web's `HookPicturesModal.tsx` (its `useLibraryCandidates`,
// `useScopeRows`, the pool, the exclusions, the hand-added files, confirm).
// The rules themselves are the kernel's (`Roadtrip/Hooks/PicturePool.swift`):
// this model reads the Library and the instance, and asks the kernel.
//
// Rules kept (`roadtrip.md`, «Défilé flashes SOURCE pictures», «The chooser
// takes files from the computer too», «The chooser's dates reach the WHOLE
// trip»):
// - What is offered is what was SHOT in the span, wherever it is kept: the
//   Library's photographs, dated from their EXIF (read from each file's head,
//   four at a time, once per file for the session), and what the connected
//   instance holds for those days, asked once per span. One picture in both
//   is offered once, from the Library (`mergePool`).
// - Photos only: a clip would mean downloading the clip, a picked clip is a
//   promise the sweep cannot keep — none is offered, and the count says so.
// - The dates reach the whole trip (`tripSpan`); the chooser OPENS on the
//   days the variant reads (`defaultSpan`). A picture the opener will not use
//   (shot after the piece, for one that tells the trip up to it) is marked,
//   never hidden (`laterLeftOff`).
// - Everything in the span starts TICKED — unless the variant already held a
//   list, and then only what it names, for the span the chooser opened on: a
//   span the author widens is new ground, taken whole (`initialExclusions`).
// - A file added from this device is CHOSEN, not found: the span never hides
//   it, it arrives ticked whatever the held list says, and it joins the
//   Library, where every other surface resolves a picture from.
// - Nothing is fetched to choose: an instance's tiles are its thumbnails; a
//   picture's bytes are fetched only when the opener draws it.
// - A kept Library picture carries its content hash, which is what finds it
//   again once renamed or re-exported.

import Foundation
import Observation
import PhotosUI
import SwiftUI
import AtelierKit

/// One picture on offer, and what draws its tile and finds its bytes.
struct OpenerCandidate: PoolCandidateCarrying, Identifiable {
    enum Source {
        /// A Library photograph: its asset (for the cover), where its bytes
        /// are, and its file identity (what "added by hand" is keyed by).
        case library(assetId: String, location: LibraryLocation?, identity: String)
        /// A row of the connected instance, on the host it came from.
        case instance(WinnowAssetRow, host: String)
    }

    let candidate: PoolCandidate
    let source: Source
    var id: String { candidate.key }
}

@MainActor
@Observable
final class OpenerPicturesModel {
    /// The calendar, the piece's day and the legs — what the spans are made of.
    let calendar: [HookDay]
    let date: IsoDate
    let stages: [HookStage]
    /// What the variant holds now; ticked on open.
    let selected: [HookPickedPicture]
    let choice: HookPictureChoice
    @ObservationIgnored let library: LibraryStore
    @ObservationIgnored let connections: ConnectionStore

    private(set) var span: DateSpan?
    /// Nil while asking; `[]` for a span the instance holds nothing on.
    private(set) var rows: [WinnowAssetRow]?
    private(set) var problem: RowsProblem?
    /// Unticked, by candidate key.
    private(set) var excluded: Set<String> = []
    /// Files added from this device while the sheet is open, by file identity.
    private(set) var added: Set<String> = []
    private(set) var pool: [OpenerCandidate] = []
    /// Library photographs whose day is still being read.
    private(set) var reading = 0
    var adding = false
    private(set) var busy = false
    /// The candidate looked at large, by its place in the pool.
    var looking: Int?
    /// Bumped to ask the instance again.
    private(set) var generation = 0

    @ObservationIgnored private var seen: Set<String> = []
    @ObservationIgnored private var openingSpan = true

    /// Each Library file's capture day and position, read once per file for
    /// the whole session: reopening the chooser must not re-read a hundred heads.
    private static var captures: [String: (date: IsoDate?, coords: GeoPoint?)] = [:]

    init(ctx: HookContext, request: OpenerPicturesRequest, library: LibraryStore, connections: ConnectionStore) {
        calendar = ctx.calendar ?? []
        date = ctx.date
        stages = ctx.stages ?? []
        selected = request.selected
        choice = request.choice
        self.library = library
        self.connections = connections
        span = defaultSpan(calendar, date, request.selected, includeThisDay: request.choice.includeThisDay)
        recompute()
    }

    // MARK: - what is around the grid

    /// How far the dates may be moved: the whole trip — nil for a piece dated
    /// outside it.
    var bounds: DateSpan? {
        calendar.contains { $0.date == date } ? tripSpan(calendar) : nil
    }

    var quick: [QuickSpan] { quickSpans(calendar, date, stages) }

    var connection: WinnowConnection? { connections.first }
    var client: WinnowClient? { connections.firstClient }

    /// Where the pictures are looked for, in words.
    var whereWords: String {
        connection.map { "the Library or on \($0.id)" } ?? "the Library"
    }

    var loading: Bool { reading > 0 || (connection != nil && rows == nil) }

    var clipsLeftOut: Int { rows?.filter { $0.mediaType == .video }.count ?? 0 }

    var ticked: [OpenerCandidate] { pool.filter { !excluded.contains($0.id) } }

    /// Shot after the piece's day, for an opener that will not use it.
    func leftOff(_ day: IsoDate) -> Bool {
        laterLeftOff(day, date, choice.keepsLater)
    }

    var groups: [PoolDayGroup<OpenerCandidate>] { groupByDay(pool, calendar) }

    // MARK: - the pool

    /// The pool, again: the Library's dated photographs and the instance's,
    /// once each, inside the span — plus what was added by hand.
    func recompute() {
        let library = libraryCandidates()
        reading = library.reading
        let merged = mergePool(library.items, instanceCandidates())
        let inside = span.map { inSpan(merged, $0) } ?? []
        var next = inside
        if !added.isEmpty {
            let keys = Set(inside.map(\.id))
            let byHand = merged.filter { isAdded($0) && !keys.contains($0.id) }
            // Kept in the pool's own order, so the grid does not jump when a
            // date finally reads and a hand-added picture joins its own day.
            next = sortPool(inside + byHand)
        }
        pool = next
        absorb(next)
    }

    /// Every candidate is decided the first time it is SEEN: taken, unless the
    /// variant already held a list that does not name it — and only for the
    /// span the chooser opened on.
    private func absorb(_ pool: [OpenerCandidate]) {
        let fresh = pool.filter { !seen.contains($0.id) }
        guard !fresh.isEmpty else { return }
        for c in fresh { seen.insert(c.id) }
        guard openingSpan, !selected.isEmpty else { return }
        // A picture added from this device arrives TICKED whatever the held
        // list says: it is what the author has just gone and fetched.
        let found = fresh.filter { !isAdded($0) }
        let skip = initialExclusions(found, selected)
        if !skip.isEmpty { excluded.formUnion(skip) }
    }

    private func isAdded(_ c: OpenerCandidate) -> Bool {
        if case .library(_, _, let identity) = c.source { return added.contains(identity) }
        return false
    }

    /// The Library's photographs with the day each was shot, and how many are
    /// still being read. A RAW is left out: this grid is photographs only.
    private func libraryCandidates() -> (items: [OpenerCandidate], reading: Int) {
        var items: [OpenerCandidate] = []
        var reading = 0
        for asset in library.assets {
            guard let image = asset.parts.image, !isRawImage(image.name) else { continue }
            let entry = library.entry(for: image)
            let ref = entry?.ref ?? image
            let identity = fileIdentity(ref)
            guard let capture = Self.captures[identity] else {
                reading += 1
                continue
            }
            guard let day = capture.date else { continue }
            let candidate = PoolCandidate(key: "lib:\(asset.id)", ref: ref, date: day, takenAt: ref.lastModified,
                                          coords: capture.coords, origin: .library)
            items.append(OpenerCandidate(candidate: candidate,
                                         source: .library(assetId: asset.id, location: entry?.location, identity: identity)))
        }
        return (items, reading)
    }

    private func instanceCandidates() -> [OpenerCandidate] {
        guard let host = connection?.id, let rows else { return [] }
        return rows.compactMap { rowCandidate($0, host: host) }
    }

    /// An instance's photograph, dated by its capture — its position the
    /// column the exposure elements already read.
    private func rowCandidate(_ row: WinnowAssetRow, host: String) -> OpenerCandidate? {
        guard row.mediaType == .photo else { return nil }
        let mtime = captureMtime(row, now: nowMillis())
        var dated = isoFromTimestamp(mtime)
        if let captured = row.captureDate {
            let day = String(captured.prefix(10))
            if parseIsoDate(day) != nil { dated = day }
        }
        guard let date = dated else { return nil }
        var coords: GeoPoint? = nil
        if let lat = row.gpsLat, let lon = row.gpsLon, lat.isFinite, lon.isFinite { coords = GeoPoint(lat: lat, lon: lon) }
        let ref = SavedMediaRef(name: row.filename, size: row.fileSize ?? 0, lastModified: mtime,
                                assetId: "\(host)/\(row.id)", hash: row.contentHash)
        let candidate = PoolCandidate(key: "win:\(host)/\(row.id)", ref: ref, date: date, takenAt: mtime,
                                      coords: coords, origin: .instance)
        return OpenerCandidate(candidate: candidate, source: .instance(row, host: host))
    }

    // MARK: - reading the Library's dates

    /// The Library's photographs not dated yet, read four heads at a time,
    /// the grid filling as each batch lands.
    func readDates() async {
        var unread: [(identity: String, ref: SavedMediaRef, location: LibraryLocation?)] = []
        for asset in library.assets {
            guard let image = asset.parts.image, !isRawImage(image.name) else { continue }
            let entry = library.entry(for: image)
            let ref = entry?.ref ?? image
            let identity = fileIdentity(ref)
            if Self.captures[identity] == nil { unread.append((identity, ref, entry?.location)) }
        }
        var start = 0
        while start < unread.count {
            if Task.isCancelled { return }
            let batch = Array(unread[start..<min(start + 4, unread.count)])
            start += 4
            let read = await withTaskGroup(of: (String, Capture).self, returning: [(String, Capture)].self) { group in
                for item in batch {
                    let ref = item.ref
                    let location = item.location
                    let identity = item.identity
                    group.addTask { (identity, OpenerPicturesModel.capture(ref, location)) }
                }
                var out: [(String, Capture)] = []
                for await one in group { out.append(one) }
                return out
            }
            for (identity, capture) in read {
                Self.captures[identity] = (capture.date?.date, capture.coords)
            }
            recompute()
        }
    }

    /// The day and the position one file's head says — off the main actor.
    nonisolated private static func capture(_ ref: SavedMediaRef, _ location: LibraryLocation?) -> Capture {
        let head = location.flatMap { LibraryFiles.head($0, count: exifSliceBytes) }.map { Data($0) }
        return readCapture(ref, head: head)
    }

    // MARK: - asking the instance

    /// What decides the instance's answer — a `.task(id:)` re-asks when it moves.
    var rowsKey: String {
        guard let host = connection?.id, let span else { return "off" }
        return "\(host)|\(span.from)|\(span.to)|\(generation)"
    }

    /// The instance's media for the span. Forgets the last answer first, so a
    /// new span never shows the previous one's pictures.
    func loadRows() async {
        rows = nil
        problem = nil
        recompute()
        guard let span, let client, let host = connection?.id else { return }
        do {
            let all = try await client.allAssets(AssetQuery(dateFrom: span.from, dateTo: span.to), cap: 400)
            if Task.isCancelled { return }
            rows = all
        } catch is CancellationError {
            return
        } catch {
            if Task.isCancelled { return }
            rows = []
            if let winnow = error as? WinnowError, winnow.kind == .unauthenticated {
                problem = RowsProblem(text: "Not signed in to \(host).", login: client.loginUrl())
            } else {
                let said = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
                problem = RowsProblem(text: deviceWords(said), login: nil)
            }
        }
        recompute()
    }

    /// Ask again — after a sign-in, say.
    func reload() {
        generation += 1
    }

    // MARK: - the author's gestures

    /// A span picked by hand is new ground, taken whole.
    func changeSpan(_ next: DateSpan) {
        openingSpan = false
        span = next
        recompute()
    }

    /// Moving one end past the other drags the other along.
    func setFrom(_ iso: IsoDate) {
        guard let span, iso != span.from else { return }
        changeSpan(DateSpan(from: iso, to: span.to < iso ? iso : span.to))
    }

    func setTo(_ iso: IsoDate) {
        guard let span, iso != span.to else { return }
        changeSpan(DateSpan(from: span.from > iso ? iso : span.from, to: iso))
    }

    /// Tick (`on`) or untick every key.
    func toggle(_ keys: [String], on: Bool) {
        if on { excluded.subtract(keys) } else { excluded.formUnion(keys) }
    }

    func isOn(_ key: String) -> Bool { !excluded.contains(key) }

    /// Photographs picked in Files or the Finder. A clip or a RAW is refused
    /// rather than added invisibly: this grid is photographs only.
    func addFiles(_ urls: [URL]) {
        let photos = urls.filter { url in
            let name = url.lastPathComponent
            return classifyPart(name) == .image && !isRawImage(name)
        }
        guard !photos.isEmpty else { return }
        var named: Set<String> = []
        for url in photos {
            let scoped = url.startAccessingSecurityScopedResource()
            named.insert(fileIdentity(RollStore.mediaRef(of: url)))
            if scoped { url.stopAccessingSecurityScopedResource() }
        }
        let before = identities
        library.add(urls: photos)
        added.formUnion(named)
        added.formUnion(identities.subtracting(before))
        recompute()
    }

    /// Photographs picked in Photos — copied for the session by the Library.
    func addPhotos(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        adding = true
        defer { adding = false }
        let before = identities
        await library.add(photos: items)
        let fresh = library.entries.filter { entry in
            let name = entry.ref.name
            return !before.contains(fileIdentity(entry.ref)) && classifyPart(name) == .image && !isRawImage(name)
        }
        added.formUnion(fresh.map { fileIdentity($0.ref) })
        recompute()
    }

    private var identities: Set<String> {
        Set(library.entries.map { fileIdentity($0.ref) })
    }

    /// The ticked pictures, as the variant stores them: a Library file with
    /// its content hash (read now for a file that has none yet), an
    /// instance's under its own id and the original's hash.
    func confirm() async -> [HookPickedPicture] {
        busy = true
        defer { busy = false }
        var out: [HookPickedPicture] = []
        for c in ticked {
            var ref = c.candidate.ref
            if case .library(_, let location, _) = c.source, ref.assetId == nil, ref.hash == nil {
                if let fresh = library.entry(for: ref)?.ref, fresh.hash != nil {
                    ref = fresh
                } else if let location {
                    ref.hash = await Task.detached(priority: .userInitiated) { try? LibraryFiles.hash(location) }.value
                }
            }
            out.append(HookPickedPicture(ref: ref, date: c.candidate.date, takenAt: c.candidate.takenAt,
                                         coords: c.candidate.coords))
        }
        return out
    }
}
