// Port of `src/shared/media/framing.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// The four corners of the destination rect, in the picture's own axes.
private func dstCornersInPictureSpace(_ dstW: Double, _ dstH: Double, _ t: FramingTransform) -> [(Double, Double)] {
    let c = cos(-t.angle)
    let s = sin(-t.angle)
    let corners: [(Double, Double)] = [(-dstW / 2, -dstH / 2), (dstW / 2, -dstH / 2), (dstW / 2, dstH / 2), (-dstW / 2, dstH / 2)]
    return corners.map { (($0.0 * c - $0.1 * s) - t.panX, ($0.0 * s + $0.1 * c) - t.panY) }
}

/// Does the transformed picture cover the whole frame?
private func covers(_ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ f: Framing) -> Bool {
    let t = framingTransform(srcW, srcH, dstW, dstH, f)
    let halfW = srcW * t.scale / 2
    let halfH = srcH * t.scale / 2
    let eps = 1e-6 * max(halfW, halfH)
    return dstCornersInPictureSpace(dstW, dstH, t).allSatisfy { abs($0.0) <= halfW + eps && abs($0.1) <= halfH + eps }
}

/// Where a source pixel lands in the frame — the same four steps `drawFramed` takes.
private func toFrame(_ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ f: Framing, _ p: (Double, Double)) -> (Double, Double) {
    let t = framingTransform(srcW, srcH, dstW, dstH, f)
    let x = (p.0 - srcW / 2) * t.scale * t.mirrorX + t.panX
    let y = (p.1 - srcH / 2) * t.scale * t.mirrorY + t.panY
    let c = cos(t.angle)
    let s = sin(t.angle)
    return (dstW / 2 + x * c - y * s, dstH / 2 + x * s + y * c)
}

/// Does the whole transformed picture stay inside the frame?
private func showsWhole(_ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ f: Framing) -> Bool {
    let eps = 1e-6 * max(dstW, dstH)
    let corners: [(Double, Double)] = [(0, 0), (srcW, 0), (srcW, srcH), (0, srcH)]
    return corners.map { toFrame(srcW, srcH, dstW, dstH, f, $0) }
        .allSatisfy { $0.0 >= -eps && $0.0 <= dstW + eps && $0.1 >= -eps && $0.1 <= dstH + eps }
}

final class FramingTransformTests: XCTestCase {
    func testReproducesTheCentredCoverCropByDefault() {
        // A 3:2 photograph into a 9:16 frame: the sides go, nothing else moves.
        let t = framingTransform(3000, 2000, 1080, 1920, .default)
        XCTAssertEqual(t.angle, 0)
        XCTAssertEqual(t.panX, 0)
        XCTAssertEqual(t.panY, 0)
        assertClose(t.scale, 1920 / 2000, 10)
        XCTAssertGreaterThan(t.slackX, 0)
        assertClose(t.slackY, 0, 6)
    }

    func testCoversTheFrameAtEveryRotationScaleAndPan() {
        let sizes: [(Double, Double)] = [(3000, 2000), (2000, 3000), (1000, 1000), (4000, 1000)]
        for (sw, sh) in sizes {
            for rotation in [0.0, 7, 45, 90, 123, 180, -33, -90] {
                for scale in [1.0, 1.4, 3] {
                    let f = framing { $0.scale = scale; $0.rotation = rotation; $0.x = 5; $0.y = -5 }
                    XCTAssertTrue(covers(sw, sh, 1080, 1920, f), "\(sw)×\(sh) at \(rotation)° ×\(scale)")
                    XCTAssertTrue(covers(sw, sh, 1920, 1080, f), "\(sw)×\(sh) at \(rotation)° ×\(scale)")
                }
            }
        }
    }

    func testClampsAPanThatWouldOpenAGap() {
        let t = framingTransform(2000, 2000, 1000, 1000, framing { $0.x = 0.9; $0.y = 0.9 })
        XCTAssertEqual(t.panX, 0)
        XCTAssertEqual(t.panY, 0)
        assertClose(t.slackX, 0, 6)
    }

