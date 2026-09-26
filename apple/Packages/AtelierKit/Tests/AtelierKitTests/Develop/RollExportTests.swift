// The part of `src/shared/develop/roll-export.test.ts` that covers what
// `RollExport.swift` ports — `rollOutputSize`, the delivered layout,
// `deliverySummary`, `exportName` and `describeRun` — ported one for one (the
// rest of that spec is `DeliverySourceTests.swift`'s); then the one case of
// the native app's own: a run saved into the photo library.

import XCTest
@testable import AtelierKit

private let proxy = Size(2048, 1536)
private let original = OriginalInfo(width: 8064, height: 6048, name: "DJI_0421.JPG", bytes: 24_000_000)

private func matches(_ text: String?, _ pattern: String, file: StaticString = #filePath, line: UInt = #line) {
    guard let text else { return XCTFail("nil does not match /\(pattern)/", file: file, line: line) }
    XCTAssertNotNil(text.range(of: pattern, options: .regularExpression), "\(text) does not match /\(pattern)/", file: file, line: line)
}

private func zoomed(_ scale: Double) -> Framing {
    var f = Framing.default
    f.scale = scale
    return f
}

private var whole: Framing {
    var f = Framing.default
    f.fit = .contain
    return f
}

final class RollOutputSizeTests: XCTestCase {
    func testKeepsTheSourceItselfForItsOwnAspectCappedToTheLongEdge() {
        XCTAssertEqual(rollOutputSize(proxy, proxy.width / proxy.height, nil), Size(2048, 1536))
        XCTAssertEqual(rollOutputSize(proxy, proxy.width / proxy.height, 1024), Size(1024, 768))
    }

    func testNeverUpscalesPastTheSource() {
        XCTAssertEqual(rollOutputSize(proxy, proxy.width / proxy.height, 4096), Size(2048, 1536))
    }

    func testCoverCropsAPresetAtTheSourceDensity() {
        // A landscape proxy to 4:5 keeps 1229 px of width.
        XCTAssertEqual(rollOutputSize(proxy, 4.0 / 5, nil), Size(1229, 1536))
        XCTAssertEqual(rollOutputSize(proxy, 4.0 / 5, 1920), Size(1229, 1536))
        XCTAssertEqual(rollOutputSize(Size(8064, 6048), 4.0 / 5, 1920), Size(1536, 1920))
    }

    func testIsEmptyForAnEmptySource() {
        XCTAssertEqual(rollOutputSize(Size(0, 0), 1, nil), Size(0, 0))
    }
}

final class DeliveredLayoutTests: XCTestCase {
    func testIsTheCropAtTheSourcesOwnDensityCappedAndNeverUpscaled() {
        let d = deliveredLayout(proxy, 1, zoomed(2), nil, nil)
        assertClose(d.zone.width, 768, 6)
        XCTAssertEqual(d.out, Size(768, 768))
        XCTAssertEqual(deliveredLayout(proxy, 1, zoomed(2), nil, 512).out, Size(512, 512))
        XCTAssertEqual(cropZoneSize(proxy, 1, nil), Size(1536, 1536))
    }

    func testKeepsALegacyWholeFramingInItsAspectBox() {
        let d = deliveredLayout(proxy, 4.0 / 5, whole, nil, nil)
        XCTAssertEqual(d.out, Size(1229, 1536))
    }

    func testPlacesTheCropInItsBorderCentredOnTheRoundedCanvas() {
        let border = RollBorder(aspect: nil, fill: "#000000", margin: RollBorder.Margin(x: 0.25, y: 0))
        let d = deliveredLayout(proxy, proxy.width / proxy.height, nil, border, 1000)
        XCTAssertEqual(d.out.width, 1000)
        assertClose(d.layout.x, (d.layout.w - d.layout.pw) / 2, 9)
        assertClose(d.layout.w, 1000, 9)
    }
}

final class DeliverySummaryTests: XCTestCase {
    private let settings = DeliverySettings(longEdge: 1920, pixels: .auto)

    func testDeliversALocalFileFromItselfAndSaysSo() {
        let s = deliverySummary(proxy, false, nil, nil, proxy.width / proxy.height, nil, settings)
        XCTAssertEqual(s.from, .file)
        XCTAssertEqual(s.out, Size(1920, 1440))
        matches(s.line, "^File 2048 px → 1920 · ×1\\.07 to spare$")
        XCTAssertNil(s.reason)
    }

    func testTurnsToTheOriginalWhenTheProxyCropWouldUpscaleAndSizesTheFrameFromIt() {
        let s = deliverySummary(proxy, true, original, nil, 4.0 / 5, nil, settings)
        XCTAssertEqual(s.from, .original)
        XCTAssertEqual(s.out, Size(1536, 1920))
        // The original is called by its NAME — the word the fidelity chip's menu uses for it.
        matches(s.line, "^DJI_0421\\.JPG 6048 px → 1920")
        matches(s.reason, "upscaled")
    }

    func testStaysOnTheProxyWhenItHasThePixelsAndUnderProxiesDeliversWhatItHasAndSaysWhatWasAsked() {
        let own = deliverySummary(proxy, true, original, nil, 16.0 / 9, nil, settings)
        XCTAssertEqual(own.from, .file)
        XCTAssertEqual(own.line, "Proxy 2048 px → 1920 · ×1.07 to spare")
        let forced = deliverySummary(proxy, true, original, nil, 4.0 / 5, nil, DeliverySettings(longEdge: 1920, pixels: .proxies))
        XCTAssertEqual(forced.from, .file)
        XCTAssertEqual(forced.out, Size(1229, 1536))
        XCTAssertEqual(forced.line, "Proxy 1536 px → 1536 · exact · asked 1920")
    }

