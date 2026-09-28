// Port of `src/shared/roadtrip/trip-days.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// `Date.UTC(y, m, d, h, mi)` in milliseconds, `m` 0-based as JavaScript's.
private func utcMs(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ mi: Int = 0) -> Double {
    var c = DateComponents()
    c.year = y; c.month = m + 1; c.day = d; c.hour = h; c.minute = mi
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(secondsFromGMT: 0)!
    return cal.date(from: c)!.timeIntervalSince1970 * 1000
}

final class TripDaysParseIsoDateTests: XCTestCase {
    func testReadsAWellFormedDateAsUtcMidnight() {
        XCTAssertEqual(parseIsoDate("2025-03-01"), utcMs(2025, 2, 1))
    }

    func testRefusesADateTheCalendarDoesNotHave() {
        // Date.UTC would roll this over to 2 March and silently move a trip's end.
        XCTAssertNil(parseIsoDate("2025-02-30"))
        XCTAssertNil(parseIsoDate("2025-13-01"))
        XCTAssertNil(parseIsoDate("2025-00-10"))
    }

    func testAcceptsARealLeapDayAndRefusesAFakeOne() {
        XCTAssertNotNil(parseIsoDate("2024-02-29"))
        XCTAssertNil(parseIsoDate("2025-02-29"))
    }

    func testRefusesAnythingThatIsNotYyyyMmDd() {
        XCTAssertNil(parseIsoDate("2025-3-1"))
        XCTAssertNil(parseIsoDate("01/03/2025"))
        XCTAssertNil(parseIsoDate(""))
    }
}

final class TripDaysToIsoDateTests: XCTestCase {
    func testRoundTripsThroughParseIsoDate() {
        XCTAssertEqual(toIsoDate(parseIsoDate("2026-02-14")!), "2026-02-14")
    }

    func testPadsSingleDigitMonthsAndDays() {
        XCTAssertEqual(toIsoDate(utcMs(2025, 0, 5)), "2025-01-05")
    }
}

final class TripDaysTodayIsoTests: XCTestCase {
    func testReadsTheLocalCalendarDayNotTheUtcInstant() {
        // 23:30 local on 14 March is still the 14th to the person holding the
        // camera, whatever UTC says at that moment. The web builds the local
        // instant with `new Date(2025, 2, 14, 23, 30)` in the test machine's
        // zone; here the zone is named, east and west of Greenwich.
        for hours in [8, -5, 0] {
            let zone = TimeZone(secondsFromGMT: hours * 3600)!
            let late = Date(timeIntervalSince1970: (utcMs(2025, 2, 14, 23, 30) - Double(hours) * 3_600_000) / 1000)
            XCTAssertEqual(todayIso(late, in: zone), "2025-03-14", "UTC\(hours)")
            let early = Date(timeIntervalSince1970: (utcMs(2025, 2, 14, 0, 30) - Double(hours) * 3_600_000) / 1000)
            XCTAssertEqual(todayIso(early, in: zone), "2025-03-14", "UTC\(hours)")
        }
    }

    func testThePureFormTakesTheOffsetAsAnInput() {
        // 22:00 UTC on the 14th is already the 15th in Perth.
        XCTAssertEqual(todayIso(now: utcMs(2025, 2, 14, 22), utcOffsetSeconds: 8 * 3600), "2025-03-15")
        XCTAssertEqual(todayIso(now: utcMs(2025, 2, 14, 22), utcOffsetSeconds: 0), "2025-03-14")
    }
}

final class TripDaysAddDaysTests: XCTestCase {
    func testStepsForwardAndBackward() {
        XCTAssertEqual(addDays("2025-03-01", 1), "2025-03-02")
        XCTAssertEqual(addDays("2025-03-01", -1), "2025-02-28")
    }

    func testCrossesAMonthAYearAndALeapDay() {
        XCTAssertEqual(addDays("2025-12-31", 1), "2026-01-01")
        XCTAssertEqual(addDays("2024-02-28", 1), "2024-02-29")
    }

    func testCrossesADstBoundaryWithoutDrifting() {
        // Europe/Paris springs forward on 30 March 2025; UTC arithmetic must not
        // notice. A local-Date implementation lands on the 30th twice or skips it.
        XCTAssertEqual(addDays("2025-03-29", 1), "2025-03-30")
        XCTAssertEqual(addDays("2025-03-30", 1), "2025-03-31")
    }

    func testStaysNilOnABadDate() {
        XCTAssertNil(addDays("nope", 1))
    }
}

