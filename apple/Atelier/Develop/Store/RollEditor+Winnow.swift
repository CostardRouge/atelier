// What an open roll reads from a Winnow — the web's `use-roll-media.ts` (a roll
// FINDS its own pictures) and `use-roll-culling.ts` (Winnow's picks, READ),
// plus the two ways a picture of an instance gets onto the roll from inside
// it: a day of the instance (`WinnowDaySheet`), and the Library's ticks.
//
// Rules kept (`develop-media.md`, `develop-roll.md`, `architecture.md`):
//
// - **The roll fetches its own pictures, never into the Library** (the
//   maintainer's Q1): an instance's picture is fetched from its ref's own
//   asset id (`materialize`, the PROXY, vouched for with the original's hash,
//   its origin and Winnow's EXIF) into a pool of the roll's — a file under the
//   session's temporary folder, never a locator, never kept past the sitting.
//   The Library's own copy of it is used first, while the Library holds one.
// - **Only what is near** (Q3): the open picture, then its neighbours, one
//   request at a time, nearest first; what drifts out of the keep window is
//   let go. Only a CONNECTED instance, only while the roll is open.
// - **A failure is kept per picture and said once**; nothing retries on its
//   own — "Try again" asks again. A cancel from the task's pill is a failure
//   too, so the next step does not fetch it straight back.
// - Each fetch is a TASK named as the Library names it, scoped to the picture
//   (the stage's hairline and the filmstrip cell's), with a Cancel.
// - **Culling is Winnow's** (item 33): the rows the roll's refs name are asked
//   in chunks of two hundred, when the pictures change and when the app comes
//   back after a minute; never stored on the roll, never written. The filter
//   is this sitting's, and ←/→ step over what it hides.
// - The roll PUBLISHES the day it is on (`MediaScope`), so the Library's
//   instance tab lists that day's pictures beside the stage — the open
//   picture's day, the roll's own span shaded around it. A click there shows
//   the picture large (`browse`); the `Develop` verb puts it on the roll.

import Foundation
import Observation
import AtelierKit

/// A still's proxy the roll fetched, and what its source vouched for.
struct FetchedStill {
    let url: URL
    let identity: WinnowIdentity
    /// Written by the roll (deleted when let go) — false for the Library's own copy.
    var owned = true
}

@MainActor
@Observable
final class RollWinnow {
    // MARK: wiring

    @ObservationIgnored weak var connections: ConnectionStore?
    @ObservationIgnored weak var library: LibraryStore?
    /// The shell's way to Sources — the status line's link.
    @ObservationIgnored var toSources: () -> Void = {}

    // MARK: the roll's own pool

    /// Pictures being fetched right now.
    private(set) var fetching: Set<String> = []
    /// What each instance answered badly, per picture — said once, kept until "Try again".
    fileprivate(set) var failures: [String: PictureAvailability] = [:]
    /// What the source vouched for each picture in hand from it — its origin,
    /// where its original is, the EXIF Winnow parsed.
    fileprivate(set) var vouched: [String: WinnowIdentity] = [:]
    /// Files this roll wrote (the Library's own copies are never deleted here).
    @ObservationIgnored fileprivate var owned: Set<URL> = []
    @ObservationIgnored fileprivate var inflight: [String: Task<FetchedStill?, Never>] = [:]
    @ObservationIgnored fileprivate var queueGeneration = 0

    // MARK: culling

    /// Winnow's word on each picture it answered for, by picture id.
    fileprivate(set) var culling: [String: Culling] = [:]
    /// Whether any picture of the roll could have an answer at all.
    fileprivate(set) var cullReachable = false
    fileprivate(set) var cullAsking = false
    /// Why the last ask failed, said once; nil when it did not.
    fileprivate(set) var cullProblem: String?
    /// What the strip shows, on Winnow's word — this sitting's, never the roll's.
    var cullFilter: CullFilter = .all
    @ObservationIgnored fileprivate var cullRun = 0
    /// What each instance said, for the session, keyed `host/id` — every roll
    /// reads it, so a second roll from the same day asks nothing it was just told.
    fileprivate static var kept: [String: KeptCulling] = [:]

