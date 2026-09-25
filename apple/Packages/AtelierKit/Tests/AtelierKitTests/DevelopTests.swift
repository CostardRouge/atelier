// Port of `src/shared/develop/develop.test.ts`.

import XCTest
@testable import AtelierKit

/// Linear luminance of a linear triple.
private func lum(_ p: RGB) -> Double { 0.2126 * p.0 + 0.7152 * p.1 + 0.0722 * p.2 }

/// A grey of encoded value `L`, as the linear triple it is.
private func grey(_ L: Double) -> RGB {
    let y = toLinear(L, .srgb)
    return (y, y, y)
}

/// Encoded luminance of a developed linear triple.
private func encodedLum(_ p: RGB) -> Double { fromLinear(min(1, lum(p)), .srgb) }

/// How coloured a linear triple is, 0 (grey) .. 1 (a pure primary).
private func sat(_ p: RGB) -> Double {
    let mx = max(p.0, p.1, p.2)
    return mx > 0 ? (mx - min(p.0, p.1, p.2)) / mx : 0
}

/// Chroma as max − min: a gain around luminance scales it exactly.
private func chroma(_ p: RGB) -> Double { max(p.0, p.1, p.2) - min(p.0, p.1, p.2) }

final class DevelopLinearTests: XCTestCase {
    func testIsTheIdentityAtEveryZero() {
        let points: [RGB] = [(0, 0, 0), (1, 1, 1), (0.2, 0.5, 0.8), (2.5, 0.1, 0.3)]
        for p in points { assertExact(developLinear(p, .default), p) }
    }

    func testExposureDoublesLinearLightAndHalvesItWithNoClamp() {
        assertExact(developLinear((0.2, 0.4, 0.6), dev { $0.exposure = 1 }), (0.4, 0.8, 1.2))
        assertExact(developLinear((0.2, 0.4, 0.6), dev { $0.exposure = -1 }), (0.1, 0.2, 0.3))
    }

    func testNeverReturnsANegativeChannelAndTreatsANegativeInputAsBlack() {
        assertExact(developLinear((-0.5, 0, 0), dev { $0.exposure = 2; $0.saturation = 100 }), (0, 0, 0))
    }

    func testAGreyStaysGreyUnderEveryLuminanceSlider() {
        let greys = [0.05, 0.25, 0.5, 0.75, 0.95]
        for key in DevelopKey.allCases where key != .temperature && key != .tint {
            for amount in [-100.0, 100, -37, 62] {
                let value = key == .exposure ? amount / 50 : amount
                for L in greys {
                    let out = developLinear(grey(L), dev { $0[key] = value })
                    assertClose(out.0, out.1, 9, "\(key.rawValue) \(value) at \(L)")
                    assertClose(out.1, out.2, 9, "\(key.rawValue) \(value) at \(L)")
                }
            }
        }
    }

    func testTemperatureAndTintAreTheOnlySlidersThatTintAGrey() {
        let warm = developLinear(grey(0.5), dev { $0.temperature = 100 })
        XCTAssertGreaterThan(warm.0, warm.2)
        let cool = developLinear(grey(0.5), dev { $0.temperature = -100 })
        XCTAssertLessThan(cool.0, cool.2)
        let magenta = developLinear(grey(0.5), dev { $0.tint = 100 })
        XCTAssertLessThan(magenta.1, magenta.0)
    }

    func testHighlightsLeaveAnythingBelowMidGreyUntouched() {
        for L in [0.0, 0.1, 0.3] {
            assertExact(developLinear(grey(L), dev { $0.highlights = -100 }), grey(L))
        }
        // Mid-grey itself sits on the band's edge, where the last ulp of the
        // luminance sum decides which side it lands on: within a rounding, not exact.
        assertTriple(developLinear(grey(0.5), dev { $0.highlights = -100 }), grey(0.5), 12)
        XCTAssertLessThan(encodedLum(developLinear(grey(0.75), dev { $0.highlights = -100 })), 0.75)
        XCTAssertGreaterThan(encodedLum(developLinear(grey(0.75), dev { $0.highlights = 100 })), 0.75)
    }

