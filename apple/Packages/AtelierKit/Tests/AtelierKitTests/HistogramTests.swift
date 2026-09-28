// Port of `src/shared/develop/histogram.test.ts` and `auto-develop.test.ts`.

import XCTest
@testable import AtelierKit

/// RGBA bytes of `n` pixels of one colour.
private func flat(_ n: Int, _ r: UInt8, _ g: UInt8, _ b: UInt8) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(n * 4)
    for _ in 0..<n { out += [r, g, b, 255] }
    return out
}

/// RGBA bytes for a list of pixels.
private func bytes(_ pixels: [(UInt8, UInt8, UInt8)]) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(pixels.count * 4)
    for p in pixels { out += [p.0, p.1, p.2, 255] }
    return out
}

/// `n` pixels of one colour, as a list.
private func pixels(_ rgb: (UInt8, UInt8, UInt8), _ n: Int) -> [(UInt8, UInt8, UInt8)] {
    Array(repeating: rgb, count: n)
}

/// A flat field of one colour, `n` pixels of it.
private func field(_ rgb: (UInt8, UInt8, UInt8), _ n: Int) -> [UInt8] {
    bytes(pixels(rgb, n))
}

/// A ramp of greys spanning [lo, hi] in encoded codes.
private func ramp(_ lo: Int, _ hi: Int, _ n: Int = 1000) -> [UInt8] {
    bytes((0..<n).map { i in
        let v = UInt8((Double(lo) + Double(hi - lo) * Double(i) / Double(n - 1)).rounded())
        return (v, v, v)
    })
}

final class LuminanceHistogramTests: XCTestCase {
    func testPutsAGreyInTheBinOfItsValueAndCountsEveryPixelOnce() {
        let h = luminanceHistogram(flat(10, 128, 128, 128), binCount: 64)
        XCTAssertEqual(h.total, 10)
        XCTAssertEqual(h.bins[32], 10)
        XCTAssertEqual(h.bins.reduce(0, +), 10)
    }

    func testWeightsGreenFarOverBlueAsTheEyeDoes() {
        let green = luminanceHistogram(flat(1, 0, 255, 0), binCount: 16)
        let blue = luminanceHistogram(flat(1, 0, 0, 255), binCount: 16)
        XCTAssertGreaterThan(green.bins.firstIndex(of: 1) ?? -1, blue.bins.firstIndex(of: 1) ?? -1)
        XCTAssertEqual(blue.bins[1], 1)
    }

    func testKeepsWhiteInTheLastBinAndBlackInTheFirst() {
        let h = luminanceHistogram(flat(3, 255, 255, 255) + flat(2, 0, 0, 0), binCount: 8)
        XCTAssertEqual(h.bins[7], 3)
        XCTAssertEqual(h.bins[0], 2)
    }

    func testSaysAPixelIsClippedWhenAnyChannelIsWhiteCrushedOnlyWhenAllAreBlack() {
        let h = luminanceHistogram(flat(1, 255, 40, 40) + flat(1, 0, 0, 0) + flat(1, 0, 0, 30) + flat(1, 90, 90, 90), binCount: 8)
        assertClose(h.clippedHighlights, 0.25, 2)
        assertClose(h.crushedShadows, 0.25, 2)
    }

    func testReadsNothingIntoAnEmptySample() {
        let zeros = [0, 0, 0, 0]
        XCTAssertEqual(luminanceHistogram([], binCount: 4),
                       Histogram(bins: zeros, red: zeros, green: zeros, blue: zeros, total: 0, clippedHighlights: 0, crushedShadows: 0))
    }

    func testBinsEachChannelOnItsOwnSoARedGoneToWhiteShowsUnderAMidGreyLuminance() {
        let h = luminanceHistogram(flat(4, 255, 90, 60), binCount: 8)
        XCTAssertEqual(h.red[7], 4)
        XCTAssertEqual(h.green[2], 4)
        XCTAssertEqual(h.blue[1], 4)
        XCTAssertEqual(h.bins[3], 4)
        XCTAssertEqual(h.clippedHighlights, 1)
    }

