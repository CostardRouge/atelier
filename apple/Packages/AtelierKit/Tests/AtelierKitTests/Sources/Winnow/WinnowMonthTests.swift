// Port of `src/shared/sources/winnow/month.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class WinnowMonthSpanTests: XCTestCase {
    func testListsEveryDayAndKnowsWhereTheGridStartsMondayIsZero() {
        let july = monthSpan("2025-07")
        XCTAssertEqual(july.from, "2025-07-01")
        XCTAssertEqual(july.to, "2025-07-31")
        XCTAssertEqual(july.days.count, 31)
        // 1 July 2025 is a Tuesday.
        XCTAssertEqual(july.leading, 1)
    }

    func testHandlesFebruaryInALeapYearInUTC() {
        XCTAssertEqual(monthSpan("2024-02").days.count, 29)
        XCTAssertEqual(monthSpan("2025-02").days.count, 28)
    }

    func testStartsASundayLedMonthAtTheEndOfTheRow() {
        // 1 June 2025 is a Sunday.
        XCTAssertEqual(monthSpan("2025-06").leading, 6)
    }
}

final class WinnowShiftMonthTests: XCTestCase {
    func testCrossesAYearBoundaryBothWays() {
        XCTAssertEqual(shiftMonth("2025-12", 1), "2026-01")
        XCTAssertEqual(shiftMonth("2025-01", -1), "2024-12")
        XCTAssertEqual(shiftMonth("2025-07", 0), "2025-07")
    }
}

final class WinnowMonthKeyAndLabelTests: XCTestCase {
    func testKeysADateByItsMonthAndNamesIt() {
        XCTAssertEqual(monthKeyOf("2025-07-09"), "2025-07")
        XCTAssertEqual(monthLabel("2025-07", locale: "en-GB"), "July 2025")
    }
}

final class WinnowMonthOptionsTests: XCTestCase {
    func testGroupsEveryMonthOfTheSpanByYearNewestYearFirstMonthsInOrder() {
        let opts = monthOptions("2024-11-05", "2025-02-15", locale: "en-GB")
        XCTAssertEqual(opts.map(\.year), ["2025", "2024"])
        XCTAssertEqual(opts[0].months.map(\.key), ["2025-01", "2025-02"])
        XCTAssertEqual(opts[1].months.map(\.label), ["November", "December"])
    }

    func testIsEmptyForInvertedBounds() {
        XCTAssertEqual(monthOptions("2025-02-01", "2025-01-01"), [])
    }

    func testCoversASingleMonth() {
        let opts = monthOptions("2025-07-03", "2025-07-20")
        XCTAssertEqual(opts.count, 1)
        XCTAssertEqual(opts[0].year, "2025")
        XCTAssertEqual(opts[0].months.map(\.key), ["2025-07"])
        XCTAssertFalse(opts[0].months[0].label.isEmpty)
    }
}
