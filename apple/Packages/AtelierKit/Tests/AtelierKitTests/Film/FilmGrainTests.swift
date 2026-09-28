// Port of `src/shared/film/film-grain.test.ts`.

import XCTest
@testable import AtelierKit

final class FilmGrainWeightTests: XCTestCase {
    func testVanishesAtCrushedBlackAndBlownWhitePeaksInTheLowerMidtones() {
        XCTAssertEqual(grainWeight(0), 0)
        XCTAssertEqual(grainWeight(1), 0)
        XCTAssertEqual(grainWeight(-1), 0)
        XCTAssertEqual(grainWeight(2), 0)
        var peakAt = 0.0
        var peak = 0.0
        for i in 0...200 {
            let w = grainWeight(Double(i) / 200)
            if w > peak {
                peak = w
                peakAt = Double(i) / 200
            }
        }
        XCTAssertGreaterThan(peakAt, 0.35)
        XCTAssertLessThan(peakAt, 0.5)
        XCTAssertLessThanOrEqual(peak, 1)
        // Monotone either side of the peak.
        for i in 1...200 {
            let prev = grainWeight(Double(i - 1) / 200)
            let cur = grainWeight(Double(i) / 200)
            if Double(i) / 200 <= peakAt {
                XCTAssertGreaterThanOrEqual(cur, prev)
            } else {
                XCTAssertLessThanOrEqual(cur, prev)
            }
        }
        // A broad plateau, not a spike: the midtones are broadly grainy.
        XCTAssertGreaterThan(grainWeight(0.25), 0.7)
        XCTAssertGreaterThan(grainWeight(0.65), 0.6)
    }
}

final class FilmApplyGrainTests: XCTestCase {
    private let grey: RGB = (0.4, 0.4, 0.4)

    func testIsTheIdentityAtAmount0AtFade0AndOnANoiseOfZero() {
        let zero: GrainSample = (0, 0, 0, 0)
        let loud: GrainSample = (0.5, -0.5, 0.5, -0.5)
        assertExact(applyGrain(grey, loud, 0, 0.5), grey)
        assertExact(applyGrain(grey, loud, 1, 0.5, 0), grey)
        assertExact(applyGrain(grey, zero, 1, 0.5), grey)
    }

    func testAtChroma0EveryChannelMovesByTheLumaFieldAt1EachByItsOwn() {
        let noise: GrainSample = (0.5, -0.5, 0.2, 0)
        let k = grainWeight(0.4) * grainGain
        let luma = applyGrain(grey, noise, 1, 0)
        assertClose(luma.0, 0.4 + k * 0.5, 9)
        assertClose(luma.1, luma.0, 9)
        assertClose(luma.2, luma.0, 9)
        let chroma = applyGrain(grey, noise, 1, 1)
        assertClose(chroma.0, 0.4 - k * 0.5, 9)
        assertClose(chroma.1, 0.4 + k * 0.2, 9)
        assertClose(chroma.2, 0.4, 9)
    }

    func testNeverLeavesZeroOneAndBlackAndWhiteAreUntouched() {
        let loud: GrainSample = (0.5, 0.5, 0.5, 0.5)
        assertExact(applyGrain((0, 0, 0), loud, 1, 0), (0, 0, 0))
        assertExact(applyGrain((1, 1, 1), loud, 1, 0), (1, 1, 1))
        let near = applyGrain((0.99, 0.99, 0.99), loud, 1, 0)
        for v in [near.0, near.1, near.2] { XCTAssertLessThanOrEqual(v, 1) }
    }

    func testReadsATexelOfTheTileAsLumaInAlphaChannelsInRGB() {
        let bytes: [UInt8] = [255, 0, 128, 255, 0, 0, 0, 0]
        let first = grainSampleFrom(bytes, 0)
        assertClose(first.luma, 0.5, 9)
        assertClose(first.r, 0.5, 9)
        assertClose(first.g, -0.5, 9)
        assertClose(first.b, 128 / 255 - 0.5, 9)
        XCTAssertTrue(grainSampleFrom(bytes, 1) == (-0.5, -0.5, -0.5, -0.5))
    }
}

final class FilmCombineOctavesTests: XCTestCase {
    func testKeepsTheVarianceASingleOctaveHasSoASecondOneIsNotALouderGrain() {
        // Two independent draws: the combined field's variance must be the base's.
        var base = 0.0
        var both = 0.0
        let n = 4000
        var seed: UInt32 = 7
        func rnd() -> Double {
            seed = seed &* 1664525 &+ 1013904223
            return Double(seed) / 4294967296 - 0.5
        }
        for _ in 0..<n {
            let a: GrainSample = (rnd(), rnd(), rnd(), rnd())
            let b: GrainSample = (rnd(), rnd(), rnd(), rnd())
            base += a.luma * a.luma
            let c = combineOctaves(a, b).luma
            both += c * c
        }
        assertClose(both / Double(n), base / Double(n), 2)
    }

    func testIsTheBaseAloneAtWeight0AndCarriesTheOctaveOtherwise() {
        let a: GrainSample = (0.1, 0.2, -0.3, 0.4)
        let b: GrainSample = (-0.5, 0.5, 0.1, 0)
        XCTAssertTrue(combineOctaves(a, b, 0) == (0.1, 0.2, -0.3, 0.4))
        let mixed = combineOctaves(a, b)
        let norm = 1 / (1 + octaveWeight * octaveWeight).squareRoot()
        assertClose(mixed.luma, (0.1 + octaveWeight * -0.5) * norm, 12)
    }
}

