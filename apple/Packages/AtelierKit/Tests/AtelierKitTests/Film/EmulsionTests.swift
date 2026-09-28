// Port of `src/shared/film/emulsion.test.ts`.

import XCTest
@testable import AtelierKit

private func curve(_ change: (inout FilmCurve) -> Void = { _ in }) -> FilmCurve {
    var c = neutralCurve
    change(&c)
    return c
}

/// A straight, colourless stock: three neutral curves, no coupling, no print.
private func neutral(_ change: (inout FilmResponse) -> Void = { _ in }) -> FilmResponse {
    var r = FilmResponse(
        coupling: 0, inhibition: 0,
        curve: FilmCurveSet(r: curve(), g: curve(), b: curve()),
        print: false, paperGrade: 2, dye: 0, mono: nil
    )
    change(&r)
    return r
}

private let midCode = fromLinear(midGrey, .srgb)
private func lum(_ p: RGB) -> Double { 0.2126 * p.0 + 0.7152 * p.1 + 0.0722 * p.2 }
private func chroma(_ p: RGB) -> Double { max(p.0, p.1, p.2) - min(p.0, p.1, p.2) }
private func codes(_ v: Double) -> Double { v * 255 }

final class FilmMakeCurveTests: XCTestCase {
    private let sweep: [Double] = (0..<601).map { -15 + Double($0) * 0.05 }

    func testPassesThroughTheOriginExactlyWhateverTheKneesDoToTheMidtones() {
        let curves = [
            curve(),
            curve { $0.toe = 2.5; $0.shoulder = 2.5 },
            curve { $0.gamma = 0.4; $0.white = 0.6 },
            curve { $0.gamma = 2.8; $0.black = 1.2; $0.shoulder = 3 },
        ]
        for c in curves {
            XCTAssertLessThan(abs(makeCurve(c)(0)), 1e-9)
        }
    }

    func testIsMonotoneEverywhereStrictlySoBetweenTheKnees() {
        for c in [curve(), curve { $0.toe = 3; $0.shoulder = 3; $0.gamma = 0.3 }, curve { $0.gamma = 3 }] {
            let f = makeCurve(c)
            var prev = f(sweep[0])
            for x in sweep.dropFirst() {
                let y = f(x)
                if x > -c.black / c.gamma && x < c.white / c.gamma {
                    XCTAssertGreaterThan(y, prev)
                } else {
                    XCTAssertGreaterThanOrEqual(y, prev)
                }
                prev = y
            }
        }
    }

    func testBottomsOutAtMinusBlackAndTopsOutAtPlusWhiteNeverBeyondEither() {
        let f = makeCurve(curve { $0.black = 4; $0.white = 2 })
        assertClose(f(-40), -4, 4)
        assertClose(f(40), 2, 4)
        for x in sweep {
            let y = f(x)
            XCTAssertGreaterThanOrEqual(y, -4)
            XCTAssertLessThanOrEqual(y, 2)
        }
    }

    func testIsC1NoKinkAnywhereAHardKneeWouldPutOne() {
        let f = makeCurve(curve { $0.toe = 0.05; $0.shoulder = 0.05 })
        let h = 0.002
        var worst = 0.0
        var x = -8.0
        while x <= 5 {
            let d2 = (f(x + h) - 2 * f(x) + f(x - h)) / (h * h)
            worst = max(worst, abs(d2) * h)
            x += h
        }
        // A hard knee has a second difference of order 1/h; a smooth one stays O(1).
        XCTAssertLessThan(worst, 0.2)
    }

    func testHasAStraightLineOfSlopeGammaBetweenTheKnees() {
        let f = makeCurve(curve { $0.gamma = 1.4; $0.toe = 0.1; $0.shoulder = 0.1 })
        assertClose((f(0.5) - f(-0.5)) / 1, 1.4, 2)
    }

    func testKeepsToeAndShoulderInTheirOwnRegions() {
        // A knee `k` stops wide reaches about 3k stops either side of its
        // corner, so a shoulder of 1 stop at +4 is felt at +2 and not at −2.
        let base = makeCurve(curve { $0.toe = 0.3; $0.shoulder = 0.3 })
        let softShoulder = makeCurve(curve { $0.toe = 0.3; $0.shoulder = 1 })
        let softToe = makeCurve(curve { $0.toe = 1; $0.shoulder = 0.3 })
        // A shoulder change moves the highlights far more than the shadows…
        let highMove = abs(softShoulder(3) - base(3))
        let lowMove = abs(softShoulder(-2) - base(-2))
        XCTAssertGreaterThan(highMove, lowMove * 3)
        // …and a toe change the reverse.
        XCTAssertGreaterThan(abs(softToe(-5) - base(-5)), abs(softToe(2) - base(2)) * 3)
    }

