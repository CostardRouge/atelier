// Port of `src/shared/projects/media-develop.test.ts`, case for case.

import XCTest
@testable import AtelierKit

private let lifted = dev { $0.exposure = 0.7 }

final class SaveDevelopTests: XCTestCase {
    func testPersistsNothingForAsShotAndTheHashWhenItIsKnown() {
        XCTAssertNil(saveDevelop(nil, "abc"))
        XCTAssertNil(saveDevelop(.default, "abc"))
        XCTAssertEqual(saveDevelop(lifted, "abc"), SavedDevelop(settings: lifted, hash: "abc"))
        XCTAssertEqual(saveDevelop(lifted, nil), SavedDevelop(settings: lifted))
    }
}

final class RestoreDevelopTests: XCTestCase {
    func testRestoresByNameWhenEitherHashIsUnknown() {
        XCTAssertEqual(restoreDevelop(SavedDevelop(settings: lifted), "abc"), lifted)
        XCTAssertEqual(restoreDevelop(SavedDevelop(settings: lifted, hash: "abc"), nil), lifted)
        XCTAssertEqual(restoreDevelop(SavedDevelop(settings: lifted, hash: "abc"), "abc"), lifted)
    }

    func testRefusesADevelopSetAgainstAnotherFileOfTheSameName() {
        XCTAssertNil(restoreDevelop(SavedDevelop(settings: lifted, hash: "abc"), "other"))
    }

    func testAnswersNilForNothingAndClampsWhatItRestores() {
        XCTAssertNil(restoreDevelop(nil, "abc"))
        XCTAssertEqual(restoreDevelop(SavedDevelop(settings: dev { $0.exposure = 9 }), nil)?.exposure, 3)
    }
}

final class NormaliseDevelopsTests: XCTestCase {
    func testKeepsSoundEntriesAndDropsEmptyOrBrokenOnes() {
        XCTAssertEqual(normaliseDevelops(nil), [:])
        XCTAssertEqual(normaliseDevelops([1]), [:])
        let raw: JSONValue = [
            "a": ["settings": lifted.json, "hash": "abc"],
            "b": ["settings": DevelopSettings.default.json],
            "c": "junk",
            "d": ["settings": ["blacks": -500], "hash": ""],
        ]
        XCTAssertEqual(normaliseDevelops(raw), [
            "a": SavedDevelop(settings: lifted, hash: "abc"),
            "d": SavedDevelop(settings: dev { $0.blacks = -100 }),
        ])
    }

    // No web spec: the one mark a stored entry may carry, and the writer.
    func testKeepsTheBridgesMarkAndWritesOnlyWhatIsThere() {
        let read = normaliseDevelops(["h": ["settings": lifted.json, "via": "roadtrip"], "x": ["settings": lifted.json, "via": "elsewhere"]])
        XCTAssertEqual(read["h"]?.via, .roadtrip)
        XCTAssertNil(read["x"]?.via)
        XCTAssertEqual(SavedDevelop(settings: lifted).json, ["settings": lifted.json])
        XCTAssertEqual(SavedDevelop(settings: lifted, hash: "h1", via: .roadtrip).json,
                       ["settings": lifted.json, "hash": "h1", "via": "roadtrip"])
        XCTAssertEqual(normaliseDevelops(["h": read["h"]!.json])["h"], read["h"])
    }
}

final class WriteDevelopTests: XCTestCase {
    private let lifted = dev { $0.exposure = 0.4 }

    func testWritesACorrectionUnderItsKeyWithTheHashItWasSetAgainst() {
        XCTAssertEqual(writeDevelop([:], "DJI_0001", lifted, "h1"), ["DJI_0001": SavedDevelop(settings: lifted, hash: "h1")])
    }

    func testRemovesAKeyPutBackToAsShotAndHandsBackTheSameMapWhenThereWasNone() {
        let map = writeDevelop([:], "DJI_0001", lifted, "h1")
        XCTAssertEqual(writeDevelop(map, "DJI_0001", .default, "h1"), [:])
        XCTAssertEqual(writeDevelop(map, "DJI_0002", nil, nil), map)
    }
}
