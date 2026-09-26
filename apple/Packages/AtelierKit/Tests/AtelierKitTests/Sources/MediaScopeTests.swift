// Port of `src/shared/sources/media-scope.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let scopeDay = MediaScope(from: "2026-02-12", to: "2026-02-12", label: "12 Feb 2026", publisher: "Trips")

private func scopeWith(_ change: (inout MediaScope) -> Void) -> MediaScope {
    var s = scopeDay
    change(&s)
    return s
}

final class SameScopeTests: XCTestCase {
    func testIsTrueForTheSameSpanWordsAndPublisherSoAReRenderPublishesNothingNew() {
        XCTAssertTrue(sameScope(scopeDay, scopeWith { _ in }))
        XCTAssertTrue(sameScope(nil, nil))
    }

    func testIsFalseWhenAnyFieldDiffersOrWhenOnlyOneSideIsNull() {
        XCTAssertFalse(sameScope(scopeDay, scopeWith { $0.to = "2026-02-13" }))
        XCTAssertFalse(sameScope(scopeDay, scopeWith { $0.label = "the 12th" }))
        XCTAssertFalse(sameScope(scopeDay, scopeWith { $0.publisher = "Studio" }))
        XCTAssertFalse(sameScope(scopeDay, nil))
        XCTAssertFalse(sameScope(nil, scopeDay))
    }

    func testReadsAMissingIntentAsBrowseSoAnOldPublisherDoesNotChurn() {
        XCTAssertTrue(sameScope(scopeDay, scopeWith { $0.intent = .browse }))
        XCTAssertFalse(sameScope(scopeDay, scopeWith { $0.intent = .pick }))
    }
}

final class SameScopeWithinTests: XCTestCase {
    private let trip = ScopeWithin(from: "2026-02-01", to: "2026-02-20", label: "Australia")

    func testComparesTheWiderSpanByValueSoAReRenderWithAFreshObjectPublishesNothing() {
        XCTAssertTrue(sameScope(scopeWith { $0.within = trip }, scopeWith { $0.within = ScopeWithin(from: trip.from, to: trip.to, label: trip.label) }))
    }

    func testTellsAScopeWithAWiderSpanFromOneWithoutOrWithAnother() {
        XCTAssertFalse(sameScope(scopeDay, scopeWith { $0.within = trip }))
        var later = trip
        later.to = "2026-02-21"
        XCTAssertFalse(sameScope(scopeWith { $0.within = trip }, scopeWith { $0.within = later }))
    }
}

final class IsSingleDayTests: XCTestCase {
    func testReadsADayAsASpanThatStartsWhereItEnds() {
        XCTAssertTrue(isSingleDay(scopeDay))
        XCTAssertFalse(isSingleDay(scopeWith { $0.to = "2026-02-20" }))
    }

    func testHandsTheScopeOverrideItsSpan() {
        XCTAssertEqual(scopeWith { $0.to = "2026-02-14" }.span, DaySpan(from: "2026-02-12", to: "2026-02-14"))
    }
}