    func testSpeedIsAnExplicitPushBeyondNeutrality() {
        let f = makeCurve(curve { $0.speed = 1 })
        assertClose(f(-1), 0, 9)
    }
}

final class FilmLinearTests: XCTestCase {
    func testANeutralStockMapsMidGreyToMidGreyExactlyAndKeepsAGreyGrey() {
        let out = filmLinear((midGrey, midGrey, midGrey), neutral())
        assertClose(out.0, midGrey, 9)
        assertClose(out.1, midGrey, 9)
        assertClose(out.2, midGrey, 9)
        for y in [0.01, 0.1, 0.5, 0.9] {
            let g = filmLinear((y, y, y), neutral { $0.coupling = 60; $0.inhibition = 80; $0.dye = 40 })
            assertClose(g.0, g.1, 9)
            assertClose(g.1, g.2, 9)
        }
    }

    func testIsMonotoneInLuminanceAlongTheGreyRampPrintOrReversal() {
        for r in [neutral(), neutral { $0.print = true; $0.paperGrade = 3 }] {
            var prev = -1.0
            for i in 0...100 {
                let v = Double(i) / 100
                let y = lum(filmLinear((v, v, v), r))
                XCTAssertGreaterThanOrEqual(y, prev)
                prev = y
            }
        }
    }

    func testNeverNaNsOnBlackOnWhiteOrAboveWhite() {
        let points: [RGB] = [(0, 0, 0), (1, 1, 1), (4, 0, 0), (0, 0, 1e-9)]
        let r = neutral { $0.coupling = 50; $0.inhibition = 50; $0.print = true; $0.dye = -50 }
        for p in points {
            let out = filmLinear(p, r)
            for v in [out.0, out.1, out.2] {
                XCTAssertTrue(v.isFinite)
                XCTAssertGreaterThanOrEqual(v, 0)
            }
        }
    }

    func testBlackStaysBlackTheToeBottomsOutItDoesNotLift() {
        let out = filmLinear((0, 0, 0), neutral())
        XCTAssertLessThan(lum(out), midGrey * pow(2, -5.9))
    }

    func testAStockIsAllowedToTintAGreyPerChannelGammaIsTheCrossover() {
        let crossed = neutral {
            $0.curve = FilmCurveSet(r: curve { $0.gamma = 1.1 }, g: curve(), b: curve { $0.gamma = 0.9 })
        }
        // Mid grey stays exact…
        let mid = filmLinear((midGrey, midGrey, midGrey), crossed)
        assertClose(mid.0, midGrey, 9)
        assertClose(mid.2, midGrey, 9)
        // …the shadows go cool and the highlights warm.
        let dark = filmLinear((0.02, 0.02, 0.02), crossed)
        let light = filmLinear((0.7, 0.7, 0.7), crossed)
        XCTAssertGreaterThan(dark.2, dark.0)
        XCTAssertGreaterThan(light.0, light.2)
    }

    func testInhibitionPullsASaturatedPrimaryTowardNeutralAndLeavesAGreyAlone() {
        let red: RGB = (0.6, 0.05, 0.05)
        let plain = filmLinear(red, neutral())
        let inhibited = filmLinear(red, neutral { $0.inhibition = 100 })
        XCTAssertLessThan(chroma(inhibited), chroma(plain) * 0.8)
        let grey = filmLinear((0.3, 0.3, 0.3), neutral { $0.inhibition = 100 })
        XCTAssertLessThan(chroma(grey), 1e-9)
    }

    func testTheRolloffIsGracefulInhibitionTakesProportionallyMoreFromTheMoreSaturated() {
        let r = neutral { $0.inhibition = 100 }
        let mild: RGB = (0.25, 0.18, 0.18)
        let strong: RGB = (0.9, 0.05, 0.05)
        let mildLoss = 1 - chroma(filmLinear(mild, r)) / chroma(filmLinear(mild, neutral()))
        let strongLoss = 1 - chroma(filmLinear(strong, r)) / chroma(filmLinear(strong, neutral()))
        XCTAssertGreaterThan(strongLoss, mildLoss)
    }

    func testCouplingDesaturatesAPrimaryWithoutMovingAGrey() {
        let red: RGB = (0.5, 0.1, 0.1)
        XCTAssertLessThan(chroma(filmLinear(red, neutral { $0.coupling = 100 })), chroma(filmLinear(red, neutral())))
        let g = filmLinear((0.4, 0.4, 0.4), neutral { $0.coupling = 100 })
        XCTAssertLessThan(chroma(g), 1e-9)
    }

