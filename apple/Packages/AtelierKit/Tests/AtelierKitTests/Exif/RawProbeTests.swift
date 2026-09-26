// Port of `src/shared/exif/raw-probe.test.ts`.
//
// A hand-built little-endian TIFF, the EXIF parser's own tradition: a real
// camera RAW is 60 MB of somebody's photograph and belongs nowhere near the
// repository, so the structure is written byte by byte here and every claim
// the probe makes is checked against bytes we chose. The web's `Blob` is an
// array here, read through `extractRawPreview(fileSize:read:)`'s closure.

import Foundation
import XCTest
@testable import AtelierKit

/// One field: SHORT (3) or LONG (4) values.
private struct Field {
    var tag: Int
    var type: Int
    var values: [Int]
}

private let SHORT = 3
private let LONG = 4

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

/// The web spec's `buildTiff`: header, then each IFD in order, then the
/// overflow values; IFD `i` may list SubIFDs by index.
private func buildTiff(_ ifds: [(fields: [Field], subIfdIndexes: [Int]?)], trailing: Int = 0) -> [UInt8] {
    let header = 8
    var ifdOffsets: [Int] = []
    var at = header
    for ifd in ifds {
        ifdOffsets.append(at)
        at += 2 + (ifd.fields.count + (ifd.subIfdIndexes != nil ? 1 : 0)) * 12 + 4
    }
    let overflowStart = at
    var buffer = [UInt8](repeating: 0, count: overflowStart + 4096 + trailing)
    le16(&buffer, 0, 0x4949)
    le16(&buffer, 2, 0x002a)
    le32(&buffer, 4, ifdOffsets[0])

    var overflowAt = overflowStart
    func writeField(_ entryAt: Int, _ f: Field) {
        le16(&buffer, entryAt, f.tag)
        le16(&buffer, entryAt + 2, f.type)
        le32(&buffer, entryAt + 4, f.values.count)
        let size = f.type == SHORT ? 2 : 4
        if f.values.count * size <= 4 {
            for (i, v) in f.values.enumerated() {
                if f.type == SHORT { le16(&buffer, entryAt + 8 + i * 2, v) } else { le32(&buffer, entryAt + 8, v) }
            }
        } else {
            le32(&buffer, entryAt + 8, overflowAt)
            for (i, v) in f.values.enumerated() {
                if f.type == SHORT { le16(&buffer, overflowAt + i * 2, v) } else { le32(&buffer, overflowAt + i * 4, v) }
            }
            overflowAt += f.values.count * size
        }
    }

    for (index, ifd) in ifds.enumerated() {
        let base = ifdOffsets[index]
        var fields = ifd.fields
        if let subs = ifd.subIfdIndexes {
            fields.append(Field(tag: 330, type: LONG, values: subs.map { ifdOffsets[$0] }))
        }
        fields.sort { $0.tag < $1.tag }
        le16(&buffer, base, fields.count)
        for (i, f) in fields.enumerated() { writeField(base + 2 + i * 12, f) }
        // Only IFD0 chains on, and only to nothing here.
        le32(&buffer, base + 2 + fields.count * 12, 0)
    }
    return buffer
}

/// A DNG shaped like a drone's: a small thumbnail in IFD0, the sensor plane
/// and a full-size JPEG render in SubIFDs, plus an opcode list.
private func droneDng(_ previewOffset: Int = 8000, _ previewLength: Int = 1200) -> [UInt8] {
    buildTiff([
        (fields: [
            // IFD0: the thumbnail render.
            Field(tag: 254, type: LONG, values: [1]),
            Field(tag: 256, type: SHORT, values: [256]),
            Field(tag: 257, type: SHORT, values: [171]),
            Field(tag: 259, type: SHORT, values: [7]),
            Field(tag: 262, type: SHORT, values: [6]),
            Field(tag: 513, type: LONG, values: [6000]),
            Field(tag: 514, type: LONG, values: [400]),
            Field(tag: 51008, type: LONG, values: [1]), // an opcode list
        ], subIfdIndexes: [1, 2]),
        (fields: [
            // SubIFD 0: the sensor plane — lossless JPEG, CFA. NOT a preview.
            Field(tag: 254, type: LONG, values: [0]),
            Field(tag: 256, type: SHORT, values: [8064]),
            Field(tag: 257, type: SHORT, values: [6048]),
            Field(tag: 259, type: SHORT, values: [7]),
            Field(tag: 262, type: SHORT, values: [32803]),
            Field(tag: 273, type: LONG, values: [20000]),
            Field(tag: 279, type: LONG, values: [3000]),
        ], subIfdIndexes: nil),
        (fields: [
            // SubIFD 1: the camera's full-size render.
            Field(tag: 254, type: LONG, values: [1]),
            Field(tag: 256, type: SHORT, values: [4032]),
            Field(tag: 257, type: SHORT, values: [3024]),
            Field(tag: 259, type: SHORT, values: [7]),
            Field(tag: 262, type: SHORT, values: [6]),
            Field(tag: 513, type: LONG, values: [previewOffset]),
            Field(tag: 514, type: LONG, values: [previewLength]),
        ], subIfdIndexes: nil),
    ])
}

