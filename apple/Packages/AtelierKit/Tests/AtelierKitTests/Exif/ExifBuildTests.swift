// Port of `src/shared/exif/exif-build.test.ts`: what the builder writes is
// read back by the reader that has always been here (`ExifParser.swift`),
// and the orientation block is checked byte for byte.

import Foundation
import XCTest
@testable import AtelierKit

/// What the builder wrote, read back by the reader that has always been here.
private func roundTrip(_ exif: ExifData, _ options: BuildExifOptions = BuildExifOptions()) -> ExifData {
    parseExif(buildExifBlock(exif, options))
}

private let full = exifData {
    $0.make = "DJI"
    $0.model = "FC8482"
    $0.lensMake = "DJI"
    $0.lensModel = "24mm f/1.7"
    $0.artist = "Steeve Pommier"
    $0.iso = 100
    $0.exposureTime = 0.005
    $0.fNumber = 1.7
    $0.focalLength = 6.72
    $0.focalLength35 = 24
    $0.exposureBias = -0.67
    $0.exposureProgram = 2
    $0.meteringMode = 5
    $0.whiteBalance = 0
    $0.flash = 16
    $0.dateTimeOriginal = "2026:07:14 18:32:05"
    $0.gps = GpsCoord(lat: 64.1466, lon: -21.9426)
    $0.gpsAltitude = 128.4
}

private func pair(_ r: (Double, Double)) -> [Double] { [r.0, r.1] }

final class ToRationalTests: XCTestCase {
    func testFindsTheFractionACameraWroteNotADecimalBlownUp() {
        XCTAssertEqual(pair(toRational(0.005)), [1, 200])
        XCTAssertEqual(pair(toRational(1.0 / 8000)), [1, 8000])
        XCTAssertEqual(pair(toRational(2.5)), [5, 2])
        XCTAssertEqual(pair(toRational(4)), [4, 1])
        XCTAssertEqual(pair(toRational(0)), [0, 1])
    }

    func testStaysInsideTheDenominatorItIsGivenAndKeepsTheSign() {
        let (n, d) = toRational(-0.6666666, maxDenominator: 100)
        XCTAssertLessThanOrEqual(d, 100)
        assertClose(n / d, -0.6666666, 4)
    }
}

final class ToDegreesMinutesSecondsTests: XCTestCase {
    func testSplitsDegreesTheWayExifStoresThemUnsigned() {
        let parts = toDegreesMinutesSeconds(-21.9426)
        XCTAssertEqual(Array(parts[0..<4]), [21, 1, 56, 1])
        assertClose(parts[4] / parts[5], 33.36, 2)
    }
}

final class BuildExifBlockTests: XCTestCase {
    func testWritesABlockOurOwnReaderReadsBackFieldForField() {
        let read = roundTrip(full)
        XCTAssertEqual(read.make, "DJI")
        XCTAssertEqual(read.model, "FC8482")
        XCTAssertEqual(read.lensModel, "24mm f/1.7")
        XCTAssertEqual(read.artist, "Steeve Pommier")
        XCTAssertEqual(read.iso, 100)
        assertClose(read.exposureTime ?? .nan, 0.005, 9)
        assertClose(read.fNumber ?? .nan, 1.7, 6)
        assertClose(read.focalLength ?? .nan, 6.72, 6)
        XCTAssertEqual(read.focalLength35, 24)
        assertClose(read.exposureBias ?? .nan, -0.67, 4)
        XCTAssertEqual(read.exposureProgram, 2)
        XCTAssertEqual(read.meteringMode, 5)
        XCTAssertEqual(read.flash, 16)
        XCTAssertEqual(read.dateTimeOriginal, "2026:07:14 18:32:05")
    }

    func testCarriesThePositionHemispheresAndAllAndTheAltitudeWithItsSign() {
        let read = roundTrip(full)
        assertClose(read.gps?.lat ?? .nan, 64.1466, 6)
        assertClose(read.gps?.lon ?? .nan, -21.9426, 6)
        assertClose(read.gpsAltitude ?? .nan, 128.4, 3)
        let below = roundTrip(exifData { $0.gps = GpsCoord(lat: -33.8, lon: 151.2); $0.gpsAltitude = -12.5 })
        assertClose(below.gps?.lat ?? .nan, -33.8, 6)
        assertClose(below.gps?.lon ?? .nan, 151.2, 6)
        assertClose(below.gpsAltitude ?? .nan, -12.5, 3)
    }

    func testSaysThePictureIsTheWayUpItWasDeliveredAtTheSizeItWasDelivered() {
        // The original's own orientation would turn an already-turned picture twice.
        var turned = full
        turned.orientation = 6
        turned.pixelWidth = 8064
        turned.pixelHeight = 6048
        let read = roundTrip(turned, BuildExifOptions(software: "Atelier", pixelWidth: 1920, pixelHeight: 1440))
        XCTAssertEqual(read.orientation, 1)
        XCTAssertEqual(read.pixelWidth, 1920)
        XCTAssertEqual(read.pixelHeight, 1440)
        XCTAssertEqual(read.software, "Atelier")
    }

    func testWritesABlockForAPictureThatKnowsNothingAndReadsBackAsEmptyButForWhatItStates() {
        let read = roundTrip(ExifData())
        XCTAssertEqual(read.orientation, 1)
        XCTAssertNil(read.gps)
        XCTAssertNil(read.make)
    }

