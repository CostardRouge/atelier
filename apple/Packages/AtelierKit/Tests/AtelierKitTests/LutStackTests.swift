// Port of `src/shared/lut/lut-stack.test.ts`. Where the web pins "the very
// same object" (`toBe`), a Swift struct pins the same VALUE.

import XCTest
@testable import AtelierKit

private func identity(_ size: Int = 5) -> CubeLut {
    CubeLut.make(size: size) { r, g, b in (r, g, b) }
}

/// Swaps red and blue — order-sensitive, so it catches composition mistakes.
private func swapRB(_ size: Int = 5) -> CubeLut {
    CubeLut.make(size: size) { r, g, b in (b, g, r) }
}

/// Halves every channel.
private func half(_ size: Int = 5) -> CubeLut {
    CubeLut.make(size: size) { r, g, b in (r / 2, g / 2, b / 2) }
}

private func layer(_ lut: CubeLut, intensity: Double = 1, enabled: Bool = true, name: String = "test", missing: String? = nil) -> LutLayer {
    LutLayer(id: UUID().uuidString, source: "builtin:test", name: name, lut: lut, intensity: intensity, enabled: enabled, missing: missing)
}

final class SampleLutTests: XCTestCase {
    func testReturnsTheInputThroughAnIdentityCube() {
        let out = sampleLut(identity(9), 0.25, 0.5, 0.75)
        assertClose(out.0, 0.25)
        assertClose(out.1, 0.5)
        assertClose(out.2, 0.75)
    }

    func testInterpolatesBetweenLatticePoints() {
        assertClose(sampleLut(half(3), 0.25, 0, 0).0, 0.125)
    }

    func testClampsOutOfRangeInputLikeTheGPUSampler() {
        let lut = identity(5)
        assertClose(sampleLut(lut, -1, 2, 0.5).0, 0)
        assertClose(sampleLut(lut, -1, 2, 0.5).1, 1)
    }

    func testHonoursANonDefaultInputDomain() {
        var lut = identity(5)
        lut.domainMax = (2, 2, 2)
        assertClose(sampleLut(lut, 1, 1, 1).0, 0.5)
    }
}

final class ComposeLutStackTests: XCTestCase {
    func testIsNilWhenTheStackIsEmptyOrFullyDisabled() {
        XCTAssertNil(composeLutStack([]))
        XCTAssertNil(composeLutStack([layer(half(), enabled: false)]))
        XCTAssertNil(composeLutStack([layer(half(), intensity: 0)]))
    }

    func testReturnsASingleFullStrengthLayerUntouched() {
        let only = half(17)
        XCTAssertEqual(composeLutStack([layer(only)]), only)
    }

    func testAppliesLayersInOrder() {
        let redOnly = CubeLut.make(size: 5) { r, _, b in (r, 0, b) }
        let a = composeLutStack([layer(redOnly), layer(swapRB(), intensity: 0.999)])!
        let b = composeLutStack([layer(swapRB()), layer(redOnly, intensity: 0.999)])!
        XCTAssertFalse(sampleLut(a, 1, 1, 0) == sampleLut(b, 1, 1, 0))
    }

    func testComposesTwoHalvingsIntoAQuarter() {
        let composed = composeLutStack([layer(half(9)), layer(half(9), intensity: 0.999)])!
        assertClose(sampleLut(composed, 0.8, 0.8, 0.8).0, 0.2, 2)
    }

    func testIntensityHalfLandsHalfwayBetweenInputAndTheLook() {
        let composed = composeLutStack([layer(half(9), intensity: 0.5), layer(identity(9), intensity: 0.5)])!
        assertClose(sampleLut(composed, 0.8, 0.8, 0.8).0, 0.6, 2)
    }

    func testSkipsDisabledLayersButKeepsTheEnabledOnesInOrder() {
        let composed = composeLutStack([layer(half(9), enabled: false), layer(half(9)), layer(identity(9), intensity: 0.5)])!
        assertClose(sampleLut(composed, 0.8, 0.8, 0.8).0, 0.4, 2)
    }

    func testAdoptsTheLargestInputLatticeCapped() {
        let composed = composeLutStack([layer(half(9)), layer(identity(33), intensity: 0.5)])!
        XCTAssertEqual(composed.size, 33)
    }

    func testNamesTheComposedCubeAfterTheChain() {
        let composed = composeLutStack([layer(half(5), name: "Kodak"), layer(identity(5), intensity: 0.5, name: "Bleach")])!
        XCTAssertEqual(composed.title, "Kodak → Bleach")
    }
}

