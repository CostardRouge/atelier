// The driver that carries a trip between this device's mirror and the
// instance it is kept on — port of `src/shared/roadtrip/trip-remote.ts`, the
// twin of the project's (`Projects/ProjectRemote.swift`) and the roll's over
// the same plumbing (`Sources/DocRemote.swift`) and the same reducer
// (`Sources/DocSync.swift`). Plus the pure half of
// `src/shared/roadtrip/trip-store.ts`, whose storage is the app's (`TripStore`,
// below; `readTripList`).
//
// It owns no policy: every decision is the reducer's, every sentence its
// pill's. What travels is the document minus `sourceId`: the remote copy IS on
// that source, and a stored copy that named one would be a second truth. On
// the way back the id and the source are stamped from the REQUEST, never
// trusted from the body, and the document is migrated like a stored one.
//
// Rules kept (`docs/roadtrip-persistence.md`): a push never throws (its outcome
// is what the reducer eats); a pull says "current" on a 304; a row that is not
// a trip is skipped rather than taking the list down; a MOVE keeps the id (so
// every `tripRef` link survives), goes through the portable half — which is
// what nulls every `projectId`, since projects do not cross — writes and hears
// the target acknowledge FIRST, and only then deletes the origin's copy, so a
// failure leaves everything where it was.
//
// `fromWireDoc(trip:_:_:)` carries a label: the roll's reader
// (`Develop/RollFile.swift`) is `fromWireDoc(_:_:_:)` with the same three
// arguments, and two overloads that differ only in what they return are
// ambiguous wherever the result's type is not written down.

import Foundation

/// The kind trips are filed under in the bucket. The web's `TRIP_DOC_KIND`.
public let tripDocKind = "trip"

/// The app's trip storage — the web's IndexedDB database `atelier-roadtrip`:
/// one document per trip; beside it and never on it, one SYNC RECORD per trip
/// kept on an instance (on the document it would leak into the trip file and
/// onto the wire, and `dirtyAt` surviving a relaunch is what lets the next
/// open push the edit); and one small JPEG per post, the hook as last composed,
/// kept apart because they are the only heavy values. Every call degrades
/// rather than throws, as the web's do: the tool keeps working in memory.
public protocol TripStore: AnyObject {
    /// Every stored trip, read and migrated, most recently updated first
    /// (`readTripList`); empty when storage is unusable.
    func listTrips() async -> [TripDoc]
    /// False when the write failed (a full disk, a revoked container).
    func putTrip(_ doc: TripDoc) async -> Bool
    func deleteTrip(_ id: String) async
    /// The record for a trip, or nil when it has none (a local trip, or storage down).
    func getSyncRecord(_ id: String) async -> SyncRecord?
    /// Every record — the trips this device mirrors from an instance.
    func listSyncRecords() async -> [SyncRecord]
    func putSyncRecord(_ record: SyncRecord) async -> Bool
    func deleteSyncRecord(_ id: String) async
    /// Save one post's hook picture. A missing thumbnail costs a row its picture, never the row.
    func putThumb(_ id: String, _ jpeg: Data) async
    /// The thumbnails that exist among `ids`; missing ids are absent.
    func getThumbs(_ ids: [String]) async -> [String: Data]
    /// Forget the thumbnails of posts that are gone — nobody else prunes them.
    func deleteThumbs(_ ids: [String]) async
}

/// The pure half of the store's `listTrips`: every stored document read and
/// migrated, what is not a trip left out, most recently updated first (a
/// stable order among equals, as `Array.prototype.sort` is).
public func readTripList(_ stored: [JSONValue], now: Double = nowMillis()) -> [TripDoc] {
    let docs = stored.compactMap { readTripDoc($0, now: now) }
    return docs.enumerated().sorted { a, b in
        if a.element.updatedAt != b.element.updatedAt { return a.element.updatedAt > b.element.updatedAt }
        return a.offset < b.offset
    }.map(\.element)
}

// MARK: - the wire shape

/// The document as it is stored there: everything but where it is kept.
public func toWireDoc(_ doc: TripDoc) -> JSONValue {
    guard var o = doc.json.objectValue else { return .null }
    o["sourceId"] = nil
    return .object(o)
}