    func testShadowsLeaveAnythingAboveMidGreyUntouchedWhiteIncluded() {
        for L in [0.7, 0.95, 1] {
            assertExact(developLinear(grey(L), dev { $0.shadows = 100 }), grey(L))
        }
        assertTriple(developLinear(grey(0.5), dev { $0.shadows = 100 }), grey(0.5), 12)
        XCTAssertGreaterThan(encodedLum(developLinear(grey(0.25), dev { $0.shadows = 100 })), 0.25)
    }

    func testWhitesReachesWhiteItselfAndIsZeroAtMidGreyBlacksTheMirror() {
        assertClose(encodedLum(developLinear(grey(1), dev { $0.whites = -100 })), 0.8, 6)
        assertTriple(developLinear(grey(0.5), dev { $0.whites = -100 }), grey(0.5), 12)
        XCTAssertGreaterThan(encodedLum(developLinear(grey(0.05), dev { $0.blacks = 100 })), 0.05)
        assertTriple(developLinear(grey(0.5), dev { $0.blacks = 100 }), grey(0.5), 12)
    }

    func testWhitesPullsAPixelAboveWhiteDownByTheSameRatioAsWhite() {
        // A RAW's headroom: a super-white takes white's ratio — that is what
        // makes highlight recovery reach it.
        let white = developLinear((1, 1, 1), dev { $0.whites = -100 })
        let bright = developLinear((2, 2, 2), dev { $0.whites = -100 })
        assertClose(bright.0 / 2, white.0, 9)
    }

    func testContrastPivotsOnEighteenPercentGreyAndIsMonotone() {
        let pivot = fromLinear(0.18, .srgb)
        assertClose(encodedLum(developLinear(grey(pivot), dev { $0.contrast = 100 })), pivot, 6)
        for c in [-100.0, -40, 40, 100] {
            var prev = -1.0
            var L = 0.0
            while L <= 1.0001 {
                let v = encodedLum(developLinear(grey(L), dev { $0.contrast = c }))
                XCTAssertGreaterThanOrEqual(v, prev - 1e-9)
                prev = v
                L += 0.05
            }
        }
        XCTAssertGreaterThan(encodedLum(developLinear(grey(0.8), dev { $0.contrast = 100 })), 0.8)
        XCTAssertLessThan(encodedLum(developLinear(grey(0.2), dev { $0.contrast = 100 })), 0.2)
    }

    func testBrightnessKeepsBlackAndWhiteFixedAndMovesAMidGrey() {
        assertExact(developLinear((0, 0, 0), dev { $0.brightness = 100 }), (0, 0, 0))
        assertClose(encodedLum(developLinear(grey(1), dev { $0.brightness = -100 })), 1, 6)
        XCTAssertGreaterThan(encodedLum(developLinear(grey(0.5), dev { $0.brightness = 100 })), 0.5)
        XCTAssertLessThan(encodedLum(developLinear(grey(0.5), dev { $0.brightness = -100 })), 0.5)
    }

    func testSaturationMinusHundredIsAGreyOfTheSameLuminance() {
        let src: RGB = (0.6, 0.2, 0.1)
        let out = developLinear(src, dev { $0.saturation = -100 })
        assertClose(out.0, out.1, 9)
        assertClose(out.1, out.2, 9)
        assertClose(lum(out), lum(src), 9)
    }

    func testVibranceMovesAPaleColourMoreThanAStrongOneSaturationMovesBothAlike() {
        let pale: RGB = (0.5, 0.45, 0.4)
        let strong: RGB = (0.6, 0.15, 0.1)
        let paleGain = chroma(developLinear(pale, dev { $0.vibrance = 100 })) / chroma(pale)
        let strongGain = chroma(developLinear(strong, dev { $0.vibrance = 100 })) / chroma(strong)
        XCTAssertGreaterThan(paleGain, 1.7)
        XCTAssertLessThan(strongGain, 1.2)
        XCTAssertGreaterThan(strongGain, 1)
        assertClose(chroma(developLinear(pale, dev { $0.saturation = 50 })) / chroma(pale), 1.5, 6)
        assertClose(chroma(developLinear(strong, dev { $0.saturation = 50 })) / chroma(strong), 1.5, 6)
    }
}

final class DevelopStageTests: XCTestCase {
    func testIsTheExactIdentityWhenTheDevelopIsDefault() {
        let stage = developStage(.default)
        assertExact(stage(0.123, 0.456, 0.789), (0.123, 0.456, 0.789))
    }

