// The machine that keeps an open document's mirror and the instance it is kept
// on in step — LOCAL NOW, REMOTE ON IDLE (`docs/roadtrip-persistence.md` D1).
// The native twin of the web's `use-document-sync.tsx`, which was copied line
// for line into the Studio and Trips before a third kind (the roll) made it
// one hook; here it is one class from the start, generic over the document.
//
// For a document on a remote source (a local one has no record, and none is
// made):
//
// - `edited` → the record is dirty, and a push is armed after
//   `remoteIdleMs` of quiet;
// - it PUSHES on that idle, when the app leaves the foreground, when the
//   screen goes (`documentSyncLifecycle`), and on the pill's "Save now" —
//   `force` skips the idle wait but never a HELD state (a conflict is a
//   person's decision, not a timer's);
// - every write carries `If-Match` with the etag held; a 412 is the conflict
//   state carrying the server's copy (`TheirCopy`), and NOTHING is
//   overwritten — the pill offers "Keep mine" and "Take theirs";
// - an outcome is reduced onto the LIVE record, and only if it is still this
//   document's: an edit, or another document, may have landed while the
//   request was out;
// - `resume` asks the instance on open (`If-None-Match`) and applies
//   `afterPull`: a clean mirror takes a newer copy silently, a dirty one is a
//   conflict;
// - the pill's verbs — keep mine, take theirs, keep as local, delete here.
//
// Every policy is the kernel's reducer (`DocSync.swift`) and every sentence
// its `pillText`; this class only holds the live record, the timer and the
// requests. Plus the remote half every kind shares (`DocumentRemote`) — the
// web's `trip-remote.ts`, `project-remote.ts` and `roll-remote.ts`, generic
// here because the wire mapping is the document's own (`StoredDocument`).

import Foundation
import Observation
import AtelierKit

// MARK: - the remote half, once for every kind

/// What a move came to — the web's `MoveResult`.
enum DocumentMoveOutcome<D> {
    case moved(D)
    case failed(String)
}

enum DocumentRemote<D: StoredDocument> {
    /// One PUT of the document, guarded by the etag we hold. Never throws.
    static func push(_ remote: RemoteSource, _ doc: D, _ etag: String?) async -> PushOutcome {
        await putDocOnce(remote, kind: D.bucketKind, id: doc.id, version: doc.version, wireDoc: doc.wireDoc, etag: etag)
    }

    /// The server's copy, unless ours (`ifNoneMatch`) is still it. `local` is
    /// the mirror whose device-bound parts the fetched copy keeps. Never throws.
    static func pull(_ remote: RemoteSource, _ id: String, _ ifNoneMatch: String?, _ local: D?) async -> PullOutcome<D> {
        do {
            let result = try await remote.client.getDoc(docsApp, id, ifNoneMatch: ifNoneMatch)
            guard case .row(let row) = result else { return .current }
            let doc = try D.fromWire(row.doc, id: id, sourceId: remote.sourceId, local: local)
            return .fetched(doc: doc, etag: row.etag, updatedAt: row.updatedAt)
        } catch {
            let failure = failureOf(error)
            return .failed(kind: failure.kind, message: failure.message, theirs: failure.theirs)
        }
    }

    /// Every document of this kind the account keeps there. A row that is not
    /// one is skipped rather than taking the list down. Throws the client's
    /// error — the gallery explains it.
    static func list(_ remote: RemoteSource) async throws -> [RemoteDocRow<D>] {
        let rows = try await remote.client.listDocs(docsApp, D.bucketKind)
        return rows.compactMap { row -> RemoteDocRow<D>? in
            guard let doc = try? D.fromWire(row.doc, id: row.id, sourceId: remote.sourceId, local: nil) else { return nil }
            return RemoteDocRow(doc: doc, etag: row.etag, updatedAt: row.updatedAt)
        }
    }

    /// Push with no live state to race — a creation, an import, a move:
    /// `pushStarted`, then the outcome, the record persisted at both steps.
    static func pushNew(_ remote: RemoteSource, _ doc: D, _ record: SyncRecord?, store: DocumentStore<D>,
                        now: Double, clock: () -> Double) async -> SyncRecord {
        var rec = reduceSync(record ?? newSyncRecord(id: doc.id, sourceId: remote.sourceId, now: now), .pushStarted(now: now))
        store.putSyncRecord(rec)
        let outcome = await push(remote, doc, rec.etag)
        rec = reduceSync(rec, outcomeEvent(outcome, now: clock()))
        store.putSyncRecord(rec)
        return rec
    }

    /// Take a server copy as this device's mirror, with a clean record beside it.
    @discardableResult
    static func mirror(_ sourceId: String, _ doc: D, _ etag: String, store: DocumentStore<D>, now: Double) -> SyncRecord {
        store.put(doc)
        let existing = store.getSyncRecord(doc.id)
        let rec = reduceSync(existing ?? newSyncRecord(id: doc.id, sourceId: sourceId, now: now), .pulled(etag: etag, now: now))
        store.putSyncRecord(rec)
        return rec
    }

