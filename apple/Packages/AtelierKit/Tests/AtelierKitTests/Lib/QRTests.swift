// Port of `src/shared/lib/qr.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func dark(_ m: QrMatrix, _ r: Int, _ c: Int) -> Bool {
    m.modules[r * m.size + c]
}

final class RsEncodeTests: XCTestCase {
    func testMatchesTheStandardsWorkedExample() {
        // ISO/IEC 18004's own 1-M example, "01234567" in numeric mode: the data
        // codewords below must produce exactly these ten error-correction bytes.
        // This is the one part of the encoder with a published expected answer,
        // so it is checked against the number rather than against itself.
        let data: [UInt8] = [
            0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
            0xec, 0x11, 0xec, 0x11,
        ]
        XCTAssertEqual(rsEncode(data, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55])
    }

    func testReturnsExactlyTheNumberOfCodewordsAskedFor() {
        for n in [10, 16, 18, 22, 24, 26] {
            XCTAssertEqual(rsEncode([1, 2, 3, 4], n).count, n)
        }
    }

    func testIsDeterministic() {
        let data: [UInt8] = [9, 8, 7, 6, 5]
        XCTAssertEqual(rsEncode(data, 16), rsEncode(data, 16))
    }
}

final class QrFrameTests: XCTestCase {
    private let m = encodeQr("https://atelier.steeve.website")!

    func testSizesTheMatrixAs4VersionPlus17() {
        XCTAssertEqual(m.size, m.version * 4 + 17)
        XCTAssertEqual(m.modules.count, m.size * m.size)
    }

    func testPutsAFinderEyeInThreeCornersAndNoneInTheFourth() {
        func eye(_ r0: Int, _ c0: Int) -> Bool {
            dark(m, r0 + 0, c0 + 0) && dark(m, r0 + 3, c0 + 3) && !dark(m, r0 + 1, c0 + 1) && dark(m, r0 + 6, c0 + 6)
        }
        XCTAssertTrue(eye(0, 0))
        XCTAssertTrue(eye(0, m.size - 7))
        XCTAssertTrue(eye(m.size - 7, 0))
        // The bottom-right corner is data, and a fourth eye there would break
        // every decoder's orientation.
        XCTAssertFalse(dark(m, m.size - 1, m.size - 1) && dark(m, m.size - 4, m.size - 4))
    }

    func testSeparatesEachFinderWithAQuietRing() {
        for i in 0...7 {
            XCTAssertFalse(dark(m, 7, i))
            XCTAssertFalse(dark(m, i, 7))
        }
    }

    func testAlternatesTheTimingLines() {
        for i in 8..<(m.size - 8) {
            XCTAssertEqual(dark(m, 6, i), i % 2 == 0)
            XCTAssertEqual(dark(m, i, 6), i % 2 == 0)
        }
    }

    func testAlwaysSetsTheDarkModule() {
        XCTAssertTrue(dark(m, m.size - 8, 8))
    }

    func testWritesTheFormatStripTwiceSayingTheSameThing() {
        // Copy 1 sits around the top-left finder, copy 2 splits between the
        // other two; a decoder reads whichever is legible, so they must agree.
        var one: [Bool] = (0..<6).map { dark(m, $0, 8) }
        one.append(dark(m, 7, 8))
        one.append(dark(m, 8, 8))
        one.append(dark(m, 8, 7))
        one.append(contentsOf: (0..<6).map { k in dark(m, 8, 14 - (9 + k)) })
        var two: [Bool] = (0..<8).map { dark(m, 8, m.size - 1 - $0) }
        two.append(contentsOf: (0..<7).map { k in dark(m, m.size - 15 + (8 + k), 8) })
        XCTAssertEqual(one, two)
    }

    func testTheMatrixReadsItsOwnModules() {
        for r in 0..<m.size {
            for c in 0..<m.size where m.dark(r, c) != dark(m, r, c) {
                return XCTFail("dark(\(r), \(c)) disagrees with the row-major list")
            }
        }
    }
}

final class QrVersionTests: XCTestCase {
    func testPicksTheSmallestVersionThatHoldsThePayload() {
        XCTAssertEqual(encodeQr("A")?.version, 1)
        XCTAssertEqual(encodeQr(String(repeating: "x", count: 14))?.version, 1)
        XCTAssertEqual(encodeQr(String(repeating: "x", count: 15))?.version, 2)
        XCTAssertEqual(encodeQr(String(repeating: "x", count: qrMaxBytes))?.version, 10)
    }

    func testCountsUtf8BytesNotCharacters() {
        // An em dash is three bytes; a version chosen on character count would
        // overflow and produce a code that decodes to nothing.
        XCTAssertEqual(encodeQr(String(repeating: "—", count: 5))?.version,
                       encodeQr(String(repeating: "x", count: 15))?.version)
    }

    func testDrawsAlignmentPatternsFromVersion2On() {
        let v2 = encodeQr(String(repeating: "x", count: 15))!
        // The centre of the one alignment pattern at (18,18).
        XCTAssertTrue(dark(v2, 18, 18))
        XCTAssertFalse(dark(v2, 17, 18))
    }

    func testRefusesAPayloadNoVersionHoldsRatherThanTruncatingIt() {
        // A QR that scans to half a URL is worse than no QR.
        XCTAssertNil(encodeQr(String(repeating: "x", count: qrMaxBytes + 1)))
        XCTAssertTrue(qrFits(String(repeating: "x", count: qrMaxBytes)))
        XCTAssertFalse(qrFits(String(repeating: "x", count: qrMaxBytes + 1)))
    }

    func testHasNothingToEncodeForAnEmptyString() {
        XCTAssertNil(encodeQr(""))
    }

    func testCarriesTheVersionInformationFromVersion7On() {
        // Versions 7+ write the BCH-coded version twice; both copies agree.
        let v7 = encodeQr(String(repeating: "x", count: 120))!
        XCTAssertGreaterThanOrEqual(v7.version, 7)
        let size = v7.size
        for i in 0..<18 {
            let a = size - 11 + (i % 3)
            let b = i / 3
            XCTAssertEqual(dark(v7, b, a), dark(v7, a, b), "version bit \(i)")
        }
    }
}

final class QrRealCodeTests: XCTestCase {
    func testIsStableForTheSameInput() {
        let a = encodeQr("https://example.com/a")!
        let b = encodeQr("https://example.com/a")!
        XCTAssertEqual(a.modules, b.modules)
    }

    func testDiffersForDifferentInput() {
        let a = encodeQr("https://example.com/a")!
        let b = encodeQr("https://example.com/b")!
        XCTAssertNotEqual(a.modules, b.modules)
    }

    func testKeepsTheDarkShareNearHalfWhichIsWhatMaskingIsFor() {
        for text in ["A", String(repeating: "x", count: 60), "https://atelier.steeve.website", String(repeating: "0", count: 200)] {
            let m = encodeQr(text)!
            let share = Double(m.modules.filter { $0 }.count) / Double(m.modules.count)
            XCTAssertGreaterThan(share, 0.35, text)
            XCTAssertLessThan(share, 0.65, text)
        }
    }
}
