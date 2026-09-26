// Port of `src/shared/lut/pack-codec.test.ts`.

import XCTest
@testable import AtelierKit

private func maxError(_ a: [Float], _ b: [Float]) -> Double {
    var worst = 0.0
    for i in 0..<a.count { worst = max(worst, abs(Double(a[i]) - Double(b[i]))) }
    return worst
}

private func encoded(_ lut: CubeLut) -> [UInt8] {
    // A lattice these specs build is always one the format can hold.
    guard let bytes = try? encodeLattice(lut) else {
        XCTFail("encodeLattice refused a sound lattice")
        return []
    }
    return bytes
}

final class EncodeDecodeLatticeTests: XCTestCase {
    func testRoundTripsALatticeInsideOne16BitStep() {
        let lut = CubeLut.make(size: 17) { r, g, b in (pow(r, 2.2), g * 0.8 + 0.1, b.squareRoot()) }
        let back = decodeLattice(encoded(lut))!
        XCTAssertEqual(back.size, 17)
        // The range is [0,1], so a step is 1/65535 — the rounding is half of it.
        XCTAssertLessThanOrEqual(maxError(lut.data, back.data), 0.5 / 65535)
    }

    func testIsFarFinerThanThe8BitPictureItEndsUpIn() {
        let lut = CubeLut.make(size: 33) { r, g, b in (r, g, b) }
        let back = decodeLattice(encoded(lut))!
        XCTAssertLessThan(maxError(lut.data, back.data), 1.0 / 255 / 100)
    }

    func testKeepsHighlightsThatRunPast1LikeTheShippedDJICube() {
        let lut = CubeLut.make(size: 9) { r, g, b in (r * 1.4, g, b - 0.05) }
        let back = decodeLattice(encoded(lut))!
        XCTAssertGreaterThan(Double(back.data.max()!), 1.39)
        XCTAssertLessThan(Double(back.data.min()!), 0)
        XCTAssertLessThanOrEqual(maxError(lut.data, back.data), 0.5 * (1.45 / 65535))
    }

    func testReproducesTheExtremesExactly() {
        let lut = CubeLut.make(size: 5) { r, g, b in (r, g, b) }
        let back = decodeLattice(encoded(lut))!
        XCTAssertEqual(back.data[0], 0)
        XCTAssertEqual(back.data[back.data.count - 1], 1)
    }

    func testKeepsALatticeWhoseSamplesAreAllTheSame() {
        let lut = CubeLut.make(size: 3) { _, _, _ in (0.5, 0.5, 0.5) }
        let back = decodeLattice(encoded(lut))!
        XCTAssertEqual(maxError(lut.data, back.data), 0)
    }

    func testCarriesTheDomainWhichTheShaderReads() {
        let lut = CubeLut.make(size: 5, { r, g, b in (r, g, b) }, domainMin: (0, 0, 0), domainMax: (2, 2, 2))
        let back = decodeLattice(encoded(lut))!
        XCTAssertTrue(back.domainMin == (0, 0, 0))
        XCTAssertTrue(back.domainMax == (2, 2, 2))
    }

    func testTakesTheTitleFromTheCallerNeverFromTheBytes() {
        let lut = CubeLut.make(size: 3) { r, g, b in (r, g, b) }
        XCTAssertNil(decodeLattice(encoded(lut))!.title)
        XCTAssertEqual(decodeLattice(encoded(lut), title: "D-Log")!.title, "D-Log")
    }

    func testIsAQuarterOfTheTextItReplaces() {
        // The pack's own numbers: a 65³ `.cube` is 3.6–6.9 MB of text.
        XCTAssertEqual(encodedBytes(65), 40 + 65 * 65 * 65 * 3 * 2)
        XCTAssertLessThan(Double(encodedBytes(65)), 1.7 * 1024 * 1024)
        XCTAssertLessThan(encodedBytes(33), 220 * 1024)
    }

    func testRefusesWhatItCannotReadRatherThanGradingWrongly() {
        let good = encoded(CubeLut.make(size: 3) { r, g, b in (r, g, b) })
        XCTAssertNil(decodeLattice([UInt8](repeating: 0, count: 10)))
        XCTAssertNil(decodeLattice(Array(good.prefix(good.count - 2))))

        var foreign = good
        foreign[0] = 0x42
        XCTAssertNil(decodeLattice(foreign))

        var future = good
        future[4] = 9
        XCTAssertNil(decodeLattice(future))
    }

