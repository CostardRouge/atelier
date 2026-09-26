// Port of `src/shared/exif/exif-block.test.ts`. Every block built here is
// parsed back through `ExifParser.swift`, and every byte offset the web spec
// asserts is asserted at the same offset.

import Foundation
import XCTest
@testable import AtelierKit

private let exifIdBytes: [UInt8] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]

/// A JPEG with no metadata at all — what a canvas hands over.
private func bareJpeg(_ pixels: [UInt8] = [0x01, 0x02, 0x03]) -> [UInt8] {
    [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02] + pixels + [0xff, 0xd9]
}

/// A JPEG opening on a JFIF `APP0`, the way Safari writes one.
private func jfifJpeg() -> [UInt8] {
    [
        0xff, 0xd8,
        0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
        0xff, 0xda, 0x00, 0x02, 0x11, 0x22,
        0xff, 0xd9,
    ]
}

/// A JPEG that already carries an EXIF segment, to be replaced.
private func jpegWithExif(_ block: [UInt8]) -> [UInt8] {
    try! withExifBlock(bareJpeg(), block)
}

/// Find an IFD0 entry's value slot, for the tests that need to forge one.
private func entrySlot(_ block: [UInt8], _ tag: Int) -> Int? {
    let view = ByteView(block)
    let ifd0 = Int(view.uint32(4, little: true))
    let count = Int(view.uint16(ifd0, little: true))
    for i in 0..<count {
        let entry = ifd0 + 2 + i * 12
        if Int(view.uint16(entry, little: true)) == tag { return entry + 8 }
    }
    return nil
}

private func setLE16(_ bytes: inout [UInt8], _ at: Int, _ value: Int) {
    bytes[at] = UInt8(value & 0xff)
    bytes[at + 1] = UInt8((value >> 8) & 0xff)
}

private func setLE32(_ bytes: inout [UInt8], _ at: Int, _ value: Int) {
    for i in 0..<4 { bytes[at + i] = UInt8((value >> (8 * i)) & 0xff) }
}

private let sample = buildExifBlock(exifData {
    $0.make = "DJI"
    $0.model = "FC8482"
    $0.iso = 100
    $0.gps = GpsCoord(lat: 64.1466, lon: -21.9426)
    $0.dateTimeOriginal = "2026:07:14 18:32:05"
})

/// The thrown error's text, as the web's `toThrow(/…/)` reads it.
private func thrownText(_ body: () throws -> Any) -> String? {
    do {
        _ = try body()
        return nil
    } catch {
        return "\(error)"
    }
}

final class ReadExifBlockTests: XCTestCase {
    func testFindsNothingInACanvasJpeg() {
        XCTAssertNil(readExifBlock(bareJpeg()))
        XCTAssertNil(readExifBlock(jfifJpeg()))
        XCTAssertNil(readExifBlock([1, 2, 3, 4, 5]))
    }

    func testGivesBackExactlyTheBlockThatWasPutIn() {
        let read = readExifBlock(jpegWithExif(sample))
        XCTAssertNotNil(read)
        XCTAssertEqual(read, sample)
    }
}

final class WithExifBlockTests: XCTestCase {
    func testPutsTheSegmentRightAfterTheSoiAndLeavesTheRestOfTheFileAlone() throws {
        let bare = bareJpeg()
        let out = try withExifBlock(bare, sample)
        XCTAssertEqual(Array(out[0..<2]), [0xff, 0xd8])
        XCTAssertEqual(Array(out[2..<4]), [0xff, 0xe1])
        // The length counts itself, the identifier and the block.
        XCTAssertEqual(Array(out[4..<6]), [UInt8((sample.count + 8) >> 8), UInt8((sample.count + 8) & 0xff)])
        XCTAssertEqual(Array(out[6..<12]), exifIdBytes)
        XCTAssertEqual(Array(out[(2 + 10 + sample.count)...]), Array(bare[2...]))
    }

