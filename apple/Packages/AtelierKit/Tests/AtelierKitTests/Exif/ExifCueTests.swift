// Port of `src/shared/exif/exif-cue.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class ExifShutterTests: XCTestCase {
    func testReadsSubSecondExposuresAsAFractionLikeDjiDoes() {
        XCTAssertEqual(exifShutter(0.005), "1/200")
        XCTAssertEqual(exifShutter(1.0 / 60), "1/60")
    }

    func testReadsLongExposuresWithAUnitWhereAFractionWouldMislead() {
        XCTAssertEqual(exifShutter(1), "1s")
        XCTAssertEqual(exifShutter(2.5), "2.5s")
    }

    func testRefusesAMissingOrImpossibleExposure() {
        XCTAssertNil(exifShutter(nil))
        XCTAssertNil(exifShutter(0))
        XCTAssertNil(exifShutter(-1))
        XCTAssertNil(exifShutter(Double.nan))
    }
}

final class ExifTimestampTests: XCTestCase {
    func testTurnsExifColonsIntoTheSeparatorsTheTimeFormatterReads() {
        XCTAssertEqual(exifTimestamp("2026:05:30 05:49:34"), "2026-05-30 05:49:34")
    }

    func testKeepsSubSecondPrecisionAndAcceptsADashedSource() {
        XCTAssertEqual(exifTimestamp("2026-05-30T05:49:34.609"), "2026-05-30 05:49:34.609")
    }

    func testRefusesAFlatClockBatteryAndAnythingUnparseable() {
        XCTAssertNil(exifTimestamp("0000:00:00 00:00:00"))
        XCTAssertNil(exifTimestamp("yesterday"))
        XCTAssertNil(exifTimestamp(nil))
    }
}

final class CueFromExifTests: XCTestCase {
    private let full = exifData {
        $0.make = "FUJIFILM"
        $0.model = "X-T5"
        $0.iso = 400
        $0.exposureTime = 0.005
        $0.fNumber = 2.8
        $0.focalLength = 23
        $0.exposureBias = 0.67
        $0.gps = GpsCoord(lat: -33.865143, lon: 151.2099)
        $0.gpsAltitude = 58.2
        $0.dateTimeOriginal = "2026:05:30 05:49:34"
    }

    func testMapsTheExposureTripletOntoTheDjiFieldNames() throws {
        let cue = try XCTUnwrap(cueFromExif(full))
        XCTAssertEqual(cue.data["iso"], "400")
        XCTAssertEqual(cue.data["shutter"], "1/200")
        XCTAssertEqual(cue.data["fnum"], "2.8")
        XCTAssertEqual(cue.data["focal_len"], "23")
        XCTAssertEqual(cue.data["ev"], "+0.67")
    }

    func testMapsPositionAndAltitude() throws {
        let cue = try XCTUnwrap(cueFromExif(full))
        XCTAssertEqual(cue.data["latitude"], "-33.865143")
        XCTAssertEqual(cue.data["longitude"], "151.209900")
        XCTAssertEqual(cue.data["abs_alt"], "58.2")
    }

    func testStartsAt0SoAnyPlayheadResolvesIt() throws {
        XCTAssertEqual(try XCTUnwrap(cueFromExif(full)).start, 0)
    }

    func testInventsNothingAPhotographCannotAnswer() throws {
        let cue = try XCTUnwrap(cueFromExif(full))
        XCTAssertNil(cue.frame)
        XCTAssertNil(cue.derived)
        for key in ["rel_alt", "gnd_speed", "vert_speed", "heading", "color_md"] {
            XCTAssertNil(cue.data[key], key)
        }
    }

    func testIsNilWhenTheFileCarriesNothingAnElementCouldDraw() {
        XCTAssertNil(cueFromExif(ExifData()))
        XCTAssertNil(cueFromExif(ExifData(make: "Apple", model: "iPhone")))
    }

    func testIsACueOnItsTimestampAloneAPhoneScreenshotStillDatesItself() {
        let cue = cueFromExif(ExifData(dateTimeOriginal: "2026:05:30 05:49:34"))
        XCTAssertEqual(cue?.timestamp, "2026-05-30 05:49:34")
    }

    func testFeedsTheOverlayFormatterTheWayAClipDoes() throws {
        let cue = try XCTUnwrap(cueFromExif(full))
        // The half the kernel already speaks: `formatField` asks `motionAt`
        // for a speed and a heading, and a still has neither to give.
        XCTAssertNil(motionAt(cue).groundSpeed)
        XCTAssertNil(motionAt(cue).heading)
        XCTAssertEqual(cue.data["shutter"], "1/200")
        XCTAssertEqual(cueAt([cue], 12.5)?.data["fnum"], "2.8", "any playhead resolves the one cue")
        throw XCTSkip("`formatField` (shared/overlay/field-format.ts) is not ported yet: the web case reads `f/2.8`, `23 mm`, `05:49:34` and `—` through it")
    }
}