final class TripDaysDaysBetweenTests: XCTestCase {
    func testCountsWholeDaysInBothDirections() {
        XCTAssertEqual(daysBetween("2025-03-01", "2025-03-08"), 7)
        XCTAssertEqual(daysBetween("2025-03-08", "2025-03-01"), -7)
        XCTAssertEqual(daysBetween("2025-03-01", "2025-03-01"), 0)
    }

    func testSpansADstChangeExactly() {
        XCTAssertEqual(daysBetween("2025-03-27", "2025-04-03"), 7)
    }
}

final class TripDaysYearsBetweenTests: XCTestCase {
    func testTurnsOverExactlyOnTheAnniversaryNotBefore() {
        XCTAssertEqual(yearsBetween("2025-03-27", "2026-03-26"), 0)
        XCTAssertEqual(yearsBetween("2025-03-27", "2026-03-27"), 1)
        XCTAssertEqual(yearsBetween("2025-03-27", "2026-03-28"), 1)
    }

    func testCountsSeveralYears() {
        XCTAssertEqual(yearsBetween("2025-03-27", "2028-08-01"), 3)
    }

    func testIsNegativeBeforeTheStart() {
        XCTAssertEqual(yearsBetween("2026-03-27", "2025-03-27"), -1)
    }

    func testPutsA29FebruaryAnniversaryOn1MarchInACommonYear() {
        XCTAssertEqual(yearsBetween("2024-02-29", "2025-02-28"), 0)
        XCTAssertEqual(yearsBetween("2024-02-29", "2025-03-01"), 1)
    }

    func testIsNilOnABadDate() {
        XCTAssertNil(yearsBetween("nope", "2026-03-27"))
    }
}

final class TripDaysDayNumberTests: XCTestCase {
    func testIsOneBasedOnTheDepartureDay() {
        XCTAssertEqual(dayNumber("2025-03-01", "2025-03-01"), 1)
        XCTAssertEqual(dayNumber("2025-03-01", "2025-03-27"), 27)
    }

    func testCountsBackwardsBeforeDepartureRatherThanRefusing() {
        XCTAssertEqual(dayNumber("2025-03-01", "2025-02-28"), 0)
        XCTAssertEqual(dayNumber("2025-03-01", "2025-02-27"), -1)
    }
}

final class TripDaysSpanLengthTests: XCTestCase {
    func testCountsBothEnds() {
        XCTAssertEqual(spanLength("2025-03-01", "2025-03-01"), 1)
        XCTAssertEqual(spanLength("2025-03-01", "2025-03-03"), 3)
    }

    func testRefusesAReversedSpan() {
        XCTAssertNil(spanLength("2025-03-03", "2025-03-01"))
    }
}

final class TripDaysIsWithinTests: XCTestCase {
    func testIncludesBothEnds() {
        XCTAssertTrue(isWithin("2025-03-01", "2025-03-31", "2025-03-01"))
        XCTAssertTrue(isWithin("2025-03-01", "2025-03-31", "2025-03-31"))
        XCTAssertFalse(isWithin("2025-03-01", "2025-03-31", "2025-04-01"))
    }
}

final class TripDaysEnumerateDaysTests: XCTestCase {
    func testListsAnInclusiveSpanInOrder() {
        XCTAssertEqual(enumerateDays("2025-03-01", "2025-03-04"),
                       ["2025-03-01", "2025-03-02", "2025-03-03", "2025-03-04"])
    }

    func testCrossesADstBoundaryWithoutLosingOrRepeatingADay() {
        let days = enumerateDays("2025-03-29", "2025-03-31")
        XCTAssertEqual(days, ["2025-03-29", "2025-03-30", "2025-03-31"])
        XCTAssertEqual(Set(days).count, 3)
    }

    func testIsEmptyForAReversedSpan() {
        XCTAssertEqual(enumerateDays("2025-03-04", "2025-03-01"), [])
    }
}

final class TripDaysWeekdayIndexTests: XCTestCase {
    func testPutsMondayFirst() {
        // 3 March 2025 is a Monday.
        XCTAssertEqual(weekdayIndex("2025-03-03"), 0)
        XCTAssertEqual(weekdayIndex("2025-03-09"), 6) // Sunday
    }
}

final class TripDaysHeatmapWeeksTests: XCTestCase {
    func testPadsTheFirstWeekSoADayLandsOnItsRealWeekday() {
        // 6 March 2025 is a Thursday → three empty cells before it.
        let weeks = heatmapWeeks("2025-03-06", "2025-03-09")
        XCTAssertEqual(weeks.count, 1)
        XCTAssertEqual(weeks[0], [nil, nil, nil, "2025-03-06", "2025-03-07", "2025-03-08", "2025-03-09"])
    }

