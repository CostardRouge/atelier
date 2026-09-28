// Port of `src/shared/media/frame-plan.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class FramePlanTests: XCTestCase {
    func testPlansSecondsTimesFpsFramesStartingWhereTheFootageEnded() {
        let frames = framePlan(4, 30, 12_000_000)
        XCTAssertEqual(frames.count, 120)
        XCTAssertEqual(frames[0].timestampMicros, 12_000_000)
        XCTAssertEqual(frames[0].tSeconds, 0)
    }

    func testContinuesTheTimelineWithoutAGapAndWithoutAnOverlap() {
        let frames = framePlan(1, 30, 5_000_000)
        for i in 1..<frames.count {
            XCTAssertEqual(frames[i].timestampMicros, frames[i - 1].timestampMicros + frames[i - 1].durationMicros)
        }
        let last = frames[frames.count - 1]
        XCTAssertEqual(last.timestampMicros + last.durationMicros, 6_000_000)
    }

    func testDoesNotAccumulateDriftOnAnNTSCishRate() {
        let frames = framePlan(10, 29.97, 0)
        let last = frames[frames.count - 1]
        // Ten seconds of card at 29.97 must end within one frame of ten seconds.
        XCTAssertLessThan(abs(Double(last.timestampMicros + last.durationMicros - 10_000_000)), 1_000_000 / 29.97)
    }

    func testHandsTheCardItsOwnClockNotTheFiles() {
        let frames = framePlan(2, 25, 90_000_000)
        assertClose(frames[25].tSeconds, 1, 6)
    }

    func testAppendsNothingForNoTimeNoRateOrNonsense() {
        XCTAssertEqual(framePlan(0, 30, 0), [])
        XCTAssertEqual(framePlan(-1, 30, 0), [])
        XCTAssertEqual(framePlan(4, 0, 0), [])
        XCTAssertEqual(framePlan(Double.nan, 30, 0), [])
    }

    func testAVeryShortCardStillGetsOneFrame() {
        XCTAssertEqual(framePlan(0.01, 30, 0).count, 1)
    }
}
