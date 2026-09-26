// The stage's hand on a mask (`Develop/MaskEdit.swift`). The web has no spec
// of its own for this — the paint seam lives inside `PictureWorkbench.tsx` and
// the gradients have no handles there — so these pin the observable rules:
// a tap adds or removes, a stroke drops points closer than its step, and every
// guide a handle is drawn on is exactly where `maskAt` reads 1, 0.5 or 0.

import XCTest
@testable import AtelierKit

final class MaskViewTests: XCTestCase {
    func testMStepsHiddenOutlineFillAndRoundAgain() {
        XCTAssertEqual(nextMaskView(.off), .outline)
        XCTAssertEqual(nextMaskView(.outline), .fill)
        XCTAssertEqual(nextMaskView(.fill), .off)
        XCTAssertEqual(MaskView.allCases.map(\.label), ["Hidden", "Outline", "Fill"])
    }
}

final class StrokeTests: XCTestCase {
    func testAPressStartsAStrokeOfTheToolsSettings() {
        let tool = BrushTool(radius: 0.2, hardness: 0.8, erase: true)
        let m = beginStroke(BrushMask(), at: Point(0.3, 0.4), tool: tool)
        XCTAssertEqual(m?.strokes.count, 1)
        XCTAssertEqual(m?.strokes[0].points, [Point(0.3, 0.4)])
        XCTAssertEqual(m?.strokes[0].radius, 0.2)
        XCTAssertEqual(m?.strokes[0].hardness, 0.8)
        XCTAssertEqual(m?.strokes[0].erase, true)
    }

    func testAFullMaskStartsNothing() {
        let full = BrushMask(strokes: Array(repeating: BrushStroke(points: [Point(0.5, 0.5)]), count: maxStrokes))
        XCTAssertNil(beginStroke(full, at: Point(0.1, 0.1), tool: .default))
    }

    func testAPointCloserThanTheStepIsDropped() {
        let tool = BrushTool(radius: 0.1)
        guard let started = beginStroke(BrushMask(), at: Point(0.5, 0.5), tool: tool) else { return XCTFail() }
        // The step is max(0.004, 0.1 × 0.12) = 0.012.
        XCTAssertNil(continueStroke(started, to: Point(0.505, 0.5)))
        let grown = continueStroke(started, to: Point(0.52, 0.5))
        XCTAssertEqual(grown?.strokes.count, 1, "the LAST stroke grows, no new one")
        XCTAssertEqual(grown?.strokes[0].points.count, 2)
    }

    func testTheStepHasAFloor() {
        XCTAssertEqual(strokeStep(0.001), 0.004)
        assertClose(strokeStep(0.5), 0.06, 9)
    }

    func testNoStrokeToContinue() {
        XCTAssertNil(continueStroke(BrushMask(), to: Point(0.5, 0.5)))
    }

    func testUndoStrokeTakesTheLastOff() {
        let m = BrushMask(strokes: [BrushStroke(points: [Point(0.1, 0.1)]), BrushStroke(points: [Point(0.9, 0.9)])])
        XCTAssertEqual(withoutLastStroke(m).strokes, [BrushStroke(points: [Point(0.1, 0.1)])])
        XCTAssertEqual(withoutLastStroke(BrushMask()).strokes, [])
    }
}

final class TapTests: XCTestCase {
    func testATapAddsASubjectPointAndATapOnItRemovesIt() {
        let one = tapSubject(SubjectMask(), at: Point(0.5, 0.6))
        XCTAssertEqual(one.points, [Point(0.5, 0.6)])
        // Within the hit radius: the marker comes off, nothing is added.
        let none = tapSubject(one, at: Point(0.52, 0.61))
        XCTAssertEqual(none.points, [])
        // Past it: a second point.
        let two = tapSubject(one, at: Point(0.6, 0.6))
        XCTAssertEqual(two.points.count, 2)
    }

