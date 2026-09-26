// Port of `src/shared/ui/pan-zoom.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let viewport = Size(800, 600)

final class ClampViewZoomTests: XCTestCase {
    func testHoldsTheFitAsTheFloorAnd8xAsTheCeiling() {
        XCTAssertEqual(clampViewZoom(0.2), minViewZoom)
        XCTAssertEqual(clampViewZoom(99), maxViewZoom)
        XCTAssertEqual(clampViewZoom(.nan), minViewZoom)
    }
}

final class StepViewZoomTests: XCTestCase {
    func testStepsBy1Point5AndCannotGoUnderTheFit() {
        assertClose(stepViewZoom(1, 1), 1.5, 2)
        XCTAssertEqual(stepViewZoom(1, -1), 1)
        assertClose(stepViewZoom(2.25, -1), 1.5, 2)
    }
}

final class ZoomByWheelDeltaAndPinchRatioTests: XCTestCase {
    func testZoomsInOnAWheelUpAndOutOnAWheelDown() {
        assertClose(zoomByWheelDelta(2, -400), 2 * M_E, 2)
        assertClose(zoomByWheelDelta(4, 400), 4 / M_E, 2)
        // And it cannot go under the fit on the way back down.
        XCTAssertEqual(zoomByWheelDelta(2, 400), minViewZoom)
    }

    func testAppliesTheFingerRatioToTheScaleThePinchStartedFrom() {
        XCTAssertEqual(zoomByPinchRatio(2, 1.5), 3)
        XCTAssertEqual(zoomByPinchRatio(2, 0), 2)
    }
}

final class ContainedSizeTests: XCTestCase {
    func testFitsThePictureWithoutCroppingIt() {
        XCTAssertEqual(containedSize(Size(4000, 3000), viewport), Size(800, 600))
        // A panorama is limited by the width and leaves the height unused.
        XCTAssertEqual(containedSize(Size(4000, 1000), viewport), Size(800, 200))
    }

    func testFallsBackToTheBoxWhileTheSizeIsUnknown() {
        XCTAssertEqual(containedSize(nil, viewport), viewport)
        XCTAssertEqual(containedSize(Size(0, 0), viewport), viewport)
    }
}

final class PanLimitAndClampViewTests: XCTestCase {
    func testGivesNoSlackAtTheFittedSize() {
        XCTAssertEqual(panLimit(viewport: viewport, content: viewport, scale: 1), Point(0, 0))
        XCTAssertEqual(clampView(ViewState(scale: 1, x: 200, y: -50), viewport: viewport, content: viewport), .fitted)
    }

    func testGivesHalfTheOverflowOnEachSide() {
        XCTAssertEqual(panLimit(viewport: viewport, content: viewport, scale: 2), Point(400, 300))
        XCTAssertEqual(clampView(ViewState(scale: 2, x: 999, y: -999), viewport: viewport, content: viewport),
                       ViewState(scale: 2, x: 400, y: -300))
    }

    func testMeasuresTheSlackOffThePictureNotOffTheBox() {
        // A letterboxed panorama zoomed 2× is 1600×400: wide enough to pan
        // sideways, still shorter than the box, so it cannot move vertically.
        let content = Size(800, 200)
        XCTAssertEqual(panLimit(viewport: viewport, content: content, scale: 2), Point(400, 0))
    }

    func testSpellsANegativeZeroAsZero() {
        let rest = clampView(ViewState(scale: 1, x: -50, y: -50), viewport: viewport, content: viewport)
        XCTAssertEqual(rest.x.sign, .plus)
        XCTAssertEqual(rest.y.sign, .plus)
    }
}

final class ZoomAboutTests: XCTestCase {
    func testKeepsThePointUnderThePointerStill() {
        // 100px right of centre, at rest: zooming 2× moves that point of the
        // picture out to 200, so the offset owed is −100.
        let next = zoomAbout(.fitted, 2, anchor: Point(100, 0), viewport: viewport, content: viewport)
        XCTAssertEqual(next.scale, 2)
        assertClose(next.x, -100, 2)
    }

    func testNeverLeavesAnEdgeShowing() {
        // The anchor would owe −400 here, which is exactly the limit; anything
        // further out is held.
        let next = zoomAbout(.fitted, 2, anchor: Point(700, 0), viewport: viewport, content: viewport)
        XCTAssertEqual(next.x, -400)
    }

    func testRecentresOnTheWayBackToTheFit() {
        let back = zoomAbout(ViewState(scale: 4, x: 300, y: 120), 1, anchor: Point(0, 0), viewport: viewport, content: viewport)
        XCTAssertEqual(back, .fitted)
    }
}

