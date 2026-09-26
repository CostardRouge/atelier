// The sync driver's transitions against a stub document bucket: a local
// document makes no record; an edit is dirty and goes up WITHOUT `If-Match`
// the first time and with the etag after; a stale write is refused and HELD
// as a conflict carrying the server's copy, overwriting nothing; keep mine
// re-pushes over theirs, take theirs replaces the mirror; opening a clean
// mirror takes a newer copy silently and a dirty one is a conflict; a
// document deleted there is gone and can be kept here as local; offline keeps
// the edit and retries; an edit landing while a push is out keeps the record
// dirty; the idle timer pushes by itself. Every sentence is the kernel's.

import AtelierKit
import Foundation
import XCTest
@testable import Atelier

final class DocumentSyncTests: XCTestCase {
    // XCTest makes a fresh instance per case, so these are each case's own.
    private let bucket = StubDocBucket()
    private let store = DocumentStore<RollDoc>(root: sourcesScratch())
    private var doc = sourcesRoll()
    private var time: Double = 10_000
    private var replaced: [RollDoc] = []

    @MainActor private func makeSync(idleMs: Double = remoteIdleMs) -> DocumentSync<RollDoc> {
        let remote = bucket.remote()
        let sync = DocumentSync<RollDoc>(store: store, remoteFor: { $0 == remote.sourceId ? remote : nil }, idleMs: idleMs,
                                         clock: { [unowned self] in self.time })
        sync.current = { [unowned self] in self.doc }
        sync.onReplace = { [unowned self] next in
            self.doc = next
            self.replaced.append(next)
        }
        return sync
    }

    /// Write the document locally, as a tool's store does, then tell the driver.
    @MainActor private func edit(_ sync: DocumentSync<RollDoc>, name: String) {
        time += 1_000
        doc.name = name
        doc.updatedAt = time
        store.put(doc)
        sync.edited(doc)
    }

    @MainActor func testALocalDocumentHasNoRecordAndMakesNoRequest() async {
        doc = sourcesRoll(sourceId: "local")
        let sync = makeSync()
        edit(sync, name: "Here")
        await sync.flush(force: true)
        XCTAssertNil(sync.record)
        XCTAssertNil(store.getSyncRecord(doc.id))
        XCTAssertFalse(sync.showsPill)
        XCTAssertTrue(bucket.requests.isEmpty)
    }

    @MainActor func testAnEditGoesUpWithoutIfMatchFirstThenWithTheEtagHeld() async throws {
        let sync = makeSync()
        edit(sync, name: "First")
        XCTAssertEqual(sync.record?.status, .dirty)
        XCTAssertEqual(store.getSyncRecord(doc.id)?.status, .dirty, "the dirty record is on disk: the crash story")
        XCTAssertEqual(pillText(try XCTUnwrap(sync.record), sourceLabel: "w.example", now: time),
                       "unsaved changes — saving to w.example shortly")

        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(sync.record?.etag, "\"e1\"")
        XCTAssertNil(bucket.requests("PUT").first?.header("If-Match"), "a document never pushed carries no If-Match")
        XCTAssertEqual(bucket.rows[doc.id]?.doc, doc.wireDoc)
        XCTAssertEqual(bucket.rows[doc.id]?.kind, "roll")

        edit(sync, name: "Second")
        await sync.flush(force: true)
        XCTAssertEqual(bucket.requests("PUT").last?.header("If-Match"), "\"e1\"")
        XCTAssertEqual(sync.record?.etag, "\"e2\"")
        XCTAssertEqual(store.getSyncRecord(doc.id)?.etag, "\"e2\"")
        XCTAssertEqual(bucket.rows[doc.id]?.doc.objectValue?["name"], "Second")
    }

    @MainActor func testTheIdleDelayHoldsAPushBackUnlessForced() async {
        let sync = makeSync(idleMs: 5_000)
        edit(sync, name: "Typing")
        await sync.flush()
        XCTAssertEqual(sync.record?.status, .dirty, "within the idle delay: no push")
        XCTAssertTrue(bucket.requests("PUT").isEmpty)
        time += 5_000
        await sync.flush()
        XCTAssertEqual(sync.record?.status, .synced)
    }

