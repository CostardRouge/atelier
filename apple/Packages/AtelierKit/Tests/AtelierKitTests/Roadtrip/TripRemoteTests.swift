// Port of `src/shared/roadtrip/trip-remote.test.ts`, case for case, over the
// Winnow specs' stub instance (`WinnowStub`, the web's `vi.fn(fetch)`) and an
// in-memory `TripStore` (the web's IndexedDB). A block with no web twin pins
// the store's list reader, the mirror and the move — the web drives those from
// its shell.

import Foundation
import XCTest
@testable import AtelierKit

private let host = "winnow.example"

private func remote(_ stub: WinnowStub, maxBytes: Int? = nil) -> RemoteSource {
    RemoteSource(sourceId: host, label: host, client: stub.client(), maxBytes: maxBytes)
}

private func trip() -> TripDoc {
    createTripDoc("Australie", "2025-07-01", "2025-07-10", sourceId: host)
}

/// The web's IndexedDB store, in memory.
private final class MemoryTripStore: TripStore {
    var trips: [String: TripDoc] = [:]
    var records: [String: SyncRecord] = [:]
    var thumbs: [String: Data] = [:]

    func listTrips() async -> [TripDoc] { readTripList(trips.values.map(\.json)) }
    func putTrip(_ doc: TripDoc) async -> Bool {
        trips[doc.id] = doc
        return true
    }
    func deleteTrip(_ id: String) async { trips[id] = nil }
    func getSyncRecord(_ id: String) async -> SyncRecord? { records[id] }
    func listSyncRecords() async -> [SyncRecord] { Array(records.values) }
    func putSyncRecord(_ record: SyncRecord) async -> Bool {
        records[record.id] = record
        return true
    }
    func deleteSyncRecord(_ id: String) async { records[id] = nil }
    func putThumb(_ id: String, _ jpeg: Data) async { thumbs[id] = jpeg }
    func getThumbs(_ ids: [String]) async -> [String: Data] { thumbs.filter { ids.contains($0.key) } }
    func deleteThumbs(_ ids: [String]) async { ids.forEach { thumbs[$0] = nil } }
}

private func requestBody(_ request: WinnowRequest) -> JSONValue? {
    guard case .text(let text)? = request.body else { return nil }
    return JSONValue.parse(text)
}

private struct Boom: Error, LocalizedError {
    var errorDescription: String? { "boom" }
}

final class TripRemoteWireShapeTests: XCTestCase {
    func testSendsEverythingButWhereTheTripIsKept() throws {
        let wire = try XCTUnwrap(toWireDoc(trip()).objectValue)
        XCTAssertNil(wire["sourceId"])
        XCTAssertEqual(wire["name"], "Australie")
    }

    func testStampsIdAndSourceFromTheRequestNeverFromTheBody() throws {
        var body = try XCTUnwrap(toWireDoc(trip()).objectValue)
        body["id"] = "lying"
        body["sourceId"] = "elsewhere"
        let doc = try fromWireDoc(trip: .object(body), "real-id", host)
        XCTAssertEqual(doc.id, "real-id")
        XCTAssertEqual(doc.sourceId, host)
    }

    func testMigratesAnOlderStoredCopyLikeAnOlderStoredTrip() throws {
        // v6 → v7 is the step that fills `hookDefaults`.
        var body = try XCTUnwrap(toWireDoc(trip()).objectValue)
        body["version"] = 6
        body["hookDefaults"] = nil
        let doc = try fromWireDoc(trip: .object(body), "t1", host)
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertEqual(doc.hookDefaults, [:])
    }

    func testRefusesABodyThatIsNotATrip() {
        for body: JSONValue in [["hello": "world"], nil] {
            XCTAssertThrowsError(try fromWireDoc(trip: body, "t1", host)) { error in
                XCTAssertTrue((error as? WinnowError)?.message.contains("not a trip") == true)
            }
        }
    }

    func testKnowsLocalFromRemote() {
        XCTAssertFalse(isRemoteSource("local"))
        XCTAssertTrue(isRemoteSource(host))
    }
}

final class TripRemoteFailureTests: XCTestCase {
    func testMapsTheClientsKindsOntoTheReducersKeepingTheServersCopyOnAConflict() {
        let err = WinnowError(.conflict, "stale", status: 412, theirs: TheirCopy(etag: "e9", updatedAt: nil))
        XCTAssertEqual(failureOf(err), RemoteFailure(kind: .conflict, message: "stale", theirs: TheirCopy(etag: "e9", updatedAt: nil)))
        XCTAssertEqual(failureOf(WinnowError(.notfound, "gone", status: 404)).kind, .notfound)
        let odd = failureOf(Boom())
        XCTAssertEqual(odd.kind, .protocol)
        XCTAssertEqual(odd.message, "boom")
    }

    func testALostSessionComesWithThePlaceToSignIn() {
        let r = remote(WinnowStub(json: [:]))
        let e = explainFailure(RemoteFailure(kind: .unauthenticated, message: "x", theirs: nil), r)
        XCTAssertTrue(e.text.contains(host))
        XCTAssertEqual(e.login, "https://\(host)/login")
    }

