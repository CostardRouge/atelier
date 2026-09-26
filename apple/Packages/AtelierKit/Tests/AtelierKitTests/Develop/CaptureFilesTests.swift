// Port of `src/shared/develop/capture-files.test.ts`.

import XCTest
@testable import AtelierKit

private func file(_ name: String, _ bytes: Int = 1000) -> SavedMediaRef {
    SavedMediaRef(name: name, size: bytes, lastModified: 0)
}

private func px(_ w: Int, _ h: Int) -> PixelSize { PixelSize(width: w, height: h) }

private func proxyOver(_ name: String, _ width: Int, _ height: Int, _ bytes: Int, companion: CaptureCompanion? = nil) -> MediaOrigin {
    MediaOrigin(sourceId: "winnow.example", fidelity: .proxy, width: width, height: height, name: name, bytes: bytes, companion: companion)
}

final class CaptureInputTests: XCTestCase {
    func testListsALocalARWAsItsOwnRenderAndItsSensorAndNothingElse() {
        let rows = renditionsOf(captureInput(CaptureFacts(
            file: file("DSC08463.ARW", 34_600_000), measured: px(7008, 4672), sensor: px(7040, 4688))))
        XCTAssertEqual(rows.map { "\($0.id) \($0.here)" }, ["delivered:dsc08463.arw true", "sensor:dsc08463.arw true"])
        XCTAssertEqual(rows[0].pixels, px(7008, 4672))
        XCTAssertEqual(rows[1].pixels, px(7040, 4688))
    }

    func testPutsAProxyFirstAndItsDrawableOriginalAfterItWithTheSourcesPixelsAndWeight() {
        let rows = renditionsOf(captureInput(CaptureFacts(
            file: file("DJI_0101.webp", 400_000),
            origin: proxyOver("DJI_0101.JPG", 8064, 4536, 9_000_000),
            measured: px(2048, 1152),
            original: .init(assetId: "winnow.example/12", held: false))))
        XCTAssertEqual(rows.map(\.id), ["proxy", "delivered:dji_0101.jpg"])
        XCTAssertEqual(rows[1].reach, .file)
        XCTAssertFalse(rows[1].here)
        XCTAssertEqual(rows[1].assetId, "winnow.example/12")
        XCTAssertEqual(rows[1].bytes, 9_000_000)
        XCTAssertEqual(rows[1].pixels, px(8064, 4536))
        XCTAssertEqual(rows[0].pixels, px(2048, 1152))
    }

    func testSaysAProxysRAWOriginalIsInHandOnceItIsHeldAndItsRenderOnlyOnceRead() {
        let before = renditionsOf(captureInput(CaptureFacts(
            file: file("dji_fly_0242.webp"),
            origin: proxyOver("dji_fly_0242_photo.DNG", 8064, 4536, 74_000_000),
            measured: px(2048, 1152),
            original: .init(assetId: "winnow.example/9", held: false))))
        XCTAssertEqual(before.map(\.id), ["proxy", "delivered:dji_fly_0242_photo.dng", "sensor:dji_fly_0242_photo.dng"])
        // Nobody looked: the render's size is not the sensor's, and is not invented from it.
        XCTAssertNil(before[1].pixels)
        XCTAssertEqual(before[2].pixels, px(8064, 4536))

        let after = renditionsOf(captureInput(CaptureFacts(
            file: file("dji_fly_0242.webp"),
            origin: proxyOver("dji_fly_0242_photo.DNG", 8064, 4536, 74_000_000),
            measured: px(2048, 1152),
            original: .init(assetId: "winnow.example/9", held: true, render: .some(px(960, 540))))))
        XCTAssertTrue(after[1].here)
        XCTAssertEqual(after[1].pixels, px(960, 540))
    }

    func testListsTheCompanionBehindASonyHIFTheARWsRenderAndSensorUnderItsOwnAssetId() {
        let origin = proxyOver("DSC08463.HIF", 7008, 4672, 12_600_000,
                               companion: CaptureCompanion(assetId: "winnow.example/99", name: "DSC08463.ARW",
                                                           bytes: 34_600_000, width: 7040, height: 4688))
        let chrome: (String) -> Bool = { $0.range(of: "\\.(jpe?g|png|webp)$", options: [.regularExpression, .caseInsensitive]) != nil }
        let rows = renditionsOf(captureInput(CaptureFacts(
            file: file("DSC08463.webp"),
            origin: origin,
            measured: px(2048, 1365),
            original: .init(assetId: "winnow.example/12", held: false),
            companion: .init(held: false, render: .some(px(7008, 4672))),
            canDraw: chrome)))
        // The HIF row is pruned: this renderer cannot draw it and the ARW's render is the same picture.
        XCTAssertEqual(rows.map(\.id), ["proxy", "delivered:dsc08463.arw", "sensor:dsc08463.arw"])
        XCTAssertEqual(rows[1].reach, .embedded)
        XCTAssertFalse(rows[1].here)
        XCTAssertEqual(rows[1].assetId, "winnow.example/99")
        XCTAssertEqual(rows[1].pixels, px(7008, 4672))
        XCTAssertEqual(rows[2].bytes, 34_600_000)
        XCTAssertEqual(rows[2].pixels, px(7040, 4688))
        // Nothing of the companion is listed before the caller says what it knows of it.
        let unknown = renditionsOf(captureInput(CaptureFacts(file: file("DSC08463.webp"), origin: origin, canDraw: chrome)))
        XCTAssertEqual(unknown.map(\.id), ["proxy", "delivered:dsc08463.hif"])
    }

    func testAddsAFoldersSiblingsTheDNGBesideAJPEGAndLeavesAnExportOfOursOut() {
        let rows = renditionsOf(captureInput(CaptureFacts(
            file: file("DJI_0101.JPG", 9_000_000),
            measured: px(8064, 4536),
            siblings: [
                .init(file: file("DJI_0101.DNG", 74_000_000),
                      facts: SiblingFacts(software: nil, render: .some(px(960, 540)), sensor: px(8064, 4536))),
                .init(file: file("DJI_0101.jpg", 3_000_000), facts: SiblingFacts(software: "Atelier", pixels: px(7728, 3896))),
            ])))
        XCTAssertEqual(rows.map(\.id), ["delivered:dji_0101.dng", "delivered:dji_0101.jpg", "sensor:dji_0101.dng"])
        // The JPEG row is the file in hand, not the export of ours.
        XCTAssertEqual(rows[1].bytes, 9_000_000)
        XCTAssertTrue(rows.allSatisfy(\.here))
    }
}
