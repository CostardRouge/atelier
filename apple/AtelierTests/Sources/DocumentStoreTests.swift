// The one on-disk store for the three documents: a document written is the
// web's JSON exactly as `RollStore` writes it and reads back equal; its sync
// record and its thumbnail are SIDECARS a listing never mistakes for a
// document, and a delete takes all three; an id an instance listed can never
// name a path outside the folder; and the ledger counts every kind per source
// without needing its type.

import AtelierKit
import Foundation
import XCTest
@testable import Atelier

final class DocumentStoreTests: XCTestCase {
    func testARollIsWrittenAsTheWebsJSONAndReadBackEqual() throws {
        let root = sourcesScratch()
        let store = DocumentStore<RollDoc>(root: root)
        let roll = sourcesRoll(sourceId: "local")
        XCTAssertTrue(store.put(roll))
        XCTAssertEqual(store.get(roll.id), roll)
        let text = try String(contentsOf: root.appendingPathComponent("rolls/r1.json"), encoding: .utf8)
        XCTAssertEqual(text, roll.json.serialized(pretty: true), "the same bytes RollStore writes")
    }

    func testAProjectRoundTrips() {
        let store = DocumentStore<ProjectDoc>(root: sourcesScratch())
        var project = createProjectDoc("Flight", "16:9", [], .default, now: 2_000, id: "p1")
        project.sourceId = "w.example"
        XCTAssertTrue(store.put(project))
        XCTAssertEqual(store.get("p1")?.json, project.json)
        XCTAssertEqual(store.list().map(\.id), ["p1"])
    }

    func testTheListIsNewestFirstAndSkipsEverySidecar() throws {
        let root = sourcesScratch()
        let store = DocumentStore<RollDoc>(root: root)
        store.put(sourcesRoll("old", now: 1_000))
        store.put(sourcesRoll("new", now: 5_000))
        store.putSyncRecord(newSyncRecord(id: "new", sourceId: "w.example", now: 5_000))
        store.putThumbnail(Data([0xFF, 0xD8]), for: "new")
        try Data("{}".utf8).write(to: root.appendingPathComponent("rolls/new.locators.json"))
        try Data("not json".utf8).write(to: root.appendingPathComponent("rolls/junk.json"))
        XCTAssertEqual(store.list().map(\.id), ["new", "old"])
    }