    /// Delete there, guarded by the revision we hold. Throws the client's error.
    static func deleteRemote(_ remote: RemoteSource, _ id: String, _ etag: String?) async throws {
        try await remote.client.deleteDoc(docsApp, id, ifMatch: etag)
    }

    /// Move a document to another source, keeping its id. The target is
    /// written and acknowledged FIRST; only then is the origin's copy deleted,
    /// so a failure leaves everything where it was.
    static func move(_ doc: D, to targetSourceId: String, store: DocumentStore<D>,
                     remoteFor: (String) -> RemoteSource?, now: Double, clock: () -> Double) async -> DocumentMoveOutcome<D> {
        if targetSourceId == doc.sourceId { return .moved(doc) }
        let moved = doc.moved(to: targetSourceId, now: now)
        let origin = remoteFor(doc.sourceId)
        let originRecord = isRemoteSource(doc.sourceId) ? store.getSyncRecord(doc.id) : nil
        if isRemoteSource(doc.sourceId) && origin == nil {
            return .failed("\(doc.sourceId) is not connected — connect it to move this \(D.noun) away.")
        }

        var targetRecord: SyncRecord? = nil
        if isRemoteSource(targetSourceId) {
            guard let target = remoteFor(targetSourceId) else {
                return .failed("\(targetSourceId) cannot hold \(D.noun)s.")
            }
            let pushed = await pushNew(target, moved, nil, store: store, now: now, clock: clock)
            if pushed.status != .synced {
                store.deleteSyncRecord(doc.id)
                if let originRecord { store.putSyncRecord(originRecord) }
                if let error = pushed.error, !error.isEmpty {
                    return .failed("Could not save to \(targetSourceId): \(error)")
                }
                return .failed("Could not save to \(targetSourceId).")
            }
            targetRecord = pushed
        }

        if let origin {
            do {
                try await deleteRemote(origin, doc.id, originRecord?.etag)
            } catch {
                let failure = failureOf(error)
                if failure.kind != .notfound {
                    return .failed("Saved to \(targetSourceId), but could not remove the copy on \(origin.label) "
                        + "(\(failure.message)). Delete it there by hand, or move again once it answers.")
                }
            }
        }

        store.put(moved)
        if let targetRecord { store.putSyncRecord(targetRecord) } else { store.deleteSyncRecord(doc.id) }
        return .moved(moved)
    }
}

extension SyncRecord {
    /// Whether the pill offers "Save now": an edit is pending and the state
    /// is one a retry can move.
    var canSaveNow: Bool {
        dirtyAt != nil && (status == .dirty || status == .offline || status == .unauthenticated)
    }
}

// MARK: - the driver

@MainActor
@Observable
final class DocumentSync<D: StoredDocument> {
    /// The open document's record, or nil when it is kept here (or none is open).
    private(set) var record: SyncRecord?

    @ObservationIgnored let store: DocumentStore<D>
    @ObservationIgnored private let remoteLookup: (String) -> RemoteSource?
    @ObservationIgnored var idleMs: Double
    @ObservationIgnored var clock: () -> Double

    // The tool's side — read when needed, so a store may set fresh closures.
    /// The document open in the tool, as it is now.
    @ObservationIgnored var current: () -> D? = { nil }
    /// A tool whose own local save is debounced flushes it here first, so a
    /// push never carries a document older than what is on screen.
    @ObservationIgnored var beforeFlush: (() async -> Void)?
    /// A tool holding a debounced local write drops it: the document is being replaced or deleted.
    @ObservationIgnored var onDiscardPending: (() -> Void)?
    /// The open document was replaced under the tool — the server's copy, or kept as local.
    @ObservationIgnored var onReplace: ((D) -> Void)?
    /// The open document was deleted here.
    @ObservationIgnored var onDeleted: (() -> Void)?

    /// The document the machine is working for — what a late answer is checked against.
    @ObservationIgnored private var activeId: String?
    @ObservationIgnored private var pushing = false
    @ObservationIgnored private var timer: Task<Void, Never>?

    init(store: DocumentStore<D>, remoteFor: @escaping (String) -> RemoteSource?, idleMs: Double = remoteIdleMs,
         clock: @escaping () -> Double = nowMillis) {
        self.store = store
        self.remoteLookup = remoteFor
        self.idleMs = idleMs
        self.clock = clock
    }

    /// Over the app's connections: the instance that keeps this kind.
    convenience init(store: DocumentStore<D> = DocumentStore(), connections: ConnectionStore) {
        self.init(store: store, remoteFor: { [weak connections] sourceId in
            connections?.remote(for: sourceId, kind: D.bucketKind)
        })
    }

    /// The instance the open document is kept on, or nil (local, not
    /// connected, or no bucket for this kind).
    var remote: RemoteSource? {
        current().flatMap { remoteLookup($0.sourceId) }
    }

    /// Whether the open document has a pill at all.
    var showsPill: Bool {
        guard let doc = current(), record != nil else { return false }
        return isRemoteSource(doc.sourceId)
    }

