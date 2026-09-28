// The driver that carries a Studio project between this device's mirror and
// the instance it is kept on — port of `src/shared/projects/project-remote.ts`,
// the twin of the trip's and the roll's over the same plumbing
// (`Sources/DocRemote.swift`) and the same reducer (`Sources/DocSync.swift`).
// Phase P4 of `docs/roadtrip-persistence.md`: the bucket is generic,
// `kind: project` is its second row. Plus the pure half of
// `src/shared/projects/project-store.ts`, whose storage is the app's
// (`ProjectStore`, below; `readProjectList` in `ProjectTypes.swift`).
//
// What travels is the document minus what is THIS machine's: `sourceId` (the
// remote copy IS on that source), `media.dirHandle` (the folder's bookmark,
// meaningless anywhere else) and `thumbnail` (re-baked at the next save). The
// media LIST travels — refs by hash are how the project finds its clips again
// from a folder or from an instance — and so do the trims, the develops and
// the active clip, since they address the same media. On the way back the id
// and the source are stamped from the REQUEST, the mirror's own bookmark and
// thumbnail are kept, and the document is migrated like a stored one.
//
// Rules kept (`studio.md`, «A project kept on a Winnow»): a push never throws
// (its outcome is what the reducer eats); a pull says "current" on a 304; a
// row that is not a project is skipped rather than taking the list down; a
// MOVE writes and hears the target acknowledge FIRST and only then deletes the
// origin's copy, so a failure leaves everything where it was.

import Foundation

/// The kind projects are filed under in the bucket.
public let projectDocKind = "project"

/// The app's project storage — the web's IndexedDB store (`project-store.ts`):
/// one document per project and, beside it and never on it, one SYNC RECORD
/// per project kept on an instance. Every call degrades rather than throws, as
/// the web's do: a failed write answers false and the caller keeps the record
/// in memory.
public protocol ProjectStore: AnyObject {
    /// Every stored project, read and migrated, most recently updated first
    /// (`readProjectList`); empty when storage is unusable.
    func listProjects() async -> [ProjectDoc]
    func getProject(_ id: String) async -> ProjectDoc?
    /// False when the write failed (a full disk, a revoked container).
    func putProject(_ doc: ProjectDoc) async -> Bool
    func deleteProject(_ id: String) async
    /// The record for a project, or nil when it has none (a local project, or storage down).
    func getSyncRecord(_ id: String) async -> SyncRecord?
    func putSyncRecord(_ record: SyncRecord) async -> Bool
    func deleteSyncRecord(_ id: String) async
}

// MARK: - the wire shape

/// The project as an instance's document bucket stores it — nothing bound to
/// this machine: no `sourceId`, no `thumbnail`, no `media.dirHandle`.
public func toWireDoc(_ doc: ProjectDoc) -> JSONValue {
    guard var o = doc.json.objectValue else { return .null }
    o["sourceId"] = nil
    o["thumbnail"] = nil
    if var media = o["media"]?.objectValue {
        media["dirHandle"] = nil
        o["media"] = .object(media)
    }
    return .object(o)
}

/// A stored body back into a document: id and source stamped from the
/// request; this device's bookmark and thumbnail kept from `local` when it has
/// them (never a fabricated one when it has not); the same migration chain a
/// stored project gets. A body that is not a project is refused rather than
/// half-read. `local` is required so this never reads as the roll's or the
/// trip's three-argument reader.
public func fromWireDoc(_ raw: JSONValue?, _ id: String, _ sourceId: String, local: ProjectDoc?) throws -> ProjectDoc {
    let refusal = WinnowError(.protocol, "The stored copy of \(id) is not a project.")
    guard var body = raw?.objectValue else { throw refusal }
    guard body["version"]?.finiteNumber != nil, body["settings"]?.objectValue != nil else { throw refusal }
    body["id"] = .string(id)
    body["sourceId"] = .string(sourceId)
    // An absent media half reads as no media, the web's `body.media ?? {…}`.
    guard var doc = readProjectDoc(.object(body)) else { throw refusal }
    doc.media.dirHandle = local?.media.dirHandle
    doc.thumbnail = local?.thumbnail
    return doc
}

// MARK: - push / pull

/// One PUT of the project, guarded by the etag we hold. Never throws.
public func pushOnce(_ remote: RemoteSource, _ doc: ProjectDoc, _ etag: String?) async -> PushOutcome {
    await putDocOnce(remote, kind: projectDocKind, id: doc.id, version: doc.version, wireDoc: toWireDoc(doc), etag: etag)
}

/// Push with no live state to race — a creation, an import, a move. Reduces
/// `pushStarted`, then the outcome (stamped by `clock` once the answer is
/// in), persisting the record at both steps.
public func pushProject(_ remote: RemoteSource, _ doc: ProjectDoc, _ record: SyncRecord?, store: ProjectStore,
                        now: Double = nowMillis(), clock: () -> Double = nowMillis) async -> SyncRecord {
    var rec = reduceSync(record ?? newSyncRecord(id: doc.id, sourceId: remote.sourceId, now: now), .pushStarted(now: now))
    _ = await store.putSyncRecord(rec)
    let outcome = await pushOnce(remote, doc, rec.etag)
    rec = reduceSync(rec, outcomeEvent(outcome, now: clock()))
    _ = await store.putSyncRecord(rec)
    return rec
}

