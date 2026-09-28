// Port of `src/tools/exif/exif-format.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

final class FormatShutterTests: XCTestCase {
    func testRendersSubSecondAsAFraction() {
        XCTAssertEqual(formatShutter(0.005), "1/200 s")
        XCTAssertEqual(formatShutter(0.5), "1/2 s")
    }

    func testRendersWholeAndLongExposuresInSeconds() {
        XCTAssertEqual(formatShutter(2), "2 s")
        XCTAssertEqual(formatShutter(1.3), "1.3 s")
    }

    func testReturnsNilForMissingOrInvalidInput() {
        XCTAssertNil(formatShutter(nil))
        XCTAssertNil(formatShutter(0))
        XCTAssertNil(formatShutter(-1))
    }
}

final class FormatApertureFocalIsoTests: XCTestCase {
    func testFormatsWithTheRightUnitTrimmingTrailingZeros() {
        XCTAssertEqual(formatAperture(2.8), "f/2.8")
        XCTAssertEqual(formatAperture(8), "f/8")
        XCTAssertEqual(formatFocal(24), "24 mm")
        XCTAssertEqual(formatFocal(35.5), "35.5 mm")
        XCTAssertEqual(formatIso(400), "ISO 400")
    }

    func testReturnsNilForMissingValues() {
        XCTAssertNil(formatAperture(nil))
        XCTAssertNil(formatFocal(0))
        XCTAssertNil(formatIso(nil))
    }
}

final class FormatExposureBiasTests: XCTestCase {
    func testIsAlwaysSigned() {
        XCTAssertEqual(formatExposureBias(0), "0 EV")
        XCTAssertEqual(formatExposureBias(1), "+1 EV")
        XCTAssertEqual(formatExposureBias(0.67), "+0.67 EV")
        XCTAssertEqual(formatExposureBias(-1), "-1 EV")
    }
}

final class GpsFormattingTests: XCTestCase {
    func testFormatsACoordinateToSixDecimals() {
        XCTAssertEqual(formatCoord(GpsCoord(lat: 37.7749, lon: -122.4194)), "37.774900, -122.419400")
        XCTAssertNil(formatCoord(nil))
    }

    func testFormatsAltitudeWithAMetreSuffix() {
        XCTAssertEqual(formatAltitude(80.2), "80.2 m")
        XCTAssertEqual(formatAltitude(-5), "-5 m")
    }

    func testBuildsAnOpenStreetMapLinkFromACoordinate() {
        let url = mapsUrl(GpsCoord(lat: 37.7749, lon: -122.4194))
        XCTAssertTrue(url.contains("openstreetmap.org"))
        XCTAssertTrue(url.contains("mlat=37.7749"))
        XCTAssertTrue(url.contains("mlon=-122.4194"))
    }
}

final class CodedValueLabelTests: XCTestCase {
    func testMapsKnownCodesAndIgnoresUnknownOnes() {
        XCTAssertEqual(orientationLabel(6), "Rotated 90° CW")
        XCTAssertEqual(orientationLabel(1), "Normal")
        XCTAssertNil(orientationLabel(99))
        XCTAssertNil(orientationLabel(nil))
    }

    func testReadsTheFlashFiredBit() {
        XCTAssertEqual(flashLabel(0), "Did not fire")
        XCTAssertEqual(flashLabel(1), "Fired")
        XCTAssertEqual(flashLabel(0x19), "Fired") // fired + auto mode bits set
        XCTAssertNil(flashLabel(nil))
    }
}

final class SummaryLineTests: XCTestCase {
    func testJoinsCameraBodyAndExposureTriplet() {
        XCTAssertEqual(cameraLine(ExifData(make: "SONY", model: "ILCE-7M3")), "SONY ILCE-7M3")
        XCTAssertEqual(exposureLine(ExifData(iso: 400, exposureTime: 0.005, fNumber: 2.8)), "1/200 s  ·  f/2.8  ·  ISO 400")
    }

    func testReturnsNilWhenNothingIsPresent() {
        XCTAssertNil(cameraLine(ExifData()))
        XCTAssertNil(exposureLine(ExifData()))
    }
}

final class FormatCapturedTests: XCTestCase {
    func testReadsTheCamerasOwnSpellingAsTheSuites() {
        XCTAssertEqual(formatCaptured("2026:05:30 05:49:34"), "2026-05-30 05:49")
    }

    func testTakesTheHourAsWrittenNeverConverted() {
        XCTAssertEqual(formatCaptured("2026:05:30 23:59:59"), "2026-05-30 23:59")
    }

    func testIsNilForAFlatClockBatteryOrForNothingAtAll() {
        XCTAssertNil(formatCaptured("0000:00:00 00:00:00"))
        XCTAssertNil(formatCaptured(nil))
    }
}

/// `image-meta.ts`'s `imageTypeLabel` has no spec of its own on the web;
/// these pin the three answers a card reads.
final class ImageTypeLabelTests: XCTestCase {
    func testARawIsRawAJpegIsJpegAndTheRestTheirExtension() {
        XCTAssertEqual(imageTypeLabel("DJI_0202.DNG"), "RAW")
        XCTAssertEqual(imageTypeLabel("DSC00123.ARW"), "RAW")
        XCTAssertEqual(imageTypeLabel("IMG_0001.jpeg"), "JPEG")
        XCTAssertEqual(imageTypeLabel("IMG_0001.HEIC"), "HEIC")
        XCTAssertEqual(imageTypeLabel("scan.png"), "PNG")
        XCTAssertEqual(imageTypeLabel("README"), "image")
        XCTAssertEqual(imageTypeLabel("trailing."), "image")
    }
}

/// Not in the web's spec — the coded tables the panel reads, pinned so a
/// label cannot drift from the web's words.
final class ExifLabelTableTests: XCTestCase {
    func testTheProgramMeteringAndWhiteBalanceTablesReadTheWebsWords() {
        XCTAssertEqual(exposureProgramLabel(3), "Aperture priority")
        XCTAssertEqual(meteringModeLabel(255), "Other")
        XCTAssertEqual(meteringModeLabel(5), "Pattern")
        XCTAssertEqual(whiteBalanceLabel(0), "Auto")
        XCTAssertNil(whiteBalanceLabel(2))
        XCTAssertNil(exposureProgramLabel(2.5))
    }
}
