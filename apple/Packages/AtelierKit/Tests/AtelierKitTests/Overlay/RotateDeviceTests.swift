// Port of `src/shared/overlay/rotate-device.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class TipProgressTests: XCTestCase {
    func testStartsAndEndsTheCycleUprightSoTheLoopNeverJumps() {
        XCTAssertEqual(tipProgress(0, 2), 0)
        assertClose(tipProgress(1.999, 2), 0, 2)
    }

    func testReachesAFullQuarterTurnAndHoldsIt() {
        XCTAssertEqual(tipProgress(1, 2), 1)
        XCTAssertEqual(tipProgress(1.3, 2), 1)
    }

    func testLoops() {
        XCTAssertEqual(tipProgress(1, 2), tipProgress(5, 2))
        assertClose(tipProgress(0.4, 2), tipProgress(2.4, 2), 2)
    }

    func testNeverComesBackWhenTheReturnIsOff() {
        XCTAssertEqual(tipProgress(1.9, 2, returns: false), 1)
    }

    func testStaysInside0To1WhateverTheTime() {
        for t in [-5, -0.1, 0, 0.37, 3.14, 99] {
            let v = tipProgress(t, 1.8)
            XCTAssertGreaterThanOrEqual(v, 0)
            XCTAssertLessThanOrEqual(v, 1)
        }
    }
}

final class TipAngleTests: XCTestCase {
    func testTurnsAQuarterEachWay() {
        assertClose(tipAngle(1, 2, direction: .cw), Double.pi / 2, 2)
        assertClose(tipAngle(1, 2, direction: .ccw), -Double.pi / 2, 2)
    }
}