final class FilmHalationTapsTests: XCTestCase {
    func testCoversPlusMinus3SigmaIsOddAndTheWidestRadiusStillFitsTheShadersArray() {
        XCTAssertEqual(halationTaps(1) % 2, 1)
        XCTAssertEqual(halationTaps(2.6), 2 * Int((7.8).rounded(.up)) + 1)
        // The cap is MEASURED over the whole slider, not assumed: the buffer's
        // height comes from the radius alone, so the sigma does too.
        var widest = 0
        let range = textureRanges[.halationRadius]!
        var r = range.min
        while r <= range.max + 1e-9 {
            var t = defaultFilmTexture
            t.halation = 1
            t.halationRadius = r
            let buffer = halationBuffer(t, 1600, 1000)!
            widest = max(widest, halationTaps(buffer.sigma))
            XCTAssertLessThanOrEqual(buffer.sigma, 12.8 + 1e-9)
            r += range.step
        }
        XCTAssertEqual(widest, maxHalationTaps)
    }
}

final class FilmScreenHalationTests: XCTestCase {
    private let tint: RGB = (1, 0.45, 0.2)

    func testAHaloOfZeroOrAnAmountOfZeroIsTheIdentity() {
        assertExact(screenHalation((0.3, 0.5, 0.7), 0, tint, 1), (0.3, 0.5, 0.7))
        assertExact(screenHalation((0.3, 0.5, 0.7), 1, tint, 0), (0.3, 0.5, 0.7))
        assertExact(screenHalation((0.3, 0.5, 0.7), (0, 0, 0), tint, 1), (0.3, 0.5, 0.7))
    }

    func testTakesAHaloPerChannelWhatTheNodeHandsItAndAScalarIsTheThreeEqual() {
        let p: RGB = (0.2, 0.25, 0.3)
        assertExact(screenHalation(p, (0.4, 0.4, 0.4), tint, 1), screenHalation(p, 0.4, tint, 1))
        // A warm halo bleeds warmer than a neutral one of the same energy.
        let warm = screenHalation(p, (0.6, 0.4, 0.2), tint, 1)
        let flat = screenHalation(p, (0.4, 0.4, 0.4), tint, 1)
        XCTAssertGreaterThan(warm.0, flat.0)
        XCTAssertLessThan(warm.2, flat.2)
    }

    func testScreensNeverDarkensNeverPassesWhiteMonotoneInTheHalo() {
        let p: RGB = (0.3, 0.5, 0.7)
        var prev = screenHalation(p, 0, tint, 1)
        var h = 0.1
        while h <= 1.0001 {
            let cur = screenHalation(p, h, tint, 1)
            for (c, before) in [(cur.0, prev.0), (cur.1, prev.1), (cur.2, prev.2)] {
                XCTAssertGreaterThanOrEqual(c, before)
                XCTAssertLessThanOrEqual(c, 1)
            }
            prev = cur
            h += 0.1
        }
        // The tint decides the bleed's colour: red rises most, blue least.
        let full = screenHalation((0.2, 0.2, 0.2), 1, tint, 1)
        XCTAssertGreaterThan(full.0, full.1)
        XCTAssertGreaterThan(full.1, full.2)
    }

    func testExtractsOnlyWhatIsAboveTheThresholdKeepingTheColour() {
        assertExact(extractHighlight((0.5, 0.5, 0.5), 0.8), (0, 0, 0))
        assertExact(extractHighlight((1, 1, 1), 0.8), (1, 1, 1))
        let warm = extractHighlight((1, 0.9, 0.7), 0.8)
        XCTAssertGreaterThan(warm.0, warm.2)
        XCTAssertLessThanOrEqual(warm.0, 1)
    }
}

final class FilmGaussianKernelTests: XCTestCase {
    func testIsSymmetricSumsToOneAndPeaksAtTheCentre() {
        for (sigma, taps) in [(2.6, 13), (5.1, 13), (1, 7)] {
            let k = gaussianKernel(sigma, taps)
            XCTAssertEqual(k.count, taps)
            assertClose(k.reduce(0, +), 1, 12)
            for i in 0..<taps { assertClose(k[i], k[taps - 1 - i], 12) }
            XCTAssertEqual(k.max(), k[(taps - 1) / 2])
        }
        XCTAssertEqual(gaussianKernel(3, 12).count, 13)
    }

    func testAFlatFieldBlursToItselfAnImpulseSpreadsToTheKernelAndKeepsItsEnergy() {
        let w = 9
        let h = 7
        let k = gaussianKernel(1.2, 5)
        let flat = [Float](repeating: 0.6, count: w * h)
        for v in blurSeparable(flat, w, h, k) { assertClose(Double(v), 0.6, 5) }
        var impulse = [Float](repeating: 0, count: w * h)
        impulse[3 * w + 4] = 1
        let out = blurSeparable(impulse, w, h, k)
        assertClose(Double(out[3 * w + 4]), k[2] * k[2], 6)
        assertClose(Double(out[3 * w + 5]), k[2] * k[3], 6)
        assertClose(Double(out[4 * w + 4]), k[3] * k[2], 6)
        var sum = 0.0
        for v in out { sum += Double(v) }
        assertClose(sum, 1, 5)
    }
}
