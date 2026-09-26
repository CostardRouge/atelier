// Port of `src/shared/render/camera-warp.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let W = 8064.0
private let H = 4536.0

private func plane(_ k0: Double, _ k1: Double = 0, _ k2: Double = 0, _ k3: Double = 0,
                   _ t0: Double = 0, _ t1: Double = 0) -> DngWarpPlane {
    DngWarpPlane(radial: [k0, k1, k2, k3], tangential: [t0, t1])
}

/// The DJI's own: a 4.93 % magnification, red and blue a hair apart.
private let dji = DngWarp(planes: [plane(1.0495), plane(1.0493), plane(1.0491)], centerH: 0.5, centerV: 0.5)

final class WarpRatioTests: XCTestCase {
    func testAgreesWithLensSampleRadiusWhereverTheSlidersCanReach() {
        for (k1, k2) in [(0.0, 0.0), (-0.18, -0.06), (0.1, 0.02)] {
            var r = 0.0
            while r <= 1.0001 {
                assertClose(r * warpRatio(r, [1, k1, k2, 0]), lensSampleRadius(r, k1, k2), 12)
                r += 0.05
            }
        }
    }

    func testAddsTheTwoTermsTheSlidersDoNotOfferAMagnificationAndR6() {
        assertClose(warpRatio(1, [1.05, 0, 0, 0]), 1.05, 12)
        assertClose(warpRatio(1, [1, 0, 0, 0.2]), 1.2, 12)
        assertClose(warpRatio(0, [1.05, 9, 9, 9]), 1.05, 12)
    }
}

final class WarpNormRadiusTests: XCTestCase {
    func testIsTheDistanceToTheFarthestCornerWhichIsHalfTheDiagonalWhenCentred() {
        assertClose(warpNormRadius(dji, W, H), (W * W + H * H).squareRoot() / 2, 6)
        // Off-centre, it is the far corner and not the near one.
        var off = dji
        off.centerH = 0.25
        off.centerV = 0.25
        let far = ((0.75 * W) * (0.75 * W) + (0.75 * H) * (0.75 * H)).squareRoot()
        assertClose(warpNormRadius(off, W, H), far, 6)
    }
}

final class WarpSourcePointTests: XCTestCase {
    func testLeavesTheOpticalCentreAloneWhateverTheCoefficients() {
        let (x, y) = warpSourcePoint(0, 0, plane(1.05, 3, 2, 1))
        XCTAssertEqual([x, y], [0, 0])
    }

    func testIsAPureScaleWhenOnlyK0IsSetTheDjiCase() {
        let (x, y) = warpSourcePoint(0.6, -0.4, plane(1.0493))
        assertClose(x, 0.6 * 1.0493, 12)
        assertClose(y, -0.4 * 1.0493, 12)
    }

    func testCarriesTheTangentialTermsRatherThanDroppingThem() {
        let (x, y) = warpSourcePoint(0.5, 0.25, plane(1, 0, 0, 0, 0.01, 0.02))
        // r² = 0.3125; x: 1·0.5 + 0.01(0.3125 + 2·0.25) + 2·0.02·0.125
        assertClose(x, 0.5 + 0.01 * 0.8125 + 0.04 * 0.125, 12)
        assertClose(y, 0.25 + 0.02 * (0.3125 + 2 * 0.0625) + 0.02 * 0.125, 12)
    }
}

final class WarpSourceUvTests: XCTestCase {
    func testMagnifiesAboutTheCentreACorrectedCornerComesFromFurtherOut() {
        let (u, v) = warpSourceUv(dji, 1, 1, 1, W, H)
        // 4.93 % past the corner, so the corrected picture is the middle 95 % of
        // the frame — which is what a magnification means.
        assertClose(u, 0.5 + 0.5 * 1.0493, 6)
        assertClose(v, 0.5 + 0.5 * 1.0493, 6)
        let (cu, cv) = warpSourceUv(dji, 1, 0.5, 0.5, W, H)
        XCTAssertEqual([cu, cv], [0.5, 0.5])
    }

    func testGivesEachPlaneItsOwnPositionTheLateralCaOfTheFile() {
        let (ur, _) = warpSourceUv(dji, 0, 1, 1, W, H)
        let (ug, _) = warpSourceUv(dji, 1, 1, 1, W, H)
        // `not.toBeCloseTo(ug, 8)`.
        XCTAssertGreaterThanOrEqual(abs(ur - ug), pow(10, -8) / 2)
        // A one-plane warp answers for all three.
        let one = DngWarp(planes: [plane(1.02)], centerH: 0.5, centerV: 0.5)
        XCTAssertEqual(planeOf(one, 2).radial[0], 1.02)
        let a = warpSourceUv(one, 2, 1, 1, W, H)
        let b = warpSourceUv(one, 0, 1, 1, W, H)
        XCTAssertEqual([a.0, a.1], [b.0, b.1])
    }
}

final class DescribeWarpTests: XCTestCase {
    func testSaysTheMagnificationAndTheFringeItTakesOff() {
        XCTAssertTrue(describeWarp(dji, W, H).hasPrefix("×1.049"), describeWarp(dji, W, H))
        let caLine = describeWarp(dji, W, H).range(of: #"CA \d+\.\d px at the corner"#, options: .regularExpression)
        XCTAssertNotNil(caLine, describeWarp(dji, W, H))
        XCTAssertEqual(describeWarp(nil), "")
    }
}

/// Not in the web's spec — pins `sameWarp`, which the renderer's cache key rests on.
final class SameWarpTests: XCTestCase {
    func testComparesByValueAndReadsAbsentAsTheIdentity() {
        XCTAssertTrue(sameWarp(dji, dji))
        XCTAssertTrue(sameWarp(nil, nil))
        XCTAssertTrue(sameWarp(nil, DngWarp(planes: [plane(1)], centerH: 0.5, centerV: 0.5)))
        XCTAssertFalse(sameWarp(nil, dji))
        var moved = dji
        moved.centerH = 0.51
        XCTAssertFalse(sameWarp(dji, moved))
        var bent = dji
        bent.planes[1].radial[1] = 0.01
        XCTAssertFalse(sameWarp(dji, bent))
    }
}
