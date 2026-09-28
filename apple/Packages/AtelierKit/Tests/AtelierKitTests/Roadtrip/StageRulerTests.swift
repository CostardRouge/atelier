// Port of `src/shared/roadtrip/stage-ruler.test.ts`, case for case. The web's
// plain `{ startDate, endDate, stages }` is a `TripSpan` and the stage list.

import Foundation
import XCTest
@testable import AtelierKit

private func stage(_ start: String, _ end: String, _ name: String = "") -> TripStage {
    createTripStage(name, "", start, end)
}

private let span = TripSpan(startDate: "2025-01-28", endDate: "2025-02-10")

private func bars(_ stages: [TripStage]) -> [RulerBar] { rulerBars(span, stages) }

final class StageRulerBarsTests: XCTestCase {
    func testPlacesEachStageByItsDayOffsetAndLengthInsideTheTrip() {
        let out = bars([stage("2025-01-28", "2025-01-30"), stage("2025-02-01", "2025-02-10")])
        XCTAssertEqual(out.map { [$0.from, $0.length, $0.lane] }, [[0, 3, 0], [4, 10, 0]])
    }

    func testClipsAStageThatReachesOutsideTheTripWithoutRewritingIt() {
        let s = stage("2025-01-20", "2025-02-01")
        let bar = bars([s])[0]
        XCTAssertEqual(bar.from, 0)
        XCTAssertEqual(bar.length, 5)
        XCTAssertEqual(bar.stage, s)
        // Its left edge is the span's, not the stage's: the ruler must not offer
        // that edge as a handle for a date it does not stand at.
        XCTAssertTrue(bar.clipStart)
        XCTAssertFalse(bar.clipEnd)
    }

    func testMarksNeitherEdgeClippedForAStageInsideTheSpan() {
        let bar = bars([stage("2025-01-28", "2025-01-30")])[0]
        XCTAssertFalse(bar.clipStart)
        XCTAssertFalse(bar.clipEnd)
    }

    func testDrawsNothingForAStageEntirelyOutsideReversedOrMalformed() {
        XCTAssertEqual(bars([stage("2025-03-01", "2025-03-04"), stage("2025-02-05", "2025-02-01"),
                             stage("nope", "2025-02-01")]), [])
    }

    func testStacksOverlappingStagesIntoLanesInListOrder() {
        let out = bars([
            stage("2025-01-28", "2025-02-02"),
            stage("2025-02-02", "2025-02-06"), // shares the travel day
            stage("2025-02-07", "2025-02-10"), // clear of the first, lane 0 again
        ])
        XCTAssertEqual(out.map(\.lane), [0, 1, 0])
        XCTAssertEqual(laneCount(out), 2)
    }

    func testKeepsTheStageIndexSoTheTintFollowsTheListNotTheBar() {
        let out = bars([stage("2025-03-01", "2025-03-02"), stage("2025-02-01", "2025-02-02")])
        XCTAssertEqual(out.map(\.index), [1])
    }

    func testIsEmptyForATripWithNoUsableSpan() {
        XCTAssertEqual(rulerBars(TripSpan(startDate: "2025-02-10", endDate: "2025-01-28"),
                                 [stage("2025-02-01", "2025-02-02")]), [])
    }
}

final class StageRulerGapsTests: XCTestCase {
    func testListsTheUncoveredRunsWithTheirDates() {
        let stages = [stage("2025-01-30", "2025-02-01"), stage("2025-02-05", "2025-02-08")]
        XCTAssertEqual(rulerGaps(span, bars(stages)), [
            RulerGap(from: 0, length: 2, startDate: "2025-01-28", endDate: "2025-01-29"),
            RulerGap(from: 5, length: 3, startDate: "2025-02-02", endDate: "2025-02-04"),
            RulerGap(from: 12, length: 2, startDate: "2025-02-09", endDate: "2025-02-10"),
        ])
    }

    func testIsTheWholeTripWithNoStagesAndEmptyWhenFullyCovered() {
        XCTAssertEqual(rulerGaps(span, []), [RulerGap(from: 0, length: 14, startDate: "2025-01-28", endDate: "2025-02-10")])
        let full = [stage("2025-01-28", "2025-02-10")]
        XCTAssertEqual(rulerGaps(span, bars(full)), [])
    }
}

