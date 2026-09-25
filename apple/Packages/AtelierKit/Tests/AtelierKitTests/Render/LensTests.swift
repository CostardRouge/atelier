// Port of `src/shared/render/lens.test.ts`.

import XCTest
@testable import AtelierKit

private func lens(_ change: (inout LensCorrection) -> Void) -> LensCorrection {
    var l = LensCorrection.default
    change(&l)
    return l
}

final class LensSampleRadiusTests: XCTestCase {
    func testHoldsTheCentreStillWhateverTheCoefficients() {
        // The property that makes a correction pivot on the middle of the
        // picture rather than sliding it: r = 0 is a fixed point by construction.
        for (k1, k2) in [(0.25, 0.12), (-0.25, -0.12), (0.1, -0.05)] {
            XCTAssertEqual(lensSampleRadius(0, k1, k2), 0)
        }
    }

    func testIsTheIdentityWhenNothingIsSet() {
        var r = 0.0
        while r <= 1.0001 {
            assertClose(lensSampleRadius(r, 0, 0), r, 12)
            r += 0.05
        }
    }

    func testSamplesFurtherOutToUndoPincushionAndCloserInToUndoBarrel() {
        let pin = distortionTerms(lens { $0.distortion = 100 }).k1
        let bar = distortionTerms(lens { $0.distortion = -100 }).k1
        XCTAssertGreaterThan(lensSampleRadius(1, pin, 0), 1)
        XCTAssertLessThan(lensSampleRadius(1, bar, 0), 1)
    }

    func testStaysMonotoneAcrossTheFrameAtTheStrongestSettings() {
        // A radius map that turned back on itself would fold the picture over —
        // the same failure the tone curve's tangent clamp exists to prevent.
        for d in [-100.0, -50, 50, 100] {
            for d2 in [-100.0, 0, 100] {
                let terms = distortionTerms(lens { $0.distortion = d; $0.distortion2 = d2 })
                var previous = -1.0
                var r = 0.0
                while r <= 1.0001 {
                    let out = lensSampleRadius(r, terms.k1, terms.k2)
                    XCTAssertGreaterThanOrEqual(out, previous - 1e-12)
                    previous = out
                    r += 0.01
                }
            }
        }
    }

    func testMovesACornerByASaneAmountNotOffThePlanet() {
        let terms = distortionTerms(lens { $0.distortion = 100; $0.distortion2 = 100 })
        let corner = lensSampleRadius(1, terms.k1, terms.k2)
        XCTAssertGreaterThan(corner, 1)
        XCTAssertLessThan(corner, 1.5)
    }
}

final class ChromaScalesTests: XCTestCase {
    func testLeavesGreenAloneAndMovesRedAndBlueAgainstIt() {
        // Green is the reference: a fringe is red and blue landing at the
        // wrong size, so those are what get resized.
        let s = chromaScales(lens { $0.chromaRed = 100; $0.chromaBlue = -100 })
        XCTAssertGreaterThan(s.red, 1)
        XCTAssertLessThan(s.blue, 1)
        // Small: lateral CA is a fraction of a percent of the frame, not a percent.
        XCTAssertLessThan(s.red, 1.02)
    }

    func testIsExactly1ForBothWhenUnset() {
        let s = chromaScales(.default)
        XCTAssertEqual(s.red, 1)
        XCTAssertEqual(s.blue, 1)
    }
}

final class VignetteGainTests: XCTestCase {
    func testNeverTouchesTheCentre() {
        for amount in [-100.0, -30, 30, 100] {
            XCTAssertEqual(vignetteGain(0, amount, 50), 1)
        }
    }

    func testLiftsTheCornersForAPositiveAmountAndSinksThemForANegativeOne() {
        XCTAssertGreaterThan(vignetteGain(1, 100, 50), 1)
        XCTAssertLessThan(vignetteGain(1, -100, 50), 1)
    }

    func testStartsBitingOnlyPastTheMidpointAndComesOnGently() {
        XCTAssertEqual(vignetteGain(0.4, 100, 50), 1)
        XCTAssertEqual(vignetteGain(0.5, 100, 50), 1)
        let justPast = vignetteGain(0.55, 100, 50)
        let further = vignetteGain(0.8, 100, 50)
        XCTAssertGreaterThan(justPast, 1)
        // Squared, so there is no visible ring where it begins.
        XCTAssertLessThan(justPast - 1, (further - 1) / 4)
    }

    func testIs1EverywhereWhenTheAmountIs0MidpointNotwithstanding() {
        for r in [0.0, 0.5, 1] {
            for mid in [0.0, 50, 100] {
                XCTAssertEqual(vignetteGain(r, 0, mid), 1)
            }
        }
    }