    func testRefusesAScaleBelowOneWhateverTheDocumentSays() {
        let wide = framingTransform(3000, 2000, 1080, 1920, framing { $0.scale = 0.2 })
        assertClose(wide.scale, framingTransform(3000, 2000, 1080, 1920).scale, 10)
        XCTAssertTrue(covers(3000, 2000, 1080, 1920, framing { $0.scale = 0.2 }))
    }

    func testIsResolutionIndependent() {
        let f = framing { $0.scale = 2; $0.x = 0.1; $0.y = -0.05; $0.rotation = 12 }
        let small = framingTransform(3000, 2000, 540, 960, f)
        let big = framingTransform(3000, 2000, 2160, 3840, f)
        assertClose(big.scale / small.scale, 4, 10)
        assertClose(big.panX / small.panX, 4, 10)
        assertClose(big.panY / small.panY, 4, 10)
    }

    func testSurvivesAZeroSizedSourceOrFrame() {
        _ = framingTransform(0, 0, 100, 100)
        XCTAssertEqual(framingTransform(100, 100, 0, 0).scale, 1)
    }
}

final class ContainFitTests: XCTestCase {
    private let contain = framing { $0.fit = .contain }

    func testShowsTheWholePictureTouchingTheFrameOnOneAxis() {
        let t = framingTransform(3000, 2000, 1080, 1920, contain)
        assertClose(t.scale, 1080 / 3000, 10)
        XCTAssertTrue(showsWhole(3000, 2000, 1080, 1920, contain))
        XCTAssertFalse(covers(3000, 2000, 1080, 1920, contain))
    }

    func testKeepsTheWholePictureInViewAtEveryRotationAndPan() {
        let sizes: [(Double, Double)] = [(3000, 2000), (2000, 3000), (4000, 1000)]
        for (sw, sh) in sizes {
            for rotation in [0.0, 7, 45, 90, 123, 180, -33] {
                let f = framing { $0.fit = .contain; $0.rotation = rotation; $0.x = 5; $0.y = -5 }
                XCTAssertTrue(showsWhole(sw, sh, 1080, 1920, f))
                XCTAssertTrue(showsWhole(sw, sh, 1920, 1080, f))
            }
        }
    }

    func testLetsThePictureSlideAlongItsBarsAndNoFurther() {
        let t = framingTransform(3000, 2000, 1080, 1920, framing { $0.fit = .contain; $0.y = 1 })
        assertClose(t.slackY, 600, 6)
        assertClose(t.panY, 600, 6)
        assertClose(t.slackX, 0, 6)
        XCTAssertTrue(canPan(3000, 2000, 1080, 1920, contain))
    }

    func testCropsAgainOnceZoomedPastCovering() {
        XCTAssertTrue(covers(3000, 2000, 1080, 1920, framing { $0.fit = .contain; $0.scale = 8 }))
    }

    func testIsLeftAloneByACoverFraming() {
        assertClose(framingTransform(3000, 2000, 1080, 1920, .default).scale, 1920 / 2000, 10)
    }
}

final class FlipFramingTests: XCTestCase {
    private let src: [(Double, Double)] = [(0, 0), (3000, 0), (1200, 1700), (3000, 2000)]

    func testMirrorsWhatTheFrameShowsAtAnyRotationZoomAndPan() {
        for rotation in [0.0, 12, 90, -135, 180] {
            for fit in [Fit.cover, .contain] {
                let f = framing { $0.fit = fit; $0.rotation = rotation; $0.scale = 1.7; $0.x = 0.08; $0.y = -0.05 }
                let across = flipFraming(f, axis: "x")
                let down = flipFraming(f, axis: "y")
                for p in src {
                    let (x, y) = toFrame(3000, 2000, 1080, 1920, f, p)
                    let (ax, ay) = toFrame(3000, 2000, 1080, 1920, across, p)
                    let (dx, dy) = toFrame(3000, 2000, 1080, 1920, down, p)
                    assertClose(ax, 1080 - x, 6)
                    assertClose(ay, y, 6)
                    assertClose(dx, x, 6)
                    assertClose(dy, 1920 - y, 6)
                }
            }
        }
    }

    func testComesBackToWhereItStartedWhenAppliedTwice() {
        let f = framing { $0.rotation = 33; $0.x = 0.1; $0.y = 0.02 }
        XCTAssertEqual(flipFraming(flipFraming(f, axis: "x"), axis: "x"), f)
        XCTAssertEqual(flipFraming(flipFraming(f, axis: "y"), axis: "y"), f)
    }

