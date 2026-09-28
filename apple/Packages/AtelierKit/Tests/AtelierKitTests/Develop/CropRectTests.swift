// Port of `src/shared/develop/crop-rect.test.ts`.

import XCTest
@testable import AtelierKit

private let SRC = PictureDims(width: 3000, height: 2000)

/// What the renderer will show for a stored crop, read back in the zone's frame:
/// the output frame's centre and half-size mapped through `framingTransform`
/// itself (out = C + R(θ)·pan + S·s, so s = (out − C − R(θ)·pan) / S).
private func shownZone(_ f: Framing, _ aspect: Double) -> CropZone {
    let dstW = 1200 * aspect
    let dstH = 1200.0
    let t = framingTransform(SRC.width, SRC.height, dstW, dstH, f)
    let cosA = cos(t.angle)
    let sinA = sin(t.angle)
    let rx = t.panX * cosA - t.panY * sinA
    let ry = t.panX * sinA + t.panY * cosA
    return CropZone(cx: -rx / t.scale, cy: -ry / t.scale, w: dstW / t.scale, h: dstH / t.scale)
}

private func expectZone(_ a: CropZone, _ b: CropZone, _ digits: Int = 6, file: StaticString = #filePath, line: UInt = #line) {
    assertClose(a.cx, b.cx, digits, "cx", file: file, line: line)
    assertClose(a.cy, b.cy, digits, "cy", file: file, line: line)
    assertClose(a.w, b.w, digits, "w", file: file, line: line)
    assertClose(a.h, b.h, digits, "h", file: file, line: line)
}

final class CropZoneStoredTests: XCTestCase {
    func testRoundTripsThroughFramingTransformAtEveryAngle() {
        let cases: [(String, Double, Bool, Bool)] = [
            ("0°", 0, false, false),
            ("2.6°", 2.6, false, false),
            ("45°", 45, false, false),
            ("90°", 90, false, false),
            ("-17° flipped", -17, true, false),
            ("2.6° flipped both", 2.6, true, true),
        ]
        for (label, deg, fx, fy) in cases {
            // A zone well inside the turned picture at every angle tested.
            let zone = CropZone(cx: 120, cy: -60, w: 700, h: 500)
            XCTAssertTrue(zoneValid(zone, deg, SRC), label)
            let f = cropFromZone(SRC, zone, deg, fx, fy)
            XCTAssertEqual(f.fit, .cover, label)
            assertClose(f.rotation, deg, 9, label)
            expectZone(shownZone(f, zone.w / zone.h), zone, 4)
            expectZone(zoneFromCrop(SRC, zone.w / zone.h, f), zone, 4)
        }
    }

    func testReadsTheDefaultFramingAsTheLargestZoneOfTheAspectCentred() {
        expectZone(zoneFromCrop(SRC, 1.5, .default), CropZone(cx: 0, cy: 0, w: 3000, h: 2000))
        let square = zoneFromCrop(SRC, 1, .default)
        expectZone(square, CropZone(cx: 0, cy: 0, w: 2000, h: 2000))
    }

    func testStoresTheLargestZoneAsAnUntouchedFraming() {
        let f = cropFromZone(SRC, maxZone(1.5, 0, SRC), 0, false, false)
        XCTAssertEqual(f, Framing.default)
    }

    func testClampsAStoredPanTheWayTheRendererDoes() {
        let zone = zoneFromCrop(SRC, 1, framing { $0.x = 5 })
        // A square at scale 1 can only slide 500 px along x.
        assertClose(abs(zone.cx), 500, 6)
        XCTAssertTrue(zoneContained(zone, 0, SRC))
    }

    func testWritesTheSmallestZoneAsTheDeepestZoomAndNoDeeper() {
        let tiny = CropZone(cx: 0, cy: 0, w: 3000 / maxFramingScale, h: 2000 / maxFramingScale)
        assertClose(cropFromZone(SRC, tiny, 0, false, false).scale, maxFramingScale, 9)
        XCTAssertFalse(zoneValid(CropZone(cx: 0, cy: 0, w: tiny.w * 0.9, h: tiny.h * 0.9), 0, SRC))
    }