/// An ARW shaped like a Sony's, shot with the body turned: IFD0 states how it
/// was held, SubIFD 0 is the sensor plane AS IT IS LAID OUT (landscape,
/// always), SubIFD 1 the camera's full-size render in those same axes.
private func portraitArw(
    orientation: Int? = 6,
    previewW: Int = 7008,
    previewH: Int = 4672,
    previewOrientation ownOrientation: Int? = nil,
    previewOffset: Int = 8000,
    previewLength: Int = 1200
) -> [UInt8] {
    var ifd0 = [
        Field(tag: 254, type: LONG, values: [1]),
        Field(tag: 256, type: SHORT, values: [160]),
        Field(tag: 257, type: SHORT, values: [120]),
        Field(tag: 259, type: SHORT, values: [7]),
        Field(tag: 262, type: SHORT, values: [6]),
        Field(tag: 513, type: LONG, values: [6000]),
        Field(tag: 514, type: LONG, values: [400]),
    ]
    // The web spreads the tag in only when the orientation is truthy.
    if let orientation, orientation != 0 { ifd0.append(Field(tag: 274, type: SHORT, values: [orientation])) }
    var render = [
        Field(tag: 254, type: LONG, values: [1]),
        Field(tag: 256, type: SHORT, values: [previewW]),
        Field(tag: 257, type: SHORT, values: [previewH]),
        Field(tag: 259, type: SHORT, values: [7]),
        Field(tag: 262, type: SHORT, values: [6]),
        Field(tag: 513, type: LONG, values: [previewOffset]),
        Field(tag: 514, type: LONG, values: [previewLength]),
    ]
    if let ownOrientation, ownOrientation != 0 { render.append(Field(tag: 274, type: SHORT, values: [ownOrientation])) }
    return buildTiff([
        (fields: ifd0, subIfdIndexes: [1, 2]),
        (fields: [
            // SubIFD 0: the sensor plane, uncompressed, CFA.
            Field(tag: 254, type: LONG, values: [0]),
            Field(tag: 256, type: SHORT, values: [7040]),
            Field(tag: 257, type: SHORT, values: [4688]),
            Field(tag: 259, type: SHORT, values: [1]),
            Field(tag: 262, type: SHORT, values: [32803]),
            Field(tag: 273, type: LONG, values: [20000]),
            Field(tag: 279, type: LONG, values: [3000]),
        ], subIfdIndexes: nil),
        (fields: render, subIfdIndexes: nil),
    ])
}

/// A real, minimal JPEG — what a splice needs, where a byte run would be refused.
private func previewJpeg(_ pixels: [UInt8] = [0x01, 0x02]) -> [UInt8] {
    [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02] + pixels + [0xff, 0xd9]
}

/// A file of `size` holding `buffer`'s IFDs, with `picture` laid at `at`.
private func fileWith(_ buffer: [UInt8], _ size: Int, _ at: Int, _ picture: [UInt8]) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: size)
    let n = min(buffer.count, size)
    bytes.replaceSubrange(0..<n, with: buffer[0..<n])
    bytes.replaceSubrange(at..<(at + picture.count), with: picture)
    return bytes
}

private func probe(_ bytes: [UInt8]) -> RawProbe {
    probeRaw(bytes)!
}

final class ProbeRawTests: XCTestCase {
    func testRefusesAnythingThatIsNotATiff() {
        XCTAssertNil(probeRaw([UInt8](repeating: 0, count: 4)))
        var jpeg = [UInt8](repeating: 0, count: 32)
        jpeg[0] = 0xff
        jpeg[1] = 0xd8
        XCTAssertNil(probeRaw(jpeg))
    }

    func testWalksIntoTheSubIfdsWhereADngKeepsThePictureThatMatters() {
        let p = probeRaw(droneDng())
        XCTAssertNotNil(p)
        XCTAssertEqual(p?.little, true)
        // IFD0 plus two SubIFDs — reading IFD0 alone would find the thumbnail only.
        XCTAssertEqual(p?.ifds.count, 3)
        XCTAssertEqual(p?.ifds[1].width, 8064)
    }

