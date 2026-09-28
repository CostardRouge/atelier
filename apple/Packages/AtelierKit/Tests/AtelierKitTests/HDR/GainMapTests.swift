// Port of `src/shared/hdr/gain-map.test.ts`, plus a spec for the number
// formatter the HDR modules share (which has no web twin: it IS the web's
// `toFixed`, pinned against the browser's own answers).

import XCTest
@testable import AtelierKit

/// A `w × h` picture from a grey level per pixel, in linear light.
private func picture(_ w: Int, _ h: Int, _ fill: (Int, Int) -> Double) -> LinearPicture {
    var data = [Float](repeating: 0, count: w * h * 3)
    for y in 0..<h {
        for x in 0..<w {
            let v = Float(fill(x, y))
            let at = (y * w + x) * 3
            data[at] = v
            data[at + 1] = v
            data[at + 2] = v
        }
    }
    return LinearPicture(width: w, height: h, data: data)
}

final class LinearFromBytesTests: XCTestCase {
    func testDecodesSRGBBytesToLight0To0255To1128ToAbout0216() {
        let bytes: [UInt8] = [0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]
        let lin = linearFromBytes(bytes, width: 3, height: 1)
        XCTAssertEqual(lin.data[0], 0)
        assertClose(Double(lin.data[3]), 1, 6)
        assertClose(Double(lin.data[6]), 0.2158, 3)
    }
}

final class HdrRenditionTests: XCTestCase {
    func testKeepsTheSDRWhereItHadRoomAndTakesTheLiftedDarkerRenderWhereItClipped() throws {
        // SDR: a ramp that clips at 1 from x=6 on. The darker render (−2 stops)
        // holds the same ramp divided by 4, and past the clip it still rises.
        let sdr = picture(10, 1) { x, _ in min(1, Double(x) / 5) }
        let darker = picture(10, 1) { x, _ in (Double(x) / 5) / 4 }
        let hdr = try hdrRendition(sdr, darker, stops: 2)
        // Unclipped: identical to the SDR (the lifted darker render agrees).
        assertClose(Double(hdr.data[3 * 2]), 0.4, 6)
        // Clipped in the SDR at x=9: the sensor's own 1.8.
        assertClose(Double(hdr.data[3 * 9]), 1.8, 6)
        // Never darker than the SDR, even where the darker render lost something.
        let dim = picture(10, 1) { _, _ in 0 }
        assertClose(Double(try hdrRendition(sdr, dim, stops: 2).data[3 * 2]), 0.4, 6)
        XCTAssertThrowsError(try hdrRendition(sdr, picture(4, 1) { _, _ in 0 }, stops: 2))
    }
}

final class EncodeApplyGainMapTests: XCTestCase {
    func testRoundTripsTheSDRLiftedByTheMapAtFullCapacityIsTheHDRRendition() throws {
        let sdr = picture(16, 8) { x, _ in min(1, Double(x) / 10) }
        let hdr = picture(16, 8) { x, _ in Double(x) / 10 } // up to 1.5 → log2 ratio ≈ 0.58 at the far edge
        let map = try encodeGainMap(sdr, hdr)
        XCTAssertEqual(map.width, 16)
        XCTAssertEqual(map.meta.gainMapMin, 0)
        assertClose(map.meta.gainMapMax, log2((1.5 + 1.0 / 64) / (1 + 1.0 / 64)), 5)
        XCTAssertEqual(map.headroom, map.meta.gainMapMax)
        XCTAssertFalse(isFlatGainMap(map))
        // Where the two agree the code is 0; at the clipped edge it is 255.
        XCTAssertEqual(map.codes[3], 0)
        XCTAssertEqual(map.codes[15], 255)
        let back = applyGainMap(sdr, map, displayStops: map.meta.hdrCapacityMax)
        for x in 0..<16 {
            assertClose(Double(back.data[x * 3]), Double(hdr.data[x * 3]), 2)
        }
        // A display with no headroom shows the SDR untouched.
        let none = applyGainMap(sdr, map, displayStops: 0)
        for x in 0..<16 { assertClose(Double(none.data[x * 3]), Double(sdr.data[x * 3]), 6) }
        // Halfway: half the lift, in stops.
        let half = applyGainMap(sdr, map, displayStops: map.meta.hdrCapacityMax / 2)
        let o = 1.0 / 64
        let fullLift = (Double(hdr.data[15 * 3]) + o) / (Double(sdr.data[15 * 3]) + o)
        let halfLift = (Double(half.data[15 * 3]) + o) / (Double(sdr.data[15 * 3]) + o)
        assertClose(halfLift, fullLift.squareRoot(), 2)
    }

