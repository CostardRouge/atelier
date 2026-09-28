// Port of `src/shared/develop/capture-view.test.ts`.

import XCTest
@testable import AtelierKit

private let mb: (Int) -> String = { "\(Int((Double($0) / 1e6).rounded())) MB" }

private let proxy = Rendition(id: "proxy", role: .proxy, reach: .file, name: "DJI_0101.JPG", bytes: nil,
                              pixels: PixelSize(width: 2048, height: 1152), here: true, assetId: "w/1", blocked: nil)
private let jpeg = Rendition(id: "delivered:dji_0101.jpg", role: .delivered, reach: .file, name: "DJI_0101.JPG", bytes: 9_000_000,
                             pixels: PixelSize(width: 8064, height: 4536), here: false, assetId: "w/1", blocked: nil)
private let render = Rendition(id: "delivered:dji_0101.dng", role: .delivered, reach: .embedded, name: "DJI_0101.DNG",
                               bytes: 74_000_000, pixels: nil, here: false, assetId: "w/2", blocked: nil)
private let sensor: Rendition = {
    var r = render
    r.id = "sensor:dji_0101.dng"
    r.role = .sensor
    r.reach = .sensor
    return r
}()

final class ViewerListTests: XCTestCase {
    func testLeavesTheSensorOutAViewerDrawsFilesDevelopDevelopsPlanes() {
        XCTAssertEqual(viewableRenditions([proxy, jpeg, render, sensor]).map(\.id),
                       ["proxy", "delivered:dji_0101.jpg", "delivered:dji_0101.dng"])
    }

    func testUsesTheFidelityChipsOwnWords() {
        XCTAssertEqual(viewLabel(proxy), "Proxy")
        XCTAssertEqual(viewLabel(jpeg), "DJI_0101.JPG")
        XCTAssertEqual(viewLabel(render), "DJI_0101.DNG")
    }

    func testSaysWhatTheFileIsItsPixelsItsWeightAndWhetherAClickFetches() {
        XCTAssertEqual(viewFacts(proxy, mb), "the proxy, where the picture opens · 2048 × 1152")
        XCTAssertEqual(viewFacts(jpeg, mb),
                       "the file itself · 8064 × 4536 · 9 MB · fetched from its instance on request, held for this session")
        var inHand = render
        inHand.here = true
        XCTAssertEqual(viewFacts(inHand, mb), "the render the camera wrote inside the RAW · 74 MB")
    }
}

final class ViewedRenditionTests: XCTestCase {
    private let rows = [proxy, jpeg, render, sensor]

    func testIsNilForTheOpeningRowAndForNoChoiceAtAllSoALookWritesNoChoice() {
        XCTAssertNil(viewedRendition(rows, nil))
        XCTAssertNil(viewedRendition(rows, "proxy"))
    }

    func testIsTheRenditionBeingViewedOtherwise() {
        XCTAssertEqual(viewedRendition(rows, "delivered:dji_0101.jpg"), "delivered:dji_0101.jpg")
        XCTAssertEqual(viewedRendition(rows, "delivered:dji_0101.dng"), "delivered:dji_0101.dng")
    }

    func testNeverCarriesABlockedOrUnknownRow() {
        var blocked = jpeg
        blocked.blocked = "this browser does not draw HIF"
        XCTAssertNil(viewedRendition([proxy, blocked], jpeg.id))
        XCTAssertNil(viewedRendition(rows, "delivered:nope.jpg"))
    }
}

final class RowCaptureInputTests: XCTestCase {
    private let row = CaptureRow(
        id: 1, filename: "DJI_0101.JPG", width: 8064, height: 4536, fileSize: 9_000_000, groupKind: "raw_jpeg",
        companionId: 2, companionFilename: "DJI_0101.DNG", companionFileSize: 74_000_000, companionMediaType: "photo",
        companionWidth: 8064, companionHeight: 4536
    )

    func testListsTheProxyThePrimaryAndTheCompanionWithTheIdsTheWorkbenchWillUse() {
        let rows = renditionsOf(rowCaptureInput(row, "w") { _ in false })
        XCTAssertEqual(rows.map { "\($0.id) \($0.here)" }, [
            "proxy true",
            "delivered:dji_0101.jpg false",
            "delivered:dji_0101.dng false",
            "sensor:dji_0101.dng false",
        ])
        XCTAssertEqual(rows[1].pixels, PixelSize(width: 8064, height: 4536))
        // The RAW's own pixels are the SENSOR's; its render is unmeasured until looked at.
        XCTAssertNil(rows[2].pixels)
        XCTAssertEqual(rows[3].pixels, PixelSize(width: 8064, height: 4536))
    }

    func testSaysWhichFilesTheSessionAlreadyHolds() {
        let rows = renditionsOf(rowCaptureInput(row, "w") { $0 == "w/2" })
        XCTAssertEqual(rows.first { $0.id == "delivered:dji_0101.dng" }?.here, true)
        XCTAssertEqual(rows.first { $0.id == "delivered:dji_0101.jpg" }?.here, false)
    }

    func testRefusesALivePhotosMovAsAFileOfTheCapture() {
        var live = row
        live.groupKind = "live_photo"
        live.companionFilename = "IMG_1.MOV"
        live.companionMediaType = "video"
        XCTAssertEqual(renditionsOf(rowCaptureInput(live, "w") { _ in false }).map(\.id), ["proxy", "delivered:dji_0101.jpg"])
    }
}
