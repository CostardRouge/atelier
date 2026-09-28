// Port of `src/shared/projects/project-remote.test.ts`, case for case, over
// the Winnow specs' stub instance (`WinnowStub`, the web's `vi.fn(fetch)`)
// and an in-memory `ProjectStore` (the web's IndexedDB). A block with no web
// twin pins the mirror and the move — the web drives those from its shell.

import XCTest
@testable import AtelierKit

private let host = "winnow.example"

private func remote(_ stub: WinnowStub) -> RemoteSource {
    RemoteSource(sourceId: host, label: host, client: stub.client(), maxBytes: nil)
}

/// A project with everything a machine binds: a bookmark, a thumbnail, media refs.
private func project() -> ProjectDoc {
    var doc = createProjectDoc("Vol du soir", "9:16", [], .default, now: 1000, id: "p-1")
    doc.sourceId = host
    doc.media = ProjectMedia(
        dirHandle: Data("clips".utf8),
        files: [SavedMediaRef(name: "DJI_0001.MP4", size: 10, lastModified: 1, hash: "abc")],
        activeId: "dji_0001",
        trims: ["dji_0001": SavedTrim(start: 1, end: 5, duration: 9)],
        develops: ["dji_0001": SavedDevelop(settings: dev { $0.exposure = 0.7 }, hash: "abc")]
    )
    doc.thumbnail = Data("jpeg".utf8)
    return doc
}

/// The web's IndexedDB store, in memory.
private final class MemoryStore: ProjectStore {
    var docs: [String: ProjectDoc] = [:]
    var records: [String: SyncRecord] = [:]

    func listProjects() async -> [ProjectDoc] {
        readProjectList(docs.values.map(\.json))
    }
    func getProject(_ id: String) async -> ProjectDoc? { docs[id] }
    func putProject(_ doc: ProjectDoc) async -> Bool {
        docs[doc.id] = doc
        return true
    }
    func deleteProject(_ id: String) async { docs[id] = nil }
    func getSyncRecord(_ id: String) async -> SyncRecord? { records[id] }
    func putSyncRecord(_ record: SyncRecord) async -> Bool {
        records[record.id] = record
        return true
    }
    func deleteSyncRecord(_ id: String) async { records[id] = nil }
}

private func requestBody(_ request: WinnowRequest) -> JSONValue? {
    guard case .text(let text)? = request.body else { return nil }
    return JSONValue.parse(text)
}

final class ProjectWireShapeTests: XCTestCase {
    func testSendsEverythingButWhatIsThisMachinesSourceHandleThumbnail() throws {
        let wire = try XCTUnwrap(toWireDoc(project()).objectValue)
        XCTAssertNil(wire["sourceId"])
        XCTAssertNil(wire["thumbnail"])
        let media = try XCTUnwrap(wire["media"]?.objectValue)
        XCTAssertNil(media["dirHandle"])
        // The media LIST travels — that is how the project finds its clips elsewhere.
        XCTAssertEqual(media["files"]?.arrayValue?.first?.objectValue?["hash"], "abc")
        XCTAssertEqual(media["trims"]?.objectValue?["dji_0001"]?.objectValue?["start"], 1)
        // So does a develop: it addresses the same media, by the same key.
        let develop = media["develops"]?.objectValue?["dji_0001"]?.objectValue?["settings"]?.objectValue
        XCTAssertEqual(develop?["exposure"], 0.7)
        XCTAssertEqual(media["activeId"], "dji_0001")
        XCTAssertFalse(toWireDoc(project()).serialized().contains("thumbnail"))
    }

    func testStampsIdAndSourceFromTheRequestAndKeepsTheMirrorsHandleAndThumbnail() throws {
        let local = project()
        var body = try XCTUnwrap(toWireDoc(project()).objectValue)
        body["id"] = "lying"
        body["sourceId"] = "elsewhere"
        let doc = try fromWireDoc(.object(body), "real-id", host, local: local)
        XCTAssertEqual(doc.id, "real-id")
        XCTAssertEqual(doc.sourceId, host)
        XCTAssertEqual(doc.media.dirHandle, local.media.dirHandle)
        XCTAssertEqual(doc.thumbnail, local.thumbnail)
        XCTAssertEqual(doc.media.files[0].hash, "abc")
    }