    func testGoesAfterAJfifApp0WhichTheFormatKeepsFirst() throws {
        let out = try withExifBlock(jfifJpeg(), sample)
        XCTAssertEqual(Array(out[2..<4]), [0xff, 0xe0])
        XCTAssertEqual(Array(out[10..<12]), [0xff, 0xe1])
        XCTAssertEqual(parseExif(out).make, "DJI")
    }

    func testReplacesAnExifSegmentRatherThanAddingASecondOne() throws {
        let once = jpegWithExif(sample)
        let other = buildExifBlock(exifData { $0.make = "Apple"; $0.model = "iPhone 17 Pro" })
        let twice = try withExifBlock(once, other)
        XCTAssertEqual(parseExif(twice).make, "Apple")
        // One segment, so the file grew only by the difference between the blocks.
        XCTAssertEqual(twice.count, once.count - sample.count + other.count)
    }

    func testIsReadBackByTheParserThatReadsACameraFile() {
        let read = parseExif(jpegWithExif(sample))
        XCTAssertEqual(read.model, "FC8482")
        XCTAssertEqual(read.iso, 100)
        assertClose(read.gps?.lat ?? .nan, 64.1466, 6)
        XCTAssertEqual(read.dateTimeOriginal, "2026:07:14 18:32:05")
    }

    func testRefusesABlockNoSegmentCouldHoldRatherThanWritingAnUnreadableFile() {
        let tooBig = [UInt8](repeating: 0, count: exifBlockMax + 1)
        let oversize = thrownText { try withExifBlock(bareJpeg(), tooBig) }
        XCTAssertNotNil(oversize)
        XCTAssertTrue(oversize?.contains("segment holds") ?? false, oversize ?? "")
        let notJpeg = thrownText { try withExifBlock([1, 2, 3], sample) }
        XCTAssertTrue(notJpeg?.contains("not a JPEG") ?? false, notJpeg ?? "")
    }
}

final class RetagExifBlockTests: XCTestCase {
    func testResetsAnOrientationTheDevelopmentHasAlreadyApplied() throws {
        var turned = sample
        let slot = try XCTUnwrap(entrySlot(turned, 0x0112))
        setLE16(&turned, slot, 6)
        XCTAssertEqual(parseExif(turned).orientation, 6)
        XCTAssertEqual(parseExif(retagExifBlock(turned)).orientation, 1)
    }

    func testCorrectsTheDimensionsToTheOnesDelivered() {
        let block = buildExifBlock(exifData { $0.make = "DJI"; $0.pixelWidth = 8064; $0.pixelHeight = 6048 })
        let read = parseExif(retagExifBlock(block, RetagOptions(pixelWidth: 1920, pixelHeight: 1440)))
        XCTAssertEqual(read.pixelWidth, 1920)
        XCTAssertEqual(read.pixelHeight, 1440)
        XCTAssertEqual(read.make, "DJI")
    }

    func testCutsTheThumbnailsDirectoryLoose() {
        var withThumb = sample
        let view = ByteView(withThumb)
        let ifd0 = Int(view.uint32(4, little: true))
        let next = ifd0 + 2 + Int(view.uint16(ifd0, little: true)) * 12
        setLE32(&withThumb, next, 4242)
        XCTAssertEqual(ByteView(withThumb).uint32(next, little: true), 4242)
        let out = retagExifBlock(withThumb)
        XCTAssertEqual(ByteView(out).uint32(next, little: true), 0)
    }

    func testGivesABlockItCannotReadBackUnchanged() {
        let junk: [UInt8] = [9, 9, 9, 9, 9, 9, 9, 9, 9]
        XCTAssertEqual(retagExifBlock(junk), junk)
        XCTAssertEqual(retagExifBlock([UInt8](repeating: 0, count: 3)), [0, 0, 0])
    }

    func testDoesNotTouchWhatItWasNotAskedAbout() {
        let read = parseExif(retagExifBlock(sample))
        XCTAssertEqual(read.make, "DJI")
        assertClose(read.gps?.lon ?? .nan, -21.9426, 6)
        XCTAssertEqual(read.dateTimeOriginal, "2026:07:14 18:32:05")
        XCTAssertNil(read.software)
    }