    func testNeverStoresANegativeZero() {
        let f = flipFraming(.default, axis: "x")
        XCTAssertEqual(f.x.sign, .plus)
        XCTAssertEqual(f.rotation.sign, .plus)
    }
}

final class PanByTests: XCTestCase {
    func testMovesThePictureWithThePointerWhenThereIsRoom() {
        let f = panBy(framing { $0.scale = 2 }, 2000, 2000, 1000, 1000, 100, 0)
        assertClose(f.x, 0.1, 10)
        XCTAssertEqual(f.y, 0)
    }

    func testTurnsAFrameAxisDragIntoThePicturesOwnAxes() {
        let f = panBy(framing { $0.scale = 3; $0.rotation = 90 }, 2000, 2000, 1000, 1000, 100, 0)
        assertClose(f.x, 0, 6)
        assertClose(abs(f.y), 0.1, 6)
    }

    func testNeverStoresAPanThatOpensAGap() {
        let f = panBy(.default, 2000, 2000, 1000, 1000, 9999, 9999)
        XCTAssertEqual(f.x, 0)
        XCTAssertEqual(f.y, 0)
        XCTAssertTrue(covers(2000, 2000, 1000, 1000, f))
    }

    func testUnderAContainFitMovesAlongTheFrameNotAlongARotatedPicture() {
        let f = panBy(framing { $0.fit = .contain; $0.rotation = 90 }, 4000, 1000, 1920, 1080, 100, 0)
        assertClose(f.x, 100 / 1920, 10)
        XCTAssertEqual(f.y, 0)
    }

    func testUnderAContainFitNeverDragsAnyPartOfThePictureOutOfTheFrame() {
        let f = panBy(framing { $0.fit = .contain; $0.rotation = 30 }, 3000, 2000, 1080, 1920, 9999, -9999)
        XCTAssertTrue(showsWhole(3000, 2000, 1080, 1920, f))
    }

    func testReclampPullsAPanBackInWhenTheZoomIsUndone() {
        let zoomed = panBy(framing { $0.scale = 3 }, 2000, 2000, 1000, 1000, 400, 0)
        XCTAssertGreaterThan(zoomed.x, 0)
        var unzoomed = zoomed
        unzoomed.scale = 1
        let out = reclampFraming(unzoomed, 2000, 2000, 1000, 1000)
        assertClose(out.x, 0, 6)
    }
}

final class FramingRecordTests: XCTestCase {
    func testReadsAnAbsentOrBrokenValueAsTheDefault() {
        XCTAssertEqual(normaliseFraming(nil), .default)
        XCTAssertEqual(normaliseFraming(.null), .default)
        XCTAssertEqual(normaliseFraming(["scale": .number(.nan), "x": "no", "rotation": .number(.infinity)]), .default)
    }

    func testClampsWhatItReads() {
        XCTAssertEqual(normaliseFraming(["scale": 0.1]).scale, 1)
        XCTAssertEqual(normaliseFraming(["scale": 99]).scale, 8)
        XCTAssertEqual(normaliseFraming(["rotation": 540]).rotation, 180)
    }

    func testReadsAMirrorAndAFitAndOnlyTheValuesItKnows() {
        let f = normaliseFraming(["flipX": true, "flipY": "yes", "fit": "contain"])
        XCTAssertTrue(f.flipX)
        XCTAssertFalse(f.flipY)
        XCTAssertEqual(f.fit, .contain)
        XCTAssertEqual(normaliseFraming(["fit": "stretch"]).fit, .cover)
    }

    func testSurvivesTheJSONRoundTrip() {
        let f = framing { $0.scale = 1.5; $0.rotation = -12; $0.flipX = true; $0.x = 0.2; $0.fit = .contain }
        XCTAssertEqual(normaliseFraming(JSONValue.parse(f.json.serialized())), f)
    }

    func testWrapDegreesLandsEveryAngleInTheHalfOpenTurn() {
        XCTAssertEqual(wrapDegrees(0), 0)
        XCTAssertEqual(wrapDegrees(360), 0)
        XCTAssertEqual(wrapDegrees(-360), 0)
        XCTAssertEqual(wrapDegrees(190), -170)
        XCTAssertEqual(wrapDegrees(-190), 170)
        XCTAssertEqual(wrapDegrees(180), 180)
        XCTAssertEqual(wrapDegrees(-180), 180)
    }

