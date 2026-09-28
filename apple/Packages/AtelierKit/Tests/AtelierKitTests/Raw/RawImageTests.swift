// Port of `src/shared/raw/raw-image.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func picture(_ w: Int, _ h: Int, _ fill: (Int, Int) -> (Double, Double, Double)) -> LinearRgb {
    var data = [Float](repeating: 0, count: w * h * 3)
    for y in 0..<h {
        for x in 0..<w {
            let (r, g, b) = fill(x, y)
            let at = (y * w + x) * 3
            data[at] = Float(r)
            data[at + 1] = Float(g)
            data[at + 2] = Float(b)
        }
    }
    return LinearRgb(width: w, height: h, data: data)
}

/// JavaScript's `Math.round`.
private func jsRound(_ x: Double) -> Double { ExifText.jsRound(x) }

/// Whether two arrays share one buffer — the web's `toBe` on a table.
private func sameBuffer<T>(_ a: [T], _ b: [T]) -> Bool {
    a.withUnsafeBufferPointer { pa in b.withUnsafeBufferPointer { pb in pa.baseAddress == pb.baseAddress } }
}

final class RawImageDecoderCurveTests: XCTestCase {
    func testIsBt709InvertedExactlyTheNumbersTheProbeMeasured() {
        // 0.5 of sensor white came back as 0.7059 from LibRaw, whatever `gamm` said.
        assertClose(linearToBt709(0.5), 0.7059, 3)
        assertClose(linearToBt709(0.25), 0.4902, 3)
        assertClose(bt709ToLinear(0.7059), 0.5, 2)
        for v in [0, 0.001, 0.01, 0.018, 0.1, 0.5, 0.9, 1] {
            assertClose(bt709ToLinear(linearToBt709(v)), v, 9)
        }
    }

    func testTurnsA16BitDecodeIntoLinearLightThroughTheTable() throws {
        let rgb16: [UInt16] = [0, 65535, UInt16(jsRound(linearToBt709(0.5) * 65535))]
        let lin = try linearFromLibRaw(rgb16, 1, 1)
        XCTAssertEqual(lin.data[0], 0)
        assertClose(Double(lin.data[1]), 1, 6)
        assertClose(Double(lin.data[2]), 0.5, 3)
        XCTAssertThrowsError(try linearFromLibRaw(rgb16, 2, 1))
    }
}

final class RawImageAutoBrightGainTests: XCTestCase {
    func testPutsTheBrightestOnePerCentAtWhiteAndNeverLiftsAPictureThatReachesIt() {
        // A ramp from 0 to 0.5: the top 1 % sits at 0.495 → gain ≈ 2.02.
        let ramp = picture(1000, 1) { x, _ in (Double(x) / 1998, Double(x) / 1998, Double(x) / 1998) }
        let gain = autoBrightGain(ramp, 0.01, 1)
        XCTAssertGreaterThan(gain, 1.95)
        XCTAssertLessThan(gain, 2.1)
        // A ramp reaching 1 with one per cent of it AT white: gain 1 — the
        // sensor's white is white, and a picture that reaches it is never lifted.
        let full = picture(1000, 1) { x, _ in x < 20 ? (1, 1, 1) : (Double(x) / 999, Double(x) / 999, Double(x) / 999) }
        XCTAssertEqual(autoBrightGain(full, 0.01, 1), 1)
        // A ramp reaching 1 with NOTHING at white: the top one per cent sits at
        // 0.99, which is dcraw's rule and lifts by a hair.
        let ramp1 = picture(1000, 1) { x, _ in (Double(x) / 999, Double(x) / 999, Double(x) / 999) }
        assertClose(autoBrightGain(ramp1, 0.01, 1), 1.01, 2)
    }