    // MARK: software

    func testSoftwareWritesOverTheCamerasOwnEntryWhenItIsWideEnoughMovingNothing() {
        // A Sony body writes its firmware there — sixteen bytes, room for ours.
        let block = buildExifBlock(exifData { $0.make = "SONY"; $0.model = "ILCE-7CM2"; $0.software = "ILCE-7CM2 v1.00" })
        let out = retagExifBlock(block, RetagOptions(software: "Atelier"))
        XCTAssertEqual(out.count, block.count)
        let read = parseExif(out)
        XCTAssertEqual(read.software, "Atelier")
        XCTAssertEqual(read.model, "ILCE-7CM2")
    }

    func testSoftwareAddsTheEntryToABlockThatHasNoneByCopyingIfd0ToTheEnd() {
        let out = retagExifBlock(sample, RetagOptions(pixelWidth: 1920, pixelHeight: 1440, software: "Atelier"))
        XCTAssertGreaterThan(out.count, sample.count)
        let read = parseExif(out)
        XCTAssertEqual(read.software, "Atelier")
        // Everything the old directory pointed at is still where it was.
        XCTAssertEqual(read.make, "DJI")
        XCTAssertEqual(read.model, "FC8482")
        XCTAssertEqual(read.iso, 100)
        assertClose(read.gps?.lat ?? .nan, 64.1466, 6)
        XCTAssertEqual(read.dateTimeOriginal, "2026:07:14 18:32:05")
        XCTAssertEqual(read.orientation, 1)
    }

    func testSoftwareReplacesAnEntryTooNarrowToHoldTheMarkRatherThanLeavingBoth() {
        let block = buildExifBlock(exifData { $0.make = "DJI"; $0.software = "v1" })
        let out = retagExifBlock(block, RetagOptions(software: "Atelier"))
        let read = parseExif(out)
        XCTAssertEqual(read.software, "Atelier")
        XCTAssertEqual(read.make, "DJI")
        // One Software entry in the copied directory, in tag order.
        let view = ByteView(out)
        let ifd0 = Int(view.uint32(4, little: true))
        let count = Int(view.uint16(ifd0, little: true))
        let tags = (0..<count).map { Int(view.uint16(ifd0 + 2 + $0 * 12, little: true)) }
        XCTAssertEqual(tags.filter { $0 == 0x0131 }.count, 1)
        XCTAssertEqual(tags, tags.sorted())
    }

    func testSoftwareIsReadBackThroughAJpegTheWayTheDeliveredFileWillBe() throws {
        let out = retagExifBlock(sample, RetagOptions(software: "Atelier"))
        XCTAssertEqual(parseExif(try withExifBlock(bareJpeg(), out)).software, "Atelier")
    }
}

final class RetagExifBlockAuthorTagsTests: XCTestCase {
    func testWritesTheRightsOverTheCamerasEntriesAddsTheOnesItHadNoneOfAndKeepsTheRest() {
        let camera = buildExifBlock(exifData {
            $0.make = "SONY"
            $0.model = "ILCE-7CM2"
            $0.artist = "AB"
            $0.dateTimeOriginal = "2025:01:02 03:04:05"
        })
        let out = retagExifBlock(camera, RetagOptions(
            software: "Atelier",
            artist: .write("Steeve Pommier"),
            copyright: .write("© 2025 Steeve Pommier. All rights reserved."),
            description: .write("Pinnacles, at dawn")
        ))
        let read = parseExif(out)
        XCTAssertEqual(read.artist, "Steeve Pommier")
        XCTAssertEqual(read.copyright, "© 2025 Steeve Pommier. All rights reserved.")
        XCTAssertEqual(read.imageDescription, "Pinnacles, at dawn")
        XCTAssertEqual(read.software, "Atelier")
        XCTAssertEqual(read.model, "ILCE-7CM2")
        XCTAssertEqual(read.dateTimeOriginal, "2025:01:02 03:04:05")
    }

