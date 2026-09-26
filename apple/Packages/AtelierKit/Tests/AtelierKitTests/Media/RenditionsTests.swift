// Port of `src/shared/media/renditions.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func ext(_ name: String) -> String {
    guard let dot = name.lastIndex(of: ".") else { return "" }
    return name[name.index(after: dot)...].lowercased()
}

/// Chrome 152 in the maintainer's desktop app, measured 2026-09-21.
private let chrome: (String) -> Bool = { ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"].contains(ext($0)) }
/// WebKit, which draws HEIF as well.
private let webkit: (String) -> Bool = { chrome($0) || ["heic", "heif", "hif"].contains(ext($0)) }

private func ids(_ input: CaptureInput) -> [String] {
    renditionsOf(input).map { $0.id }
}

private func px(_ w: Int, _ h: Int) -> PixelSize { PixelSize(width: w, height: h) }

final class RenditionsOfTests: XCTestCase {
    func testGivesALoneJPEGOneDeliveredRow() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(name: "DJI_0025.JPG", bytes: 5_000_000, here: true, pixels: px(2171, 2058))))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].id, "delivered:dji_0025.jpg")
        XCTAssertEqual(rows[0].role, .delivered)
        XCTAssertEqual(rows[0].reach, .file)
        XCTAssertNil(rows[0].blocked)
    }

    func testGivesARAWTwoRowsItsCameraRenderAndItsSensor() {
        // The maintainer's A7C II: the render inside the file is full size.
        let rows = renditionsOf(CaptureInput(open: CaptureFile(
            name: "DSC08463.ARW", bytes: 34_600_000, here: true, render: px(7008, 4672), sensor: px(7040, 4688))))
        XCTAssertEqual(rows.map { "\($0.role.rawValue)/\($0.reach.rawValue)" }, ["delivered/embedded", "sensor/sensor"])
        XCTAssertEqual(rows[0].pixels, px(7008, 4672))
        XCTAssertEqual(rows[1].pixels, px(7040, 4688))
    }

    func testSaysTheSameThingAboutADJIDNGWhoseTwoRowsAre84TimesApart() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(
            name: "dji_fly_0242_photo.DNG", here: true, render: px(960, 540), sensor: px(8064, 4536))))
        XCTAssertEqual(rows[0].pixels, px(960, 540))
        XCTAssertEqual(rows[1].pixels, px(8064, 4536))
    }

    func testPutsASourceProxyFirstAndKeepsTheCaptureFilesOwnRows() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "DSC08463.webp", bytes: 400_000, here: true, pixels: px(2048, 1365)),
            openIsProxy: true,
            others: [CaptureFile(name: "DSC08463.ARW", bytes: 34_600_000, assetId: "winnow/12", render: px(7008, 4672))]))
        XCTAssertEqual(rows.map { $0.id }, ["proxy", "delivered:dsc08463.arw", "sensor:dsc08463.arw"])
        XCTAssertTrue(rows[0].here)
        XCTAssertFalse(rows[1].here)
        XCTAssertEqual(rows[1].assetId, "winnow/12")
    }

    func testDropsAHEIFThisBrowserCannotDrawWhenTheARWBesideItAlreadyCan() {
        // The measured Sony pair: both are 7008 × 4672, and only one is reachable.
        let input = CaptureInput(
            open: CaptureFile(name: "DSC07666.HIF", bytes: 12_600_000, here: true),
            others: [CaptureFile(name: "DSC07666.ARW", bytes: 34_600_000, here: true, render: px(7008, 4672))],
            canDraw: chrome)
        XCTAssertEqual(ids(input), ["delivered:dsc07666.arw", "sensor:dsc07666.arw"])
    }

    func testKeepsThatHEIFBlockedAndSayingWhyWhenNothingElseIsDrawable() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(name: "DSC07666.HIF", bytes: 12_600_000, here: true), canDraw: chrome))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].reach, .decoder)
        XCTAssertEqual(rows[0].blocked, "this browser does not draw HIF")
    }

    func testKeepsItOnABrowserThatDrawsItAndThenItIsNotBlockedAtAll() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "DSC07666.HIF", bytes: 12_600_000, here: true, pixels: px(7008, 4672)),
            others: [CaptureFile(name: "DSC07666.ARW", here: true, render: px(7008, 4672))],
            canDraw: webkit))
        XCTAssertEqual(rows.filter { $0.role == .delivered }.map { $0.reach }, [.file, .embedded])
        XCTAssertTrue(rows.allSatisfy { $0.blocked == nil })
    }

    func testKeepsABlockedRowThatIsMeasurablyBiggerThanWhatIsDrawable() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "IMG_1.JPG", here: true, pixels: px(1600, 1200)),
            others: [CaptureFile(name: "IMG_1.HIF", here: true, pixels: px(7008, 4672))],
            canDraw: chrome))
        XCTAssertEqual(rows.map { $0.id }, ["delivered:img_1.jpg", "delivered:img_1.hif"])
        XCTAssertEqual(rows[1].blocked, "this browser does not draw HIF")
    }

    func testOrdersByRoleThenByThePixelsThatWereMeasuredUnmeasuredLast() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "A.webp", here: true, pixels: px(2048, 1365)),
            openIsProxy: true,
            others: [
                CaptureFile(name: "A.ARW", render: px(7008, 4672), sensor: px(7040, 4688)),
                CaptureFile(name: "A.JPG", pixels: px(3000, 2000)),
            ]))
        XCTAssertEqual(rows.map { $0.role }, [.proxy, .delivered, .delivered, .sensor])
        XCTAssertEqual(rows[1].name, "A.JPG")
        XCTAssertEqual(rows[2].name, "A.ARW")
    }

    func testSaysARAWThatCarriesNoRenderAtAllRatherThanHidingTheRow() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(name: "X.NEF", here: true, render: .some(nil))))
        XCTAssertEqual(rows[0].blocked, "this file carries no render a browser can draw")
        XCTAssertEqual(rows[1].role, .sensor)
    }

    func testNeverOffersAnExportOfOursAsTheCamerasFileBesideTheRAW() {
        // §14.6: his own export, named after the DNG and carrying a copy of its
        // EXIF, sat in the folder the originals live in.
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "dji_fly_0242_photo.DNG", here: true, render: px(960, 540)),
            others: [
                CaptureFile(name: "dji_fly_0242_photo.jpg", here: true, pixels: px(7728, 3896), software: "Atelier"),
                CaptureFile(name: "dji_fly_0242_photo.JPG", here: true, pixels: px(8064, 4536), software: "v01.00.0800"),
            ]))
        XCTAssertEqual(rows.map { $0.id }, [
            "delivered:dji_fly_0242_photo.dng",
            "delivered:dji_fly_0242_photo.jpg",
            "sensor:dji_fly_0242_photo.dng",
        ])
        XCTAssertEqual(rows[1].pixels, px(8064, 4536))
    }

    func testKeepsTheOpenFileWhateverWroteItItIsWhatThePersonChoseToWorkOn() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(name: "DJI_0101.jpg", here: true, software: "Atelier")))
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].name, "DJI_0101.jpg")
    }

    func testNeverListsOneFileTwiceWhateverACallerPasses() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "A.ARW", here: true),
            others: [CaptureFile(name: "a.arw"), CaptureFile(name: "A.ARW")]))
        XCTAssertEqual(rows.count, 2)
    }
}