    func testWithSourceSizeAskedAutoTurnsToTheOriginalItsPixelsAreTheSourceSize() {
        let s = deliverySummary(proxy, true, original, nil, proxy.width / proxy.height, nil, DeliverySettings(longEdge: nil, pixels: .auto))
        XCTAssertEqual(s.from, .original)
        XCTAssertEqual(s.out, Size(8064, 6048))
        XCTAssertEqual(s.line, "DJI_0421.JPG 8064 px → 8064 · exact")
    }

    func testASmallerCropDeliversAtItsOwnDensityNeverBlownUpToTheAspectBox() {
        let s = deliverySummary(proxy, false, nil, zoomed(1.6), proxy.width / proxy.height, nil, settings)
        XCTAssertEqual(s.from, .file)
        XCTAssertEqual(s.out, Size(1280, 960))
        XCTAssertEqual(s.line, "File 1280 px → 1280 · exact")
    }

    func testCountsTheBorderInTheFileAndSaysTheCropItCarries() {
        let border = RollBorder(aspect: "1:1", fill: "#ffffff", margin: RollBorder.Margin(x: 0.1, y: 0.1))
        let s = deliverySummary(proxy, false, nil, nil, proxy.width / proxy.height, border, DeliverySettings(longEdge: nil, pixels: .auto))
        // 2048 × 1536 + 10 % of 1536 each side → 2355.2 × 1843.2, squared → 2355 × 2355.
        XCTAssertEqual(s.out, Size(2355, 2355))
        XCTAssertEqual(s.line, "File 2048 px → 2355 · exact")
    }

    func testDeliversFromTheProxyWhenTheOriginalIsARAWNobodyHasMeasuredAndSaysWhy() {
        var raw = original
        raw.name = "DJI_0421.DNG"
        let s = deliverySummary(proxy, true, raw, nil, 4.0 / 5, nil, settings)
        XCTAssertEqual(s.from, .file)
        matches(s.reason, "RAW")
        // The frame is NOT planned against the sensor: those pixels can never be
        // delivered here, so "asked 8064" would be a promise nothing can keep.
        XCTAssertEqual(s.line, "Proxy 1536 px → 1536 · exact")
    }

    func testCallsARAWOriginalWhatItIsTheRenderInsideItNeverTheSensor() {
        var raw = original
        raw.name = "DJI_0421.DNG"
        raw.render = Size(6048, 4032)
        let s = deliverySummary(proxy, true, raw, nil, 4.0 / 5, nil, settings)
        XCTAssertEqual(s.from, .original)
        matches(s.line, "^DJI_0421\\.DNG render ")
    }

    func testReadsATargetSizeAgainstEachSourceAFullSizeTargetIsTheOriginal() {
        // The size form of the settings (`size`, the web's target): nil is the
        // picture's own size, which on a proxy is what the original gives.
        let s = deliverySummary(proxy, true, original, nil, proxy.width / proxy.height, nil, DeliverySettings(size: nil, pixels: .auto))
        XCTAssertEqual(s.from, .original)
        XCTAssertEqual(s.out, Size(8064, 6048))
        let web = deliverySummary(proxy, false, nil, nil, proxy.width / proxy.height, nil,
                                  DeliverySettings(size: ExportSize(mode: .long, value: 1920), pixels: .auto))
        XCTAssertEqual(web.out, Size(1920, 1440))
    }
}

final class RollExportNamesTests: XCTestCase {
    func testNamesTheExportExactlyAfterThePictureThePairingConvention() {
        XCTAssertEqual(exportName("DJI_0101.JPG"), "DJI_0101.jpg")
        // The proxy's own extension never reaches the file: a JPEG leaves.
        XCTAssertEqual(exportName("IMG_0421.webp"), "IMG_0421.jpg")
        XCTAssertEqual(exportName("a.b.tif"), "a.b.jpg")
        XCTAssertEqual(exportName(".jpg"), "picture.jpg")
    }

    func testCountsFilesAndPicturesApartOnceARunHasSeveralTargets() {
        XCTAssertEqual(describeRun(6, .folder, [], 0, run: (pictures: 3, targets: 2)), "3 pictures × 2 targets — 6 files written")
        XCTAssertEqual(describeRun(3, .folder, [], 0, run: (pictures: 3, targets: 1)), "3 pictures written")
    }

    func testDescribesARunWithItsFirstFailure() {
        XCTAssertEqual(describeRun(3, .folder, []), "3 pictures written")
        XCTAssertEqual(describeRun(1, .download, []), "1 picture downloaded")
        XCTAssertEqual(describeRun(0, .folder, ["a.jpg is not in the Library", "b"]),
                       "Nothing was written — a.jpg is not in the Library (+1 more)")
    }

    func testSaysHowManyWereNumberedAroundAFileAlreadyInTheFolder() {
        XCTAssertEqual(describeRun(3, .folder, [], 1), "3 pictures written · 1 numbered, the folder already held that name")
        XCTAssertEqual(describeRun(3, .folder, [], 2), "3 pictures written · 2 numbered, the folder already held those names")
        XCTAssertEqual(describeRun(2, .folder, ["b.jpg: no room"], 1),
                       "2 pictures written · 1 numbered, the folder already held that name — b.jpg: no room")
    }

    func testSaysARunSavedIntoThePhotoLibraryTheNativeAppsOwn() {
        XCTAssertEqual(describeRun(2, .photos, []), "2 pictures saved to Photos")
        XCTAssertEqual(describeRun(4, .photos, [], 0, run: (pictures: 2, targets: 2)), "2 pictures × 2 targets — 4 files saved to Photos")
    }
}