    init() {}

    fileprivate func setFetching(_ id: String, _ on: Bool) {
        if on { fetching.insert(id) } else { fetching.remove(id) }
    }

    fileprivate func setAsking(_ on: Bool) {
        cullAsking = on
    }

    // MARK: the session folder

    /// Where the roll's fetched files live — a temporary folder, emptied of
    /// what the last session left the first time a roll fetches.
    static let sessionFolder: URL = {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("Atelier-Rolls", isDirectory: true)
        try? FileManager.default.removeItem(at: base)
        return base.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }()

    /// A still's editing rendition fetched from the instance `ref` names — the
    /// proxy, as a task scoped to `scope` — and written under the session
    /// folder. Nil when no connected instance holds it any more; throws what
    /// the instance answered (a cancel is `CancellationError`).
    static func fetchStill(_ ref: SavedMediaRef, connections: ConnectionStore, scope: String?) async throws -> FetchedStill? {
        guard let split = splitAssetId(ref.assetId), let conn = connections.connection(split.host) else { return nil }
        let client = connections.client(for: conn)
        guard let row = try await client.asset(split.id) else { return nil }
        let host = conn.id
        let files = try await TaskCenter.tracked(materializeTaskLabel(row, .proxy), scope: scope) {
            try await materialize(client, host, row, fidelity: .proxy, now: nowMillis())
        }
        guard let still = files.first(where: { !$0.file.name.lowercased().hasSuffix(".srt") }) else { return nil }
        let folder = sessionFolder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let url = folder.appendingPathComponent(RollStore.safeFileName(still.file.name))
        let data = still.file.data
        try await Task.detached(priority: .userInitiated) {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
        }.value
        return FetchedStill(url: url, identity: still.identity)
    }

    /// Delete fetched files this roll wrote.
    fileprivate func discard(_ urls: [URL]) {
        for url in urls where owned.contains(url) {
            owned.remove(url)
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
    }
}

extension RollEditor {
    // MARK: - wiring

    /// Hand the roll the app's connections and Library — the editor's view does
    /// it once, as it opens the roll.
    func attachWinnow(connections: ConnectionStore, library: LibraryStore, toSources: @escaping () -> Void) {
        winnow.connections = connections
        winnow.library = library
        winnow.toSources = toSources
    }

    /// Whether this device is connected to `host`.
    fileprivate func isConnected(_ host: String) -> Bool {
        winnow.connections?.connection(host) != nil
    }

    // MARK: - where each picture's bytes stand

    /// The store's word (in hand, a file of this device), else the roll's own
    /// fetch: being fetched, what the instance answered, waiting its turn, on
    /// an instance this device is not connected to.
    func winnowAvailability(_ p: RollPicture) -> PictureAvailability {
        let base = store.availability(rollId, p)
        if base == .ready || winnow.connections == nil { return base }
        let said = rollAvailability([p], inHand: [], fetching: winnow.fetching, failures: winnow.failures,
                                    connected: { self.isConnected($0) })
        return said[p.id] ?? base
    }

    /// What decides the queue — a view re-asks when it moves.
    var fetchKey: String {
        let refs = pictures.map { "\($0.id):\($0.ref.assetId ?? "")" }.joined(separator: "|")
        let hosts = winnow.connections?.connections.map(\.id).joined(separator: ",") ?? ""
        return "\(openId ?? "")#\(refs)#\(hosts)"
    }

