// Port of `src/shared/projects/export-variants.test.ts`, case for case, plus a
// small block pinning the reader and writer the document goes through.

import XCTest
@testable import AtelierKit

/// `{ ...createVariant(), ...over }`.
private func variant(_ change: (inout ExportVariant) -> Void = { _ in }) -> ExportVariant {
    var v = createVariant()
    change(&v)
    return v
}

final class ExportVariantsOutputSizeTests: XCTestCase {
    func testSourceAspectAndSourceResolutionIsTheSourceEvened() {
        // even() rounds to the nearest even value (3841 → 3842).
        XCTAssertEqual(variantOutputSize(variant(), 3841, 2161), Size(3842, 2162))
        XCTAssertEqual(variantOutputSize(variant(), 3840, 2160), Size(3840, 2160))
    }

    func testCapsTheShortSideToTheDeliveryResolutionKeepingTheRatio() {
        XCTAssertEqual(variantOutputSize(variant { $0.resolution = .shortSide(1080) }, 3840, 2160), Size(1920, 1080))
    }

    func testNeverUpscalesASmallSource() {
        XCTAssertEqual(variantOutputSize(variant { $0.resolution = .shortSide(1080) }, 1280, 720), Size(1280, 720))
    }

    func testReframesALandscapeSourceIntoAVerticalPresetAtSourceDensity() {
        // Short side stays 2160 (the crop width); height follows 16/9.
        XCTAssertEqual(variantOutputSize(variant { $0.aspectId = "9:16" }, 3840, 2160), Size(2160, 3840))
    }

    func testVerticalPresetAnd1080pIsThePlatformDeliverable() {
        let v = variant { $0.aspectId = "9:16"; $0.resolution = .shortSide(1080) }
        XCTAssertEqual(variantOutputSize(v, 3840, 2160), Size(1080, 1920))
    }

    func testSquarePresetFromALandscapeSource() {
        XCTAssertEqual(variantOutputSize(variant { $0.aspectId = "1:1" }, 1920, 1080), Size(1080, 1080))
    }
}

final class ExportVariantsNamingTests: XCTestCase {
    func testAPlainSourceExportKeepsAPlainName() {
        XCTAssertEqual(variantSuffix(variant()), "")
        XCTAssertEqual(variantFileName("DJI_0001", variant()), "DJI_0001.mp4")
    }

    func testSuffixesOnlyWhatDepartsFromTheSource() {
        let v = variant {
            $0.aspectId = "9:16"
            $0.resolution = .shortSide(1080)
            $0.frameRate = .fps(30)
            $0.overlays = false
        }
        XCTAssertEqual(variantFileName("vol", v), "vol-9x16-1080p-30fps-clean.mp4")
        XCTAssertEqual(variantFileName("vol", variant { $0.overlays = false }), "vol-clean.mp4")
        XCTAssertEqual(variantFileName("vol", variant { $0.frameRate = .fps(24) }), "vol-24fps.mp4")
    }

    func testNamesAReTimedVariantByItsSpeed() {
        XCTAssertEqual(variantFileName("vol", variant { $0.speed = 2 }), "vol-2x.mp4")
        XCTAssertEqual(variantFileName("vol", variant { $0.speed = 0.5 }), "vol-0.5x.mp4")
        // Normal speed is not a departure, so it adds nothing.
        XCTAssertEqual(variantFileName("vol", variant { $0.speed = 1 }), "vol.mp4")
        let v = variant { $0.resolution = .shortSide(1080); $0.speed = 4; $0.overlays = false }
        XCTAssertEqual(variantFileName("vol", v), "vol-1080p-4x-clean.mp4")
    }

    func testTrimsAPastedMp4AndFallsBackOnAnEmptyBase() {
        XCTAssertEqual(variantFileName(" clip.mp4 ", variant()), "clip.mp4")
        XCTAssertEqual(variantFileName("   ", variant()), "export.mp4")
    }
}

final class ExportVariantsStillTests: XCTestCase {
    func testDeliversAJPEGReframedAndCappedLikeAClip() {
        XCTAssertEqual(variantFileName("IMG_8801", variant(), .photo), "IMG_8801.jpg")
        let v = variant { $0.aspectId = "4:5"; $0.resolution = .shortSide(1080) }
        XCTAssertEqual(variantFileName("IMG_8801", v, .photo), "IMG_8801-4x5-1080p.jpg")
        XCTAssertEqual(variantFileName("IMG_8801", variant { $0.overlays = false }, .photo), "IMG_8801-clean.jpg")
    }

    func testNeverNamesAStillByACadenceOrASpeedItCannotHave() {
        let v = variant { $0.frameRate = .fps(30); $0.speed = 2; $0.resolution = .shortSide(720) }
        XCTAssertEqual(variantSuffix(v, .photo), "720p")
        XCTAssertEqual(variantFileName("IMG_8801", v, .photo), "IMG_8801-720p.jpg")
    }

