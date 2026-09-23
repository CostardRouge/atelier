// Port of `src/shared/develop/curves.test.ts`. The clone specs are not ported:
// a Swift struct copies by value, which is the guarantee they pinned.

import XCTest
@testable import AtelierKit

final class MakeCurveTests: XCTestCase {
    func testPassesExactlyThroughEveryControlPoint() {
        let f = makeCurve(sCurve)
        for p in sCurve { assertClose(f(p.x), p.y, 12) }
    }

    func testHoldsTheEndValuesOutsideTheSpan() {
        let f = makeCurve([CurvePoint(x: 0.2, y: 0.3), CurvePoint(x: 0.8, y: 0.6)])
        XCTAssertEqual(f(0), 0.3)
        XCTAssertEqual(f(0.1), 0.3)
        XCTAssertEqual(f(1), 0.6)
    }

    func testNeverTurnsBackOnTheShapeThatMakesANaturalCubicOvershoot() {
        // The whole reason for the Fritsch–Carlson tangent clamp.
        for curve in [sCurve, cliffCurve] {
            let f = makeCurve(curve)
            var previous = -Double.infinity
            for x in samples() {
                let y = f(x)
                XCTAssertGreaterThanOrEqual(y, previous - 1e-12)
                previous = y
            }
        }
    }

    func testNeverLeavesTheUnitRangeNorTheBandItsNeighboursSet() {
        let f = makeCurve(cliffCurve)
        for x in samples() {
            let y = f(x)
            XCTAssertGreaterThanOrEqual(y, 0)
            XCTAssertLessThanOrEqual(y, 1)
        }
        for t in samples(101) {
            let x = 0.45 + t * 0.1
            XCTAssertGreaterThanOrEqual(f(x), 0.02 - 1e-12)
            XCTAssertLessThanOrEqual(f(x), 0.98 + 1e-12)
        }
    }

    func testIsTheStraightLineWhenEveryPointSitsOnIt() {
        let f = makeCurve([CurvePoint(x: 0, y: 0), CurvePoint(x: 0.3, y: 0.3), CurvePoint(x: 1, y: 1)])
        for x in samples(201) { assertClose(f(x), x, 12) }
    }

    func testDrawsAFlatRunAsFlatNotAsAWobble() {
        let f = makeCurve([CurvePoint(x: 0, y: 0.5), CurvePoint(x: 0.5, y: 0.5), CurvePoint(x: 1, y: 1)])
        for t in samples(101) { assertClose(f(t * 0.5), 0.5, 12) }
    }

    func testFewerThanTwoPointsIsTheLine() {
        let f = makeCurve([CurvePoint(x: 0.3, y: 0.9)])
        XCTAssertEqual(f(0.25), 0.25)
        XCTAssertEqual(makeCurve([])(0.7), 0.7)
    }
}

final class NormaliseCurveTests: XCTestCase {
    func testReadsAMissingShortOrDiagonalCurveAsDoingNothing() {
        XCTAssertTrue(isIdentityCurve(nil))
        XCTAssertTrue(isIdentityCurve([CurvePoint(x: 0, y: 0)]))
        XCTAssertTrue(isIdentityCurve(identityCurve()))
        XCTAssertFalse(isIdentityCurve(sCurve))
    }

    func testSortsClampsAndDropsWhatNoSplineCanDraw() {
        let raw: JSONValue = [
            ["x": 0.8, "y": 0.9],
            ["x": 0.8, "y": 0.1], // a second point at the same x is a vertical jump
            ["x": -1, "y": 2], // clamped to (0,1)
            ["x": 0.4, "y": "x"], // junk
            ["x": .number(.nan), "y": 0.5],
            "nonsense",
        ]
        XCTAssertEqual(normaliseCurve(raw), [CurvePoint(x: 0, y: 1), CurvePoint(x: 0.8, y: 0.9)])
    }

    func testAnswersNilForANonArrayForFewerThanTwoPointsAndForTheIdentity() {
        XCTAssertNil(normaliseCurve(nil))
        XCTAssertNil(normaliseCurve("curve"))
        XCTAssertNil(normaliseCurve([["x": 0.5, "y": 0.5]]))
        XCTAssertNil(normaliseCurve(curveJSON(identityCurve())))
    }

    func testCapsThePointCountSoAJunkFileCannotMakeEveryBakeCrawl() {
        let many: JSONValue = .array((0..<500).map { i in
            let x = Double(i) / 499
            return .object(["x": .number(x), "y": .number(x * x)])
        })
        XCTAssertEqual(normaliseCurve(many)?.count, curveMaxPoints)
    }

    func testNormaliseCurvesFillsEveryChannelAndCurvesOrNullStoresNothingForNone() {
        XCTAssertEqual(normaliseCurves(nil), ToneCurves())
        XCTAssertTrue(isDefaultCurves(normaliseCurves(["luma": curveJSON(identityCurve())])))
        XCTAssertNil(curvesOrNull(["luma": curveJSON(identityCurve())]))
        XCTAssertNil(curvesOrNull(nil))
        XCTAssertEqual(curvesOrNull(["red": curveJSON(sCurve)])?.red, sCurve)
    }
}

final class LevelsTests: XCTestCase {
    func testMapsTheInputRangeOntoTheOutputRange() {
        let f = makeLevel(LevelChannel(inBlack: 0.2, inWhite: 0.8))
        assertClose(f(0.2), 0, 12)
        assertClose(f(0.8), 1, 12)
        assertClose(f(0.5), 0.5, 12)
        XCTAssertEqual(f(0), 0) // below the black point is black, not negative
        XCTAssertEqual(f(1), 1)
    }

