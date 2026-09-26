// Port of `src/shared/roadtrip/month-grid.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class TripMonthBlocksTests: XCTestCase {
    func testGivesOneBlockPerCalendarMonthTheTripTouchesInOrder() {
        let blocks = monthBlocks("2025-03-03", "2026-02-10")
        XCTAssertEqual(blocks.count, 12)
        XCTAssertEqual(blocks.map(\.key), [
            "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08",
            "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
        ])
    }

    func testSaysTheYearOnTheFirstBlockAndOnEveryJanuaryAndNowhereElse() {
        let blocks = monthBlocks("2025-03-03", "2026-02-10")
        XCTAssertEqual(blocks[0].label, "March 2025")
        XCTAssertEqual(blocks[1].label, "April")
        XCTAssertEqual(blocks[10].label, "January 2026")
        XCTAssertEqual(blocks[11].label, "February")
    }

    func testDrawsTheWholeMonthMondayFirstPaddedWithNilWhereTheMonthHasNoDay() {
        let july = monthBlocks("2025-07-01", "2025-07-31")[0]
        // 1 July 2025 is a Tuesday: one padding slot before it.
        XCTAssertEqual(july.weeks[0].cells, [nil, "2025-07-01", "2025-07-02", "2025-07-03", "2025-07-04", "2025-07-05", "2025-07-06"])
        XCTAssertEqual(july.weeks.count, 5)
        // 31 July is a Thursday: three padding slots after it.
        XCTAssertEqual(july.weeks[4].cells, ["2025-07-28", "2025-07-29", "2025-07-30", "2025-07-31", nil, nil, nil])
    }

    func testKeepsTheTripDaysApartFromTheMonthAtBothEdges() {
        let blocks = monthBlocks("2025-03-03", "2026-02-10")
        XCTAssertEqual(blocks[0].tripDays[0], "2025-03-03")
        XCTAssertEqual(blocks[0].tripDays.count, 29)
        XCTAssertEqual(blocks[0].weeks[0].cells[0], nil) // March 2025 starts on a Saturday
        XCTAssertEqual(blocks[0].weeks[0].cells[5], "2025-03-01") // drawn, though outside the trip
        let last = blocks[11]
        XCTAssertEqual(last.tripDays[last.tripDays.count - 1], "2026-02-10")
        XCTAssertTrue(last.weeks[last.weeks.count - 1].cells.contains("2026-02-28"))
    }

    func testIsOneBlockForAOneDayTripAndNothingForAReversedOrBadSpan() {
        XCTAssertEqual(monthBlocks("2025-05-09", "2025-05-09").count, 1)
        XCTAssertEqual(monthBlocks("2025-05-09", "2025-05-08"), [])
        XCTAssertEqual(monthBlocks("2025-02-30", "2025-03-01"), [])
    }

    func testEveryWeekHasExactlySevenSlots() {
        for block in monthBlocks("2024-01-01", "2026-12-31") {
            for week in block.weeks { XCTAssertEqual(week.cells.count, 7) }
        }
    }
}

final class TripWeekRunsTests: XCTestCase {
    private let week: [IsoDate?] = ["2025-07-07", "2025-07-08", "2025-07-09", "2025-07-10", "2025-07-11", "2025-07-12", "2025-07-13"]

    func testGroupsConsecutiveCellsThatShareAValue() {
        let legOf = { (d: IsoDate) -> String? in d <= "2025-07-09" ? "a" : "b" }
        XCTAssertEqual(weekRuns(week, legOf), [
            WeekRun(from: 0, to: 2, value: "a"),
            WeekRun(from: 3, to: 6, value: "b"),
        ])
    }

    func testBreaksARunOnANilCellAndOnANilAnswer() {
        let cells: [IsoDate?] = [nil, "2025-07-08", "2025-07-09", nil, "2025-07-11", "2025-07-12", "2025-07-13"]
        let legOf = { (d: IsoDate) -> String? in d == "2025-07-12" ? nil : "a" }
        XCTAssertEqual(weekRuns(cells, legOf), [
            WeekRun(from: 1, to: 2, value: "a"),
            WeekRun(from: 4, to: 4, value: "a"),
            WeekRun(from: 6, to: 6, value: "a"),
        ])
    }

    func testIsEmptyForAWeekNothingCovers() {
        XCTAssertEqual(weekRuns(week, { (_: IsoDate) -> String? in nil }), [])
    }

    func testTakesItsOwnIdeaOfSameness() {
        struct Leg { let id: String }
        let legOf = { (d: IsoDate) -> Leg? in Leg(id: d <= "2025-07-09" ? "a" : "b") }
        let runs = weekRuns(week, legOf, same: { $0.id == $1.id })
        XCTAssertEqual(runs.map { [$0.from, $0.to] }, [[0, 2], [3, 6]])
    }
}

