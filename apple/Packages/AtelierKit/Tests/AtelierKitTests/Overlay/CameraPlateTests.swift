// The stored half of `src/shared/overlay/camera-plate.ts`: the `readPlateSpec`
// and `cameraWordsOf` cases of `camera-plate.test.ts` (the runs and layouts
// wait for the behaviour's port), and the words as a trip STORES them.

import XCTest
@testable import AtelierKit

final class CameraPlateStoredTests: XCTestCase {
    func testReadPlateSpecLandsJunkOnTheDefaultsFieldByField() {
        XCTAssertEqual(readPlateSpec(nil), defaultPlateSpec())
        XCTAssertEqual(
            readPlateSpec(["fields": ["iso", "nope", "iso"], "layout": "poster", "place": "middle", "size": 9]),
            CameraPlateSpec(fields: [.iso], layout: .line, place: .badge, size: 1.8)
        )
        let placed = readPlateSpec(["place": "top-left", "layout": "ledger"])
        XCTAssertEqual(placed.place, .cell(.topLeft))
        XCTAssertEqual(placed.layout, .ledger)
    }

    func testCameraWordsOfFillsEveryBlankWordWithTheEnglishDefault() {
        XCTAssertEqual(cameraWordsOf(nil), defaultCameraWords)
        XCTAssertEqual(cameraWordsOf(CameraWords(shotOn: "  ", tags: [.iso: ""])), defaultCameraWords)
    }

    func testAStoredSetOfWordsKeepsWhatWasTypedBlanksIncluded() throws {
        let words = try XCTUnwrap(readCameraWords(["shotOn": "Pris au", "tags": ["iso": "", "lens": "Objectif"]]))
        XCTAssertEqual(words.tags[.iso], "")
        XCTAssertEqual(words.tags[.lens], "Objectif")
        XCTAssertEqual(words.tags[.body], "Camera")
        XCTAssertEqual(cameraWordsOf(words).tags[.iso], "ISO")
        XCTAssertNil(readCameraWords(nil))
    }

    func testTheSpecAndTheWordsWriteWhatTheyRead() {
        let spec = CameraPlateSpec(fields: [.body, .aperture], layout: .bar, place: .cell(.bottomCenter), size: 1.2)
        XCTAssertEqual(readPlateSpec(spec.json), spec)
        XCTAssertEqual(readCameraWords(frenchCameraWords.json), frenchCameraWords)
    }
}