    func testClampsToTheUnitRangeAndNeverNaNsAtTheEnds() {
        let stage = developStage(dev { $0.exposure = 3; $0.contrast = 100; $0.vibrance = 100; $0.whites = 100 })
        let points: [RGB] = [(0, 0, 0), (1, 1, 1), (1, 0, 0), (0.5, 0.5, 0.5)]
        for p in points {
            let out = stage(p.0, p.1, p.2)
            for c in [out.0, out.1, out.2] {
                XCTAssertTrue(c.isFinite)
                XCTAssertGreaterThanOrEqual(c, 0)
                XCTAssertLessThanOrEqual(c, 1)
            }
        }
        assertExact(stage(0, 0, 0), (0, 0, 0))
    }

    func testAgreesWithDevelopLinearThroughTheSRGBPair() {
        let d = dev { $0.exposure = 0.5; $0.shadows = 40 }
        let stage = developStage(d)
        let out = stage(0.3, 0.2, 0.1)
        let lin = developLinear((toLinear(0.3, .srgb), toLinear(0.2, .srgb), toLinear(0.1, .srgb)), d)
        assertClose(out.0, fromLinear(lin.0, .srgb), 9)
    }
}

final class DevelopRecordTests: XCTestCase {
    func testReadsNilAndAllZeroAsDefault() {
        XCTAssertTrue(isDefaultDevelop(nil))
        XCTAssertTrue(isDefaultDevelop(.default))
        XCTAssertFalse(isDefaultDevelop(dev { $0.tint = 1 }))
    }

    func testFillsMissingFieldsWithZeroClampsToTheRangeAndDropsJunk() {
        let out = normaliseDevelop(["exposure": 9, "blacks": -400, "vibrance": "x", "tint": .number(.nan), "extra": 1])
        XCTAssertEqual(out.exposure, 3)
        XCTAssertEqual(out.blacks, -100)
        XCTAssertEqual(out.vibrance, 0)
        XCTAssertEqual(out.tint, 0)
        XCTAssertEqual(out.highlights, 0)
        XCTAssertEqual(normaliseDevelop(nil), .default)
    }

    func testWritesExactlyTheKeysTheWebAppWrites() {
        // The sliders, the two SHAPES that are not sliders, and the material —
        // a stored develop carries exactly these, so a roll written here diffs
        // cleanly against one the web app wrote.
        let keys = DevelopSettings.default.json.objectValue?.keys.sorted()
        XCTAssertEqual(keys, (DevelopKey.allCases.map(\.rawValue) + ["curves", "levels", "mixer", "mono", "grading", "base", "rawGain", "rawWb"]).sorted())
        XCTAssertEqual(DevelopSettings.default.json.objectValue?["curves"], .null)
        XCTAssertEqual(DevelopSettings.default.json.objectValue?["mixer"], .null)
        XCTAssertEqual(dev { $0.exposure = 0.5 }.json.objectValue?["exposure"], .number(0.5))
    }