final class TripMonthCellTests: XCTestCase {
    func testIsASeventhOfWhatTheGuttersLeaveInWholePixels() {
        // A 390px phone less the shell's gutter.
        XCTAssertEqual(monthCell(358), 47)
        XCTAssertEqual(monthWidth(47), 7 * 47 + 6 * monthGap)
        XCTAssertLessThanOrEqual(monthWidth(47), 358)
    }

    func testClampsAtBothEndsAndAnswersTheMinimumForAnUnmeasuredBox() {
        XCTAssertEqual(monthCell(100), minMonthCell)
        XCTAssertEqual(monthCell(2000), maxMonthCell)
        XCTAssertEqual(monthCell(0), minMonthCell)
    }
}

final class TripVisibleBlockTests: XCTestCase {
    func testIsTheBlockUnderTheUpperThirdOfTheViewport() {
        let tops: [Double] = [0, 400, 800, 1200]
        XCTAssertEqual(visibleBlock(tops, 0, 600), 0)
        XCTAssertEqual(visibleBlock(tops, 250, 600), 1) // eye at 450
        XCTAssertEqual(visibleBlock(tops, 700, 600), 2) // eye at 900
        XCTAssertEqual(visibleBlock(tops, 5000, 600), 3)
        XCTAssertEqual(visibleBlock([], 0, 600), -1)
    }

    func testAnswersTheFirstBlockOfARowWhenSeveralShareATopAWideScreenReadsARowFromItsLeft() {
        let tops: [Double] = [0, 0, 0, 400, 400, 400, 800, 800, 800]
        XCTAssertEqual(visibleBlock(tops, 0, 600), 0)
        XCTAssertEqual(visibleBlock(tops, 300, 600), 3)
        XCTAssertEqual(visibleBlock(tops, 900, 600), 6)
    }
}

final class TripShortTripBlockTests: XCTestCase {
    func testIsShortUpTo31DaysAndNotPast() {
        XCTAssertTrue(isShortTrip("2026-05-07", "2026-05-10"))
        XCTAssertTrue(isShortTrip("2026-05-01", "2026-05-31"))
        XCTAssertFalse(isShortTrip("2026-05-01", "2026-06-01"))
        XCTAssertFalse(isShortTrip("2026-05-10", "2026-05-07"))
    }

    func testDrawsTheTripsWeeksWithAWeekEitherSideMondayFirstNoPadding() {
        // 7 May 2026 is a Thursday; 10 May a Sunday. Its week is 4–10 May.
        let block = weekBlock("2026-05-07", "2026-05-10")[0]
        XCTAssertEqual(block.key, "weeks")
        XCTAssertEqual(block.label, "May 2026")
        XCTAssertEqual(block.weeks.count, 3)
        XCTAssertEqual(block.weeks[0].cells, ["2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02", "2026-05-03"])
        XCTAssertEqual(block.weeks[2].cells[6], "2026-05-17")
        XCTAssertEqual(block.tripDays, ["2026-05-07", "2026-05-08", "2026-05-09", "2026-05-10"])
        for week in block.weeks { XCTAssertEqual(week.cells.count, 7) }
    }

    func testMarksAMonthBeginningInsideTheBlockNeverTheHeadersOwn() {
        let block = weekBlock("2026-05-07", "2026-05-10")[0]
        // 1 May sits in the margin week, but May is the header: no mark.
        XCTAssertEqual(block.marks, [])
        // A trip across the turn of a month: June is marked on the row holding the 1st.
        let across = weekBlock("2026-05-25", "2026-06-07")[0]
        XCTAssertEqual(across.label, "May 2026")
        XCTAssertEqual(across.marks, [MonthMark(week: 2, col: 0, label: "June")])
        // Across a year: the mark carries the year.
        let newYear = weekBlock("2025-12-29", "2026-01-04")[0]
        XCTAssertEqual(newYear.marks, [MonthMark(week: 1, col: 3, label: "January 2026")])
    }

    func testTripBlocksPicksTheShapeOnTheLengthAndMonthBlocksCarryNoMarks() {
        XCTAssertEqual(tripBlocks("2026-05-07", "2026-05-10").map(\.key), ["weeks"])
        let months = tripBlocks("2025-03-03", "2026-02-10")
        XCTAssertEqual(months.count, 12)
        XCTAssertTrue(months.allSatisfy { $0.marks.isEmpty })
        XCTAssertEqual(weekBlock("2026-05-10", "2026-05-07"), [])
    }
}