    func testACopyWithNoMirrorHasNoHandleAndNoThumbnailNeverAFabricatedOne() throws {
        let doc = try fromWireDoc(toWireDoc(project()), "p1", host, local: nil)
        XCTAssertNil(doc.media.dirHandle)
        XCTAssertNil(doc.thumbnail)
    }

    func testMigratesAnOlderStoredCopyLikeAnOlderStoredProject() throws {
        var body = try XCTUnwrap(toWireDoc(project()).objectValue)
        body["version"] = 11
        body["scenes"] = nil
        let doc = try fromWireDoc(.object(body), "p1", host, local: nil)
        XCTAssertEqual(doc.version, projectDocVersion)
        XCTAssertEqual(doc.scenes, [])
    }

    func testRefusesABodyThatIsNotAProject() {
        for body: JSONValue in [["hello": "world"], nil] {
            XCTAssertThrowsError(try fromWireDoc(body, "p1", host, local: nil)) { error in
                XCTAssertTrue((error as? WinnowError)?.message.contains("not a project") == true)
                XCTAssertEqual((error as? WinnowError)?.kind, .protocol)
            }
        }
    }
}

final class ProjectPushPullListTests: XCTestCase {
    func testPUTsUnderKindProjectWithTheHeldEtag() async throws {
        let stub = WinnowStub { _, _ in .json(["etag": "e2", "updated_at": "x"], headers: ["etag": "e2"]) }
        let doc = project()
        let store = MemoryStore()
        let rec = await pushProject(remote(stub), doc, nil, store: store, now: 5, clock: { 6 })
        XCTAssertEqual(rec.status, .synced)
        XCTAssertEqual(store.records[doc.id], rec)
        let req = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(req.path, "/api/apps/atelier/docs/\(doc.id)")
        let body = try XCTUnwrap(requestBody(req)?.objectValue)
        XCTAssertEqual(body["kind"], "project")
        XCTAssertEqual(body["version"], .number(Double(projectDocVersion)))
        XCTAssertNil(body["doc"]?.objectValue?["media"]?.objectValue?["dirHandle"])
    }

    func testAPullKeepsThisDevicesHandleOnTheFetchedCopy() async throws {
        let local = project()
        var wire = try XCTUnwrap(toWireDoc(local).objectValue)
        wire["name"] = "Renamed there"
        let row: JSONValue = [
            "id": .string(local.id), "kind": "project", "version": .number(Double(projectDocVersion)),
            "updated_at": "u", "etag": "e2", "doc": .object(wire),
        ]
        let stub = WinnowStub { _, _ in .json(row, headers: ["etag": "e2"]) }
        let result = await pullProject(remote(stub), local.id, "e1", local)
        guard case .fetched(let doc, let etag, _) = result else { return XCTFail("fetched, got \(result)") }
        XCTAssertEqual(doc.name, "Renamed there")
        XCTAssertEqual(doc.media.dirHandle, local.media.dirHandle)
        XCTAssertEqual(etag, "e2")
    }

    func testListsByKindAndSkipsARowThatIsNotAProject() async throws {
        let stub = WinnowStub(json: [
            "docs": [
                ["id": "p1", "kind": "project", "version": .number(Double(projectDocVersion)), "updated_at": "u",
                 "etag": "e1", "doc": toWireDoc(project())],
                ["id": "junk", "kind": "project", "version": 1, "updated_at": "u", "etag": "e2", "doc": ["nope": 1]],
            ],
        ])
        let rows = try await listRemoteProjects(remote(stub))
        XCTAssertEqual(rows.map(\.doc.id), ["p1"])
        XCTAssertEqual(stub.requests.first?.queryValue("kind"), "project")
    }