    /// Fetch what is near the open picture, one at a time, nearest first, and
    /// let go of what has drifted away.
    func fetchNear() {
        guard winnow.connections != nil else { return }
        let ids = pictures.map(\.id)
        let mates = rollMates(pictures)
        let window = keepWindow(ids, openId)
        let held = Array((store.sessionFiles[rollId] ?? [:]).keys)
        let far = held.filter { !keptNearOpen($0, window, mates) }
        if !far.isEmpty { release(far) }
        // A variant draws from its twin's bytes.
        for (id, others) in mates where store.bytesSource(rollId, id) == nil {
            guard let twin = others.first(where: { store.sessionFile(rollId, $0) != nil }),
                  let url = store.sessionFile(rollId, twin) else { continue }
            store.holdSession(rollId, [id], url)
            winnow.vouched[id] = winnow.vouched[twin]
        }
        let queue = rollFetchQueue(ids, openId, inHand: { self.store.bytesSource(self.rollId, $0) != nil },
                                   mates: mates, failed: Set(winnow.failures.keys))
        winnow.queueGeneration += 1
        let generation = winnow.queueGeneration
        guard !queue.isEmpty else { return }
        Task { @MainActor [weak self] in
            for id in queue {
                guard let self, self.winnow.queueGeneration == generation else { return }
                guard let picture = self.pictures.first(where: { $0.id == id }) else { continue }
                _ = await self.fetchPicture(picture, keep: true)
            }
        }
    }

    /// One picture's bytes from its instance — the Library's copy first. With
    /// `keep`, held for the roll while it is near the open picture; without
    /// (an export far from it), handed back and never kept.
    @discardableResult
    func fetchPicture(_ picture: RollPicture, keep: Bool) async -> FetchedStill? {
        let mates = rollMates(pictures)[picture.id] ?? []
        let family = [picture.id] + mates
        // A variant whose twin is on its way waits for that one fetch.
        if let running = family.lazy.compactMap({ self.winnow.inflight[$0] }).first {
            return await running.value
        }
        guard let connections = winnow.connections,
              let sourceId = resolvableSourceOf(picture.ref, connected: { self.isConnected($0) }) else { return nil }
        if let copy = libraryCopy(picture.ref) {
            if keep { hold(copy, for: family) }
            return copy
        }
        winnow.setFetching(picture.id, true)
        let ref = picture.ref
        let scope = picture.id
        let task = Task { @MainActor [weak self] () -> FetchedStill? in
            do {
                guard let fetched = try await RollWinnow.fetchStill(ref, connections: connections, scope: scope) else {
                    self?.winnow.failures[picture.id] = .gone(sourceId: sourceId)
                    return nil
                }
                return fetched
            } catch is CancellationError {
                self?.winnow.failures[picture.id] = .failed(sourceId: sourceId, problem: "the fetch was cancelled")
                return nil
            } catch {
                let unauthenticated = (error as? WinnowError)?.kind == .unauthenticated
                let said = deviceWords((error as? LocalizedError)?.errorDescription ?? String(describing: error))
                self?.winnow.failures[picture.id] = fetchFailure(sourceId, unauthenticated: unauthenticated, message: said)
                return nil
            }
        }
        for id in family { winnow.inflight[id] = task }
        let fetched = await task.value
        for id in family { winnow.inflight[id] = nil }
        winnow.setFetching(picture.id, false)
        guard let fetched else { return nil }
        // Kept only when it is still near the open picture once it lands.
        let window = keepWindow(pictures.map(\.id), openId)
        if keep && keptNearOpen(picture.id, window, rollMates(pictures)) {
            winnow.owned.insert(fetched.url)
            hold(fetched, for: family)
        } else if keep {
            winnow.owned.insert(fetched.url)
            winnow.discard([fetched.url])
        }
        return fetched
    }

