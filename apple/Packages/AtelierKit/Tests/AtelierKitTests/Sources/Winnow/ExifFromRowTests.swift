// Port of `src/shared/sources/winnow/exif-from-row.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func row(_ change: (inout WinnowAssetRow) -> Void = { _ in }) -> WinnowAssetRow {
    var r = WinnowAssetRow(
        id: 1, filename: "DJI_0001.JPG", sessionId: 3, ext: "jpg", mediaType: .photo,
        capturedAt: "2025-07-09T08:30:15.000Z", captureDate: "2025-07-09", width: 8064, height: 6048,
        durationS: nil, fileSize: 12_000_000, contentHash: "abc", gpsLat: -25.344428, gpsLon: 131.036882,
        cameraModel: "DJI Mini 4 Pro", lens: nil, iso: 100, shutter: "1/240", aperture: 1.7, focalLength: 6.7,
        relativeAltitude: 84.3, absoluteAltitude: 612.5, derivativeStatus: .ready, hasTelemetry: false, sidecars: []
    )
    change(&r)
    return r
}

/// Every exposure and altitude column emptied.
private func noExposure(_ r: inout WinnowAssetRow) {
    r.iso = nil; r.shutter = nil; r.aperture = nil; r.focalLength = nil
    r.relativeAltitude = nil; r.absoluteAltitude = nil
}

final class ParseShutterSecondsTests: XCTestCase {
    func testReadsTheFractionACameraWrites() throws {
        assertClose(try XCTUnwrap(parseShutterSeconds("1/240")), 1.0 / 240, 10)
        assertClose(try XCTUnwrap(parseShutterSeconds(" 1 / 60 ")), 1.0 / 60, 10)
    }

    func testReadsAPlainNumberOfSecondsWithOrWithoutTheUnit() {
        XCTAssertEqual(parseShutterSeconds("2.5"), 2.5)
        XCTAssertEqual(parseShutterSeconds("2.5s"), 2.5)
        XCTAssertEqual(parseShutterSeconds("30 sec"), 30)
    }

    func testRefusesWhatItCannotReadRatherThanGuessing() {
        for bad: String? in [nil, "", "auto", "1/0", "-3", "0"] {
            XCTAssertNil(parseShutterSeconds(bad), String(describing: bad))
        }
    }
}

final class ExifTimestampFromIsoTests: XCTestCase {
    func testGivesBackTheWallClockTheCameraWroteInExifForm() {
        XCTAssertEqual(exifTimestampFromIso("2025-07-09T08:30:15.000Z"), "2025:07:09 08:30:15")
    }

    func testDoesNotDriftWithAnOffsetTheServerAttached() {
        XCTAssertEqual(exifTimestampFromIso("2025-07-09T08:30:15+00:00"), "2025:07:09 08:30:15")
    }

    func testRefusesATimeItCannotParse() {
        XCTAssertNil(exifTimestampFromIso(nil))
        XCTAssertNil(exifTimestampFromIso("someday"))
    }
}

final class ExifFromRowTests: XCTestCase {
    func testCarriesExposurePositionAltitudeAndTimeAcross() {
        XCTAssertEqual(exifFromRow(row()), ExifData(
            iso: 100,
            exposureTime: 1.0 / 240,
            fNumber: 1.7,
            focalLength: 6.7,
            pixelWidth: 8064,
            pixelHeight: 6048,
            dateTimeOriginal: "2025:07:09 08:30:15",
            gps: GpsCoord(lat: -25.344428, lon: 131.036882),
            gpsAltitude: 612.5,
            relativeAltitude: 84.3
        ))
    }

    func testOmitsWhatTheRowDoesNotKnowRatherThanWritingZeros() {
        let exif = exifFromRow(row(noExposure))
        XCTAssertNil(exif?.iso)
        XCTAssertNil(exif?.relativeAltitude)
        XCTAssertEqual(exif?.gps, GpsCoord(lat: -25.344428, lon: 131.036882))
    }

    func testNeedsBothHalvesOfAPositionBeforeClaimingOne() {
        XCTAssertNil(exifFromRow(row { $0.gpsLon = nil })?.gps)
    }

    func testIsNilWhenTheRowKnowsOnlyHowBigThePictureIs() {
        XCTAssertNil(exifFromRow(row {
            noExposure(&$0)
            $0.gpsLat = nil; $0.gpsLon = nil; $0.capturedAt = nil
        }))
    }

    func testFeedsTheCueAStillIsWorthTheWholePointOfTheMapping() throws {
        let cue = try XCTUnwrap(cueFromExif(try XCTUnwrap(exifFromRow(row()))))
        XCTAssertEqual(cue.timestamp, "2025-07-09 08:30:15")
        let want: [String: String] = [
            "iso": "100",
            "shutter": "1/240",
            "fnum": "1.7",
            "focal_len": "6.7",
            "latitude": "-25.344428",
            "longitude": "131.036882",
            "abs_alt": "612.5",
            // A drone still knows its height above take-off.
            "rel_alt": "84.3",
        ]
        for (key, value) in want { XCTAssertEqual(cue.data[key], value, key) }
    }

    func testLeavesRelAltAbsentForACameraThatIsNotADrone() throws {
        let cue = try XCTUnwrap(cueFromExif(try XCTUnwrap(exifFromRow(row { $0.relativeAltitude = nil }))))
        XCTAssertNil(cue.data["rel_alt"])
    }
}
