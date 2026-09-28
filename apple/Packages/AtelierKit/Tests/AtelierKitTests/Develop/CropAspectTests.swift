// Port of `src/shared/develop/crop-aspect.test.ts`, plus the aspect table
// (`project-types.ts`'s pure part, which has no spec of its own) and the roll
// reader's use of `isStoredAspect`.

import XCTest
@testable import AtelierKit

final class PictureAspectRatioTests: XCTestCase {
    func testReadsThePicturesOwnShapeWhileItsAspectIsOriginal() {
        assertClose(pictureAspectRatio("original", 1200, 800), 1.5)
        assertClose(pictureAspectRatio("original", 800, 1200), 2.0 / 3)
        XCTAssertEqual(pictureAspectRatio("original", 0, 0), 1)
    }

    func testReadsANamedPresetRegardlessOfTheSource() {
        XCTAssertEqual(pictureAspectRatio("1:1", 1200, 800), 1)
        assertClose(pictureAspectRatio("9:16", 1200, 800), 9.0 / 16)
    }

    func testReadsAFreeZonesOwnShapeRegardlessOfTheSource() {
        assertClose(pictureAspectRatio("free:1.3721", 1200, 800), 1.3721)
        XCTAssertEqual(pictureAspectRatio("free:0.5", 1200, 800), 0.5)
    }

    func testFallsBackToThePicturesOwnShapeForAnUnknownId() {
        assertClose(pictureAspectRatio("made-up", 1200, 600), 2)
        // A free id that carries nothing readable is not a shape.
        assertClose(pictureAspectRatio("free:", 1200, 600), 2)
        assertClose(pictureAspectRatio("free:-3", 1200, 600), 2)
    }
}

final class FreeAspectTests: XCTestCase {
    func testRoundTripsThroughItsIdAtFourDecimals() {
        XCTAssertEqual(freeAspectId(1.37209), "free:1.3721")
        assertClose(freeAspectRatio(freeAspectId(1.37209)) ?? .nan, 1.3721, 4)
        // A whole number keeps no decimals it does not need.
        XCTAssertEqual(freeAspectId(2), "free:2")
    }

    func testIsHeldBetweenTheTwoExtremeShapesWhicheverEndItComesFrom() {
        XCTAssertEqual(freeAspectRatio(freeAspectId(50)), freeAspectMax)
        assertClose(freeAspectRatio(freeAspectId(0.001)) ?? .nan, freeAspectMin, 6)
        // Even a stored value past the end is read back inside it.
        XCTAssertEqual(freeAspectRatio("free:99"), freeAspectMax)
        XCTAssertEqual(freeAspectId(0), "free:1")
        XCTAssertEqual(freeAspectId(.nan), "free:1")
    }

    func testIsToldFromAPresetAndFromNonsense() {
        XCTAssertTrue(isFreeAspect("free:1.5"))
        XCTAssertFalse(isFreeAspect("4:5"))
        XCTAssertFalse(isFreeAspect("original"))
        XCTAssertFalse(isFreeAspect("free:banana"))
    }

    func testIsAnAspectAStoredRollMayCarryAndNonsenseIsNot() {
        XCTAssertTrue(isStoredAspect("original"))
        XCTAssertTrue(isStoredAspect("4:5"))
        XCTAssertTrue(isStoredAspect("free:1.5"))
        XCTAssertFalse(isStoredAspect("free:banana"))
        XCTAssertFalse(isStoredAspect("made-up"))
    }

    // Not in the web spec: the spellings `Number()` reads and Swift's parser
    // would read differently.
    func testReadsTheRatioTheWayJavaScriptsNumberDoes() {
        XCTAssertEqual(freeAspectRatio("free: 1.5 "), 1.5)
        XCTAssertEqual(freeAspectRatio("free:1.5e0"), 1.5)
        XCTAssertEqual(freeAspectRatio("free:.5"), 0.5)
        XCTAssertNil(freeAspectRatio("free:inf"))
        XCTAssertNil(freeAspectRatio("free:0x1p1"))
        XCTAssertNil(freeAspectRatio("free:1.5x"))
        XCTAssertNil(freeAspectRatio("free:Infinity"))
    }
}

final class DescribeAspectTests: XCTestCase {
    func testSaysAShapeTheWayItIsRead() {
        XCTAssertEqual(describeAspect(1.5), "1.50:1")
        XCTAssertEqual(describeAspect(0.8), "1:1.25")
        XCTAssertEqual(describeAspect(1.001), "1:1")
    }
}

final class OpeningCropChipTests: XCTestCase {
    func testOpensAnUntouchedPictureOnFreeWhateverItsOwnShape() {
        XCTAssertEqual(openingCropChip("original", untouched: true), "free")
    }

    func testOpensACroppedPictureOnTheChipItsStoredCropNames() {
        XCTAssertEqual(openingCropChip("original", untouched: false), "original")
        XCTAssertEqual(openingCropChip("4:5", untouched: false), "4:5")
        XCTAssertEqual(openingCropChip("free:1.5", untouched: false), "free")
    }

    func testFallsBackToFreeForAnAspectNoPresetAnswers() {
        XCTAssertEqual(openingCropChip("made-up", untouched: false), "free")
    }
}

final class AspectTableTests: XCTestCase {
    func testIsTheWebsTableInTheWebsOrder() {
        XCTAssertEqual(aspectPresets.map(\.id), ["9:16", "16:9", "1:1", "4:5", "3:4", "4:3", "2:3", "3:2"])
        XCTAssertEqual(aspectPreset("4:3")?.label, "Phone & drone photo")
        XCTAssertEqual(aspectPreset("3:2")?.ratio, 1.5)
        XCTAssertNil(aspectPreset("original"))
    }

    func testARollKeepsAFreeCropsShapeWhenReadBack() {
        let raw: JSONValue = [
            "id": "r", "version": 6,
            "pictures": [
                ["id": "a", "ref": ["name": "a.jpg", "size": 1, "lastModified": 0], "aspect": "free:1.3721"],
                ["id": "b", "ref": ["name": "b.jpg", "size": 1, "lastModified": 0], "aspect": "made-up"],
            ],
        ]
        let doc = readRollDoc(raw, now: 0)
        XCTAssertEqual(doc?.pictures.map(\.aspect), ["free:1.3721", "original"])
    }
}
