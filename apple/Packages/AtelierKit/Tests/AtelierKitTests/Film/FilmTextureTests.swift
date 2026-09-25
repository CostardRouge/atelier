// Port of `src/shared/film/film-texture.test.ts`.

import XCTest
@testable import AtelierKit

private func texture(_ change: (inout FilmTexture) -> Void = { _ in }) -> FilmTexture {
    var t = defaultFilmTexture
    t.grain = 0.3
    t.halation = 0.25
    change(&t)
    return t
}

final class FilmTextureRecordTests: XCTestCase {
    func testIsSilentWhenNeitherGrainNorHalationIsAskedFor() {
        XCTAssertTrue(isSilentTexture(nil))
        XCTAssertTrue(isSilentTexture(defaultFilmTexture))
        XCTAssertFalse(isSilentTexture(texture { $0.halation = 0 }))
        XCTAssertFalse(isSilentTexture(texture { $0.grain = 0 }))
    }

    func testReadsDefensivelyClampsEveryNumberKeepsASoundTintRoundsTheSeed() {
        let t = normaliseFilmTexture([
            "grain": 4,
            "grainSize": -1,
            "grainChroma": "lots",
            "grainFps": 1e9,
            "halation": .number(.nan),
            "halationRadius": 0.5,
            "halationTint": [2, 0.5, "x"],
            "seed": 12.7,
        ])
        XCTAssertEqual(t.grain, 1)
        XCTAssertEqual(t.grainSize, textureRanges[.grainSize]!.min)
        XCTAssertEqual(t.grainChroma, defaultFilmTexture.grainChroma)
        XCTAssertEqual(t.grainFps, textureRanges[.grainFps]!.max)
        XCTAssertEqual(t.halation, 0)
        XCTAssertEqual(t.halationRadius, textureRanges[.halationRadius]!.max)
        XCTAssertTrue(t.halationTint == (1, 0.5, defaultFilmTexture.halationTint.2))
        XCTAssertEqual(t.seed, 13)
        XCTAssertEqual(normaliseFilmTexture(nil), defaultFilmTexture)
        XCTAssertEqual(normaliseFilmTexture(texture().json), texture())
    }

    func testKeysChangeWithEveryFieldAndAnswerForNone() {
        let base = texture()
        let key = filmTextureKey(base)
        for k in FilmTextureKey.allCases {
            var changed = base
            changed[k] = base[k] + textureRanges[k]!.step
            XCTAssertNotEqual(filmTextureKey(changed), key, k.rawValue)
        }
        var reseeded = base
        reseeded.seed = base.seed + 1
        XCTAssertNotEqual(filmTextureKey(reseeded), key)
        var retinted = base
        retinted.halationTint = (0, 0, 0)
        XCTAssertNotEqual(filmTextureKey(retinted), key)
        XCTAssertEqual(filmTextureKey(nil), "-")
    }

    func testDescribesWhatItDraws() {
        XCTAssertEqual(describeFilmTexture(nil), "No texture")
        XCTAssertEqual(describeFilmTexture(texture()), "grain 30 % · halation 25 %")
        XCTAssertEqual(describeFilmTexture(texture { $0.halation = 0 }), "grain 30 %")
    }

    /// The reader every document goes through: an object is read and clamped,
    /// anything else — and an absent texture — is no texture at all.
    func testFilmTextureOrNullReadsAnObjectAndNothingElse() {
        XCTAssertNil(filmTextureOrNull(nil))
        XCTAssertNil(filmTextureOrNull(.null))
        XCTAssertNil(filmTextureOrNull("grain"))
        XCTAssertNil(filmTextureOrNull([1, 2]))
        XCTAssertEqual(filmTextureOrNull([:]), defaultFilmTexture)
        XCTAssertEqual(filmTextureOrNull(texture().json), texture())
        XCTAssertEqual(filmTextureOrNull(["grain": 7])?.grain, 1)
    }

