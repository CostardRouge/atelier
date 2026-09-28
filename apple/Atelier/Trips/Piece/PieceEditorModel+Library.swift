// The Library's tick and the open slide kept pointed at the same picture,
// BOTH ways — the web's `use-slide-library.ts` — plus a collage's other cells
// fetched back (`use-collage-refetch.ts`) and a picture dropped on a cell
// (`PostEditor`'s `dropAsset`).
//
// Rules kept (`roadtrip.md`, «The inspector, the Library and the develop
// sheet follow the SELECTED cell», «Every drawn cell is fetched back on
// opening», «A picture is DRAGGED…»):
// - Opening a slide (or a cell: the Library follows a shim keyed
//   `<slideKey>#<cell>`) ticks its picture; ticking another writes it onto
//   the slide; a picture that changed UNDER the tick (an undo, a cleared
//   cell, another cell) re-points the Library instead of being written back.
// - The restore runs once per picture of a slide, and the record-back is
//   gated on it having settled — or the first pass writes whatever happened
//   to be ticked over the slide's own choice.
// - An EMPTY cell takes only a picture ticked after it was selected
//   (`cellBaseline`); the ticked one goes in through "Use the ticked picture".
// - A picture missing from the pool that names a CONNECTED instance is
//   fetched back once when the slide opens — a collage fetches every cell,
//   three at a time, into the pool only — and a failure is said.
// - A drop WRITES before it selects: selecting a cell restarts the sync,
//   which would re-activate the cell's OLD picture and write it back.

import Foundation
import AtelierKit

/// What the sync remembers between passes — the web's refs.
struct PieceSyncState {
    /// The claim (slide key + picture) the restore last settled on.
    var restoredFor: String?
    /// A find in flight for this claim.
    var finding: String?
    /// The tick as the record-back last acted on it.
    var seenActive: SavedMediaRef?
    /// The collage refetch's opening, and what it already tried.
    var collageKey: String?
    var generation = 0
    var attempted: Set<String> = []
    var signature: String?
    var queue: [RefetchTarget] = []
}

/// A drop's answer: it landed, or why not.
struct PieceDropResult: Equatable {
    var ok: Bool
    var reason: String?
}

private struct PieceNoBytes: Error {}

extension PieceEditorModel {
    // MARK: - what the sync follows

    /// The selected cell's key as the Library follows it: the slide's own
    /// for cell 0, `<slideKey>#<cell>` for another.
    var librarySlideKey: String {
        collage != nil && cellIndex > 0 ? "\(slideKey)#\(cellIndex)" : slideKey
    }

    /// The tick as the record-back reads it: nil while an EMPTY cell is
    /// looked at over the picture ticked when it was selected.
    var effectiveActive: SavedMediaRef? {
        let active = library?.active
        if collage != nil && cellIndex > 0 && cell?.media == nil && sameTick(active, cellBaseline) { return nil }
        return active
    }

    /// What the Picture tab reports for the selected cell: the sync's own
    /// fetch, else the collage's.
    var recovery: PieceRecovery? {
        if let libraryRecovery { return libraryRecovery }
        guard collage != nil else { return nil }
        return collageRecovery(cellMedia)
    }

    /// The Layout section's one line about the collage's fetches.
    var refetchSummary: String? { AtelierKit.refetchSummary(collageFetches.map { ($0.key, $0.value.refetch) }) }

    /// A collage fetch's report for one ref.
    func collageRecovery(_ ref: SavedMediaRef?) -> PieceRecovery? {
        guard let key = refetchKey(ref) else { return nil }
        return collageFetches.first { $0.key == key }?.value
    }

    // MARK: - one pass

    /// The Library, the slide or the cell moved: run the three passes in the
    /// order the web's effects run.
    func libraryChanged() {
        guard post != nil, !closed else { return }
        collageRefetchPass()
        restorePass()
        recordPass()
        stageInputsChanged()
    }

    /// A settled restore; the record-back is woken by it.
    private func settle(_ claim: String?) {
        syncState.restoredFor = claim
        recordPass()
    }

