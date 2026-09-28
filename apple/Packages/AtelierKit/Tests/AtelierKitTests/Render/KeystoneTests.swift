// Port of `src/shared/render/geometry.test.ts` (the keystone; the file is
// `Keystone.swift` here because a target cannot hold two `Geometry.swift`).

import XCTest
@testable import AtelierKit

private func key(_ change: (inout Keystone) -> Void) -> Keystone {
    var k = Keystone.default
    change(&k)
    return k
}

/// The four corners, in the normalised centred space.
private let corners: [(Double, Double)] = [
    (-0.5, -0.5),
    (0.5, -0.5),
    (-0.5, 0.5),
    (0.5, 0.5),
]

final class MatrixArithmeticTests: XCTestCase {
    func testMultipliesAndTheIdentityIsTheIdentity() {
        let m: Matrix3 = [2, 0, 1, 0, 3, -1, 0, 0, 1]
        XCTAssertEqual(multiplyMatrix3(.identity, m), m)
        XCTAssertEqual(multiplyMatrix3(m, .identity), m)
    }

    func testInvertsAndAMatrixThroughItsInverseIsThePointItStartedAt() {
        let m: Matrix3 = [1.2, 0.3, 0.05, -0.2, 0.9, -0.1, 0.15, 0.25, 1]
        guard let inv = invertMatrix3(m) else { return XCTFail("not invertible") }
        for (x, y) in corners + [(0, 0), (0.2, -0.35)] {
            guard let there = applyMatrix3(m, x, y), let back = applyMatrix3(inv, there.0, there.1) else { return XCTFail("bent past the horizon") }
            assertClose(back.0, x, 10)
            assertClose(back.1, y, 10)
        }
    }

    func testRefusesAMatrixThatCollapsesThePlaneRatherThanHandingBackInfinities() {
        XCTAssertNil(invertMatrix3([1, 2, 3, 2, 4, 6, 1, 1, 1])) // rows 1 and 2 parallel
        XCTAssertNil(invertMatrix3([0, 0, 0, 0, 0, 0, 0, 0, 0]))
    }

    func testReportsAPointBentPastTheHorizonAsNilNotAsAHugeNumber() {
        // w = 1 + 2x is zero at x = −0.5: the corner has gone through infinity.
        XCTAssertNil(applyMatrix3([1, 0, 0, 0, 1, 0, 2, 0, 1], -0.5, 0))
    }
}

final class KeystoneMatrixTests: XCTestCase {
    func testIsTheIdentityWhenNothingIsSetWhateverTheAspect() {
        for ar in [1.0, 1.5, 0.8] {
            let m = keystoneMatrix(.default, ar)
            for (x, y) in corners {
                guard let out = applyMatrix3(m, x, y) else { return XCTFail("bent past the horizon") }
                assertClose(out.0, x, 12)
                assertClose(out.1, y, 12)
            }
        }
    }

    func testHoldsTheCentreStillACorrectionPivotsOnTheMiddleOfTheFrame() {
        let cases = [
            key { $0.vertical = 80 },
            key { $0.horizontal = -60 },
            key { $0.rotation = 12 },
            key { $0.vertical = 40; $0.horizontal = 30; $0.rotation = -8; $0.aspect = 20; $0.scale = 1.4 },
        ]
        for k in cases {
            guard let out = applyMatrix3(keystoneMatrix(k, 1.5), 0, 0) else { return XCTFail("bent past the horizon") }
            assertClose(out.0, 0, 10)
            assertClose(out.1, 0, 10)
        }
    }

    func testWidensTheTopForAPositiveVerticalWhichIsWhatPointingUpNeedsUndone() {
        let m = keystoneMatrix(key { $0.vertical = 100 }, 1)
        guard let topLeft = applyMatrix3(m, -0.5, -0.5), let bottomLeft = applyMatrix3(m, -0.5, 0.5) else { return XCTFail("bent past the horizon") }
        // The top edge ends up wider than the bottom one.
        XCTAssertGreaterThan(abs(topLeft.0), abs(bottomLeft.0))
        // And the mirror for a negative one.
        let n = keystoneMatrix(key { $0.vertical = -100 }, 1)
        guard let nTop = applyMatrix3(n, -0.5, -0.5), let nBottom = applyMatrix3(n, -0.5, 0.5) else { return XCTFail("bent past the horizon") }
        XCTAssertLessThan(abs(nTop.0), abs(nBottom.0))
    }