    /// The key spells its numbers as JavaScript does — `24`, not `24.0` — so
    /// the same texture keys the same on both clients.
    func testTheKeyIsTheWebsString() {
        XCTAssertEqual(filmTextureKey(defaultFilmTexture), "0|0.0015|0.2|24|0|0.04|0.8|1,0.45,0.2|1")
    }
}

final class FilmGrainScaleTests: XCTestCase {
    func testACellScalesWithTheRenderHeightExactly() {
        let t = texture { $0.grainSize = 0.002 }
        XCTAssertEqual(grainCellPixels(t, 1000) / grainCellPixels(t, 250), 4)
        assertClose(grainCellPixels(t, 2494), 4.988, 6)
    }

    func testTheNoiseUVPutsOneOverGrainSizeCellsDownTheFrameWhateverTheRenderSize() {
        let t = texture { $0.grainSize = 0.002 }
        for (w, h) in [(640.0, 480.0), (3326, 2494), (8064, 6048)] {
            let u = grainUniforms(t, w, h)
            // Texels down the height = scale · noiseSize = 1 / grainSize cells.
            assertClose(u.scale * Double(noiseSize), 1 / 0.002, 9)
            XCTAssertTrue(u.aspect == (w / h, 1))
            XCTAssertEqual(u.amount, 0.3)
        }
    }

    func testFadesOutWhereACellCannotBeResolvedAndSaysSo() {
        let fine = texture { $0.grainSize = 0.0005 }
        XCTAssertEqual(grainUniforms(fine, 1000, 500).fade, 0) // 0.25 px per cell
        XCTAssertEqual(grainUniforms(fine, 16000, 8000).fade, 1) // 4 px per cell
        let mid = grainUniforms(fine, 8000, (minCellPx + fadeCellPx) / 2 / 0.0005).fade
        XCTAssertGreaterThan(mid, 0)
        XCTAssertLessThan(mid, 1)
        let small = grainShowable(fine, 500)
        XCTAssertFalse(small.showable)
        XCTAssertEqual(small.cellPixels, 0.25)
        XCTAssertTrue(grainShowable(fine, 8000).showable)
    }
}

final class FilmHalationBufferTests: XCTestCase {
    func testTheBufferHeightDependsOnTheRadiusAloneAndSigmaOverHeightIsTheRadius() {
        for radius in [0.005, 0.01, 0.02, 0.05, 0.1, 0.2] {
            let t = texture { $0.halationRadius = radius }
            let small = halationBuffer(t, 640, 480)!
            let large = halationBuffer(t, 8064, 6048)!
            XCTAssertEqual(small.h, large.h)
            XCTAssertEqual(small.sigma, large.sigma)
            assertClose(small.sigma / Double(small.h), radius, 12)
            // Only the aspect reaches the width.
            XCTAssertEqual(halationBuffer(t, 1000, 500)!.w, halationBuffer(t, 1000, 500)!.h * 2)
        }
    }

    func testClampsTheBufferToItsBoundsAtTheEndsOfTheRadiusRange() {
        XCTAssertEqual(halationBuffer(texture { $0.halationRadius = 0.005 }, 100, 100)!.h, 512)
        XCTAssertEqual(halationBuffer(texture { $0.halationRadius = 0.2 }, 100, 100)!.h, 64)
        // Sigma stays a few texels wide — enough for a 13-tap kernel, never a single texel.
        XCTAssertGreaterThan(halationBuffer(texture { $0.halationRadius = 0.2 }, 100, 100)!.sigma, 2)
        XCTAssertLessThan(halationBuffer(texture { $0.halationRadius = 0.005 }, 100, 100)!.sigma, 6)
    }

    func testIsNothingWhenThereIsNoHalationToDraw() {
        XCTAssertNil(halationBuffer(texture { $0.halation = 0 }, 100, 100))
    }
}
