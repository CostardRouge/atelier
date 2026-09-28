// Port of `src/shared/exif/dng-opcodes.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

// MARK: - big-endian writers, exactly as a DNG holds an opcode list

private func be32(_ buf: inout [UInt8], _ at: Int, _ v: Int) {
    let u = UInt32(truncatingIfNeeded: v)
    for i in 0..<4 { buf[at + i] = UInt8((u >> (8 * UInt32(3 - i))) & 0xff) }
}

private func be64(_ buf: inout [UInt8], _ at: Int, _ v: Double) {
    let u = v.bitPattern
    for i in 0..<8 { buf[at + i] = UInt8((u >> (8 * UInt64(7 - i))) & 0xff) }
}

private func be32f(_ buf: inout [UInt8], _ at: Int, _ v: Double) {
    let u = Float(v).bitPattern
    for i in 0..<4 { buf[at + i] = UInt8((u >> (8 * UInt32(3 - i))) & 0xff) }
}

/// Build an opcode list exactly as a DNG holds one: big-endian, always.
private func opcodeList(_ opcodes: [(id: Int, params: [UInt8])]) -> ByteView {
    let total = 4 + opcodes.reduce(0) { $0 + 16 + $1.params.count }
    var buf = [UInt8](repeating: 0, count: total)
    be32(&buf, 0, opcodes.count)
    var at = 4
    for o in opcodes {
        be32(&buf, at, o.id)
        be32(&buf, at + 4, 0x0104_0000) // dngVersion
        be32(&buf, at + 8, 0) // flags
        be32(&buf, at + 12, o.params.count)
        for (i, b) in o.params.enumerated() { buf[at + 16 + i] = b }
        at += 16 + o.params.count
    }
    return ByteView(buf)
}

private func gainMapParams(
    rows: Int = 2, cols: Int = 2, mapPlanes: Int = 3,
    rect: (top: Int, left: Int, bottom: Int, right: Int) = (0, 0, 4536, 8064),
    rowPitch: Int = 1, colPitch: Int = 1, gains: [Double]? = nil
) -> [UInt8] {
    let values = gains ?? [Double](repeating: 1, count: rows * cols * mapPlanes)
    var buf = [UInt8](repeating: 0, count: 76 + values.count * 4)
    let u32 = [rect.top, rect.left, rect.bottom, rect.right, 0, 3, rowPitch, colPitch, rows, cols]
    for (i, n) in u32.enumerated() { be32(&buf, i * 4, n) }
    // spacingV, spacingH, originV, originH
    be64(&buf, 40, 1 / Double(rows - 1))
    be64(&buf, 48, 1 / Double(cols - 1))
    be64(&buf, 56, 0)
    be64(&buf, 64, 0)
    be32(&buf, 72, mapPlanes)
    for (i, g) in values.enumerated() { be32f(&buf, 76 + i * 4, g) }
    return buf
}

private func warpParams(_ planes: [[Double]], centerH: Double = 0.5, centerV: Double = 0.5) -> [UInt8] {
    let n = planes.count
    var buf = [UInt8](repeating: 0, count: 4 + n * 48 + 16)
    be32(&buf, 0, n)
    for (p, k) in planes.enumerated() {
        for (i, x) in k.enumerated() { be64(&buf, 4 + p * 48 + i * 8, x) }
    }
    be64(&buf, 4 + n * 48, centerH)
    be64(&buf, 4 + n * 48 + 8, centerV)
    return buf
}

final class ParseOpcodeListTests: XCTestCase {
    func testReadsAGainMapTheWayTheDjiFileWritesOne() {
        let gains: [Double] = [
            // top-left node, RGB
            5.93, 5.06, 4.97,
            // top-right
            5.9, 5.0, 4.9,
            // bottom-left
            5.8, 4.9, 4.8,
            // bottom-right
            1.0, 1.0, 1.0,
        ]
        let v = opcodeList([(9, gainMapParams(gains: gains))])
        let out = parseOpcodeList(v, offset: 0, length: v.byteLength)
        XCTAssertEqual(out.gainMaps.count, 1)
        let m = out.gainMaps[0]
        XCTAssertEqual(m.rows, 2)
        XCTAssertEqual(m.cols, 2)
        XCTAssertEqual(m.mapPlanes, 3)
        XCTAssertEqual(m.rect, DngRect(top: 0, left: 0, bottom: 4536, right: 8064))
        let firstThree = m.gains.prefix(3).map { (Double($0) * 100).rounded() / 100 }
        XCTAssertEqual(firstThree, [5.93, 5.06, 4.97])
        XCTAssertEqual(out.unread, [])
    }

