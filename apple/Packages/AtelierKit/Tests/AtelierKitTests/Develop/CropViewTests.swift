// Port of `src/tools/develop/crop-view.test.ts`, case for case, plus the two
// verbs the web writes inline in `PictureWorkbench.tsx` (the pill's step and
// `Z` on the Crop tab), pinned here since the native app calls them.

import XCTest
@testable import AtelierKit

final class CropViewTests: XCTestCase {
    private let box = Size(1000, 700)
    private let src = Size(4000, 3000)

    /// The source fraction under a stage point, through the painter's own transform.
    private func under(_ view: CropView, _ p: Point, _ rotation: Double = 0) -> Point {
        let t = cropStageTransform(box, src, rotation, view)
        let q = quarterTurned(src, rotation)
        return Point((p.x - t.ox) / t.k / q.width + 0.5, (p.y - t.oy) / t.k / q.height + 0.5)
    }

    // MARK: - the fit

    func testKeepsTheHandlesRoomOnTheLimitingAxisAndTurnsWithAQuarterTurn() {
        assertClose(cropFitScale(box, src, 0), (700 - 2 * cropPad) / 3000)
        XCTAssertEqual(quarterTurned(src, 90), Size(3000, 4000))
        assertClose(cropFitScale(box, src, 90), (700 - 2 * cropPad) / 4000)
        // A fine angle is not a quarter turn.
        XCTAssertEqual(quarterTurned(src, 12), Size(4000, 3000))
    }

    // MARK: - clampCropView

    func testHoldsTheZoomBetweenTheFitAndTheCeilingAndPinsTheFitAtTheCentre() {
        XCTAssertEqual(clampCropView(CropView(zoom: 0.3, x: 40, y: 10), box, src, 0), .fit)
        XCTAssertEqual(clampCropView(CropView(zoom: 99, x: 0, y: 0), box, src, 0).zoom, cropViewMax)
    }

    func testHoldsThePanToHalfOfWhatTheScaledPictureHasOverTheStage() {
        let content = cropContent(box, src, 0)
        let zoom = 3.0
        let limitX = (content.width * zoom - box.width) / 2
        let held = clampCropView(CropView(zoom: zoom, x: 5000, y: -5000), box, src, 0)
        assertClose(held.x, limitX)
        assertClose(held.y, -(content.height * zoom - box.height) / 2)
    }

    func testGivesNoPanAtAllWhileThePictureIsSmallerThanTheStage() {
        // Fitted, the picture is cropPad short of the stage on the limiting axis: nothing to pan.
        XCTAssertEqual(clampCropView(CropView(zoom: 1.05, x: 30, y: 30), box, src, 0), CropView(zoom: 1.05, x: 0, y: 0))
    }

    func testOnlyBoundsTheZoomBeforeTheStageIsMeasured() {
        XCTAssertEqual(clampCropView(CropView(zoom: 20, x: 7, y: 7), nil, src, 0), CropView(zoom: cropViewMax, x: 7, y: 7))
    }

    // MARK: - zoomCropViewAbout

    func testKeepsTheSourcePointUnderTheAnchorStillNotchAfterNotch() {
        var view = CropView.fit
        // Deep enough in that both axes have slack to hold the point.
        view = zoomCropViewAbout(view, 2.5, Point(500, 350), box, src, 0)
        let anchor = Point(300, 500)
        let before = under(view, anchor)
        for zoom in [3, 3.6, 4.4, 5.5] {
            view = zoomCropViewAbout(view, zoom, anchor, box, src, 0)
            let after = under(view, anchor)
            assertClose(after.x, before.x, 6)
            assertClose(after.y, before.y, 6)
        }
    }

    func testIsExactUnderAQuarterTurnToo() {
        var view = zoomCropViewAbout(.fit, 3, Point(500, 350), box, src, 90)
        let anchor = Point(620, 200)
        let before = under(view, anchor, 90)
        view = zoomCropViewAbout(view, 4.2, anchor, box, src, 90)
        let after = under(view, anchor, 90)
        assertClose(after.x, before.x, 6)
        assertClose(after.y, before.y, 6)
    }

    func testComesBackToTheExactFitOffsetsAndAll() {
        let zoomed = zoomCropViewAbout(.fit, 4, Point(900, 100), box, src, 0)
        XCTAssertEqual(zoomed.zoom, 4)
        XCTAssertEqual(zoomCropViewAbout(zoomed, 0.5, Point(900, 100), box, src, 0), .fit)
    }

    func testNeverGoesPastTheCeilingAndWhatItStoresIsWhatItDraws() {
        let view = zoomCropViewAbout(CropView(zoom: 7, x: 0, y: 0), 40, Point(0, 0), box, src, 0)
        XCTAssertEqual(view.zoom, cropViewMax)
        XCTAssertEqual(clampCropView(view, box, src, 0), view)
    }

    // MARK: - the pill's step and `Z` (PictureWorkbench.tsx)

    func testAStepScalesTheOffsetsWithTheZoomAndLandsOnTheFit() {
        let v = CropView(zoom: 2, x: 40, y: -20)
        let closer = stepCropView(v, stageZoomStep)
        assertClose(closer.zoom, 2.5)
        assertClose(closer.x, 50)
        assertClose(closer.y, -25)
        XCTAssertEqual(stepCropView(CropView(zoom: 1.2, x: 9, y: 9), 1 / stageZoomStep), .fit)
        XCTAssertEqual(stepCropView(CropView(zoom: 7.9, x: 0, y: 0), 2).zoom, cropViewMax)
    }

    func testZTogglesBetweenTheFitAndTwoStepsCloser() {
        let closer = toggleCropView(.fit)
        assertClose(closer.zoom, 1.5625)
        XCTAssertEqual(toggleCropView(CropView(zoom: 3, x: 5, y: 5)), .fit)
    }
}
