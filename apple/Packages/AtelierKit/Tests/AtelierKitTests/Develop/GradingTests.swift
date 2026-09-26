// Port of `src/shared/develop/grading.test.ts`, case for case.

import XCTest
@testable import AtelierKit

private func Y(_ p: RGB) -> Double { 0.2126 * p.0 + 0.7152 * p.1 + 0.0722 * p.2 }

private func grey(_ code: Double) -> RGB {
    let v = toLinear(code / 255, .srgb)
    return (v, v, v)
}

private func tinted(_ zone: GradeZone, _ hue: Double, _ saturation: Double, _ luminance: Double = 0) -> ColourGrading {
    withWheel(nil, zone, GradeWheel(hue: hue, saturation: saturation, luminance: luminance))!
}

final class ZoneWeightsTests: XCTestCase {
    func testSumsToOneEverywhereWithShadowsAtBlackHighlightsAtWhiteMidtonesAtThePivot() {
        for (blending, balance) in [(50.0, 0.0), (0, 40), (100, -60)] {
            var L = 0.0
            while L <= 1 {
                let w = zoneWeights(L, blending: blending, balance: balance)
                assertClose(w.shadows + w.midtones + w.highlights, 1, 12)
                XCTAssertGreaterThanOrEqual(min(w.shadows, w.midtones, w.highlights), 0)
                L += 0.05
            }
        }
        XCTAssertEqual(zoneWeights(0).shadows, 1)
        XCTAssertEqual(zoneWeights(1).highlights, 1)
        XCTAssertEqual(zoneWeights(0.5).midtones, 1)
    }

    func testGivesTheHighlightsMoreOfTheRangeAtAPositiveBalanceAndReachesFurtherAtAHighBlending() {
        XCTAssertGreaterThan(zoneWeights(0.45, blending: 50, balance: 80).highlights, 0)
        XCTAssertEqual(zoneWeights(0.45, blending: 50, balance: 0).highlights, 0)
        XCTAssertGreaterThan(zoneWeights(0.3, blending: 100).shadows, zoneWeights(0.3, blending: 0).shadows)
    }
}

final class GradeLinearTests: XCTestCase {
    func testTintsWithoutBrighteningAGreyTakesTheHueAtItsOwnLuminance() {
        let mid = grey(128)
        let out = gradeLinear(mid, tinted(.global, 30, 100))
        assertClose(Y(out), Y(mid), 12)
        XCTAssertGreaterThan(out.0, out.2)
    }

    func testColoursTheShadowsAndLeavesTheHighlightsAndTheOtherWayRound() {
        let cool = tinted(.shadows, 220, 80)
        let dark = gradeLinear(grey(40), cool)
        XCTAssertGreaterThan(dark.2, dark.0)
        let light = gradeLinear(grey(250), cool)
        assertClose(light.2, light.0, 6)
        let warm = tinted(.highlights, 40, 80)
        assertClose(gradeLinear(grey(10), warm).0, grey(10).0, 6)
    }

    func testMovesTheLightOnlyWithTheLuminanceSliderBlackStayingBlack() {
        let lifted = gradeLinear(grey(60), tinted(.shadows, 0, 0, 100))
        XCTAssertGreaterThan(Y(lifted), Y(grey(60)))
        assertExact(gradeLinear((0, 0, 0), tinted(.shadows, 0, 0, 100)), (0, 0, 0))
    }

    func testIsTheIdentityOnAnythingANeutralGradingHolds() {
        let px: RGB = (0.2, 0.4, 0.1)
        assertExact(gradeLinear(px, neutralGrading()), px)
    }

    func testBuildsEachHueGainAtLuminanceExactlyOne() {
        for h in [0.0, 45, 120, 200, 300] {
            assertClose(Y(hueGain(h)), 1, 12)
        }
    }
}

final class GradeWheelTests: XCTestCase {
    func testReadsAPointAsHueAndSaturationAndPutsItBack() {
        let right = wheelPoint(1, 0)
        XCTAssertEqual(right.hue, 0)
        XCTAssertEqual(right.saturation, 100)
        let down = wheelPoint(0, 0.5)
        XCTAssertEqual(down.hue, 90)
        XCTAssertEqual(down.saturation, 50)
        XCTAssertEqual(wheelPoint(-3, 0).saturation, 100)
        let p = pointOnWheel(210, 40)
        let back = wheelPoint(p.x, p.y)
        XCTAssertEqual(back.hue, 210)
        XCTAssertEqual(back.saturation, 40)
    }
}

final class GradingRecordTests: XCTestCase {
    func testReadsBackSafelyAndSaysNoneForANeutralOrJunkGrading() {
        XCTAssertNil(gradingOrNull(["blending": 80]))
        let g = gradingOrNull(["shadows": ["hue": 400, "saturation": 250, "luminance": -500], "balance": "x"])
        XCTAssertEqual(g?.shadows, GradeWheel(hue: 40, saturation: 100, luminance: -100))
        XCTAssertEqual(g?.blending, 50)
        XCTAssertEqual(g?.balance, 0)
        XCTAssertNil(gradingOrNull(nil))
        XCTAssertNil(gradingOrNull("junk"))
    }

    func testKeepsBlendingAndBalanceWhileNoWheelMovesAndDropsAWheelSetBackToNothing() {
        XCTAssertEqual(withShape(nil, .balance, 30).balance, 30)
        let g = tinted(.midtones, 100, 20)
        XCTAssertNil(withWheel(g, .midtones, GradeWheel(hue: 100, saturation: 0, luminance: 0)))
        XCTAssertTrue(isDefaultGrading(withShape(nil, .blending, 10)))
    }

    func testIsPartOfWhatADevelopIsAndReachesTheBake() {
        let d = dev { $0.grading = tinted(.shadows, 200, 50) }
        XCTAssertNotNil(developOrNull(d.json))
        XCTAssertFalse(isDefaultDevelop(d))
        let c = cloneDevelop(d)
        XCTAssertEqual(c.grading, d.grading)
        XCTAssertTrue(sameDevelop(c, d))
        XCTAssertFalse(sameDevelop(d, .default))
        XCTAssertEqual(describeDevelop(d), "grading shadows")
        var mixed = tinted(.global, 0, 10)
        mixed.highlights = GradeWheel(hue: 0, saturation: 0, luminance: 20)
        XCTAssertEqual(describeGrading(mixed), "grading highlights+global")
        let out = developStage(d)(0.15, 0.15, 0.15)
        XCTAssertGreaterThan(out.2, out.0)
        // The typed field reads what the web wrote, and writes what the web reads.
        let back = normaliseDevelop(JSONValue.parse(d.json.serialized()))
        XCTAssertEqual(back.grading, d.grading)
        XCTAssertEqual(back, d)
        XCTAssertEqual(d.json.objectValue?["grading"]?.objectValue?["blending"], 50)
        // A shape with no wheel coloured does not survive the record, as it does not survive a reload.
        XCTAssertEqual(dev { $0.grading = withShape(nil, .balance, 30) }.json.objectValue?["grading"], .null)
    }
}