    func testReadsTheThreePlaneWarpRectilinearAndItsOpticalCentre() {
        let v = opcodeList([
            (1, warpParams(
                [
                    [1.0493, 0, 0, 0, 0, 0],
                    [1.0493, 0, 0, 0, 0, 0],
                    [1.0495, 0, 0, 0, 0, 0],
                ],
                centerH: 0.4998,
                centerV: 0.5011
            )),
        ])
        let out = parseOpcodeList(v, offset: 0, length: v.byteLength)
        XCTAssertNotNil(out.warp)
        XCTAssertEqual(out.warp?.planes.count, 3)
        assertClose(out.warp?.planes[0].radial[0] ?? 0, 1.0493, 6)
        assertClose(out.warp?.planes[2].radial[0] ?? 0, 1.0495, 6)
        assertClose(out.warp?.centerH ?? 0, 0.4998, 6)
        assertClose(out.warp?.centerV ?? 0, 0.5011, 6)
        // A one-plane warp answers for all three.
        let w = opcodeList([(1, warpParams([[1.02, 0, 0, 0, 0, 0]]))])
        let one = parseOpcodeList(w, offset: 0, length: 4 + 16 + (4 + 48 + 16))
        assertClose(warpPlane(one.warp!, 2)?.radial[0] ?? 0, 1.02, 6)
    }

    func testReadsBigEndianWhateverTheTiffSaysTheOneTrapInThisFormat() {
        // Written big-endian above; read little-endian, a gain of 1.0 becomes a
        // denormal near 1e-40 rather than something near 1. Asserted by showing
        // the big-endian read lands where it should.
        let v = opcodeList([(9, gainMapParams(gains: [Double](repeating: 1, count: 12)))])
        let out = parseOpcodeList(v, offset: 0, length: v.byteLength)
        XCTAssertEqual(out.gainMaps[0].gains[0], 1)
        // And the raw bytes really are big-endian: the float 1.0 is 3f 80 00 00.
        XCTAssertEqual(v.bytes[4 + 16 + 76], 0x3f)
        // The little-endian read of the same four bytes is the denormal the
        // memory warns about, not a gain.
        XCTAssertLessThan(Double(v.float32(4 + 16 + 76, little: true)), 1e-30)
    }

    func testRefusesACfaPitchGainMapRatherThanApplyingItToEveryPixel() {
        let v = opcodeList([(9, gainMapParams(rowPitch: 2, colPitch: 2))])
        let out = parseOpcodeList(v, offset: 0, length: v.byteLength)
        XCTAssertEqual(out.gainMaps, [])
        XCTAssertEqual(out.unread, [9])
    }

    func testNamesAnOpcodeItDoesNotApplyInsteadOfDroppingItSilently() {
        let v = opcodeList([(3, [UInt8](repeating: 0, count: 8))])
        XCTAssertEqual(parseOpcodeList(v, offset: 0, length: v.byteLength).unread, [3])
    }

    func testKeepsWhatItReadWhenTheBytesRunOutMidList() {
        let v = opcodeList([
            (9, gainMapParams()),
            (1, warpParams([[1.05, 0, 0, 0, 0, 0]])),
        ])
        // Cut the list short of the warp's parameters.
        let out = parseOpcodeList(v, offset: 0, length: v.byteLength - 20)
        XCTAssertEqual(out.gainMaps.count, 1)
        XCTAssertNil(out.warp)
    }

    func testAnswersEmptyForNonsenseRatherThanThrowing() {
        let v = ByteView([UInt8](repeating: 0, count: 64))
        XCTAssertEqual(parseOpcodeList(v, offset: 0, length: 2), DngOpcodes(gainMaps: [], warp: nil, unread: []))
        XCTAssertEqual(parseOpcodeList(v, offset: 60, length: 40), DngOpcodes(gainMaps: [], warp: nil, unread: []))
    }
}

final class IsIdentityWarpTests: XCTestCase {
    func testKnowsAWarpThatMovesNothing() {
        XCTAssertTrue(isIdentityWarp(nil))
        XCTAssertTrue(isIdentityWarp(DngWarp(planes: [DngWarpPlane(radial: [1, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)))
        XCTAssertFalse(isIdentityWarp(DngWarp(planes: [DngWarpPlane(radial: [1.05, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)))
    }
}

final class DescribeOpcodesTests: XCTestCase {
    func testSaysWhatTheFileReallyAsksFor() {
        let v = opcodeList([
            (9, gainMapParams(gains: [5.93, 5.06, 4.97, 1, 1, 1, 1, 1, 1, 1, 1, 1])),
            (1, warpParams([[1.0493, 0, 0, 0, 0, 0], [1.0493, 0, 0, 0, 0, 0], [1.0495, 0, 0, 0, 0, 0]])),
        ])
        let out = parseOpcodeList(v, offset: 0, length: v.byteLength)
        XCTAssertEqual(describeOpcodes(out), "gain map 2×2 ×3 · up to 5.93× · warp ×1.049")
    }
}
