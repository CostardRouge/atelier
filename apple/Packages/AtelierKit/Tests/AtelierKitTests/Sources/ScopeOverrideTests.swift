// Port of `src/shared/sources/scope-override.test.ts`.

import XCTest
@testable import AtelierKit

private let day = DaySpan(from: "2025-03-25", to: "2025-03-25")
private let span = DaySpan(from: "2025-03-25", to: "2025-03-27")

final class ViewedSpanTests: XCTestCase {
    func testFollowsThePublishedSpanWhenNothingOverridesIt() {
        XCTAssertEqual(viewedSpan(span, nil, "2026-09-13"),
                       ViewedSpan(from: span.from, to: span.to, anchor: span, overridden: false))
    }

    func testShowsTheOverrideWhileItsAnchorIsStillWhatIsPublished() {
        let o = DayOverride(anchor: day, day: "2025-03-26")
        XCTAssertEqual(viewedSpan(day, o, "2026-09-13"),
                       ViewedSpan(from: "2025-03-26", to: "2025-03-26", anchor: day, overridden: true))
    }

    func testDropsAnOverrideTakenFromAnotherSpanAnotherPieceAnotherDayOfTheOverview() {
        let o = DayOverride(anchor: day, day: "2025-03-26")
        let next = DaySpan(from: "2025-04-02", to: "2025-04-02")
        XCTAssertEqual(viewedSpan(next, o, "2026-09-13"),
                       ViewedSpan(from: next.from, to: next.to, anchor: next, overridden: false))
    }

    func testUsesTheDayPickedByHandWhenNoToolPublishes() {
        let o = DayOverride(anchor: day, day: "2025-03-26")
        XCTAssertEqual(viewedSpan(nil, o, "2026-09-13"),
                       ViewedSpan(from: "2026-09-13", to: "2026-09-13", anchor: nil, overridden: false))
    }
}

final class StepOutTests: XCTestCase {
    func testStepsToTheNeighbourOfASingleDay() {
        XCTAssertEqual(stepOut(day, -1), "2025-03-24")
        XCTAssertEqual(stepOut(day, 1), "2025-03-26")
    }

    func testStepsOutOfASpanFromItsEdgesNeverByItsLength() {
        XCTAssertEqual(stepOut(span, -1), "2025-03-24")
        XCTAssertEqual(stepOut(span, 1), "2025-03-28")
    }

    func testCrossesAMonthAndALeapDayInUTC() {
        XCTAssertEqual(shiftDay("2024-02-28", 1), "2024-02-29")
        XCTAssertEqual(shiftDay("2024-03-01", -1), "2024-02-29")
        XCTAssertEqual(shiftDay("2025-03-31", 1), "2025-04-01")
    }

    func testRefusesWhatIsNotADate() {
        XCTAssertNil(shiftDay("25/03/2025", 1))
    }

    func testReadsAnOddDateTheWayDateUTCDoesRollingOverNeverRefusing() {
        // The web's `Date.UTC` carries a day past its month and a month past
        // its year, and reads a two-digit year as 1900 + it; the two clients
        // must agree on these strings too.
        XCTAssertEqual(shiftDay("2025-02-30", 0), "2025-03-02")
        XCTAssertEqual(shiftDay("2025-13-01", 0), "2026-01-01")
        XCTAssertEqual(shiftDay("2025-00-15", 0), "2024-12-15")
        XCTAssertEqual(shiftDay("0099-01-01", 0), "1999-01-01")
        XCTAssertEqual(shiftDay("1970-01-01", 0), "1970-01-01")
        XCTAssertEqual(shiftDay("1969-12-31", 1), "1970-01-01")
        XCTAssertEqual(shiftDay("2000-02-29", 366), "2001-03-01")
        XCTAssertEqual(shiftDay("1900-03-01", -1), "1900-02-28")
    }
}

final class OverrideToTests: XCTestCase {
    func testReturnsToFollowingWhenSteppingBackOntoASingleDayAnchor() {
        XCTAssertNil(overrideTo(day, "2025-03-25"))
    }

    func testOverridesForAnyOtherDayAndForADayInsideASpan() {
        XCTAssertEqual(overrideTo(day, "2025-03-24"), DayOverride(anchor: day, day: "2025-03-24"))
        XCTAssertEqual(overrideTo(span, "2025-03-26"), DayOverride(anchor: span, day: "2025-03-26"))
    }
}

final class RelativeToAnchorTests: XCTestCase {
    func testCountsFromTheAnchorNotFromToday() {
        XCTAssertEqual(relativeToAnchor("2025-03-24", day), "the day before")
        XCTAssertEqual(relativeToAnchor("2025-03-22", day), "3 days before")
        XCTAssertEqual(relativeToAnchor("2025-03-26", day), "the day after")
        XCTAssertEqual(relativeToAnchor("2025-03-25", day), "the same day")
    }

    func testCountsPastASpanFromItsEdgesAndInsideItByDayNumber() {
        XCTAssertEqual(relativeToAnchor("2025-03-28", span), "the day after")
        XCTAssertEqual(relativeToAnchor("2025-03-24", span), "the day before")
        XCTAssertEqual(relativeToAnchor("2025-03-26", span), "day 2 of 3")
    }

    func testIsNilForABadDate() {
        XCTAssertNil(relativeToAnchor("nope", day))
    }
}