final class ComposeOutputTransformTests: XCTestCase {
    func testChangesNothingWhenLeftAtNone() {
        let layers = [layer(half(9)), layer(swapRB(9), intensity: 0.5)]
        let implicit = composeLutStack(layers)!
        let explicit = composeLutStack(layers, output: OutputTransform.none)!
        XCTAssertEqual(explicit.data, implicit.data)
        XCTAssertEqual(explicit.size, implicit.size)
    }

    func testKeepsTheSingleLayerFastPathOnlyWhileItIsOff() {
        let only = half(9)
        XCTAssertEqual(composeLutStack([layer(only)]), only)
        XCTAssertNotEqual(composeLutStack([layer(only)], output: .rec709ToSrgb), only)
    }

    func testStillProducesACubeWhenTheStackIsEmpty() {
        XCTAssertNil(composeLutStack([], output: OutputTransform.none))
        let composed = composeLutStack([], output: .rec709ToSrgb)
        XCTAssertNotNil(composed)
        assertClose(sampleLut(composed!, 0.5, 0.5, 0.5).0, applyTransfer(0.5, .rec709ToSrgb), 3)
    }

    func testAppliesAfterTheLayersNotBefore() {
        let composed = composeLutStack([layer(half(33))], output: .rec709ToSrgb)!
        let after = applyTransfer(0.5, .rec709ToSrgb)
        let before = applyTransfer(1, .rec709ToSrgb) / 2
        assertClose(sampleLut(composed, 1, 1, 1).0, after, 3)
        XCTAssertNotEqual(after, before, accuracy: 0.5e-3)
    }

    func testImposesALatticeFloorButDoesNotForceTheMaximum() {
        XCTAssertEqual(composeLutStack([layer(half(9))])?.size, 9)
        XCTAssertEqual(composeLutStack([layer(half(9))], output: .rec709ToSrgb)?.size, 33)
        XCTAssertEqual(composeLutStack([], output: .rec709ToSrgb)?.size, 33)
        XCTAssertEqual(composeLutStack([layer(half(64))], output: .rec709ToSrgb)?.size, 64)
    }

    func testPinsBlackAndWhiteThroughTheWholeChain() {
        let composed = composeLutStack([layer(identity(9))], output: .rec709ToSrgb)!
        assertClose(sampleLut(composed, 0, 0, 0).0, 0, 6)
        assertClose(sampleLut(composed, 1, 1, 1).0, 1, 6)
    }

    func testNamesTheTransformAtTheEndOfTheChain() {
        let composed = composeLutStack([layer(half(5), name: "Kodak")], output: .rec709ToSrgb)!
        XCTAssertEqual(composed.title, "Kodak → Rec.709 2.4 → sRGB")
    }
}

final class ComposeDevelopTests: XCTestCase {
    private let asShot = DevelopSettings.default
    private let lifted = dev { $0.exposure = 1 }

    func testChangesNothingWhenTheDevelopIsDefaultOrAbsent() {
        let layers = [layer(half(9)), layer(swapRB(9), intensity: 0.5)]
        let implicit = composeLutStack(layers)!
        let explicit = composeLutStack(layers, output: OutputTransform.none, interpolation: .trilinear, develop: asShot)!
        XCTAssertEqual(explicit.data, implicit.data)
        XCTAssertNil(composeLutStack([], output: OutputTransform.none, interpolation: .trilinear, develop: asShot))
        XCTAssertNil(composeLutStack([], output: OutputTransform.none, interpolation: .trilinear, develop: nil))
    }

