// Port of `src/shared/develop/picture-fidelity.test.ts`.

import XCTest
@testable import AtelierKit

private func file(_ name: String, _ type: String = "image/jpeg") -> FidelityFile {
    FidelityFile(name: name, type: type)
}

private func px(_ w: Int, _ h: Int) -> PixelSize { PixelSize(width: w, height: h) }

final class MegapixelsTests: XCTestCase {
    func testCountsASensorPlaneAndARender() {
        assertClose(megapixels(8064, 4536), 36.58, 2)
        assertClose(megapixels(960, 540), 0.518, 3)
    }
}

final class PixelsLabelTests: XCTestCase {
    func testSaysTheFrameAndTheMegapixels() {
        XCTAssertEqual(pixelsLabel(px(8064, 4536)), "8064 × 4536 · 36.6 MP")
    }

    func testClaimsNothingWithoutAMeasurement() {
        XCTAssertNil(pixelsLabel(nil))
        XCTAssertNil(pixelsLabel(px(0, 0)))
    }
}

final class ShortfallLabelTests: XCTestCase {
    func testMeasuresTheDJIDNG() {
        XCTAssertEqual(shortfallLabel(px(960, 540), px(8064, 4536)), "8.4× short on the long edge of its 8064 × 4536")
    }

    func testSaysNothingWhenWhatIsShownAlreadyReachesTheFile() {
        XCTAssertNil(shortfallLabel(px(6000, 4000), px(6000, 4000)))
        // A percent of rounding is not a shortfall.
        XCTAssertNil(shortfallLabel(px(6000, 4000), px(6010, 4006)))
    }

    func testSaysNothingWhenTheFileIsNotKnown() {
        XCTAssertNil(shortfallLabel(px(960, 540), nil))
    }
}

final class PictureFidelityTests: XCTestCase {
    func testHasNothingToSayAboutNoPicture() {
        XCTAssertEqual(pictureFidelity(nil), PictureFidelity(chip: nil, note: nil))
    }

    func testNamesThePixelsOfAnOrdinary8BitPicture() {
        let f = pictureFidelity(file("A.jpg"), nil, FidelityPixels(width: 6000, height: 4000))
        XCTAssertEqual(f.chip, "JPEG · 8-bit · 6000 × 4000")
        XCTAssertTrue(f.note?.contains("6000 × 4000 · 24.0 MP") == true, f.note ?? "")
    }

    func testSaysARAWIsACameraRenderHowBigItIsAndHowFarShort() {
        let f = pictureFidelity(file("DJI_0101.DNG", ""), nil,
                                FidelityPixels(width: 960, height: 540, viaRawPreview: true, full: px(8064, 4536)))
        XCTAssertEqual(f.chip, "RAW · camera render · 960 × 540")
        XCTAssertTrue(f.note?.contains("960 × 540 · 0.5 MP") == true, f.note ?? "")
        XCTAssertTrue(f.note?.contains("8.4× short on the long edge of its 8064 × 4536") == true, f.note ?? "")
    }

    func testStillRefusesToCallARAWRenderTheSensorWhenNothingWasMeasured() {
        let f = pictureFidelity(file("DJI_0101.DNG", ""))
        XCTAssertEqual(f.chip, "RAW · camera render")
        XCTAssertTrue(f.note?.contains("not the sensor data") == true, f.note ?? "")
        // No size was handed in, so none is claimed.
        XCTAssertFalse(f.note?.contains("MP") == true)
    }

    func testReadsAFetchedOriginalByItsNameSinceAnInstanceHandsItOverWithNoType() {
        let f = pictureFidelity(file("DJI_0101.JPG", ""), nil, FidelityPixels(width: 8064, height: 4536))
        XCTAssertEqual(f.chip, "JPEG · 8-bit · 8064 × 4536")
        XCTAssertEqual(pictureFidelity(file("DJI_0001.MP4", "")).chip, "clip · 8-bit")
    }

    func testNamesTheSensorOnARAWBase() {
        let f = pictureFidelity(file("DJI_0101.DNG", ""), .gain, FidelityPixels(width: 8064, height: 4536))
        XCTAssertEqual(f.chip, "RAW · 16-bit linear · 8064 × 4536")
        XCTAssertTrue(f.note?.contains("8064 × 4536 · 36.6 MP") == true, f.note ?? "")
    }

    func testSaysAProxyAndAWorkingPreviewForWhatTheyAre() {
        let origin = MediaOrigin(sourceId: "w.example", fidelity: .proxy)
        XCTAssertEqual(pictureFidelity(FidelityFile(name: "A.webp", type: "image/webp", origin: origin)).chip, "proxy · 8-bit")
        XCTAssertEqual(pictureFidelity(FidelityFile(name: "A.jpg", workingPreview: true)).chip, "working preview · 2048")
        // The proxy rung is the absence of a base: nothing is said about the sensor.
        XCTAssertEqual(pictureFidelity(file("A.jpg"), .proxy).chip, "JPEG · 8-bit")
    }
}
