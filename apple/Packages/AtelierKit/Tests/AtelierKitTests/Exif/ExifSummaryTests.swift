// Port of `src/shared/exif/exif-summary.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class CameraNameTests: XCTestCase {
    func testDoesNotRepeatAMakerTheModelAlreadyCarries() {
        XCTAssertEqual(cameraName(ExifData(make: "DJI", model: "DJI Mini 4 Pro")), "DJI Mini 4 Pro")
        XCTAssertEqual(cameraName(ExifData(make: "SONY", model: "ILCE-7M4")), "SONY ILCE-7M4")
    }

    func testAnswersWithWhicheverHalfExistsOrNothing() {
        XCTAssertEqual(cameraName(ExifData(model: "X100V")), "X100V")
        XCTAssertEqual(cameraName(ExifData(make: "FUJIFILM")), "FUJIFILM")
        XCTAssertNil(cameraName(ExifData()))
    }
}

final class ExposureSummaryTests: XCTestCase {
    func testReadsBodyLensFocalLengthApertureShutterAndIso() {
        let line = exposureSummary(exifData {
            $0.make = "SONY"
            $0.model = "ILCE-7M4"
            $0.lensModel = "FE 24-70mm F2.8 GM II"
            $0.focalLength = 35
            $0.fNumber = 2.8
            $0.exposureTime = 1.0 / 250
            $0.iso = 400
        })
        XCTAssertEqual(line, "SONY ILCE-7M4 · FE 24-70mm F2.8 GM II · 35 mm · ƒ/2.8 · 1/250 · ISO 400")
    }

    func testLeavesOutWhatThePictureDoesNotSay() {
        XCTAssertEqual(exposureSummary(ExifData(iso: 100)), "ISO 100")
        XCTAssertEqual(exposureSummary(ExifData()), "")
        XCTAssertEqual(exposureSummary(nil), "")
    }

    func testPrefersTheLabelTheSourceKeepsOverTheExifModel() {
        XCTAssertEqual(exposureSummary(ExifData(model: "FC8482", iso: 100), body: "DJI Mini 4 Pro"), "DJI Mini 4 Pro · ISO 100")
        // …and still answers with it when there is no EXIF at all.
        XCTAssertEqual(exposureSummary(nil, body: "DJI Mini 4 Pro"), "DJI Mini 4 Pro")
    }

    func testDropsALensThatOnlyRepeatsTheBody() {
        XCTAssertEqual(exposureSummary(ExifData(model: "X100V", lensModel: "X100V")), "X100V")
    }

    func testTrimsTrailingZerosAndRefusesANonsenseReading() {
        XCTAssertEqual(exposureSummary(ExifData(fNumber: 1.7, focalLength: 24.0)), "24 mm · ƒ/1.7")
        XCTAssertEqual(exposureSummary(ExifData(iso: 0, exposureTime: 0, fNumber: -1, focalLength: 0)), "")
    }

    func testSaysALongExposureInSecondsAndAShortOneAsAFraction() {
        XCTAssertEqual(exposureSummary(ExifData(exposureTime: 2.5)), "2.5s")
        XCTAssertEqual(exposureSummary(ExifData(exposureTime: 1.0 / 240)), "1/240")
    }
}

final class CaptureLineTests: XCTestCase {
    func testIsTheFourFactsAPhotographerReadsAtSpeed() {
        let line = captureLine(exifData {
            $0.make = "DJI"
            $0.model = "FC8482"
            $0.focalLength = 6.7
            $0.fNumber = 1.7
            $0.exposureTime = 1.0 / 240
            $0.iso = 100
            $0.exposureBias = 0.33
        })
        XCTAssertEqual(line, "ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV")
    }

    func testLeavesOutWhatTheFileDoesNotSayAndNeverDrawsADash() {
        XCTAssertEqual(captureLine(ExifData(iso: 400)), "ISO 400")
        XCTAssertEqual(captureLine(ExifData(exposureTime: 2)), "2s")
        XCTAssertEqual(captureLine(ExifData()), "")
        XCTAssertEqual(captureLine(nil), "")
    }