/// A stored body back into a document: id and source stamped from the
/// request, the same migration chain a stored trip gets. A body that is not a
/// trip at all — not a record, no numeric `version`, no text `startDate` — is
/// refused rather than half-read.
public func fromWireDoc(trip raw: JSONValue?, _ id: String, _ sourceId: String, now: Double = nowMillis(),
                        makeId: () -> String = newTripId) throws -> TripDoc {
    let refusal = WinnowError(.protocol, "The stored copy of \(id) is not a trip.")
    guard var body = raw?.objectValue else { throw refusal }
    guard body["version"]?.finiteNumber != nil, body["startDate"]?.stringValue != nil else { throw refusal }
    body["id"] = .string(id)
    body["sourceId"] = .string(sourceId)
    guard let doc = readTripDoc(.object(body), now: now, makeId: makeId) else { throw refusal }
    return doc
}

// MARK: - push / pull

/// One PUT of the trip, guarded by the etag we hold. Never throws.
public func pushOnce(_ remote: RemoteSource, _ doc: TripDoc, _ etag: String?) async -> PushOutcome {
    await putDocOnce(remote, kind: tripDocKind, id: doc.id, version: doc.version, wireDoc: toWireDoc(doc), etag: etag)
}

/// Push with no live state to race — a creation, an import, a move. Reduces
/// `pushStarted`, then the outcome (stamped by `clock` once the answer is in),
/// persisting the record at both steps, and returns it so the caller can read
/// the status. A failure is a record state, never a throw.
public func pushTrip(_ remote: RemoteSource, _ doc: TripDoc, _ record: SyncRecord?, store: TripStore,
                     now: Double = nowMillis(), clock: () -> Double = nowMillis) async -> SyncRecord {
    var rec = reduceSync(record ?? newSyncRecord(id: doc.id, sourceId: remote.sourceId, now: now), .pushStarted(now: now))
    _ = await store.putSyncRecord(rec)
    let outcome = await pushOnce(remote, doc, rec.etag)
    rec = reduceSync(rec, outcomeEvent(outcome, now: clock()))
    _ = await store.putSyncRecord(rec)
    return rec
}

/// What a pull hands back — the web's `PullResult`, named for trips.
public enum TripPullResult: Equatable, Sendable {
    /// 304: the mirror's etag is the server's.
    case current
    case fetched(doc: TripDoc, etag: String, updatedAt: String)
    case failed(RemoteFailure)
}

/// The server's copy, unless ours (`ifNoneMatch`) is still it. Never throws.
public func pullTrip(_ remote: RemoteSource, _ id: String, _ ifNoneMatch: String?,
                     now: Double = nowMillis()) async -> TripPullResult {
    do {
        let result = try await remote.client.getDoc(docsApp, id, ifNoneMatch: ifNoneMatch)
        guard case .row(let row) = result else { return .current }
        let doc = try fromWireDoc(trip: row.doc, id, remote.sourceId, now: now)
        return .fetched(doc: doc, etag: row.etag, updatedAt: row.updatedAt)
    } catch {
        return .failed(failureOf(error))
    }
}

public struct RemoteTripRow: Equatable, Sendable {
    public var doc: TripDoc
    public var etag: String
    public var updatedAt: String

    public init(doc: TripDoc, etag: String, updatedAt: String) {
        self.doc = doc; self.etag = etag; self.updatedAt = updatedAt
    }
}

/// Every trip this account keeps there. Throws the client's error — the
/// gallery explains it.
public func listRemoteTrips(_ remote: RemoteSource, now: Double = nowMillis()) async throws -> [RemoteTripRow] {
    let rows = try await remote.client.listDocs(docsApp, tripDocKind)
    var out: [RemoteTripRow] = []
    for row in rows {
        // A row that is not a trip (another client's, a hand-written one) is
        // skipped rather than taking the whole list down.
        guard let doc = try? fromWireDoc(trip: row.doc, row.id, remote.sourceId, now: now) else { continue }
        out.append(RemoteTripRow(doc: doc, etag: row.etag, updatedAt: row.updatedAt))
    }
    return out
}

