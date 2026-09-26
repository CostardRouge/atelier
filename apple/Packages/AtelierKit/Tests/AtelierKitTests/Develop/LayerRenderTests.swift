// Port of `src/shared/develop/layer-render.test.ts` — the web's `toBe` on a
// pass is `===` on a `LayerPass` here — plus `layerPasses`, `layerCube` and the
// overlay's cubes, which the web leaves to its GPU gate.

import XCTest
@testable import AtelierKit

private let stroke = BrushStroke(points: [Point(0.3, 0.3), Point(0.6, 0.5)], radius: 0.15, hardness: 0.5, erase: false)

/// A linear layer `a` at −1 EV — the web spec's `layer({…})`.
private func layer(_ change: (inout AdjustLayer) -> Void = { _ in }) -> AdjustLayer {
    var l = createLayer(.linear, id: "a")
    l.develop = dev { $0.exposure = -1 }
    change(&l)
    return l
}

final class LayerPassCacheTests: XCTestCase {
    func testHandsTheSAMEPassObjectBackWhileNothingItWasBuiltFromMoved() throws {
        let cache = makeLayerPassCache()
        let a = layer()
        let first = try XCTUnwrap(cache.passes([a], aspectRatio: 1.5).first)
        // A new array of the same layer.
        let second = try XCTUnwrap(cache.passes([a], aspectRatio: 1.5).first)
        XCTAssertTrue(second === first)
        // And of an EQUAL layer built apart: value, not identity.
        var equal = createLayer(.linear, id: "a")
        equal.develop = dev { $0.exposure = -1 }
        let third = try XCTUnwrap(cache.passes([equal], aspectRatio: 1.5).first)
        XCTAssertTrue(third === first)
    }

    func testRebuildsThePassAndOnlyThePassWhenTheMaskOrTheOpacityMoves() throws {
        let cache = makeLayerPassCache()
        let a = layer()
        let first = try XCTUnwrap(cache.passes([a], aspectRatio: 1.5).first)
        var faded = a
        faded.opacity = 0.5
        let moved = try XCTUnwrap(cache.passes([faded], aspectRatio: 1.5).first)
        XCTAssertFalse(moved === first)
        XCTAssertEqual(moved.id, first.id)
        // The cube was kept: the develop did not move.
        XCTAssertEqual(moved.lut, first.lut)
    }

    func testForgetsALayerThatLeftAndADifferentAspectIsADifferentPass() throws {
        let cache = makeLayerPassCache()
        let a = layer()
        let first = try XCTUnwrap(cache.passes([a], aspectRatio: 1.5).first)
        XCTAssertTrue(cache.passes([], aspectRatio: 1.5).isEmpty)
        let back = try XCTUnwrap(cache.passes([a], aspectRatio: 1.5).first)
        XCTAssertFalse(back === first)
        let wider = try XCTUnwrap(cache.passes([a], aspectRatio: 2).first)
        XCTAssertFalse(wider === back)
    }

    func testKeepsAPaintedRasterAcrossAnOpacityNudgeAndReWalksItForNewStrokes() throws {
        let cache = makeLayerPassCache()
        let painted = layer { $0.mask = .brush(BrushMask(strokes: [stroke])) }
        let first = try XCTUnwrap(cache.passes([painted], aspectRatio: 1).first)
        XCTAssertNotNil(first.raster)
        var nudgedLayer = painted
        nudgedLayer.opacity = 0.7
        let nudged = try XCTUnwrap(cache.passes([nudgedLayer], aspectRatio: 1).first)
        XCTAssertFalse(nudged === first)
        // The map it was handed is the one already walked.
        XCTAssertEqual(nudged.raster, first.raster)
        var repaintedLayer = painted
        repaintedLayer.mask = .brush(BrushMask(strokes: [stroke, stroke]))
        let repainted = try XCTUnwrap(cache.passes([repaintedLayer], aspectRatio: 1).first)
        XCTAssertFalse(repainted === nudged)
    }

    func testSkipsALayerThatDrawsNothingLikeLayerPassesDoes() {
        let cache = makeLayerPassCache()
        XCTAssertTrue(cache.passes([layer { $0.opacity = 0 }], aspectRatio: 1).isEmpty)
        XCTAssertTrue(cache.passes([layer { $0.develop = .default }], aspectRatio: 1).isEmpty)
    }

    func testKeepsTheOverlayPassForTheSameLayerAndDropsItWhenTheLayerChanges() throws {
        let cache = makeLayerPassCache()
        let a = layer()
        let first = try XCTUnwrap(cache.overlay(a, aspectRatio: 1.5))
        XCTAssertTrue(cache.overlay(a, aspectRatio: 1.5) === first)
        var inverted = a
        inverted.invert = true
        XCTAssertFalse(cache.overlay(inverted, aspectRatio: 1.5) === first)
        XCTAssertNil(cache.overlay(layer { $0.mask = nil }, aspectRatio: 1.5))
    }

    func testRebuildsAPassWhenTheSubtractedSubjectArrivesAndKeepsItAfter() throws {
        let cache = makeLayerPassCache()
        let whole = layer { $0.mask = nil; $0.except = "s" }
        let before = try XCTUnwrap(cache.passes([whole], aspectRatio: 1.5, rasters: [:]).first)
        let cut = BrushRaster(data: [UInt8](repeating: 255, count: 4), width: 2, height: 2)
        let rasters = ["s": cut]
        let after = try XCTUnwrap(cache.passes([whole], aspectRatio: 1.5, rasters: rasters).first)
        XCTAssertFalse(after === before)
        XCTAssertTrue(cache.passes([whole], aspectRatio: 1.5, rasters: rasters).first === after)
    }