    func testReadsTheBrightestChannelIsBoundedAndIsRoundedToThreeDecimals() {
        let red = picture(100, 1) { _, _ in (0.4, 0.1, 0.1) }
        assertClose(autoBrightGain(red, 0.01, 1), 2.5, 2)
        let dark = picture(100, 1) { _, _ in (0.001, 0.001, 0.001) }
        XCTAssertEqual(autoBrightGain(dark, 0.01, 1), 16)
        let printed = ExifText.jsString(autoBrightGain(picture(100, 1) { _, _ in (0.3, 0.3, 0.3) }, 0.01, 1))
        XCTAssertNotNil(printed.range(of: #"^\d+(\.\d{1,3})?$"#, options: .regularExpression), printed)
    }
}

final class RawImageBudgetTests: XCTestCase {
    func testPicksTheFirstIntegerBoxFactorThatFits() {
        XCTAssertEqual(rawBoxFactor(4000, 3000, 12_000_000), 1)
        XCTAssertEqual(rawBoxFactor(4000, 3000, 8_000_000), 2)
        XCTAssertEqual(rawBoxFactor(8000, 6000, 8_000_000), 3)
        XCTAssertEqual(rawBoxFactor(8000, 6000, 0), 1)
    }

    func testBoxAveragesLinearLightAndDropsTheEdgeThatDoesNotFillABox() {
        let p = picture(5, 3) { x, y in (Double(x), Double(y), Double(x + y)) }
        let small = boxDownscale(p, 2)
        XCTAssertEqual(small.width, 2)
        XCTAssertEqual(small.height, 1)
        // Top-left box: x in {0,1}, y in {0,1} → mean x 0.5, mean y 0.5, mean x+y 1.
        XCTAssertEqual(Array(small.data[0..<3]), [0.5, 0.5, 1])
        XCTAssertEqual(Array(small.data[3..<6]), [2.5, 0.5, 3])
        XCTAssertEqual(boxDownscale(p, 1), p)
    }
}

final class RawImageWhatReachesTheGpuTests: XCTestCase {
    func testEncodesLinearLightToSrgbHalfFloatsSensorWhiteAt1HeadroomPastIt() {
        let p = picture(4, 1) { x, _ in ([0, 0.18, 1, 2][x], 0.5, 0.001) }
        let half = halfImageFromLinear(p)
        func at(_ i: Int) -> Double { fromHalf(half.data[i]) }
        XCTAssertEqual(at(0), 0)
        assertClose(at(3), fromLinear(0.18, .srgb), 3)
        XCTAssertEqual(at(6), 1)
        // Above white the encode continues: 2.0 linear is past 1.0 encoded.
        XCTAssertGreaterThan(at(9), 1.3)
        assertClose(at(4), fromLinear(0.5, .srgb), 3)
        assertClose(toLinear(at(2), .srgb), 0.001, 4)
    }

    func testDrawsTheAsShotBytesWithTheMeasuredGainClippedAtWhite() {
        let p = picture(3, 1) { x, _ in ([0.25, 0.5, 0.05][x], 0.25, 0.25) }
        let bytes = bytesFromLinear(p, 2)
        XCTAssertEqual(Double(bytes[0]), jsRound(fromLinear(0.5, .srgb) * 255))
        XCTAssertEqual(bytes[4], 255)
        XCTAssertEqual(Double(bytes[8]), jsRound(fromLinear(0.1, .srgb) * 255))
        XCTAssertEqual(bytes[3], 255)
    }
}

final class RawImageFusedPathsTests: XCTestCase {
    // A 16-bit decode with every kind of value in it: a ramp, noise, a clipped
    // patch — 9×7 so a box factor of 2 drops an edge row and column.
    private let W = 9
    private let H = 7
    private lazy var rgb16: [UInt16] = {
        var out = [UInt16](repeating: 0, count: W * H * 3)
        for i in 0..<out.count {
            // `(i * 2654435761) >>> 0`, then its top sixteen bits.
            let seed = UInt32(truncatingIfNeeded: UInt64(i) &* 2_654_435_761)
            out[i] = i % 11 == 0 ? 65535 : (i % 7 == 0 ? 0 : UInt16((seed >> 16) & 0xffff))
        }
        return out
    }()
    private let table = bt709Table()

    func testBoxLinearRowsWritesWhatBoxDownscaleOfLinearFromLibRawComputesBandByBand() throws {
        for factor in [2, 3] {
            let expected = boxDownscale(try linearFromLibRaw(rgb16, W, H), factor)
            let size = boxedSize(W, H, factor)
            XCTAssertEqual(size.width, expected.width)
            XCTAssertEqual(size.height, expected.height)
            var out = [Float](repeating: 0, count: size.width * size.height * 3)
            // Two bands, an odd split, so a row boundary inside the picture is exercised.
            boxLinearRows(rgb16, W, factor, table, &out, size.width, 0, 1)
            boxLinearRows(rgb16, W, factor, table, &out, size.width, 1, size.height)
            XCTAssertEqual(out.map { $0.bitPattern }, expected.data.map { $0.bitPattern })
        }
    }

    func testTheWholePictureTablesGiveTheSameHalfFloatsAndBytesAsTheLinearPictureWould() throws {
        let linear = try linearFromLibRaw(rgb16, W, H, table)
        let half = halfImageFromLinear(linear)
        let halfTable = halfTableFromLibRaw(table)
        var packed = [UInt16](repeating: 0, count: rgb16.count)
        packHalfSamples(rgb16, halfTable, &packed, 0, 10)
        packHalfSamples(rgb16, halfTable, &packed, 10, rgb16.count)
        XCTAssertEqual(packed, half.data)

        let gain = autoBrightGain(linear, 0.01, 1)
        XCTAssertEqual(autoBrightGainFromLibRaw(rgb16, W, H, table, 0.01, 1), gain)
        XCTAssertEqual(autoBrightGainFromLibRaw(rgb16, W, H, table), autoBrightGain(linear))
        let bytes = bytesFromLinear(linear, gain)
        let byteTable = byteTableFromLibRaw(table, gain)
        var out = [UInt8](repeating: 0, count: W * H * 4)
        packBytePixels(rgb16, byteTable, &out, 0, 20)
        packBytePixels(rgb16, byteTable, &out, 20, W * H)
        XCTAssertEqual(out, bytes)
    }

    func testHalfImageFromLinearStillEncodesEverySampleAsThePackedFloatPictureDid() throws {
        // The old path: an encoded Float32 picture, then packed. Pinned so the
        // fused encode cannot drift from it by a rounding step.
        let linear = try linearFromLibRaw(rgb16, W, H, table)
        let encoded: [Float] = linear.data.map { f in
            let v = Double(f)
            return v <= 0 ? 0 : (v >= 1 ? 1 : Float(fromLinear(v, .srgb)))
        }
        let half = halfImageFromLinear(linear)
        for i in 0..<encoded.count {
            XCTAssertLessThan(abs(fromHalf(half.data[i]) - Double(encoded[i])), 0.002)
        }
    }
}

final class RawImageFusedEncodeTests: XCTestCase {
    func testWritesTheVeryHalfFloatsAndBytesTheTwoSingleOutputFunctionsDoBandByBand() {
        let w = 7
        let h = 5
        // 0..1.26, headroom included.
        let data: [Float] = (0..<(w * h * 3)).map { Float(Double(($0 * 37) % 101) / 80) }
        let linear = LinearRgb(width: w, height: h, data: data)
        let gain = 1.37
        var half = [UInt16](repeating: 0, count: data.count)
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        encodeLinearRows(linear, gain, &half, &bytes, 0, 9)
        encodeLinearRows(linear, gain, &half, &bytes, 9, w * h)
        XCTAssertEqual(half, halfImageFromLinear(linear).data)
        XCTAssertEqual(bytes, bytesFromLinear(linear, gain))
        // Asked for the half-floats alone, it touches no bytes.
        var halfOnly = [UInt16](repeating: 0, count: data.count)
        encodeLinearRows(linear, gain, &halfOnly, 0, w * h)
        XCTAssertEqual(halfOnly, half)
    }

    func testSharesItsTablesBetweenCallsAndNeverHandsOutADifferentOne() {
        XCTAssertTrue(sameBuffer(bt709Table(), bt709Table()))
        XCTAssertTrue(sameBuffer(halfTableFromLibRaw(bt709Table()), halfTableFromLibRaw(bt709Table())))
    }
}