/// Take a server copy as this device's mirror: the document into the store and
/// a clean record beside it. What "open a trip not yet on this device" does,
/// and what a pull that replaces the mirror does.
public func mirrorTrip(_ sourceId: String, _ doc: TripDoc, _ etag: String, store: TripStore,
                       now: Double = nowMillis()) async -> SyncRecord {
    _ = await store.putTrip(doc)
    let existing = await store.getSyncRecord(doc.id)
    let rec = reduceSync(existing ?? newSyncRecord(id: doc.id, sourceId: sourceId, now: now), .pulled(etag: etag, now: now))
    _ = await store.putSyncRecord(rec)
    return rec
}

/// Delete there, guarded by the revision we hold. Throws the client's error so
/// the caller can say "connect to delete" (unreachable) or treat a 404 as gone.
public func deleteRemoteTrip(_ remote: RemoteSource, _ id: String, _ etag: String?) async throws {
    try await remote.client.deleteDoc(docsApp, id, ifMatch: etag)
}

// MARK: - crossing sources

/// What a move hands back — the web's `MoveResult`, named for trips.
public enum TripMoveResult: Equatable, Sendable {
    case moved(TripDoc)
    case failed(String)
}

/// Move a trip to another source — a MOVE, keeping the id and the creation
/// date. It reuses the portable half (`toTripFile` → `tripDocFromFile`), which
/// is what nulls every `projectId`. The target is written and acknowledged
/// FIRST; only then is the origin's copy deleted, so a failure leaves
/// everything where it was. Thumbnails are keyed by post id and stay. The
/// local mirror is rewritten under the new source either way. `remoteFor` is
/// the app's `remoteFor(_:kind:connections:transport:)` over the connections
/// it holds.
public func moveTrip(_ trip: TripDoc, _ targetSourceId: String, store: TripStore,
                     remoteFor: (String) -> RemoteSource?, now: Double = nowMillis(),
                     clock: () -> Double = nowMillis) async -> TripMoveResult {
    if targetSourceId == trip.sourceId { return .moved(trip) }
    var moved = tripDocFromFile(toTripFile(trip, exportedAt: now), now: now, sourceId: targetSourceId, id: trip.id)
    moved.createdAt = trip.createdAt
    let origin = remoteFor(trip.sourceId)
    var originRecord: SyncRecord? = nil
    if isRemoteSource(trip.sourceId) { originRecord = await store.getSyncRecord(trip.id) }
    if isRemoteSource(trip.sourceId) && origin == nil {
        return .failed("\(trip.sourceId) is not connected — connect it to move this trip away.")
    }

    // 1. Write to the target and wait for the acknowledgement.
    var targetRecord: SyncRecord? = nil
    if isRemoteSource(targetSourceId) {
        guard let target = remoteFor(targetSourceId) else { return .failed("\(targetSourceId) cannot hold trips.") }
        let pushed = await pushTrip(target, moved, nil, store: store, now: now, clock: clock)
        if pushed.status != .synced {
            // Nothing was written there; drop the record the push left behind.
            await store.deleteSyncRecord(trip.id)
            if let originRecord { _ = await store.putSyncRecord(originRecord) }
            if let error = pushed.error, !error.isEmpty {
                return .failed("Could not save to \(targetSourceId): \(error)")
            }
            return .failed("Could not save to \(targetSourceId).")
        }
        targetRecord = pushed
    }

    // 2. Delete at the origin — a copy left behind would be a second truth.
    if let origin {
        do {
            try await deleteRemoteTrip(origin, trip.id, originRecord?.etag)
        } catch {
            let f = failureOf(error)
            if f.kind != .notfound {
                return .failed("Saved to \(targetSourceId), but could not remove the copy on \(origin.label) "
                    + "(\(f.message)). Delete it there by hand, or move again once it answers.")
            }
        }
    }

    // 3. The mirror now belongs to the target.
    _ = await store.putTrip(moved)
    if let targetRecord { _ = await store.putSyncRecord(targetRecord) } else { await store.deleteSyncRecord(trip.id) }
    return .moved(moved)
}
