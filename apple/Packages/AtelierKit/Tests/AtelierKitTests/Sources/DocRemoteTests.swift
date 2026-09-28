// `src/shared/sources/doc-remote.ts` has no spec of its own on the web; these
// pin its observable rules: which source is remote, which instance a push may
// go to, how a failure maps onto the reducer, and the one guarded PUT.

import Foundation
import XCTest
@testable import AtelierKit

private let bucketed = readWinnowCapabilities(["documents": ["bucket": true, "kinds": ["trip", "project", "roll"], "maxBytes": 1_048_576]])

private func connection(_ id: String = "winnow.example", _ caps: WinnowCapabilities? = bucketed) -> WinnowConnection {
    WinnowConnection(id: id, baseUrl: winnowBase, capabilities: caps, connectedAt: 0)
}

final class DocRemoteForTests: XCTestCase {
    private let stub = WinnowStub(json: [:])

    func testKnowsThisDeviceFromAnInstance() {
        XCTAssertFalse(isRemoteSource("local"))
        XCTAssertTrue(isRemoteSource("winnow.example"))
    }

    func testNamesNoRemoteForThisDeviceAHostNotConnectedOrOneWithoutABucket() {
        XCTAssertNil(remoteFor("local", connections: [connection()], transport: stub.transport))
        XCTAssertNil(remoteFor("other.example", connections: [connection()], transport: stub.transport))
        XCTAssertNil(remoteFor("winnow.example", connections: [connection(caps: nil)], transport: stub.transport))
        let noBucket = readWinnowCapabilities(["documents": ["bucket": false]])
        XCTAssertNil(remoteFor("winnow.example", connections: [connection("winnow.example", noBucket)], transport: stub.transport))
    }

    func testRefusesAKindTheBucketDoesNotKeepAPushWouldOnly400() {
        let tripsOnly = readWinnowCapabilities(["documents": ["bucket": true]])
        let conns = [connection("winnow.example", tripsOnly)]
        XCTAssertNil(remoteFor("winnow.example", kind: "roll", connections: conns, transport: stub.transport))
        XCTAssertNotNil(remoteFor("winnow.example", kind: "trip", connections: conns, transport: stub.transport))
    }

    func testIsReadyToTalkWithTheHostAsItsLabelAndTheInstancesCap() throws {
        let remote = try XCTUnwrap(remoteFor("winnow.example", kind: "roll", connections: [connection()],
                                             transport: stub.transport))
        XCTAssertEqual(remote.label, "winnow.example")
        XCTAssertEqual(remote.maxBytes, 1_048_576)
        XCTAssertEqual(remote.client.config.baseUrl, winnowBase)
    }
}

private func connection(caps: WinnowCapabilities?) -> WinnowConnection { connection("winnow.example", caps) }

final class DocRemoteFailureTests: XCTestCase {
    private struct Odd: Error, LocalizedError {
        var errorDescription: String? { "odd" }
    }

    func testMapsTheClientsErrorOntoTheReducersVocabulary() {
        let theirs = ConflictInfo(etag: "e9", updatedAt: "2026-09-06T14:02:00Z")
        XCTAssertEqual(failureOf(WinnowError(.conflict, "changed", status: 412, theirs: theirs)),
                       RemoteFailure(kind: .conflict, message: "changed", theirs: theirs))
        XCTAssertEqual(failureOf(WinnowError(.unreachable, "gone quiet")).kind, .unreachable)
        XCTAssertEqual(failureOf(Odd()), RemoteFailure(kind: .protocol, message: "odd", theirs: nil))
    }

    func testExplainsASignInWithTheInstancesLoginLinkAndSilenceAsWhatThisDeviceHolds() throws {
        let remote = try XCTUnwrap(remoteFor("winnow.example", connections: [connection()],
                                             transport: WinnowStub(json: [:]).transport))
        XCTAssertEqual(explainFailure(RemoteFailure(kind: .unauthenticated, message: "x", theirs: nil), remote),
                       FailureExplanation(text: "Not signed in to winnow.example.", login: "\(winnowBase)/login"))
        XCTAssertEqual(explainFailure(RemoteFailure(kind: .unreachable, message: "x", theirs: nil), remote).text,
                       "winnow.example is unreachable — showing what this device holds.")
        XCTAssertEqual(explainFailure(RemoteFailure(kind: .forbidden, message: "not yours", theirs: nil), remote).text,
                       "not yours")
    }

    func testTurnsAnOutcomeIntoTheEventTheReducerEats() {
        XCTAssertEqual(outcomeEvent(.ok(etag: "e2"), now: 7), .pushOk(etag: "e2", now: 7))
        let failure = RemoteFailure(kind: .conflict, message: "m", theirs: TheirCopy(etag: "e9", updatedAt: nil))
        XCTAssertEqual(outcomeEvent(.failed(failure), now: 7),
                       .pushFailed(kind: .conflict, message: "m", theirs: TheirCopy(etag: "e9", updatedAt: nil)))
        XCTAssertEqual(failureEvent(failure), outcomeEvent(.failed(failure), now: 0))
    }
}

final class DocRemotePutTests: XCTestCase {
    func testPutsOneDocumentGuardedByTheEtagItHolds() async throws {
        let stub = WinnowStub(json: ["etag": "e2", "updated_at": "2026-09-06T10:01:00Z"])
        let remote = try XCTUnwrap(remoteFor("winnow.example", connections: [connection()], transport: stub.transport))
        let outcome = await putDocOnce(remote, kind: "roll", id: "r1", version: 6, wireDoc: ["name": "A"], etag: "e1")
        XCTAssertEqual(outcome, .ok(etag: "e2"))
        let req = stub.requests[0]
        XCTAssertEqual(req.path, "/api/apps/atelier/docs/r1")
        XCTAssertEqual(req.header("if-match"), "e1")
    }

    func testNeverThrowsAConflictIsAnOutcomeCarryingTheServersRevision() async throws {
        let stub = WinnowStub(status: 412, text: #"{"etag":"e9","updated_at":"2026-09-06T14:02:00Z"}"#)
        let remote = try XCTUnwrap(remoteFor("winnow.example", connections: [connection()], transport: stub.transport))
        let outcome = await putDocOnce(remote, kind: "roll", id: "r1", version: 6, wireDoc: [:], etag: "e1")
        guard case .failed(let failure) = outcome else { return XCTFail("a refused push") }
        XCTAssertEqual(failure.kind, .conflict)
        XCTAssertEqual(failure.theirs, TheirCopy(etag: "e9", updatedAt: "2026-09-06T14:02:00Z"))
    }

    func testRefusesADocumentOverTheInstancesCapBeforeAnyByteTravels() async throws {
        let small = readWinnowCapabilities(["documents": ["bucket": true, "maxBytes": 16]])
        let stub = WinnowStub(json: [:])
        let remote = try XCTUnwrap(remoteFor("winnow.example", connections: [connection("winnow.example", small)],
                                             transport: stub.transport))
        let outcome = await putDocOnce(remote, kind: "trip", id: "t1", version: 1, wireDoc: ["pad": "0123456789"], etag: nil)
        guard case .failed(let failure) = outcome else { return XCTFail("an oversize push") }
        XCTAssertEqual(failure.kind, .protocol)
        XCTAssertEqual(stub.requests.count, 0)
    }
}
