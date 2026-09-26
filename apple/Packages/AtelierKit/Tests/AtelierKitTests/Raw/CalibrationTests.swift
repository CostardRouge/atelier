// `src/shared/raw/calibration.ts` has no web spec; this one pins its observable
// rules — the ladder offers only what the file carries, a rung contains the one
// below it, a flat or identity opcode offers nothing, and a file is read once.

import Foundation
import XCTest
@testable import AtelierKit

private func le16(_ b: inout [UInt8], _ at: Int, _ v: Int) {
    b[at] = UInt8(v & 0xff)
    b[at + 1] = UInt8((v >> 8) & 0xff)
}

private func le32(_ b: inout [UInt8], _ at: Int, _ v: Int) {
    for i in 0..<4 { b[at + i] = UInt8((v >> (8 * i)) & 0xff) }
}

private func be32(_ b: inout [UInt8], _ at: Int, _ v: Int) {
    for i in 0..<4 { b[at + i] = UInt8((v >> (8 * (3 - i))) & 0xff) }
}

private func beF64(_ b: inout [UInt8], _ at: Int, _ v: Double) {
    let bits = v.bitPattern
    for i in 0..<8 { b[at + i] = UInt8((bits >> UInt64(8 * (7 - i))) & 0xff) }
}

private func beF32(_ b: inout [UInt8], _ at: Int, _ v: Float) {
    let bits = v.bitPattern
    for i in 0..<4 { b[at + i] = UInt8((bits >> UInt32(8 * (3 - i))) & 0xff) }
}

/// A GainMap opcode's parameters: one plane, a 2×2 grid over 8064×4536.
private func gainMapParams(_ gains: [Float]) -> [UInt8] {
    var params = [UInt8](repeating: 0, count: 76 + gains.count * 4)
    for (i, n) in [0, 0, 4536, 8064, 0, 3, 1, 1, 2, 2].enumerated() { be32(&params, i * 4, n) }
    beF64(&params, 40, 1)
    beF64(&params, 48, 1)
    beF64(&params, 56, 0)
    beF64(&params, 64, 0)
    be32(&params, 72, 1)
    for (i, g) in gains.enumerated() { beF32(&params, 76 + i * 4, g) }
    return params
}

/// A one-plane WarpRectilinear: a pure magnification about the middle.
private func warpParams(_ k0: Double) -> [UInt8] {
    var params = [UInt8](repeating: 0, count: 4 + 48 + 16)
    be32(&params, 0, 1)
    for (i, k) in [k0, 0, 0, 0, 0, 0].enumerated() { beF64(&params, 4 + i * 8, k) }
    beF64(&params, 52, 0.5)
    beF64(&params, 60, 0.5)
    return params
}

/// An opcode list, big-endian as a DNG always writes one.
private func opcodeList(_ ops: [(id: Int, params: [UInt8])]) -> [UInt8] {
    var list = [UInt8](repeating: 0, count: 4)
    be32(&list, 0, ops.count)
    for op in ops {
        var header = [UInt8](repeating: 0, count: 16)
        be32(&header, 0, op.id)
        be32(&header, 12, op.params.count)
        list += header + op.params
    }
    return list
}

/// A little-endian TIFF whose one IFD is a CFA sensor plane of 8064×4536
/// carrying `list` as its OpcodeList3.
private func dngHead(_ list: [UInt8], sensor: Bool = true) -> [UInt8] {
    let opAt = 256
    var buf = [UInt8](repeating: 0, count: opAt + list.count)
    buf[0] = 0x49
    buf[1] = 0x49
    le16(&buf, 2, 42)
    le32(&buf, 4, 8)
    let entries: [(tag: Int, type: Int, count: Int, value: Int)] = [
        (256, 4, 1, 8064),
        (257, 4, 1, 4536),
        (262, 3, 1, sensor ? 32803 : 2),
        (51022, 7, list.count, opAt),
    ]
    le16(&buf, 8, entries.count)
    for (i, e) in entries.enumerated() {
        let at = 10 + i * 12
        le16(&buf, at, e.tag)
        le16(&buf, at + 2, e.type)
        le32(&buf, at + 4, e.count)
        if e.type == 3 { le16(&buf, at + 8, e.value) } else { le32(&buf, at + 8, e.value) }
    }
    le32(&buf, 10 + entries.count * 12, 0)
    buf.replaceSubrange(opAt..<(opAt + list.count), with: list)
    return buf
}

private let shaded = gainMapParams([5.93, 1, 1, 1])
private let flat = gainMapParams([1, 1, 1, 1])

