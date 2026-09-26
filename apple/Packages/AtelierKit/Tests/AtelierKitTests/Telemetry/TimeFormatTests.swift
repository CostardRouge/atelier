// Port of `src/shared/telemetry/time-format.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let sample = "2026-05-30 05:49:34.609"
private let wc = parseWallClock(sample)!

/// The web's `{ ...wc, field: value }`.
private func with(_ base: WallClock, _ change: (inout WallClock) -> Void) -> WallClock {
    var out = base
    change(&out)
    return out
}

final class ParseWallClockTests: XCTestCase {
    func testReadsTheDjiTimestampLine() {
        XCTAssertEqual(wc, WallClock(year: 2026, month: 5, day: 30, hour: 5, minute: 49, second: 34, ms: 609))
    }

    func testToleratesSlashesATSeparatorAndMissingSubParts() {
        let slashes = parseWallClock("2026/05/30 17:00")
        XCTAssertEqual(slashes?.hour, 17)
        XCTAssertEqual(slashes?.second, 0)
        XCTAssertEqual(slashes?.ms, 0)
        let iso = parseWallClock("2026-05-30T17:00:05")
        XCTAssertEqual(iso?.hour, 17)
        XCTAssertEqual(iso?.second, 5)
        XCTAssertEqual(parseWallClock("2026-05-30 17:00:05,25")?.ms, 250)
    }

    func testRefusesAnythingThatIsNotAReading() {
        XCTAssertNil(parseWallClock(nil))
        XCTAssertNil(parseWallClock(""))
        XCTAssertNil(parseWallClock("FrameCnt: 12"))
        XCTAssertNil(parseWallClock("2026-13-30 05:49:34")) // month 13
        XCTAssertNil(parseWallClock("2026-05-30 25:49:34")) // hour 25
    }
}

final class FormatClockTests: XCTestCase {
    func testDefaultsToAPadded24HourReadingWithSeconds() {
        XCTAssertEqual(formatClock(wc), "05:49:34")
    }

    func testDropsSecondsAndAddsMillisecondsOnRequest() {
        XCTAssertEqual(formatClock(wc, TimeFormatOptions(seconds: false)), "05:49")
        XCTAssertEqual(formatClock(wc, TimeFormatOptions(milliseconds: true)), "05:49:34.609")
    }

    func testSwitchesTo12HourWithAnUnpaddedHourAndAMeridiem() {
        XCTAssertEqual(formatClock(wc, TimeFormatOptions(hour12: true)), "5:49:34 AM")
        let pm = with(wc) { $0.hour = 17 }
        XCTAssertEqual(formatClock(pm, TimeFormatOptions(hour12: true)), "5:49:34 PM")
    }

    func testCanHideTheMeridiem() {
        XCTAssertEqual(formatClock(with(wc) { $0.hour = 17 }, TimeFormatOptions(hour12: true, meridiem: false)), "5:49:34")
    }

    func testNamesMidnightAndNoon12Not0() {
        XCTAssertEqual(formatClock(with(wc) { $0.hour = 0 }, TimeFormatOptions(hour12: true)), "12:49:34 AM")
        XCTAssertEqual(formatClock(with(wc) { $0.hour = 12 }, TimeFormatOptions(hour12: true)), "12:49:34 PM")
    }
}

final class FormatDateTests: XCTestCase {
    func testOffersEveryStyle() {
        XCTAssertEqual(formatDate(wc), "2026-05-30")
        XCTAssertEqual(formatDate(wc, TimeFormatOptions(dateStyle: .dmy)), "30/05/2026")
        XCTAssertEqual(formatDate(wc, TimeFormatOptions(dateStyle: .mdy)), "05/30/2026")
        XCTAssertEqual(formatDate(wc, TimeFormatOptions(dateStyle: .longDmy)), "30 May 2026")
        XCTAssertEqual(formatDate(wc, TimeFormatOptions(dateStyle: .longMdy)), "May 30, 2026")
        XCTAssertEqual(formatDate(wc, TimeFormatOptions(dateStyle: .weekday)), "Sat 30 May 2026")
    }

    func testComputesTheWeekdayFromTheCalendarNotTheMachine() {
        XCTAssertEqual(weekdayOf(with(wc) { $0.year = 2026; $0.month = 5; $0.day = 30 }), 6) // Saturday
        XCTAssertEqual(weekdayOf(WallClock(year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0)), 4) // Thursday
        XCTAssertEqual(weekdayOf(WallClock(year: 1969, month: 12, day: 31, hour: 0, minute: 0, second: 0, ms: 0)), 3) // Wednesday
    }

    func testTheDateStylesKeepTheWebsSpellings() {
        XCTAssertEqual(DateStyle.allCases.map(\.rawValue), ["iso", "dmy", "mdy", "long-dmy", "long-mdy", "weekday"])
    }
}

