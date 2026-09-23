// Port of `src/shared/lut/transfer.test.ts`.

import XCTest
@testable import AtelierKit

final class TransferTests: XCTestCase {
    /// A ramp that straddles both sRGB knees and both endpoints.
    private let ramp: [Double] = [0, 0.001, 0.0031308, 0.01, 0.04045, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

    func testRoundTripsAcrossTheRampForEveryCurve() {
        for fn in TransferFn.allCases {
            for v in ramp {
                assertClose(fromLinear(toLinear(v, fn), fn), v, 10, fn.rawValue)
            }
        }
    }

    func testPinsBothEndpointsForEveryCurve() {
        for fn in TransferFn.allCases {
            XCTAssertEqual(toLinear(0, fn), 0)
            assertClose(toLinear(1, fn), 1, 12)
            XCTAssertEqual(fromLinear(0, fn), 0)
            assertClose(fromLinear(1, fn), 1, 12)
        }
    }

    func testIsContinuousAtTheSRGBKneeInBothDirections() {
        let e = 1e-9
        assertClose(toLinear(0.04045 - e, .srgb), toLinear(0.04045 + e, .srgb), 7)
        assertClose(fromLinear(0.0031308 - e, .srgb), fromLinear(0.0031308 + e, .srgb), 7)
    }

    func testKeepsTheSRGBToeLinearBelowTheKnee() {
        assertClose(toLinear(0.0129, .srgb), 0.0129 / 12.92, 12)
        assertClose(fromLinear(0.002, .srgb), 0.002 * 12.92, 12)
    }

    func testClampsOutOfRangeInputInsteadOfReturningNaN() {
        for fn in TransferFn.allCases {
            XCTAssertEqual(toLinear(-0.5, fn), 0)
            assertClose(toLinear(2, fn), 1, 12)
            XCTAssertEqual(fromLinear(-0.5, fn), 0)
            assertClose(fromLinear(2, fn), 1, 12)
        }
    }

    func testPairMapsEveryTransformAndOnlyNoneToNil() {
        XCTAssertNil(OutputTransform.none.pair)
        for t in OutputTransform.allCases where t != OutputTransform.none {
            XCTAssertNotNil(t.pair)
        }
        XCTAssertEqual(OutputTransform.rec709ToSrgb.pair?.from, .gamma24)
        XCTAssertEqual(OutputTransform.rec709ToSrgb.pair?.to, .srgb)
        XCTAssertEqual(OutputTransform.srgbToRec709.pair?.from, .srgb)
        XCTAssertEqual(OutputTransform.srgbToRec709.pair?.to, .gamma24)
    }

    func testApplyTransferIsTheIdentityForNone() {
        for v in ramp { XCTAssertEqual(applyTransfer(v, OutputTransform.none), v) }
    }

    func testApplyTransferPinsBlackAndWhiteForEveryTransform() {
        for t in OutputTransform.allCases {
            XCTAssertEqual(applyTransfer(0, t), 0)
            assertClose(applyTransfer(1, t), 1, 10)
        }
    }

    func testDarkensMidtonesGoingFromRec709ToASRGBDisplay() {
        for v in [0.1, 0.25, 0.5, 0.75] {
            XCTAssertLessThan(applyTransfer(v, .rec709ToSrgb), v)
            XCTAssertLessThan(applyTransfer(v, .rec709_24To22), v)
        }
    }

    func testBrightensMidtonesGoingTheOtherWay() {
        for v in [0.1, 0.25, 0.5, 0.75] {
            XCTAssertGreaterThan(applyTransfer(v, .srgbToRec709), v)
        }
    }

    func testRoundTripsRec709ToSRGBAndBack() {
        for v in ramp {
            let there = applyTransfer(v, .rec709ToSrgb)
            assertClose(applyTransfer(there, .srgbToRec709), v, 8)
        }
    }

    func testWeightsTheCorrectionTowardTheShadows() {
        func rel(_ v: Double) -> Double { (v - applyTransfer(v, .rec709ToSrgb)) / v }
        XCTAssertGreaterThan(rel(0.1), rel(0.25))
        XCTAssertGreaterThan(rel(0.25), rel(0.5))
        XCTAssertGreaterThan(rel(0.5), rel(0.75))
    }

    func testPreservesTheLightTheSourceEncodingIntended() {
        for v in ramp {
            let out = applyTransfer(v, .rec709ToSrgb)
            assertClose(toLinear(out, .srgb), toLinear(v, .gamma24), 9)
        }
    }

    func testStaysMonotonicSoNoToneEverCrossesAnother() {
        for t in OutputTransform.allCases {
            var prev = -1.0
            for v in ramp {
                let out = applyTransfer(v, t)
                XCTAssertGreaterThan(out, prev)
                prev = out
            }
        }
    }

    func testMakeTransferAgreesWithApplyTransfer() {
        for t in OutputTransform.allCases {
            let f = makeTransfer(t)
            for v in ramp { assertClose(f(v), applyTransfer(v, t), 12) }
        }
    }

    func testListsEveryTransformExactlyOnceNoneFirstWithALabelAndAHint() {
        XCTAssertEqual(OutputTransform.allCases.map(\.rawValue), ["none", "rec709-to-srgb", "rec709-24-to-22", "srgb-to-rec709"])
        for t in OutputTransform.allCases {
            XCTAssertFalse(t.label.isEmpty)
            XCTAssertFalse(t.hint.isEmpty)
        }
    }
}
