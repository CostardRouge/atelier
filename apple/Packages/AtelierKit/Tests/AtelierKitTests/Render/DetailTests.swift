// Port of `src/shared/render/detail.test.ts`.

import XCTest
@testable import AtelierKit

/// A tiny deterministic PRNG, so the noise is the same every run — the web's
/// `(s * 1664525 + 1013904223) >>> 0`, which is 32-bit wrapping arithmetic.
private func prng(_ seed: UInt32) -> () -> Double {
    var s = seed
    return {
        s = s &* 1664525 &+ 1013904223
        return Double(s) / 4294967296
    }
}

private func picture(_ w: Int, _ h: Int, _ fill: (Int, Int) -> RGB) -> DetailImage {
    DetailImage(width: w, height: h, fill: fill)
}

private func variance(_ img: DetailImage, _ of: (RGB) -> Double, _ x0: Int = 0, _ x1: Int? = nil) -> Double {
    let end = x1 ?? img.width
    var vals: [Double] = []
    for y in 0..<img.height {
        for x in x0..<end { vals.append(of(pixelAt(img, x, y))) }
    }
    let mean = vals.reduce(0, +) / Double(vals.count)
    return vals.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(vals.count)
}

final class RenderDetailRecordTests: XCTestCase {
    func testIsDefaultOnlyAtEveryAmount0ComparesByValueReadsBackClamped() {
        XCTAssertTrue(isDefaultDetail(nil as DetailSettings?))
        XCTAssertTrue(isDefaultDetail(DetailSettings(sharpenRadius: 2)))
        XCTAssertFalse(isDefaultDetail(DetailSettings(sharpen: 1)))
        XCTAssertTrue(sameDetail(nil, DetailSettings.default))
        XCTAssertFalse(sameDetail(DetailSettings(colour: 10), DetailSettings(colour: 11)))
        let read = normaliseDetail(["luminance": 400, "colour": -5, "sharpen": "x", "sharpenRadius": 9])
        // A record written before Detail existed reads back as the plain unsharp mask (100).
        XCTAssertEqual(read, DetailSettings(
            luminance: 100, colour: 0, defringe: 0, sharpen: 0, sharpenRadius: 3,
            sharpenDetail: 100, sharpenMasking: 0, texture: 0, clarity: 0, dehaze: 0
        ))
        XCTAssertNil(detailOrNull(["sharpenRadius": 2]))
        XCTAssertEqual(detailOrNull(["sharpen": 30]), DetailSettings(sharpen: 30, sharpenDetail: 100))
        XCTAssertEqual(describeDetail(DetailSettings(luminance: 40, sharpen: 50, sharpenRadius: 1.2)), "denoise 40 · sharpen 50 @ 1.2 px")
        XCTAssertEqual(describeDetail(nil), "")
    }

    func testTurnsTheSlidersIntoBoundedKernelsScaledToTheStage() {
        let full = detailTerms(DetailSettings(luminance: 100, colour: 100, sharpen: 100, sharpenRadius: 3))
        XCTAssertEqual(full.chromaSigma, 6)
        XCTAssertEqual(full.chromaRadius, chromaMaxRadius)
        assertClose(full.rangeSigma, 0.12, 9)
        XCTAssertEqual(full.sharpenRadius, 6)
        let half = detailTerms(DetailSettings(colour: 100, sharpen: 100, sharpenRadius: 3), pixelScale: 0.5)
        XCTAssertEqual(half.chromaSigma, 3)
        XCTAssertEqual(half.sharpenSigma, 1.5)
        // Off is off: no sigma, no gain.
        let off = detailTerms(nil)
        XCTAssertEqual(off.chromaSigma, 0)
        XCTAssertEqual(off.rangeSigma, 0)
        XCTAssertEqual(off.defringe, 0)
        XCTAssertEqual(off.sharpenGain, 0)
    }
}

final class RenderDetailColourSplitTests: XCTestCase {
    func testRoundTripsAndAGreyHasNoChroma() {
        let triples: [RGB] = [(0.2, 0.5, 0.8), (1, 0, 0), (0.3, 0.3, 0.3)]
        for rgb in triples {
            let (y, cb, cr) = toYcc(rgb.0, rgb.1, rgb.2)
            let back = fromYcc(y, cb, cr)
            assertTriple(back, rgb, 9)
        }
        let (y, cb, cr) = toYcc(0.4, 0.4, 0.4)
        assertClose(cb, 0, 12)
        assertClose(cr, 0, 12)
        assertClose(y, 0.4, 12)
    }
}

