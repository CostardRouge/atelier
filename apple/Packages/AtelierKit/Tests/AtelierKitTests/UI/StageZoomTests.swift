// Port of `src/shared/ui/stage-zoom.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// The spec's `wheel()` builder: a bare vertical notch up, overridden per case.
private func wheel(deltaX: Double = 0, deltaY: Double = -100, ctrlKey: Bool = false,
                   metaKey: Bool = false, shiftKey: Bool = false) -> WheelLike {
    WheelLike(deltaX: deltaX, deltaY: deltaY, ctrlKey: ctrlKey, metaKey: metaKey, shiftKey: shiftKey)
}

final class ClampZoomTests: XCTestCase {
    func testRunsFromAQuarterToSixteenTimes() {
        XCTAssertEqual(zoomLabel(minStageZoom), "25%")
        XCTAssertEqual(zoomLabel(maxStageZoom), "1600%")
    }

    func testHoldsTheRange() {
        XCTAssertEqual(clampZoom(100), maxStageZoom)
        XCTAssertEqual(clampZoom(0.01), minStageZoom)
        XCTAssertEqual(clampZoom(2), 2)
    }

    func testFallsBackToFitOnABrokenNumber() {
        XCTAssertEqual(clampZoom(.nan), 1)
    }
}

final class StepZoomTests: XCTestCase {
    func testStepsGeometrically() {
        assertClose(stepZoom(1, 1), 1.25, 2)
        assertClose(stepZoom(2, -1), 1.6, 2)
    }

    func testLandsOnFitWhenAStepWouldCrossIt() {
        XCTAssertEqual(stepZoom(1.1, -1), 1)
        XCTAssertEqual(stepZoom(0.9, 1), 1)
    }

    func testCannotLeaveTheRange() {
        XCTAssertEqual(stepZoom(maxStageZoom, 1), maxStageZoom)
        XCTAssertEqual(stepZoom(minStageZoom, -1), minStageZoom)
    }
}

final class ZoomByWheelTests: XCTestCase {
    func testGrowsScrollingUpAndShrinksScrollingDown() {
        XCTAssertGreaterThan(zoomByWheel(1, -100), 1)
        XCTAssertLessThan(zoomByWheel(1, 100), 1)
    }

    func testIsProportionalSoTheGestureFeelsTheSameAtEveryScale() {
        let a = zoomByWheel(1, -100)
        let b = zoomByWheel(2, -100)
        assertClose(b / 2, a, 2)
    }
}

final class ZoomByPinchTests: XCTestCase {
    func testAppliesTheFingerRatioToTheScaleThePinchStartedFrom() {
        XCTAssertEqual(zoomByPinch(1.5, 2), 3)
    }

    func testIgnoresADegenerateRatio() {
        XCTAssertEqual(zoomByPinch(2, 0), 2)
        XCTAssertEqual(zoomByPinch(2, .nan), 2)
    }
}

final class ScrollAfterZoomTests: XCTestCase {
    func testKeepsThePointUnderThePointerStill() {
        // 400px into the content, sitting 100px into the viewport; doubling the
        // scale puts that same content point at 800, so the scroll must be 700.
        let next = scrollAfterZoom(StageScroll(left: 300, top: 0), anchor: Point(100, 0), 1, 2)
        XCTAssertEqual(next.left, 700)
    }

    func testNeverScrollsIntoTheNegativeWhereTheCentredContentSits() {
        let next = scrollAfterZoom(StageScroll(left: 0, top: 0), anchor: Point(200, 150), 2, 1)
        XCTAssertEqual(next, StageScroll(left: 0, top: 0))
    }

    func testHoldsTheAnchorPastContentThatDoesNotScale() {
        // A 30px rail, the pointer 100px into the viewport, 70px of scaled
        // content before it: doubling puts that content at 140, so the scroll
        // is 30 + 140 − 100 = 70 — not the 100 the rail-less formula would give.
        let next = scrollAfterZoom(StageScroll(left: 0, top: 0), anchor: Point(100, 0), 1, 2,
                                   ScrollAfterZoom(fixed: .init(x: 30)))
        XCTAssertEqual(next.left, 70)
    }

    func testFollowsTheContentNotTheScaleWhenAZoneIsFrozen() {
        // The ruler at its 6px floor: the track did not move, so neither may
        // the scroll — the scale ratio alone would have yanked it by a quarter.
        let scroll = StageScroll(left: 500, top: 0)
        let next = scrollAfterZoom(scroll, anchor: Point(200, 0), 1, 1.25, ScrollAfterZoom(grew: .init(x: 1)))
        XCTAssertEqual(next.left, 500)
    }