    func testDrawsTheThreeChannelsOnOneScaleSoALowerChannelReadsLower() {
        let h = luminanceHistogram(flat(6, 100, 100, 200) + flat(2, 100, 140, 200), binCount: 8)
        let s = channelShapes(h)
        XCTAssertEqual(s.red[3], 1)
        XCTAssertEqual(s.blue[6], 1)
        assertClose(s.green[3], 6 / 8, 2)
        assertClose(s.green[4], 2 / 8, 2)
        XCTAssertEqual(channelShapes(luminanceHistogram([], binCount: 4)).red, [0, 0, 0, 0])
    }

    func testClipOfAsksWhiteFirstAndBlackOnlyWhenEveryChannelIs() {
        XCTAssertEqual(clipOf(255, 0, 0), .white)
        XCTAssertEqual(clipOf(254, 254, 254), .white)
        XCTAssertEqual(clipOf(0, 0, 1), .black)
        XCTAssertNil(clipOf(0, 0, 30))
        XCTAssertNil(clipOf(90, 90, 90))
    }

    func testShapeScalesOnTheTallestInnerBin() {
        let h = Histogram(bins: [0, 4, 8, 2, 400], total: 414, clippedHighlights: 0.9, crushedShadows: 0)
        XCTAssertEqual(histogramShape(h), [0, 0.5, 1, 0.25, 1])
    }

    func testShapeDrawsTheEndBinsWhenTheyAreAllThereIsAndNothingForNothing() {
        XCTAssertEqual(histogramShape(Histogram(bins: [5, 0, 0, 10], total: 15, clippedHighlights: 0, crushedShadows: 0)), [0.5, 0, 0, 1])
        XCTAssertEqual(histogramShape(Histogram(bins: [0, 0, 0], total: 0, clippedHighlights: 0, crushedShadows: 0)), [0, 0, 0])
    }

    func testClipLabelSaysAShareInWordsASliverAndNothingForNone() {
        XCTAssertNil(clipLabel(0))
        XCTAssertEqual(clipLabel(0.0004), "<0.1 %")
        XCTAssertEqual(clipLabel(0.021), "2.1 %")
        XCTAssertEqual(clipLabel(0.42), "42 %")
    }
}

final class AutoDevelopTests: XCTestCase {
    private let bins = [10, 0, 0, 10] // half the pixels at the bottom bin, half at the top

    func testPercentileLandsInsideTheBinNotOnItsEdge() {
        assertClose(percentile(bins, 20, 0.25), 0.125, 6)
        assertClose(percentile(bins, 20, 0.5), 0.25, 6)
    }

    func testPercentileAnswersTheEndsForTheEndsAndForNothingMeasured() {
        XCTAssertEqual(percentile(bins, 20, 0), 0)
        XCTAssertEqual(percentile(bins, 20, 1), 1)
        XCTAssertEqual(percentile([], 0, 0.4), 0.4)
        XCTAssertEqual(percentile(bins, 0, 0.4), 0.4)
    }

    func testMeasureSourceBinsTheLuminanceAndAveragesTheChannelsInLinearLight() {
        let stats = measureSource(field((128, 128, 128), 100))
        XCTAssertEqual(stats.total, 100)
        XCTAssertEqual(stats.counted, 100)
        let expected = toLinear(128 / 255, .srgb)
        assertClose(stats.linearMean.0, expected, 9)
        assertClose(stats.linearMean.1, expected, 9)
        assertClose(stats.linearMean.2, expected, 9)
    }

    func testMeasureSourceLeavesClippedAndCrushedPixelsOutOfTheAverage() {
        let stats = measureSource(bytes([(200, 100, 50), (255, 255, 255), (255, 255, 255), (0, 0, 0)]))
        XCTAssertEqual(stats.total, 4)
        XCTAssertEqual(stats.counted, 1)
        assertClose(stats.linearMean.0, toLinear(200 / 255, .srgb), 9)
        XCTAssertEqual(stats.bins[stats.bins.count - 1], 2)
    }