    func testThePrintStageRaisesContrastWithThePaperGradeAndKeepsMidGrey() {
        let soft = neutral { $0.print = true; $0.paperGrade = 0 }
        let hard = neutral { $0.print = true; $0.paperGrade = 5 }
        let mid = filmLinear((midGrey, midGrey, midGrey), hard)
        assertClose(mid.1, midGrey, 6)
        func range(_ r: FilmResponse) -> Double {
            lum(filmLinear((0.4, 0.4, 0.4), r)) / lum(filmLinear((0.08, 0.08, 0.08), r))
        }
        XCTAssertGreaterThan(range(hard), range(soft))
    }

    func testDyeScalesSaturationAroundLuminance() {
        let p: RGB = (0.3, 0.2, 0.1)
        let more = filmLinear(p, neutral { $0.dye = 60 })
        let less = filmLinear(p, neutral { $0.dye = -60 })
        XCTAssertGreaterThan(chroma(more), chroma(less))
        assertClose(lum(more), lum(less), 6)
    }

    func testAMonochromeStockCollapsesToOneValueWeightedBySensitivityTimesFilter() {
        let ortho = neutral { $0.mono = FilmMono(sensitivity: (0.1, 0.6, 0.3), filter: (1, 1, 1)) }
        let out = filmLinear((0.8, 0.2, 0.1), ortho)
        assertClose(out.0, out.1, 9)
        assertClose(out.1, out.2, 9)
        // A red filter over a panchromatic layer renders a red brighter than a blue.
        let redFilter = neutral { $0.mono = FilmMono(sensitivity: (0.33, 0.34, 0.33), filter: (1, 0.3, 0.1)) }
        XCTAssertGreaterThan(lum(filmLinear((0.5, 0.05, 0.05), redFilter)), lum(filmLinear((0.05, 0.05, 0.5), redFilter)))
        // And a grey sees no filter at all — the weights are normalised, so it
        // renders exactly as the same curves render it in colour.
        let g = filmLinear((0.3, 0.3, 0.3), redFilter)
        assertClose(g.0, filmLinear((0.3, 0.3, 0.3), neutral()).0, 9)
    }
}

final class FilmRespondStopsTests: XCTestCase {
    func testIsTheCurveOnEachChannelWhenNothingElseIsSet() {
        let r = neutral { $0.curve = FilmCurveSet(r: curve { $0.gamma = 1.5 }, g: curve(), b: curve()) }
        let out = respondStops((1, 1, 1), r)
        assertClose(out.0, makeCurve(r.curve.r)(1), 9)
        assertClose(out.1, makeCurve(r.curve.g)(1), 9)
    }
}

final class FilmStageAndCubeTests: XCTestCase {
    func testMapsCodesToCodesInZeroOneMidGreyWithinOne8BitCode() {
        let stage = filmStage(neutral { $0.coupling = 20; $0.inhibition = 30; $0.print = true })
        let mid = stage(midCode, midCode, midCode)
        XCTAssertLessThan(abs(codes(mid.1) - codes(midCode)), 1)
        for v in [0, 0.001, 0.5, 0.999, 1] {
            let out = stage(v, v, v)
            for c in [out.0, out.1, out.2] {
                XCTAssertGreaterThanOrEqual(c, 0)
                XCTAssertLessThanOrEqual(c, 1)
            }
        }
    }

    func testAgreesWithFilmLinearThroughTheSRGBPair() {
        let r = neutral { $0.dye = 30 }
        let stage = filmStage(r)
        let out = stage(0.2, 0.5, 0.7)
        let lin = filmLinear((toLinear(0.2, .srgb), toLinear(0.5, .srgb), toLinear(0.7, .srgb)), r)
        assertClose(out.0, fromLinear(lin.0, .srgb), 9)
    }

    func testBakesACubeInCubeOrderWithTheRequestedSize() {
        let settings = FilmSettings(stock: "test", response: neutral())
        let cube = filmCube(settings, size: 5, title: "Test stock")
        XCTAssertEqual(cube.size, 5)
        XCTAssertEqual(cube.data.count, 5 * 5 * 5 * 3)
        XCTAssertEqual(cube.title, "Test stock")
        XCTAssertTrue(cube.domainMax == (1, 1, 1))
        // Red varies fastest: the second entry is (1/4, 0, 0) through the stage.
        let stage = filmStage(neutral())
        let r = stage(0.25, 0, 0).0
        assertClose(Double(cube.data[3]), r, 6)
        // The last lattice point is white through the same stage — near white
        // under the neutral curve's far shoulder, never the identity.
        assertClose(Double(cube.data[cube.data.count - 1]), stage(1, 1, 1).2, 6)
        XCTAssertGreaterThan(cube.data[cube.data.count - 1], 0.98)
    }

