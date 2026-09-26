// Port of `src/shared/render/mask.test.ts`.

import XCTest
@testable import AtelierKit

private func linear(_ change: (inout LinearMask) -> Void = { _ in }) -> Mask {
    var m = LinearMask.default
    change(&m)
    return .linear(m)
}

private func radial(_ change: (inout RadialMask) -> Void = { _ in }) -> Mask {
    var m = RadialMask.default
    change(&m)
    return .radial(m)
}

private func luma(_ change: (inout LumaMask) -> Void = { _ in }) -> Mask {
    var m = LumaMask.default
    change(&m)
    return .luma(m)
}

final class MaskNoMaskTests: XCTestCase {
    func testIsTheWholePictureNeverNoneOfIt() {
        // A layer starts global and gains a shape; reading nil as 0 would make
        // a new layer look broken instead of looking like an ordinary develop.
        XCTAssertEqual(maskAt(nil, 0.5, 0.5, 0.5), 1)
        XCTAssertEqual(maskAt(nil, 0, 1, 0), 1)
    }
}

final class SmoothStep01Tests: XCTestCase {
    func testIsFlatAtBothEndsSoAMaskHasNoVisibleEdgeWhereItStarts() {
        XCTAssertEqual(smoothStep01(-1), 0)
        XCTAssertEqual(smoothStep01(0), 0)
        XCTAssertEqual(smoothStep01(1), 1)
        XCTAssertEqual(smoothStep01(2), 1)
        assertClose(smoothStep01(0.5), 0.5, 12)
        // The derivative vanishes at both ends: sampling either side of 0 and
        // 1 gives a change far smaller than a linear ramp's would.
        XCTAssertLessThan(smoothStep01(0.02), 0.02 / 4)
        XCTAssertLessThan(1 - smoothStep01(0.98), 0.02 / 4)
    }

    func testIsMonotone() {
        var last = -1.0
        var s = -0.2
        while s <= 1.2 {
            let v = smoothStep01(s)
            XCTAssertGreaterThanOrEqual(v, last)
            last = v
            s += 0.01
        }
    }
}

final class MaskFramePointTests: XCTestCase {
    func testPutsTheCornerAtRadius1WhateverTheShape() {
        for ar in [1.0, 1.5, 16.0 / 9, 0.8] {
            let (x, y) = framePoint(1, 1, ar)
            assertClose(hypot(x, y), 1, 10)
        }
    }

    func testPutsTheMiddleAtTheOrigin() {
        let (x, y) = framePoint(0.5, 0.5, 1.5)
        XCTAssertEqual(x, 0)
        XCTAssertEqual(y, 0)
    }
}

final class LinearMaskTests: XCTestCase {
    func testCoversTheTopAtAngle0ADarkenedSkyWithNoAngleToSet() {
        let m = linear { $0.y = 0.5 }
        XCTAssertGreaterThan(maskAt(m, 0.5, 0.05, 0), 0.9)
        XCTAssertLessThan(maskAt(m, 0.5, 0.95, 0), 0.1)
    }

    func testReads05ExactlyOnTheLineSoAPanelCanDrawItWhereItBites() {
        let m = linear { $0.x = 0.5; $0.y = 0.5 }
        assertClose(maskAt(m, 0.5, 0.5, 0), 0.5, 10)
        // And anywhere along the line, not only at its midpoint.
        assertClose(maskAt(m, 0.1, 0.5, 0), 0.5, 10)
        assertClose(maskAt(m, 0.9, 0.5, 0), 0.5, 10)
    }

    func testTurnsLikeACompassBearing90CoversTheRight180TheBottom() {
        let east = linear { $0.x = 0.5; $0.y = 0.5; $0.angle = 90 }
        XCTAssertGreaterThan(maskAt(east, 0.95, 0.5, 0), 0.9)
        XCTAssertLessThan(maskAt(east, 0.05, 0.5, 0), 0.1)
        let south = linear { $0.x = 0.5; $0.y = 0.5; $0.angle = 180 }
        XCTAssertGreaterThan(maskAt(south, 0.5, 0.95, 0), 0.9)
        XCTAssertLessThan(maskAt(south, 0.5, 0.05, 0), 0.1)
    }