    // MARK: - the restore: the Library follows the slide

    private func restorePass() {
        let claim = restoreClaim(librarySlideKey, media: cellMedia)
        if syncState.restoredFor == claim { return }
        guard !isCta, let want = cellMedia else {
            libraryRecovery = nil
            settle(claim)
            return
        }
        guard let library else { return }
        if library.pool.isEmpty && library.sourceOf(want) == nil { return }
        if syncState.finding == claim { return }
        syncState.finding = claim
        Task { [weak self] in
            guard let self else { return }
            let found = await self.findInPool(want)
            let now = restoreClaim(self.librarySlideKey, media: self.cellMedia)
            if self.syncState.finding == claim { self.syncState.finding = nil }
            // A pass for another picture overtook this one: its answer is late.
            guard now == claim, !self.closed, let library = self.library else { return }
            if let found {
                library.activate(found)
                self.libraryRecovery = nil
                self.settle(claim)
                return
            }
            if let elsewhere = self.collageRecovery(want) {
                // Another fetcher has it: while fetching, the pool changing
                // re-runs this; once failed, claimed, so a tick still re-points.
                if elsewhere.state == .failed { self.settle(claim) }
                self.libraryRecovery = nil
                return
            }
            guard let sourceId = library.sourceOf(want) else {
                self.libraryRecovery = nil
                self.settle(claim)
                return
            }
            // Claimed before the await: a second pass must not fetch it twice.
            self.settle(claim)
            self.libraryRecovery = PieceRecovery(state: .fetching, sourceId: sourceId)
            do {
                let ok = try await library.refetch(want)
                guard restoreClaim(self.librarySlideKey, media: self.cellMedia) == claim else { return }
                if ok {
                    // The pool changed: the next pass activates the picture.
                    self.libraryRecovery = nil
                    self.syncState.restoredFor = nil
                    self.libraryChanged()
                } else {
                    self.libraryRecovery = PieceRecovery.gone(want, sourceId: sourceId)
                }
            } catch {
                guard restoreClaim(self.librarySlideKey, media: self.cellMedia) == claim else { return }
                self.libraryRecovery = PieceRecovery.from(error, sourceId: sourceId)
            }
        }
    }

    // MARK: - the record-back: the slide follows the tick

    private func recordPass() {
        guard !isCta else { return }
        let claim = restoreClaim(librarySlideKey, media: cellMedia)
        let active = effectiveActive
        let move = syncMove(SyncState(
            settled: syncState.restoredFor == claim,
            tickMoved: !sameTick(syncState.seenActive, active),
            slideName: cellMedia?.name,
            activeName: active?.name
        ))
        // A pass that stood down while the restore is in flight has not acted
        // on the tick: the pick made meanwhile is still a pick once it lands.
        if move != .restore { syncState.seenActive = active }
        guard move == .record, let active else { return }
        let at = cellIndex
        Task { [weak self] in
            guard let self else { return }
            let ref = await self.storedRef(active)
            guard restoreClaim(self.librarySlideKey, media: self.cellMedia) == claim else { return }
            self.patchCell(at, CollageCellPatch(media: .some(ref)))
        }
    }

    // MARK: - a collage's other cells

    private func collageRefetchPass() {
        let key = slideKey
        if syncState.collageKey != key {
            // A new slide is a new opening: forget what was tried, drop what is late.
            syncState.collageKey = key
            syncState.generation &+= 1
            syncState.attempted = []
            syncState.signature = nil
            syncState.queue = []
            collageFetches = []
        }
        guard let library, let collage else { return }
        let lead = self.lead
        let refs: [SavedMediaRef?] = (0..<collageCellCount(collage)).map { collageCellAt(lead, collage, $0).media }
        let signature = refs.map { refetchKey($0) ?? "" }.joined(separator: "|")
        guard signature != syncState.signature else { return }
        syncState.signature = signature
        let targets = refsToFetch(refs, poolNames: library.poolNames, sourceOf: { library.sourceOf($0) },
                                           attempted: syncState.attempted)
        guard !targets.isEmpty else { return }
        for t in targets {
            syncState.attempted.insert(t.key)
            publishFetch(t.key, PieceRecovery(state: .fetching, sourceId: t.sourceId))
        }
        syncState.queue.append(contentsOf: targets)
        let gen = syncState.generation
        for _ in 0..<min(3, targets.count) {
            Task { [weak self] in await self?.collageWorker(gen) }
        }
    }

