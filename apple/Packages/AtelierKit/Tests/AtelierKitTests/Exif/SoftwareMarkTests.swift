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

    func testReadsBackThroughTheBlockWriterTheWayADeliveredFileIsRead() throws {
        // The web builds an EXIF block with `Software: Atelier` and parses it
        // back (`buildExifBlock` + `parseExif`). Neither is in the kernel yet:
        // the Exif task ports them, and this case is then written against
        // them rather than deleted.
        throw XCTSkip("needs buildExifBlock and parseExif — the Exif port")
    }
}
