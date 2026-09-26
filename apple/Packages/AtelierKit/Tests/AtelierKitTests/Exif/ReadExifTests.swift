// Port of `src/shared/exif/read-exif.test.ts`.
//
// The web registers an identity on a `File` (`registerMediaIdentity`) and
// reads it back off the file; here the source's facts (`MediaOrigin`) and the
// EXIF it vouched for are handed in beside the head bytes, which is what that
// registry carries.

import Foundation
import XCTest
@testable import AtelierKit

/// A source's editing rendition: bytes that carry no EXIF of their own.
private let proxyHead = [UInt8](repeating: 0, count: 64)

private let origin = MediaOrigin(sourceId: "winnow.example", fidelity: .proxy, width: 4000, height: 3000)

final class VouchedExifTests: XCTestCase {
    func testIsNilForAFileNobodyHandedOver() {
        XCTAssertNil(vouchedExif(nil, nil))
    }

    func testIsNilWhenTheSourceVouchedForNothingReadable() {
        XCTAssertNil(vouchedExif(origin, ExifData()))
    }

    func testNamesTheInstanceThatVouched() {
        XCTAssertEqual(
            vouchedExif(origin, ExifData(iso: 100)),
            VouchedExif(exif: ExifData(iso: 100), via: "winnow.example")
        )
    }
}

final class ReadEffectiveExifTests: XCTestCase {
    func testReadsWhatTheSourceKnowsWhenTheBytesCarryNothing() {
        let vouched = vouchedExif(origin, ExifData(iso: 100, dateTimeOriginal: "2025:11:17 23:30:00"))
        let read = readEffectiveExif(proxyHead, vouched)
        XCTAssertEqual(read.exif.iso, 100)
        XCTAssertEqual(read.exif.dateTimeOriginal, "2025:11:17 23:30:00")
        XCTAssertEqual(read.via, "winnow.example")
        // And the bytes themselves said nothing: the panel must be able to say so.
        XCTAssertEqual(read.file, ExifData())
    }

    func testIsEmptyAndVouchedByNobodyForAFileTheUserOpenedThemselves() {
        let read = readEffectiveExif(proxyHead, nil)
        XCTAssertEqual(read.exif, ExifData())
        XCTAssertNil(read.via)
    }

    func testLeavesTheSourcesAccountStandingWhenTheHeadCouldNotBeRead() {
        // This port's own: the web's `catch` around the slice, as a nil head.
        let read = readEffectiveExif(nil as [UInt8]?, vouchedExif(origin, ExifData(iso: 200)))
        XCTAssertEqual(read.exif.iso, 200)
        XCTAssertEqual(read.file, ExifData())
    }
}