    func testReadsTheColourStagesAsTheWebDoesRendersThemAndNeverCallsThemDefault() {
        let mixer: JSONValue = ["hue": [0, 0, 10, 0, 0, 0, 0, 0], "saturation": [0, 0, 0, 0, 0, 0, 0, 0], "luminance": [0, 0, 0, 0, 0, 0, 0, 0]]
        let grading: JSONValue = ["shadows": ["hue": 220, "saturation": 20, "luminance": 0]]
        let d = normaliseDevelop(["exposure": 0.5, "mixer": mixer, "grading": grading, "mono": nil, "rawWb": ["kelvin": 5600]])
        XCTAssertFalse(isDefaultDevelop(d))
        // A record the web wrote whole is kept as written; a partial one is
        // read as the web reads it — every wheel, Blending 50, Balance 0.
        XCTAssertEqual(d.carried["mixer"], mixer)
        XCTAssertEqual(d.grading, withWheel(nil, .shadows, GradeWheel(hue: 220, saturation: 20, luminance: 0)))
        XCTAssertEqual(d.carried["grading"]?.objectValue?["blending"], 50)
        XCTAssertNil(d.carried["mono"])
        // A white balance in Kelvin is the RAW's: without a base it is dropped.
        XCTAssertNil(d.carried["rawWb"])
        // Rendered now: nothing is said to be missing, and the line names what moved.
        XCTAssertEqual(d.unrenderedStages, [])
        XCTAssertEqual(normaliseDevelop(["base": "gain", "rawWb": ["kelvin": 5600]]).unrenderedStages, ["rawWb"])
        XCTAssertEqual(developLines(d), ["+0.5 EV", "mixer hue", "grading shadows"])
        // The round trip keeps them, and a copy compares by value.
        let back = normaliseDevelop(JSONValue.parse(d.json.serialized()))
        XCTAssertEqual(back, d)
        XCTAssertEqual(back.json.serialized(), d.json.serialized())
        XCTAssertTrue(sameDevelop(back, d))
        XCTAssertFalse(sameDevelop(d, dev { $0.exposure = 0.5 }))
        // An all-zero mixer or a colourless grading is none, as on the web.
        let zeros: JSONValue = ["hue": [0, 0, 0, 0, 0, 0, 0, 0]]
        XCTAssertNil(developOrNull(["mixer": zeros, "grading": ["blending": 80]]))
        // Black and white takes the mixer's place in the line.
        XCTAssertEqual(developLines(normaliseDevelop(["mixer": mixer, "mono": ["mix": [0, 0, 0, 0, 0, 0, 0, 0]]])), ["B&W"])
    }

    func testARAWWhiteBalanceTravelsWithTheBaseAndNowhereElse() {
        let d = normaliseDevelop(["base": "gain", "rawGain": 2, "rawWb": ["kelvin": 5600.4, "tint": -3, "matrix": [1, 0, 0, 0, 1, 0, 0, 0, 1]]])
        XCTAssertNotNil(d.carried["rawWb"])
        XCTAssertEqual(developLines(d), ["RAW +1.0 EV metered", "5600 K, tint −3"])
        XCTAssertNil(withoutBase(d).carried["rawWb"])
        XCTAssertTrue(isDefaultDevelop(withoutBase(d)))
        XCTAssertEqual(developLines(normaliseDevelop(["base": "gain", "rawWb": ["kelvin": 3200]])), ["RAW", "3200 K"])
    }

    func testStoresNothingForAsShotAndAClampedRecordOtherwise() {
        XCTAssertNil(developOrNull(nil))
        XCTAssertNil(developOrNull(.null))
        XCTAssertNil(developOrNull([:]))
        XCTAssertNil(developOrNull(["exposure": 0, "tint": 0]))
        XCTAssertNil(developOrNull("junk"))
        XCTAssertEqual(developOrNull(["exposure": 9, "contrast": 12]), dev { $0.exposure = 3; $0.contrast = 12 })
    }

    func testKeepsWellFormedPresetsAndDropsTheRest() {
        XCTAssertEqual(normaliseDevelopPresets(nil), [])
        let raw: JSONValue = [
            ["id": "a", "name": "Desert noon", "settings": ["exposure": 0.5, "blacks": -300]],
            ["id": "", "name": "nameless"],
            ["name": "no id", "settings": [:]],
            "junk",
            ["id": "b", "name": "Empty", "settings": nil],
        ]
        XCTAssertEqual(normaliseDevelopPresets(raw), [
            DevelopPreset(id: "a", name: "Desert noon", settings: dev { $0.exposure = 0.5; $0.blacks = -100 }),
            DevelopPreset(id: "b", name: "Empty", settings: .default),
        ])
    }

    func testDescribesAsShotForNothingAndTheNonZeroFieldsInSliderOrder() {
        XCTAssertEqual(describeDevelop(nil), "As shot")
        XCTAssertEqual(describeDevelop(.default), "As shot")
        XCTAssertEqual(describeDevelop(dev { $0.vibrance = 15; $0.highlights = -40; $0.exposure = 0.7 }),
                       "+0.7 EV · highlights −40 · vibrance +15")
        XCTAssertEqual(describeDevelop(dev { $0.exposure = -1.25; $0.blacks = 6 }), "−1.25 EV · blacks +6")
    }

