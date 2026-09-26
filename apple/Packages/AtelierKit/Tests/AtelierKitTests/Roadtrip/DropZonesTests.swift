// Port of `src/tools/roadtrip/drop-zones.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

private func cell(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ rotation: Double = 0) -> CellRect {
    CellRect(x: x, y: y, width: w, height: h, rotation: rotation, mount: .none)
}

final class DropZonesZonesTests: XCTestCase {
    func testTurnsCanvasCellsIntoCssZonesEachKnowingWhatItHolds() {
        let zones = dropZones([cell(0, 0, 400, 800), cell(400, 0, 400, 800, 5)], canvasW: 800, cssW: 400, cssH: 800,
                              holding: ["pic-A", nil])
        XCTAssertEqual(zones, [
            DropZone(index: 0, x: 0, y: 0, w: 200, h: 400, rotation: 0, holding: "pic-A"),
            DropZone(index: 1, x: 200, y: 0, w: 200, h: 400, rotation: 5, holding: nil),
        ])
    }

    func testMakesTheWholeFrameOneZoneWhenTheSlideHoldsOnePicture() {
        XCTAssertEqual(dropZones([], canvasW: 800, cssW: 400, cssH: 700, holding: ["lead"]), [
            DropZone(index: 0, x: 0, y: 0, w: 400, h: 700, rotation: 0, holding: "lead"),
        ])
        XCTAssertNil(dropZones([], canvasW: 800, cssW: 400, cssH: 700, holding: [])[0].holding)
    }
}

final class DropZonesChipTests: XCTestCase {
    private func input(_ phase: DropPhase, _ index: Int, _ holding: String?, collage: Bool = true,
                       source: String? = nil, reason: String? = nil) -> DropChipInput {
        DropChipInput(phase: phase, zoneIndex: index, zoneHolding: holding, collage: collage, label: "pic-B",
                      source: source, reason: reason)
    }

    func testOffersToPlaceInAnEmptyCellAndToReplaceAFilledOne() {
        XCTAssertEqual(dropChip(input(.over, 2, nil)),
                       DropChip(title: "Place here", detail: "Cell 3", tone: .accent, icon: .plus))
        let replace = dropChip(input(.over, 0, "pic-D"))
        XCTAssertEqual(replace.title, "Replace")
        XCTAssertEqual(replace.detail, "pic-D")
        XCTAssertEqual(replace.icon, .swap)
    }

    func testSpeaksOfThePictureNotACellOnASinglePictureSlide() {
        XCTAssertEqual(dropChip(input(.over, 0, nil, collage: false)).title, "Use this picture")
        XCTAssertEqual(dropChip(input(.over, 0, "lead", collage: false)).title, "Replace the picture")
    }

    func testSaysWhereAFetchComesFromThatADropLandedAndWhyOneFailed() {
        let fetching = dropChip(input(.fetching, 1, nil, source: "winnow"))
        XCTAssertEqual(fetching.title, "Fetching…")
        XCTAssertEqual(fetching.detail, "from winnow")
        XCTAssertEqual(fetching.tone, .muted)
        let placed = dropChip(input(.placed, 1, nil))
        XCTAssertEqual(placed.title, "Placed")
        XCTAssertEqual(placed.tone, .ok)
        let failed = dropChip(input(.failed, 1, nil, reason: "offline"))
        XCTAssertEqual(failed.tone, .danger)
        XCTAssertEqual(failed.detail, "offline")
        XCTAssertEqual(dropChip(input(.failed, 1, nil)).detail, "pic-B")
    }
}

final class DropZonesSaidAloudTests: XCTestCase {
    func testNamesThePictureAndTheCell() {
        XCTAssertEqual(dropAnnouncement(DropChipInput(phase: .placed, zoneIndex: 1, zoneHolding: nil, collage: true,
                                                      label: "pic-B")),
                       "pic-B placed in cell 2")
        XCTAssertEqual(dropAnnouncement(DropChipInput(phase: .failed, zoneIndex: 1, zoneHolding: nil, collage: false,
                                                      label: "pic-B", reason: "offline")),
                       "pic-B could not be placed: offline")
        XCTAssertEqual(dropHint(collage: true, cellCount: 4), "Drop on one of the 4 cells")
        XCTAssertEqual(dropHint(collage: false, cellCount: 1), "Drop on the picture to use it")
    }
}