    func testIsAHardEdgeAtFeather0AndNeverDividesByIt() {
        let m = linear { $0.x = 0.5; $0.y = 0.5; $0.feather = 0 }
        XCTAssertEqual(maskAt(m, 0.5, 0.49, 0), 1)
        XCTAssertEqual(maskAt(m, 0.5, 0.51, 0), 0)
    }

    func testFallsMonotonicallyAcrossTheFrame() {
        let m = linear { $0.y = 0.5 }
        var last = 2.0
        var v = 0.0
        while v <= 1.0001 {
            let value = maskAt(m, 0.5, v, 0)
            XCTAssertLessThanOrEqual(value, last + 1e-12)
            last = value
            v += 0.02
        }
    }
}

final class RadialMaskTests: XCTestCase {
    func testIsFullInsideTheEllipseWhatAPanelDrawsIsWhatIsAffected() {
        let m = radial { $0.radiusX = 0.4; $0.radiusY = 0.4 }
        XCTAssertEqual(maskAt(m, 0.5, 0.5, 0), 1)
    }

    func testIsEmptyByFeatherPastIt() {
        let m = radial { $0.radiusX = 0.2; $0.radiusY = 0.2; $0.feather = 0.1 }
        // Straight out along x in the shared space: the corner is at radius 1.
        XCTAssertEqual(maskAt(m, 1, 0.5, 0), 0)
    }

    func testTurnsWithTheAngleAndAnEllipseIsNotACircle() {
        let wide = radial { $0.radiusX = 0.6; $0.radiusY = 0.15; $0.angle = 0 }
        let turned = radial { $0.radiusX = 0.6; $0.radiusY = 0.15; $0.angle = 90 }
        // A point out along x is inside the wide one and outside the turned one.
        XCTAssertGreaterThan(maskAt(wide, 0.85, 0.5, 0, 1), maskAt(turned, 0.85, 0.5, 0, 1))
        // And the reverse along y.
        XCTAssertGreaterThan(maskAt(turned, 0.5, 0.85, 0, 1), maskAt(wide, 0.5, 0.85, 0, 1))
    }

    func testIsAHardEllipseAtFeather0() {
        let m = radial { $0.radiusX = 0.5; $0.radiusY = 0.5; $0.feather = 0 }
        XCTAssertEqual(maskAt(m, 0.5, 0.5, 0), 1)
        XCTAssertEqual(maskAt(m, 1, 1, 0), 0)
    }

    func testFallsOffMonotonicallyOutward() {
        let m = radial { $0.radiusX = 0.2; $0.radiusY = 0.2; $0.feather = 0.5 }
        var last = 2.0
        var u = 0.5
        while u <= 1.0001 {
            let value = maskAt(m, u, 0.5, 0, 1)
            XCTAssertLessThanOrEqual(value, last + 1e-12)
            last = value
            u += 0.02
        }
    }
}

final class LumaMaskTests: XCTestCase {
    func testReadsBrightnessNotPosition() {
        let m = luma { $0.from = 0; $0.to = 0.3; $0.feather = 0 }
        // Same point, different pixels.
        XCTAssertEqual(maskAt(m, 0.5, 0.5, 0.1), 1)
        XCTAssertEqual(maskAt(m, 0.5, 0.5, 0.9), 0)
        // Same pixel, different points.
        XCTAssertEqual(maskAt(m, 0.01, 0.99, 0.1), 1)
    }

    func testFadesOutPastEachEndOfTheBand() {
        let m = luma { $0.from = 0.4; $0.to = 0.6; $0.feather = 0.2 }
        XCTAssertEqual(maskAt(m, 0, 0, 0.5), 1)
        XCTAssertEqual(maskAt(m, 0, 0, 0.2), 0)
        XCTAssertEqual(maskAt(m, 0, 0, 0.8), 0)
        XCTAssertGreaterThan(maskAt(m, 0, 0, 0.3), 0)
        XCTAssertLessThan(maskAt(m, 0, 0, 0.3), 1)
    }