    func testMirrorsLikeFlipFraming() {
        let zone = CropZone(cx: 200, cy: 100, w: 800, h: 600)
        let f = cropFromZone(SRC, zone, 7, false, false)
        let flipped = flipFraming(f, axis: "x")
        expectZone(zoneFromCrop(SRC, 800.0 / 600, flipped), flipZone(zone, "x"), 4)
        let flippedY = flipFraming(f, axis: "y")
        expectZone(zoneFromCrop(SRC, 800.0 / 600, flippedY), flipZone(zone, "y"), 4)
    }

    func testTurnsAQuarterWithThePicture() {
        let zone = CropZone(cx: 300, cy: -100, w: 800, h: 500)
        let turned = quarterTurnZone(zone, 1)
        XCTAssertEqual(turned, CropZone(cx: 100, cy: 300, w: 500, h: 800))
        XCTAssertEqual(quarterTurnZone(turned, -1), zone)
        // The same part of the picture: its stored pan is the same pan.
        let before = cropFromZone(SRC, zone, 0, false, false)
        let after = cropFromZone(SRC, turned, 90, false, false)
        assertClose(after.scale, before.scale, 9)
        assertClose(after.x, before.x, 9)
        assertClose(after.y, before.y, 9)
    }

    func testNamesARatioAsAPresetWhenItIsOneElseAsAFreeZone() {
        XCTAssertEqual(aspectIdFor(4.0 / 5), "4:5")
        XCTAssertEqual(aspectIdFor(1.5), "3:2")
        XCTAssertEqual(aspectIdFor(1.37209), "free:1.3721")
    }
}

final class CropClampTests: XCTestCase {
    func testStopsAZoneAtThePicturesEdgeInsteadOfJumping() {
        let from = CropZone(cx: 0, cy: 0, w: 1000, h: 1000)
        let to = CropZone(cx: 5000, cy: 0, w: 1000, h: 1000)
        let z = clampToward(from, to, 0, SRC)
        assertClose(z.cx + z.w / 2, 1500, 3)
        assertClose(z.w, 1000, 9)
    }

    func testSlidesAlongTheEdgeADragReaches() {
        let zone = CropZone(cx: 1000, cy: 0, w: 1000, h: 1000)
        let moved = moveZone(zone, 400, 300, 0, SRC)
        assertClose(moved.cx, 1000, 3) // already against the right edge
        assertClose(moved.cy, 300, 3) // still went down
    }

    func testKeepsAnInvalidStartingZoneForTheNextGestureToReplace() {
        let outside = CropZone(cx: 9000, cy: 0, w: 1000, h: 1000)
        var next = outside
        next.cx = 9100
        XCTAssertEqual(clampToward(outside, next, 0, SRC), outside)
    }
}

final class CropHandleTests: XCTestCase {
    let start = CropZone(cx: 0, cy: 0, w: 1000, h: 800)

    func testMovesONEEdgeAndLeavesTheOppositeOneWhereItWas() {
        let z = resizeZone(start, start, .e, 900, 123, nil, 0, SRC)
        assertClose(z.cx - z.w / 2, -500, 9) // left edge still
        assertClose(z.cx + z.w / 2, 900, 9)
        XCTAssertEqual(z.h, 800) // the vertical untouched by a horizontal drag
        XCTAssertEqual(z.cy, 0)
    }

    func testHoldsAnEdgeAtThePicturesBorder() {
        let z = resizeZone(start, start, .e, 5000, 0, nil, 0, SRC)
        assertClose(z.cx + z.w / 2, 1500, 3)
        assertClose(z.cx - z.w / 2, -500, 3)
    }

    func testAnchorsACornerOnTheOppositeCorner() {
        let z = resizeZone(start, start, .se, 700, 600, nil, 0, SRC)
        assertClose(z.cx - z.w / 2, -500, 9)
        assertClose(z.cy - z.h / 2, -400, 9)
        assertClose(z.w, 1200, 9)
        assertClose(z.h, 1000, 9)
    }

    func testKeepsALockedRatioFromTheOppositeCorner() {
        let z = resizeZone(start, start, .nw, -900, -100, 1.25, 0, SRC)
        assertClose(z.w / z.h, 1.25, 9)
        assertClose(z.cx + z.w / 2, 500, 9)
        assertClose(z.cy + z.h / 2, 400, 9)
        assertClose(z.w, 1400, 9) // the larger side the pointer asked for
    }