    func testDevelopLinesIsTheSameFactsOnePerEntryAndTheLineIsItsJoin() {
        XCTAssertEqual(developLines(nil), ["As shot"])
        XCTAssertEqual(developLines(.default), ["As shot"])
        let d = dev { $0.vibrance = 15; $0.highlights = -40; $0.exposure = 0.7 }
        XCTAssertEqual(developLines(d), ["+0.7 EV", "highlights −40", "vibrance +15"])
        XCTAssertEqual(developLines(d).joined(separator: " · "), describeDevelop(d))
        for line in developLines(d) { XCTAssertFalse(line.contains("·")) }
    }

    func testSignedPrintsATypographicMinusAndNoSignOnZero() {
        XCTAssertEqual(signed(-3), "−3")
        XCTAssertEqual(signed(3), "+3")
        XCTAssertEqual(signed(0), "0")
        XCTAssertEqual(signed(-0.004, digits: 2), "0")
    }
}

final class DevelopShapesTests: XCTestCase {
    func testTheLumaCurveKeepsAGreyGrey() {
        for L in [0.05, 0.25, 0.5, 0.75, 0.95] {
            let out = developLinear(grey(L), dev { $0.curves = ToneCurves(luma: sCurve) })
            assertClose(out.0, out.1, 9)
            assertClose(out.1, out.2, 9)
        }
    }

    func testTheLumaCurveMovesTheToneItWasDrawnToMoveInTheRightDirection() {
        let d = dev { $0.curves = ToneCurves(luma: sCurve) }
        assertClose(encodedLum(developLinear(grey(0.25), d)), 0.18, 3)
        assertClose(encodedLum(developLinear(grey(0.75), d)), 0.82, 3)
        assertClose(encodedLum(developLinear(grey(1), d)), 1, 6)
    }

    func testAPerChannelCurveTintsAGreyWhichIsExactlyWhatTellsItFromLuma() {
        let out = developLinear(grey(0.25), dev { $0.curves = ToneCurves(red: sCurve) })
        XCTAssertNotEqual(out.0, out.1, accuracy: 0.5e-4)
        assertClose(out.1, out.2, 9)
        // Only the red channel moved; green and blue are bit-identical.
        let asShot = grey(0.25)
        XCTAssertEqual(out.1, asShot.1)
        XCTAssertEqual(out.2, asShot.2)
    }

    func testTheRGBCurveKeepsAGreyGreyButMovesAColoursSaturationLumaDoesNot() {
        let colour: RGB = (toLinear(0.7, .srgb), toLinear(0.45, .srgb), toLinear(0.2, .srgb))
        let rgbOut = developLinear(grey(0.5), dev { $0.curves = ToneCurves(rgb: sCurve) })
        assertClose(rgbOut.0, rgbOut.1, 9)
        assertClose(rgbOut.1, rgbOut.2, 9)
        XCTAssertGreaterThan(sat(developLinear(colour, dev { $0.curves = ToneCurves(rgb: sCurve) })), sat(colour) + 0.02)
        assertClose(sat(developLinear(colour, dev { $0.curves = ToneCurves(luma: sCurve) })), sat(colour), 6)
    }