final class RenderDetailColourNoiseTests: XCTestCase {
    func testFlattensAChromaSpeckleAndLeavesTheLumaExactlyAlone() {
        let rnd = prng(7)
        // Mid grey with a coloured speckle of constant luma: every pixel is a
        // random chroma at Y = 0.5.
        let noisy = picture(48, 16) { _, _ in
            let cb = (rnd() - 0.5) * 0.1
            let cr = (rnd() - 0.5) * 0.1
            return fromYcc(0.5, cb, cr)
        }
        let terms = detailTerms(DetailSettings(colour: 60))
        let h = applyDetail(noisy) { img, x, y in chromaBlurAt(img, x, y, terms, .x) }
        let out = applyDetail(h) { img, x, y in chromaBlurAt(img, x, y, terms, .y) }
        let chroma: (RGB) -> Double = { rgb in toYcc(rgb.0, rgb.1, rgb.2).1 }
        XCTAssertLessThan(variance(out, chroma), variance(noisy, chroma) * 0.15)
        for x in stride(from: 0, to: out.width, by: 5) {
            let (r, g, b) = pixelAt(out, x, 8)
            assertClose(lumaOf(r, g, b), 0.5, 6)
        }
    }
}

final class RenderDetailLuminanceNoiseTests: XCTestCase {
    func testSmoothsANoisyWallAndKeepsAStepEdgeWhereItIs() {
        let rnd = prng(11)
        let img = picture(40, 12) { x, _ in
            let base = x < 20 ? 0.3 : 0.7
            let v = base + (rnd() - 0.5) * 0.06
            return (v, v, v)
        }
        let terms = detailTerms(DetailSettings(luminance: 50))
        let out = applyDetail(img) { im, x, y in bilateralAt(im, x, y, terms) }
        let Y: (RGB) -> Double = { rgb in lumaOf(rgb.0, rgb.1, rgb.2) }
        // Inside the left wall, away from the edge: much quieter.
        let R = bilateralRadius
        XCTAssertLessThan(variance(out, Y, R, 20 - R), variance(img, Y, R, 20 - R) * 0.25)
        // The step stays a step: the pixel right of the edge is still bright.
        XCTAssertGreaterThan(Y(pixelAt(out, 20, 6)), 0.6)
        XCTAssertLessThan(Y(pixelAt(out, 19, 6)), 0.4)
    }
}

final class RenderDetailDefringeTests: XCTestCase {
    func testDesaturatesPurpleAtAnEdgeAndLeavesAPurpleWallAlone() {
        let purple = fromYcc(0.5, 0.06, 0.06)
        let img = picture(40, 8) { x, _ in
            if x < 20 { return (0.1, 0.1, 0.1) }
            if x < 23 { return purple }
            return (0.9, 0.9, 0.9)
        }
        let terms = detailTerms(DetailSettings(defringe: 100))
        let out = applyDetail(img) { im, x, y in defringeAt(im, x, y, terms) }
        let chroma: (RGB) -> Double = { rgb in
            let ycc = toYcc(rgb.0, rgb.1, rgb.2)
            return hypot(ycc.1, ycc.2)
        }
        // The fringe pixel beside the dark wall is a steep edge: pulled to neutral.
        XCTAssertLessThan(chroma(pixelAt(out, 20, 4)), chroma(pixelAt(img, 20, 4)) * 0.2)
        let wall = picture(40, 8) { _, _ in purple }
        let still = applyDetail(wall) { im, x, y in defringeAt(im, x, y, terms) }
        assertClose(chroma(pixelAt(still, 20, 4)), chroma(purple), 6)
        // And green is not purple: a green fringe is not touched.
        let green = fromYcc(0.5, -0.06, -0.06)
        let gimg = picture(40, 8) { x, _ in
            if x < 20 { return (0.1, 0.1, 0.1) }
            if x < 23 { return green }
            return (0.9, 0.9, 0.9)
        }
        let gout = applyDetail(gimg) { im, x, y in defringeAt(im, x, y, terms) }
        assertClose(chroma(pixelAt(gout, 20, 4)), chroma(green), 6)
    }
}