    func testKeepsALockedRatioFromAnEdgeAboutTheCentre() {
        let z = resizeZone(start, start, .e, 700, 0, 1.25, 0, SRC)
        assertClose(z.w, 1200, 9)
        assertClose(z.h, 960, 9)
        assertClose(z.cy, 0, 9)
        assertClose(z.cx - z.w / 2, -500, 9)
    }

    func testKeepsALockedRatioWhileClamped() {
        let z = resizeZone(start, start, .se, 5000, 5000, 1.25, 0, SRC)
        assertClose(z.w / z.h, 1.25, 6)
        XCTAssertTrue(zoneContained(z, 0, SRC))
        assertClose(z.cy + z.h / 2, 1000, 3)
    }

    func testNeverCrossesItsAnchor() {
        let z = resizeZone(start, start, .e, -2000, 0, nil, 0, SRC)
        XCTAssertGreaterThan(z.w, 0)
        assertClose(z.cx - z.w / 2, -500, 6)
    }
}

final class CropDrawTests: XCTestCase {
    func testSpansTheAnchorAndThePointerInEitherDirection() {
        let z = drawCandidate(Point(100, 100), -500, -300, nil, 0, SRC)
        XCTAssertEqual(z, CropZone(cx: -200, cy: -100, w: 600, h: 400))
    }

    func testKeepsALockedRatioTheLargerSideWinning() {
        let z = drawCandidate(Point(0, 0), 400, 600, 1, 0, SRC)
        assertClose(z.w, 600, 9)
        assertClose(z.h, 600, 9)
    }

    func testStartsAtTheSmallestZoneAFramingAllows() {
        let z = drawCandidate(Point(0, 0), 5, 5, nil, 0, SRC)
        assertClose(zoneBase(z.w, z.h, 0, SRC), 1 / maxFramingScale, 9)
    }

    func testMayOnlyBeginOnThePicture() {
        XCTAssertTrue(pointOnPicture(1400, 900, 0, SRC))
        XCTAssertFalse(pointOnPicture(1400, 900, 20, SRC))
    }
}

final class CropRotationTests: XCTestCase {
    func testShrinksTheIntentJustEnoughAndGivesItBackAt0() {
        let intent = CropZone(cx: 0, cy: 0, w: 3000, h: 2000)
        let tilted = fitIntent(intent, 3, SRC)
        XCTAssertLessThan(tilted.w, 3000)
        assertClose(tilted.w / tilted.h, 1.5, 9)
        XCTAssertTrue(zoneContained(tilted, 3, SRC))
        // Just enough: a hair bigger would not fit.
        XCTAssertFalse(zoneContained(CropZone(cx: tilted.cx, cy: tilted.cy, w: tilted.w * 1.001, h: tilted.h * 1.001), 3, SRC))
        let back = fitIntent(intent, 0, SRC)
        expectZone(back, intent, 3)
    }

    func testNeverGrowsTheIntentPastWhatWasDrawn() {
        let intent = CropZone(cx: 100, cy: 50, w: 600, h: 400)
        expectZone(fitIntent(intent, 5, SRC), intent, 3)
    }

    func testPullsACentreThatFellOffThePictureTowardTheMiddle() {
        let intent = CropZone(cx: 1400, cy: 900, w: 400, h: 400)
        let z = fitIntent(intent, 30, SRC)
        XCTAssertTrue(zoneValid(z, 30, SRC))
        XCTAssertLessThan(hypot(z.cx, z.cy), hypot(1400, 900))
    }

    func testFindsTheLargestZoneOfARatioAtAnyAngle() {
        expectZone(maxZone(1.5, 0, SRC), CropZone(cx: 0, cy: 0, w: 3000, h: 2000), 3)
        let z = maxZone(1, 45, SRC)
        XCTAssertTrue(zoneContained(z, 45, SRC))
        assertClose(z.w, 2000 / 2.0.squareRoot(), 2)
    }

    func testReadsALevelLineAgainstTheNearerOfLevelAndPlumb() {
        assertClose(levelDelta(0, 0, 100, 10), -5.7106, 3)
        assertClose(levelDelta(100, 10, 0, 0), -5.7106, 3)
        assertClose(levelDelta(0, 0, 10, 100), 5.7106, 3)
        XCTAssertEqual(levelDelta(0, 0, 100, 0), 0)
        XCTAssertEqual(levelDelta(5, 5, 5, 5), 0)
    }

