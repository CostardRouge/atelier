// Port of `src/shared/sources/doc-sync.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let host = "winnow.steeve.website"

/// A synced record, with a few fields changed.
private func synced(_ change: (inout SyncRecord) -> Void = { _ in }) -> SyncRecord {
    var r = SyncRecord(id: "t1", sourceId: host, etag: "e1", syncedAt: 1_000, dirtyAt: nil, pushStartedAt: nil,
                       status: .synced, error: nil, theirs: nil)
    change(&r)
    return r
}

private let allStatuses: [SyncStatus] = [.synced, .dirty, .saving, .offline, .unauthenticated, .forbidden, .conflict, .gone]

final class NewSyncRecordTests: XCTestCase {
    func testStartsDirtyAndNeverPushedANewRemoteTripHasToGoUpOnce() {
        let r = newSyncRecord(id: "t1", sourceId: host, now: 5)
        XCTAssertEqual(r.status, .dirty)
        XCTAssertNil(r.etag)
        XCTAssertEqual(r.dirtyAt, 5)
        XCTAssertNil(r.syncedAt)
    }
}

final class ReduceSyncRoundTripTests: XCTestCase {
    func testAnEditMakesASyncedRecordDirtyStampedWithTheEdit() {
        let r = reduceSync(synced(), .edited(now: 2_000))
        XCTAssertEqual(r.status, .dirty)
        XCTAssertEqual(r.dirtyAt, 2_000)
        XCTAssertEqual(r.etag, "e1")
    }

    func testALaterEditMovesTheStampTheIdleClockCountsFromTheLastKeystroke() {
        var r = reduceSync(synced(), .edited(now: 2_000))
        r = reduceSync(r, .edited(now: 3_000))
        XCTAssertEqual(r.dirtyAt, 3_000)
    }

    func testAPushInFlightIsSavingAndSuccessLandsOnSyncedWithTheNewEtag() {
        var r = reduceSync(synced(), .edited(now: 2_000))
        r = reduceSync(r, .pushStarted(now: 7_000))
        XCTAssertEqual(r.status, .saving)
        r = reduceSync(r, .pushOk(etag: "e2", now: 7_400))
        XCTAssertEqual(r.status, .synced)
        XCTAssertEqual(r.etag, "e2")
        XCTAssertEqual(r.syncedAt, 7_400)
        XCTAssertNil(r.dirtyAt)
        XCTAssertNil(r.pushStartedAt)
    }

    func testAnEditDuringThePushKeepsTheRecordDirtyAfterThePushLands() {
        // The push carried the older snapshot; the mirror has moved on since.
        var r = reduceSync(synced(), .edited(now: 2_000))
        r = reduceSync(r, .pushStarted(now: 7_000))
        r = reduceSync(r, .edited(now: 7_200))
        XCTAssertEqual(r.status, .saving)
        r = reduceSync(r, .pushOk(etag: "e2", now: 7_400))
        XCTAssertEqual(r.status, .dirty)
        XCTAssertEqual(r.dirtyAt, 7_200)
        XCTAssertEqual(r.etag, "e2")
    }

    func testAPullReplacesTheMirrorAndSettlesTheRecord() {
        let r = reduceSync(synced { $0.status = .dirty; $0.dirtyAt = 5 }, .pulled(etag: "e9", now: 9))
        XCTAssertEqual(r.status, .synced)
        XCTAssertEqual(r.etag, "e9")
        XCTAssertEqual(r.syncedAt, 9)
        XCTAssertNil(r.dirtyAt)
    }
}

final class ReduceSyncFailureTests: XCTestCase {
    private func inFlight() -> SyncRecord {
        reduceSync(reduceSync(synced(), .edited(now: 2_000)), .pushStarted(now: 3_000))
    }

