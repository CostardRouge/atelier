// The connections this device keeps: nothing is stored unless the instance
// answered; the token goes to the Keychain and NEVER into the connections
// file; a 401 is the token refused; a connection restored without its token
// says so instead of failing with a bare 401; forgetting takes the token and
// the row and nothing else; the probe IS the refresh and a connection keeps
// its place; a gallery re-asks only an instance its stored sheet leaves out,
// once a session, and the absence then speaks.

import AtelierKit
import Foundation
import XCTest
@testable import Atelier

final class ConnectionStoreTests: XCTestCase {
    private let bucket = StubDocBucket()
    private let root = sourcesScratch()
    private let credentials = MemoryCredentials()
    private var time: Double = 50_000

    @MainActor private func makeStore() -> ConnectionStore {
        ConnectionStore(root: root, credentials: credentials, transport: bucket.transport, clock: { [unowned self] in self.time })
    }

    private var file: URL { root.appendingPathComponent("sources/winnow.v1.json") }

    @MainActor func testNothingIsStoredUnlessTheInstanceAnswers() async {
        let store = makeStore()
        bucket.offline = true
        let outcome = await store.connect(address: "https://w.example", token: "tok")
        guard case .failed(let text) = outcome else { return XCTFail("offline must fail: \(outcome)") }
        XCTAssertTrue(text.contains("did not answer"), text)
        XCTAssertFalse(text.contains("browser"), "the kernel's words are said as this device's: \(text)")
        XCTAssertTrue(store.connections.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertNil(credentials.token(for: "w.example"))
    }

    @MainActor func testTheTokenIsKeptInTheKeychainNeverInTheFile() async throws {
        let store = makeStore()
        let outcome = await store.connect(address: "https://W.example/", token: "  s3cret  ")
        guard case .connected(let conn) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertEqual(conn.id, "w.example")
        XCTAssertEqual(conn.baseUrl, "https://w.example")
        XCTAssertEqual(conn.auth, .token("s3cret"))
        XCTAssertEqual(conn.refreshedAt, time)
        XCTAssertEqual(credentials.token(for: "w.example"), "s3cret")
        XCTAssertEqual(store.healthOf("w.example").state, .reachable)

        let text = try String(contentsOf: file, encoding: .utf8)
        XCTAssertFalse(text.contains("s3cret"), "the secret never touches the connections file")
        let stored = try XCTUnwrap(JSONValue.parse(text)?.arrayValue?.first?.objectValue)
        XCTAssertEqual(stored["auth"], ["mode": "token"])
        XCTAssertEqual(stored["capabilities"], bucket.sheet, "the sheet is kept as the instance sent it")

        let reopened = makeStore()
        XCTAssertEqual(reopened.connections.first?.auth, .token("s3cret"), "the token comes back from the Keychain")
        XCTAssertTrue(reopened.missingTokens.isEmpty)
        let caps = try XCTUnwrap(reopened.capabilities(of: "w.example"))
        XCTAssertTrue(bucketHolds(caps, "roll"))
        XCTAssertEqual(bucket.requests.count, 1, "loading makes no request")
    }

    @MainActor func testTheOneRequestCarriesTheBearer() async {
        let store = makeStore()
        _ = await store.connect(address: "https://w.example", token: "tok")
        XCTAssertEqual(bucket.requests.map(\.path), ["/api/capabilities"])
        XCTAssertEqual(bucket.requests.first?.header("Authorization"), "Bearer tok")
        XCTAssertEqual(bucket.requests.first?.credentials, .omit)
    }

    @MainActor func testARefusedTokenPointsAtTheInstance() async {
        let store = makeStore()
        bucket.unauthorised = true
        let outcome = await store.connect(address: "https://w.example", token: "stale")
        XCTAssertEqual(outcome, .refused(loginUrl: "https://w.example/login"))
        XCTAssertTrue(store.connections.isEmpty)
        XCTAssertNil(credentials.token(for: "w.example"))
    }

    @MainActor func testAKeychainThatRefusesTheTokenStoresNothing() async {
        credentials.refuseWrites = true
        let store = makeStore()
        let outcome = await store.connect(address: "https://w.example", token: "tok")
        guard case .failed(let text) = outcome else { return XCTFail("\(outcome)") }
        XCTAssertTrue(text.contains("could not be kept on this device"), text)
        XCTAssertTrue(store.connections.isEmpty)
    }

    @MainActor func testAConnectionRestoredWithoutItsTokenSaysSo() async throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"[{"id":"w.example","baseUrl":"https://w.example","auth":{"mode":"token"},"capabilities":null,"connectedAt":1}]"#.utf8)
            .write(to: file)
        let store = makeStore()
        XCTAssertEqual(store.missingTokens, ["w.example"])
        await store.check("w.example")
        let health = store.healthOf("w.example")
        XCTAssertEqual(health.state, .signin)
        XCTAssertTrue(health.reason?.contains("holds no token") == true, health.reason ?? "")
        XCTAssertTrue(bucket.requests.isEmpty, "no request with an empty token")
    }