    func testSplitsARotationIntoItsQuarterAndItsFineAngle() {
        let a = splitRotation(93)
        XCTAssertEqual(a.quarter, 90)
        XCTAssertEqual(a.fine, 3)
        let b = splitRotation(-2.5)
        XCTAssertEqual(b.quarter, 0)
        XCTAssertEqual(b.fine, -2.5)
        XCTAssertEqual(splitRotation(178).quarter, 180)
    }
}

final class CropToViewTests: XCTestCase {
    /// The source pixel under a point of the delivered canvas, from its centre — `drawFramed` run backwards.
    private func sourceAt(_ f: Framing, _ dstW: Double, _ dstH: Double, _ dx: Double, _ dy: Double) -> Point {
        let t = framingTransform(SRC.width, SRC.height, dstW, dstH, f)
        let cosA = cos(t.angle)
        let sinA = sin(t.angle)
        // d = R·(pan + S·M·q)  →  q = M·(R⁻¹·d − pan) / S
        let ux = dx * cosA + dy * sinA - t.panX
        let uy = -dx * sinA + dy * cosA - t.panY
        return Point((ux / t.scale) * t.mirrorX, (uy / t.scale) * t.mirrorY)
    }

    private func plain(_ ratio: Double) -> BorderLayout {
        BorderLayout(w: ratio, h: 1, x: 0, y: 0, pw: ratio, ph: 1)
    }

    func testKeepsThePartOfThePictureThatWasOnScreenWhereItWasUnderATurnedAndPannedCrop() throws {
        let before = Framing(scale: 1.6, x: 0.04, y: -0.03, rotation: 7, flipX: true, flipY: false, fit: .cover)
        let ratio = 4.0 / 5
        let shown = zoneFromCrop(SRC, ratio, before)
        let win = PictureWindow(x0: 0.5, y0: 0.2, x1: 0.9, y1: 0.6)
        let out = try XCTUnwrap(zoneFromView(shown, plain(ratio), win, before.rotation, SRC))
        let zone = out.zone
        XCTAssertFalse(out.clamped)
        assertClose(zone.w / zone.h, (0.4 * ratio) / 0.4, 6)
        let after = cropFromZone(SRC, zone, before.rotation, before.flipX, before.flipY)
        // The window's centre on the old canvas is the new canvas's centre…
        let oldW = 1000 * ratio
        let q0 = sourceAt(before, oldW, 1000, (0.7 - 0.5) * oldW, (0.4 - 0.5) * 1000)
        let newRatio = zone.w / zone.h
        let q1 = sourceAt(after, 1000 * newRatio, 1000, 0, 0)
        assertClose(q1.x, q0.x, 4)
        assertClose(q1.y, q0.y, 4)
        // …and its corner is the new corner: nothing turned, nothing mirrored.
        let c0 = sourceAt(before, oldW, 1000, (0.9 - 0.5) * oldW, (0.6 - 0.5) * 1000)
        let c1 = sourceAt(after, 1000 * newRatio, 1000, (1000 * newRatio) / 2, 500)
        assertClose(c1.x, c0.x, 4)
        assertClose(c1.y, c0.y, 4)
        assertClose(after.rotation, 7, 9)
        XCTAssertTrue(after.flipX)
        expectZone(shownZone(after, newRatio), zone, 4)
    }

    func testCropsTheUntouchedPictureToItsRightHalf() throws {
        let shown = zoneFromCrop(SRC, 1.5, .default)
        let out = try XCTUnwrap(zoneFromView(shown, plain(1.5), PictureWindow(x0: 0.5, y0: 0, x1: 1, y1: 1), 0, SRC))
        expectZone(out.zone, CropZone(cx: 750, cy: 0, w: 1500, h: 2000), 3)
    }

