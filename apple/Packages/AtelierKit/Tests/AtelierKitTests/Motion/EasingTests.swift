// Port of `src/shared/motion/easing.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class EasingRegistryTests: XCTestCase {
    func testPinsBothEndsOnEveryCurve() {
        for id in easingIds {
            let c = curveOf(id)
            assertClose(c.at(0, nil), 0, 9, id.rawValue)
            assertClose(c.at(1, nil), 1, 9, id.rawValue)
        }
    }

    func testNeverGoesBackwardsOnACurveThatCanBeInverted() {
        for id in invertibleEasings {
            let c = curveOf(id)
            var last = -1e-9
            for i in 0...100 {
                let v = c.at(Double(i) / 100, nil)
                XCTAssertGreaterThanOrEqual(v, last - 1e-12, "\(id.rawValue) at \(i)")
                last = v
            }
        }
    }

    func testRoundTripsThroughEveryClosedFormInverse() {
        XCTAssertGreaterThan(invertibleEasings.count, 0)
        for id in invertibleEasings {
            let c = curveOf(id)
            for i in 0...20 {
                let u = Double(i) / 20
                assertClose(c.inverse!(c.at(u, nil)), u, 9, "\(id.rawValue) at \(u)")
            }
        }
    }

    func testKeepsTheOverlayEnginesFourQuadraticsExactly() {
        assertClose(easeAt("in", 0.5), 0.25, 2)
        assertClose(easeAt("out", 0.5), 0.75, 2)
        assertClose(easeAt("in-out", 0.25), 0.125, 2)
        assertClose(easeAt("in-out", 0.75), 0.875, 2)
        assertClose(easeAt("linear", 0.3), 0.3, 2)
    }

    func testOvershootsOnBackAndSpringAndSaysSo() {
        for id in [EasingId.back, .spring] {
            let c = curveOf(id)
            XCTAssertTrue(c.overshoots)
            XCTAssertNil(c.inverse)
            var top = 0.0
            for i in 0...200 { top = max(top, c.at(Double(i) / 200, nil)) }
            XCTAssertGreaterThan(top, 1.01, id.rawValue)
        }
        XCTAssertFalse(invertibleEasings.contains(.back))
    }

    func testMovesInWholeJumpsOnStepsAndClampsTheCount() {
        XCTAssertEqual(easeAt("steps", 0.1, 4), 0)
        XCTAssertEqual(easeAt("steps", 0.26, 4), 0.25)
        XCTAssertEqual(easeAt("steps", 0.99, 4), 0.75)
        XCTAssertEqual(easeAt("steps", 1, 4), 1)
        XCTAssertEqual(easeAt("steps", 0.5), 0.5) // the default count
        XCTAssertEqual(clampSteps(nil as Double?), 4)
        XCTAssertEqual(clampSteps(99), 12)
        XCTAssertEqual(clampSteps(0), 2)
    }

    func testClampsProgressAndEasesAnUnknownIdLinearly() {
        XCTAssertEqual(easeAt("out", -1), 0)
        XCTAssertEqual(easeAt("out", 7), 1)
        XCTAssertEqual(easeAt("bounce-from-the-future", 0.4), 0.4)
        XCTAssertEqual(curveOf("nope").id, .linear)
        XCTAssertTrue(isEasingId("out-cubic"))
        XCTAssertFalse(isEasingId("ease-out"))
    }

    // Not in the web spec: the ids are stored in documents, so their strings
    // are pinned here byte for byte, in the registry's order.
    func testKeepsTheWebsIdsAndOrder() {
        XCTAssertEqual(easingIds.map(\.rawValue), [
            "linear", "in", "out", "in-out", "in-cubic", "out-cubic", "in-out-cubic", "out-expo", "back", "spring", "steps",
        ])
        XCTAssertEqual(invertibleEasings.map(\.rawValue), [
            "linear", "in", "out", "in-out", "in-cubic", "out-cubic", "in-out-cubic", "out-expo",
        ])
        XCTAssertEqual(easingCurves.count, easingIds.count)
        XCTAssertTrue(curveOf(.steps).stepped)
        XCTAssertEqual(curveOf(.inOut).label, "In-out")
    }
}