    @MainActor func testAStaleWriteIsRefusedAndHeldAsAConflictOverwritingNothing() async throws {
        let sync = makeSync()
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        var theirs = doc.wireDoc.objectValue ?? [:]
        theirs["name"] = "Theirs"
        bucket.changeElsewhere(doc.id, .object(theirs))

        edit(sync, name: "Mine again")
        await sync.flush(force: true)
        let record = try XCTUnwrap(sync.record)
        XCTAssertEqual(record.status, .conflict)
        XCTAssertEqual(record.theirs, TheirCopy(etag: "\"e2\"", updatedAt: "2026-09-26T12:02:00.000Z"))
        XCTAssertEqual(bucket.rows[doc.id]?.doc.objectValue?["name"], "Theirs", "nothing was overwritten")
        XCTAssertEqual(pillText(record, sourceLabel: "w.example", now: time, timeZone: TimeZone(identifier: "UTC")!),
                       "refused: changed on another device at 12:02")
        XCTAssertTrue(pillNeedsAction(record.status))

        let puts = bucket.requests("PUT").count
        edit(sync, name: "Still mine")
        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .conflict, "a held state waits for the author, whatever the timer says")
        XCTAssertEqual(bucket.requests("PUT").count, puts)
    }

    @MainActor func testKeepMineRepushesOverTheirCopy() async {
        let sync = makeSync()
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        bucket.changeElsewhere(doc.id, ["name": "Theirs", "pictures": []])
        edit(sync, name: "Mine again")
        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .conflict)

        await sync.keepMine()
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(bucket.requests("PUT").last?.header("If-Match"), "\"e2\"", "over the server's revision")
        XCTAssertEqual(bucket.rows[doc.id]?.doc.objectValue?["name"], "Mine again")
    }

    @MainActor func testTakeTheirsReplacesTheMirror() async {
        let sync = makeSync()
        var discarded = 0
        sync.onDiscardPending = { discarded += 1 }
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        var theirs = doc.wireDoc.objectValue ?? [:]
        theirs["name"] = "Theirs"
        bucket.changeElsewhere(doc.id, .object(theirs))
        edit(sync, name: "Mine again")
        await sync.flush(force: true)

        await sync.takeTheirs()
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(sync.record?.etag, "\"e2\"")
        XCTAssertEqual(replaced.last?.name, "Theirs")
        XCTAssertEqual(store.get(doc.id)?.name, "Theirs")
        XCTAssertEqual(discarded, 1, "the edit about to be saved is the one dropped")
    }

    @MainActor func testOpeningACleanMirrorTakesANewerCopySilently() async throws {
        let sync = makeSync()
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        var theirs = doc.wireDoc.objectValue ?? [:]
        theirs["name"] = "From the other device"
        bucket.changeElsewhere(doc.id, .object(theirs))

        let opened = try sourcesUnwrap(await sync.resume(doc))
        XCTAssertTrue(opened.replaced)
        XCTAssertEqual(opened.doc.name, "From the other device")
        XCTAssertEqual(opened.doc.sourceId, "w.example", "the source comes from the request, never the body")
        XCTAssertEqual(store.get(doc.id)?.name, "From the other device")
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(bucket.requests("GET").last?.header("If-None-Match"), "\"e1\"")
    }

    @MainActor func testOpeningWhenStillCurrentCostsOneConditionalRequest() async throws {
        let sync = makeSync()
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        let opened = try sourcesUnwrap(await sync.resume(doc))
        XCTAssertFalse(opened.replaced)
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(bucket.requests("GET").count, 1)
    }

    @MainActor func testOpeningADirtyMirrorThatMovedThereIsAConflict() async throws {
        let sync = makeSync()
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        edit(sync, name: "Offline edit")
        bucket.changeElsewhere(doc.id, doc.wireDoc)

        let reopened = makeSync()
        let opened = try sourcesUnwrap(await reopened.resume(doc))
        XCTAssertFalse(opened.replaced, "a dirty mirror is never overwritten")
        XCTAssertEqual(reopened.record?.status, .conflict)
        XCTAssertEqual(store.get(doc.id)?.name, "Offline edit")
    }

    @MainActor func testAPushToADocumentDeletedThereIsGoneAndCanBeKeptHere() async {
        let sync = makeSync()
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        bucket.deleteElsewhere(doc.id)
        edit(sync, name: "After")
        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .gone)
        XCTAssertEqual(pillText(sync.record!, sourceLabel: "w.example", now: time), "deleted on w.example")

        sync.keepLocal()
        XCTAssertNil(sync.record)
        XCTAssertNil(store.getSyncRecord(doc.id))
        XCTAssertEqual(store.get(doc.id)?.sourceId, "local")
        XCTAssertEqual(replaced.last?.sourceId, "local")
    }

    @MainActor func testDeleteHereTakesTheMirrorAndItsRecord() async {
        let sync = makeSync()
        var deleted = false
        sync.onDeleted = { deleted = true }
        edit(sync, name: "Mine")
        await sync.flush(force: true)
        bucket.deleteElsewhere(doc.id)
        edit(sync, name: "After")
        await sync.flush(force: true)

        sync.deleteHere()
        XCTAssertTrue(deleted)
        XCTAssertNil(store.get(doc.id))
        XCTAssertNil(store.getSyncRecord(doc.id))
        XCTAssertNil(sync.record)
    }

    @MainActor func testOfflineKeepsTheEditAndRetriesOnTheNextTrigger() async {
        let sync = makeSync()
        bucket.offline = true
        edit(sync, name: "On the plane")
        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .offline)
        XCTAssertEqual(pillText(sync.record!, sourceLabel: "w.example", now: time), "offline — kept on this device, will retry")
        XCTAssertTrue(sync.record!.canSaveNow)

        bucket.offline = false
        time += remoteIdleMs
        await sync.flush()
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(bucket.rows[doc.id]?.doc.objectValue?["name"], "On the plane")
    }

    @MainActor func testAnEditLandingWhileThePushIsOutKeepsTheRecordDirty() async {
        let sync = makeSync()
        bucket.duringPut = { [unowned self] in
            await MainActor.run { self.edit(sync, name: "Typed during the push") }
        }
        edit(sync, name: "Before")
        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .dirty, "the mirror moved on while the request was out")
        XCTAssertEqual(sync.record?.etag, "\"e1\"", "the acknowledgement is still taken")
        bucket.duringPut = nil
        await sync.flush(force: true)
        XCTAssertEqual(sync.record?.status, .synced)
        XCTAssertEqual(bucket.rows[doc.id]?.doc.objectValue?["name"], "Typed during the push")
    }

    @MainActor func testTheIdleTimerPushesByItself() async throws {
        let sync = DocumentSync<RollDoc>(store: store, remoteFor: { [bucket] _ in bucket.remote() }, idleMs: 20)
        sync.current = { [unowned self] in self.doc }
        store.put(doc)
        sync.edited(doc)
        XCTAssertEqual(sync.record?.status, .dirty)
        for _ in 0..<50 where sync.record?.status != .synced {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(sync.record?.status, .synced)
    }

    @MainActor func testAMirrorWithNoRecordIsDirtyAndNeverOverwrittenOnOpen() async throws {
        // A push that never got to write its record: the mirror is simply
        // dirty — so a copy found there is a conflict, never taken silently.
        store.put(doc)
        var theirs = doc.wireDoc.objectValue ?? [:]
        theirs["name"] = "There"
        bucket.changeElsewhere(doc.id, .object(theirs))
        let sync = makeSync()
        let opened = try sourcesUnwrap(await sync.resume(doc))
        XCTAssertFalse(opened.replaced)
        XCTAssertEqual(sync.record?.status, .conflict)
        XCTAssertNotNil(sync.record?.dirtyAt)
        XCTAssertNil(bucket.requests("GET").first?.header("If-None-Match"), "no etag held, nothing to be current against")
        XCTAssertEqual(store.get(doc.id)?.name, doc.name)
    }

    @MainActor func testAnInstanceNotConnectedKeepsTheMirrorAndSaysNothingWrong() async throws {
        doc = sourcesRoll(sourceId: "elsewhere.example")
        let sync = makeSync()
        let opened = try sourcesUnwrap(await sync.resume(doc))
        XCTAssertFalse(opened.replaced)
        XCTAssertNil(sync.remote)
        XCTAssertTrue(bucket.requests.isEmpty)
    }
}

/// `XCTUnwrap` over an async expression's value.
func sourcesUnwrap<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) throws -> T {
    try XCTUnwrap(value, file: file, line: line)
}