    func testAColourTapSamplesAndAMarkerTapRemoves() {
        let one = tapColour(ColourMask(), at: Point(0.2, 0.2), rgb: (0.1, 0.4, 0.9))
        XCTAssertEqual(one?.samples, [ColourSample(x: 0.2, y: 0.2, r: 0.1, g: 0.4, b: 0.9)])
        let gone = tapColour(one!, at: Point(0.21, 0.2), rgb: (1, 1, 1))
        XCTAssertEqual(gone?.samples, [])
    }

    func testAColourTapWithNothingReadOrAFullRangeChangesNothing() {
        XCTAssertNil(tapColour(ColourMask(), at: Point(0.2, 0.2), rgb: nil))
        let samples = (0..<maxColourSamples).map { ColourSample(x: Double($0) * 0.2, y: 0.9, r: 0, g: 0, b: 0) }
        XCTAssertNil(tapColour(ColourMask(samples: samples), at: Point(0.5, 0.1), rgb: (1, 0, 0)))
    }

    func testMarksAreTheSubjectsPointsOrTheSamples() {
        XCTAssertEqual(maskMarks(.subject(SubjectMask(points: [Point(0.1, 0.2)]))), [Point(0.1, 0.2)])
        XCTAssertEqual(maskMarks(.colour(ColourMask(samples: [ColourSample(x: 0.3, y: 0.4, r: 0, g: 0, b: 0)]))),
                       [Point(0.3, 0.4)])
        XCTAssertNil(maskMarks(.linear(.default)))
        XCTAssertNil(maskMarks(nil))
    }

    func testUnmarkByIndex() {
        let s = Mask.subject(SubjectMask(points: [Point(0.1, 0.1), Point(0.9, 0.9)]))
        XCTAssertEqual(maskMarks(unmark(s, 0)), [Point(0.9, 0.9)])
        XCTAssertEqual(maskMarks(unmark(s, 5)), [Point(0.1, 0.1), Point(0.9, 0.9)])
    }

    func testALumaBandMovesOntoTheTappedToneKeepingItsWidth() {
        let band = centreLumaBand(LumaMask(from: 0, to: 0.3, feather: 0.1), on: 0.6)
        assertClose(band.from, 0.45, 9)
        assertClose(band.to, 0.75, 9)
        XCTAssertEqual(band.feather, 0.1)
        // Held inside 0…1.
        let top = centreLumaBand(LumaMask(from: 0, to: 0.3, feather: 0.1), on: 0.98)
        assertClose(top.to, 1, 9)
        assertClose(top.from, 0.7, 9)
    }
}

final class CentredSpaceTests: XCTestCase {
    func testSharesRoundTripThroughTheCentredSpace() {
        for ar in [1.5, 0.8, 1.0] {
            let p = Point(0.23, 0.71)
            let back = maskShares(maskCentred(p, ar), ar)
            assertClose(back.x, p.x, 12)
            assertClose(back.y, p.y, 12)
        }
    }

    func testTheCornerIsAtRadiusOne() {
        let c = maskCentred(Point(1, 1), 1.5)
        assertClose(hypot(c.x, c.y), 1, 12)
    }
}

final class LinearGuideTests: XCTestCase {
    private let ar = 1.5

    /// `maskAt` at a guide point — the value a line is drawn to mean.
    private func value(_ m: LinearMask, _ p: Point) -> Double {
        maskAt(.linear(m), p.x, p.y, 0, ar)
    }