    func testLeavesOutWhatItIsNotGivenRatherThanWritingAZero() {
        let read = roundTrip(exifData { $0.iso = 400 })
        XCTAssertEqual(read.iso, 400)
        XCTAssertNil(read.fNumber)
        XCTAssertNil(read.exposureTime)
        XCTAssertNil(read.focalLength)
    }

    func testStaysASaneSizeABlockIsOneApp1SegmentNeverAFile() {
        XCTAssertLessThan(buildExifBlock(full).count, 1024)
    }
}

final class BuildOrientationBlockTests: XCTestCase {
    /// A JPEG with no metadata at all, the shape `ExifBlockTests.swift` uses.
    private func bareJpeg() -> [UInt8] {
        [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x01, 0x02, 0xff, 0xd9]
    }

    func testIsAWholeTiffStreamInTwentySixBytes() {
        let block = buildOrientationBlock(6)
        XCTAssertEqual(block.count, 26)
        XCTAssertEqual(Array(block[0..<8]), [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])
        // One entry: tag 0x0112, SHORT, count 1, the value inline; then no next IFD.
        XCTAssertEqual(Array(block[8..<10]), [0x01, 0x00])
        XCTAssertEqual(Array(block[10..<22]), [0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00])
        XCTAssertEqual(Array(block[22...]), [0, 0, 0, 0])
    }

    func testReadsBackAsTheOrientationAndNothingElse() {
        let read = parseExif(buildOrientationBlock(8))
        XCTAssertEqual(read.orientation, 8)
        XCTAssertNil(read.make)
        XCTAssertNil(read.dateTimeOriginal)
        XCTAssertNil(read.gps)
    }

    func testSurvivesTheSpliceIntoAJpegWhichIsTheWholePointOfIt() throws {
        let jpeg = try withExifBlock(bareJpeg(), buildOrientationBlock(6))
        let block = try XCTUnwrap(readExifBlock(jpeg))
        XCTAssertEqual(parseExif(block).orientation, 6)
        // The segment is the block plus `Exif\0\0`, its length and the marker.
        XCTAssertEqual(jpeg.count, bareJpeg().count + 26 + 6 + 2 + 2)
    }
}

final class BuildExifBlockAuthorTextTests: XCTestCase {
    func testWritesUtf8AndReadsItBackACopyrightSignIncluded() {
        let block = buildExifBlock(
            exifData { $0.make = "DJI" },
            BuildExifOptions(artist: .write("Stéeve"), copyright: .write("© 2026 Stéeve. All rights reserved."), description: .write("Été"))
        )
        let read = parseExif(block)
        XCTAssertEqual(read.artist, "Stéeve")
        XCTAssertEqual(read.copyright, "© 2026 Stéeve. All rights reserved.")
        XCTAssertEqual(read.imageDescription, "Été")
    }

    func testKeepsTheCapturesOwnValuesUnlessToldOtherwiseAndClearsThemOnNull() {
        let exif = exifData { $0.make = "DJI"; $0.artist = "owner"; $0.copyright = "owner ©" }
        XCTAssertEqual(parseExif(buildExifBlock(exif)).copyright, "owner ©")
        let cleared = parseExif(buildExifBlock(exif, BuildExifOptions(artist: .clear, copyright: .clear)))
        XCTAssertNil(cleared.artist)
        XCTAssertNil(cleared.copyright)
    }
}

/// Hex text as bytes — the goldens below were written by the web module itself.
private func hexBytes(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var it = hex.makeIterator()
    while let hi = it.next(), let lo = it.next() { out.append(UInt8(String([hi, lo]), radix: 16)!) }
    return out
}

/// This port's own case: the block is the BROWSER's, byte for byte — the
/// golden is `buildExifBlock(full, { software: 'Atelier', pixelWidth: 1920,
/// pixelHeight: 1440, copyright: '© 2026 Stéeve' })` as `exif-build.ts` wrote it.
final class BuildExifBlockGoldenTests: XCTestCase {
    func testWritesTheSameBytesAsTheWebModule() {
        let block = buildExifBlock(full, BuildExifOptions(software: "Atelier", copyright: .write("© 2026 Stéeve"), pixelWidth: 1920, pixelHeight: 1440))
        XCTAssertEqual(block, hexBytes("49492a000800000008000f01020004000000444a49001001020007000000a60100001201030001000000010000003101020008000000ae0100003b0102000f000000b60100009882020010000000c601000069870400010000006e00000025880400010000004c0100000000000012009a82050001000000d60100009d82050001000000de0100002288030001000000020000002788030001000000640000000090070004000000303233320390020014000000e60100000490020014000000fa01000004920a00010000000e0200000792030001000000050000000992030001000000100000000a920500010000001602000001a00300010000000100000002a00400010000008007000003a0040001000000a005000003a40300010000000000000005a40300010000001800000033a4020004000000444a490034a402000b0000001e02000000000000070000000100040000000203000001000200020000004e00000002000500030000002a02000003000200020000005700000004000500030000004202000005000100010000000000000006000500010000005a0200000000000046433834383200004174656c6965720053746565766520506f6d6d6965720000c2a92032303236205374c3a96576650001000000c8000000110000000a000000323032363a30373a31342031383a33323a303500323032363a30373a31342031383a33323a303500bdffffff64000000a80000001900000032346d6d20662f312e37000040000000010000000800000001000000a0490700102700001500000001000000380000000100000020170500102700008202000005000000"))
    }
}