    func testPadsTheLastWeekTooSoEveryColumnIsSevenCells() {
        let weeks = heatmapWeeks("2025-03-03", "2025-03-12")
        XCTAssertEqual(weeks.count, 2)
        for week in weeks { XCTAssertEqual(week.count, 7) }
        XCTAssertEqual(Array(weeks[1][3...]), [nil, nil, nil, nil])
    }

    func testKeepsEveryTripDayExactlyOnce() {
        let weeks = heatmapWeeks("2025-03-01", "2026-01-04")
        let flat = weeks.flatMap { $0 }.compactMap { $0 }
        XCTAssertEqual(flat.count, 310)
        XCTAssertEqual(Set(flat).count, 310)
    }

    func testIsEmptyForAReversedSpan() {
        XCTAssertTrue(heatmapWeeks("2025-03-04", "2025-03-01").isEmpty)
    }
}

final class TripDaysMonthLabelsTests: XCTestCase {
    func testLabelsTheOpeningColumnEvenWhenTheTripJoinsMidMonth() {
        let labels = monthLabels(heatmapWeeks("2025-03-20", "2025-05-10"))
        XCTAssertEqual(labels[0], MonthLabel(column: 0, label: "Mar"))
        XCTAssertEqual(labels.map(\.label), ["Mar", "Apr", "May"])
    }

    func testGivesEachMonthOneLabel() {
        let labels = monthLabels(heatmapWeeks("2025-03-01", "2025-06-30"))
        XCTAssertEqual(labels.map(\.label), ["Mar", "Apr", "May", "Jun"])
    }
}

final class TripDaysFormatIsoDateTests: XCTestCase {
    func testReadsAsAHumanDate() {
        XCTAssertEqual(formatIsoDate("2025-03-14"), "14 Mar 2025")
    }

    func testHandsBackAnythingItCannotParseRatherThanInventingOne() {
        XCTAssertEqual(formatIsoDate("not-a-date"), "not-a-date")
    }
}

final class TripDaysDescribeRelativeDayTests: XCTestCase {
    func testNamesTheThreeDaysThatHaveAWordOfTheirOwn() {
        XCTAssertEqual(describeRelativeDay("2026-09-08", today: "2026-09-08"), "today")
        XCTAssertEqual(describeRelativeDay("2026-09-07", today: "2026-09-08"), "yesterday")
        XCTAssertEqual(describeRelativeDay("2026-09-09", today: "2026-09-08"), "tomorrow")
    }

    func testCountsWholeDaysEitherSideAcrossAMonthBoundary() {
        XCTAssertEqual(describeRelativeDay("2026-08-31", today: "2026-09-08"), "8 days ago")
        XCTAssertEqual(describeRelativeDay("2026-09-14", today: "2026-09-08"), "in 6 days")
    }

    func testSaysNothingAtAllAboutADateItCannotRead() {
        XCTAssertNil(describeRelativeDay("2026-02-30", today: "2026-09-08"))
        XCTAssertNil(describeRelativeDay("whenever", today: "2026-09-08"))
    }
}

final class TripDaysIsShortTripTests: XCTestCase {
    func testIsShortUpToTheThresholdAndLongPastIt() {
        XCTAssertTrue(isShortTrip(1))
        XCTAssertTrue(isShortTrip(shortTripDays))
        XCTAssertFalse(isShortTrip(shortTripDays + 1))
    }

    func testIsNeverShortForAnEmptySpan() {
        XCTAssertFalse(isShortTrip(0))
    }
}

/// What the web gets from `Date.UTC` for free, pinned here because the kernel
/// counts civil days by hand.
final class TripDaysCivilArithmeticTests: XCTestCase {
    func testAgreesWithFoundationsGregorianCalendarOverFourCenturies() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = utcMs(1900, 0, 1)
        for i in stride(from: 0, to: 146_097, by: 97) {
            let ms = start + Double(i) * 86_400_000
            let c = cal.dateComponents([.year, .month, .day, .weekday], from: Date(timeIntervalSince1970: ms / 1000))
            let expected = String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
            let day = addDays("1900-01-01", i)!
            XCTAssertEqual(day, expected)
            XCTAssertEqual(parseIsoDate(day), ms)
            // Foundation's weekday is 1 = Sunday; ours 0 = Monday.
            XCTAssertEqual(weekdayIndex(day), (c.weekday! + 5) % 7)
        }
    }

    func testRefusesATwoDigitYearAsDateUtcWouldMoveIt() {
        // `Date.UTC(50, …)` is 1950, so the web's round trip refuses year 0050.
        XCTAssertNil(parseIsoDate("0050-01-01"))
        XCTAssertNotNil(parseIsoDate("0100-01-01"))
    }
}