    func testRefusesALatticeItCannotHold() {
        let broken = CubeLut(size: 4, data: [Float](repeating: 0, count: 3))
        XCTAssertThrowsError(try encodeLattice(broken)) { error in
            XCTAssertTrue(String(describing: error).contains("size³"), "\(error)")
        }
        var tiny = broken
        tiny.size = 1
        XCTAssertThrowsError(try encodeLattice(tiny)) { error in
            XCTAssertTrue(String(describing: error).contains("not one this format can hold"), "\(error)")
        }
    }

    func testReadsFromAViewIntoALargerBuffer() {
        let lut = CubeLut.make(size: 5) { r, g, b in (r, g, b) }
        let bytes = encoded(lut)
        // A fetched body sliced at an odd offset: a `Data` slice whose indices
        // start at 1, and samples no longer 2-byte aligned.
        let padded = Data([0] + bytes)
        let body = padded[1...]
        XCTAssertEqual(body.startIndex, 1)
        let back = decodeLattice(body)!
        XCTAssertLessThanOrEqual(maxError(lut.data, back.data), 0.5 / 65535)
    }

    func testTakesARealCubeThroughTheParserAndBack() {
        let text = [
            "TITLE \"tiny\"",
            "LUT_3D_SIZE 2",
            "DOMAIN_MIN 0 0 0",
            "DOMAIN_MAX 1 1 1",
            "0 0 0",
            "1 0 0",
            "0 1 0",
            "1 1 0",
            "0 0 1",
            "1 0 1",
            "0 1 1",
            "1 1 1",
        ].joined(separator: "\n")
        let parsed = parseCube(text)!
        let back = decodeLattice(encoded(parsed), title: parsed.title)!
        XCTAssertEqual(back.title, "tiny")
        XCTAssertEqual(back.data, parsed.data)
    }

    /// Not in the web spec: the layout itself, which a file written here must
    /// share with one the browser writes — the header BIG-endian (a DataView's
    /// default), the samples LITTLE-endian.
    func testWritesTheWebsByteLayout() {
        let bytes = encoded(CubeLut.make(size: 2) { r, g, b in (r * 0.5, g, b) })
        XCTAssertEqual(Array(bytes[0..<4]), [0x41, 0x54, 0x4C, 0x31]) // "ATL1"
        XCTAssertEqual(bytes[4], 1)
        XCTAssertEqual(bytes[5], 0)
        XCTAssertEqual(Array(bytes[6..<8]), [0x00, 0x02])
        // valueMax 1.0 as a big-endian f32.
        XCTAssertEqual(Array(bytes[36..<40]), [0x3F, 0x80, 0x00, 0x00])
        // Node (0,0,0) is three zeros; the fourth sample is red at node
        // (1,0,0), 0.5 of [0,1]: `Math.round(32767.5)` = 32768 = 0x8000,
        // little-endian.
        XCTAssertEqual(Array(bytes[40..<46]), [0, 0, 0, 0, 0, 0])
        XCTAssertEqual(Array(bytes[46..<48]), [0x00, 0x80])
        XCTAssertEqual(bytes.count, encodedBytes(2))
    }

    /// Not in the web spec: the same lattice encoded by the WEB codec (run in
    /// node on 2026-09-25 over these two functions) hashes to these digests —
    /// so a look pushed from the phone lands under the very `blob` a browser
    /// would push it under, and the content-addressed bucket accepts both.
    func testEncodesByteForByteWhatTheBrowserEncodes() {
        let a = encoded(CubeLut.make(size: 5) { r, g, b in (r * 0.5, g * 0.8 + 0.1, 1 - b) })
        XCTAssertEqual(a.count, 790)
        XCTAssertEqual(sha256Hex(a), "54791536511ea642d84d7c4345bd0391429e5cc786558a253f91d457cecb05b3")
        let b = encoded(CubeLut.make(size: 4, { r, g, b in (r * 1.4, g, b - 0.05) },
                                     domainMin: (0, 0, 0), domainMax: (2, 2, 2)))
        XCTAssertEqual(b.count, 424)
        XCTAssertEqual(sha256Hex(b), "e9a9d74bf834a97861fb9dcbc1cd3fb6a9de28881a6e8097db50e36c528ab782")
    }
}

final class Sha256HexTests: XCTestCase {
    func testAnswersTheKnownDigestOfAnEmptyInput() {
        XCTAssertEqual(sha256Hex([UInt8]()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func testHashesTheViewNotTheBufferItSitsIn() {
        let body = Data([1, 2, 3, 4, 5, 6])
        let alone: [UInt8] = [3, 4]
        XCTAssertEqual(sha256Hex(body[2..<4]), sha256Hex(alone))
    }

    func testSeparatesTwoFilesThatDifferByOneByte() {
        XCTAssertNotEqual(sha256Hex([1, 2, 3] as [UInt8]), sha256Hex([1, 2, 4] as [UInt8]))
    }
}