    func testKeepsStraightLinesStraightThePropertyThatMakesItAHomography() {
        // Three collinear points stay collinear, which an arbitrary warp would
        // not manage and which is the whole reason a building comes out with
        // straight edges rather than bowed ones.
        let m = keystoneMatrix(key { $0.vertical = 70; $0.horizontal = -40; $0.rotation = 6 }, 1.5)
        func cross(_ a: (Double, Double), _ b: (Double, Double), _ c: (Double, Double)) -> Double {
            (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
        }
        for t in [0.25, 0.5, 0.75] {
            guard let a = applyMatrix3(m, -0.5, -0.4),
                  let c = applyMatrix3(m, 0.5, 0.3),
                  let mid = applyMatrix3(m, -0.5 + t, -0.4 + t * 0.7) else { return XCTFail("bent past the horizon") }
            XCTAssertLessThan(abs(cross(a, mid, c)), 1e-9)
        }
    }

    func testTurnsThePictureRatherThanShearingItAtAnyAspectRatio() {
        // A rotation in a non-square frame shears unless the matrix is
        // conjugated by the aspect — the angle between two perpendicular edges
        // must survive.
        let m = keystoneMatrix(key { $0.rotation = 30 }, 16.0 / 9)
        guard let o = applyMatrix3(m, 0, 0), let along = applyMatrix3(m, 0.1, 0), let across = applyMatrix3(m, 0, 0.1) else {
            return XCTFail("bent past the horizon")
        }
        // Measured in the SQUARE space the correction works in.
        let ar = 16.0 / 9
        let u = ((along.0 - o.0) * ar, along.1 - o.1)
        let w = ((across.0 - o.0) * ar, across.1 - o.1)
        assertClose(u.0 * w.0 + u.1 * w.1, 0, 9)
    }

    func testScaleZoomsInWhichIsHowTheCornersAWarpEmptiesAreHidden() {
        let m = keystoneMatrix(key { $0.scale = 2 }, 1)
        guard let out = applyMatrix3(m, 0.25, 0.25) else { return XCTFail("bent past the horizon") }
        assertClose(out.0, 0.5, 10)
    }

    func testTheSampleMatrixIsTheInverseBecauseAWarpWalksTheOutput() {
        let k = key { $0.vertical = 50; $0.rotation = -7; $0.scale = 1.2 }
        let forward = keystoneMatrix(k, 1.5)
        guard let sample = keystoneSampleMatrix(k, 1.5) else { return XCTFail("folded") }
        for (x, y) in corners {
            guard let there = applyMatrix3(forward, x, y), let back = applyMatrix3(sample, there.0, there.1) else { return XCTFail("bent past the horizon") }
            assertClose(back.0, x, 9)
            assertClose(back.1, y, 9)
        }
    }

    func testSurvivesTheStrongestNumbersTheSlidersAllowAtEveryAspect() {
        for ar in [0.5, 1, 1.78, 3] {
            for vertical in [-100.0, 100] {
                for horizontal in [-100.0, 100] {
                    let k = key { $0.vertical = vertical; $0.horizontal = horizontal; $0.rotation = 45; $0.aspect = 100; $0.scale = 3 }
                    let sample = keystoneSampleMatrix(k, ar)
                    XCTAssertNotNil(sample)
                    guard let sample else { continue }
                    // Every corner of the OUTPUT still maps somewhere finite.
                    for (x, y) in corners {
                        let at = applyMatrix3(sample, x, y)
                        XCTAssertNotNil(at)
                        guard let at else { continue }
                        XCTAssertTrue(at.0.isFinite)
                        XCTAssertTrue(at.1.isFinite)
                    }
                }
            }
        }
    }
}

final class KeystoneRecordTests: XCTestCase {
    func testReadsJunkAsNeutralAndClampsToTheSliders() {
        XCTAssertEqual(normaliseKeystone(nil), .default)
        XCTAssertEqual(normaliseKeystone(["vertical": "x", "rotation": .number(.nan)]), .default)
        XCTAssertEqual(normaliseKeystone(["vertical": 900]).vertical, 100)
        XCTAssertEqual(normaliseKeystone(["rotation": -900]).rotation, -45)
        XCTAssertEqual(normaliseKeystone(["scale": 0.1]).scale, 1)
        XCTAssertEqual(normaliseKeystone(["scale": 99]).scale, 3)
    }

    func testStoresNothingForAKeystoneThatDoesNothing() {
        XCTAssertNil(keystoneOrNull(nil))
        XCTAssertNil(keystoneOrNull([:]))
        XCTAssertNil(keystoneOrNull(["vertical": 0, "scale": 1]))
        XCTAssertEqual(keystoneOrNull(["vertical": 5])?.vertical, 5)
        XCTAssertTrue(isDefaultKeystone(nil as Keystone?))
    }

    func testComparesByValueNilAndNeutralAlike() {
        XCTAssertTrue(sameKeystone(nil, .default))
        XCTAssertTrue(sameKeystone(key { $0.vertical = 5 }, key { $0.vertical = 5 }))
        XCTAssertFalse(sameKeystone(key { $0.vertical = 5 }, nil))
    }

    func testSaysWhatItDoesInTheNumbersOnTheSliders() {
        XCTAssertEqual(describeKeystone(nil), "")
        XCTAssertEqual(describeKeystone(key { $0.vertical = 40; $0.rotation = -1.5 }), "vertical +40 · rotation −1.5°")
        XCTAssertEqual(describeKeystone(key { $0.scale = 1.25 }), "zoom 1.25×")
    }
}
