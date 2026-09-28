// Port of `src/shared/render/presence.test.ts`. Its last case reads the
// GLSL pass list (`detailPasses` of `detail-pass.ts`); here it reads the pure
// plan the kernel keeps of it (`detailPassPlan`), the same ids in the same order.

import XCTest
@testable import AtelierKit

private func image(_ width: Int, _ height: Int, _ at: (Int, Int) -> RGB) -> DetailImage {
    DetailImage(width: width, height: height, fill: at)
}

private func px(_ img: DetailImage, _ x: Int, _ y: Int) -> RGB {
    pixelAt(img, x, y)
}

final class RenderPresenceBlurTests: XCTestCase {
    func testScalesWithTheShortSideAndNeverWalksPastItsBound() {
        assertClose(blurGeometry(0.01, 4000, 3000).sigma, 30, 2)
        assertClose(blurGeometry(0.01, 400, 300).sigma, 3, 2)
        let wide = blurGeometry(0.03, 8000, 6000)
        XCTAssertLessThanOrEqual(wide.taps, presenceTaps)
        XCTAssertGreaterThan(wide.step, 1)
        XCTAssertEqual(blurGeometry(0.001, 100, 100).sigma, 0.8)
    }

    func testReadsBetweenPixelsAsLinearFilteringDoesClampedAtTheEdges() {
        let img = image(2, 1) { x, _ in x != 0 ? (1, 1, 1) : (0, 0, 0) }
        assertClose(sampleBilinear(img, 0.25, 0).0, 0.25, 2)
        XCTAssertEqual(sampleBilinear(img, -5, 0).0, 0)
        XCTAssertEqual(sampleBilinear(img, 9, 0).0, 1)
    }

    func testLeavesAFlatPictureFlat() {
        let flat = image(40, 30) { _, _ in (0.4, 0.5, 0.6) }
        let luma = presenceBlur(flat, 0.05, .luma)
        let dark = presenceBlur(flat, 0.05, .dark)
        for i in stride(from: 0, to: luma.count, by: 97) {
            assertClose(Double(luma[i]), lumaOf(0.4, 0.5, 0.6), 6)
            assertClose(Double(dark[i]), toLinear(0.4, .srgb), 6)
        }
    }
}

final class RenderPresenceDehazeTests: XCTestCase {
    func testTakesAVeilOutDarkerMoreContrastAndPutsOneInBelowZero() {
        let hazy: RGB = (0.6, 0.65, 0.7)
        // The veil is the darkest channel in LIGHT, as the blur reads it.
        let veil = toLinear(0.6, .srgb)
        let clear = dehazeAt(hazy.0, hazy.1, hazy.2, veil: veil, amount: 1)
        XCTAssertLessThan(clear.0, hazy.0)
        XCTAssertGreaterThan(clear.2 - clear.0, hazy.2 - hazy.0)
        let veiled = dehazeAt(hazy.0, hazy.1, hazy.2, veil: veil, amount: -1)
        XCTAssertGreaterThan(veiled.0, hazy.0)
        XCTAssertLessThan(veiled.2 - veiled.0, hazy.2 - hazy.0)
    }

    func testNeverDividesAWhiteSkyIntoBlackTheTransmissionHasAFloor() {
        let r = dehazeAt(0.95, 0.95, 0.95, veil: toLinear(0.95, .srgb), amount: 1).0
        XCTAssertGreaterThan(r, 0.7)
    }

    func testReadsTheVeilOfADarkFieldInLightWhereItIsSmall() {
        // 80 keeps ~59 at +80, where the encoded reading gave 43.
        let field: RGB = (80.0 / 255, 95.0 / 255, 70.0 / 255)
        let r = dehazeAt(field.0, field.1, field.2, veil: toLinear(70.0 / 255, .srgb), amount: 0.8).0
        XCTAssertGreaterThan(r * 255, 55)
        XCTAssertLessThan(r * 255, 80)
    }
}

final class RenderPresenceClarityAndTextureTests: XCTestCase {
    func testPushAPixelAwayFromItsSurroundingsKeepAGreyGreyAndPullItBackBelowZero() {
        let up = localContrastAt(0.55, 0.55, 0.55, blurred: 0.45, amount: 1, midtones: true)
        XCTAssertGreaterThan(up.0, 0.55)
        assertClose(up.0, up.1, 12)
        let down = localContrastAt(0.55, 0.55, 0.55, blurred: 0.45, amount: -1, midtones: false)
        XCTAssertLessThan(down.0, 0.55)
        XCTAssertGreaterThan(down.0, 0.45)
    }

    func testSpareTheEndsOnClarityTheMidtoneBellButNotOnTexture() {
        assertClose(localContrastAt(0.02, 0.02, 0.02, blurred: 0, amount: 1, midtones: true).0, 0.02, 2)
        XCTAssertGreaterThan(localContrastAt(0.02, 0.02, 0.02, blurred: 0, amount: 1, midtones: false).0, 0.025)
    }

    func testKeepTheHueRGBRidesOneRatio() {
        let (r, g, b) = localContrastAt(0.6, 0.4, 0.2, blurred: 0.3, amount: 1, midtones: true)
        assertClose(r / b, 3, 10)
        assertClose(g / b, 2, 10)
    }

    func testSteepenAStepEdgeInTheMidtonesAndSoftenItBelowZero() {
        let step = image(80, 60) { x, _ in x < 40 ? (0.4, 0.4, 0.4) : (0.6, 0.6, 0.6) }
        let crisp = applyPresence(step, PresenceAmounts(dehaze: 0, clarity: 1, texture: 0))
        let soft = applyPresence(step, PresenceAmounts(dehaze: 0, clarity: 0, texture: -1))
        XCTAssertLessThan(px(crisp, 38, 30).0, 0.4)
        XCTAssertGreaterThan(px(crisp, 41, 30).0, 0.6)
        XCTAssertGreaterThan(px(soft, 39, 30).0, 0.4)
        XCTAssertLessThan(px(soft, 40, 30).0, 0.6)
    }
}

final class RenderPresenceRecordAndPassesTests: XCTestCase {
    func testArePartOfTheDetailRecordDefaultSameNormaliseWords() {
        let d = normaliseDetail(["clarity": 250, "dehaze": -30, "texture": "x"])
        XCTAssertEqual(d.clarity, 100)
        XCTAssertEqual(d.dehaze, -30)
        XCTAssertEqual(d.texture, 0)
        XCTAssertFalse(isDefaultDetail(d))
        XCTAssertNil(detailOrNull(["texture": 0]))
        XCTAssertTrue(sameDetail(d, d))
        XCTAssertFalse(sameDetail(d, DetailSettings.default))
        XCTAssertEqual(describeDetail(d), "dehaze −30 · clarity +100")
    }

    func testGoAfterEveryWarpAndBeforeTheSharpenTwoPassesASlider() {
        let plan = detailPassPlan(DetailSettings(sharpen: 50, clarity: 40, dehaze: 20))
        XCTAssertEqual(plan.pre, [])
        XCTAssertEqual(plan.post.map { $0.rawValue }, ["presence-blur", "presence-apply", "presence-blur", "presence-apply", "sharpen"])
    }
}
