// Port of `src/shared/overlay/stage-size.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class StageFrameSizeTests: XCTestCase {
    func testLeavesAClipAlone4KIsTheBudgetNotPastIt() {
        XCTAssertEqual(stageFrameSize(3840, 2160), Size(3840, 2160))
        XCTAssertEqual(stageFrameSize(1920, 1080), Size(1920, 1080))
        XCTAssertEqual(stageFrameSize(1080, 1920), Size(1080, 1920))
    }

    func testScalesA48MegapixelStillDownToTheBudget() {
        let s = stageFrameSize(8064, 6048)
        XCTAssertLessThanOrEqual(s.width * s.height, maxStagePixels * 1.001)
        // Within a rounding of the source's aspect, and much bigger than what
        // any screen shows: a budget, not a thumbnail.
        assertClose(s.width / s.height, 8064.0 / 6048, 3)
        XCTAssertGreaterThan(s.width, 3000)
    }

    func testKeepsTheAspectOfAPortraitStill() {
        let s = stageFrameSize(6048, 8064)
        assertClose(s.width / s.height, 6048.0 / 8064, 3)
        XCTAssertGreaterThan(s.height, s.width)
    }

    func testCapsUltraWideFootageOnItsAreaNotItsLongEdge() {
        let s = stageFrameSize(6016, 3384)
        XCTAssertLessThanOrEqual(s.width * s.height, maxStagePixels * 1.001)
        assertClose(s.width / s.height, 6016.0 / 3384, 3)
    }

    func testNeverReturnsAZeroSideWhateverTheBudget() {
        let s = stageFrameSize(8000, 10, budget: 100)
        XCTAssertGreaterThanOrEqual(s.width, 1)
        XCTAssertGreaterThanOrEqual(s.height, 1)
    }

    func testAnswers0x0ForAFrameThatHasNoSizeYet() {
        XCTAssertEqual(stageFrameSize(0, 0), Size(0, 0))
        XCTAssertEqual(stageFrameSize(1920, 0), Size(0, 0))
        XCTAssertEqual(stageFrameSize(.nan, 1080), Size(0, 0))
    }
}