    func testThePrintStageHandsACleanWhiteBackAtEveryGrade() {
        for paperGrade in [0.0, 2, 5] {
            let stage = filmStage(neutral { $0.print = true; $0.paperGrade = paperGrade })
            XCTAssertGreaterThan(stage(1, 1, 1).1, 0.995)
        }
    }
}

final class FilmSettingsReadWriteTests: XCTestCase {
    func testRoundTripsThroughTheLayerTextInCanonicalOrder() {
        let s = FilmSettings(
            stock: "reversal-vivid",
            response: neutral {
                $0.coupling = 12
                $0.curve = FilmCurveSet(r: curve { $0.gamma = 1.2 }, g: curve(), b: curve { $0.black = 5 })
                $0.mono = FilmMono(sensitivity: (0.2, 0.7, 0.1), filter: (1, 0.8, 0.5))
            }
        )
        let back = readFilmSettings(writeFilmSettings(s))
        XCTAssertEqual(back, s)
        XCTAssertEqual(filmSettingsKey(back!), filmSettingsKey(s))
    }

    func testTwoEqualSettingsWrittenFromDifferentKeyOrdersShareOneKey() {
        let a = FilmSettings(stock: "x", response: neutral())
        // `JSONValue.serialized` sorts its keys — a different order from the
        // canonical text, as the web's shuffled literal is.
        let shuffled = JSONValue.object(["response": neutral().json, "stock": "x"]).serialized()
        XCTAssertNotEqual(shuffled, writeFilmSettings(a))
        XCTAssertEqual(filmSettingsKey(readFilmSettings(shuffled)!), filmSettingsKey(a))
    }

    func testRefusesTextThatIsNotFilmSettings() {
        XCTAssertNil(readFilmSettings(nil))
        XCTAssertNil(readFilmSettings(""))
        XCTAssertNil(readFilmSettings("TITLE \"x\"\nLUT_3D_SIZE 2"))
        XCTAssertNil(readFilmSettings("{\"stock\":\"a\"}"))
        XCTAssertNil(readFilmSettings("[1,2]"))
    }

    func testClampsEveryNumberAndFallsBackToNeutralOnJunk() {
        let r = normaliseResponse([
            "coupling": 400,
            "inhibition": "many",
            "curve": ["r": ["gamma": 99, "toe": -1], "g": .null],
            "print": "yes",
            "paperGrade": .number(.nan),
            "dye": -1e9,
            "mono": ["sensitivity": [1, 2], "filter": "red"],
        ])
        XCTAssertEqual(r.coupling, 100)
        XCTAssertEqual(r.inhibition, 0)
        XCTAssertEqual(r.curve.r.gamma, curveRanges[.gamma]!.max)
        XCTAssertEqual(r.curve.r.toe, curveRanges[.toe]!.min)
        XCTAssertEqual(r.curve.g, neutralCurve)
        XCTAssertEqual(r.curve.b, neutralCurve)
        XCTAssertFalse(r.print)
        XCTAssertEqual(r.paperGrade, 2)
        XCTAssertEqual(r.dye, -100)
        let filter = r.mono?.filter
        XCTAssertNotNil(filter)
        XCTAssertTrue(filter! == (1, 1, 1))
    }

    func testSameResponseComparesTheNumbersNotTheStockName() {
        XCTAssertTrue(sameResponse(neutral(), neutral()))
        XCTAssertFalse(sameResponse(neutral(), neutral { $0.dye = 1 }))
    }

    /// The text is the web's `JSON.stringify(canonical(s))` byte for byte —
    /// keys in ITS order, whole numbers without `.0`, `null` for no mono.
    func testWritesTheWebsCanonicalTextByteForByte() {
        let s = FilmSettings(stock: "x", response: neutral { $0.dye = -5; $0.paperGrade = 2.5 })
        let curveText = "{\"speed\":0,\"gamma\":1,\"toe\":0.5,\"shoulder\":0.5,\"black\":6,\"white\":4}"
        let expected = "{\"stock\":\"x\",\"response\":{\"coupling\":0,\"inhibition\":0,\"curve\":{\"r\":\(curveText),\"g\":\(curveText),\"b\":\(curveText)},\"print\":false,\"paperGrade\":2.5,\"dye\":-5,\"mono\":null}}"
        XCTAssertEqual(writeFilmSettings(s), expected)
        let mono = FilmSettings(stock: "m", response: neutral { $0.mono = FilmMono(sensitivity: (0.3, 0.45, 0.25), filter: (1, 0.55, 0.2)) })
        XCTAssertTrue(writeFilmSettings(mono).hasSuffix("\"mono\":{\"sensitivity\":[0.3,0.45,0.25],\"filter\":[1,0.55,0.2]}}}"))
    }
}