    /// The Library's own session copy of an instance's picture, with what it
    /// was vouched for with — nothing fetched twice while the Library holds it.
    private func libraryCopy(_ ref: SavedMediaRef) -> FetchedStill? {
        guard let library = winnow.library,
              let entry = library.entries.first(where: { sameMediaRef($0.ref, ref) }),
              case .session(let path) = entry.location,
              let assetId = entry.ref.assetId else { return nil }
        let identity = WinnowIdentity(assetId: assetId, hash: entry.ref.hash, origin: entry.origin, exif: entry.exif,
                                      originalUrl: entry.originalUrl)
        return FetchedStill(url: URL(fileURLWithPath: path), identity: identity, owned: false)
    }

    /// A fetched file in hand for a picture and its variants: the stage and
    /// the strip read it at once.
    private func hold(_ fetched: FetchedStill, for family: [String]) {
        store.holdSession(rollId, family, fetched.url)
        for id in family {
            winnow.vouched[id] = fetched.identity
            winnow.failures[id] = nil
        }
        pool.retry(family)
        if let open = openId, family.contains(open) {
            requestRender()
        } else if let picture = pictures.first(where: { family.contains($0.id) }) {
            pool.requestThumbnail(rollId, picture)
        }
    }

    /// Let go of pictures' fetched files.
    private func release(_ ids: [String]) {
        let gone = store.releaseSession(rollId, ids)
        for id in ids { winnow.vouched[id] = nil }
        winnow.discard(gone)
    }

    /// Everything fetched for this sitting let go — the editor closed.
    func releaseWinnow() {
        winnow.queueGeneration += 1
        winnow.cullRun += 1
        let all = store.releaseAllSession(rollId)
        winnow.vouched = [:]
        winnow.discard(all)
    }

    /// Ask again for every picture whose instance answered badly.
    func retryFailed() {
        winnow.failures = [:]
        fetchNear()
    }

    /// What the source vouched for a picture in hand from it, if it is one.
    func vouched(_ p: RollPicture) -> WinnowIdentity? {
        winnow.vouched[p.id]
    }

    /// The instance's own thumbnail for a picture whose bytes are not in hand
    /// — a strip that shows every picture before any is fetched. Nil for a
    /// picture no connected instance holds.
    func remoteThumb(_ p: RollPicture) -> (client: WinnowClient, id: Int)? {
        guard let connections = winnow.connections, let split = splitAssetId(p.ref.assetId),
              let conn = connections.connection(split.host) else { return nil }
        return (client: connections.client(for: conn), id: split.id)
    }

    // MARK: - culling, read

    /// What the roll asks about — keyed on the refs alone, so an edit asks nothing.
    var cullKey: String {
        let refs = pictures.map { $0.ref.assetId ?? "" }.joined(separator: "|")
        let hosts = winnow.connections?.connections.map(\.id).joined(separator: ",") ?? ""
        return "\(refs)#\(hosts)"
    }

    /// Ask each connected instance for what is older than `maxAge` — one list
    /// request per two hundred pictures. `0` asks everything again (Refresh).
    func askCulling(maxAge: Double) async {
        guard let connections = winnow.connections else { return }
        let wanted = cullingWanted(pictures, connected: { self.isConnected($0) })
        winnow.cullReachable = !wanted.isEmpty
        refreshCulling()
        let now = nowMillis()
        var jobs: [(host: String, client: WinnowClient, ids: [Int])] = []
        for w in wanted {
            let stale = staleCullIds(w.host, w.ids, kept: RollWinnow.kept, now: now, maxAge: maxAge)
            guard !stale.isEmpty, let conn = connections.connection(w.host) else { continue }
            jobs.append((host: w.host, client: connections.client(for: conn), ids: stale))
        }
        guard !jobs.isEmpty else { return }
        winnow.cullRun += 1
        let run = winnow.cullRun
        winnow.setAsking(true)
        var failed: String?
        outer: for job in jobs {
            for chunk in cullChunks(job.ids) {
                do {
                    let rows = try await job.client.assetsByIds(chunk)
                    let answer = keptAfterAnswer(job.host, asked: chunk, rows: rows, at: nowMillis())
                    RollWinnow.kept.merge(answer) { _, new in new }
                } catch {
                    let unauthenticated = (error as? WinnowError)?.kind == .unauthenticated
                    failed = unauthenticated ? "not signed in to \(job.host)" : "\(job.host) did not answer"
                    continue outer
                }
            }
        }
        guard run == winnow.cullRun else { return }
        winnow.setAsking(false)
        winnow.cullProblem = failed
        refreshCulling()
    }