    func testTheThreeLinesAreWhereTheMaskReadsOneHalfAndNothing() {
        let m = LinearMask(x: 0.4, y: 0.45, angle: 30, feather: 0.4)
        let g = linearGuides(m, ar)
        // The lines run far past the frame; test a point near the centre of each.
        let full = Point((g.fullFrom.x + g.fullTo.x) / 2, (g.fullFrom.y + g.fullTo.y) / 2)
        let mid = Point((g.midFrom.x + g.midTo.x) / 2, (g.midFrom.y + g.midTo.y) / 2)
        let none = Point((g.noneFrom.x + g.noneTo.x) / 2, (g.noneFrom.y + g.noneTo.y) / 2)
        assertClose(value(m, full), 1, 9)
        assertClose(value(m, mid), 0.5, 9)
        assertClose(value(m, none), 0, 9)
        // And the handles sit on their lines.
        assertClose(value(m, g.fullHandle), 1, 9)
        assertClose(value(m, g.noneHandle), 0, 9)
        assertClose(value(m, g.turn), 0.5, 9)
        XCTAssertEqual(g.centre, Point(0.4, 0.45))
    }

    func testTheTurnHandlePointsTheLineAtTheHand() {
        let m = LinearMask(x: 0.5, y: 0.5, angle: 0, feather: 0.3)
        // Straight down the frame from the centre: the line turns to run
        // down it, a bearing of 90 — the covered side is then the right.
        let turned = dragLinear(m, .turn, to: Point(0.5, 0.9), ar)
        assertClose(turned.angle, 90, 6)
        // Back to the right: 0.
        assertClose(dragLinear(turned, .turn, to: Point(0.9, 0.5), ar).angle, 0, 6)
        XCTAssertEqual(turned.feather, 0.3, "the turn moves no feather")
    }

    func testAnEdgeBarSetsTheFeatherAndThenReadsTrue() {
        let m = LinearMask(x: 0.5, y: 0.5, angle: 20, feather: 0.1)
        let target = linearGuides(LinearMask(x: 0.5, y: 0.5, angle: 20, feather: 0.6), ar).fullHandle
        let dragged = dragLinear(m, .full, to: target, ar)
        assertClose(dragged.feather, 0.6, 3)
        XCTAssertEqual(dragged.angle, 20)
        // The none bar pulled to the full side goes to nothing, never negative.
        XCTAssertEqual(dragLinear(m, .none, to: target, ar).feather, 0)
        // Capped at the slider's 1.5.
        XCTAssertEqual(dragLinear(m, .full, to: Point(0.5, -3), ar).feather, 1.5)
    }

    func testMovingHoldsTheCentreInsideTheFrame() {
        let moved = moveMask(.linear(LinearMask(x: 0.5, y: 0.5)), du: 0.2, dv: -0.9)
        guard case .linear(let m) = moved else { return XCTFail() }
        assertClose(m.x, 0.7, 9)
        XCTAssertEqual(m.y, 0)
    }
}

final class RadialGuideTests: XCTestCase {
    private let ar = 0.75

    private func value(_ m: RadialMask, _ p: Point) -> Double {
        maskAt(.radial(m), p.x, p.y, 0, ar)
    }

    func testTheEllipseIsFullAndTheRingIsWhereItEnds() {
        let m = RadialMask(x: 0.45, y: 0.55, radiusX: 0.3, radiusY: 0.2, angle: 35, feather: 0.4)
        let g = radialGuides(m, ar, segments: 24)
        XCTAssertEqual(g.ellipse.count, 25, "closed: the last point is the first")
        for p in g.ellipse { assertClose(value(m, p), 1, 6) }
        for p in g.ring { assertClose(value(m, p), 0, 6) }
        assertClose(value(m, g.radiusX), 1, 6)
        assertClose(value(m, g.radiusY), 1, 6)
        assertClose(value(m, g.feather), 0, 6)
        XCTAssertLessThan(value(m, g.turn), 1e-9, "the turn handle is outside the ring")
    }