    func testMeasureSourceAnswersZerosWhenEveryPixelIsClipped() {
        let stats = measureSource(field((255, 255, 255), 20))
        XCTAssertEqual(stats.counted, 0)
        XCTAssertEqual(autoColour(stats), AutoColour(temperature: 0, tint: 0, clamped: false))
    }

    func testAutoToneSetsTheBlackAndWhitePointsToThePicturesOwnRange() {
        let levels = autoTone(measureSource(ramp(60, 190)))
        XCTAssertNotNil(levels?.rgb)
        let rgb = levels!.rgb!
        XCTAssertGreaterThan(rgb.inBlack * 255, 55)
        XCTAssertLessThan(rgb.inBlack * 255, 70)
        XCTAssertGreaterThan(rgb.inWhite * 255, 180)
        XCTAssertLessThan(rgb.inWhite * 255, 196)
        XCTAssertNil(levels?.red)
    }

    func testAutoToneActuallyDeliversTheStretchItWrote() {
        let levels = autoTone(measureSource(ramp(60, 190)))!
        let f = makeLevel(levels.rgb!)
        XCTAssertLessThan(f(60 / 255), 0.02)
        XCTAssertGreaterThan(f(190 / 255), 0.98)
    }

    func testAutoTonePullsTheMedianPartOfTheWayToTheMiddleNeverAllOfIt() {
        let dark = measureSource(bytes(pixels((30, 30, 30), 900) + pixels((200, 200, 200), 100)))
        let levels = autoTone(dark)!
        let f = makeLevel(levels.rgb!)
        let out = f(percentile(dark.bins, dark.total, 0.5))
        XCTAssertGreaterThan(out, 0.05)
        XCTAssertLessThan(out, 0.5)
    }

    func testAutoToneRefusesAPictureWithNoRangeToStretch() {
        XCTAssertNil(autoTone(measureSource(field((128, 128, 128), 500))))
        XCTAssertEqual(describeAutoTone(nil), "nothing to stretch")
    }

    func testAutoToneGivesTheSameAnswerTwice() {
        let stats = measureSource(ramp(60, 190))
        XCTAssertEqual(autoTone(stats), autoTone(stats))
    }

    func testAutoToneKeepsTheGammaInsideWhatALevelMayHold() {
        let skewed = measureSource(bytes(pixels((2, 2, 2), 9990) + pixels((250, 250, 250), 10)))
        if let rgb = autoTone(skewed)?.rgb {
            XCTAssertGreaterThanOrEqual(rgb.gamma, 0.1)
            XCTAssertLessThanOrEqual(rgb.gamma, 10)
            XCTAssertTrue(rgb.gamma.isFinite)
        }
    }

    func testAutoToneNamesWhatItDidInTheCodesAPhotographerReads() {
        let line = describeAutoTone(autoTone(measureSource(ramp(60, 190))))
        XCTAssertTrue(line.hasPrefix("black "), line)
        XCTAssertTrue(line.contains(" · white "), line)
    }

    /// The mean of a developed flat field, in linear light.
    private func balanced(_ rgb: (UInt8, UInt8, UInt8)) -> (out: RGB, temperature: Double, tint: Double) {
        let colour = autoColour(measureSource(field(rgb, 64)))
        let out = developLinear(
            (toLinear(Double(rgb.0) / 255, .srgb), toLinear(Double(rgb.1) / 255, .srgb), toLinear(Double(rgb.2) / 255, .srgb)),
            dev { $0.temperature = colour.temperature; $0.tint = colour.tint }
        )
        return (out, colour.temperature, colour.tint)
    }

