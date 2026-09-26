// Port of `src/shared/develop/mixer.test.ts`, case for case. The web's
// `bandWeights` is `mixerBandWeights` here (`Mixer.swift` says why).

import XCTest
@testable import AtelierKit

/// An sRGB code triple as linear light.
private func lin(_ r: Double, _ g: Double, _ b: Double) -> RGB {
    (toLinear(r / 255, .srgb), toLinear(g / 255, .srgb), toLinear(b / 255, .srgb))
}

private func Y(_ p: RGB) -> Double { 0.2126 * p.0 + 0.7152 * p.1 + 0.0722 * p.2 }

private func hueOf(_ p: RGB) -> Double {
    hueSat(fromLinear(p.0, .srgb), fromLinear(p.1, .srgb), fromLinear(p.2, .srgb)).hue
}

private func mixer(_ channel: MixerChannel, _ band: MixerBand, _ v: Double) -> ColourMixer {
    withMixerValue(nil, channel, band, v)!
}

private let zeros = [Double](repeating: 0, count: 8)
private let sky = lin(70, 130, 220)

final class MixerBandWeightsTests: XCTestCase {
    func testIsAPartitionOfUnityAtEveryHue() {
        var h = 0.0
        while h < 360 {
            assertClose(mixerBandWeights(h).reduce(0, +), 1, 12)
            h += 7
        }
    }

    func testPeaksAtEachBandCentreAndWrapsFromMagentaBackToRed() {
        for (i, band) in MixerBand.allCases.enumerated() {
            assertClose(mixerBandWeights(band.centre)[i], 1, 12)
        }
        let w = mixerBandWeights(337.5)
        assertClose(w[7], 0.5, 2)
        assertClose(w[0], 0.5, 2)
    }
}

final class MixLinearTests: XCTestCase {
    func testLeavesAGreyExactlyAsItWasWhateverTheBandsSay() {
        let all = ColourMixer(hue: [Double](repeating: 100, count: 8),
                              saturation: [Double](repeating: -100, count: 8),
                              luminance: [Double](repeating: -100, count: 8))
        let grey = lin(128, 128, 128)
        assertExact(mixLinear(grey, all), grey)
    }

    func testDarkensABlueSkyWithBlueLuminanceAndLeavesARedUntouched() {
        let m = mixer(.luminance, .blue, -100)
        XCTAssertLessThan(Y(mixLinear(sky, m)), Y(sky) * 0.6)
        let red = lin(220, 40, 30)
        assertExact(mixLinear(red, m), red)
    }

    func testShiftsAHueWithoutChangingItsLight() {
        let orange = lin(230, 130, 40)
        let out = mixLinear(orange, mixer(.hue, .orange, 100))
        XCTAssertGreaterThan(hueOf(out), hueOf(orange) + 15)
        assertClose(Y(out), Y(orange), 10)
    }

    func testDesaturatesABandToGreyAtMinusHundredWhileKeepingItsLuminance() {
        let green = lin(60, 200, 60)
        let out = mixLinear(green, mixer(.saturation, .green, -100))
        assertClose(out.0, out.1, 10)
        assertClose(out.1, out.2, 10)
        assertClose(Y(out), Y(green), 10)
    }

    func testKeepsAValueAboveWhiteOnItsColour() {
        let hot: RGB = (sky.0 * 3, sky.1 * 3, sky.2 * 3)
        let out = mixLinear(hot, mixer(.luminance, .blue, 50))
        let k = out.2 / hot.2
        assertClose(out.0 / hot.0, k, 10)
        XCTAssertGreaterThan(k, 1)
    }
}

final class MixerRecordTests: XCTestCase {
    func testReadsAStoredMixerSafelyAndSaysNoneForZerosOrJunk() {
        XCTAssertNil(mixerOrNull(["hue": [0, 0], "saturation": "x"]))
        let m = mixerOrNull(["luminance": [0, 0, 0, 0, 0, -400, .number(.nan)]])
        XCTAssertEqual(m?.luminance[5], -100)
        XCTAssertEqual(m?.hue, zeros)
        XCTAssertNil(mixerOrNull(nil))
        XCTAssertNil(mixerOrNull(.null))
        XCTAssertNil(mixerOrNull("junk"))
    }