    func testLiftsTheMidtonesAboveGammaOneAndSinksThemBelowEndsFixed() {
        let up = makeLevel(LevelChannel(gamma: 2))
        let down = makeLevel(LevelChannel(gamma: 0.5))
        XCTAssertGreaterThan(up(0.5), 0.5)
        XCTAssertLessThan(down(0.5), 0.5)
        for f in [up, down] {
            assertClose(f(0), 0, 12)
            assertClose(f(1), 1, 12)
        }
    }

    func testWritesIntoANarrowedOutputRange() {
        let f = makeLevel(LevelChannel(outBlack: 0.1, outWhite: 0.9))
        assertClose(f(0), 0.1, 12)
        assertClose(f(1), 0.9, 12)
    }

    func testRefusesAnEmptyOrInvertedInputRange() {
        XCTAssertNil(normaliseLevel(["inBlack": 0.8, "inWhite": 0.2]))
        XCTAssertNil(normaliseLevel(["inBlack": 0.5, "inWhite": 0.5]))
        // A non-finite field falls back to its own default, the record's rule.
        XCTAssertEqual(normaliseLevel(["inBlack": 0.5, "inWhite": .number(.nan)]),
                       LevelChannel(inBlack: 0.5, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1))
        // Any POSITIVE span is a range and is kept, however narrow.
        XCTAssertNotNil(normaliseLevel(["inBlack": 0.5, "inWhite": .number(0.5 + 1 / 255)]))
        let steep = makeLevel(normaliseLevel(["inBlack": 0.5, "inWhite": .number(0.5 + 1e-9)])!)
        XCTAssertEqual(steep(0.4), 0)
        XCTAssertEqual(steep(0.6), 1)
    }

    func testClampsGammaAndReadsANeutralChannelAsNothing() {
        XCTAssertEqual(normaliseLevel(["gamma": 1e9])?.gamma, 10)
        XCTAssertEqual(normaliseLevel(["gamma": 0])?.gamma, 0.1)
        XCTAssertNil(normaliseLevel([:]))
        XCTAssertNil(normaliseLevel(["inBlack": 0, "inWhite": 1, "gamma": 1]))
        XCTAssertTrue(isNeutralLevel(nil))
        XCTAssertTrue(isDefaultLevels(normaliseLevels(["red": [:]])))
        XCTAssertEqual(levelsOrNull(["red": ["gamma": 2]])?.red?.gamma, 2)
        XCTAssertNil(levelsOrNull(["red": [:]]))
    }
}

final class ShaperTests: XCTestCase {
    func testAnswerNilWhenNothingShapes() {
        XCTAssertNil(makeLumaShaper(nil))
        XCTAssertNil(makeLumaShaper(ToneCurves(luma: identityCurve(), rgb: sCurve)))
        XCTAssertNil(makeChannelShaper(nil, nil))
        // The luma curve is NOT a channel shape: it rides the ratio instead.
        XCTAssertNil(makeChannelShaper(ToneCurves(luma: sCurve), nil))
    }

    func testTouchesOnlyTheChannelItWasGiven() {
        let shape = makeChannelShaper(ToneCurves(red: sCurve), nil)!
        assertClose(shape(0.25, 0), makeCurve(sCurve)(0.25), 12)
        XCTAssertEqual(shape(0.25, 1), 0.25)
        XCTAssertEqual(shape(0.25, 2), 0.25)
    }

    func testAppliesLevelsBeforeCurvesMasterBeforeTheChannel() {
        let levels = Levels(rgb: LevelChannel(gamma: 2))
        let curves = ToneCurves(rgb: sCurve)
        let shape = makeChannelShaper(curves, levels)!
        let expected = makeCurve(sCurve)(makeLevel(levels.rgb!)(0.4))
        assertClose(shape(0.4, 0), expected, 12)
        // The other order would give a different number, so this really pins it.
        XCTAssertNotEqual(makeLevel(levels.rgb!)(makeCurve(sCurve)(0.4)), expected, accuracy: 0.5e-6)
    }

    func testRunsTheMasterCurveOnEveryChannelAndTheChannelCurveOnTop() {
        let shape = makeChannelShaper(ToneCurves(rgb: sCurve, red: cliffCurve), nil)!
        let master = makeCurve(sCurve)
        assertClose(shape(0.6, 1), master(0.6), 12)
        assertClose(shape(0.6, 0), makeCurve(cliffCurve)(master(0.6)), 12)
    }
}

final class CurveWordsTests: XCTestCase {
    func testComparesByValueNilAnIdentityAndANeutralAllReadTheSame() {
        XCTAssertTrue(sameCurves(nil, ToneCurves(luma: identityCurve())))
        XCTAssertFalse(sameCurves(ToneCurves(luma: sCurve), nil))
        XCTAssertTrue(sameCurves(ToneCurves(luma: sCurve), ToneCurves(luma: sCurve)))
        XCTAssertTrue(sameLevels(nil, normaliseLevels(["red": [:]])))
        XCTAssertFalse(sameLevels(nil, levelsOrNull(["red": ["gamma": 2]])))
    }

    func testNamesTheChannelsItTouchesAndSaysNothingWhenItTouchesNone() {
        XCTAssertEqual(describeCurves(nil), "")
        XCTAssertEqual(describeCurves(ToneCurves(luma: sCurve, red: cliffCurve)), "curve luma+red")
        XCTAssertEqual(describeLevels(nil), "")
        XCTAssertEqual(describeLevels(levelsOrNull(["rgb": ["gamma": 2], "blue": ["inBlack": 0.1]])), "levels rgb+blue")
    }
}