    func testAHalfAxisHandleSetsItsRadius() {
        let m = RadialMask(x: 0.5, y: 0.5, radiusX: 0.3, radiusY: 0.2, angle: 30, feather: 0.2)
        let wider = radialGuides(RadialMask(x: 0.5, y: 0.5, radiusX: 0.5, radiusY: 0.2, angle: 30, feather: 0.2), ar)
        let dragged = dragRadial(m, .radiusX, to: wider.radiusX, ar)
        assertClose(dragged.radiusX, 0.5, 3)
        assertClose(dragged.radiusY, 0.2, 9)
        let taller = radialGuides(RadialMask(x: 0.5, y: 0.5, radiusX: 0.3, radiusY: 0.45, angle: 30, feather: 0.2), ar)
        assertClose(dragRadial(m, .radiusY, to: taller.radiusY, ar).radiusY, 0.45, 3)
        // Never below the slider's floor.
        XCTAssertEqual(dragRadial(m, .radiusX, to: Point(0.5, 0.5), ar).radiusX, 0.02)
    }

    func testTheRingHandleSetsTheFeather() {
        let m = RadialMask(x: 0.5, y: 0.5, radiusX: 0.3, radiusY: 0.3, angle: 0, feather: 0.1)
        let target = radialGuides(RadialMask(x: 0.5, y: 0.5, radiusX: 0.3, radiusY: 0.3, angle: 0, feather: 0.7), ar).feather
        assertClose(dragRadial(m, .feather, to: target, ar).feather, 0.7, 3)
        // Inside the ellipse is no feather at all.
        XCTAssertEqual(dragRadial(m, .feather, to: Point(0.5, 0.5), ar).feather, 0)
    }

    func testTheTurnHandleTurnsTheEllipse() {
        let m = RadialMask(x: 0.5, y: 0.5, radiusX: 0.3, radiusY: 0.2, angle: 0, feather: 0.2)
        let turned = RadialMask(x: 0.5, y: 0.5, radiusX: 0.3, radiusY: 0.2, angle: 50, feather: 0.2)
        let handle = radialGuides(turned, ar).turn
        assertClose(dragRadial(m, .turn, to: handle, ar).angle, 50, 6)
    }

    func testDragMaskHandleDispatchesByKind() {
        let luma = Mask.luma(.default)
        XCTAssertEqual(dragMaskHandle(luma, .turn, to: Point(0.1, 0.1), ar), luma)
        guard case .radial(let r) = dragMaskHandle(.radial(.default), .radiusX, to: Point(0.5, 0.5), ar) else {
            return XCTFail()
        }
        XCTAssertEqual(r.radiusX, 0.02)
    }
}

final class LayerListEditTests: XCTestCase {
    func testRenameTrimsAndCaps() {
        let list = [createLayer(.linear, id: "a")]
        XCTAssertEqual(renameLayer(list, "a", "  Sky  ")[0].name, "Sky")
        XCTAssertEqual(renameLayer(list, "a", String(repeating: "x", count: 200))[0].name.count, layerNameLimit)
        // Emptied: the label describes the mask again.
        let named = renameLayer(list, "a", "Sky")
        XCTAssertEqual(layerLabel(renameLayer(named, "a", "   ")[0]), "linear · 0°")
    }

    func testDuplicateLandsJustAboveWithAFreshIdAndAName() {
        var sky = createLayer(.linear, id: "a")
        sky.develop.exposure = -1
        let list = [sky, createLayer(.radial, id: "b")]
        guard let out = duplicateLayer(list, "a", newId: "c") else { return XCTFail() }
        XCTAssertEqual(out.layers.map(\.id), ["a", "c", "b"])
        XCTAssertEqual(out.id, "c")
        XCTAssertEqual(out.layers[1].develop.exposure, -1)
        XCTAssertEqual(out.layers[1].name, "linear · 0° copy")
        XCTAssertEqual(out.layers[1].mask, sky.mask)
    }

    func testDuplicateRefusesAFullStackOrAMissingLayer() {
        let full = (0..<maxLayers).map { createLayer(.linear, id: "l\($0)") }
        XCTAssertNil(duplicateLayer(full, "l0"))
        XCTAssertNil(duplicateLayer([createLayer(.linear, id: "a")], "zz"))
    }
}