    func testAutoColourNeutralisesAWarmCastAndTheNumbersReallyLand() {
        let (out, temperature, _) = balanced((170, 160, 145))
        XCTAssertLessThan(temperature, 0)
        XCTAssertLessThan(abs(temperature), 100)
        assertClose(out.0, out.1, 2)
        assertClose(out.1, out.2, 2)
    }

    func testAutoColourNeutralisesACoolCastTheOtherWay() {
        let (out, temperature, _) = balanced((145, 160, 170))
        XCTAssertGreaterThan(temperature, 0)
        XCTAssertLessThan(abs(temperature), 100)
        assertClose(out.0, out.1, 2)
        assertClose(out.1, out.2, 2)
    }

    func testAutoColourClampsACastPastTheReachAndSaysSo() {
        let (out, temperature, _) = balanced((190, 160, 120))
        XCTAssertEqual(temperature, -100)
        XCTAssertGreaterThan(out.0, out.2)
        XCTAssertTrue(autoColour(measureSource(field((190, 160, 120), 64))).clamped)
        XCTAssertFalse(autoColour(measureSource(field((170, 160, 145), 64))).clamped)
    }

    func testAutoColourLeavesANeutralPictureAlone() {
        XCTAssertEqual(autoColour(measureSource(field((140, 140, 140), 64))), AutoColour(temperature: 0, tint: 0, clamped: false))
    }

    func testAutoColourAsksForWhatItCanHaveOnACastPastTheSlidersReach() {
        let (_, temperature, tint) = balanced((40, 120, 240))
        XCTAssertLessThanOrEqual(temperature, 100)
        XCTAssertGreaterThanOrEqual(temperature, -100)
        XCTAssertLessThanOrEqual(tint, 100)
        XCTAssertGreaterThanOrEqual(tint, -100)
        XCTAssertTrue(tint.isFinite)
    }

    func testAutoColourGivesTheSameAnswerTwice() {
        let stats = measureSource(field((190, 160, 120), 64))
        XCTAssertEqual(autoColour(stats), autoColour(stats))
    }

    func testTheTwoVerbsStayApart() {
        let warmFlat = measureSource(ramp(60, 190))
        let levels = autoTone(warmFlat)
        XCTAssertNil(levels?.red)
        XCTAssertNil(levels?.green)
        XCTAssertNil(levels?.blue)
        let once = autoTone(warmFlat)!
        XCTAssertEqual(autoTone(warmFlat), once)
        let f = makeLevel(once.rgb!)
        assertClose(fromLinear(toLinear(f(0.5), .srgb), .srgb), f(0.5), 9)
    }

    func testWhiteBalanceForNeutralisesTheColourItIsGiven() {
        let picked: RGB = (toLinear(150 / 255, .srgb), toLinear(142 / 255, .srgb), toLinear(130 / 255, .srgb))
        let wb = whiteBalanceFor(picked)
        let out = developLinear(picked, dev { $0.temperature = wb.temperature; $0.tint = wb.tint })
        assertClose(out.0, out.1, 2)
        assertClose(out.1, out.2, 2)
    }

    func testWhiteBalanceForIsWhatAutoColourRunsOnThePicturesMean() {
        let stats = measureSource(field((170, 160, 145), 64))
        XCTAssertEqual(autoColour(stats), whiteBalanceFor(stats.linearMean))
    }

    func testWhiteBalanceForAnswersNothingForABlackOrUnreadablePixel() {
        let none = AutoColour(temperature: 0, tint: 0, clamped: false)
        XCTAssertEqual(whiteBalanceFor((0, 0, 0)), none)
        XCTAssertEqual(whiteBalanceFor((0.3, 0, 0.3)), none)
        XCTAssertEqual(whiteBalanceFor((.nan, 0.2, 0.2)), none)
    }

    func testWhiteBalanceForSaysSoWhenThePixelIsPastTheSlidersReach() {
        XCTAssertTrue(whiteBalanceFor((0.6, 0.3, 0.05)).clamped)
    }
}