    func testTheSyncRecordIsASidecarBesideTheDocument() throws {
        let root = sourcesScratch()
        let store = DocumentStore<RollDoc>(root: root)
        var record = newSyncRecord(id: "r1", sourceId: "w.example", now: 10)
        record = reduceSync(record, .pushStarted(now: 11))
        record = reduceSync(record, .pushFailed(kind: .conflict, message: "changed on another device",
                                                theirs: TheirCopy(etag: "\"e9\"", updatedAt: "2026-09-26T12:02:00.000Z")))
        XCTAssertTrue(store.putSyncRecord(record))
        XCTAssertEqual(store.getSyncRecord("r1"), record)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("rolls/r1.sync.json").path))
        XCTAssertNil(store.get("r1"), "a record is never a document")
        store.deleteSyncRecord("r1")
        XCTAssertNil(store.getSyncRecord("r1"))
    }

    func testADeleteTakesTheDocumentItsRecordAndItsThumbnail() {
        let store = DocumentStore<RollDoc>(root: sourcesScratch())
        store.put(sourcesRoll())
        store.putSyncRecord(newSyncRecord(id: "r1", sourceId: "w.example", now: 1))
        store.putThumbnail(Data([1, 2, 3]), for: "r1")
        XCTAssertEqual(store.thumbnail("r1"), Data([1, 2, 3]))
        store.delete("r1")
        XCTAssertNil(store.get("r1"))
        XCTAssertNil(store.getSyncRecord("r1"))
        XCTAssertNil(store.thumbnail("r1"))
    }

    func testAThumbnailOfNilRemovesIt() {
        let store = DocumentStore<RollDoc>(root: sourcesScratch())
        store.putThumbnail(Data([9]), for: "r1")
        store.putThumbnail(nil, for: "r1")
        XCTAssertNil(store.thumbnail("r1"))
    }

    func testAnIdCanNeverNameAPathOutsideTheFolder() {
        let root = sourcesScratch()
        let store = DocumentStore<RollDoc>(root: root)
        XCTAssertEqual(DocumentStore<RollDoc>.fileStem("0f8e2c1a-5b7d-4e2f-9c3a-1d2e3f4a5b6c"),
                       "0f8e2c1a-5b7d-4e2f-9c3a-1d2e3f4a5b6c", "a UUID is the file RollStore already wrote")
        XCTAssertEqual(DocumentStore<RollDoc>.fileStem("../../evil"), "%2E%2E%2F%2E%2E%2Fevil")
        XCTAssertEqual(DocumentStore<RollDoc>.fileStem("x.sync"), "x%2Esync", "never a sidecar's suffix")
        let evil = sourcesRoll("../../evil", sourceId: "local")
        XCTAssertTrue(store.put(evil))
        XCTAssertEqual(store.documentURL(evil.id).deletingLastPathComponent().standardizedFileURL,
                       root.appendingPathComponent("rolls", isDirectory: true).standardizedFileURL)
        XCTAssertEqual(store.get("../../evil")?.id, "../../evil")
    }

    func testTheLedgerCountsEveryKindPerSourceWithoutItsType() throws {
        let root = sourcesScratch()
        let rolls = DocumentStore<RollDoc>(root: root)
        rolls.put(sourcesRoll("a", sourceId: "local"))
        rolls.put(sourcesRoll("b", sourceId: "w.example"))
        rolls.put(sourcesRoll("c", sourceId: "w.example"))
        rolls.putSyncRecord(newSyncRecord(id: "b", sourceId: "w.example", now: 1))
        let trips = root.appendingPathComponent("trips", isDirectory: true)
        try FileManager.default.createDirectory(at: trips, withIntermediateDirectories: true)
        try Data(#"{"id":"t1","sourceId":"w.example","version":28}"#.utf8).write(to: trips.appendingPathComponent("t1.json"))
        try Data(#"{"id":"t2","version":3}"#.utf8).write(to: trips.appendingPathComponent("t2.json"))
        try Data(#"{"no":"id"}"#.utf8).write(to: trips.appendingPathComponent("t3.json"))

        let counts = DocumentLedger.counts(root: root)
        XCTAssertEqual(counts["local"], DocCount(projects: 0, trips: 1, rolls: 1), "no sourceId is this device's")
        XCTAssertEqual(counts["w.example"], DocCount(projects: 0, trips: 1, rolls: 2))
        XCTAssertEqual(describeDocs(counts["w.example"] ?? noDocs), "one trip and 2 rolls")
    }

    func testTheWireCopyLeavesTheSourceBehindAndComesBackStamped() throws {
        let roll = sourcesRoll(sourceId: "w.example")
        XCTAssertNil(roll.wireDoc.objectValue?["sourceId"])
        let back = try RollDoc.fromWire(roll.wireDoc, id: "r1", sourceId: "w.example", local: nil)
        XCTAssertEqual(back, roll)
        XCTAssertThrowsError(try RollDoc.fromWire(.string("nope"), id: "r1", sourceId: "w.example", local: nil)) { error in
            XCTAssertEqual((error as? WinnowError)?.kind, .protocol)
        }
    }

    func testAMovedRollKeepsItsIdAndItsBirth() {
        let roll = sourcesRoll(sourceId: "local", now: 1_000)
        let moved = roll.moved(to: "w.example", now: 9_000)
        XCTAssertEqual(moved.id, roll.id)
        XCTAssertEqual(moved.createdAt, roll.createdAt)
        XCTAssertEqual(moved.sourceId, "w.example")
        XCTAssertEqual(moved.pictures.map(\.ref), roll.pictures.map(\.ref))
    }
}
