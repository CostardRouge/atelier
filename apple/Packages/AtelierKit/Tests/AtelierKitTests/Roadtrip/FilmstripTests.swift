// Port of `src/shared/roadtrip/filmstrip.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class TripFilmstripTimesTests: XCTestCase {
    func testSamplesTheMiddleOfEachSliceNotItsEdge() {
        // The left edge would put the first cell on frame zero — a drone clip's
        // props spinning up on the ground — and never show the last slice.
        XCTAssertEqual(filmstripTimes(10, 5), [1, 3, 5, 7, 9])
    }

    func testSpreadsAcrossTheWholeClip() {
        let times = filmstripTimes(60, 12)
        XCTAssertGreaterThan(times[0], 0)
        XCTAssertLessThan(times[times.count - 1], 60)
        XCTAssertGreaterThan(times[times.count - 1], 55)
    }

    func testAlwaysGivesExactlyTheAskedForNumberOfCells() {
        for n in [1, 6, 16] { XCTAssertEqual(filmstripTimes(23.7, n).count, n) }
    }

    func testIsAllZerosForAClipWithNoDurationYetRatherThanNaN() {
        XCTAssertEqual(filmstripTimes(0, 4), [0, 0, 0, 0])
        XCTAssertTrue(filmstripTimes(Double.nan, 3).allSatisfy { $0 == 0 })
    }

    func testNeverReturnsAnEmptyStrip() {
        XCTAssertEqual(filmstripTimes(10, 0).count, 1)
        XCTAssertEqual(filmstripTimes(10, -4).count, 1)
    }
}

final class TripStripCountTests: XCTestCase {
    func testGrowsWithTheWidthWithinBounds() {
        XCTAssertEqual(stripCount(680), 10)
        XCTAssertEqual(stripCount(4000), 16)
        XCTAssertEqual(stripCount(50), 6)
    }

    func testIsSaneBeforeTheStripHasBeenMeasured() {
        XCTAssertEqual(stripCount(0), 6)
        XCTAssertEqual(stripCount(Double.nan), 6)
    }
}

final class TripFractionOfTimeTests: XCTestCase {
    func testPlacesATimeAlongTheStrip() {
        XCTAssertEqual(fractionOfTime(5, 10), 0.5)
        XCTAssertEqual(fractionOfTime(0, 10), 0)
    }

    func testClampsRatherThanRunningOffEitherEnd() {
        XCTAssertEqual(fractionOfTime(-2, 10), 0)
        XCTAssertEqual(fractionOfTime(99, 10), 1)
    }

    func testIsTheStartWhenThereIsNoDuration() {
        XCTAssertEqual(fractionOfTime(5, 0), 0)
    }
}

final class TripTimeFromPointerTests: XCTestCase {
    private let rect = Rect(x: 100, y: 0, width: 400, height: 0)

    func testReadsAPositionAlongTheStrip() {
        assertClose(timeFromPointer(300, rect, 10), 5, 6)
    }

    func testClampsADragThatLeavesTheStrip() {
        XCTAssertEqual(timeFromPointer(0, rect, 10), 0)
        assertClose(timeFromPointer(9999, rect, 10), 9.95, 6)
    }

    func testStopsAHairShortOfTheEnd() {
        // A seek past the last frame never lands, so the preview would simply
        // stop updating.
        XCTAssertLessThan(timeFromPointer(9999, rect, 10), 10)
    }

    func testSurvivesAStripThatHasNotBeenLaidOut() {
        XCTAssertEqual(timeFromPointer(200, Rect(x: 0, y: 0, width: 0, height: 0), 10), 0)
    }
}

final class TripKeyStepTests: XCTestCase {
    func testIsFineButNeverImperceptible() {
        XCTAssertGreaterThanOrEqual(keyStep(300), 1.0 / 30)
        XCTAssertGreaterThanOrEqual(keyStep(0.5), 1.0 / 30)
    }

    func testIsBiggerWithAModifier() {
        XCTAssertGreaterThan(keyStep(300, coarse: true), keyStep(300))
    }
}
