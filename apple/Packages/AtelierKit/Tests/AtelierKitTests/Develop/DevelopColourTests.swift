// The colour stages as ONE application — the order the web's `developLinear`
// fixes in its last lines (`develop.ts`), which has no spec of its own there:
// black and white takes the mixer's place, the wheels come after, and all of
// it after every other slider. Pinned here because `DevelopColour.swift`
// resolves them apart from `developLinear` and a bake must take them once.

import XCTest
@testable import AtelierKit

private func lin(_ r: Double, _ g: Double, _ b: Double) -> RGB {
    (toLinear(r / 255, .srgb), toLinear(g / 255, .srgb), toLinear(b / 255, .srgb))
}

private let sky = lin(70, 130, 220)

final class DevelopColourTests: XCTestCase {
    func testAppliesNothingOnADevelopWithoutColourStages() {
        XCTAssertTrue(makeColourStages(.default).isEmpty)
        XCTAssertTrue(makeColourStages(dev { $0.exposure = 1; $0.curves = ToneCurves(luma: sCurve) }).isEmpty)
        assertExact(applyColourStages(sky, .default), sky)
        assertExact(applyColourStages((2, 0.5, 0.1), ColourStages.uncoloured), (2, 0.5, 0.1))
    }

    func testBlackAndWhiteTakesTheMixersPlaceAndTheWheelsTintTheGreyAfterIt() {
        // The sky's grey sits just above the pivot: the midtones' range, not the shadows'.
        let grading = withWheel(nil, .midtones, GradeWheel(hue: 220, saturation: 70, luminance: 0))!
        let d = dev {
            $0.mixer = withMixerValue(nil, .luminance, .blue, -100)
            $0.mono = straightMono()
            $0.grading = grading
        }
        let stages = makeColourStages(d)
        XCTAssertNotNil(stages.mono)
        XCTAssertNil(stages.mixer, "the mixer is kept, not applied, while black and white is on")
        XCTAssertNotNil(stages.grading)
        assertExact(applyColourStages(sky, d), gradeLinear(monoLinear(sky, straightMono()), grading))
        // A split tone: the grey the treatment made is tinted by the wheel.
        let out = developLinear(sky, d)
        XCTAssertGreaterThan(out.2, out.0)
    }

    func testTheMixerThenTheGradingWhenThereIsNoTreatment() {
        let mixer = withMixerValue(nil, .luminance, .blue, -100)!
        let grading = withWheel(nil, .global, GradeWheel(hue: 30, saturation: 40, luminance: 0))!
        let d = dev { $0.mixer = mixer; $0.grading = grading }
        assertExact(applyColourStages(sky, d), gradeLinear(mixLinear(sky, mixer), grading))
        assertExact(developLinear(sky, d), gradeLinear(mixLinear(sky, mixer), grading))
        // A default mixer written into the record is no stage at all.
        XCTAssertNil(makeColourStages(dev { $0.mixer = emptyMixer() }).mixer)
    }

    func testTheStagesRunAfterEveryOtherSliderInTheWebsOrder() {
        let mixer = withMixerValue(nil, .hue, .orange, 100)!
        let d = dev { $0.exposure = 1; $0.saturation = 30; $0.mixer = mixer }
        var plain = d
        plain.mixer = nil
        let px = lin(230, 130, 40)
        assertExact(developLinear(px, d), mixLinear(developLinear(px, plain), mixer))
        // Resolved once and handed in, the answer is the one resolved per pixel.
        assertExact(developLinear(px, d, makeDevelopShapers(d), makeColourStages(d)), developLinear(px, d))
    }

    func testTheBakeTakesTheStagesOnceAndMatchesTheLinearMaths() {
        let d = dev {
            $0.contrast = 20
            $0.mixer = withMixerValue(nil, .saturation, .orange, -60)
            $0.grading = withWheel(nil, .highlights, GradeWheel(hue: 40, saturation: 60, luminance: 10))
        }
        let stage = developStage(d)
        for p in [(0.3, 0.2, 0.1), (0.9, 0.6, 0.2), (0.5, 0.5, 0.5)] as [RGB] {
            let out = developLinear((toLinear(p.0, .srgb), toLinear(p.1, .srgb), toLinear(p.2, .srgb)), d)
            assertExact(stage(p.0, p.1, p.2), (fromLinear(out.0, .srgb), fromLinear(out.1, .srgb), fromLinear(out.2, .srgb)))
        }
    }