    private func collageWorker(_ gen: Int) async {
        while gen == syncState.generation, !syncState.queue.isEmpty, !closed {
            let t = syncState.queue.removeFirst()
            guard let library else { return }
            do {
                let ok = try await library.refetch(t.ref)
                guard gen == syncState.generation else { return }
                publishFetch(t.key, ok ? nil : PieceRecovery.gone(t.ref, sourceId: t.sourceId))
                if ok { libraryChanged() }
            } catch {
                guard gen == syncState.generation else { return }
                publishFetch(t.key, PieceRecovery.from(error, sourceId: t.sourceId))
            }
        }
    }

    private func publishFetch(_ key: String, _ next: PieceRecovery?) {
        var list = collageFetches
        if let i = list.firstIndex(where: { $0.key == key }) {
            if let next { list[i] = (key, next) } else { list.remove(at: i) }
        } else if let next {
            list.append((key, next))
        }
        collageFetches = list
    }

    // MARK: - a picture dropped on a cell

    /// A picture dragged out of the Library and dropped on cell `i` (0 without
    /// a collage — the slide's own picture). Resolves once it is in place, or
    /// says why not. The write goes through the LATEST document, never the
    /// one the drop began with: a fetch may take seconds.
    func dropAsset(_ i: Int, _ item: AssetDragItem) async -> PieceDropResult {
        guard let got = await item.resolve() else {
            let reason = item.origin == .instance
                ? "\(item.sourceLabel ?? "The instance") did not hand it over — see the Library"
                : "Nothing to compose over in that file"
            return PieceDropResult(ok: false, reason: reason)
        }
        let ref = await storedRef(got.ref)
        // WRITE FIRST, select after (see the header).
        patchCell(i, CollageCellPatch(media: .some(ref)))
        selectCell(i)
        // Ticked and active, so the Library shows what the cell now holds.
        library?.activate(got.ref)
        return PieceDropResult(ok: true, reason: nil)
    }

    // MARK: - identity

    /// Two ticks for the same pool file.
    func sameTick(_ a: SavedMediaRef?, _ b: SavedMediaRef?) -> Bool {
        guard let a, let b else { return a == nil && b == nil }
        return fileIdentity(a) == fileIdentity(b)
    }

    /// The ref a slide stores for a pool file: its hash (and its source id)
    /// when known, read off the main actor — the web's `hashedMediaRef`.
    func storedRef(_ file: SavedMediaRef) async -> SavedMediaRef {
        let bytes = self.url(for: file)
        return await Task.detached(priority: .utility) {
            hashedMediaRef(file) { f in
                guard let bytes else { throw PieceNoBytes() }
                return StudioFileBlob(url: bytes, size: f.size)
            }
        }.value
    }

    /// The pool file that IS `want` — by name first (free), then by content
    /// hash among the same-size candidates.
    func findInPool(_ want: SavedMediaRef) async -> SavedMediaRef? {
        guard let library else { return nil }
        if let byName = library.poolFile(named: want) { return byName }
        guard let hash = want.hash, !hash.isEmpty else { return nil }
        let pool = library.pool
        var urls: [String: URL] = [:]
        for file in pool where file.size == want.size {
            if let bytes = self.url(for: file) { urls[fileIdentity(file)] = bytes }
        }
        guard !urls.isEmpty else { return nil }
        let table = urls
        return await Task.detached(priority: .utility) {
            findMedia(want, pool) { f in
                guard let url = table[fileIdentity(f)] else { throw PieceNoBytes() }
                return StudioFileBlob(url: url, size: f.size)
            }
        }.value
    }
}