    func testIsPartOfWhatADevelopIsDefaultCloneCompareNormaliseWords() {
        let d = dev { $0.mixer = mixer(.saturation, .aqua, 30) }
        XCTAssertNotNil(developOrNull(d.json))
        XCTAssertFalse(isDefaultDevelop(d))
        let c = cloneDevelop(d)
        XCTAssertEqual(c.mixer, d.mixer)
        XCTAssertTrue(sameDevelop(c, d))
        XCTAssertFalse(sameDevelop(d, .default))
        XCTAssertTrue(sameDevelop(dev { $0.mixer = emptyMixer() }, .default))
        XCTAssertEqual(describeDevelop(d), "mixer sat")
        // The typed field reads what the web wrote, and writes what the web reads.
        let back = normaliseDevelop(JSONValue.parse(d.json.serialized()))
        XCTAssertEqual(back.mixer, d.mixer)
        XCTAssertEqual(back, d)
        XCTAssertEqual(d.json.objectValue?["mixer"]?.objectValue?["saturation"], [0, 0, 0, 0, 30, 0, 0, 0])
        XCTAssertEqual(dev { $0.mixer = emptyMixer() }.json.objectValue?["mixer"], .null)
    }

    func testRunsLastInTheDevelopAndReachesTheBake() {
        let d = dev { $0.mixer = mixer(.luminance, .blue, -100) }
        let out = developLinear(sky, d)
        XCTAssertLessThan(Y(out), Y(sky))
        let stage = developStage(d)
        let b = stage(70 / 255, 130 / 255, 220 / 255).2
        XCTAssertLessThan(b, 220 / 255)
        let grey = stage(0.5, 0.5, 0.5)
        let v = fromLinear(toLinear(0.5, .srgb), .srgb)
        assertExact(grey, (v, v, v))
    }

    func testEditsOneValueAndOneChannelAtATimeNilWhenNothingIsLeft() {
        let m = withMixerValue(nil, .hue, .red, 20)
        XCTAssertEqual(m?.hue[0], 20)
        XCTAssertNil(withMixerValue(m, .hue, .red, 0))
        XCTAssertTrue(isDefaultMixer(withoutMixerChannel(m, .hue)))
    }
}

final class BlackAndWhiteTests: XCTestCase {
    func testTurnsAPictureGreyAtItsOwnLuminanceWithAStraightMix() {
        let out = monoLinear(sky, straightMono())
        XCTAssertEqual(out.0, out.1)
        XCTAssertEqual(out.1, out.2)
        assertClose(out.0, Y(sky), 12)
    }

    func testDarkensABlueSkyInGreyLikeARedFilterAndLeavesAGreyAsItWas() {
        let redFilter = withMonoValue(withMonoValue(nil, .blue, -100), .red, 60)
        XCTAssertLessThan(monoLinear(sky, redFilter).0, Y(sky) * 0.6)
        let red = lin(220, 40, 30)
        XCTAssertGreaterThan(monoLinear(red, redFilter).0, Y(red))
        let grey = lin(128, 128, 128)
        assertClose(monoLinear(grey, redFilter).0, grey.0, 12)
    }

    func testIsTheTreatmentItselfAStraightMixIsNotAsShotAndTheColourMixerWaits() {
        let colourWork = mixer(.luminance, .blue, -100)
        let bw = dev { $0.mixer = colourWork; $0.mono = straightMono() }
        XCTAssertNotNil(developOrNull(dev { $0.mono = straightMono() }.json))
        // Grey at the sky's OWN luminance: the blue −100 of the kept mixer is not applied.
        assertClose(developLinear(sky, bw).2, Y(sky), 12)
        XCTAssertEqual(describeDevelop(bw), "B&W")
        var mixed = bw
        mixed.mono = withMonoValue(nil, .red, 20)
        XCTAssertEqual(describeDevelop(mixed), "B&W mix")
        var colour = bw
        colour.mono = nil
        XCTAssertFalse(sameDevelop(bw, colour))
        // A copy is its own: editing it leaves the treatment it came from.
        var copy = cloneDevelop(bw)
        copy.mono = withMonoValue(copy.mono, .red, 20)
        XCTAssertEqual(bw.mono, straightMono())
        // The mixer is KEPT under the treatment: the record still holds it.
        XCTAssertEqual(bw.mixer, colourWork)
    }

    func testReadsAStoredTreatmentSafely() {
        XCTAssertNil(monoOrNull(nil))
        XCTAssertNil(monoOrNull(.null))
        XCTAssertEqual(monoOrNull([:]), straightMono())
        XCTAssertEqual(Array(monoOrNull(["mix": [500, .number(.nan), -3]])!.mix.prefix(3)), [100, 0, -3])
        // Any object reads as a treatment, as in JavaScript — a list included.
        XCTAssertEqual(monoOrNull([1, 2]), straightMono())
        XCTAssertNil(monoOrNull("junk"))
    }
}