    @MainActor func testForgettingTakesTheTokenAndTheRowAndNothingElse() async {
        let store = makeStore()
        _ = await store.connect(address: "https://w.example", token: "tok")
        store.forget("w.example")
        XCTAssertTrue(store.connections.isEmpty)
        XCTAssertNil(credentials.token(for: "w.example"))
        XCTAssertTrue(makeStore().connections.isEmpty)
        XCTAssertEqual(bucket.requests.count, 1, "nothing is deleted there")
    }

    @MainActor func testTheProbeIsTheRefreshAndAConnectionKeepsItsPlace() async throws {
        let store = makeStore()
        _ = await store.connect(address: "https://a.example", token: "a")
        _ = await store.connect(address: "https://b.example", token: "b")
        XCTAssertEqual(store.first?.id, "a.example")
        bucket.sheet = ["api": ["version": 2], "documents": ["bucket": true, "kinds": ["roll"]]]
        time += 60_000
        await store.check("a.example")
        XCTAssertEqual(store.connections.map(\.id), ["a.example", "b.example"], "first stays first")
        let a = try XCTUnwrap(store.connection("a.example"))
        XCTAssertEqual(a.refreshedAt, time)
        XCTAssertEqual(a.capabilities?.api?.version, 2)
        XCTAssertEqual(store.healthOf("a.example").state, .reachable)
    }

    @MainActor func testAnUnreachableInstanceIsSaidInThisDevicesWords() async throws {
        let store = makeStore()
        _ = await store.connect(address: "https://w.example", token: "tok")
        bucket.offline = true
        await store.check("w.example")
        let health = store.healthOf("w.example")
        XCTAssertEqual(health.state, .unreachable)
        XCTAssertEqual(health.reason, "No answer from w.example. It may be offline, or the address may be wrong.")
        bucket.offline = false
        bucket.unauthorised = true
        await store.check("w.example")
        XCTAssertEqual(store.healthOf("w.example").state, .signin)
        XCTAssertTrue(store.healthOf("w.example").reason?.contains("Reconnect") == true)
    }

    @MainActor func testAGalleryProbesOnlyWhatItsSheetHidesOnceASession() async throws {
        bucket.sheet = ["documents": ["bucket": true, "kinds": ["trip", "project"]]]
        let store = makeStore()
        _ = await store.connect(address: "https://w.example", token: "tok")
        XCTAssertTrue(store.documentSources(for: "roll").map(\.id) == ["local"], "a sheet with no roll hides the instance")
        XCTAssertEqual(store.absences(for: "roll", noun: "roll").first?.text, nil, "nothing said before it is asked")

        await store.probeHidden(kind: "roll")
        await store.probeHidden(kind: "roll")
        XCTAssertEqual(bucket.requests.count, 2, "one connect, one probe — never a second")
        XCTAssertEqual(store.absences(for: "roll", noun: "roll").first?.text,
                       "w.example does not keep rolls — asked again just now, so this is its own version and not a stale answer here.")

        await store.probeHidden(kind: "trip")
        XCTAssertEqual(bucket.requests.count, 2, "a healthy gallery makes no request at all")
    }