    func testEveryFailureLandsOnItsOwnStatusKeepingTheEdit() {
        let cases: [(PushFailure, SyncStatus)] = [
            (.unreachable, .offline),
            (.unauthenticated, .unauthenticated),
            (.forbidden, .forbidden),
            (.conflict, .conflict),
            (.notfound, .gone),
            (.protocol, .dirty),
        ]
        for (kind, status) in cases {
            let r = reduceSync(inFlight(), .pushFailed(kind: kind, message: "why"))
            XCTAssertEqual(r.status, status, "\(kind)")
            XCTAssertEqual(r.dirtyAt, 2_000, "\(kind)")
            XCTAssertNil(r.pushStartedAt, "\(kind)")
            XCTAssertEqual(r.error, "why", "\(kind)")
        }
    }

    func testAConflictRemembersTheServersCopyThePillAndKeepMineNeedIt() {
        let theirs = TheirCopy(etag: "e7", updatedAt: "2026-09-06T14:02:00Z")
        let r = reduceSync(inFlight(), .pushFailed(kind: .conflict, theirs: theirs))
        XCTAssertEqual(r.theirs, theirs)
    }

    func testANonConflictFailureCarriesNoTheirs() {
        let r = reduceSync(inFlight(), .pushFailed(kind: .unreachable))
        XCTAssertNil(r.theirs)
    }
}

final class ReduceSyncHeldStatesTests: XCTestCase {
    private func held(_ status: SyncStatus) -> SyncRecord {
        synced {
            $0.status = status
            $0.dirtyAt = 2_000
            $0.theirs = status == .conflict ? TheirCopy(etag: "e7", updatedAt: nil) : nil
        }
    }

    func testAnEditDoesNotMoveAHeldState() {
        for status in [SyncStatus.conflict, .gone, .forbidden] {
            let r = reduceSync(held(status), .edited(now: 4_000))
            XCTAssertEqual(r.status, status)
            XCTAssertEqual(r.dirtyAt, 4_000)
        }
    }

    func testKeepMineAdoptsTheServersEtagAndGoesBackToDirtyTheNextPushIsAccepted() {
        let r = reduceSync(held(.conflict), .resolvedKeepMine)
        XCTAssertEqual(r.status, .dirty)
        XCTAssertEqual(r.etag, "e7")
        XCTAssertNil(r.theirs)
        XCTAssertEqual(r.dirtyAt, 2_000)
    }

    func testTakeTheirsIsAPullSettledOnTheServersCopyLocalEditsDropped() {
        let r = reduceSync(held(.conflict), .resolvedTakeTheirs(etag: "e7", now: 5))
        XCTAssertEqual(r.status, .synced)
        XCTAssertEqual(r.etag, "e7")
        XCTAssertNil(r.dirtyAt)
        XCTAssertNil(r.theirs)
        XCTAssertEqual(r.syncedAt, 5)
    }
}

final class ShouldFlushTests: XCTestCase {
    private func dirtyAt(_ t: Double, _ status: SyncStatus = .dirty) -> SyncRecord {
        synced { $0.status = status; $0.dirtyAt = t }
    }

    func testWaitsOutTheIdleDelayThenFires() {
        XCTAssertFalse(shouldFlush(dirtyAt(1_000), now: 1_000 + remoteIdleMs - 1))
        XCTAssertTrue(shouldFlush(dirtyAt(1_000), now: 1_000 + remoteIdleMs))
    }

    func testTakesACustomDelay() {
        XCTAssertTrue(shouldFlush(dirtyAt(1_000), now: 1_500, idleMs: 400))
        XCTAssertFalse(shouldFlush(dirtyAt(1_000), now: 1_300, idleMs: 400))
    }

    func testNeverFiresOnACleanRecord() {
        XCTAssertFalse(shouldFlush(synced(), now: 1e9))
    }

    func testRetriesAfterOfflineAndAfterALostSessionOnlyTryingCanTellTheyAreBack() {
        XCTAssertTrue(shouldFlush(dirtyAt(1_000, .offline), now: 1e9))
        XCTAssertTrue(shouldFlush(dirtyAt(1_000, .unauthenticated), now: 1e9))
    }