final class RenditionByIdTests: XCTestCase {
    func testFindsAStoredChoiceAndAnswersNilForOneThisCaptureNoLongerHas() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(name: "DSC08463.ARW", here: true, render: px(7008, 4672))))
        XCTAssertEqual(renditionById(rows, "sensor:dsc08463.arw")?.role, .sensor)
        XCTAssertNil(renditionById(rows, "sensor:gone.arw"))
        XCTAssertNil(renditionById(rows, nil))
    }
}

final class OpeningRenditionTests: XCTestCase {
    func testOpensOnTheProxyWhenThereIsOne() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "A.webp", here: true, pixels: px(2048, 1365)),
            openIsProxy: true,
            others: [CaptureFile(name: "A.ARW", assetId: "winnow/9", render: px(7008, 4672))]))
        XCTAssertEqual(openingRendition(rows)?.id, "proxy")
    }

    func testOpensOnAFileInHandBeforeOneThatWouldHaveToBeFetched() {
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "A.ARW", here: true, render: px(7008, 4672)),
            others: [CaptureFile(name: "A.JPG", assetId: "winnow/9", pixels: px(3000, 2000))]))
        XCTAssertEqual(openingRendition(rows)?.name, "A.ARW")
    }

    func testNeverOpensOnTheSensorAndNeverOnABlockedRow() {
        let rows = renditionsOf(CaptureInput(open: CaptureFile(name: "DSC07666.HIF", here: true), canDraw: chrome))
        XCTAssertNil(openingRendition(rows))
    }
}

final class RenditionFactsTests: XCTestCase {
    // Not in the web spec: the facts line, with the kernel's own byte format
    // and as much of it as was measured.
    func testSaysThePixelsAndTheWeightWhereMeasured() {
        let row = Rendition(id: "delivered:a.arw", role: .delivered, reach: .embedded, name: "A.ARW",
                            bytes: 2_700_000, pixels: px(7008, 4672), here: true)
        XCTAssertEqual(renditionFacts(row), "7008 × 4672 · 2.7 MB")
        XCTAssertEqual(renditionFacts(row, formatBytes: { "\($0) B" }), "7008 × 4672 · 2700000 B")
        XCTAssertEqual(renditionFacts(Rendition(id: "proxy", role: .proxy, reach: .file, name: "a.webp", here: true)), "")
    }
}