    func testUnreachableSaysWhatIsBeingShownInstead() {
        let r = remote(WinnowStub(json: [:]))
        XCTAssertTrue(explainFailure(RemoteFailure(kind: .unreachable, message: "x", theirs: nil), r).text
            .contains("this device holds"))
    }
}

final class TripRemotePushTests: XCTestCase {
    func testPUTsTheWireDocUnderKindTripWithTheHeldEtagAndLandsSyncedOnTheNewOne() async throws {
        let stub = WinnowStub { _, _ in .json(["etag": "e2", "updated_at": "x"], headers: ["etag": "e2"]) }
        let doc = trip()
        var held = newSyncRecord(id: doc.id, sourceId: host, now: 1)
        held.etag = "e1"
        let store = MemoryTripStore()
        let rec = await pushTrip(remote(stub), doc, held, store: store, now: 5, clock: { 6 })
        XCTAssertEqual(rec.status, .synced)
        XCTAssertEqual(rec.etag, "e2")
        XCTAssertEqual(store.records[doc.id], rec)
        let req = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(req.path, "/api/apps/atelier/docs/\(doc.id)")
        XCTAssertEqual(req.header("if-match"), "e1")
        let body = try XCTUnwrap(requestBody(req)?.objectValue)
        XCTAssertEqual(body["kind"], "trip")
        XCTAssertEqual(body["version"], .number(Double(tripDocVersion)))
        XCTAssertNil(body["doc"]?.objectValue?["sourceId"])
    }

    func testAFirstPushHasNoRecordAndNoIfMatch() async throws {
        let stub = WinnowStub { _, _ in .json(["etag": "e1", "updated_at": "x"]) }
        let rec = await pushTrip(remote(stub), trip(), nil, store: MemoryTripStore(), now: 5)
        XCTAssertEqual(rec.status, .synced)
        XCTAssertNil(try XCTUnwrap(stub.requests.first).header("if-match"))
    }

    func testA412LandsOnConflictWithTheServersCopyNothingThrown() async {
        let stub = WinnowStub(status: 412, text: #"{"error":"stale","etag":"e9","updated_at":"2026-09-06T14:02:00Z"}"#)
        let rec = await pushTrip(remote(stub), trip(), nil, store: MemoryTripStore(), now: 5)
        XCTAssertEqual(rec.status, .conflict)
        XCTAssertEqual(rec.theirs, TheirCopy(etag: "e9", updatedAt: "2026-09-06T14:02:00Z"))
    }

    func testOfflineKeepsTheEditAndSaysSo() async {
        let stub = WinnowStub { _, _ in throw WinnowFetchFailed() }
        let rec = await pushTrip(remote(stub), trip(), nil, store: MemoryTripStore(), now: 5)
        XCTAssertEqual(rec.status, .offline)
        XCTAssertEqual(rec.dirtyAt, 5)
    }

    func testRefusesAnOversizeTripBeforeSendingAsADirtyRecordWithTheReason() async {
        let stub = WinnowStub(json: [:])
        let rec = await pushTrip(remote(stub, maxBytes: 64), trip(), nil, store: MemoryTripStore(), now: 5)
        XCTAssertTrue(stub.requests.isEmpty)
        XCTAssertEqual(rec.status, .dirty)
        XCTAssertTrue(rec.error?.contains("over the instance") == true)
    }
}

final class TripRemotePullTests: XCTestCase {
    func testSendsTheHeldEtagAndReadsA304AsCurrent() async throws {
        let stub = WinnowStub(status: 304)
        let result = await pullTrip(remote(stub), "t1", "e1")
        XCTAssertEqual(result, .current)
        XCTAssertEqual(try XCTUnwrap(stub.requests.first).header("if-none-match"), "e1")
    }

    func testFetchesStampsAndMigratesTheServersCopy() async {
        let row: JSONValue = ["id": "t1", "kind": "trip", "version": 10, "updated_at": "u", "etag": "e2",
                              "doc": toWireDoc(trip())]
        let result = await pullTrip(remote(WinnowStub { _, _ in .json(row, headers: ["etag": "e2"]) }), "t1", nil)
        guard case .fetched(let doc, let etag, _) = result else { return XCTFail("fetched, got \(result)") }
        XCTAssertEqual(doc.id, "t1")
        XCTAssertEqual(doc.sourceId, host)
        XCTAssertEqual(etag, "e2")
    }

