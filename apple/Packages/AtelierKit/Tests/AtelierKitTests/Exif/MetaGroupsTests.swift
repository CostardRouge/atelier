// Port of `src/shared/exif/meta-groups.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func preset(_ id: MetaPresetId) -> MetaChoice {
    metaPresets.first { $0.id == id }!.choice
}

final class MetaChoiceTests: XCTestCase {
    func testReadsAnOlderRollAsAllAndAnythingButAStoredFalseAsKept() {
        XCTAssertEqual(readMetaChoice(nil), allMeta)
        XCTAssertEqual(
            readMetaChoice(.object(["position": .bool(false), "camera": .string("no")])),
            MetaChoice(position: false)
        )
    }

    func testNamesItsPresetOrNoneForACombinationOfItsOwn() {
        for p in metaPresets { XCTAssertEqual(presetOf(p.choice), p.id) }
        XCTAssertNil(presetOf(MetaChoice(exposure: false)))
    }

    func testKeepsTheBlockWholeOnlyWhileEveryCaptureGroupAndTheMakerNotesStay() {
        XCTAssertTrue(keepsWholeBlock(allMeta))
        XCTAssertTrue(keepsWholeBlock(MetaChoice(words: false, rights: false)))
        for g: MetaGroup in [.camera, .exposure, .time, .position, .makerNotes] {
            var choice = allMeta
            choice[g] = false
            XCTAssertFalse(keepsWholeBlock(choice), g.rawValue)
        }
        XCTAssertFalse(keepsCapture(preset(.minimal)))
    }

    func testDropsExactlyTheGroupsLeftOutAndNeverWhatDescribesTheFile() {
        let exif = exifData {
            $0.make = "DJI"
            $0.iso = 100
            $0.dateTimeOriginal = "x"
            $0.gps = GpsCoord(lat: 1, lon: 2)
            $0.relativeAltitude = 50
            $0.software = "S"
            $0.pixelWidth = 10
            $0.artist = "A"
        }
        XCTAssertEqual(
            filterExif(exif, MetaChoice(position: false)),
            exifData { $0.make = "DJI"; $0.iso = 100; $0.dateTimeOriginal = "x"; $0.software = "S"; $0.pixelWidth = 10; $0.artist = "A" }
        )
        XCTAssertEqual(
            filterExif(exif, preset(.minimal)),
            exifData { $0.software = "S"; $0.pixelWidth = 10; $0.artist = "A" }
        )
        // The web compares the panel's order to `ALL_META`'s keys: here the
        // groups' declared order, and the stored record names every one.
        XCTAssertEqual(metaGroups.map { $0.id }, MetaGroup.allCases)
        XCTAssertEqual(Set(allMeta.json.objectValue?.keys.map { $0 } ?? []), Set(MetaGroup.allCases.map { $0.rawValue }))
    }
}
