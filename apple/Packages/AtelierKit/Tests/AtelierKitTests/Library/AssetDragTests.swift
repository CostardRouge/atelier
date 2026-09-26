// Port of `src/shared/library/asset-drag.test.ts`. The transfer half is the
// kernel's; the drag IN FLIGHT (the item held in memory, its subscribers, the
// page ending a drag whose source vanished) is the app's `AssetDragRegistry`,
// so those cases are skipped here with the reason.

import Foundation
import XCTest
@testable import AtelierKit

final class AssetDragTransferTests: XCTestCase {
    func testCarriesTheKeyAsItsOwnTextSoADropOutsidePastesSomethingInert() {
        let text = assetDragText("uluru-dusk")
        XCTAssertEqual(text, "atelier-asset:uluru-dusk")
        XCTAssertEqual(draggedAssetKey(text), "uluru-dusk")
    }

    func testIgnoresADragThatIsNotOursAFileFromTheDesktopASelection() {
        XCTAssertNil(draggedAssetKey(nil))
        XCTAssertNil(draggedAssetKey("uluru-dusk"))
        XCTAssertNil(draggedAssetKey("file:///Users/steeve/DJI_0001.JPG"))
    }

    func testRefusesAnEmptyKeyRatherThanHandingBackABlank() {
        XCTAssertNil(draggedAssetKey("atelier-asset:   "))
        XCTAssertNil(draggedAssetKey(assetDragPrefix))
    }

    func testNamesAPoolAssetAndAnInstanceTileTheWebsWay() {
        XCTAssertEqual(libraryDragKey("dji_0101"), "asset:dji_0101")
        XCTAssertEqual(instanceDragKey("winnow.example", 42), "remote:winnow.example/42")
        XCTAssertEqual(draggedAssetKey(assetDragText(instanceDragKey("winnow.example", 42))), "remote:winnow.example/42")
    }
}

final class AssetDragInFlightTests: XCTestCase {
    func testIsReadableWhileItLastsAndGoneOnceItEnds() throws {
        throw XCTSkip("The drag in flight is held by the app's AssetDragRegistry (Atelier/Library/AssetDrag.swift).")
    }

    func testEndsByItselfWhenThePageSeesTheDragIsOver() throws {
        throw XCTSkip("SwiftUI's draggable reports no end to its source; the app's registry is replaced per drag instead.")
    }

    func testTellsItsSubscribersWhenItStartsAndEnds() throws {
        throw XCTSkip("Subscribers are the app's @Observable registry, not the kernel's.")
    }
}
