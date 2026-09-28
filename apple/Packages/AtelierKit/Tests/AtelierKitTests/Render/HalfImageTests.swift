// Port of `src/shared/render/half-image.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class ToHalfFromHalfTests: XCTestCase {
    func testRoundTripsTheExactHalvesAndRoundsTheRestToNearestEven() {
        for v in [0, 1, 0.5, 0.25, -2, 1024, 0.000030517578125, 65504] {
            XCTAssertEqual(fromHalf(toHalf(v)), v)
        }
        // 1/3 is not a half: the nearest is 0.333251953125 (round down) —
        // the same answer Float16Array gives.
        assertClose(fromHalf(toHalf(1.0 / 3)), 0.333251953125, 12)
        // A value halfway between two halves goes to the EVEN one.
        let a = fromHalf(0x3c00) // 1.0
        let b = fromHalf(0x3c01) // 1.0009765625
        XCTAssertEqual(fromHalf(toHalf((a + b) / 2)), a)
    }

    func testKeepsAnSrgbEncodedValueToBetterThanAn8BitCodeEverywhereIn01() {
        for i in 0...1000 {
            let v = Double(i) / 1000
            XCTAssertLessThan(abs(fromHalf(toHalf(v)) - v), 1.0 / 255 / 4)
        }
    }

    func testHandlesTheEdgesSubnormalsOverflowSignNaN() {
        // The smallest half is 2^-24 ≈ 6e-8: 1e-7 lands on a subnormal, 1e-10 on zero.
        XCTAssertLessThan(abs(fromHalf(toHalf(1e-7)) - 1e-7), pow(2, -24))
        XCTAssertEqual(toHalf(1e-10), 0)
        XCTAssertEqual(fromHalf(toHalf(1e6)), .infinity)
        XCTAssertEqual(toHalf(-0.5) & 0x8000, 0x8000)
        XCTAssertTrue(fromHalf(toHalf(.nan)).isNaN)
    }
}

final class PackHalfImageTests: XCTestCase {
    func testPacksThreeFloatsPerPixelTopRowFirstAndSaysWhatItIs() {
        let img = packHalfImage([0, 0.5, 1, 1, 0.5, 0], 2, 1)
        XCTAssertTrue(isHalfImage(img))
        XCTAssertEqual(img.width, 2)
        XCTAssertEqual(img.data.count, 6)
        XCTAssertEqual(img.data.map(fromHalf), [0, 0.5, 1, 1, 0.5, 0])
        let lookalike: [String: Any] = ["kind": "half", "data": [Int]()]
        XCTAssertFalse(isHalfImage(lookalike))
        XCTAssertFalse(isHalfImage(nil))
    }
}