/// What a pull hands back — the web's `PullResult`, named for projects.
public enum ProjectPullResult: Equatable, Sendable {
    /// The etag we hold is still the server's.
    case current
    case fetched(doc: ProjectDoc, etag: String, updatedAt: String)
    case failed(RemoteFailure)
}

/// The server's copy, unless ours (`ifNoneMatch`) is still it. `local` is the
/// mirror whose bookmark and thumbnail the fetched copy keeps. Never throws.
public func pullProject(_ remote: RemoteSource, _ id: String, _ ifNoneMatch: String?,
                        _ local: ProjectDoc?) async -> ProjectPullResult {
    do {
        let result = try await remote.client.getDoc(docsApp, id, ifNoneMatch: ifNoneMatch)
        guard case .row(let row) = result else { return .current }
        let doc = try fromWireDoc(row.doc, id, remote.sourceId, local: local)
        return .fetched(doc: doc, etag: row.etag, updatedAt: row.updatedAt)
    } catch {
        return .failed(failureOf(error))
    }
}

public struct RemoteProjectRow: Equatable, Sendable {
    public var doc: ProjectDoc
    public var etag: String
    public var updatedAt: String

    public init(doc: ProjectDoc, etag: String, updatedAt: String) {
        self.doc = doc; self.etag = etag; self.updatedAt = updatedAt
    }
}

/// Every project this account keeps there. Throws the client's error — the
/// gallery explains it.
public func listRemoteProjects(_ remote: RemoteSource) async throws -> [RemoteProjectRow] {
    let rows = try await remote.client.listDocs(docsApp, projectDocKind)
    var out: [RemoteProjectRow] = []
    for row in rows {
        // A row that is not a project is skipped rather than taking the list down.
        guard let doc = try? fromWireDoc(row.doc, row.id, remote.sourceId, local: nil) else { continue }
        out.append(RemoteProjectRow(doc: doc, etag: row.etag, updatedAt: row.updatedAt))
    }
    return out
}

/// Take a server copy as this device's mirror, with a clean record beside it.
public func mirrorProject(_ sourceId: String, _ doc: ProjectDoc, _ etag: String, store: ProjectStore,
                          now: Double = nowMillis()) async -> SyncRecord {
    _ = await store.putProject(doc)
    let existing = await store.getSyncRecord(doc.id)
    let rec = reduceSync(existing ?? newSyncRecord(id: doc.id, sourceId: sourceId, now: now), .pulled(etag: etag, now: now))
    _ = await store.putSyncRecord(rec)
    return rec
}

/// Delete there, guarded by the revision we hold. Throws the client's error.
public func deleteRemoteProject(_ remote: RemoteSource, _ id: String, _ etag: String?) async throws {
    try await remote.client.deleteDoc(docsApp, id, ifMatch: etag)
}

// MARK: - crossing sources

/// What a move hands back — the web's `MoveResult`, named for projects.
public enum ProjectMoveResult: Equatable, Sendable {
    case moved(ProjectDoc)
    case failed(String)
}

/// Move a project to another source, keeping its id. The target is written
/// and acknowledged FIRST; only then is the origin's copy deleted, so a
/// failure leaves everything where it was. The mirror keeps its bookmark and
/// thumbnail — they are this device's whichever source the document is on.
/// `remoteFor` is the app's `remoteFor(_:connections:transport:)` over the
/// connections it holds.
public func moveProject(_ project: ProjectDoc, _ targetSourceId: String, store: ProjectStore,
                        remoteFor: (String) -> RemoteSource?, now: Double = nowMillis(),
                        clock: () -> Double = nowMillis) async -> ProjectMoveResult {
    if targetSourceId == project.sourceId { return .moved(project) }
    var moved = project
    moved.sourceId = targetSourceId
    moved.updatedAt = now
    let origin = remoteFor(project.sourceId)
    var originRecord: SyncRecord? = nil
    if isRemoteSource(project.sourceId) { originRecord = await store.getSyncRecord(project.id) }
    if isRemoteSource(project.sourceId) && origin == nil {
        return .failed("\(project.sourceId) is not connected — connect it to move this project away.")
    }

    var targetRecord: SyncRecord? = nil
    if isRemoteSource(targetSourceId) {
        guard let target = remoteFor(targetSourceId) else {
            return .failed("\(targetSourceId) cannot hold projects.")
        }
        let pushed = await pushProject(target, moved, nil, store: store, now: now, clock: clock)
        if pushed.status != .synced {
            await store.deleteSyncRecord(project.id)
            if let originRecord { _ = await store.putSyncRecord(originRecord) }
            if let error = pushed.error, !error.isEmpty {
                return .failed("Could not save to \(targetSourceId): \(error)")
            }
            return .failed("Could not save to \(targetSourceId).")
        }
        targetRecord = pushed
    }

    if let origin {
        do {
            try await deleteRemoteProject(origin, project.id, originRecord?.etag)
        } catch {
            let f = failureOf(error)
            if f.kind != .notfound {
                return .failed("Saved to \(targetSourceId), but could not remove the copy on \(origin.label) "
                    + "(\(f.message)). Delete it there by hand, or move again once it answers.")
            }
        }
    }

    _ = await store.putProject(moved)
    if let targetRecord { _ = await store.putSyncRecord(targetRecord) } else { await store.deleteSyncRecord(project.id) }
    return .moved(moved)
}