final class ShiftWallClockTests: XCTestCase {
    func testIsANoOpAtZero() {
        XCTAssertEqual(shiftWallClock(wc, TimeShift(minutes: 0, days: 0)), wc)
        XCTAssertEqual(shiftWallClock(wc, nil), wc)
        XCTAssertEqual(shiftWallClock(wc, .noShift), wc)
    }

    func testAddsAndSubtractsHours() {
        XCTAssertEqual(formatClock(shiftWallClock(wc, TimeShift(minutes: 120, days: 0))), "07:49:34")
        XCTAssertEqual(formatClock(shiftWallClock(wc, TimeShift(minutes: -60, days: 0))), "04:49:34")
    }

    func testHandlesTheHalfHourAndQuarterHourOffsetsThatReallyExist() {
        XCTAssertEqual(formatClock(shiftWallClock(wc, TimeShift(minutes: 330, days: 0))), "11:19:34")
        XCTAssertEqual(formatClock(shiftWallClock(wc, TimeShift(minutes: 345, days: 0))), "11:34:34")
    }

    func testRollsTheDateRatherThanWrappingTheHour() {
        let late = with(wc) { $0.hour = 23; $0.minute = 30 }
        let rolled = shiftWallClock(late, TimeShift(minutes: 60, days: 0))
        XCTAssertEqual(formatClock(rolled, TimeFormatOptions(seconds: false)), "00:30")
        XCTAssertEqual(formatDate(rolled), "2026-05-31")

        let early = with(wc) { $0.hour = 0; $0.minute = 30 }
        let back = shiftWallClock(early, TimeShift(minutes: -60, days: 0))
        XCTAssertEqual(formatClock(back, TimeFormatOptions(seconds: false)), "23:30")
        XCTAssertEqual(formatDate(back), "2026-05-29")
    }

    func testCrossesMonthAndYearBoundaries() {
        let nye = WallClock(year: 2025, month: 12, day: 31, hour: 23, minute: 0, second: 0, ms: 0)
        XCTAssertEqual(formatDate(shiftWallClock(nye, TimeShift(minutes: 90, days: 0))), "2026-01-01")
        XCTAssertEqual(formatDate(shiftWallClock(wc, TimeShift(minutes: 0, days: 2))), "2026-06-01")
        XCTAssertEqual(formatDate(shiftWallClock(wc, TimeShift(minutes: 0, days: -365))), "2025-05-30")
    }

    func testCombinesADayShiftWithAMinuteShift() {
        let out = shiftWallClock(wc, TimeShift(minutes: -360, days: 1))
        XCTAssertEqual(formatTimestamp(out), "2026-05-30 23:49:34")
    }

    func testIsMachineIndependentTheSameReadingWhateverTheLocalZone() {
        // Real proof of the zone-free arithmetic: parsing into a local Date
        // would make this depend on the device's zone.
        let shifted = shiftWallClock(wc, TimeShift(minutes: 90, days: 0))
        XCTAssertEqual(shifted, with(wc) { $0.hour = 7; $0.minute = 19 })
    }

    func testKeepsTheMillisecondsThroughAShift() {
        XCTAssertEqual(shiftWallClock(wc, TimeShift(minutes: 1, days: 0)).ms, 609)
    }

    func testToEpochIsDateUTC() {
        // `Date.UTC(2026, 4, 30, 5, 49, 34, 609)`: 20 603 days, then 5:49:34.609.
        XCTAssertEqual(toEpoch(wc), 1_780_120_174_609)
        // The same instant through Foundation's UTC calendar — a second,
        // independent ruler for the integer arithmetic.
        var comps = DateComponents()
        comps.year = 2026; comps.month = 5; comps.day = 30; comps.hour = 5; comps.minute = 49; comps.second = 34
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(toEpoch(wc), cal.date(from: comps)!.timeIntervalSince1970 * 1000 + 609)
        XCTAssertEqual(toEpoch(WallClock(year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0)), 0)
        XCTAssertEqual(toEpoch(WallClock(year: 2000, month: 2, day: 29, hour: 0, minute: 0, second: 0, ms: 0)), 951_782_400_000)
        // A day past the month's end rolls forward, as Date.UTC rolls it.
        XCTAssertEqual(toEpoch(WallClock(year: 2026, month: 2, day: 29, hour: 0, minute: 0, second: 0, ms: 0)),
                       toEpoch(WallClock(year: 2026, month: 3, day: 1, hour: 0, minute: 0, second: 0, ms: 0)))
    }
}

final class FormatTimestampTests: XCTestCase {
    func testJoinsTheChosenDateAndClockStyles() {
        XCTAssertEqual(formatTimestamp(wc), "2026-05-30 05:49:34")
        XCTAssertEqual(formatTimestamp(wc, TimeFormatOptions(hour12: true, seconds: false, dateStyle: .longDmy)), "30 May 2026 5:49 AM")
    }
}
