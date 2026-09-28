// Port of `src/shared/exif/merge-exif.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class MergeExifTests: XCTestCase {
    func testReturnsNilWhenNeitherSideSaysAnything() {
        XCTAssertNil(mergeExif(nil, nil))
    }

    func testUsesTheSourceWhenTheFileWasStripped() {
        XCTAssertEqual(mergeExif(nil, ExifData(iso: 100)), ExifData(iso: 100))
    }

    func testUsesTheFileWhenThereIsNoSource() {
        XCTAssertEqual(mergeExif(ExifData(iso: 100), nil), ExifData(iso: 100))
    }

    func testLetsTheFileWinWhereBothKnowTheBytesInHandAreThisFile() {
        XCTAssertEqual(mergeExif(ExifData(iso: 400), ExifData(iso: 100, fNumber: 2.8)), ExifData(iso: 400, fNumber: 2.8))
    }

    func testFillsTheGapsAReEncodeLeftKeepingWhatTheFileStillDeclares() {
        // A WebP proxy: it still knows how big it is, and nothing else.
        let proxy = ExifData(pixelWidth: 2048, pixelHeight: 1365)
        let known = ExifData(iso: 100, exposureTime: 0.004, gps: GpsCoord(lat: 1, lon: 2))
        XCTAssertEqual(
            mergeExif(proxy, known),
            ExifData(iso: 100, exposureTime: 0.004, pixelWidth: 2048, pixelHeight: 1365, gps: GpsCoord(lat: 1, lon: 2))
        )
    }

    func testDoesNotLetAnExplicitlyUndefinedFieldEraseWhatTheSourceKnows() {
        XCTAssertEqual(mergeExif(ExifData(iso: nil), ExifData(iso: 100)), ExifData(iso: 100))
    }

    func testNeverMutatesEitherSide() {
        let file = ExifData(iso: 400)
        let source = ExifData(fNumber: 2.8)
        _ = mergeExif(file, source)
        XCTAssertEqual(file, ExifData(iso: 400))
        XCTAssertEqual(source, ExifData(fNumber: 2.8))
    }
}