    func testHandlesAMidpointAtTheVeryEdgeWithoutDividingByZero() {
        XCTAssertTrue(vignetteGain(1, 100, 100).isFinite)
        XCTAssertEqual(vignetteGain(0.99, 100, 100), 1)
    }

    func testHandsTheShaderTheSameTwoNumbersItWorksFromItself() {
        // The one duplication that would let the GPU drift from the pure
        // module is the reach constant, so the kernel is given it rather than told it.
        for (amount, mid) in [(100.0, 50.0), (-40, 20), (30, 0)] {
            let terms = vignetteTerms(lens { $0.vignette = amount; $0.vignetteMidpoint = mid })
            for r in [0.2, 0.5, 0.8, 1] {
                let t = r <= terms.start ? 0 : (r - terms.start) / (1 - terms.start)
                assertClose(1 + terms.amount * t * t, vignetteGain(r, amount, mid), 12)
            }
        }
    }
}

final class VignetteEncodedTests: XCTestCase {
    func testLeavesTheCentreAndEverythingAloneWhenThereIsNothingToDo() {
        XCTAssertEqual(vignetteEncoded(0.3, 0, 100, 50), 0.3)
        XCTAssertEqual(vignetteEncoded(0.3, 1, 0, 50), 0.3)
        XCTAssertEqual(vignetteEncoded(0.3, 0.4, 100, 50), 0.3)
    }

    func testIsTheGainAppliedToLightDoublingTheLightIsNotDoublingTheCode() {
        // A gain of 2 at the corner: 0.5 encoded is 0.214 linear, ×2 is 0.428
        // linear, which encodes to 0.69 — not 1.0.
        let encoded = 0.5
        let gain = vignetteGain(1, 100, 50)
        assertClose(gain, 1.8, 12)
        let got = vignetteEncoded(encoded, 1, 100, 50)
        assertClose(got, fromLinear(toLinear(encoded, .srgb) * gain, .srgb), 12)
        XCTAssertLessThan(got, encoded * gain)
    }

    func testLiftsADarkCornerAndABrightOneByTheSameRatioOfLight() {
        func ratio(_ v: Double) -> Double {
            toLinear(vignetteEncoded(v, 1, 60, 20), .srgb) / toLinear(v, .srgb)
        }
        assertClose(ratio(0.2), ratio(0.6), 6)
        assertClose(ratio(0.2), vignetteGain(1, 60, 20), 6)
    }

    func testSinksACornerForANegativeAmountNeverBelowBlack() {
        XCTAssertLessThan(vignetteEncoded(0.4, 1, -100, 50), 0.4)
        XCTAssertGreaterThanOrEqual(vignetteEncoded(0.4, 1, -100, 50), 0)
    }
}

final class LensRecordTests: XCTestCase {
    func testReadsJunkAsNeutralAndClampsToTheSliders() {
        XCTAssertEqual(normaliseLens(nil), .default)
        XCTAssertEqual(normaliseLens(["distortion": "x"]), .default)
        XCTAssertEqual(normaliseLens(["distortion": -900]).distortion, -100)
        XCTAssertEqual(normaliseLens(["vignetteMidpoint": 900]).vignetteMidpoint, 100)
    }

    func testStoresNothingForACorrectionThatDoesNothingAMidpointAloneIsNotOne() {
        XCTAssertNil(lensOrNull(nil))
        XCTAssertNil(lensOrNull([:]))
        // The midpoint only says WHERE a vignette correction bites; with no
        // amount it corrects nothing, so it must not make the picture look corrected.
        XCTAssertNil(lensOrNull(["vignetteMidpoint": 20]))
        XCTAssertEqual(lensOrNull(["vignette": 20])?.vignette, 20)
        XCTAssertTrue(isDefaultLens(lens { $0.vignetteMidpoint = 10 }))
    }

    func testComparesByValue() {
        XCTAssertTrue(sameLens(nil, .default))
        XCTAssertTrue(sameLens(lens { $0.distortion = -5 }, lens { $0.distortion = -5 }))
        XCTAssertFalse(sameLens(lens { $0.distortion = -5 }, nil))
    }

    func testNamesBarrelAndPincushionByTheirOwnWords() {
        XCTAssertEqual(describeLens(nil), "")
        XCTAssertEqual(describeLens(lens { $0.distortion = -40 }), "barrel −40")
        XCTAssertEqual(describeLens(lens { $0.distortion = 40 }), "pincushion +40")
        XCTAssertEqual(describeLens(lens { $0.chromaRed = 12; $0.vignette = 30 }), "CA red +12 · vignette +30")
    }
}