    func testClearsAValueTheAuthorAskedToLeaveOutAndLeavesAloneWhatItWasNotAskedAbout() {
        let camera = buildExifBlock(exifData { $0.make = "SONY"; $0.artist = "CAMERA OWNER"; $0.copyright = "Sony owner" })
        let read = parseExif(retagExifBlock(camera, RetagOptions(copyright: .clear)))
        XCTAssertNil(read.copyright)
        XCTAssertEqual(read.artist, "CAMERA OWNER")
    }
}

final class WithXmpPacketTests: XCTestCase {
    private let packet = "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">© Ünïcode</x:xmpmeta>"

    func testPutsOnePacketAfterTheExifReadBackAsUtf8() throws {
        let jpeg = try withXmpPacket(jpegWithExif(sample), packet)
        XCTAssertEqual(readXmpPacket(jpeg), packet)
        XCTAssertEqual(parseExif(jpeg).make, parseExif(sample).make)
        // EXIF first: its APP1 opens right after the SOI.
        XCTAssertEqual(jpeg[3], 0xe1)
        XCTAssertEqual(Array(jpeg[6..<12]), exifIdBytes)
    }

    func testReplacesAPacketRatherThanAddingASecondOne() throws {
        let once = try withXmpPacket(bareJpeg(), "first")
        let twice = try withXmpPacket(once, packet)
        XCTAssertEqual(readXmpPacket(twice), packet)
        XCTAssertEqual(twice.count, once.count - "first".utf8.count + packet.utf8.count)
        // The scan is untouched.
        let bare = bareJpeg()
        XCTAssertEqual(Array(twice[(twice.count - 7)...]), Array(bare[(bare.count - 7)...]))
    }

    func testGoesAfterAJfifApp0WhenThereIsNoExif() throws {
        let jpeg = try withXmpPacket(jfifJpeg(), packet)
        XCTAssertEqual(jpeg[3], 0xe0)
        XCTAssertEqual(readXmpPacket(jpeg), packet)
    }

    func testFindsNothingInAJpegThatCarriesNone() {
        XCTAssertNil(readXmpPacket(bareJpeg()))
    }
}

/// Hex text as bytes — the golden below was written by the web module itself.
private func hexBytes(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var it = hex.makeIterator()
    while let hi = it.next(), let lo = it.next() { out.append(UInt8(String([hi, lo]), radix: 16)!) }
    return out
}

/// This port's own case: a retag that ADDS entries copies IFD0 to the end of
/// the block exactly where the browser does — the golden is
/// `retagExifBlock(sample, { software, artist, copyright, description,
/// pixelWidth: 1920, pixelHeight: 1440 })` as `exif-block.ts` wrote it.
final class RetagExifBlockGoldenTests: XCTestCase {
    func testWritesTheSameBytesAsTheWebModule() {
        let out = retagExifBlock(sample, RetagOptions(
            pixelWidth: 1920, pixelHeight: 1440, software: "Atelier",
            artist: .write("Steeve Pommier"),
            copyright: .write("© 2025 Steeve Pommier. All rights reserved."),
            description: .write("Pinnacles, at dawn")
        ))
        XCTAssertEqual(out, hexBytes("49492a002e01000005000f01020004000000444a49001001020007000000ce00000012010300010000000100000069870400010000004a00000025880400010000008c0000000000000005002788030001000000640000000090070004000000303233320390020014000000d60000000490020014000000ea00000001a00300010000000100000000000000050000000100040000000203000001000200020000004e0000000200050003000000fe000000030002000200000057000000040005000300000016010000000000004643383438320000323032363a30373a31342031383a33323a303500323032363a30373a31342031383a33323a30350040000000010000000800000001000000a04907001027000015000000010000003800000001000000201705001027000009000e01020013000000a00100000f01020004000000444a49001001020007000000ce0000001201030001000000010000003101020008000000b40100003b0102000f000000bc010000988202002d000000cc01000069870400010000004a00000025880400010000008c0000000000000050696e6e61636c65732c206174206461776e00004174656c6965720053746565766520506f6d6d6965720000c2a920323032352053746565766520506f6d6d6965722e20416c6c207269676874732072657365727665642e0000"))
    }
}