    func testIsFlatWhenTheTwoRenditionsAgreeAndNeverSaysANegativeLift() throws {
        let sdr = picture(8, 8) { x, _ in Double(x) / 8 }
        let same = try encodeGainMap(sdr, sdr)
        XCTAssertEqual(same.headroom, 0)
        XCTAssertTrue(isFlatGainMap(same))
        XCTAssertEqual(describeGainMap(same), "flat — nothing above white")
        let darker = try encodeGainMap(sdr, picture(8, 8) { x, _ in Double(x) / 16 })
        XCTAssertEqual(darker.headroom, 0)
        XCTAssertEqual(describeGainMap(headroom: 2.34), "up to 2.3 stops above white")
    }

    func testCapsTheLiftItWillSayAndKeepsTheMapAtAFractionOfThePictureOnRequest() throws {
        let sdr = picture(8, 8) { _, _ in 1 }
        let hdr = picture(8, 8) { _, _ in 100 }
        let map = try encodeGainMap(sdr, hdr, scale: 4, maxStops: 3)
        XCTAssertEqual(map.headroom, 3)
        XCTAssertEqual(map.width, 2)
        XCTAssertEqual(map.height, 2)
        XCTAssertEqual(map.codes.count, 4)
        XCTAssertEqual(map.codes[0], 255)
        // Applied back through the coarse map, every picture pixel is lifted 3 stops.
        let back = applyGainMap(sdr, map, displayStops: 3)
        assertClose(Double(back.data[0]), (1 + 1.0 / 64) * 8 - 1.0 / 64, 4)
    }

    func testDownscalesByBoxAverageAndLeavesAFactorOf1Alone() {
        let values: [Float] = [0, 2, 4, 6, 1, 3, 5, 7]
        let small = downscaleMap(values, width: 4, height: 2, factor: 2)
        XCTAssertEqual(small.width, 2)
        XCTAssertEqual(small.height, 1)
        XCTAssertEqual(small.values, [1.5, 5.5])
        XCTAssertEqual(downscaleMap(values, width: 4, height: 2, factor: 1).values, values)
    }
}

final class HdrNumberFormatTests: XCTestCase {
    func testWritesAnXmpNumberAsTheBrowserDoesPlainNoExponentNoTrailingZeros() {
        XCTAssertEqual(HdrNumberFormat.xmpNumber(2.25), "2.25")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(1.0 / 64), "0.015625")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(1), "1")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(0), "0")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(-0.0), "0")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(1e-9), "0")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(0.1 + 0.2), "0.3")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(-0.5), "-0.5")
        XCTAssertEqual(HdrNumberFormat.xmpNumber(0.5757166), "0.575717")
    }

    func testRoundsAnExactTieAwayFromZeroAsToFixedDoesAndEverythingElseExactly() {
        // 1/128 has exactly seven decimals ending in 5: the browser says 0.007813, printf 0.007812.
        XCTAssertEqual(HdrNumberFormat.toFixed(1.0 / 128, 6), "0.007813")
        XCTAssertEqual(HdrNumberFormat.toFixed(2.25, 1), "2.3")
        XCTAssertEqual(HdrNumberFormat.toFixed(-2.25, 1), "-2.3")
        XCTAssertEqual(HdrNumberFormat.toFixed(2.5, 0), "3")
        XCTAssertEqual(HdrNumberFormat.toFixed(3, 0), "3")
        XCTAssertEqual(HdrNumberFormat.toFixed(2.34, 1), "2.3")
        XCTAssertEqual(HdrNumberFormat.toFixed(0.583, 2), "0.58")
        // 1.005 sits below the tie in binary, so both the browser and this say 1.00.
        XCTAssertEqual(HdrNumberFormat.toFixed(1.005, 2), "1.00")
        XCTAssertEqual(HdrNumberFormat.toFixed(0.03, 2), "0.03")
    }
}
