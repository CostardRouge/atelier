// Port of `src/shared/roadtrip/loupe.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class TripPanWeeksTests: XCTestCase {
    func testTurnsAWeekOfTrackIntoAWeekCarryingTheRest() {
        XCTAssertEqual(panWeeks(0, 150, 20), WeekPan(weeks: 1, carry: 10))
        XCTAssertEqual(panWeeks(10, 130, 20), WeekPan(weeks: 1, carry: 0))
    }

    func testMovesBackOnANegativeScrollAndNothingUnderAWeek() {
        XCTAssertEqual(panWeeks(0, -290, 20), WeekPan(weeks: -2, carry: -10))
        XCTAssertEqual(panWeeks(0, 100, 20), WeekPan(weeks: 0, carry: 100))
    }

    func testLetsAReversalEatTheCarryBeforeItMovesTheOtherWay() {
        XCTAssertEqual(panWeeks(100, -120, 20), WeekPan(weeks: 0, carry: -20))
    }

    func testMovesNothingBeforeTheRulerHasAWidth() {
        XCTAssertEqual(panWeeks(50, 500, 0), WeekPan(weeks: 0, carry: 0))
    }
}

private let year = TripSpan(startDate: "2025-01-01", endDate: "2025-12-31")
private let week = TripSpan(startDate: "2026-09-01", endDate: "2026-09-08")

final class TripDefaultLoupeTests: XCTestCase {
    func testOpensEightWeeksHoldingTheFocusWithContextBeforeIt() {
        let l = defaultLoupe(year, "2025-08-02")
        XCTAssertEqual(loupeLength(l), defaultLoupeDays)
        XCTAssertTrue(l.start <= "2025-08-02" && l.end >= "2025-08-02")
        // Two weeks before, pulled back to that Monday.
        XCTAssertEqual(l.start, "2025-07-14")
    }

    func testStartsAtTheTripWhenTheFocusIsNearItsStartAndNeverLeavesTheTripAtItsEnd() {
        XCTAssertEqual(defaultLoupe(year, "2025-01-03").start, "2025-01-01")
        let late = defaultLoupe(year, "2025-12-30")
        XCTAssertEqual(late.end, "2025-12-31")
        XCTAssertEqual(loupeLength(late), defaultLoupeDays)
    }

    func testIsTheWholeTripWhenTheTripIsShorterThanTheWindow() {
        let l = defaultLoupe(week, "2026-09-03")
        XCTAssertEqual(l, Loupe(start: week.startDate, end: week.endDate))
        XCTAssertTrue(loupeIsWhole(week, l))
    }

    func testFallsBackToTheTripStartForAFocusOutsideTheTrip() {
        XCTAssertEqual(defaultLoupe(year, "2030-01-01").start, "2025-01-01")
    }
}

final class TripMoveLoupeTests: XCTestCase {
    private let l = Loupe(start: "2025-03-01", end: "2025-04-25")

    func testKeepsItsWidthAndStopsAtTheTripEdges() {
        let moved = moveLoupe(year, l, 10)
        XCTAssertEqual(loupeLength(moved), loupeLength(l))
        XCTAssertEqual(moved.start, "2025-03-11")
        XCTAssertEqual(moveLoupe(year, l, -100).start, "2025-01-01")
        XCTAssertEqual(moveLoupe(year, l, 1000).end, "2025-12-31")
    }
}

final class TripResizeLoupeTests: XCTestCase {
    private let l = Loupe(start: "2025-03-01", end: "2025-04-25")

    func testMovesOneEdgeAndClampsItToTheTrip() {
        XCTAssertEqual(resizeLoupe(year, l, .start, "2025-03-10").start, "2025-03-10")
        XCTAssertEqual(resizeLoupe(year, l, .end, "2026-06-01").end, "2025-12-31")
    }

    func testNeverShrinksUnderTheMinimum() {
        let narrow = resizeLoupe(year, l, .start, "2025-04-25")
        XCTAssertEqual(loupeLength(narrow), minLoupeDays)
        let narrowEnd = resizeLoupe(year, l, .end, "2025-03-01")
        XCTAssertEqual(loupeLength(narrowEnd), minLoupeDays)
    }
}

final class TripLoupeContainingTests: XCTestCase {
    private let l = Loupe(start: "2025-03-01", end: "2025-04-25")

    func testIsUnchangedWhileTheDateIsInside() {
        XCTAssertEqual(loupeContaining(year, l, "2025-04-01"), l)
    }

    func testSlidesTheShortestWayToHoldADateOutsideKeepingItsWidth() {
        let later = loupeContaining(year, l, "2025-05-10")
        XCTAssertEqual(later.end, "2025-05-10")
        XCTAssertEqual(loupeLength(later), loupeLength(l))
        let earlier = loupeContaining(year, l, "2025-02-01")
        XCTAssertEqual(earlier.start, "2025-02-01")
    }

    func testIgnoresADateOffTheTrip() {
        XCTAssertEqual(loupeContaining(year, l, "2030-01-01"), l)
    }
}
