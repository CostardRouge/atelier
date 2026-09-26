// Port of `src/shared/overlay/heading-tape.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class Wrap360AndAngleDeltaTests: XCTestCase {
    func testWrapsAnyAngleInto0To360() {
        XCTAssertEqual(wrap360(0), 0)
        XCTAssertEqual(wrap360(360), 0)
        XCTAssertEqual(wrap360(-10), 350)
        XCTAssertEqual(wrap360(730), 10)
    }

    func testTakesTheShortWayRoundNorth() {
        XCTAssertEqual(angleDelta(10, 350), 20)
        XCTAssertEqual(angleDelta(350, 10), -20)
        XCTAssertEqual(angleDelta(0, 0), 0)
        XCTAssertEqual(abs(angleDelta(180, 0)), 180)
    }
}

final class TickLabelTests: XCTestCase {
    func testNamesTheCardinalsAndNumbersTheRest() {
        XCTAssertEqual(tickLabel(0, true), "N")
        XCTAssertEqual(tickLabel(90, true), "E")
        XCTAssertEqual(tickLabel(180, true), "S")
        XCTAssertEqual(tickLabel(270, true), "W")
        XCTAssertEqual(tickLabel(30, true), "30")
        XCTAssertEqual(tickLabel(360, true), "N") // wraps first
    }

    func testNumbersTheCardinalsTooWhenLettersAreOff() {
        XCTAssertEqual(tickLabel(90, false), "90")
    }
}

final class TapeTicksTests: XCTestCase {
    func testCentresTheHeadingAndStaysInsideTheWindow() throws {
        let ticks = tapeTicks(90, 90, 30, 10, true)
        XCTAssertGreaterThan(ticks.count, 0)
        for tk in ticks {
            XCTAssertGreaterThanOrEqual(tk.t, -1)
            XCTAssertLessThanOrEqual(tk.t, 1)
        }
        // 90° is a multiple of both steps, so a labelled tick sits under the sight.
        let centre = try XCTUnwrap(ticks.first { abs($0.t) < 1e-9 })
        XCTAssertEqual(centre.deg, 90)
        XCTAssertEqual(centre.label, "E")
    }

    func testSlidesRatherThanSnappingAnOffStepHeadingOffsetsEveryTick() throws {
        let ticks = tapeTicks(95, 90, 30, 10, true)
        XCTAssertFalse(ticks.contains { abs($0.t) < 1e-9 })
        let ninety = try XCTUnwrap(ticks.first { $0.deg == 90 })
        // 90 is 5° to the left of a 45° half-window.
        assertClose(ninety.t, -5.0 / 45, 6)
    }

    func testCrossesNorthWithoutAGap() {
        let ticks = tapeTicks(350, 90, 30, 10, true)
        let degs = ticks.map(\.deg)
        XCTAssertTrue(degs.contains(350))
        XCTAssertTrue(degs.contains(0))
        XCTAssertTrue(degs.contains(30))
        // Monotonic left to right, North included.
        let ts = ticks.map(\.t)
        XCTAssertEqual(ts.sorted(), ts)
        XCTAssertEqual(ticks.first { $0.deg == 0 }?.label, "N")
    }

    func testMarksMajorsAndLeavesMinorsUnlabelled() {
        let ticks = tapeTicks(0, 120, 30, 10, true)
        let majors = ticks.filter(\.major)
        XCTAssertTrue(majors.allSatisfy { $0.label != nil })
        XCTAssertTrue(ticks.filter { !$0.major }.allSatisfy { $0.label == nil })
        XCTAssertEqual(majors.map(\.deg), [300, 330, 0, 30, 60])
    }

    func testWidensWithTheSpan() {
        let narrow = tapeTicks(180, 40, 30, 10, true).count
        let wide = tapeTicks(180, 180, 30, 10, true).count
        XCTAssertGreaterThan(wide, narrow)
    }
}

final class TapeFadeAlphaTests: XCTestCase {
    func testIsOpaqueInTheMiddleAndGoneAtTheEdges() {
        XCTAssertEqual(tapeFadeAlpha(0, 0.2), 1)
        XCTAssertEqual(tapeFadeAlpha(1, 0.2), 0)
        XCTAssertEqual(tapeFadeAlpha(-1, 0.2), 0)
        assertClose(tapeFadeAlpha(0.9, 0.2), 0.5, 6)
        assertClose(tapeFadeAlpha(-0.9, 0.2), 0.5, 6)
    }

    func testNeverFadesWhenTheFadeIsOff() {
        XCTAssertEqual(tapeFadeAlpha(1, 0), 1)
        XCTAssertEqual(tapeFadeAlpha(-1, 0), 1)
    }
}