    /// Winnow's word on each picture, from what the session was told.
    func refreshCulling() {
        let next = cullingByPicture(pictures, kept: RollWinnow.kept)
        if next != winnow.culling { winnow.culling = next }
    }

    /// The filter is on, and there is something for it to read.
    var cullFiltering: Bool {
        winnow.cullReachable && winnow.cullFilter != .all
    }

    /// Whether the strip shows `p` under the filter — every picture when none is on.
    func shownByCull(_ p: RollPicture) -> Bool {
        !cullFiltering || passesCull(winnow.culling[p.id], winnow.cullFilter)
    }

    /// Winnow's word on the roll, for the status line.
    var cullCounts: CullCounts {
        countCulling(pictures.map { winnow.culling[$0.id] })
    }

    // MARK: - pictures of an instance, onto the roll

    /// The instance a day can be picked on — the FIRST connection, as every
    /// media surface takes it.
    var dayHost: String? { winnow.connections?.first?.id }

    /// Refs picked from an instance's day: onto the roll — one undo step — and
    /// the bytes follow when each is looked at.
    func addDay(_ refs: [SavedMediaRef], from sourceId: String) {
        guard let before = roll?.pictures.count else { return }
        update { addPictures($0, refs) }
        let added = (roll?.pictures.count ?? before) - before
        notice = "added \(added) from \(sourceId)"
        if openId == nil { open(pictures.first?.id) }
    }

    /// The photographs ticked in the Library that the roll does not hold yet —
    /// what "Add N from the Library" adds.
    var tickedToAdd: [DroppedAsset] {
        guard let library = winnow.library else { return [] }
        let held = pictures.map(\.ref)
        return library.assets
            .filter { library.selection.contains($0.id) && $0.kind == .photo && $0.parts.image != nil }
            .compactMap { library.dropped($0) }
            .filter { d in !held.contains { sameMediaRef($0, d.ref) } }
    }

    /// The Library's ticked photographs onto the roll, found again or added.
    func addTicked() {
        let incoming = tickedToAdd
        guard !incoming.isEmpty else { return }
        var added = 0
        var already = 0
        var failed = 0
        for dropped in incoming {
            switch store.add(dropped, to: rollId) {
            case .added: added += 1
            case .found, .already: already += 1
            case .failed: failed += 1
            }
        }
        adoptStoreChange()
        pool.retry(pictures.map(\.id))
        if added == 0 {
            notice = "already on the roll: \(already == 1 ? "that picture" : "all \(already)")"
        } else {
            notice = "added \(added)\(already > 0 ? " · \(already) already on the roll" : "")\(failed > 0 ? " · \(failed) could not be read" : "")"
        }
        requestRender()
    }

    // MARK: - the span the roll is on

    /// The open picture's day, for the Library's instance tab — the roll's own
    /// span shaded around it. Nothing while the roll holds no picture.
    var mediaScope: MediaScope? {
        guard let open = picture else { return nil }
        let day = AtelierKit.pictureDay(open.ref.lastModified)
        let days = pictures.map { AtelierKit.pictureDay($0.ref.lastModified) }.sorted()
        var within: ScopeWithin?
        if let first = days.first, let last = days.last, first != last {
            within = ScopeWithin(from: first, to: last, label: roll?.name ?? "this roll")
        }
        return MediaScope(from: day, to: day, label: formatIsoDate(day), publisher: "Develop", intent: .browse,
                          within: within)
    }
}