    func testTheBakeClampsToTheUnitRangeAndTakesTheMeasuredGainFirst() {
        let d = dev {
            $0.base = .gain
            $0.rawGain = 2
            $0.mixer = withMixerValue(nil, .luminance, .blue, 100)
            $0.grading = withWheel(nil, .highlights, GradeWheel(hue: 40, saturation: 100, luminance: 100))
        }
        let stage = developStage(d)
        for p in [(0, 0, 0), (1, 1, 1), (0.27, 0.51, 0.86), (0.5, 0.5, 0.5)] as [RGB] {
            let out = stage(p.0, p.1, p.2)
            for c in [out.0, out.1, out.2] {
                XCTAssertTrue(c.isFinite)
                XCTAssertGreaterThanOrEqual(c, 0)
                XCTAssertLessThanOrEqual(c, 1)
            }
        }
        // A grey takes the gain and nothing of the mixer, which sees no colour in it…
        var mixerOnly = d
        mixerOnly.grading = nil
        let grey = developStage(mixerOnly)(0.25, 0.25, 0.25)
        let gained = fromLinear(toLinear(0.25, .srgb) * 2, .srgb)
        assertExact(grey, (gained, gained, gained))
        // …while the highlights wheel lifts a bright one past the gain alone.
        let bright = stage(0.55, 0.55, 0.55)
        let lifted = 0.2126 * toLinear(bright.0, .srgb) + 0.7152 * toLinear(bright.1, .srgb) + 0.0722 * toLinear(bright.2, .srgb)
        XCTAssertGreaterThan(lifted, toLinear(0.55, .srgb) * 2 * 1.2)
        XCTAssertGreaterThan(bright.0, bright.2, "the warm wheel tints the grey")
    }

    func testColourStageLinesFollowTheWebsOrder() {
        let grading = withWheel(nil, .shadows, GradeWheel(hue: 200, saturation: 50, luminance: 0))
        XCTAssertEqual(colourStageLines(.default), [])
        XCTAssertEqual(colourStageLines(dev { $0.mono = straightMono(); $0.grading = grading }), ["B&W", "grading shadows"])
        XCTAssertEqual(colourStageLines(dev {
            $0.mixer = withMixerValue(withMixerValue(nil, .luminance, .blue, -100), .hue, .red, 10)
            $0.grading = grading
        }), ["mixer hue+lum", "grading shadows"])
        XCTAssertEqual(colourStageLines(dev {
            $0.mixer = withMixerValue(nil, .luminance, .blue, -100)
            $0.mono = withMonoValue(nil, .red, 20)
        }), ["B&W mix"])
        // `developLines` ends on them, after the curves.
        XCTAssertEqual(developLines(dev { $0.exposure = 0.5; $0.curves = ToneCurves(luma: sCurve); $0.grading = grading }),
                       ["+0.5 EV", "curve luma", "grading shadows"])
    }

    func testTheTypedFieldsReadARecordTheWebWrote() {
        let d = normaliseDevelop([
            "exposure": 0.5,
            "mixer": ["hue": [0, 0, 10, 0, 0, 0, 0, 0], "saturation": [0, 0, 0, 0, 0, 0, 0, 0], "luminance": [0, 0, 0, 0, 0, -40, 0, 0]],
            "grading": ["shadows": ["hue": 220, "saturation": 20, "luminance": 0], "balance": 10],
            "mono": ["mix": [60, 0, 0, 0, 0, -100, 0, 0]],
        ])
        XCTAssertEqual(d.mixer?.hue[2], 10)
        XCTAssertEqual(d.mixer?.luminance[5], -40)
        XCTAssertEqual(d.grading?.shadows.saturation, 20)
        XCTAssertEqual(d.grading?.blending, 50)
        XCTAssertEqual(d.grading?.balance, 10)
        XCTAssertEqual(d.mono?.mix[0], 60)
        XCTAssertEqual(developLines(d), ["+0.5 EV", "B&W mix", "grading shadows"])
        // Written back, the record round-trips through the web's own reading.
        let back = normaliseDevelop(JSONValue.parse(d.json.serialized()))
        XCTAssertEqual(back, d)
        // Taken off one by one, nothing is left of them.
        var cleared = d
        cleared.mixer = nil
        cleared.mono = nil
        cleared.grading = nil
        XCTAssertEqual(cleared.carried, [:])
        XCTAssertEqual(cleared, dev { $0.exposure = 0.5 })
    }
}