    func testPicksTheFullSizeRenderNotTheThumbnail() {
        XCTAssertEqual(probe(droneDng()).preview, RawPreview(offset: 8000, length: 1200, width: 4032, height: 3024))
    }

    func testNeverMistakesTheSensorPlaneForAPreviewThoughItIsJpegToo() {
        // A DNG's CFA plane is compression 7 as well, and handing those bytes
        // to a decoder gives a mosaic, not a picture.
        let p = probe(droneDng())
        XCTAssertNotEqual(p.preview?.offset, 20000)
        XCTAssertEqual(sensorIfd(p)?.photometric, 32803)
        XCTAssertEqual(sensorIfd(p)?.width, 8064)
    }

    func testReportsTheOpcodeListsANaiveDecodeWouldSkip() {
        XCTAssertEqual(probe(droneDng()).opcodes, [51008])
    }

    func testKeepsAPreviewThatSitsFarPastTheHeadItWasReadFrom() {
        // The probe sees only the first megabyte, and a full-size render in a
        // 60 MB DNG lives well beyond it.
        XCTAssertEqual(
            probe(droneDng(45_000_000, 4_000_000)).preview,
            RawPreview(offset: 45_000_000, length: 4_000_000, width: 4032, height: 3024)
        )
    }

    func testAnswersNoPreviewForAFileThatCarriesOnlyASensorPlane() {
        let bare = buildTiff([
            (fields: [
                Field(tag: 256, type: SHORT, values: [6000]),
                Field(tag: 257, type: SHORT, values: [4000]),
                Field(tag: 259, type: SHORT, values: [52546]), // JPEG XL tiles
                Field(tag: 262, type: SHORT, values: [32803]),
                Field(tag: 273, type: LONG, values: [900]),
                Field(tag: 279, type: LONG, values: [500]),
            ], subIfdIndexes: nil),
        ])
        let p = probe(bare)
        XCTAssertNil(p.preview)
        XCTAssertEqual(describeRaw(p), "6000×4000 · sensor JPEG XL · no embedded preview")
    }

    /// This port's own: a SubIFD pointer a corrupt file makes negative trips
    /// the whole probe, as the web's `DataView` does.
    func testRefusesAFileWhoseSubIfdPointerIsNegative() {
        var bytes = droneDng()
        // IFD0's SubIFDs entry (tag 330) holds two LONGs out of line; make the
        // first one SLONG −8.
        let view = ByteView(bytes)
        let ifd0 = Int(view.uint32(4, little: true))
        let count = Int(view.uint16(ifd0, little: true))
        for i in 0..<count where view.uint16(ifd0 + 2 + i * 12, little: true) == 330 {
            let entry = ifd0 + 2 + i * 12
            le16(&bytes, entry + 2, 9)
            let values = Int(view.uint32(entry + 8, little: true))
            le32(&bytes, values, -8)
        }
        XCTAssertNil(probeRaw(bytes))
    }
}

final class RawCalibrationThroughTheProbeTests: XCTestCase {
    func testReadsOpcodeList3OutOfADngHeadAndSaysWhatItAsksFor() {
        // A minimal TIFF whose IFD0 carries tag 51022 (OpcodeList3) with one
        // GainMap: 1 plane, a 2x2 grid whose corner asks for 5.93x.
        let gains: [Float] = [5.93, 1, 1, 1]
        var params = [UInt8](repeating: 0, count: 76 + gains.count * 4)
        for (i, n) in [0, 0, 4536, 8064, 0, 3, 1, 1, 2, 2].enumerated() { be32(&params, i * 4, n) }
        beF64(&params, 40, 1)
        beF64(&params, 48, 1)
        beF64(&params, 56, 0)
        beF64(&params, 64, 0)
        be32(&params, 72, 1)
        for (i, g) in gains.enumerated() { beF32(&params, 76 + i * 4, g) }

        var list = [UInt8](repeating: 0, count: 4 + 16 + params.count)
        be32(&list, 0, 1)
        be32(&list, 4, 9)
        be32(&list, 16, params.count)
        list.replaceSubrange(20..<(20 + params.count), with: params)

        let opAt = 256
        var buf = [UInt8](repeating: 0, count: opAt + list.count)
        buf[0] = 0x49
        buf[1] = 0x49
        le16(&buf, 2, 42)
        le32(&buf, 4, 8)
        le16(&buf, 8, 1) // one entry
        le16(&buf, 10, 51022)
        le16(&buf, 12, 7) // UNDEFINED
        le32(&buf, 14, list.count)
        le32(&buf, 18, opAt)
        le32(&buf, 22, 0)
        buf.replaceSubrange(opAt..<(opAt + list.count), with: list)

        let p = probeRaw(buf)
        XCTAssertEqual(p?.opcodes, [51022])
        XCTAssertEqual(p?.calibration?.gainMaps.count, 1)
        assertClose(Double(p?.calibration?.gainMaps.first?.gains.first ?? .nan), 5.93, 2)
        XCTAssertTrue(describeRaw(p!).contains("gain map 2×2 ×1 · up to 5.93×"), describeRaw(p!))
    }
}

