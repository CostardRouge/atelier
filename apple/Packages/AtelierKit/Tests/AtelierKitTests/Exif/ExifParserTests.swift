// Port of `src/shared/exif/exif-parser.test.ts`, plus a few cases of this
// port's own pinning the byte order and the string decoding the web spec
// leaves to its readers.

import Foundation
import XCTest
@testable import AtelierKit

/// An EXIF record with a few fields set — the web's object literal, in any order.
func exifData(_ change: (inout ExifData) -> Void) -> ExifData {
    var d = ExifData()
    change(&d)
    return d
}

// MARK: - a tiny TIFF encoder, the web spec's `buildTiff`

/// One entry to write. Mirrors the web's `EntryInput`: ASCII, SHORT, LONG,
/// RATIONAL or SRATIONAL values, laid out little-endian by default.
enum TiffEntryInput {
    case ascii(tag: Int, String)
    case shorts(tag: Int, [Int])
    case longs(tag: Int, [Int])
    case rationals(tag: Int, [(Int, Int)])
    case srationals(tag: Int, [(Int, Int)])

    var tag: Int {
        switch self {
        case .ascii(let tag, _), .shorts(let tag, _), .longs(let tag, _), .rationals(let tag, _), .srationals(let tag, _):
            return tag
        }
    }

    var type: Int {
        switch self {
        case .ascii: return 2
        case .shorts: return 3
        case .longs: return 4
        case .rationals: return 5
        case .srationals: return 10
        }
    }
}

private func put16(_ buf: inout [UInt8], _ at: Int, _ v: Int, little: Bool) {
    let u = UInt16(truncatingIfNeeded: v)
    let lo = UInt8(u & 0xff)
    let hi = UInt8(u >> 8)
    if little { buf[at] = lo; buf[at + 1] = hi } else { buf[at] = hi; buf[at + 1] = lo }
}

private func put32(_ buf: inout [UInt8], _ at: Int, _ v: Int, little: Bool) {
    let u = UInt32(truncatingIfNeeded: v)
    for i in 0..<4 {
        let byte = UInt8((u >> (8 * UInt32(i))) & 0xff)
        buf[at + (little ? i : 3 - i)] = byte
    }
}

private func encodeValue(_ entry: TiffEntryInput, little: Bool) -> (count: Int, bytes: [UInt8]) {
    switch entry {
    case .ascii(_, let text):
        return (text.utf8.count + 1, Array(text.utf8) + [0])
    case .shorts(_, let values):
        var bytes = [UInt8](repeating: 0, count: 2 * values.count)
        for (i, v) in values.enumerated() { put16(&bytes, i * 2, v, little: little) }
        return (values.count, bytes)
    case .longs(_, let values):
        var bytes = [UInt8](repeating: 0, count: 4 * values.count)
        for (i, v) in values.enumerated() { put32(&bytes, i * 4, v, little: little) }
        return (values.count, bytes)
    case .rationals(_, let pairs), .srationals(_, let pairs):
        var bytes = [UInt8](repeating: 0, count: 8 * pairs.count)
        for (i, pair) in pairs.enumerated() {
            put32(&bytes, i * 8, pair.0, little: little)
            put32(&bytes, i * 8 + 4, pair.1, little: little)
        }
        return (pairs.count, bytes)
    }
}

private struct Placed {
    var tag: Int
    var type: Int
    var count: Int
    var inline: [UInt8]?
    var offset: Int?
}