    func testNeverThrowsA404IsAFailureTheCallerReadsAsGone() async {
        let result = await pullTrip(remote(WinnowStub(status: 404)), "t1", nil)
        guard case .failed(let failure) = result else { return XCTFail("failed, got \(result)") }
        XCTAssertEqual(failure.kind, .notfound)
    }
}

final class TripRemoteListTests: XCTestCase {
    func testListsByKindAndSkipsARowThatIsNotATrip() async throws {
        let stub = WinnowStub(json: [
            "docs": [
                ["id": "t1", "kind": "trip", "version": 10, "updated_at": "u", "etag": "e1", "doc": toWireDoc(trip())],
                ["id": "junk", "kind": "trip", "version": 10, "updated_at": "u", "etag": "e2", "doc": ["nope": 1]],
            ],
        ])
        let rows = try await listRemoteTrips(remote(stub))
        XCTAssertEqual(rows.map(\.doc.id), ["t1"])
        XCTAssertEqual(rows[0].doc.sourceId, host)
        XCTAssertEqual(stub.requests.first?.queryValue("kind"), "trip")
    }
}

// No web spec: the store's list reader, the mirror and the move, which the web
// drives from its shell.
final class TripRemoteStoreMoveTests: XCTestCase {
    func testReadsTheStoredTripsMigratedMostRecentlyUpdatedFirst() {
        var older = createTripDoc("Older", "2025-07-01", "2025-07-10", now: 10, id: "a")
        older.version = 9
        let newer = createTripDoc("Newer", "2025-07-01", "2025-07-10", now: 20, id: "b")
        let list = readTripList([older.json, "not a trip", newer.json])
        XCTAssertEqual(list.map(\.id), ["b", "a"])
        XCTAssertEqual(list[1].version, tripDocVersion)
    }

    func testMirrorsAServerCopyWithACleanRecordBesideIt() async {
        let store = MemoryTripStore()
        let doc = trip()
        let rec = await mirrorTrip(host, doc, "e7", store: store, now: 9)
        XCTAssertEqual(store.trips[doc.id], doc)
        XCTAssertEqual(rec.status, .synced)
        XCTAssertEqual(rec.etag, "e7")
        XCTAssertEqual(store.records[doc.id], rec)
    }

    func testMovingToTheSameSourceChangesNothing() async {
        let doc = trip()
        let result = await moveTrip(doc, host, store: MemoryTripStore(), remoteFor: { _ in nil })
        XCTAssertEqual(result, .moved(doc))
    }

    func testMovesALocalTripOntoAnInstanceKeepingItsIdAndDroppingItsProjectLinks() async {
        let stub = WinnowStub { _, _ in .json(["etag": "e1", "updated_at": "x"], headers: ["etag": "e1"]) }
        let store = MemoryTripStore()
        var doc = createTripDoc("Australie", "2025-07-01", "2025-07-10", now: 3, id: "t-1")
        var post = createTripPost(.reel, "2025-07-03", "Gorge")
        post.projectId = "studio-here"
        doc.posts = [post]
        let result = await moveTrip(doc, host, store: store, remoteFor: { $0 == host ? remote(stub) : nil },
                                    now: 50, clock: { 51 })
        guard case .moved(let moved) = result else { return XCTFail("moved, got \(result)") }
        XCTAssertEqual(moved.id, "t-1")
        XCTAssertEqual(moved.sourceId, host)
        XCTAssertEqual(moved.createdAt, 3)
        XCTAssertEqual(moved.updatedAt, 50)
        XCTAssertNil(moved.posts[0].projectId)
        XCTAssertEqual(store.trips["t-1"]?.sourceId, host)
        XCTAssertEqual(store.records["t-1"]?.status, .synced)
        XCTAssertEqual(stub.requests.map(\.method), ["PUT"])
    }

    func testMovesAnInstancesTripHomeDeletingTheOriginsCopyWithItsEtag() async {
        let stub = WinnowStub { _, _ in .json([:]) }
        let store = MemoryTripStore()
        let doc = trip()
        store.records[doc.id] = SyncRecord(id: doc.id, sourceId: host, etag: "e5", status: .synced)
        let result = await moveTrip(doc, "local", store: store, remoteFor: { $0 == host ? remote(stub) : nil })
        guard case .moved(let moved) = result else { return XCTFail("moved, got \(result)") }
        XCTAssertEqual(moved.sourceId, "local")
        XCTAssertEqual(stub.requests.first?.method, "DELETE")
        XCTAssertEqual(stub.requests.first?.header("if-match"), "e5")
        XCTAssertNil(store.records[doc.id])
    }

    func testRefusesAMoveItCannotFinishAndSaysWhy() async {
        var local = trip()
        local.sourceId = "local"
        let noBucket = await moveTrip(local, host, store: MemoryTripStore(), remoteFor: { _ in nil })
        XCTAssertEqual(noBucket, .failed("\(host) cannot hold trips."))

        let away = await moveTrip(trip(), "local", store: MemoryTripStore(), remoteFor: { _ in nil })
        XCTAssertEqual(away, .failed("\(host) is not connected — connect it to move this trip away."))

        let refused = WinnowStub(status: 403, text: #"{"error":"viewer"}"#)
        let store = MemoryTripStore()
        let failed = await moveTrip(local, host, store: store, remoteFor: { _ in remote(refused) })
        guard case .failed(let message) = failed else { return XCTFail("failed, got \(failed)") }
        XCTAssertTrue(message.hasPrefix("Could not save to \(host)"))
        // Nothing was left behind: no record, and the document stays where it was.
        XCTAssertNil(store.records[local.id])
        XCTAssertNil(store.trips[local.id])
    }
}