    func testKnowsAnUntouchedPicture() {
        XCTAssertTrue(isDefaultFraming(nil))
        XCTAssertTrue(isDefaultFraming(.default))
        XCTAssertFalse(isDefaultFraming(framing { $0.rotation = 1 }))
        XCTAssertFalse(isDefaultFraming(framing { $0.flipY = true }))
        XCTAssertFalse(isDefaultFraming(framing { $0.fit = .contain }))
    }

    func testComparesTwoFramingsByWhatTheySayNilIncluded() {
        XCTAssertTrue(sameFraming(nil, .default))
        XCTAssertTrue(sameFraming(nil, nil))
        XCTAssertTrue(sameFraming(framing { $0.x = 0.25 }, framing { $0.x = 0.25 }))
        XCTAssertFalse(sameFraming(framing { $0.x = 0.25 }, framing { $0.x = 0.3 }))
        XCTAssertFalse(sameFraming(nil, framing { $0.fit = .contain }))
    }

    func testSaysWhenThereIsNothingToDrag() {
        XCTAssertFalse(canPan(1000, 1000, 1000, 1000, .default))
        XCTAssertTrue(canPan(1000, 1000, 1000, 1000, framing { $0.scale = 1.5 }))
        XCTAssertTrue(canPan(3000, 2000, 1080, 1920, .default))
    }

    func testScaleFramingByHoldsAZoomBetweenCoveringAndTheCeiling() {
        XCTAssertEqual(scaleFramingBy(1, 2), 2)
        XCTAssertEqual(scaleFramingBy(2, 0.25), 1)
        XCTAssertEqual(scaleFramingBy(6, 4), 8)
        assertClose(scaleFramingBy(1, exp(400.0 / 400)), exp(1.0), 10)
        XCTAssertEqual(scaleFramingBy(2, 1.5), 3)
    }

    func testScaleFramingByRefusesAFactorThatIsNotOne() {
        XCTAssertEqual(scaleFramingBy(2, 0), 2)
        XCTAssertEqual(scaleFramingBy(2, .nan), 2)
        XCTAssertEqual(scaleFramingBy(.nan, 2), 2)
        XCTAssertEqual(scaleFramingBy(.nan, 1), 1)
        XCTAssertEqual(scaleFramingBy(20, -1), 8)
    }
}

final class FramePointTests: XCTestCase {
    private let cases: [Framing] = [
        .default,
        framing { $0.scale = 1.8; $0.x = 0.1; $0.y = -0.2 },
        framing { $0.rotation = 23 },
        framing { $0.flipX = true; $0.flipY = true },
        framing { $0.fit = .contain },
        framing { $0.scale = 2.2; $0.rotation = -37; $0.flipX = true; $0.x = 0.3 },
    ]

    func testFramesTheMiddleOfThePictureOntoTheMiddleOfTheFrame() {
        let (x, y) = framePoint(400, 300, 800, 600, 400, 500, .default)
        XCTAssertEqual(x, 200)
        XCTAssertEqual(y, 250)
        let fx = framePoint(0, 300, 800, 600, 400, 500, framing { $0.flipX = true }).0
        let ux = framePoint(0, 300, 800, 600, 400, 500, .default).0
        assertClose(fx, 400 - ux, 6)
        XCTAssertNotEqual(fx, ux, accuracy: 0.5e-3)
    }

    func testRoundTripsASourcePointFramedAndUnframed() {
        let sizes: [(Double, Double, Double, Double)] = [(800, 600, 400, 500), (1000, 1000, 300, 900), (640, 480, 640, 480)]
        for f in cases {
            for (sw, sh, dw, dh) in sizes {
                let points: [(Double, Double)] = [(0, 0), (sw / 2, sh / 2), (sw, sh), (sw * 0.3, sh * 0.8)]
                for (sx, sy) in points {
                    let (dx, dy) = framePoint(sx, sy, sw, sh, dw, dh, f)
                    let (bx, by) = unframePoint(dx, dy, sw, sh, dw, dh, f)
                    assertClose(bx, sx, 6)
                    assertClose(by, sy, 6)
                }
            }
        }
    }