    func testIsSymmetricAboutASymmetricBand() {
        let m = luma { $0.from = 0.4; $0.to = 0.6; $0.feather = 0.2 }
        assertClose(maskAt(m, 0, 0, 0.3), maskAt(m, 0, 0, 0.7), 12)
    }
}

final class SubjectMaskTests: XCTestCase {
    func testStoresTheRequestNotThePixels() {
        guard case .subject(let m)? = normaliseMask(["kind": "subject", "points": [[0.4, 0.6]]]) else { return XCTFail("not a subject") }
        XCTAssertEqual(m.points, [Point(0.4, 0.6)])
        // The model is stamped on, so a raster cached by an older build is
        // refused rather than shown as though it were current.
        XCTAssertEqual(m.model, subjectModel)
        // `'data' in m` is false on the web; a `SubjectMask` has no such field
        // to hold, by type.
    }

    func testCannotBeAnsweredWithoutTheModelAndSays0RatherThanGuessing() {
        // 0 and not 1, for the same reason an empty brush covers nothing: the
        // renderer never asks — it samples the cached raster.
        XCTAssertEqual(maskAt(.subject(SubjectMask(points: [Point(0.5, 0.5)], model: "x")), 0.5, 0.5, 0.5), 0)
    }

    func testDropsAJunkPointAndClampsTheRestIntoTheFrame() {
        let raw: JSONValue = ["kind": "subject", "points": [[0.5, 0.5], "nope", [2, -3], [.number(.nan), 0.5]]]
        guard case .subject(let m)? = normaliseMask(raw) else { return XCTFail("not a subject") }
        XCTAssertEqual(m.points, [Point(0.5, 0.5), Point(1, 0)])
    }

    func testComparesByItsPointsAndItsModel() {
        let a = SubjectMask(points: [Point(0.5, 0.5)], model: "a")
        XCTAssertTrue(sameMask(.subject(a), .subject(SubjectMask(points: [Point(0.5, 0.5)], model: "a"))))
        XCTAssertFalse(sameMask(.subject(a), .subject(SubjectMask(points: a.points, model: "b"))))
        XCTAssertFalse(sameMask(.subject(a), .subject(SubjectMask(points: [Point(0.5, 0.6)], model: "a"))))
    }

    func testClonesDeeplyEnoughToBeHeldAgainstALiveDraft() {
        var live = normaliseMask(["kind": "subject", "points": [[0.5, 0.5]]])
        let held = cloneMask(live)!
        if case .subject(var s)? = live {
            s.points.append(Point(0.2, 0.2))
            live = .subject(s)
        }
        XCTAssertFalse(sameMask(held, live))
    }

    func testSaysHowManyPointsOrAsksForOne() {
        XCTAssertEqual(describeMask(.subject(SubjectMask(points: [], model: "x"))), "subject · tap it")
        XCTAssertEqual(describeMask(.subject(SubjectMask(points: [Point(0.5, 0.5)], model: "x"))), "subject · 1 point")
    }
}

final class MaskRecordTests: XCTestCase {
    func testReadsJunkAsNoMaskAtAll() {
        XCTAssertNil(normaliseMask(nil))
        XCTAssertNil(normaliseMask(42))
        XCTAssertNil(normaliseMask([:]))
        XCTAssertNil(normaliseMask(["kind": "lasso"]))
    }

    func testKeepsAnEmptyPaintedMaskBecausePickingTheBrushIsAChoice() {
        // Unlike an unknown kind: the author chose to paint and has not
        // painted yet, which is a state the panel must be able to show.
        XCTAssertEqual(normaliseMask(["kind": "brush"]), .brush(BrushMask(strokes: [])))
        // A stroke with no point draws nothing and would survive every round
        // trip, so it is dropped.
        XCTAssertEqual(normaliseMask(["kind": "brush", "strokes": [["points": []], 7]]), .brush(BrushMask(strokes: [])))
        guard case .brush(let one)? = normaliseMask(["kind": "brush", "strokes": [["points": [[0.1, 0.2]], "radius": 9]]]) else {
            return XCTFail("not a brush")
        }
        XCTAssertEqual(one.strokes[0].radius, 2)
        XCTAssertEqual(one.strokes[0].erase, false)
    }

