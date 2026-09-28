// Port of `src/shared/render/post-vignette.test.ts`.

import XCTest
@testable import AtelierKit

private func terms(_ change: (inout PostCropVignette) -> Void) -> PostVignetteTerms {
    var v = PostCropVignette.default
    change(&v)
    return postVignetteTerms(v)
}

final class PostVignetteShapeTests: XCTestCase {
    func testIsAnEllipseFittedToTheFrameAtRoundness0OneAtAnEdgeRoot2AtACorner() {
        XCTAssertEqual(shapeDistance(0.5, 0.5, 1.5, 0), 0)
        assertClose(shapeDistance(1, 0.5, 1.5, 0), 1, 2)
        assertClose(shapeDistance(0.5, 0, 1.5, 0), 1, 2)
        assertClose(shapeDistance(1, 1, 1.5, 0), 2.0.squareRoot(), 2)
    }

    func testTurnsToACircleAt100AndSquarerBelowZero() {
        XCTAssertEqual(shapeDistance(0.5, 0, 1.5, 1), 1 / 1.5, accuracy: 0.005)
        assertClose(shapeDistance(1, 0.5, 1.5, 1), 1, 2)
        XCTAssertLessThan(shapeDistance(1, 1, 1.5, -1), 1.1)
    }
}

final class PostVignettePixelTests: XCTestCase {
    func testLeavesTheCentreAloneAndDarkensACornerToBlackAtMinus100WithAHardFalloff() {
        let t = terms { $0.amount = -100; $0.midpoint = 0; $0.feather = 0 }
        assertExact(postVignetteAt(0.5, 0.5, 0.5, 0.5, 0.5, 1.5, t), (0.5, 0.5, 0.5))
        let (r, _, _) = postVignetteAt(0.5, 0.5, 0.5, 0, 0, 1.5, t)
        assertClose(r, 0, 6)
    }

    func testLightensTowardWhiteAboveZero() {
        let (r, _, _) = postVignetteAt(0.4, 0.4, 0.4, 0, 0, 1, terms { $0.amount = 60 })
        XCTAssertGreaterThan(r, 0.5)
    }

    func testSparesABrightCornerWithHighlightsAndNotAMidOne() {
        let plain = terms { $0.amount = -80 }
        let spared = terms { $0.amount = -80; $0.highlights = 100 }
        XCTAssertGreaterThan(postVignetteAt(0.95, 0.95, 0.95, 0, 0, 1, spared).0, postVignetteAt(0.95, 0.95, 0.95, 0, 0, 1, plain).0 + 0.1)
        assertClose(postVignetteAt(0.3, 0.3, 0.3, 0, 0, 1, spared).0, postVignetteAt(0.3, 0.3, 0.3, 0, 0, 1, plain).0, 6)
    }
}

final class PostVignetteFrameTests: XCTestCase {
    func testIsTheIdentityForAPictureNeverCropped() {
        let a = frameAffine(3000, 2000, 1.5, nil)
        for (n, want) in zip(a.values, FrameAffine.identity.values) { assertClose(n, want, 9) }
    }

    func testPutsACentredSquareCropOfA32PictureWhereItIsCut() {
        let a = frameAffine(3000, 2000, 1, Framing.default)
        let (uc, vc) = toFrame(a, 0.5, 0.5)
        assertClose(uc, 0.5, 2)
        assertClose(vc, 0.5, 2)
        // The square keeps the middle third... of 3000 px: 2000 px, from 500 to 2500.
        assertClose(toFrame(a, 500.0 / 3000, 0.5).0, 0, 2)
        assertClose(toFrame(a, 2500.0 / 3000, 0.5).0, 1, 2)
    }

    func testDependsOnTheAspectAloneSoTheExportCanBuildItWithoutThePixelSize() {
        let f = framing { $0.scale = 1.4; $0.x = 0.2; $0.y = -0.1; $0.rotation = 12 }
        let big = frameAffine(6000, 4000, 1.25, f)
        let unit = frameAffine(1.5, 1, 1.25, f)
        for (n, want) in zip(big.values, unit.values) { assertClose(n, want, 9) }
    }
}

final class PostVignetteRecordTests: XCTestCase {
    func testIsNoneAtAmount0AndReadsBackClamped() {
        XCTAssertNil(postVignetteOrNull(["midpoint": 20]))
        XCTAssertEqual(postVignetteOrNull(["amount": -300, "roundness": "x"]), PostCropVignette(amount: -100))
        XCTAssertTrue(isDefaultPostVignette(nil as PostCropVignette?))
        XCTAssertTrue(samePostVignette(PostCropVignette(amount: -20), PostCropVignette(amount: -20)))
        XCTAssertEqual(describePostVignette(PostCropVignette(amount: -40, roundness: 100)), "vignette −40, round +100")
    }
}