    func testSaysNothingAboutACompensationOfZeroADefaultIsNotADecision() {
        XCTAssertEqual(captureLine(ExifData(fNumber: 2.8, exposureBias: 0)), "ƒ/2.8")
        XCTAssertEqual(captureLine(ExifData(fNumber: 2.8, exposureBias: 0.01)), "ƒ/2.8")
        XCTAssertEqual(captureLine(ExifData(fNumber: 2.8, exposureBias: -1)), "ƒ/2.8 · −1 EV")
    }

    func testCarriesNoBodyAndNoLensTheStageNamesTheFileAlready() {
        XCTAssertEqual(captureLine(ExifData(make: "SONY", model: "ILCE-7CM2", lensModel: "FE 35mm F1.8")), "")
    }
}

/// The number-to-text twins the lines rest on, pinned against what JavaScript
/// prints — the one place a Swift line could drift from a browser line.
final class ExifTextTests: XCTestCase {
    func testJsRoundRoundsAHalfTowardPositiveInfinity() {
        XCTAssertEqual(ExifText.jsRound(2.5), 3)
        XCTAssertEqual(ExifText.jsRound(-2.5), -2)
        XCTAssertEqual(ExifText.jsRound(-0.4), 0)
        XCTAssertEqual(ExifText.jsRound(0.49999999999999994), 0)
    }

    func testJsStringPrintsAnIntegerWithoutItsPoint() {
        XCTAssertEqual(ExifText.jsString(24), "24")
        XCTAssertEqual(ExifText.jsString(-0.0), "0")
        XCTAssertEqual(ExifText.jsString(0.33), "0.33")
        XCTAssertEqual(ExifText.jsString(6.77), "6.77")
    }

    func testRounded2AndTrimFixedAreTwoRulesThatDivergeOnARealFocalLength() {
        // `String(Math.round(6.765 * 100) / 100)` is 6.77 — the product rounds
        // up in binary — while `(6.765).toFixed(2)` reads the exact expansion,
        // 6.76499…, and gives 6.76. The web has both; so does this port.
        XCTAssertEqual(ExifText.rounded2(6.765), "6.77")
        XCTAssertEqual(ExifText.trimFixed(6.765), "6.76")
        XCTAssertEqual(ExifText.rounded2(2.8), "2.8")
        XCTAssertEqual(ExifText.trimFixed(58.2), "58.2")
        XCTAssertEqual(ExifText.trimFixed(-0.001), "0")
    }

    func testToFixedKeepsTrailingZerosAndRoundsAHalfAwayFromZero() {
        XCTAssertEqual(ExifText.toFixed(151.2099, 6), "151.209900")
        XCTAssertEqual(ExifText.toFixed(-33.865143, 6), "-33.865143")
        XCTAssertEqual(ExifText.toFixed(5.929999828338623, 2), "5.93")
        XCTAssertEqual(ExifText.toFixed(1.0493, 3), "1.049")
        XCTAssertEqual(ExifText.toFixed(0.125, 2), "0.13") // an exact tie: JS picks the larger n
        XCTAssertEqual(ExifText.toFixed(-0.125, 2), "-0.13")
        XCTAssertEqual(ExifText.toFixed(9.995, 2), "9.99") // 9.99499… in binary, not a tie
        XCTAssertEqual(ExifText.toFixed(99.999, 2), "100.00")
        XCTAssertEqual(ExifText.toFixed(-0.001, 2), "-0.00")
    }

    func testSignedUsesATypographicMinusAndOneDecimal() {
        XCTAssertEqual(ExifText.signed(0.33), "+0.3")
        XCTAssertEqual(ExifText.signed(-1), "−1")
        XCTAssertEqual(ExifText.signed(-0.3), "−0.3")
    }
}
