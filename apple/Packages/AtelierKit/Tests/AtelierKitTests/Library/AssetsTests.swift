// Port of `src/shared/library/assets.test.ts` (the `buildAssets` half; the
// `capabilities` half is `CapabilitiesTests.swift`).

import Foundation
import XCTest
@testable import AtelierKit

/// The web's fake `File`: a name and a stable-ish size.
func f(_ name: String, _ size: Int = 10) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: 0)
}

final class BuildAssetsTests: XCTestCase {
    func testPairsAVideoWithItsSRTSiblingIntoOneVideoTelemetryAsset() {
        let assets = buildAssets([f("DJI_0001.MP4"), f("DJI_0001.SRT")])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].kind, .videoTelemetry)
        XCTAssertEqual(assets[0].parts.video?.name, "DJI_0001.MP4")
        XCTAssertEqual(assets[0].parts.srt?.name, "DJI_0001.SRT")
    }

    func testClassifiesALoneVideoALoneSRTAndAPhoto() {
        let assets = buildAssets([f("a.mov"), f("b.srt"), f("c.jpg")])
        let byId = Dictionary(uniqueKeysWithValues: assets.map { ($0.id, $0.kind) })
        XCTAssertEqual(byId, ["a": .video, "b": .telemetry, "c": .photo])
    }

    func testGroupsARAWAndItsJPEGIntoOnePhotoAssetShowingTheDecodableHalfAndKeepingTheRAW() {
        let assets = buildAssets([f("IMG_8801.RAF"), f("IMG_8801.JPG")])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].kind, .photo)
        XCTAssertEqual(assets[0].parts.image?.name, "IMG_8801.JPG")
        XCTAssertEqual(assets[0].parts.siblings?.map { $0.name }, ["IMG_8801.RAF"])
    }

    func testDoesNotLetTheListingOrderDecideWhichHalfOfAPairIsShown() {
        let jpegFirst = buildAssets([f("IMG_8801.JPG"), f("IMG_8801.RAF")])
        XCTAssertEqual(jpegFirst[0].parts.image?.name, "IMG_8801.JPG")
        XCTAssertEqual(jpegFirst[0].parts.siblings?.map { $0.name }, ["IMG_8801.RAF"])
    }

    func testShowsTheRAWOfASonyPairSinceOnlyWebKitDrawsTheHEIFBesideIt() {
        let assets = buildAssets([f("DSC00123.ARW"), f("DSC00123.HIF")])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].kind, .photo)
        XCTAssertEqual(assets[0].parts.image?.name, "DSC00123.ARW")
        XCTAssertEqual(assets[0].parts.siblings?.map { $0.name }, ["DSC00123.HIF"])
        // And the other way round in the listing, which must decide nothing.
        let other = buildAssets([f("DSC00123.HIF"), f("DSC00123.ARW")])[0]
        XCTAssertEqual(other.parts.image?.name, "DSC00123.ARW")
        XCTAssertEqual(other.parts.siblings?.map { $0.name }, ["DSC00123.HIF"])
    }

    func testKeepsEveryImageFileOfAThreeFileCaptureAndItsSizeCountsThemAll() {
        let assets = buildAssets([f("DJI_0001.DNG", 60), f("DJI_0001.JPG", 8), f("DJI_0001.HIF", 12)])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].parts.image?.name, "DJI_0001.JPG")
        XCTAssertEqual(assets[0].parts.siblings?.map { $0.name }, ["DJI_0001.DNG", "DJI_0001.HIF"])
        XCTAssertEqual(assets[0].size, 80)
        XCTAssertEqual(assetFiles(assets[0].parts).map { $0.name }, ["DJI_0001.JPG", "DJI_0001.DNG", "DJI_0001.HIF"])
    }

    func testSaysTheCapturesOtherFilesByTypeSoARAWBesideItsJPEGIsNeverSilent() {
        let dji = buildAssets([f("DJI_0101.JPG"), f("DJI_0101.DNG")])[0]
        XCTAssertEqual(siblingTypes(dji.parts), ["DNG"])
        XCTAssertTrue(hasRawSibling(dji.parts))
        // Added later, apart from its twin: still one asset, and still said.
        let sony = buildAssets([f("DSC00200.JPG"), f("DSC00200.ARW"), f("DSC00200.HIF")])[0]
        XCTAssertEqual(siblingTypes(sony.parts), ["ARW", "HIF"])
        let heifOnly = buildAssets([f("DSC00300.JPG"), f("DSC00300.HIF")])[0]
        XCTAssertFalse(hasRawSibling(heifOnly.parts))
        let lone = buildAssets([f("DSC00123.ARW")])[0]
        XCTAssertEqual(siblingTypes(lone.parts), [])
        XCTAssertEqual(captureFileType("a.jpeg"), "JPEG")
        XCTAssertEqual(captureFileType("a.dng"), "DNG")
        XCTAssertEqual(captureFileType("noext"), "file")
    }

    func testHasNoSiblingsOnALonePicture() {
        XCTAssertNil(buildAssets([f("c.jpg")])[0].parts.siblings)
    }

    func testTakesALoneHEIFAsAPhotoAllTheSame() {
        let assets = buildAssets([f("DSC00124.HIF")])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].kind, .photo)
        XCTAssertEqual(assets[0].parts.image?.name, "DSC00124.HIF")
    }

    func testKeepsARAWAsTheImageWhenItIsTheOnlyOne() {
        let assets = buildAssets([f("IMG_8801.RAF")])
        XCTAssertEqual(assets[0].parts.image?.name, "IMG_8801.RAF")
    }

    func testKeepsTheFirstOfTwoDecodableImagesDeterministically() {
        let assets = buildAssets([f("IMG_8801.JPG"), f("IMG_8801.PNG")])
        XCTAssertEqual(assets[0].parts.image?.name, "IMG_8801.JPG")
    }

    func testPairsCaseInsensitivelyOnTheBaseName() {
        let assets = buildAssets([f("Clip01.mp4"), f("CLIP01.srt")])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].kind, .videoTelemetry)
    }

    func testIgnoresJunkProxiesThumbnailsAndHiddenDotfiles() {
        let assets = buildAssets([f("DJI_0001.MP4"), f("DJI_0001.LRF"), f("DJI_0001.THM"), f(".DS_Store")])
        XCTAssertEqual(assets.count, 1)
        XCTAssertEqual(assets[0].kind, .video)
    }

    func testSumsPartSizesAndSortsByBaseName() {
        let assets = buildAssets([f("b.mp4", 5), f("a.mp4", 3), f("a.srt", 2)])
        XCTAssertEqual(assets.map { $0.baseName }, ["a", "b"])
        XCTAssertEqual(assets[0].size, 5) // a.mp4 + a.srt
    }

    // Not in the web spec: the identity a repeated drop is deduped on, spelled
    // as the web spells it (`name__size__lastModified`, no `.0`).
    func testFileIdentityIsNameSizeAndModifiedStamp() {
        XCTAssertEqual(fileIdentity(SavedMediaRef(name: "a.jpg", size: 12, lastModified: 1_700_000_000_000)), "a.jpg__12__1700000000000")
        XCTAssertEqual(fileIdentity(SavedMediaRef(name: "a.jpg", size: 12, lastModified: 1.5)), "a.jpg__12__1.5")
    }
}