    func testLeavesTheScrollAloneOnANonsensePreviousScale() {
        let scroll = StageScroll(left: 12, top: 34)
        XCTAssertEqual(scrollAfterZoom(scroll, anchor: Point(0, 0), 0, 2), scroll)
    }
}

final class ZoneFloorTests: XCTestCase {
    func testIsHeldInsideTheRangeAndNeverAboveFit() {
        XCTAssertEqual(zoomFloor(), minStageZoom)
        XCTAssertEqual(zoomFloor(0.1), minStageZoom)
        XCTAssertEqual(zoomFloor(2), 1)
        XCTAssertEqual(zoomFloor(0.6), 0.6)
    }

    func testStopsEveryWayOfZoomingOut() {
        XCTAssertEqual(clampZoom(0.3, 0.6), 0.6)
        XCTAssertEqual(stepZoom(0.62, -1, 0.6), 0.6)
        XCTAssertEqual(zoomByWheel(0.6, 200, 0.6), 0.6)
        XCTAssertEqual(zoomByPinch(0.6, 0.5, 0.6), 0.6)
    }
}

final class MinScaleToFillTests: XCTestCase {
    func testLandsOn1ForAZoneWhoseFitIs100Percent() {
        // The stage ruler: its day width is the box's own share of the trip.
        XCTAssertEqual(minScaleToFill({ s in 800 * s }, 800), 1)
    }

    func testFloorsNothingWhenTheContentAlreadyOverflowsAtTheBottom() {
        // A 616-day ruler is 3696px wide at every scale down there.
        XCTAssertEqual(minScaleToFill({ _ in 3696 }, 460), minStageZoom)
    }

    func testStopsAt1ForContentThatNeverFillsTheBox() {
        // A short trip's grid on a wide screen: 2 columns of 17px.
        XCTAssertEqual(minScaleToFill({ s in 2 * 17 * s }, 900), 1)
    }

    func testFindsAStaircasesStepAndNeverLandsAPixelShort() {
        let width: (Double) -> Double = { s in
            let cell = max(4, (14 * s).rounded(.toNearestOrAwayFromZero))
            let gutter = max(1, (3 * s).rounded(.toNearestOrAwayFromZero))
            return 45 * (cell + gutter)
        }
        let floor = minScaleToFill(width, 390)
        XCTAssertGreaterThanOrEqual(width(floor), 390)
        XCTAssertLessThan(width(floor - 0.02), 390)
    }

    func testFloorsNothingBeforeTheBoxIsMeasured() {
        XCTAssertEqual(minScaleToFill({ s in 800 * s }, 0), minStageZoom)
    }
}

final class GrowthRatioTests: XCTestCase {
    func testIsHowMuchTheContentReallyGrew() {
        XCTAssertEqual(growthRatio(100, 250, 9), 2.5)
    }

    func testIs1ForContentThatDidNotMoveWhateverTheScalesDid() {
        XCTAssertEqual(growthRatio(3696, 3696, 1.25), 1)
    }

    func testFallsBackOnAZoneThatHasNotMeasuredYet() {
        XCTAssertEqual(growthRatio(0, 100, 1.25), 1.25)
    }
}

final class WheelZoomsTests: XCTestCase {
    func testAlwaysZoomsOnCmdCtrlWhateverTheMode() {
        XCTAssertTrue(wheelZooms(wheel(ctrlKey: true), .modifier))
        XCTAssertTrue(wheelZooms(wheel(metaKey: true), .modifier))
    }

    func testLeavesABareWheelAloneUnderModifier() {
        XCTAssertFalse(wheelZooms(wheel(), .modifier))
    }

    func testZoomsOnABareVerticalWheelUnderAny() {
        XCTAssertTrue(wheelZooms(wheel(), .any))
    }

    func testLeavesHorizontalPanningToTheBrowserUnderAny() {
        XCTAssertFalse(wheelZooms(wheel(shiftKey: true), .any))
        XCTAssertFalse(wheelZooms(wheel(deltaX: -120, deltaY: 0), .any))
        // A trackpad swipe is never purely one axis; the dominant one decides.
        XCTAssertFalse(wheelZooms(wheel(deltaX: -80, deltaY: -6), .any))
        XCTAssertTrue(wheelZooms(wheel(deltaX: -6, deltaY: -80), .any))
    }
}

final class ZoomLabelTests: XCTestCase {
    func testReadsAsAPercentage() {
        XCTAssertEqual(zoomLabel(1), "100%")
        XCTAssertEqual(zoomLabel(1.256), "126%")
    }
}