    func testHoldsOnForbiddenConflictAndGoneAPersonHasToAct() {
        XCTAssertFalse(shouldFlush(dirtyAt(1_000, .forbidden), now: 1e9))
        XCTAssertFalse(shouldFlush(dirtyAt(1_000, .conflict), now: 1e9))
        XCTAssertFalse(shouldFlush(dirtyAt(1_000, .gone), now: 1e9))
    }

    func testNeverStartsASecondPushWhileOneIsInFlight() {
        XCTAssertFalse(shouldFlush(dirtyAt(1_000, .saving), now: 1e9))
    }
}

final class DescribeAgoTests: XCTestCase {
    func testRoundsToTheUnitAPersonWouldSay() {
        XCTAssertEqual(describeAgo(10_000), "just now")
        XCTAssertEqual(describeAgo(2 * 60_000), "2 min ago")
        XCTAssertEqual(describeAgo(3 * 3_600_000), "3 h ago")
        XCTAssertEqual(describeAgo(86_400_000), "1 day ago")
        XCTAssertEqual(describeAgo(2 * 86_400_000), "2 days ago")
    }

    func testRoundsAHalfUpAsJavaScriptDoes() {
        // 2.5 min → 3, where Swift's schoolbook rounding would also say 3 but
        // `Math.round` is pinned as the rule, not the coincidence.
        XCTAssertEqual(describeAgo(150_000), "3 min ago")
        XCTAssertEqual(describeAgo(89_999), "1 min ago")
    }
}

final class PillTextTests: XCTestCase {
    private let now: Double = 1_000 + 2 * 60_000

    func testSyncedSaysWhereAndWhen() {
        XCTAssertEqual(pillText(synced(), sourceLabel: host, now: now), "saved to \(host) · 2 min ago")
    }

    func testSyncedWithNoStampSaysWhereAlone() {
        XCTAssertEqual(pillText(synced { $0.syncedAt = nil }, sourceLabel: host, now: now), "saved to \(host)")
    }

    func testDirtySaysASaveIsComingOrWhyTheLastOneDidNotLand() {
        XCTAssertEqual(pillText(synced { $0.status = .dirty; $0.dirtyAt = 5 }, sourceLabel: host, now: now),
                       "unsaved changes — saving to \(host) shortly")
        XCTAssertEqual(pillText(synced { $0.status = .dirty; $0.dirtyAt = 5; $0.error = "answered 500" }, sourceLabel: host, now: now),
                       "could not save to \(host): answered 500 — kept on this device, will retry")
    }

    func testSaving() {
        XCTAssertEqual(pillText(synced { $0.status = .saving }, sourceLabel: host, now: now), "saving to \(host)…")
    }

    func testOfflineKeepsTheEditHereAndSaysItWillRetry() {
        XCTAssertEqual(pillText(synced { $0.status = .offline }, sourceLabel: host, now: now),
                       "offline — kept on this device, will retry")
    }

    func testALostSessionSaysWhereToSignIn() {
        XCTAssertEqual(pillText(synced { $0.status = .unauthenticated }, sourceLabel: host, now: now),
                       "sign in to \(host) to keep saving")
    }

    func testForbiddenNamesTheAccountNotTheNetwork() {
        XCTAssertEqual(pillText(synced { $0.status = .forbidden }, sourceLabel: host, now: now),
                       "this account cannot save on \(host) — kept on this device")
    }

