// Port of `src/shared/media/trim.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func range(_ start: Double, _ end: Double) -> TrimRange { TrimRange(start: start, end: end) }

final class MinTrimLengthTests: XCTestCase {
    func testIsOneFrameOr100msWhenTheFrameRateIsUnknown() {
        assertClose(minTrimLength(25), 0.04, 2)
        XCTAssertEqual(minTrimLength(nil), 0.1)
        XCTAssertEqual(minTrimLength(0), 0.1)
    }
}

final class SetStartSetEndTests: XCTestCase {
    private let D = 15.0
    private let MIN = 0.04

    func testMovesTheHandleItIsGiven() {
        XCTAssertEqual(setStart(fullRange(D), 5, D, MIN).start, 5)
        XCTAssertEqual(setEnd(fullRange(D), 12, D, MIN).end, 12)
    }

    func testNeverLetsTheHandlesCrossEachStopsOneFrameShort() {
        let r = range(5, 12)
        XCTAssertEqual(setStart(r, 14, D, MIN), range(12 - MIN, 12))
        XCTAssertEqual(setEnd(r, 1, D, MIN), range(5, 5 + MIN))
    }

    func testStaysInsideTheClip() {
        XCTAssertEqual(setStart(range(5, 12), -3, D, MIN).start, 0)
        XCTAssertEqual(setEnd(range(5, 12), 99, D, MIN).end, D)
    }
}

final class ClampPlayheadTests: XCTestCase {
    func testPushesThePlayheadOntoTheHandleThatReachedIt() {
        XCTAssertEqual(clampPlayhead(0, range(5, 12)), 5)
        XCTAssertEqual(clampPlayhead(14, range(5, 12)), 12)
        XCTAssertEqual(clampPlayhead(7, range(5, 12)), 7)
    }

    func testLeavesAnUntrimmedClipAlone() {
        XCTAssertEqual(clampPlayhead(7, nil), 7)
    }
}

final class PushBoundsTests: XCTestCase {
    func testCarriesTheHandleThePlayheadRunsInto() {
        XCTAssertEqual(pushBounds(range(5, 12), 3, 15), range(3, 12))
        XCTAssertEqual(pushBounds(range(5, 12), 14, 15), range(5, 14))
    }

    func testLeavesTheRangeAloneWhileThePlayheadStaysInsideIt() {
        let r = range(5, 12)
        XCTAssertEqual(pushBounds(r, 7, 15), r)
    }

    func testNeverPushesPastTheClip() {
        XCTAssertEqual(pushBounds(range(5, 12), -2, 15), range(0, 12))
        XCTAssertEqual(pushBounds(range(5, 12), 99, 15), range(5, 15))
    }

    func testOnlyEverWidensSoTheHandlesCanNeverMeet() {
        let tight = range(7, 7.04)
        XCTAssertEqual(pushBounds(tight, 7.02, 15), tight)
        XCTAssertEqual(pushBounds(tight, 6, 15), range(6, 7.04))
    }
}

final class ClampRangeTests: XCTestCase {
    func testShrinksASavedRangeOntoAShorterClip() {
        XCTAssertEqual(clampRange(range(5, 12), 8, 0.04), range(5, 8))
    }

    func testPullsTheWholeRangeBackWhenTheClipEndsBeforeTheInPoint() {
        XCTAssertEqual(clampRange(range(9, 12), 4, 0.5), range(3.5, 4))
    }

    func testReordersAnInvertedRangeAndImposesTheMinimumLength() {
        XCTAssertEqual(clampRange(range(12, 5), 15, 0.04), range(5, 12))
        XCTAssertEqual(clampRange(range(5, 5), 15, 0.04), range(5, 5.04))
    }

    func testDegradesToAnEmptyRangeOnAClipOfUnknownDuration() {
        XCTAssertEqual(clampRange(range(5, 12), 0, 0.04), range(0, 0))
    }
}

final class TrimDurationIsTrimmedExportTrimTests: XCTestCase {
    func testMeasuresWhatTheExportWillProduce() {
        XCTAssertEqual(trimDuration(range(5, 12)), 7)
    }

    func testOnlyCallsARangeTrimmedWhenItCutsSomethingOff() {
        XCTAssertFalse(isTrimmed(fullRange(15), 15))
        XCTAssertFalse(isTrimmed(range(0, 15), 15))
        XCTAssertTrue(isTrimmed(range(5, 15), 15))
        XCTAssertTrue(isTrimmed(range(0, 12), 15))
        XCTAssertFalse(isTrimmed(nil, 15))
    }

    func testHandsTheExportNothingWhenTheWholeClipIsKept() {
        XCTAssertNil(exportTrim(fullRange(15), 15))
        XCTAssertEqual(exportTrim(range(5, 12), 15), range(5, 12))
    }
}

final class SaveTrimRestoreTrimTests: XCTestCase {
    func testStoresNothingForAnUntrimmedClip() {
        XCTAssertNil(saveTrim(fullRange(15), 15))
        XCTAssertEqual(saveTrim(range(5, 12), 15), SavedTrim(start: 5, end: 12, duration: 15))
    }

    func testRestoresTheRangeOntoTheSameMedia() {
        let saved = saveTrim(range(5, 12), 15)!
        XCTAssertEqual(restoreTrim(saved, 15, 0.04), range(5, 12))
    }

    func testFallsBackToTheWholeClipWhenTheMediaIsADifferentOne() {
        let saved = saveTrim(range(5, 12), 15)!
        // Same file name, another take: 6 s of footage, no in/out to inherit.
        XCTAssertEqual(restoreTrim(saved, 6, 0.04), range(0, 6))
        XCTAssertEqual(restoreTrim(nil, 6, 0.04), range(0, 6))
    }

    func testToleratesTheWobbleBetweenAProbedAndADecodedDuration() {
        let saved = saveTrim(range(5, 12), 15)!
        XCTAssertEqual(restoreTrim(saved, 15.02, 0.04), range(5, 12))
    }

    // Not in the web spec: a stored trim read out of a project document,
    // the three numbers or nothing, and written back as the web writes it.
    func testReadsAStoredTrimBackSafely() {
        let saved = SavedTrim(start: 5, end: 12, duration: 15)
        XCTAssertEqual(readSavedTrim(saved.json), saved)
        XCTAssertEqual(saved.json.serialized(), "{\"duration\":15,\"end\":12,\"start\":5}")
        XCTAssertNil(readSavedTrim(nil))
        XCTAssertNil(readSavedTrim(["start": 5, "end": 12]))
        XCTAssertNil(readSavedTrim(["start": 5, "end": "12", "duration": 15]))
        XCTAssertNil(readSavedTrim(["start": 5, "end": .number(.nan), "duration": 15]))
    }
}
