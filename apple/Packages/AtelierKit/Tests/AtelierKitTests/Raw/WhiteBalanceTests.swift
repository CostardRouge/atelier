// Port of `src/shared/raw/white-balance.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// XYZ → linear sRGB (D65): a "camera" that IS sRGB, so every number can be checked by hand.
private let xyzToSrgb = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057]
private let d65 = (x: 0.3127, y: 0.329)

private func srgbCamera(_ asShot: [Double]) -> RawWhite {
    RawWhite(asShot: asShot, camXyz: xyzToSrgb, rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1])
}

private func json(_ v: [Double]) -> JSONValue { .array(v.map { .number($0) }) }

final class WhiteBalanceLocusTests: XCTestCase {
    func testPuts6504KNearD65AndNamesD65BackAsAbout6500KOnTheGreenSide() {
        let (x, y) = planckianXy(6504)
        assertClose(x, 0.3135, 3)
        assertClose(y, 0.3237, 3)
        let named = xyToTempTint(d65.x, d65.y)
        XCTAssertGreaterThan(named.kelvin, 6400)
        XCTAssertLessThan(named.kelvin, 6600)
        XCTAssertGreaterThan(named.tint, 5)
        XCTAssertLessThan(named.tint, 15)
    }

    func testRoundTripsATemperatureAndTint() {
        for (k, t) in [(2850.0, 0.0), (5500, 10), (7500, -20), (4000, 30)] {
            let xy = tempTintToXy(k, t)
            let back = xyToTempTint(xy.x, xy.y)
            assertClose(back.kelvin, k, -1)
            assertClose(back.tint, t, 1)
        }
    }
}

final class WhiteBalanceCameraTests: XCTestCase {
    func testReadsAD65BalancedSrgbCameraAsShotAtAbout6500KAndNeedsNoCorrectionThere() {
        let white = srgbCamera([1, 1, 1])
        let shot = asShotTempTint(white)!
        assertClose(shot.kelvin, 6500, -2)
        let m = wbMatrix(white, shot.kelvin, shot.tint)!
        let out = apply3(m, (0.4, 0.4, 0.4))
        for c in [out.0, out.1, out.2] { assertClose(c, 0.4, 3) }
    }

    func testTurnsADaylightPictureBlueAtTungstenAndWarmerAtShadeLightroomsDirection() {
        let white = srgbCamera([1, 1, 1])
        let grey = (0.4, 0.4, 0.4)
        let tungsten = apply3(wbMatrix(white, 2850, 0)!, grey)
        XCTAssertGreaterThan(tungsten.2, tungsten.0 * 1.5)
        let shade = apply3(wbMatrix(white, 7500, 10)!, grey)
        XCTAssertGreaterThan(shade.0, shade.2)
    }

    func testTurnsItMagentaAtAHigherTint() {
        let white = srgbCamera([1, 1, 1])
        let (r, g, b) = apply3(wbMatrix(white, 6500, 60)!, (0.4, 0.4, 0.4))
        XCTAssertLessThan(g, min(r, b))
    }

    func testGivesTheMultipliersACameraNeedsWarmerLightLessRed() {
        let white = srgbCamera([1, 1, 1])
        let warm = multipliersFor(white, 3000, 0)!
        let cool = multipliersFor(white, 9000, 0)!
        XCTAssertLessThan(warm[0], cool[0])
        XCTAssertGreaterThan(warm[2], cool[2])
    }
}

final class WhiteBalanceReadAndStoredTests: XCTestCase {
    func testAcceptsLibRawsShapesAndRefusesJunk() {
        let white = rawWhiteOrNull([
            "camMul": [2, 1, 1.5, 1],
            "camXyz": [json(Array(xyzToSrgb[0..<3])), json(Array(xyzToSrgb[3..<6])), json(Array(xyzToSrgb[6..<9])), [0, 0, 0]],
            "rgbCam": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
        ])
        XCTAssertEqual(white?.asShot, [2, 1, 1.5])
        // A DNG: cam_xyz all zeros, recovered from rgb_cam and pre_mul — LibRaw's
        // own numbers for a synthetic tungsten-lit DNG with sRGB primaries.
        let dng = rawWhiteOrNull([
            "camMul": [0.4472271800041199, 1, 3.5868003368377686, 0],
            "preMul": [0.9999977350234985, 0.9999237656593323, 1.000165581703186, 0],
            "camXyz": [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
            "rgbCam": [[0.99995, 0, 0.00004, 0], [-0.0001, 1.0001, 0, 0], [0, 0, 1.00004, 0]],
        ])
        let shot = asShotTempTint(dng!)!
        XCTAssertGreaterThan(shot.kelvin, 2800)
        XCTAssertLessThan(shot.kelvin, 2900)
        XCTAssertLessThan(abs(shot.tint), 2)
        XCTAssertNil(rawWhiteOrNull(["camMul": [0, 1, 1, 1], "camXyz": [], "rgbCam": []]))
        XCTAssertNil(inverse3([1, 2, 3, 2, 4, 6, 0, 0, 1]))
    }

    func testReadsAStoredBalanceBackClampedAndRefusesOneWithNoMatrix() {
        XCTAssertEqual(
            rawWhiteBalanceOrNull(["kelvin": 99999, "tint": -400, "matrix": [1, 0, 0, 0, 1, 0, 0, 0, 1]]),
            RawWhiteBalance(kelvin: 50000, tint: -150, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1])
        )
        XCTAssertNil(rawWhiteBalanceOrNull(["kelvin": 5000]))
        XCTAssertEqual(describeWhiteBalance(RawWhiteBalance(kelvin: 5612.4, tint: -7.6, matrix: [])), "5612 K, tint −8")
    }
}