    func testPutsTheMiddleOfAnUntouchedFrameAtTheMiddleOfThePicture() {
        let (x, y) = unframePoint(200, 250, 800, 600, 400, 500, .default)
        XCTAssertEqual(x, 400)
        XCTAssertEqual(y, 300)
    }

    func testAnswersOutsideThePictureForAPointTheCropCutAway() {
        let (x, y) = unframePoint(0, 0, 800, 600, 400, 500, framing { $0.fit = .contain })
        XCTAssertTrue(x < 0 || y < 0)
    }
}

final class ZoomFramingAboutTests: XCTestCase {
    private let sw = 4000.0, sh = 3000.0, dw = 1080.0, dh = 1920.0

    /// The source point under a frame point, the way the painter would find it.
    private func under(_ f: Framing, _ x: Double, _ y: Double) -> (Double, Double) {
        unframePoint(x, y, sw, sh, dw, dh, f)
    }

    func testKeepsTheSourcePointUnderTheAnchorStillNotchAfterNotch() {
        var f = zoomFramingAbout(.default, 2, anchorX: 540, anchorY: 960, sw, sh, dw, dh)
        let (x0, y0) = under(f, 200, 1500)
        for scale in [2.4, 2.9, 3.5, 4.2] {
            f = zoomFramingAbout(f, scale, anchorX: 200, anchorY: 1500, sw, sh, dw, dh)
            let (x, y) = under(f, 200, 1500)
            assertClose(x, x0, 4)
            assertClose(y, y0, 4)
            XCTAssertTrue(covers(sw, sh, dw, dh, f))
        }
    }

    func testIsExactTurnedAndMirroredUnderCoverAndUnderContain() {
        let bases = [
            framing { $0.scale = 2.5; $0.rotation = 37; $0.flipX = true },
            framing { $0.scale = 2.5; $0.rotation = -110; $0.flipY = true; $0.fit = .contain },
        ]
        for base in bases {
            let f0 = zoomFramingAbout(base, 2.5, anchorX: 540, anchorY: 960, sw, sh, dw, dh)
            let (x0, y0) = under(f0, 700, 400)
            let f1 = zoomFramingAbout(f0, 3.4, anchorX: 700, anchorY: 400, sw, sh, dw, dh)
            let (x1, y1) = under(f1, 700, 400)
            assertClose(x1, x0, 4)
            assertClose(y1, y0, 4)
        }
    }

    func testNeverOpensAGapWhereTheClampBindsThePanStopsAtTheEdge() {
        let zoomed = panBy(framing { $0.scale = 3 }, sw, sh, dw, dh, 9999, 9999)
        let out = zoomFramingAbout(zoomed, 1.2, anchorX: 0, anchorY: 0, sw, sh, dw, dh)
        assertClose(out.scale, 1.2, 2)
        XCTAssertTrue(covers(sw, sh, dw, dh, out))
        let back = zoomFramingAbout(zoomed, 0.4, anchorX: 900, anchorY: 100, sw, sh, dw, dh)
        XCTAssertEqual(back.scale, 1)
        XCTAssertEqual(back.y, 0)
        XCTAssertTrue(covers(sw, sh, dw, dh, back))
        // A picture that exactly covers has no slack at all: back to 1 is centred.
        let square = panBy(framing { $0.scale = 3 }, 2000, 2000, 1000, 1000, 9999, -9999)
        var centred = square
        centred.scale = 1
        centred.x = 0
        centred.y = 0
        XCTAssertEqual(zoomFramingAbout(square, 0.4, anchorX: 900, anchorY: 100, 2000, 2000, 1000, 1000), centred)
    }

    func testHoldsTheCeilingAndLeavesRotationMirrorAndFitAlone() {
        let f = zoomFramingAbout(framing { $0.rotation = 12; $0.flipX = true; $0.fit = .contain }, 50, anchorX: 10, anchorY: 10, sw, sh, dw, dh)
        XCTAssertEqual(f.scale, 8)
        XCTAssertEqual(f.rotation, 12)
        XCTAssertTrue(f.flipX)
        XCTAssertEqual(f.fit, .contain)
    }
}
