// Port of `src/shared/exif/camera-facts.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let dji = exifData {
    $0.make = "DJI"
    $0.model = "FC8482"
    $0.focalLength = 6.72
    $0.focalLength35 = 24
    $0.fNumber = 1.7
    $0.exposureTime = 1.0 / 240
    $0.iso = 100
    $0.exposureBias = 0
    $0.relativeAltitude = 118.4
}

private let sony = exifData {
    $0.make = "SONY"
    $0.model = "ILCE-7CM2"
    $0.lensModel = "FE 24-70mm F2.8 GM II"
    $0.focalLength = 35
    $0.focalLength35 = 35
    $0.fNumber = 4
    $0.exposureTime = 1.0 / 500
    $0.iso = 200
    $0.exposureBias = -0.3
}

private let phone = exifData {
    $0.make = "Apple"
    $0.model = "iPhone 15 Pro"
    $0.lensModel = "iPhone 15 Pro"
    $0.focalLength = 6.765
    $0.fNumber = 1.78
    $0.exposureTime = 1.0 / 1200
    $0.iso = 64
}

final class CameraFactsTests: XCTestCase {
    func testDrawsTheLegacyFieldsIntoExposureSummarysVeryLine() {
        // A badge that never chose a layout must not change by a character.
        for exif in [dji, sony, phone, ExifData(), ExifData(make: "FUJIFILM", model: "X100V")] {
            XCTAssertEqual(factsLine(cameraFacts(exif), legacyCameraFields), exposureSummary(exif))
        }
    }

    func testWritesEachFactTheWayTheSuitePrintsIt() {
        let f = cameraFacts(sony).facts
        XCTAssertEqual(f[.body]?.value, "SONY ILCE-7CM2")
        XCTAssertEqual(f[.lens]?.value, "FE 24-70mm F2.8 GM II")
        XCTAssertEqual(f[.focal35]?.value, "35 mm")
        XCTAssertEqual(f[.aperture]?.value, "ƒ/4")
        XCTAssertEqual(f[.shutter]?.value, "1/500")
        XCTAssertEqual(f[.iso], CameraFact(field: .iso, value: "ISO 200", bare: "200"))
        XCTAssertEqual(f[.ev], CameraFact(field: .ev, value: "−0.3 EV", bare: "−0.3"))
    }

    func testKeepsBothFocalLengthsApartTheEquivalentIsNotDerived() {
        let f = cameraFacts(dji).facts
        XCTAssertEqual(f[.focal]?.value, "6.72 mm")
        XCTAssertEqual(f[.focal35]?.value, "24 mm")
        XCTAssertNil(cameraFacts(phone).facts[.focal35])
    }

    func testLeavesAZeroCompensationOutOfTheFactsButKeepsItForAMeter() {
        let facts = cameraFacts(dji)
        XCTAssertNil(facts.facts[.ev])
        XCTAssertEqual(facts.evStops, 0)
        XCTAssertNil(cameraFacts(phone).evStops)
    }

    func testKnowsADronesHeightAboveTakeOffAndNothingElseDoes() {
        XCTAssertEqual(cameraFacts(dji).facts[.altitude]?.value, "118 m")
        XCTAssertNil(cameraFacts(sony).facts[.altitude])
        XCTAssertEqual(cameraFacts(ExifData(relativeAltitude: -3.6)).facts[.altitude]?.value, "−4 m")
    }

    func testDropsALensThatOnlyRepeatsTheBody() {
        var same = phone
        same.lensModel = "Apple iPhone 15 Pro"
        XCTAssertNil(cameraFacts(same).facts[.lens])
        // …even once the body is renamed: it is the file's own words that repeat.
        XCTAssertNil(cameraFacts(same, names: ["Apple iPhone 15 Pro": "iPhone"]).facts[.lens])
    }

    func testRenamesABodyOnlyFromTheTableTheAuthorWrote() {
        let named = cameraFacts(dji, names: ["dji fc8482": "DJI Mini 4 Pro"])
        XCTAssertEqual(named.facts[.body]?.value, "DJI Mini 4 Pro")
        XCTAssertEqual(named.rawBody, "DJI FC8482")
        XCTAssertEqual(cameraFacts(dji, names: ["DJI FC8482": "   "]).facts[.body]?.value, "DJI FC8482")
        XCTAssertEqual(cameraFacts(dji, names: ["Other": "X"]).facts[.body]?.value, "DJI FC8482")
    }

    func testSaysNothingAboutAPictureThatRecordsNothing() {
        XCTAssertTrue(cameraFacts(nil).facts.isEmpty)
        XCTAssertEqual(factsLine(cameraFacts(nil), legacyCameraFields), "")
    }
}

final class PickFactsTests: XCTestCase {
    func testKeepsTheAuthorsOrderSkipsWhatIsNotRecordedCountsAFieldOnce() {
        let picked = pickFacts(cameraFacts(sony), [.iso, .altitude, .aperture, .iso, .body])
        XCTAssertEqual(picked.map { $0.field }, [.iso, .aperture, .body])
    }
}

final class CameraFieldsTests: XCTestCase {
    func testNamesEveryFieldOnceAndRecognisesOnlyThose() {
        let ids = cameraFields.map { $0.id }
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertTrue(ids.allSatisfy { isCameraField(.string($0.rawValue)) })
        XCTAssertFalse(isCameraField("make"))
        XCTAssertFalse(isCameraField(nil))
        XCTAssertFalse(isCameraField(1))
        // Every case of the enum is in the table, and in the web's order.
        XCTAssertEqual(ids, CameraField.allCases)
        XCTAssertEqual(cameraFields.filter { $0.identity }.map { $0.id }, [.body, .lens])
        XCTAssertTrue(isIdentityField(.lens))
        XCTAssertFalse(isIdentityField(.iso))
    }
}