final class RenderDetailSharpenTests: XCTestCase {
    func testSteepensAnEdgeKeepsAFlatAreaAndEveryHueAndNeverGoesBelowBlack() {
        let img = picture(40, 8) { x, _ in x < 20 ? (0.2, 0.3, 0.4) : (0.6, 0.7, 0.8) }
        let terms = detailTerms(DetailSettings(sharpen: 60, sharpenRadius: 1))
        let out = applyDetail(img) { im, x, y in sharpenAt(im, x, y, terms) }
        let Y: (RGB) -> Double = { rgb in lumaOf(rgb.0, rgb.1, rgb.2) }
        XCTAssertGreaterThan(Y(pixelAt(out, 20, 4)), Y(pixelAt(img, 20, 4)))
        XCTAssertLessThan(Y(pixelAt(out, 19, 4)), Y(pixelAt(img, 19, 4)))
        // Far from the edge nothing moves.
        assertTriple(pixelAt(out, 5, 4), pixelAt(img, 5, 4), 6)
        // The hue is kept: the channel ratios at the edge are the source's.
        let (r, g, b) = pixelAt(out, 20, 4)
        assertClose(g / r, 0.7 / 0.6, 6)
        assertClose(b / r, 0.8 / 0.6, 6)
        let dark = picture(20, 4) { x, _ in x < 10 ? (0, 0, 0) : (1, 1, 1) }
        var strong = terms
        strong.sharpenGain = 3
        let dout = applyDetail(dark) { im, x, y in sharpenAt(im, x, y, strong) }
        for x in 0..<20 { XCTAssertGreaterThanOrEqual(pixelAt(dout, x, 2).0, 0) }
    }
}

final class RenderDetailSharpenDetailAndMaskingTests: XCTestCase {
    /// A hard step with a little grain on both sides — the web's LCG runs on
    /// doubles past 2^53, so it is ported on doubles too, rounding and all.
    private static let stepPicture: DetailImage = {
        let w = 24
        let h = 12
        var data = [Float](repeating: 0, count: w * h * 3)
        var seed = 7.0
        func rnd() -> Double {
            seed = (seed * 1103515245 + 12345).truncatingRemainder(dividingBy: 2147483648)
            return (seed / 2147483648 - 0.5) * 0.02
        }
        for y in 0..<h {
            for x in 0..<w {
                let v = (x < 12 ? 0.3 : 0.7) + rnd()
                let i = (y * w + x) * 3
                data[i] = Float(v)
                data[i + 1] = Float(v)
                data[i + 2] = Float(v)
            }
        }
        return DetailImage(width: w, height: h, data: data)
    }()

    private var step: DetailImage { Self.stepPicture }

    private func at(_ change: (inout DetailSettings) -> Void, _ x: Int, _ y: Int = 6) -> Double {
        var s = DetailSettings(sharpen: 100, sharpenRadius: 1.5)
        change(&s)
        return sharpenAt(step, x, y, detailTerms(s, pixelScale: 1)).0
    }

    private func source(_ x: Int, _ y: Int = 6) -> Double {
        Double(step.data[(y * 24 + x) * 3])
    }

    func testDampsTheHaloAtTheEdgeMoreThanTheGrainAtALowDetail() {
        let plainEdge = at({ $0.sharpenDetail = 100 }, 12) - source(12)
        let heldEdge = at({ $0.sharpenDetail = 0 }, 12) - source(12)
        XCTAssertLessThan(abs(heldEdge), abs(plainEdge) * 0.6)
        let plainGrain = at({ $0.sharpenDetail = 100 }, 4) - source(4)
        let heldGrain = at({ $0.sharpenDetail = 0 }, 4) - source(4)
        XCTAssertGreaterThan(abs(heldGrain), abs(plainGrain) * 0.6)
    }

    func testWithMaskingLeavesTheFlatGrainAloneAndStillSharpensTheEdge() {
        assertClose(at({ $0.sharpenMasking = 60 }, 4), source(4), 6)
        XCTAssertGreaterThan(abs(at({ $0.sharpenMasking = 60 }, 12) - source(12)), 0.02)
        XCTAssertGreaterThan(edgeSobel(step, 12, 6), 0.15)
        XCTAssertLessThan(edgeSobel(step, 4, 6), 0.02)
    }

    func testIsSaidAndComparedLikeTheRest() {
        XCTAssertEqual(describeDetail(DetailSettings(sharpen: 40, sharpenMasking: 30)), "sharpen 40 @ 1 px, masking 30")
        XCTAssertFalse(sameDetail(DetailSettings(sharpenMasking: 1), DetailSettings.default))
        XCTAssertTrue(isDefaultDetail(DetailSettings(sharpenDetail: 0, sharpenMasking: 50)))
    }
}