    func testComparesAndClonesAPaintedMaskByItsStrokesNeverByReference() {
        let raw: JSONValue = ["kind": "brush", "strokes": [["points": [[0.1, 0.2], [0.3, 0.4]]]]]
        var a = normaliseMask(raw)
        let b = normaliseMask(raw)
        XCTAssertTrue(sameMask(a, b))
        let held = cloneMask(a)!
        // A spread would alias the very array a live drag is about to push onto.
        if case .brush(var m)? = a {
            m.strokes[0].points.append(Point(0.9, 0.9))
            a = .brush(m)
        }
        XCTAssertFalse(sameMask(held, a))
    }

    func testClampsWhatItKeeps() {
        guard case .radial(let r)? = normaliseMask(["kind": "radial", "radiusX": -5]) else { return XCTFail("not radial") }
        XCTAssertEqual(r.radiusX, 0.01)
        guard case .linear(let l)? = normaliseMask(["kind": "linear", "angle": 900]) else { return XCTFail("not linear") }
        XCTAssertEqual(l.angle, 180)
        guard case .luma(let m)? = normaliseMask(["kind": "luma", "from": -2, "to": 9]) else { return XCTFail("not luma") }
        XCTAssertEqual(m.from, 0)
        XCTAssertEqual(m.to, 1)
    }

    func testPutsALumaBandTheRightWayRoundRatherThanRefusingIt() {
        // A slider dragged past its partner is an ordinary gesture, not a
        // broken document — the band is swapped, never emptied.
        guard case .luma(let m)? = normaliseMask(["kind": "luma", "from": 0.8, "to": 0.2]) else { return XCTFail("not luma") }
        XCTAssertEqual(m.from, 0.2)
        XCTAssertEqual(m.to, 0.8)
    }

    func testComparesAndClonesByValue() {
        XCTAssertTrue(sameMask(nil, nil))
        XCTAssertFalse(sameMask(linear(), nil))
        XCTAssertFalse(sameMask(linear(), radial()))
        XCTAssertTrue(sameMask(linear { $0.angle = 10 }, linear { $0.angle = 10 }))
        XCTAssertFalse(sameMask(linear { $0.angle = 10 }, linear { $0.angle = 11 }))
        let held = cloneMask(radial { $0.radiusX = 0.3 })
        XCTAssertTrue(sameMask(held, radial { $0.radiusX = 0.3 }))
    }

    func testStartsEachKindAtItsOwnShape() {
        XCTAssertEqual(defaultMask(.linear).kind, .linear)
        XCTAssertEqual(defaultMask(.radial).kind, .radial)
        XCTAssertEqual(defaultMask(.luma).kind, .luma)
    }

    func testNamesALumaBandByTheWordPhotographersUseForIt() {
        XCTAssertEqual(describeMask(nil), "the whole picture")
        XCTAssertEqual(describeMask(luma { $0.from = 0; $0.to = 0.3 }), "shadows")
        XCTAssertEqual(describeMask(luma { $0.from = 0.7; $0.to = 1 }), "highlights")
        XCTAssertEqual(describeMask(luma { $0.from = 0.3; $0.to = 0.7 }), "midtones")
        XCTAssertEqual(describeMask(linear { $0.angle = 45 }), "linear · 45°")
    }
}

final class CombineMaskTests: XCTestCase {
    func testAddsAsAUnionSubtractsAndIntersectsAsProducts() {
        XCTAssertEqual(combineMask(0.3, 0.8, .add), 0.8)
        XCTAssertEqual(combineMask(0.8, 0.8, .add), 0.8)
        XCTAssertEqual(combineMask(1, 0.25, .subtract), 0.75)
        XCTAssertEqual(combineMask(0.5, 0.5, .intersect), 0.25)
        // Nothing combined with nothing stays nothing, whatever the op.
        for op in MaskOp.allCases { XCTAssertEqual(combineMask(0, 0, op), 0) }
    }
}