    func testAsksForNothingWhenTheWholeCropIsOnScreenOrOnlyItsBorder() {
        let shown = zoneFromCrop(SRC, 1.5, .default)
        XCTAssertNil(zoneFromView(shown, plain(1.5), PictureWindow(x0: 0, y0: 0, x1: 1, y1: 1), 0, SRC))
        // A border of 0.25 on each side: the view shows margin only.
        let bordered = BorderLayout(w: 2, h: 1.5, x: 0.25, y: 0.25, pw: 1.5, ph: 1)
        XCTAssertNil(zoneFromView(shown, bordered, PictureWindow(x0: 0, y0: 0, x1: 0.1, y1: 1), 0, SRC))
    }

    func testCutsTheBorderAwayAndKeepsThePictureUnderIt() throws {
        let shown = zoneFromCrop(SRC, 1.5, .default)
        let bordered = BorderLayout(w: 2, h: 1.5, x: 0.25, y: 0.25, pw: 1.5, ph: 1)
        // The left half of the canvas: margin, then the picture's left half.
        let out = try XCTUnwrap(zoneFromView(shown, bordered, PictureWindow(x0: 0, y0: 0, x1: 0.5, y1: 1), 0, SRC))
        expectZone(out.zone, CropZone(cx: -750, cy: 0, w: 1500, h: 2000), 3)
    }

    func testGrowsAViewCloserThanACropMayGoToTheSmallestZoneAndSaysSo() throws {
        let shown = zoneFromCrop(SRC, 1.5, .default)
        let out = try XCTUnwrap(zoneFromView(shown, plain(1.5), PictureWindow(x0: 0.5, y0: 0.5, x1: 0.51, y1: 0.51), 0, SRC))
        XCTAssertTrue(out.clamped)
        XCTAssertTrue(zoneValid(out.zone, 0, SRC))
        assertClose(zoneBase(out.zone.w, out.zone.h, 0, SRC), 1 / maxFramingScale, 6)
        // Grown about where the view was, not moved to the middle.
        assertClose(out.zone.cx, 0.505 * 3000 - 1500, 3)
        assertClose(out.zone.cy, 0.505 * 2000 - 1000, 3)
    }

    func testGrowsATinyViewByAnEdgeInPlaceSlidInOnlyAsFarAsThePictureNeeds() throws {
        let shown = zoneFromCrop(SRC, 1.5, .default)
        let out = try XCTUnwrap(zoneFromView(shown, plain(1.5), PictureWindow(x0: 0.99, y0: 0.3, x1: 1, y1: 0.31), 0, SRC))
        let zone = out.zone
        XCTAssertTrue(zoneValid(zone, 0, SRC))
        // Its right edge on the picture's, its centre height where the view was.
        assertClose(zone.cx + zone.w / 2, 1500, 3)
        assertClose(zone.cy, 0.305 * 2000 - 1000, 3)
    }

    func testHoldsASliverOfAViewInsideAFreeAspect() throws {
        let shown = zoneFromCrop(SRC, 1.5, .default)
        let out = try XCTUnwrap(zoneFromView(shown, plain(1.5), PictureWindow(x0: 0, y0: 0.45, x1: 1, y1: 0.5), 0, SRC))
        XCTAssertTrue(out.clamped)
        assertClose(out.zone.w / out.zone.h, 5, 6)
        XCTAssertTrue(zoneValid(out.zone, 0, SRC))
    }
}

// Not in the web spec: the three small helpers the stage reads.
final class CropStageHelperTests: XCTestCase {
    func testDashesTheTurnedPicturesCornersAndScalesAZoneToTheFile() {
        let flat = turnedCorners(0, SRC)
        XCTAssertEqual(flat, [Point(-1500, -1000), Point(1500, -1000), Point(1500, 1000), Point(-1500, 1000)])
        let quarter = turnedCorners(90, SRC)
        assertClose(quarter[0].x, 1000, 9)
        assertClose(quarter[0].y, -1500, 9)
        let zone = CropZone(cx: 0, cy: 0, w: 1000.4, h: 500.5)
        let px = zoneInSourcePixels(zone, PictureDims(width: 2000, height: 1000), PictureDims(width: 8000, height: 4000))
        XCTAssertEqual(px.w, 4002)
        XCTAssertEqual(px.h, 2002)
        let same = zoneInSourcePixels(zone, PictureDims(width: 2000, height: 1000), nil)
        XCTAssertEqual(same.w, 1000)
        XCTAssertEqual(same.h, 501)
    }
}