    func testAConflictSaysWhenTheOtherDeviceWroteInTheReadersClock() {
        let stamp = "2026-09-06T14:02:00Z"
        let formatter = ISO8601DateFormatter()
        guard let instant = formatter.date(from: stamp) else { return XCTFail("the stamp parses") }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let parts = calendar.dateComponents([.hour, .minute], from: instant)
        let two = { (n: Int) in n < 10 ? "0\(n)" : "\(n)" }
        let hhmm = "\(two(parts.hour ?? 0)):\(two(parts.minute ?? 0))"
        let r = synced { $0.status = .conflict; $0.theirs = TheirCopy(etag: "e7", updatedAt: stamp) }
        XCTAssertEqual(pillText(r, sourceLabel: host, now: now), "refused: changed on another device at \(hhmm)")
        // The reader's clock is an argument: an hour east of UTC reads 15:02.
        XCTAssertEqual(pillText(r, sourceLabel: host, now: now, timeZone: TimeZone(secondsFromGMT: 3600)!),
                       "refused: changed on another device at 15:02")
        XCTAssertEqual(pillText(r, sourceLabel: host, now: now, timeZone: TimeZone(secondsFromGMT: 0)!),
                       "refused: changed on another device at 14:02")
    }

    func testAConflictWithNoTimestampStillSaysWhatHappened() {
        let r = synced { $0.status = .conflict; $0.theirs = TheirCopy(etag: "e7", updatedAt: nil) }
        XCTAssertEqual(pillText(r, sourceLabel: host, now: now), "refused: changed on another device")
    }

    func testAConflictWithAnUnreadableStampStillSaysWhatHappened() {
        let r = synced { $0.status = .conflict; $0.theirs = TheirCopy(etag: "e7", updatedAt: "yesterday") }
        XCTAssertEqual(pillText(r, sourceLabel: host, now: now), "refused: changed on another device")
    }

    func testGone() {
        XCTAssertEqual(pillText(synced { $0.status = .gone }, sourceLabel: host, now: now), "deleted on \(host)")
    }
}

final class PillLabelTests: XCTestCase {
    func testEveryStatusHasAWordAndItIsShortEnoughToSitBesideAButton() {
        for status in allStatuses {
            let label = pillLabel(status)
            XCTAssertNotEqual(label, "")
            XCTAssertLessThanOrEqual(label.count, 10)
        }
    }

    func testNoTwoStatusesWearTheSameWordThePillIsTheOnlyThingOnScreen() {
        XCTAssertEqual(Set(allStatuses.map(pillLabel)).count, allStatuses.count)
    }

    func testNeverNamesTheHostTheSentenceDoesThatAndAHostIsUnbounded() {
        for status in allStatuses { XCTAssertFalse(pillLabel(status).contains(host)) }
    }

    func testTheListAboveIsEveryStatus() {
        XCTAssertEqual(Set(allStatuses), Set(SyncStatus.allCases))
    }
}

final class PillNeedsActionTests: XCTestCase {
    func testTheFourStatesWaitingOnTheAuthor() {
        XCTAssertTrue(pillNeedsAction(.unauthenticated))
        XCTAssertTrue(pillNeedsAction(.forbidden))
        XCTAssertTrue(pillNeedsAction(.conflict))
        XCTAssertTrue(pillNeedsAction(.gone))
    }

    func testTheOrdinaryRoundTripResolvesItselfAndAsksNothing() {
        XCTAssertFalse(pillNeedsAction(.synced))
        XCTAssertFalse(pillNeedsAction(.dirty))
        XCTAssertFalse(pillNeedsAction(.saving))
        // Offline retries on its own trigger — `shouldFlush` keeps it in the loop.
        XCTAssertFalse(pillNeedsAction(.offline))
    }
}

final class AfterPullTests: XCTestCase {
    private struct Doc: Equatable {
        var id: String
        var name: String
    }

    private let doc = Doc(id: "t1", name: "theirs")

    func testDoesNothingWhenTheMirrorIsStillCurrent() {
        let r: AfterPull<Doc> = afterPull(synced(), .current, now: 0)
        XCTAssertNil(r.take)
        XCTAssertNil(r.event)
    }