    func testLeavesAPixelTheShapeDoesNotMoveBitIdentical() {
        let flatEnds: Curve = [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.4), CurvePoint(x: 0.6, y: 0.7), CurvePoint(x: 1, y: 1)]
        let d = dev { $0.curves = ToneCurves(rgb: flatEnds, red: flatEnds) }
        assertExact(developLinear((0, 0, 0), d), (0, 0, 0))
        assertExact(developLinear((1, 1, 1), d), (1, 1, 1))
    }

    func testKeepsARAWsHeadroomWhereTheCurveDoesNotReachIt() {
        let pinnedAtWhite: Curve = [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.35), CurvePoint(x: 1, y: 1)]
        let out = developLinear((4, 4, 4), dev { $0.curves = ToneCurves(rgb: pinnedAtWhite) })
        XCTAssertEqual(out.0, 4)
    }

    func testLevelsMoveTheBlackPointAndReadAsPartOfTheDevelop() {
        let d = dev { $0.levels = Levels(rgb: LevelChannel(inBlack: 0.2)) }
        XCTAssertFalse(isDefaultDevelop(d))
        assertClose(encodedLum(developLinear(grey(0.2), d)), 0, 5)
        assertClose(encodedLum(developLinear(grey(1), d)), 1, 5)
    }

    func testAppliesLevelsBeforeTheCurvesTheFixedOrder() {
        let d = dev {
            $0.curves = ToneCurves(rgb: sCurve)
            $0.levels = Levels(rgb: LevelChannel(gamma: 2))
        }
        let v = 0.4
        let expected = makeCurve(sCurve)(pow(v, 1 / 2))
        assertClose(developStage(d)(v, v, v).0, expected, 6)
    }

    func testEveryReaderReadsAShape() {
        XCTAssertFalse(isDefaultDevelop(dev { $0.curves = ToneCurves(luma: sCurve) }))
        XCTAssertTrue(isDefaultDevelop(dev { $0.curves = ToneCurves(luma: identityCurve()) }))
        XCTAssertTrue(isDefaultDevelop(dev { $0.curves = nil; $0.levels = nil }))
        XCTAssertEqual(describeDevelop(dev { $0.curves = ToneCurves(luma: sCurve, red: sCurve) }), "curve luma+red")
        XCTAssertEqual(describeDevelop(dev {
            $0.exposure = 0.7
            $0.curves = ToneCurves(luma: sCurve)
            $0.levels = Levels(rgb: LevelChannel(inBlack: 0.1))
        }), "+0.7 EV · levels rgb · curve luma")
        XCTAssertNil(developOrNull(["curves": ["luma": curveJSON(identityCurve())]]))
        XCTAssertEqual(developOrNull(["curves": ["luma": curveJSON(sCurve)]])?.curves?.luma, sCurve)
    }

    func testSameDevelopComparesAShapeByValue() {
        let a = dev { $0.curves = ToneCurves(luma: sCurve) }
        let b = dev { $0.curves = ToneCurves(luma: sCurve) }
        XCTAssertTrue(sameDevelop(a, b))
        XCTAssertTrue(sameDevelop(nil, dev { $0.curves = ToneCurves(luma: identityCurve()) }))
        XCTAssertFalse(sameDevelop(a, .default))
    }

    func testCloneDevelopIsACopyAndNilIsTheDefault() {
        let source = dev { $0.curves = ToneCurves(luma: sCurve) }
        var copy = cloneDevelop(source)
        copy.curves?.luma?[1].y = 0.99
        XCTAssertEqual(source.curves?.luma?[1].y, 0.18)
        XCTAssertEqual(cloneDevelop(nil), .default)
    }

    func testAStoredShapeSurvivesTheRoundTripThroughNormaliseDevelop() {
        let out = normaliseDevelop([
            "exposure": 0.5,
            "curves": ["luma": curveJSON(sCurve), "red": [["x": 0.9, "y": 0.1], ["x": 0.2, "y": 0.4]]],
            "levels": ["blue": ["inBlack": 0.05, "gamma": 1.4]],
        ])
        XCTAssertEqual(out.curves?.luma, sCurve)
        XCTAssertEqual(out.curves?.red, [CurvePoint(x: 0.2, y: 0.4), CurvePoint(x: 0.9, y: 0.1)])
        XCTAssertEqual(out.levels?.blue?.gamma, 1.4)
        XCTAssertNil(out.levels?.rgb)
    }

    func testAShapeSurvivesTheJSONRoundTrip() {
        let d = dev {
            $0.exposure = 0.5
            $0.curves = ToneCurves(luma: sCurve)
            $0.levels = Levels(blue: LevelChannel(inBlack: 0.05, gamma: 1.4))
        }
        let back = normaliseDevelop(JSONValue.parse(d.json.serialized()))
        XCTAssertEqual(back, d)
        XCTAssertTrue(sameDevelop(back, d))
    }
}

final class RawBaseTests: XCTestCase {
    func testIsNeverDefaultComparesByBaseAndGainAndIsStrippedByWithoutBase() {
        let raw = dev { $0.base = .gain; $0.rawGain = 2 }
        XCTAssertFalse(isDefaultDevelop(raw))
        XCTAssertTrue(isRawDevelop(raw))
        XCTAssertEqual(rawGainOf(raw), 2)
        XCTAssertEqual(rawGainOf(dev { $0.base = .gain }), 1)
        XCTAssertEqual(rawGainOf(dev { $0.rawGain = 2 }), 1)
        XCTAssertTrue(sameDevelop(raw, raw))
        XCTAssertFalse(sameDevelop(raw, dev { $0.base = .gain; $0.rawGain = 2.5 }))
        XCTAssertFalse(sameDevelop(raw, withoutBase(raw)))
        XCTAssertTrue(isDefaultDevelop(withoutBase(raw)))
        XCTAssertEqual(cloneDevelop(raw).base, .gain)
        XCTAssertEqual(cloneDevelop(raw).rawGain, 2)
    }