/// Lays out IFD0 → (Exif sub-IFD) → (GPS sub-IFD) → a heap for values that
/// don't fit inline, wiring the sub-IFD pointer tags automatically. Doubling
/// as documentation of the on-disk shape the parser walks.
func buildTiff(_ ifd0In: [TiffEntryInput], _ exifIn: [TiffEntryInput] = [], _ gpsIn: [TiffEntryInput] = [],
               little: Bool = true) -> [UInt8] {
    func ifdBytes(_ n: Int) -> Int { n > 0 ? 2 + 12 * n + 4 : 0 }
    let nPtr = (exifIn.isEmpty ? 0 : 1) + (gpsIn.isEmpty ? 0 : 1)
    let ifd0Off = 8
    let exifOff = ifd0Off + ifdBytes(ifd0In.count + nPtr)
    let gpsOff = exifOff + ifdBytes(exifIn.count)
    let heapStart = gpsOff + ifdBytes(gpsIn.count)

    var ifd0 = ifd0In
    if !exifIn.isEmpty { ifd0.append(.longs(tag: 0x8769, [exifOff])) }
    if !gpsIn.isEmpty { ifd0.append(.longs(tag: 0x8825, [gpsOff])) }

    var heapCursor = heapStart
    var heapChunks: [(at: Int, bytes: [UInt8])] = []
    func place(_ entries: [TiffEntryInput]) -> [Placed] {
        entries.map { e in
            let (count, bytes) = encodeValue(e, little: little)
            if bytes.count <= 4 {
                var inline = [UInt8](repeating: 0, count: 4)
                for (i, b) in bytes.enumerated() { inline[i] = b }
                return Placed(tag: e.tag, type: e.type, count: count, inline: inline, offset: nil)
            }
            if heapCursor % 2 == 1 { heapCursor += 1 }
            let at = heapCursor
            heapChunks.append((at, bytes))
            heapCursor += bytes.count
            return Placed(tag: e.tag, type: e.type, count: count, inline: nil, offset: at)
        }
    }

    let ifd0Placed = place(ifd0)
    let exifPlaced = place(exifIn)
    let gpsPlaced = place(gpsIn)

    var buf = [UInt8](repeating: 0, count: heapCursor)
    let bom: UInt8 = little ? 0x49 : 0x4d
    buf[0] = bom
    buf[1] = bom
    put16(&buf, 2, 0x002a, little: little)
    put32(&buf, 4, ifd0Off, little: little)

    func writeIfd(_ offset: Int, _ placed: [Placed]) {
        if placed.isEmpty { return }
        put16(&buf, offset, placed.count, little: little)
        for (i, p) in placed.enumerated() {
            let eo = offset + 2 + i * 12
            put16(&buf, eo, p.tag, little: little)
            put16(&buf, eo + 2, p.type, little: little)
            put32(&buf, eo + 4, p.count, little: little)
            if let inline = p.inline {
                for (k, b) in inline.enumerated() { buf[eo + 8 + k] = b }
            } else {
                put32(&buf, eo + 8, p.offset ?? 0, little: little)
            }
        }
        put32(&buf, offset + 2 + placed.count * 12, 0, little: little)
    }
    writeIfd(ifd0Off, ifd0Placed)
    writeIfd(exifOff, exifPlaced)
    writeIfd(gpsOff, gpsPlaced)
    for chunk in heapChunks {
        for (k, b) in chunk.bytes.enumerated() { buf[chunk.at + k] = b }
    }
    return buf
}

/// Wrap a TIFF block in a minimal JPEG `APP1` (Exif) segment.
func wrapJpeg(_ tiff: [UInt8]) -> [UInt8] {
    let segLen = 8 + tiff.count // 2 length bytes + "Exif\0\0" + tiff
    var u8 = [UInt8](repeating: 0, count: 2 + 2 + segLen + 2)
    put16(&u8, 0, 0xffd8, little: false) // SOI
    put16(&u8, 2, 0xffe1, little: false) // APP1
    put16(&u8, 4, segLen, little: false) // segment length (big-endian)
    let header: [UInt8] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
    for (i, b) in header.enumerated() { u8[6 + i] = b }
    for (i, b) in tiff.enumerated() { u8[12 + i] = b }
    put16(&u8, 12 + tiff.count, 0xffd9, little: false) // EOI
    return u8
}

// A representative SONY frame: camera, exposure, and a San Francisco location.
private func sonyFixture(little: Bool = true) -> [UInt8] {
    buildTiff(
        [
            .ascii(tag: 0x010f, "SONY"),
            .ascii(tag: 0x0110, "ILCE-7M3"),
            .shorts(tag: 0x0112, [6]), // orientation: rotated 90° CW
        ],
        [
            .shorts(tag: 0x8827, [400]), // ISO
            .rationals(tag: 0x829d, [(28, 10)]), // FNumber 2.8
            .rationals(tag: 0x829a, [(1, 200)]), // ExposureTime 1/200
            .rationals(tag: 0x920a, [(24, 1)]), // FocalLength 24mm
            .srationals(tag: 0x9204, [(1, 3)]), // ExposureBias +0.33 EV
            .ascii(tag: 0x9003, "2026:05:30 05:49:34"), // DateTimeOriginal
        ],
        [
            .ascii(tag: 0x0001, "N"), // lat ref
            .rationals(tag: 0x0002, [(37, 1), (46, 1), (2964, 100)]), // 37° 46' 29.64"
            .ascii(tag: 0x0003, "W"), // lon ref
            .rationals(tag: 0x0004, [(122, 1), (25, 1), (984, 100)]), // 122° 25' 9.84"
        ],
        little: little
    )
}

final class ExifParserTests: XCTestCase {
    private let fixture = sonyFixture()
    private lazy var data = parseExif(fixture)