final class TripWeekIndexOfTests: XCTestCase {
    func testCountsCalendarWeeksFromTheWeekTheTripStartsIn() {
        XCTAssertEqual(weekIndexOf("2025-03-03", "2025-03-03"), 0)
        XCTAssertEqual(weekIndexOf("2025-03-09", "2025-03-03"), 0) // the Sunday of the same week
        XCTAssertEqual(weekIndexOf("2025-03-10", "2025-03-03"), 1)
        // A trip starting mid-week: its Monday is the origin, so a later Monday is a whole number of weeks on.
        XCTAssertEqual(weekIndexOf("2025-03-10", "2025-03-06"), 1)
        XCTAssertEqual(weekIndexOf("2025-03-05", "2025-03-06"), 0)
        XCTAssertNil(weekIndexOf("nope", "2025-03-06"))
    }
}

final class TripVisibleWeekSpanTests: XCTestCase {
    // Four rows of 60px, week 0..3, then a straddling week 3 drawn again in the next block.
    private let rows = [
        WeekRow(top: 0, height: 60, week: 0),
        WeekRow(top: 60, height: 60, week: 1),
        WeekRow(top: 120, height: 60, week: 2),
        WeekRow(top: 180, height: 60, week: 3),
        WeekRow(top: 300, height: 60, week: 3),
        WeekRow(top: 360, height: 60, week: 4),
    ]

    func testFramesTheWeeksOnScreenWholeRowsAtRest() {
        XCTAssertEqual(visibleWeekSpan(rows, 0, 120), WeekSpan(from: 0, to: 2))
    }

    func testMovesByThePixelARowHalfUnderTheTopEdgeCountsHalf() {
        XCTAssertEqual(visibleWeekSpan(rows, 30, 120), WeekSpan(from: 0.5, to: 2.5))
        XCTAssertEqual(visibleWeekSpan(rows, 45, 120), WeekSpan(from: 0.75, to: 2.75))
    }

    func testAStraddlingWeekDrawnTwiceStillReadsAsOneSpan() {
        // 180..300: the first week-3 row whole, the gap, the second week-3 row starting.
        XCTAssertEqual(visibleWeekSpan(rows, 180, 150), WeekSpan(from: 3, to: 3.5))
    }

    func testKeepsTheLastWeekFramedPastTheEndAndIsNilWithNoRows() {
        XCTAssertEqual(visibleWeekSpan(rows, 1000, 120), WeekSpan(from: 5, to: 5))
        XCTAssertNil(visibleWeekSpan([], 0, 120))
    }
}

final class TripScrollForWeekTests: XCTestCase {
    private let rows = [
        WeekRow(top: 0, height: 60, week: 0),
        WeekRow(top: 60, height: 60, week: 1),
        WeekRow(top: 200, height: 60, week: 1),
        WeekRow(top: 260, height: 60, week: 2),
    ]

    func testIsTheInverseOfTheSpanAFractionalWeekLandsInsideItsRow() {
        XCTAssertEqual(scrollForWeek(rows, 0), 0)
        XCTAssertEqual(scrollForWeek(rows, 0.5), 30)
        XCTAssertEqual(scrollForWeek(rows, 2.25), 275)
    }

    func testAWeekDrawnTwiceAnswersWithItsFirstRow() {
        XCTAssertEqual(scrollForWeek(rows, 1), 60)
    }

    func testClampsOffEitherEndAndIsNilWithNoRows() {
        XCTAssertEqual(scrollForWeek(rows, -3), 0)
        XCTAssertEqual(scrollForWeek(rows, 9), 320)
        XCTAssertNil(scrollForWeek([], 1))
    }
}

final class TripBlockSpanAndWeekStartTests: XCTestCase {
    func testNamesABlockByItsFirstAndLastTripDayOrNothing() {
        let blocks = monthBlocks("2025-03-03", "2025-04-05")
        XCTAssertEqual(blockSpan(blocks[0]), BlockSpan(start: "2025-03-03", end: "2025-03-31"))
        XCTAssertEqual(blockSpan(blocks[1]), BlockSpan(start: "2025-04-01", end: "2025-04-05"))
        var empty = blocks[1]
        empty.tripDays = []
        XCTAssertNil(blockSpan(empty))
    }

    func testFindsTheMondayOfAWeek() {
        XCTAssertEqual(weekStart("2025-07-10"), "2025-07-07")
        XCTAssertEqual(weekStart("2025-07-07"), "2025-07-07")
        XCTAssertEqual(weekStart("2025-07-13"), "2025-07-07")
        XCTAssertNil(weekStart("nope"))
    }
}