    func testReadsYesterdaysTwoValuesAsTodaysFour() {
        XCTAssertNil(normaliseBase("render"))
        XCTAssertNil(normaliseDevelop(["base": "render", "rawGain": 3]).base)
        XCTAssertEqual(normaliseBase("raw"), .gain)
        let old = normaliseDevelop(["base": "raw", "rawGain": 3])
        XCTAssertEqual(old.base, .gain)
        XCTAssertEqual(old.rawGain, 3)
        XCTAssertEqual(normaliseBase("gainMap"), .gainMap)
        XCTAssertEqual(normaliseBase("gainMapWarp"), .gainMapWarp)
        XCTAssertNil(normaliseBase("sensor"))
        XCTAssertNil(normaliseBase(7))
    }

    func testIsALadder() {
        XCTAssertEqual(DevelopBase.allCases.map(\.rawValue), ["proxy", "gain", "gainMap", "gainMapWarp"])
        XCTAssertEqual(DevelopBase.proxy.rung, 0)
        XCTAssertEqual(DevelopBase.gainMapWarp.rung, 3)
        for base in [DevelopBase.gain, .gainMap, .gainMapWarp] {
            XCTAssertTrue(isRawDevelop(dev { $0.base = base }))
            XCTAssertFalse(isDefaultDevelop(dev { $0.base = base }))
            XCTAssertNil(withoutBase(dev { $0.base = base; $0.rawGain = 2 }).base)
        }
        XCTAssertFalse(isRawDevelop(dev { $0.base = .proxy }))
        XCTAssertEqual(developBase(dev { $0.base = .proxy }), .proxy)
        XCTAssertEqual(developBase(nil), .proxy)
    }

    func testSaysWhichRungAPictureStandsOn() {
        XCTAssertEqual(developLines(dev { $0.base = .gain; $0.rawGain = 4 })[0], "RAW +2.0 EV metered")
        XCTAssertEqual(developLines(dev { $0.base = .gainMap; $0.rawGain = 4 })[0], "RAW + gain map +2.0 EV metered")
        XCTAssertEqual(developLines(dev { $0.base = .gainMapWarp; $0.rawGain = 1 })[0], "RAW + gain map + warp")
    }

    func testReadsBackSafely() {
        XCTAssertEqual(normaliseDevelop(["base": "gain", "rawGain": 3]).rawGain, 3)
        XCTAssertEqual(normaliseDevelop(["base": "gain", "rawGain": 1000]).rawGain, rawGainLimits.max)
        XCTAssertNil(normaliseDevelop(["base": "gain", "rawGain": "x"]).rawGain)
        XCTAssertNil(normaliseDevelop(["base": "proxy", "rawGain": 3]).base)
        XCTAssertNil(normaliseDevelop(["base": "proxy", "rawGain": 3]).rawGain)
        XCTAssertNotNil(developOrNull(["base": "gain"]))
    }

    func testAppliesTheMeasuredGainInLinearLightBeforeTheSlidersInTheBakeStage() {
        let stage = developStage(dev { $0.base = .gain; $0.rawGain = 2 })
        assertClose(stage(0.5, 0.5, 0.5).0, fromLinear(toLinear(0.5, .srgb) * 2, .srgb), 9)
        let back = developStage(dev { $0.base = .gain; $0.rawGain = 2; $0.exposure = -1 })
        assertClose(back(0.5, 0.5, 0.5).1, 0.5, 9)
    }

    func testNamesTheMaterialAndItsMeteredExposureFirst() {
        XCTAssertEqual(developLines(dev { $0.base = .gain; $0.rawGain = 1 })[0], "RAW")
        XCTAssertEqual(developLines(dev { $0.base = .gain; $0.rawGain = 4; $0.exposure = -0.5 }), ["RAW +2.0 EV metered", "−0.5 EV"])
    }
}