    func testDrawsTheOutlineAndTheFillAsTwoPassesAndShowsAHoleOnAWholeLayer() {
        let cache = makeLayerPassCache()
        let a = layer()
        let fill = cache.overlay(a, aspectRatio: 1.5, raster: nil, style: .fill)
        let outline = cache.overlay(a, aspectRatio: 1.5, raster: nil, style: .outline)
        XCTAssertFalse(outline === fill)
        XCTAssertEqual(outline?.id, "mask-outline:a")
        let cut = BrushRaster(data: [UInt8](repeating: 0, count: 4), width: 2, height: 2)
        // No mask of its own, but a subject taken out: the hole is worth showing.
        XCTAssertNotNil(cache.overlay(layer { $0.mask = nil; $0.except = "s" }, aspectRatio: 1.5, raster: nil, style: .outline, except: cut))
    }

    func testKeepsTheBlinkForTheSameRasterAndLetsItGoWithNone() throws {
        let cache = makeLayerPassCache()
        let r = BrushRaster(data: [UInt8](repeating: 0, count: 4), width: 2, height: 2)
        let first = try XCTUnwrap(cache.flash(r, aspectRatio: 1.5))
        XCTAssertTrue(cache.flash(r, aspectRatio: 1.5) === first)
        XCTAssertNil(cache.flash(nil, aspectRatio: 1.5))
    }
}

final class ExceptRasterTests: XCTestCase {
    func testIsTheSubtractedSubjectsMapOrNothing() {
        let r = BrushRaster(data: [0], width: 1, height: 1)
        let rasters = ["s": r]
        XCTAssertEqual(exceptRaster(layer { $0.except = "s" }, rasters), r)
        XCTAssertNil(exceptRaster(layer { $0.except = "gone" }, rasters))
        XCTAssertNil(exceptRaster(layer(), rasters))
    }
}

// Not in the web spec: what a pass is built from.
final class LayerPassesTests: XCTestCase {
    func testBakesTheDevelopAloneWithNoLookAndNoTransform() throws {
        let d = dev { $0.exposure = -1 }
        let cube = try XCTUnwrap(layerCube(d))
        XCTAssertEqual(cube, composeLutStack([], output: .none, interpolation: .tetrahedral, develop: d))
        XCTAssertEqual(cube.title, "Develop")
        XCTAssertNil(layerCube(.default))
    }

    func testBuildsOnePassPerDrawingLayerBottomToTopEachWithItsOwnId() {
        let a = layer()
        let b = layer { $0.id = "b"; $0.mask = .radial(.default); $0.opacity = 0.4 }
        let parked = layer { $0.id = "p"; $0.enabled = false }
        let passes = layerPasses([a, parked, b], aspectRatio: 1.5)
        XCTAssertEqual(passes.map(\.id), ["layer:a", "layer:b"])
        XCTAssertEqual(passes[1].opacity, 0.4)
        XCTAssertEqual(passes[1].finish, .grade)
        XCTAssertNil(passes[1].raster)
        XCTAssertEqual(passes[0].lut, layerCube(a.develop))
    }

    func testAPaintedLayerDeliversItsStrokesAndASubjectWaitsForItsMap() {
        let painted = layer { $0.id = "b"; $0.mask = .brush(BrushMask(strokes: [stroke])) }
        let subject = layer { $0.id = "s"; $0.mask = .subject(SubjectMask(points: [Point(0.5, 0.5)])) }
        let part = layer { l in
            l.id = "q"
            l.parts = [MaskPart(op: .subtract, mask: .brush(BrushMask(strokes: [stroke])))]
        }
        let bare = layerPasses([painted, subject, part], aspectRatio: 1)
        // The painted layer is rasterised from its strokes (the web's export
        // handed it an empty map); the subject has none until the model answers.
        XCTAssertEqual(bare[0].raster, rasteriseBrush([stroke], 1))
        XCTAssertNil(bare[1].raster)
        XCTAssertEqual(bare[2].partRasters, [rasteriseBrush([stroke], 1)])
        let answer = BrushRaster(data: [255], width: 1, height: 1)
        let answered = layerPasses([subject], aspectRatio: 1, rasters: ["s": answer])
        XCTAssertEqual(answered[0].raster, answer)
    }

    func testShowsTheMaskInOneVermilionAndBlinksInABrighterOne() throws {
        let a = layer()
        let fill = try XCTUnwrap(maskOverlayPass(a, aspectRatio: 1.5))
        XCTAssertEqual(fill.opacity, 0.55)
        XCTAssertEqual(fill.interpolation, .trilinear)
        XCTAssertEqual(fill.id, "mask-fill:a")
        let red = sampleLut(fill.lut, 0.3, 0.6, 0.9)
        assertTriple(red, (0.85, 0.16, 0.1), 6)
        let outline = try XCTUnwrap(maskOverlayPass(a, aspectRatio: 1.5, style: .outline))
        XCTAssertEqual(outline.opacity, 1)
        XCTAssertEqual(outline.finish, .outline)
        let flash = try XCTUnwrap(maskFlashPass(BrushRaster(data: [255], width: 1, height: 1), aspectRatio: 1))
        XCTAssertEqual(flash.opacity, 0.7)
        XCTAssertEqual(flash.id, "mask-flash")
        assertTriple(sampleLut(flash.lut, 0, 0, 0), (0.94, 0.34, 0.22), 6)
    }

    func testRefusesAPassThatWouldChangeNothing() {
        XCTAssertNil(LayerPass(lut: nil, mask: nil))
        XCTAssertNil(LayerPass(lut: .identity(), mask: nil, opacity: 0))
        let many = (0..<6).map { _ in MaskPart(op: .add, mask: .linear(.default)) }
        XCTAssertEqual(LayerPass(lut: .identity(), mask: nil, parts: many)?.parts.count, LayerPass.partSlots)
    }
}
