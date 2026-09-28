// Port of `src/shared/exif/software-mark.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class SoftwareMarkTests: XCTestCase {
    func testRecognisesTheMarkAndALaterVersionOfIt() {
        XCTAssertTrue(isAtelierMade(atelierSoftware))
        XCTAssertTrue(isAtelierMade("Atelier 2"))
        XCTAssertTrue(isAtelierMade("  Atelier\u{0000}"))
    }

    func testNeverTakesACamerasOrAnotherEditorsSoftwareForOurs() {
        XCTAssertFalse(isAtelierMade("ILCE-7CM2 v1.00"))
        XCTAssertFalse(isAtelierMade("v01.00.0800"))
        XCTAssertFalse(isAtelierMade("Capture One 24 Macintosh"))
        XCTAssertFalse(isAtelierMade("Ateliers Photo"))
        XCTAssertFalse(isAtelierMade(""))
        XCTAssertFalse(isAtelierMade(nil))
    }

    func testReadsBackThroughTheBlockWriterTheWayADeliveredFileIsRead() {
        let block = buildExifBlock(ExifData(make: "DJI"), BuildExifOptions(software: atelierSoftware))
        XCTAssertTrue(isAtelierMade(parseExif(block).software))
        XCTAssertFalse(isAtelierMade(parseExif(buildExifBlock(ExifData(make: "DJI", software: "v1"))).software))
    }
}
