// The hand-rolled binary16, pinned on the values a lattice packer meets: the
// exact dyadics a cube's nodes are, the ties, the ceiling, the subnormals.

import XCTest
@testable import Atelier

final class HalfFloatTests: XCTestCase {
    func testKnownValues() {
        XCTAssertEqual(HalfFloat.bits(0), 0x0000)
        XCTAssertEqual(HalfFloat.bits(-0.0), 0x8000)
        XCTAssertEqual(HalfFloat.bits(1), 0x3C00)
        XCTAssertEqual(HalfFloat.bits(-1), 0xBC00)
        XCTAssertEqual(HalfFloat.bits(0.5), 0x3800)
        XCTAssertEqual(HalfFloat.bits(1.5), 0x3E00)
        XCTAssertEqual(HalfFloat.bits(-2), 0xC000)
        XCTAssertEqual(HalfFloat.bits(65504), 0x7BFF)
        XCTAssertEqual(HalfFloat.bits(.infinity), 0x7C00)
        XCTAssertEqual(HalfFloat.bits(-.infinity), 0xFC00)
        XCTAssertEqual(HalfFloat.bits(.nan) & 0x7E00, 0x7E00, "a quiet NaN")
    }

    func testRoundsToNearestTiesToEven() {
        XCTAssertEqual(HalfFloat.bits(65520), 0x7C00, "past the ceiling rounds to infinity")
        XCTAssertEqual(HalfFloat.bits(1 + 1.0 / 2048), 0x3C00, "a tie, to even (down)")
        XCTAssertEqual(HalfFloat.bits(1 + 3.0 / 2048), 0x3C02, "a tie, to even (up)")
        XCTAssertEqual(HalfFloat.bits(1 + 1.0 / 1024), 0x3C01, "one ulp above one")
    }

    func testSubnormals() {
        XCTAssertEqual(HalfFloat.bits(Float(1.0 / 16777216)), 0x0001, "2⁻²⁴, the smallest subnormal")
        XCTAssertEqual(HalfFloat.bits(Float(1.0 / 33554432)), 0x0000, "2⁻²⁵, a tie, to even")
        XCTAssertEqual(HalfFloat.bits(Float(3.0 / 67108864)), 0x0001, "0.75 · 2⁻²⁴ rounds up")
        XCTAssertEqual(HalfFloat.bits(Float(1.0 / 1024)), 0x1400, "2⁻¹⁰, a normal")
    }

    func testDataIsHalvesInMemoryOrder() {
        let data = HalfFloat.data([1, 0.5, 1.5])
        XCTAssertEqual(data.count, 6)
        let halves: [UInt16] = data.withUnsafeBytes { raw in
            (0..<3).map { raw.load(fromByteOffset: $0 * 2, as: UInt16.self) }
        }
        XCTAssertEqual(halves, [0x3C00, 0x3800, 0x3E00])
    }
}