    func testReadsTheCameraBodyAndOrientationFromIfd0() {
        XCTAssertEqual(data.make, "SONY")
        XCTAssertEqual(data.model, "ILCE-7M3")
        XCTAssertEqual(data.orientation, 6)
    }

    func testReadsExposureFieldsFromTheExifSubIfd() {
        XCTAssertEqual(data.iso, 400)
        assertClose(data.fNumber ?? 0, 2.8, 5)
        assertClose(data.exposureTime ?? 0, 0.005, 5)
        XCTAssertEqual(data.focalLength, 24)
        assertClose(data.exposureBias ?? 0, 0.333, 3)
        XCTAssertEqual(data.dateTimeOriginal, "2026:05:30 05:49:34")
    }

    func testConvertsGpsDmsAndHemisphereToSignedDecimalDegrees() {
        XCTAssertNotNil(data.gps)
        assertClose(data.gps?.lat ?? 0, 37.7749, 4)
        // West longitude is negative.
        assertClose(data.gps?.lon ?? 0, -122.4194, 4)
    }

    func testParsesTheSameDataWhenTheTiffIsWrappedInAJpegApp1() {
        let fromJpeg = parseExif(wrapJpeg(fixture))
        XCTAssertEqual(fromJpeg.make, "SONY")
        XCTAssertEqual(fromJpeg.model, "ILCE-7M3")
        assertClose(fromJpeg.fNumber ?? 0, 2.8, 5)
        assertClose(fromJpeg.gps?.lat ?? 0, 37.7749, 4)
    }

    func testReturnsAnEmptyResultForNonExifBytes() {
        let png: [UInt8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        XCTAssertTrue(isEmptyExif(parseExif(png)))
    }

    func testNeverThrowsOnATruncatedBuffer() {
        // The web asserts `not.toThrow()`; here, that the walk returns at all
        // and drops what fell outside the slice rather than trapping.
        let truncated = Array(fixture.prefix(20))
        let parsed = parseExif(truncated)
        XCTAssertNil(parsed.gps)
        _ = parseExif(Array(fixture.prefix(0)))
        _ = parseExif(Array(fixture.prefix(9)))
    }

    // MARK: - this port's own cases

    func testReadsABigEndianTiffTheSame() {
        let big = parseExif(sonyFixture(little: false))
        XCTAssertEqual(big.make, "SONY")
        XCTAssertEqual(big.orientation, 6)
        XCTAssertEqual(big.iso, 400)
        assertClose(big.fNumber ?? 0, 2.8, 5)
        assertClose(big.exposureBias ?? 0, 0.333, 3)
        assertClose(big.gps?.lon ?? 0, -122.4194, 4)
        XCTAssertEqual(big, data, "the byte order is the file's own; the record is one")
    }

    func testReadsFromADataTheSameAsFromBytes() {
        XCTAssertEqual(parseExif(Data(fixture)), data)
        // A slice whose start index is not 0 reads the same bytes.
        let padded = Data([0, 0, 0] + fixture)
        XCTAssertEqual(parseExif(padded[3...]), data)
    }

    func testReadsUtf8WhereTheBytesAreUtf8AndLatin1Otherwise() {
        let utf8 = parseExif(buildTiff([.ascii(tag: 0x8298, "© 2026 Steeve Pommier")]))
        XCTAssertEqual(utf8.copyright, "© 2026 Steeve Pommier")
        // An older body's Latin-1 `©` is the single byte 0xA9, which is not UTF-8.
        var latin = buildTiff([.ascii(tag: 0x8298, "X 2026")])
        if let x = latin.firstIndex(of: UInt8(ascii: "X")) { latin[x] = 0xa9 }
        XCTAssertEqual(parseExif(latin).copyright, "© 2026")
    }

    func testReadsAnAltitudeBelowSeaLevelAsNegative() {
        let below = buildTiff([], [], [
            .shorts(tag: 0x0005, [1]), // altRef: below sea level
            .rationals(tag: 0x0006, [(423, 10)]),
        ])
        assertClose(parseExif(below).gpsAltitude ?? 0, -42.3, 5)
        let above = buildTiff([], [], [.rationals(tag: 0x0006, [(423, 10)])])
        assertClose(parseExif(above).gpsAltitude ?? 0, 42.3, 5)
    }

    func testIsEmptyExifSeesOnlyARecordWithNoField() {
        XCTAssertTrue(isEmptyExif(ExifData()))
        XCTAssertFalse(isEmptyExif(ExifData(iso: 100)))
        XCTAssertFalse(isEmptyExif(data))
    }
}