final class RawCalibrationLadderTests: XCTestCase {
    private let field = GainField(cols: 2, rows: 2, gains: [Float](repeating: 2, count: 16),
                                  originU: 0, originV: 0, stepU: 1, stepV: 1)
    private let warp = DngWarp(planes: [DngWarpPlane(radial: [1.05, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)

    func testOffersOnlyTheRungsTheFileCarries() {
        XCTAssertEqual(rungsFor(nil), [.proxy, .gain])
        let gainOnly = RawCalibration(gain: field, warp: nil, width: 8064, height: 4536, summary: "")
        XCTAssertEqual(rungsFor(gainOnly), [.proxy, .gain, .gainMap])
        let both = RawCalibration(gain: field, warp: warp, width: 8064, height: 4536, summary: "")
        XCTAssertEqual(rungsFor(both), [.proxy, .gain, .gainMap, .gainMapWarp])
        // A warp with no grid offers neither calibrated rung: the warp sits on top of the map.
        let warpOnly = RawCalibration(gain: nil, warp: warp, width: 8064, height: 4536, summary: "")
        XCTAssertEqual(rungsFor(warpOnly), [.proxy, .gain])
        XCTAssertEqual(topRung(nil), .gain)
        XCTAssertEqual(topRung(both), .gainMapWarp)
    }

    func testARungContainsTheOneBelowItAndNothingBelowTheGainMap() {
        let both = RawCalibration(gain: field, warp: warp, width: 8064, height: 4536, summary: "")
        XCTAssertEqual(calibrationAt(nil, both), .nothing)
        XCTAssertEqual(calibrationAt(.proxy, both), .nothing)
        XCTAssertEqual(calibrationAt(.gain, both), .nothing)
        XCTAssertEqual(calibrationAt(.gainMap, both), CalibrationAt(gain: field, warp: nil))
        XCTAssertEqual(calibrationAt(.gainMapWarp, both), CalibrationAt(gain: field, warp: warp))
        XCTAssertEqual(calibrationAt(.gainMapWarp, nil), .nothing)
    }
}

final class RawCalibrationFromHeadTests: XCTestCase {
    func testLaysTheFilesGridOverTheSensorAndSaysWhatItAsks() {
        let cal = rawCalibrationFrom(head: dngHead(opcodeList([(9, shaded), (1, warpParams(1.0493))])))
        XCTAssertNotNil(cal)
        XCTAssertEqual(cal?.width, 8064)
        XCTAssertEqual(cal?.height, 4536)
        assertClose(maxGain(cal?.gain), 5.93, 2)
        XCTAssertEqual(cal?.warp?.planes.first?.radial.first, 1.0493)
        XCTAssertEqual(cal?.summary, "gain map up to 5.93× · warp ×1.049")
    }

    func testOffersNothingForAFlatGridAnIdentityWarpOrAHeadWithNoSensor() {
        XCTAssertNil(rawCalibrationFrom(head: dngHead(opcodeList([(9, flat)]))))
        XCTAssertNil(rawCalibrationFrom(head: dngHead(opcodeList([(1, warpParams(1))]))))
        // A flat grid beside a real warp: the warp alone survives.
        let warpOnly = rawCalibrationFrom(head: dngHead(opcodeList([(9, flat), (1, warpParams(1.02))])))
        XCTAssertNil(warpOnly?.gain)
        XCTAssertNotNil(warpOnly?.warp)
        // The rectangle is in the SENSOR's pixels: with no sensor plane, nothing to lay it over.
        XCTAssertNil(rawCalibrationFrom(head: dngHead(opcodeList([(9, shaded)]), sensor: false)))
        XCTAssertNil(rawCalibrationFrom(head: [0xff, 0xd8, 0xff, 0xe0]))
    }

    func testSaysWhatIsNotAppliedBesideWhatIs() {
        let cal = rawCalibrationFrom(head: dngHead(opcodeList([(9, shaded), (4, [0, 0, 0, 0])])))
        XCTAssertEqual(cal?.summary, "gain map up to 5.93× · 1 not applied")
    }
}

final class RawCalibrationStoreTests: XCTestCase {
    func testReadsAFileOnceAndHoldsTheAnswerEvenWhenItIsNone() {
        let store = RawCalibrationStore()
        let head = dngHead(opcodeList([(9, shaded)]))
        var reads = 0
        let key = fileKey(name: "DJI_0101.DNG", size: head.count, lastModified: 1_700_000_000_000)
        XCTAssertTrue(store.held(key) == nil, "nothing held before a read")
        for _ in 0..<3 {
            let cal = store.read(key, fileSize: head.count) { range in
                reads += 1
                return Array(head[range])
            }
            XCTAssertNotNil(cal?.gain)
        }
        XCTAssertEqual(reads, 1)
        XCTAssertNotNil(store.held(key)??.gain)

        // A read that throws is an answer too, held like any other.
        struct Unreadable: Error {}
        let other = fileKey(name: "gone.DNG", size: 10, lastModified: 0)
        XCTAssertNil(store.read(other, fileSize: 10) { _ in throw Unreadable() })
        let heldNone = store.held(other)
        XCTAssertTrue(heldNone != nil && heldNone! == nil, "a file with none is held as none")
        let noFile = store.held(nil)
        XCTAssertTrue(noFile != nil && noFile! == nil, "no file at all answers none")
    }
}