final class DescribeCompressionAndRawTests: XCTestCase {
    func testNamesTheCodesThatDecideTheDecoderQuestion() {
        XCTAssertEqual(describeCompression(52546), "JPEG XL")
        XCTAssertEqual(describeCompression(7), "JPEG")
        XCTAssertEqual(describeCompression(1), "uncompressed")
        XCTAssertEqual(describeCompression(34892), "lossy JPEG")
        XCTAssertEqual(describeCompression(nil), "unstated")
        XCTAssertEqual(describeCompression(999), "compression 999")
    }

    func testSaysWhatAFileIsInOneLine() {
        XCTAssertEqual(describeRaw(probe(droneDng())), "8064×6048 · sensor JPEG · preview 4032×3024 · 1 opcode list")
    }
}

final class ExtractRawPreviewTests: XCTestCase {
    /// A file whose bytes past the header are a recognisable run.
    private func fileOf(_ buffer: [UInt8], _ size: Int) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: size)
        let n = min(buffer.count, size)
        bytes.replaceSubrange(0..<n, with: buffer[0..<n])
        for i in 8000..<min(size, 9200) { bytes[i] = 0xab }
        return bytes
    }

    func testSlicesTheCamerasOwnRenderOutWithoutReadingTheWholeFile() throws {
        let file = fileOf(droneDng(), 60_000)
        var largest = 0
        let preview = extractRawPreview(fileSize: file.count) { range -> [UInt8] in
            largest = max(largest, range.count)
            return Array(file[range])
        }
        let bytes = try XCTUnwrap(preview)
        XCTAssertEqual(bytes.count, 1200)
        XCTAssertEqual(bytes.first, 0xab)
        // The web's `Blob` says `image/jpeg`; the kernel hands bytes. What this
        // port pins instead is that no read asked for more than the head.
        XCTAssertLessThanOrEqual(largest, rawProbeBytes)
    }

    func testAnswersNilRatherThanAnEmptySliceWhenThePointerIsPastTheFile() {
        // A truncated or malformed RAW: no preview beats bytes that fail to
        // decode three layers later with nothing to say.
        XCTAssertNil(extractRawPreview(fileOf(droneDng(45_000_000, 4_000_000), 60_000)))
    }

    func testAnswersNilForAFileThatIsNotARawAtAll() {
        XCTAssertNil(extractRawPreview([UInt8](repeating: 0, count: 64)))
    }
}

final class RawOrientationTests: XCTestCase {
    func testReadsIfd0sTagAndAnswersNilForAFileThatSaysNothing() {
        XCTAssertEqual(probe(portraitArw()).orientation, 6)
        XCTAssertNil(probe(droneDng()).orientation)
    }

    func testGivesTheCamerasTurnToARenderNobodyHasTurned() {
        XCTAssertEqual(previewOrientation(probe(portraitArw())), 6)
    }

    func testWithdrawsItWhereThereIsNothingToApply() {
        XCTAssertEqual(previewOrientation(probe(droneDng())), 1)
        XCTAssertEqual(previewOrientation(probe(portraitArw(orientation: 1))), 1)
    }

    func testWithdrawsItFromARenderTheCameraAlreadyTurned() {
        // Its frame is the transpose of the sensor plane's, so it has been
        // turned once: turning it again would lay the photograph down.
        let p = probe(portraitArw(previewW: 4672, previewH: 7008))
        XCTAssertEqual(p.orientation, 6)
        XCTAssertEqual(previewOrientation(p), 1)
    }

    func testAsksTheShapeOnlyOfTheQuarterTurns() {
        // A half turn leaves the frame as it was, so shape says nothing about it.
        XCTAssertEqual(previewOrientation(probe(portraitArw(orientation: 3))), 3)
    }

    func testLetsARenderThatStatesItsOwnOrientationAnswerForItself() {
        let p = probe(portraitArw(orientation: 6, previewOrientation: 8))
        XCTAssertEqual(previewOrientation(p), 8)
    }
}