    func testTakesTheServerCopySilentlyOverACleanMirror() {
        let r = afterPull(synced(), .fetched(doc: doc, etag: "e2", updatedAt: "2026-09-15T10:00:00Z"), now: 77)
        XCTAssertEqual(r.take, doc)
        XCTAssertEqual(r.event, .pulled(etag: "e2", now: 77))
        guard let event = r.event else { return XCTFail("an event") }
        XCTAssertEqual(reduceSync(synced(), event).status, .synced)
    }

    func testHoldsAConflictOverADirtyMirrorOverwritingNothing() {
        let dirty = synced { $0.status = .dirty; $0.dirtyAt = 2_000 }
        let r = afterPull(dirty, .fetched(doc: doc, etag: "e2", updatedAt: "2026-09-15T10:00:00Z"), now: 77)
        XCTAssertNil(r.take)
        guard let event = r.event else { return XCTFail("an event") }
        let next = reduceSync(dirty, event)
        XCTAssertEqual(next.status, .conflict)
        XCTAssertEqual(next.theirs, TheirCopy(etag: "e2", updatedAt: "2026-09-15T10:00:00Z"))
    }

    func testSaysAFailureButNotAProtocolErrorOnACleanMirror() {
        let offline: AfterPull<Doc> = afterPull(synced(), .failed(kind: .unreachable, message: "no answer", theirs: nil), now: 0)
        guard let event = offline.event else { return XCTFail("an event") }
        XCTAssertEqual(reduceSync(synced(), event).status, .offline)
        let quiet: AfterPull<Doc> = afterPull(synced(), .failed(kind: .protocol, message: "500", theirs: nil), now: 0)
        XCTAssertNil(quiet.take)
        XCTAssertNil(quiet.event)
        let dirty = synced { $0.status = .dirty; $0.dirtyAt = 2_000 }
        let said: AfterPull<Doc> = afterPull(dirty, .failed(kind: .protocol, message: "500", theirs: nil), now: 0)
        XCTAssertEqual(said.event, .pushFailed(kind: .protocol, message: "500", theirs: nil))
    }
}

final class SyncRecordSidecarTests: XCTestCase {
    func testWritesEveryKeyWithNullsWhereTheWebWritesNullsAndReadsBackTheIdentity() {
        let r = synced { $0.status = .conflict; $0.dirtyAt = 2_000; $0.error = "412"; $0.theirs = TheirCopy(etag: "e7", updatedAt: nil) }
        let keys = r.json.objectValue?.keys.sorted()
        XCTAssertEqual(keys, ["dirtyAt", "error", "etag", "id", "pushStartedAt", "sourceId", "status", "syncedAt", "theirs"])
        XCTAssertEqual(r.json.objectValue?["pushStartedAt"], .null)
        XCTAssertEqual(r.json.objectValue?["theirs"]?.objectValue?["updatedAt"], .null)
        XCTAssertEqual(readSyncRecord(JSONValue.parse(r.json.serialized())), r)
        let fresh = newSyncRecord(id: "t2", sourceId: host, now: 5)
        XCTAssertEqual(fresh.json.objectValue?["etag"], .null)
        XCTAssertEqual(readSyncRecord(fresh.json), fresh)
    }

    func testRefusesARowThatNamesNoDocumentAndReadsAnUnknownStatusFromTheStamps() {
        XCTAssertNil(readSyncRecord(nil))
        XCTAssertNil(readSyncRecord(["sourceId": "x"]))
        XCTAssertNil(readSyncRecord(["id": "", "sourceId": "x"]))
        let source = JSONValue.string(host)
        XCTAssertEqual(readSyncRecord(["id": "t1", "sourceId": source, "status": "teleported", "dirtyAt": 3])?.status, .dirty)
        XCTAssertEqual(readSyncRecord(["id": "t1", "sourceId": source, "status": "teleported"])?.status, .synced)
        // A `theirs` with no etag is no copy at all.
        XCTAssertNil(readSyncRecord(["id": "t1", "sourceId": source, "status": "conflict", "theirs": ["updatedAt": "x"]])?.theirs)
    }
}