    // No web case: a 304 is "current", and a failure is said, never thrown.
    func testAPullSaysCurrentOnA304AndFailedOnAnError() async {
        let current = await pullProject(remote(WinnowStub(status: 304)), "p1", "e1", nil)
        XCTAssertEqual(current, .current)
        let failed = await pullProject(remote(WinnowStub(status: 404, text: #"{"error":"Not found"}"#)), "p1", nil, nil)
        guard case .failed(let failure) = failed else { return XCTFail("failed, got \(failed)") }
        XCTAssertEqual(failure.kind, .notfound)
    }
}

// No web spec: the mirror and the move, which the web drives from its shell.
final class ProjectMirrorMoveTests: XCTestCase {
    func testMirrorsAServerCopyWithACleanRecordBesideIt() async {
        let store = MemoryStore()
        let doc = project()
        let rec = await mirrorProject(host, doc, "e7", store: store, now: 9)
        XCTAssertEqual(store.docs[doc.id], doc)
        XCTAssertEqual(rec.status, .synced)
        XCTAssertEqual(rec.etag, "e7")
        XCTAssertEqual(store.records[doc.id], rec)
    }

    func testMovingToTheSameSourceChangesNothing() async {
        let doc = project()
        let result = await moveProject(doc, host, store: MemoryStore(), remoteFor: { _ in nil })
        XCTAssertEqual(result, .moved(doc))
    }

    func testMovesALocalProjectOntoAnInstanceTargetFirst() async throws {
        let stub = WinnowStub { _, _ in .json(["etag": "e1", "updated_at": "x"], headers: ["etag": "e1"]) }
        let store = MemoryStore()
        var doc = project()
        doc.sourceId = "local"
        let result = await moveProject(doc, host, store: store, remoteFor: { $0 == host ? remote(stub) : nil },
                                       now: 50, clock: { 51 })
        guard case .moved(let moved) = result else { return XCTFail("moved, got \(result)") }
        XCTAssertEqual(moved.sourceId, host)
        XCTAssertEqual(moved.updatedAt, 50)
        // The mirror keeps this device's bookmark and thumbnail.
        XCTAssertEqual(moved.media.dirHandle, doc.media.dirHandle)
        XCTAssertEqual(store.docs[doc.id]?.sourceId, host)
        XCTAssertEqual(store.records[doc.id]?.status, .synced)
        XCTAssertEqual(stub.requests.map(\.method), ["PUT"])
    }

    func testMovesAnInstancesProjectHomeDeletingTheOriginsCopyWithItsEtag() async {
        let stub = WinnowStub { _, _ in .json([:]) }
        let store = MemoryStore()
        let doc = project()
        store.records[doc.id] = SyncRecord(id: doc.id, sourceId: host, etag: "e5", status: .synced)
        let result = await moveProject(doc, "local", store: store, remoteFor: { $0 == host ? remote(stub) : nil })
        guard case .moved(let moved) = result else { return XCTFail("moved, got \(result)") }
        XCTAssertEqual(moved.sourceId, "local")
        XCTAssertEqual(stub.requests.first?.method, "DELETE")
        XCTAssertEqual(stub.requests.first?.header("if-match"), "e5")
        XCTAssertNil(store.records[doc.id])
    }

    func testRefusesAMoveItCannotFinishAndSaysWhy() async {
        var local = project()
        local.sourceId = "local"
        let noBucket = await moveProject(local, host, store: MemoryStore(), remoteFor: { _ in nil })
        XCTAssertEqual(noBucket, .failed("\(host) cannot hold projects."))

        let away = await moveProject(project(), "local", store: MemoryStore(), remoteFor: { _ in nil })
        XCTAssertEqual(away, .failed("\(host) is not connected — connect it to move this project away."))

        let refused = WinnowStub(status: 403, text: #"{"error":"viewer"}"#)
        let store = MemoryStore()
        let failed = await moveProject(local, host, store: store, remoteFor: { _ in remote(refused) })
        guard case .failed(let message) = failed else { return XCTFail("failed, got \(failed)") }
        XCTAssertTrue(message.hasPrefix("Could not save to \(host)"))
        // Nothing was left behind: no record, and the document stays where it was.
        XCTAssertNil(store.records[local.id])
        XCTAssertNil(store.docs[local.id])
    }
}