final class RubberBandTests: XCTestCase {
    func testMovesResistsAndNeverRunsAway() {
        XCTAssertEqual(rubberBand(0, 800), 0)
        XCTAssertLessThan(abs(rubberBand(100, 800)), 100)
        XCTAssertGreaterThan(abs(rubberBand(100, 800)), 0)
        XCTAssertLessThan(abs(rubberBand(100000, 800)), 800 * 0.55 + 1)
        assertClose(rubberBand(-100, 800), -rubberBand(100, 800), 2)
    }
}

final class SwipeCommitTests: XCTestCase {
    func testPagesOnceTheDragCrossesAQuarterOfTheSlot() {
        XCTAssertEqual(swipeCommit(-300, 800, 0), 1)
        XCTAssertEqual(swipeCommit(300, 800, 0), -1)
        XCTAssertEqual(swipeCommit(-100, 800, 0), 0)
    }

    func testPagesOnAFlickThatNeverGotThere() {
        XCTAssertEqual(swipeCommit(-40, 800, -1.2), 1)
        XCTAssertEqual(swipeCommit(40, 800, 1.2), -1)
    }

    func testReadsAFlickBackTheOtherWayAsAHesitation() {
        XCTAssertEqual(swipeCommit(-40, 800, 1.2), 0)
    }

    func testDecidesNothingWithoutAMeasuredSlot() {
        XCTAssertEqual(swipeCommit(-300, 0, -2), 0)
    }
}

final class SweepCommitTests: XCTestCase {
    func testPagesAtAQuarterOfANarrowSlot() {
        XCTAssertEqual(sweepCommit(-100, 400), 1)
        XCTAssertEqual(sweepCommit(100, 400), -1)
        XCTAssertEqual(sweepCommit(-99, 400), 0)
    }

    func testCapsTheDistanceOnAWideSheet() {
        XCTAssertEqual(sweepCommit(-sweepCommitPx, 1600), 1)
        XCTAssertEqual(sweepCommit(sweepCommitPx - 1, 1600), 0)
    }

    func testDecidesNothingWithoutAMeasuredSlot() {
        XCTAssertEqual(sweepCommit(-500, 0), 0)
    }
}

final class SweepRestartsTests: XCTestCase {
    func testReadsDecayingMomentumAsTheSameSweep() {
        XCTAssertFalse(sweepRestarts(-30, -24))
        XCTAssertFalse(sweepRestarts(-3, -2))
    }

    func testReadsADeltaClimbingBackUpAsFingersLandingAgain() {
        XCTAssertTrue(sweepRestarts(-6, -20))
    }

    func testReadsAReversalAsANewSweep() {
        XCTAssertTrue(sweepRestarts(-12, 10))
    }

    func testIgnoresJitterTooSmallToBeAGesture() {
        XCTAssertFalse(sweepRestarts(-1, -5))
    }
}

final class LowerCeilingTests: XCTestCase {
    func testHoldsEveryWayOfReachingAScaleUnderIt() {
        XCTAssertEqual(clampViewZoom(5, 3), 3)
        XCTAssertEqual(stepViewZoom(2.5, 1, 3), 3)
        XCTAssertEqual(zoomByWheelDelta(2.9, -400, 3), 3)
        XCTAssertEqual(zoomByPinchRatio(2, 4, 3), 3)
        XCTAssertEqual(zoomAbout(.fitted, 9, anchor: Point(0, 0), viewport: viewport, content: viewport, 3).scale, 3)
        XCTAssertEqual(clampView(ViewState(scale: 6, x: 0, y: 0), viewport: viewport, content: viewport, 3).scale, 3)
    }

    func testNeverGoesUnderTheFitWhateverItIsAsked() {
        XCTAssertEqual(clampViewZoom(4, 0.5), minViewZoom)
    }
}

final class PixelCeilingTests: XCTestCase {
    func testStopsWhereOnePicturePixelMeetsOneDevicePixel() {
        // 3000 px of picture drawn 600 css px wide on a 2× screen: 1:1 at 2.5×.
        assertClose(pixelCeiling(Size(3000, 2000), Size(600, 400), 2), 2.5, 2)
    }

    func testKeeps2xAsAFloorAnd8xAsACeiling() {
        XCTAssertEqual(pixelCeiling(Size(800, 600), Size(800, 600), 2), 2)
        XCTAssertEqual(pixelCeiling(Size(12000, 8000), Size(300, 200), 1), maxViewZoom)
        XCTAssertEqual(pixelCeiling(nil, viewport, 2), 2)
        XCTAssertEqual(pixelCeiling(Size(3000, 2000), Size(600, 400), .nan), 5)
    }
}