    func testBakesAToneCurveFaithfullyAtThe33Floor() {
        // MEASURED on the web (2026-09-17): a gentle S on luma lands within 2.63
        // codes at 33; the floor is not raised for it.
        let sShaped = dev {
            $0.curves = ToneCurves(luma: [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.3, y: 0.08), CurvePoint(x: 0.7, y: 0.92), CurvePoint(x: 1, y: 1)])
        }
        let cube = composeLutStack([], output: OutputTransform.none, interpolation: .tetrahedral, develop: sShaped)!
        XCTAssertEqual(cube.size, 33)
        let exact = developStage(sShaped)
        var worst = 0.0
        for i in 0...64 {
            let v = Double(i) / 64
            let want = exact(v, v, v)
            let got = sampleLut(cube, v, v, v)
            worst = max(worst, abs(want.0 - got.0) * 255, abs(want.1 - got.1) * 255, abs(want.2 - got.2) * 255)
        }
        XCTAssertLessThan(worst, 3)
    }

    func testBypassesTheSingleLayerFastPathAndBakesAnEmptyStack() {
        let only = half(9)
        XCTAssertEqual(composeLutStack([layer(only)], output: OutputTransform.none, interpolation: .trilinear, develop: asShot), only)
        XCTAssertNotEqual(composeLutStack([layer(only)], output: OutputTransform.none, interpolation: .trilinear, develop: lifted), only)
        let alone = composeLutStack([], output: OutputTransform.none, interpolation: .trilinear, develop: lifted)
        XCTAssertNotNil(alone)
        assertClose(sampleLut(alone!, 0.5, 0.5, 0.5).0, developStage(lifted)(0.5, 0.5, 0.5).0, 3)
    }

    func testAppliesBeforeTheLayersNeverAfter() {
        let composed = composeLutStack([layer(half(33))], output: OutputTransform.none, interpolation: .trilinear, develop: lifted)!
        let developedThenHalved = developStage(lifted)(0.5, 0.5, 0.5).0 / 2
        let halvedThenDeveloped = developStage(lifted)(0.25, 0.25, 0.25).0
        assertClose(sampleLut(composed, 0.5, 0.5, 0.5).0, developedThenHalved, 2)
        XCTAssertNotEqual(developedThenHalved, halvedThenDeveloped, accuracy: 0.5e-2)
    }

    func testSitsBeforeTheOutputTransformTooAndTakesTheSameLatticeFloor() {
        let composed = composeLutStack([], output: .rec709ToSrgb, interpolation: .trilinear, develop: lifted)!
        let expected = applyTransfer(developStage(lifted)(0.5, 0.5, 0.5).0, .rec709ToSrgb)
        assertClose(sampleLut(composed, 0.5, 0.5, 0.5).0, expected, 3)
        XCTAssertEqual(composeLutStack([layer(half(9))], output: OutputTransform.none, interpolation: .trilinear, develop: lifted)?.size, 33)
        XCTAssertEqual(composeLutStack([layer(half(64))], output: OutputTransform.none, interpolation: .trilinear, develop: lifted)?.size, 64)
    }

    func testKeepsBlackPinnedAndNamesItselfFirstInTheChain() {
        let composed = composeLutStack([layer(half(5), name: "Kodak")], output: .rec709ToSrgb, interpolation: .trilinear, develop: dev { $0.contrast = 40 })!
        assertClose(sampleLut(composed, 0, 0, 0).0, 0, 6)
        XCTAssertEqual(composed.title, "Develop → Kodak → Rec.709 2.4 → sRGB")
    }

    func testARAWDevelopTakesTheDensestLatticeAndAppliesTheMeteredGainFirst() {
        let raw = dev { $0.base = .gain; $0.rawGain = 2 }
        let cube = composeLutStack([], output: OutputTransform.none, interpolation: .tetrahedral, develop: raw)
        XCTAssertNotNil(cube)
        XCTAssertEqual(cube?.size, 64)
        let stage = developStage(raw)
        let i = 21
        let v = Double(i) / 63
        let o = (i + i * 64 + i * 64 * 64) * 3
        assertClose(Double(cube!.data[o]), stage(v, v, v).0, 6)
        XCTAssertEqual(composeLutStack([], output: OutputTransform.none, interpolation: .tetrahedral, develop: dev { $0.exposure = 0.5 })?.size, 33)
    }
}

final class LayerListTests: XCTestCase {
    func testActiveLayersKeepsOnlyEnabledLayersWithANonZeroStrength() {
        let on = layer(half())
        let off = layer(half(), enabled: false)
        let zero = layer(half(), intensity: 0)
        XCTAssertEqual(activeLayers([on, off, zero]).map(\.id), [on.id])
    }

    func testALookThisDeviceCannotResolveIsSkippedAlthoughSwitchedOn() {
        let missing = layer(half(), missing: "Not in this device's vault.")
        XCTAssertTrue(activeLayers([missing]).isEmpty)
        XCTAssertNil(composeLutStack([missing]))
        let real = layer(half())
        XCTAssertEqual(composeLutStack([real, layer(half(), missing: "gone")]), composeLutStack([real]))
    }

    func testTheIdentityCubeKeepsEveryReaderTotal() {
        let cube = CubeLut.identity()
        XCTAssertEqual(cube.size, 2)
        assertTriple(sampleLut(cube, 0.3, 0.6, 0.9), (0.3, 0.6, 0.9), 5)
    }

    func testReorderLayerSwapsWithTheNeighbourInTheRequestedDirection() {
        XCTAssertEqual(reorderLayer(["a", "b", "c"], 1, -1), ["b", "a", "c"])
        XCTAssertEqual(reorderLayer(["a", "b", "c"], 1, 1), ["a", "c", "b"])
    }

    func testReorderLayerIsANoOpAtTheEnds() {
        let src = ["a", "b", "c"]
        XCTAssertEqual(reorderLayer(src, 0, -1), src)
        XCTAssertEqual(reorderLayer(src, 2, 1), src)
        XCTAssertEqual(reorderLayer(src, 5, 1), src)
    }
}