    @MainActor func testAStaleSheetIsCuredByTheProbe() async throws {
        bucket.sheet = ["documents": ["bucket": true]]
        let store = makeStore()
        _ = await store.connect(address: "https://w.example", token: "tok")
        XCTAssertNil(store.remote(for: "w.example", kind: "roll"), "a sheet with no kinds list knew trips and projects only")
        bucket.sheet = ["documents": ["bucket": true, "kinds": ["trip", "project", "roll"]]]
        let probe = await store.refreshCapabilitiesOnce("w.example")
        XCTAssertEqual(probe, .read)
        XCTAssertNotNil(store.remote(for: "w.example", kind: "roll"))
        XCTAssertEqual(store.documentSources(for: "roll").map(\.id), ["local", "w.example"])
    }

    func testTheStoredListIsReadLeniently() {
        let raw = JSONValue.parse(#"""
        [
          {"id":"a.example","baseUrl":"https://a.example","auth":{"mode":"cookie"},"capabilities":{"api":{"version":1}},"connectedAt":5,"refreshedAt":7},
          {"id":"b.example","baseUrl":"https://b.example","auth":{"mode":"token","token":"leaked-by-an-old-build"},"connectedAt":6},
          {"id":"local","baseUrl":"x","auth":{"mode":"cookie"}},
          {"id":"a.example","baseUrl":"https://dup","auth":{"mode":"cookie"}},
          {"baseUrl":"https://noid","auth":{"mode":"cookie"}},
          {"id":"c.example","baseUrl":"https://c.example"},
          "junk"
        ]
        """#)
        let list = readStoredConnections(raw)
        XCTAssertEqual(list.map(\.id), ["a.example", "b.example"])
        XCTAssertEqual(list[0].auth, .cookie)
        XCTAssertEqual(list[0].capabilities?.api?.version, 1)
        XCTAssertEqual(list[0].refreshedAt, 7)
        XCTAssertEqual(list[1].auth, .token(""), "a token is never read from the file")
        XCTAssertNil(list[1].refreshedAt)
        XCTAssertEqual(readStoredConnections(storedConnectionsJSON(list)), list)
    }

    func testTheAddressIsJudgedAsItIsTyped() {
        let typed = ConnectDraft(address: " https://Winnow.Example/ ")
        XCTAssertEqual(typed.baseUrl, "https://winnow.example")
        XCTAssertEqual(typed.sourceId, "winnow.example")
        XCTAssertNil(typed.problem)
        XCTAssertEqual(ConnectDraft(address: "http://winnow.example").problem, "An instance must be reached over https.")
        XCTAssertEqual(ConnectDraft(address: "https://winnow.example/app").problem,
                       "Give the instance origin only — no path, no query.")
        XCTAssertEqual(ConnectDraft(address: "http://localhost:5174").sourceId, "localhost:5174")
        let empty = ConnectDraft(address: "   ")
        XCTAssertNil(empty.baseUrl)
        XCTAssertNil(empty.problem, "an empty field is not an error yet")
    }

    func testTheKernelsSentencesAreSaidAsThisDevices() {
        XCTAssertEqual(deviceWords(forgetWarning("w.example", DocCount(rolls: 3))),
                       "Forget w.example? 3 rolls came from it — those stay on the instance, and connecting again brings them back, but this device stops listing and saving them.")
        XCTAssertEqual(deviceWords(sourceLabel("local")), "this device")
    }
}

// MARK: - the gallery half

final class DocumentGalleryModelTests: XCTestCase {
    private let bucket = StubDocBucket()
    private let root = sourcesScratch()

    @MainActor private func makeGallery() async -> DocumentGalleryModel<RollDoc> {
        let connections = ConnectionStore(root: root, credentials: MemoryCredentials(), transport: bucket.transport)
        _ = await connections.connect(address: "https://w.example", token: "tok")
        return DocumentGalleryModel<RollDoc>(store: DocumentStore(root: root), connections: connections)
    }

    @MainActor func testANewDocumentOnAnInstanceIsWrittenThereFirst() async {
        let gallery = await makeGallery()
        let roll = sourcesRoll(sourceId: "w.example")
        let created = await gallery.createOn(roll, verb: "created")
        XCTAssertTrue(created)
        XCTAssertEqual(bucket.rows[roll.id]?.doc, roll.wireDoc)
        XCTAssertEqual(gallery.store.get(roll.id), roll)
        XCTAssertEqual(gallery.store.getSyncRecord(roll.id)?.status, .synced)
    }

    @MainActor func testARefusedCreationKeepsNothingHere() async {
        let gallery = await makeGallery()
        bucket.refuseWrites = true
        let roll = sourcesRoll(sourceId: "w.example")
        let created = await gallery.createOn(roll, verb: "created")
        XCTAssertFalse(created)
        XCTAssertEqual(gallery.notice, "Could not save to w.example: This account is not allowed to do that. — nothing was created.")
        XCTAssertNil(gallery.store.get(roll.id))
        XCTAssertNil(gallery.store.getSyncRecord(roll.id))
    }

    @MainActor func testADeleteIsRefusedWhileTheInstanceCannotBeReached() async {
        let gallery = await makeGallery()
        let roll = sourcesRoll(sourceId: "w.example")
        _ = await gallery.createOn(roll, verb: "created")
        bucket.offline = true
        let removed = await gallery.remove(roll)
        XCTAssertFalse(removed, "no tombstones")
        XCTAssertEqual(gallery.notice, "Connect to w.example to delete this roll — it is kept there.")
        XCTAssertNotNil(gallery.store.get(roll.id))
    }

    @MainActor func testADeleteThereTakesTheMirrorHere() async {
        let gallery = await makeGallery()
        let roll = sourcesRoll(sourceId: "w.example")
        _ = await gallery.createOn(roll, verb: "created")
        let removed = await gallery.remove(roll)
        XCTAssertTrue(removed)
        XCTAssertNil(bucket.rows[roll.id])
        XCTAssertNil(gallery.store.get(roll.id))
        XCTAssertEqual(bucket.requests("DELETE").first?.header("If-Match"), "\"e1\"", "with the revision held")
    }

    @MainActor func testWhatExistsOnlyThereIsListedBesideTheMirrors() async throws {
        let gallery = await makeGallery()
        gallery.store.put(sourcesRoll("here", sourceId: "local"))
        bucket.changeElsewhere("there", sourcesRoll("there").wireDoc)
        await gallery.refresh()
        let there = try XCTUnwrap(gallery.groups.first { $0.id == "w.example" })
        XCTAssertEqual(there.remoteOnly.map(\.doc.id), ["there"])
        XCTAssertEqual(gallery.groups.first?.id, "local")
        XCTAssertTrue(gallery.allListed)

        let mirrored = gallery.mirrorRemote(there.remoteOnly[0])
        XCTAssertEqual(mirrored.id, "there")
        XCTAssertEqual(gallery.store.getSyncRecord("there")?.status, .synced)
    }

    @MainActor func testAMoveWritesTheTargetFirstThenDeletesTheOrigin() async throws {
        let gallery = await makeGallery()
        let roll = sourcesRoll(sourceId: "local")
        gallery.store.put(roll)
        await gallery.moveTo(roll, "w.example")
        XCTAssertNil(gallery.notice)
        XCTAssertEqual(gallery.store.get(roll.id)?.sourceId, "w.example")
        XCTAssertNotNil(bucket.rows[roll.id])

        let kept = try XCTUnwrap(gallery.store.get(roll.id))
        await gallery.moveTo(kept, "local")
        XCTAssertNil(bucket.rows[roll.id], "the origin's copy goes once the target has it")
        XCTAssertEqual(gallery.store.get(roll.id)?.sourceId, "local")
        XCTAssertNil(gallery.store.getSyncRecord(roll.id))
    }
}
