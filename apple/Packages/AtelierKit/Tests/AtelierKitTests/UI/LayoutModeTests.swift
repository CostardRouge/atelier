// Port of `src/shared/ui/layout-mode.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class ModeForWidthTests: XCTestCase {
    func testNamesTheThreeModesAtTheWidthsThatMatter() {
        // The devices the suite's responsive work has actually been measured on.
        XCTAssertEqual(modeForWidth(390), .compact) // iPhone portrait
        XCTAssertEqual(modeForWidth(744), .compact) // iPad mini portrait
        XCTAssertEqual(modeForWidth(834), .medium) // iPad portrait
        XCTAssertEqual(modeForWidth(1024), .medium) // iPad landscape
        XCTAssertEqual(modeForWidth(1280), .expanded)
        XCTAssertEqual(modeForWidth(1920), .expanded)
    }

    func testSwitchesExactlyOnTheBoundariesBottomExclusive() {
        XCTAssertEqual(modeForWidth(LayoutMode.compactMax - 1), .compact)
        XCTAssertEqual(modeForWidth(LayoutMode.compactMax), .medium)
        XCTAssertEqual(modeForWidth(LayoutMode.mediumMax - 1), .medium)
        XCTAssertEqual(modeForWidth(LayoutMode.mediumMax), .expanded)
    }

    func testReadsAWidthNothingCouldMeasureAsTheSafestMode() {
        // A zero-width or not-yet-measured viewport must not claim it has room
        // for three docked columns: compact is the one that fits anywhere.
        XCTAssertEqual(modeForWidth(0), .compact)
        XCTAssertEqual(modeForWidth(.nan), .compact)
        XCTAssertEqual(modeForWidth(-100), .compact)
    }
}

final class AtLeastTests: XCTestCase {
    func testOrdersTheModesNarrowestToWidest() {
        XCTAssertTrue(LayoutMode.compact.atLeast(.compact))
        XCTAssertFalse(LayoutMode.compact.atLeast(.medium))
        XCTAssertTrue(LayoutMode.medium.atLeast(.medium))
        XCTAssertFalse(LayoutMode.medium.atLeast(.expanded))
        XCTAssertTrue(LayoutMode.expanded.atLeast(.compact))
        XCTAssertTrue(LayoutMode.expanded.atLeast(.expanded))
    }

    func testAgreesWithTheDeclaredOrder() {
        XCTAssertEqual(LayoutMode.layoutModes, [.compact, .medium, .expanded])
        XCTAssertEqual(LayoutMode.allCases, [.compact, .medium, .expanded])
        // `Comparable` is the same order, so `<` reads as "narrower".
        XCTAssertTrue(LayoutMode.compact < LayoutMode.medium)
        XCTAssertTrue(LayoutMode.medium < LayoutMode.expanded)
        XCTAssertFalse(LayoutMode.expanded < LayoutMode.compact)
    }
}

final class ModeForMatchesTests: XCTestCase {
    func testLetsTheNarrowerQueryWin() {
        // A compact width matches BOTH max-width queries; the narrower one is
        // the answer, or every phone would read as a tablet.
        XCTAssertEqual(modeForMatches(compact: true, medium: true), .compact)
        XCTAssertEqual(modeForMatches(compact: false, medium: true), .medium)
        XCTAssertEqual(modeForMatches(compact: false, medium: false), .expanded)
    }

    func testMatchesWhatTheQueriesThemselvesWouldReport() {
        let widths: [Double] = [320, 390, 600, 819, 820, 900, 1179, 1180, 1440]
        for w in widths {
            let compact = w <= LayoutMode.compactMax - 1
            let medium = w <= LayoutMode.mediumMax - 1
            XCTAssertEqual(modeForMatches(compact: compact, medium: medium), modeForWidth(w), "at \(w)")
        }
    }

    func testBuildsTheQueriesOffTheSameTwoConstants() {
        XCTAssertEqual(LayoutMode.compactQuery, "(max-width: 819px)")
        XCTAssertEqual(LayoutMode.mediumQuery, "(max-width: 1179px)")
    }
}