final class ColourRangeTests: XCTestCase {
    private let blue = ColourSample(x: 0.5, y: 0.2, r: 0.27, g: 0.51, b: 0.86)

    private func range(_ change: (inout ColourMask) -> Void = { _ in }) -> ColourMask {
        var m = ColourMask(samples: [blue], range: 0.5)
        change(&m)
        return m
    }

    func testTakesInTheSampledColourFullyAndALighterAndDarkerOneOfTheSameHue() {
        XCTAssertEqual(colourRangeAt(range(), 0.27, 0.51, 0.86), 1)
        XCTAssertEqual(colourRangeAt(range(), 0.33, 0.57, 0.92), 1)
        XCTAssertGreaterThan(colourRangeAt(range(), 0.2, 0.42, 0.75), 0.9)
    }

    func testLeavesOutARedAGreenAndAGreyOfTheSameBrightness() {
        XCTAssertEqual(colourRangeAt(range(), 0.86, 0.24, 0.16), 0)
        XCTAssertEqual(colourRangeAt(range(), 0.3, 0.7, 0.25), 0)
        XCTAssertEqual(colourRangeAt(range { $0.range = 0.2 }, 0.49, 0.49, 0.49), 0)
    }

    func testWidensWithRefineFadesRatherThanCutsAndIsDecidedByTheNearestSample() {
        let teal = (0.2, 0.62, 0.66)
        let narrow = colourRangeAt(range { $0.range = 0.1 }, teal.0, teal.1, teal.2)
        let wide = colourRangeAt(range { $0.range = 1 }, teal.0, teal.1, teal.2)
        XCTAssertGreaterThan(wide, narrow)
        let between = colourRangeAt(range { $0.range = 0.5 }, teal.0, teal.1, teal.2)
        XCTAssertGreaterThan(between, 0)
        XCTAssertLessThan(between, 1)
        let both = range { $0.samples = [blue, ColourSample(x: 0, y: 0, r: 0.86, g: 0.24, b: 0.16)] }
        XCTAssertEqual(colourRangeAt(both, 0.86, 0.24, 0.16), 1)
    }

    func testCoversNothingWithNoSampleAndReadsThePixelOnlyThroughMaskAtsRgb() {
        XCTAssertEqual(colourRangeAt(range { $0.samples = [] }, 0.27, 0.51, 0.86), 0)
        XCTAssertEqual(maskAt(.colour(range()), 0.5, 0.5, 0.5, 1, rgb: (0.27, 0.51, 0.86)), 1)
        XCTAssertEqual(maskAt(.colour(range()), 0.5, 0.5, 0.5, 1), 0)
    }

    func testReadsBackClampedAndCappedComparesByValueAndClonesDeeply() {
        var many: [JSONValue] = (0..<9).map { i in
            .object(["x": .number(Double(i) / 10), "y": 2, "r": 2, "g": 0.5, "b": -1])
        }
        many.append(["x": "junk"])
        guard case .colour(let read)? = normaliseMask(.object(["kind": "colour", "samples": .array(many), "range": 3])) else {
            return XCTFail("not a colour range")
        }
        XCTAssertEqual(read.samples.count, maxColourSamples)
        XCTAssertEqual(read.samples[0], ColourSample(x: 0, y: 1, r: 1, g: 0.5, b: 0))
        XCTAssertEqual(read.range, 1)
        XCTAssertEqual(normaliseMask(["kind": "colour"]), .colour(ColourMask(samples: [], range: defaultColourRange)))
        let copy = cloneMask(.colour(range()))
        XCTAssertTrue(sameMask(copy, .colour(range())))
        // `copy.samples[0]` is not `blue` by reference on the web; a value
        // type cannot alias, so there is nothing to assert here.
        XCTAssertFalse(sameMask(.colour(range()), .colour(range { $0.range = 0.6 })))
        XCTAssertEqual(describeMask(.colour(range())), "colour · 1 sample")
        XCTAssertEqual(defaultMask(.colour), .colour(ColourMask(samples: [], range: defaultColourRange)))
    }
}