final class OnePixelZoomTests: XCTestCase {
    func testIs1To1AndHasNoCeilingOfItsOwnInspectingGoesPastIt() {
        // The same picture `pixelCeiling` answers 2.5× for: the landmark agrees.
        assertClose(onePixelZoom(Size(3000, 2000), Size(600, 400), 2), 2.5, 2)
        // Where `pixelCeiling` would clamp to 8×, the landmark says the truth: 40×.
        assertClose(onePixelZoom(Size(12000, 8000), Size(300, 200), 1), 40, 2)
        XCTAssertEqual(pixelCeiling(Size(12000, 8000), Size(300, 200), 1), maxViewZoom)
    }

    func testNeverClaimsAPictureIs1To1BelowTheFitAndAnswersTheFitWhenUnknown() {
        // A small picture blown up to fill the box is already past its own
        // pixels; saying so as "0.4×" would put the landmark under a view that
        // cannot exist.
        XCTAssertEqual(onePixelZoom(Size(240, 160), Size(600, 400), 1), minViewZoom)
        XCTAssertEqual(onePixelZoom(nil, viewport, 2), minViewZoom)
        assertClose(onePixelZoom(Size(3000, 2000), Size(600, 400), .nan), 5, 2)
    }

    func testLeavesRoomToInspectTheDevelopCeilingIsAbove1To1OnANormalPicture() {
        let one = onePixelZoom(Size(6000, 4000), Size(1200, 800), 2)
        assertClose(one, 2.5, 2)
        XCTAssertGreaterThan(inspectMaxZoom, one)
        XCTAssertEqual(clampViewZoom(99, max(one, inspectMaxZoom)), inspectMaxZoom)
    }
}

final class PictureFractionAndRectTests: XCTestCase {
    private let content = Size(600, 400)

    func testReadsTheCentreTheEdgesAndAPointOffThePictureAtTheFit() {
        XCTAssertEqual(pictureFraction(.fitted, anchor: Point(0, 0), content: content), Point(0.5, 0.5))
        XCTAssertEqual(pictureFraction(.fitted, anchor: Point(-300, 200), content: content), Point(0, 1))
        // The letterbox beside a contained picture is outside it.
        XCTAssertGreaterThan(pictureFraction(.fitted, anchor: Point(390, 0), content: content).x, 1)
    }

    func testFollowsAZoomedPannedViewBackToTheSamePointOfThePicture() {
        let view = zoomAbout(.fitted, 3, anchor: Point(120, -40), viewport: viewport, content: content)
        // The point under the anchor did not move, so it reads what it read at the fit.
        let before = pictureFraction(.fitted, anchor: Point(120, -40), content: content)
        let after = pictureFraction(view, anchor: Point(120, -40), content: content)
        assertClose(after.x, before.x, 2)
        assertClose(after.y, before.y, 2)
    }

    func testPlacesThePictureInTheViewportAndAFractionBackOntoIt() {
        XCTAssertEqual(pictureRect(.fitted, viewport: viewport, content: content), Rect(100, 100, 600, 400))
        let view = ViewState(scale: 2, x: 50, y: 0)
        let rect = pictureRect(view, viewport: viewport, content: content)
        XCTAssertEqual(rect, Rect(-150, -100, 1200, 800))
        // The quarter-way point of the picture, read back from where the rect puts it.
        let px = rect.x + 0.25 * rect.width - viewport.width / 2
        assertClose(pictureFraction(view, anchor: Point(px, 0), content: content).x, 0.25, 2)
    }
}

final class VisibleWindowTests: XCTestCase {
    func testIsTheWholePictureAtTheFit() {
        XCTAssertEqual(visibleWindow(Rect(100, 0, 600, 600), viewport: viewport), PictureWindow(x0: 0, y0: 0, x1: 1, y1: 1))
    }

    func testIsWhatTheViewportCutsOutOfAZoomedPicture() {
        // 2× on a 600 px picture, panned 150 px left: the picture spans −350..850.
        let rect = pictureRect(ViewState(scale: 2, x: -150, y: 0), viewport: viewport, content: Size(600, 600))
        let win = visibleWindow(rect, viewport: viewport)
        assertClose(win.x0, 350 / 1200, 9)
        assertClose(win.x1, 1150 / 1200, 9)
        assertClose(win.y0, 300 / 1200, 9)
        assertClose(win.y1, 900 / 1200, 9)
    }
}