    func testReplacesTheOtherMediumsExtensionRatherThanStackingOnIt() {
        XCTAssertEqual(variantFileName("shot.mp4", variant(), .photo), "shot.jpg")
        XCTAssertEqual(variantFileName("shot.jpg", variant(), .video), "shot.mp4")
    }
}

final class ExportVariantsDefaultsTests: XCTestCase {
    func testOneSourceFaithfulVariantWithOverlaysOn() {
        let all = defaultVariants()
        XCTAssertEqual(all.count, 1)
        let v = all[0]
        XCTAssertEqual(v.aspectId, "source")
        XCTAssertEqual(v.resolution, .source)
        XCTAssertEqual(v.frameRate, .source)
        XCTAssertTrue(v.overlays)
    }
}

final class ResolutionShortfallTests: XCTestCase {
    /// `{ id: 'v', aspectId: 'source', resolution: 'source', …, ...over }`.
    private func v(_ change: (inout ExportVariant) -> Void = { _ in }) -> ExportVariant {
        var out = ExportVariant(id: "v", aspectId: "source", resolution: .source, frameRate: .source, speed: 1, overlays: true)
        change(&out)
        return out
    }

    func testSaysNothingWhenTheVariantGetsTheSizeItAskedFor() {
        // A 1920x1080 capture cropped to 9:16 at 1080 delivers 1080x1920.
        XCTAssertNil(resolutionShortfall(v { $0.aspectId = "9:16"; $0.resolution = .shortSide(1080) }, 1920, 1080))
    }

    func testReportsTheGapWhenTheSourceCannotFillTheAskedForFrame() {
        // The case that matters: editing on a 720p proxy, asking for 1080.
        XCTAssertEqual(resolutionShortfall(v { $0.aspectId = "9:16"; $0.resolution = .shortSide(1080) }, 1280, 720),
                       ResolutionShortfall(asked: 1080, delivered: 720))
    }

    func testReportsItAtTheSourceFrameTooNotOnlyWhenReframing() {
        XCTAssertEqual(resolutionShortfall(v { $0.resolution = .shortSide(1080) }, 1280, 720),
                       ResolutionShortfall(asked: 1080, delivered: 720))
    }

    func testAskingForLessThanTheSourceHasIsNotAShortfall() {
        XCTAssertNil(resolutionShortfall(v { $0.resolution = .shortSide(720) }, 1920, 1080))
    }

    func testHasNothingToSayAboutASourceResolutionVariant() {
        XCTAssertNil(resolutionShortfall(v { $0.aspectId = "9:16" }, 1280, 720))
    }

    func testSaysNothingBeforeTheSourceHasProducedItsDimensions() {
        XCTAssertNil(resolutionShortfall(v { $0.resolution = .shortSide(1080) }, 0, 0))
    }
}

// No web spec: the reader and writer a stored variant goes through.
final class ExportVariantJSONTests: XCTestCase {
    func testWritesAVariantAsTheWebWritesItAndReadsItBackUnchanged() {
        let v = ExportVariant(id: "a", aspectId: "9:16", resolution: .shortSide(1080), frameRate: .fps(30), speed: 0.5,
                              overlays: false)
        let json: JSONValue = ["id": "a", "aspectId": "9:16", "resolution": 1080, "frameRate": 30, "speed": 0.5,
                               "overlays": false]
        XCTAssertEqual(v.json, json)
        XCTAssertEqual(readExportVariant(json), v)
        XCTAssertEqual(createVariant(id: "b").json,
                       ["id": "b", "aspectId": "source", "resolution": "source", "frameRate": "source", "speed": 1,
                        "overlays": true])
    }

    func testReadsWhatIsAbsentAsTheWebsCodeReadsUndefinedAndCarriesTheUnknown() {
        let read = readExportVariant(["id": "a", "future": ["x": 1]])
        XCTAssertEqual(read?.aspectId, "source")
        XCTAssertEqual(read?.resolution, .source)
        XCTAssertEqual(read?.frameRate, .source)
        XCTAssertEqual(read?.speed, 1)
        // `!variant.overlays` names an absent flag clean.
        XCTAssertEqual(read?.overlays, false)
        XCTAssertEqual(read?.json.objectValue?["future"], ["x": 1])
        XCTAssertNil(readExportVariant("junk"))
        XCTAssertEqual(readExportVariant(["aspectId": "1:1"], makeId: { "minted" })?.id, "minted")
    }

    func testNamesAMediumsExtension() {
        XCTAssertEqual(mediumExtension[.video], "mp4")
        XCTAssertEqual(mediumExtension[.photo], "jpg")
        XCTAssertFalse(variantIsRetimed(variant()))
        XCTAssertTrue(variantIsRetimed(variant { $0.speed = 2 }))
        // Out of range keeps the clip's own speed, so it is no re-time.
        XCTAssertFalse(variantIsRetimed(variant { $0.speed = 40 }))
    }
}
