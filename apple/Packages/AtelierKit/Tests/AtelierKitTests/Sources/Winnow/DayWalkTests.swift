// Port of `src/shared/sources/winnow/day-walk.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let oneDay = DaySpan(from: "2025-03-25", to: "2025-03-25")
private let span = DaySpan(from: "2025-03-25", to: "2025-03-27")
private let today = "2026-09-13"

final class NearestMediaDayTests: XCTestCase {
    private let days = [
        MediaDay(date: "2025-03-30", count: 2),
        MediaDay(date: "2025-03-20", count: 3),
        MediaDay(date: "2025-03-26", count: 6),
        MediaDay(date: "2025-03-24", count: 0),
        MediaDay(date: "2025-03-22", count: 1),
    ]

    func testTakesTheClosestDayWithMediaOnTheSideAskedInAnyOrder() {
        XCTAssertEqual(nearestMediaDay(days, oneDay, .after), MediaDay(date: "2025-03-26", count: 6))
        XCTAssertEqual(nearestMediaDay(days, oneDay, .before), MediaDay(date: "2025-03-22", count: 1))
    }

    func testSkipsDaysInsideTheSpanAndDaysThatHoldNothing() {
        XCTAssertEqual(nearestMediaDay(days, span, .after), MediaDay(date: "2025-03-30", count: 2))
        XCTAssertNil(nearestMediaDay([MediaDay(date: "2025-03-24", count: 0)], oneDay, .before))
    }
}

final class FirstWindowTests: XCTestCase {
    func testReachesTwoMonthsOutFromTheEdgeOfTheSpan() {
        XCTAssertEqual(firstWindow(span, .after, today), DaySpan(from: "2025-03-28", to: "2025-05-28"))
        XCTAssertEqual(firstWindow(span, .before, today), DaySpan(from: "2025-01-22", to: "2025-03-24"))
    }

    func testStopsAtTodayAndIsNilWhenThereIsNoLaterDayToLookAt() {
        XCTAssertEqual(firstWindow(DaySpan(from: "2026-09-01", to: "2026-09-01"), .after, today),
                       DaySpan(from: "2026-09-02", to: today))
        XCTAssertNil(firstWindow(DaySpan(from: today, to: today), .after, today))
    }
}

final class RestWindowTests: XCTestCase {
    private let bounds = CalendarBounds(min: "2019-06-01", max: "2026-08-30")

    func testAsksTheRestOfTheWayToTheEdgeOfTheLibrary() {
        XCTAssertEqual(restWindow(DaySpan(from: "2025-03-28", to: "2025-05-28"), .after, bounds, today),
                       DaySpan(from: "2025-05-29", to: "2026-08-30"))
        XCTAssertEqual(restWindow(DaySpan(from: "2025-01-22", to: "2025-03-24"), .before, bounds, today),
                       DaySpan(from: "2019-06-01", to: "2025-01-21"))
    }

    func testIsNilOnceTheFirstWindowAlreadyReachedTheEdgeOrWithNoBounds() {
        XCTAssertNil(restWindow(DaySpan(from: "2026-07-01", to: "2026-08-31"), .after, bounds, today))
        XCTAssertNil(restWindow(DaySpan(from: "2019-05-01", to: "2019-07-01"), .before, bounds, today))
        XCTAssertNil(restWindow(DaySpan(from: "2025-03-28", to: "2025-05-28"), .after, nil, today))
    }
}

final class DeckEntryTests: XCTestCase {
    func testReadsBeforeBodyAfter() {
        XCTAssertEqual(deckEntry(0, 3), .edge(.before))
        XCTAssertEqual(deckEntry(1, 3), .body(index: 0))
        XCTAssertEqual(deckEntry(3, 3), .body(index: 2))
        XCTAssertEqual(deckEntry(4, 3), .edge(.after))
    }
}

final class PageDirectionTests: XCTestCase {
    func testTellsForwardFromBackAcrossTheWrap() {
        XCTAssertEqual(pageDirection(1, 2, 5), 1)
        XCTAssertEqual(pageDirection(2, 1, 5), -1)
        XCTAssertEqual(pageDirection(4, 0, 5), 1)
        XCTAssertEqual(pageDirection(0, 4, 5), -1)
        XCTAssertEqual(pageDirection(1, 2, 3), 1)
        XCTAssertEqual(pageDirection(0, 2, 3), -1)
    }
}