final class StageRulerMonthsTests: XCTestCase {
    func testLabelsTheFirstDayAndEveryFirstOfAMonth() {
        XCTAssertEqual(rulerMonths(span), [RulerMonth(offset: 0, label: "Jan"), RulerMonth(offset: 4, label: "Feb")])
    }

    func testDoesNotDoubleLabelATripThatStartsOnTheFirst() {
        XCTAssertEqual(rulerMonths(TripSpan(startDate: "2025-02-01", endDate: "2025-02-03")),
                       [RulerMonth(offset: 0, label: "Feb")])
    }
}

final class StageRulerDayOffsetTests: XCTestCase {
    func testMapsAnOffsetToTheDayAndClampsToTheTrip() {
        XCTAssertEqual(dayAtOffset(span, 0), "2025-01-28")
        XCTAssertEqual(dayAtOffset(span, 4.9), "2025-02-01")
        XCTAssertEqual(dayAtOffset(span, -3), "2025-01-28")
        XCTAssertEqual(dayAtOffset(span, 99), "2025-02-10")
    }

    func testInvertsForADayInsideTheTripAndRefusesOneOutside() {
        XCTAssertEqual(dayOffset(span, "2025-02-01"), 4)
        XCTAssertNil(dayOffset(span, "2025-01-27"))
        XCTAssertNil(dayOffset(span, "2025-02-11"))
    }
}

final class StageRulerTintTests: XCTestCase {
    func testCyclesThroughTheTintsAndNeverSharesOneBetweenNeighbours() {
        XCTAssertEqual(stageTint(0), stageTints[0])
        XCTAssertEqual(stageTint(stageTints.count), stageTints[0])
        for i in 0..<8 { XCTAssertNotEqual(stageTint(i), stageTint(i + 1)) }
    }
}

final class StageRulerDayWidthTests: XCTestCase {
    func testGivesTheBoxItsExactShareOfATripThatFits() {
        XCTAssertEqual(rulerDayWidth(900, 100, 1), 9)
    }

    func testNeverDrawsADayUnder6PxAt100Percent() {
        // 616 days in a 460px box wants 0.75px a day.
        XCTAssertEqual(rulerDayWidth(460, 616, 1), rulerMinDay)
    }

    func testIsStrictlyProportionalToTheZoomFloorIncluded() {
        // The old clamp-after-zoom froze this track from 25% to 800%.
        XCTAssertEqual(rulerDayWidth(460, 616, 2), rulerMinDay * 2)
        XCTAssertEqual(rulerDayWidth(460, 616, 0.5), rulerMinDay / 2)
        XCTAssertEqual(rulerTrackWidth(900, 100, 2) / rulerTrackWidth(900, 100, 1), 2)
    }

    func testFallsBackToTheMinimumBeforeTheBoxIsMeasured() {
        XCTAssertEqual(rulerDayWidth(0, 100, 1), rulerMinDay)
    }
}

final class StageRulerTicksTests: XCTestCase {
    // The trip runs 2025-01-28 (a Tuesday) → 2025-02-10, 14 days.
    func testStrokesEveryDayButTheFirstOnceADayIsWideEnough() {
        XCTAssertEqual(rulerTicks(span, rulerMinTickGap).map(\.offset), Array(1...13))
    }

    func testMarksMondaysAndFirstsOfTheMonthAsTheStrongStrokes() {
        let strong = rulerTicks(span, 20).filter(\.strong)
        // 2025-02-01 is offset 4, 2025-02-03 and 2025-02-10 are Mondays.
        XCTAssertEqual(strong.map(\.offset), [4, 6, 13])
    }

    func testFallsBackToRealMondaysWhenDaysWouldCrowd() {
        let ticks = rulerTicks(span, rulerMinTickGap - 1)
        XCTAssertEqual(ticks.map(\.offset), [6, 13])
        XCTAssertTrue(ticks.allSatisfy(\.strong))
    }

    func testDrawsNothingAtAllWhenEvenAWeekCannotStandApart() {
        XCTAssertEqual(rulerTicks(span, 1), [])
    }

    func testHasNothingToDrawForATripWithNoSpan() {
        XCTAssertEqual(rulerTicks(TripSpan(startDate: "nope", endDate: "2025-02-10"), 20), [])
    }
}