    /// The one writer of the record: memory and the sidecar together.
    private func setRecord(_ rec: SyncRecord?) {
        record = rec
        if let rec { store.putSyncRecord(rec) }
    }

    /// No document open.
    func clear() {
        activeId = nil
        record = nil
        timer?.cancel()
        timer = nil
    }

    // MARK: pushing

    func flush(force: Bool = false) async {
        guard let doc = current(), let rec = record, rec.id == doc.id,
              let remote = remote, remote.sourceId == doc.sourceId else { return }
        guard !pushing else { return }
        guard shouldFlush(rec, now: clock(), idleMs: force ? 0 : idleMs) else { return }
        pushing = true
        defer { pushing = false }
        setRecord(reduceSync(rec, .pushStarted(now: clock())))
        let outcome = await DocumentRemote<D>.push(remote, doc, rec.etag)
        if let live = record, live.id == doc.id {
            setRecord(reduceSync(live, outcomeEvent(outcome, now: clock())))
        }
    }

    /// The tool's own pending local write first, then the push.
    func flushAll() async {
        await beforeFlush?()
        await flush(force: true)
    }

    private func arm() {
        timer?.cancel()
        let delay = UInt64(max(0, idleMs + 50) * 1_000_000)
        timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    /// The local write landed: dirty from now, pushed after the idle delay.
    func edited(_ next: D) {
        guard isRemoteSource(next.sourceId) else { return }
        let now = clock()
        let rec = record?.id == next.id ? record : nil
        setRecord(reduceSync(rec ?? newSyncRecord(id: next.id, sourceId: next.sourceId, now: now), .edited(now: now)))
        arm()
    }

    // MARK: opening

    /// Opening a document: for one kept on an instance, read its record and
    /// ask whether it moved (`afterPull`). The document to show — the
    /// server's copy when a clean mirror was replaced — or nil when another
    /// document was opened meanwhile.
    func resume(_ opening: D) async -> (doc: D, replaced: Bool)? {
        activeId = opening.id
        guard isRemoteSource(opening.sourceId) else {
            record = nil
            return (opening, false)
        }
        // A mirror with no record (a push that never got to write one) is
        // simply dirty: it goes up on the next trigger.
        let rec = store.getSyncRecord(opening.id) ?? newSyncRecord(id: opening.id, sourceId: opening.sourceId, now: clock())
        setRecord(rec)
        // Not connected, or no bucket: the gallery's header says so.
        guard let remote = remoteLookup(opening.sourceId) else { return (opening, false) }
        let pulled = await DocumentRemote<D>.pull(remote, opening.id, rec.etag, opening)
        guard activeId == opening.id, let live = record, live.id == opening.id else { return nil }
        let decided = afterPull(live, pulled, now: clock())
        if let take = decided.take { store.put(take) }
        if let event = decided.event { setRecord(reduceSync(live, event)) }
        if let take = decided.take { return (take, true) }
        return (opening, false)
    }

    /// A document the gallery just created and pushed: take its stored record.
    func adopt(_ created: D) {
        activeId = created.id
        guard isRemoteSource(created.sourceId) else {
            record = nil
            return
        }
        setRecord(store.getSyncRecord(created.id) ?? newSyncRecord(id: created.id, sourceId: created.sourceId, now: clock()))
    }

    // MARK: the pill's verbs

    func saveNow() async {
        await flushAll()
    }

    /// Conflict: re-push over the server's copy.
    func keepMine() async {
        guard let rec = record else { return }
        setRecord(reduceSync(rec, .resolvedKeepMine))
        await flush(force: true)
    }

    /// Conflict: replace the mirror with the server's copy, dropping the edits made here.
    func takeTheirs() async {
        guard let doc = current(), record != nil, let remote = remote else { return }
        let pulled = await DocumentRemote<D>.pull(remote, doc.id, nil, doc)
        guard current()?.id == doc.id, let live = record else { return }
        switch pulled {
        case .fetched(let theirs, let etag, _):
            // Whatever was about to be saved is the edit being dropped.
            onDiscardPending?()
            store.put(theirs)
            setRecord(reduceSync(live, .resolvedTakeTheirs(etag: etag, now: clock())))
            onReplace?(theirs)
        case .failed(let kind, let message, let theirs):
            setRecord(reduceSync(live, .pushFailed(kind: kind, message: message, theirs: theirs)))
        case .current:
            break
        }
    }

    /// Gone: keep the document on this device as a local one.
    func keepLocal() {
        guard var local = current() else { return }
        let id = local.id
        local.sourceId = defaultSourceId
        local.updatedAt = clock()
        onDiscardPending?()
        store.put(local)
        store.deleteSyncRecord(id)
        record = nil
        onReplace?(local)
    }

    /// Gone: delete the mirror here too.
    func deleteHere() {
        guard let doc = current() else { return }
        onDiscardPending?()
        store.delete(doc.id)
        clear()
        onDeleted?()
    }
}