final class ExtractRawPreviewOrientationTests: XCTestCase {
    func testSplicesABlockInLeavingThePicturesOwnBytesUntouched() throws {
        let picture = previewJpeg()
        let file = fileWith(portraitArw(previewLength: picture.count), 60_000, 8000, picture)
        let bytes = try XCTUnwrap(extractRawPreview(file))
        let block = try XCTUnwrap(readExifBlock(bytes))
        XCTAssertEqual(parseExif(block).orientation, 6)
        // A header was ADDED and nothing else: past the segment, byte for
        // byte what the camera wrote.
        XCTAssertEqual(bytes.count, picture.count + 36)
        XCTAssertEqual(Array(bytes[38...]), Array(picture[2...]))
    }

    func testHandsBackTheByteExactSliceWhenNothingNeedsTurning() throws {
        let picture = previewJpeg()
        let file = fileWith(droneDng(8000, picture.count), 60_000, 8000, picture)
        let out = try XCTUnwrap(extractRawPreview(file))
        XCTAssertEqual(out.count, picture.count)
        XCTAssertNil(readExifBlock(out))
    }

    func testNeverInsertsAheadOfARenderThatCarriesItsOwnBlock() throws {
        let own = try withExifBlock(previewJpeg(), buildOrientationBlock(8))
        let file = fileWith(portraitArw(previewLength: own.count), 60_000, 8000, own)
        let out = try XCTUnwrap(extractRawPreview(file))
        XCTAssertEqual(out.count, own.count)
        let read = try XCTUnwrap(readExifBlock(out))
        XCTAssertEqual(parseExif(read).orientation, 8)
    }

    func testCostsThePictureNothingWhenTheBytesAreNotAJpegAtAll() throws {
        // A pointer into something that will not splice must still deliver
        // the render: the turn is worth less than the photograph.
        let run = [UInt8](repeating: 0xab, count: 1200)
        let file = fileWith(portraitArw(), 60_000, 8000, run)
        let out = try XCTUnwrap(extractRawPreview(file))
        XCTAssertEqual(out.count, 1200)
        XCTAssertEqual(out.first, 0xab)
    }
}

final class RawSizesFromTests: XCTestCase {
    func testTurnsBothSizesForACaptureTheBodyWasTurnedFor() {
        let sizes = rawSizesFrom(portraitArw())
        XCTAssertEqual(sizes.sensor, Size(width: 4688, height: 7040))
        XCTAssertEqual(sizes.render, Size(width: 4672, height: 7008))
        XCTAssertEqual(sizes.orientation, 6)
    }

    func testLeavesThemExactlyAsStatedWhereNothingTurns() {
        XCTAssertEqual(rawSizesFrom(droneDng()).sensor, Size(width: 8064, height: 6048))
        XCTAssertNil(rawSizesFrom(droneDng()).orientation)
        XCTAssertEqual(rawSizesFrom(portraitArw(orientation: 1)).render, Size(width: 7008, height: 4672))
        // A half turn and a mirror keep the frame: only 5 to 8 swap the axes.
        XCTAssertEqual(rawSizesFrom(portraitArw(orientation: 3)).render, Size(width: 7008, height: 4672))
        XCTAssertEqual(rawSizesFrom(portraitArw(orientation: 2)).sensor, Size(width: 7040, height: 4688))
    }

    func testTurnsTheSensorWithoutTurningARenderThatWasTurnedAlready() {
        let sizes = rawSizesFrom(portraitArw(previewW: 4672, previewH: 7008))
        XCTAssertEqual(sizes.sensor, Size(width: 4688, height: 7040))
        XCTAssertEqual(sizes.render, Size(width: 4672, height: 7008))
    }

    func testLeavesSensorIfdOnTheStoredPlane() {
        XCTAssertEqual(sensorIfd(probe(portraitArw()))?.width, 7040)
        XCTAssertEqual(sensorIfd(probe(portraitArw()))?.height, 4688)
    }

    /// This port's own: the reading halves over a `read` closure, and what
    /// they answer when the read fails.
    func testReadsTheSizesAndTheCalibrationFromAHeadAndSurvivesAFailedRead() {
        let file = droneDng()
        XCTAssertEqual(rawSizes(fileSize: file.count) { Array(file[$0]) }.sensor, Size(width: 8064, height: 6048))
        XCTAssertNil(rawCalibration(fileSize: file.count) { Array(file[$0]) })
        struct Refused: Error {}
        XCTAssertEqual(rawSizes(fileSize: 10) { _ in throw Refused() }, RawSizes())
        XCTAssertNil(rawCalibration(fileSize: 10) { _ in throw Refused() })
    }
}
