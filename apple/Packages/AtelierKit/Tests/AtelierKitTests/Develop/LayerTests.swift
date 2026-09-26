// Port of `src/shared/develop/layer.test.ts`, plus the layer record's writer
// and the roll's `layers` field.

import XCTest
@testable import AtelierKit

/// A linear layer with id `l1`, a few fields changed — the web spec's `layer({…})`.
private func layer(_ change: (inout AdjustLayer) -> Void = { _ in }) -> AdjustLayer {
    var l = createLayer(.linear, id: "l1")
    change(&l)
    return l
}

private func subjectLayer(_ id: String, _ points: [Point] = [Point(0.5, 0.5)], _ change: (inout AdjustLayer) -> Void = { _ in }) -> AdjustLayer {
    var l = createLayer(.subject, id: id)
    change(&l)
    l.mask = .subject(SubjectMask(points: points, model: subjectModel))
    return l
}

final class NewLayerTests: XCTestCase {
    func testStartsAtFullOpacityEnabledAndChangingNothing() {
        let l = createLayer(.radial)
        XCTAssertEqual(l.opacity, 1)
        XCTAssertTrue(l.enabled)
        XCTAssertFalse(l.invert)
        XCTAssertEqual(l.develop, DevelopSettings.default)
        XCTAssertEqual(l.mask?.kind, .radial)
        // And so it draws NOTHING until a slider is moved.
        XCTAssertFalse(layerDraws(l))
    }

    func testCanStartWithNoMaskAtAll() {
        XCTAssertNil(createLayer(nil).mask)
    }

    func testGetsItsOwnIdEveryTime() {
        XCTAssertNotEqual(createLayer(.linear).id, createLayer(.linear).id)
    }
}

final class LayerDrawsTests: XCTestCase {
    func testNeedsAnAdjustmentTheSwitchOnAndSomeOpacity() {
        let real = layer { $0.develop = dev { $0.exposure = 0.5 } }
        XCTAssertTrue(layerDraws(real))
        var off = real
        off.enabled = false
        XCTAssertFalse(layerDraws(off))
        var clear = real
        clear.opacity = 0
        XCTAssertFalse(layerDraws(clear))
        var untouched = real
        untouched.develop = .default
        XCTAssertFalse(layerDraws(untouched))
    }

    func testFiltersAStackSoAParkedLayerCostsNoPass() {
        let on = layer { $0.id = "a"; $0.develop = dev { $0.contrast = 20 } }
        let off = layer { $0.id = "b"; $0.enabled = false; $0.develop = dev { $0.contrast = 20 } }
        XCTAssertEqual(drawingLayers([on, off]).map(\.id), ["a"])
        XCTAssertEqual(drawingLayers(nil), [])
    }
}

final class SubjectsToSegmentTests: XCTestCase {
    func testSegmentsAFreshSubjectWhoseSlidersAreStillAtZero() {
        // The maintainer's report: a tap picked nothing until a slider moved.
        let fresh = subjectLayer("s")
        XCTAssertFalse(layerDraws(fresh))
        XCTAssertEqual(subjectLayersToSegment([fresh]).map(\.id), ["s"])
    }

    func testSkipsAHiddenSubjectOneWithNoPointYetAndEveryOtherKind() {
        let hidden = subjectLayer("h") { $0.enabled = false }
        let empty = subjectLayer("e", [])
        let whole = layer { $0.id = "w"; $0.mask = nil; $0.develop = dev { $0.exposure = -1 } }
        XCTAssertEqual(subjectLayersToSegment([hidden, empty, whole]), [])
        XCTAssertEqual(subjectLayersToSegment(nil), [])
    }
}

final class LayerExceptTests: XCTestCase {
    private func whole(_ change: (inout AdjustLayer) -> Void = { _ in }) -> AdjustLayer {
        layer { l in
            l.id = "w"
            l.mask = nil
            l.develop = dev { $0.exposure = -1 }
            l.except = "s"
            change(&l)
        }
    }

    func testStartsWithNothingTakenOutAndReadsBackWhatWasStored() {
        XCTAssertNil(createLayer(nil).except)
        XCTAssertEqual(normaliseLayer(["except": "s"])?.except, "s")
        XCTAssertNil(normaliseLayer(["except": 3])?.except)
        XCTAssertNil(normaliseLayer([:])?.except)
    }

    func testCountsTheSubtractionWhenComparing() {
        XCTAssertFalse(sameLayers([whole()], [whole { $0.except = nil }]))
    }

    func testSegmentsTheSubtractedSubjectEvenWhileItsOwnLayerIsHidden() {
        let hidden = subjectLayer("s") { $0.enabled = false }
        XCTAssertEqual(subjectLayersToSegment([hidden, whole()]).map(\.id), ["s"])
        XCTAssertEqual(subjectLayersToSegment([hidden, whole { $0.enabled = false }]), [])
    }

    func testAsksADeliveryOnlyForTheSubjectsSomethingDrawingUses() {
        let parked = subjectLayer("p")
        let cut = subjectLayer("s") { $0.enabled = false }
        XCTAssertEqual(subjectLayersForRender([parked, cut, whole()]).map(\.id), ["s"])
        let drawing = subjectLayer("d") { $0.develop = dev { $0.exposure = 1 } }
        XCTAssertEqual(subjectLayersForRender([drawing]).map(\.id), ["d"])
    }

    func testOffersOnlyTheOtherSubjectLayers() {
        let s = subjectLayer("s")
        XCTAssertEqual(exceptCandidates([s, whole()], "w").map(\.id), ["s"])
        XCTAssertEqual(exceptCandidates([s], "s"), [])
    }

    func testForgetsASubtractionWhoseSubjectIsDeleted() {
        XCTAssertNil(removeLayer([subjectLayer("s"), whole()], "s")[0].except)
    }

    func testSaysWhatItTakesOut() {
        XCTAssertEqual(layerLabel(whole(), [subjectLayer("s"), whole()]), "the whole picture except the subject")
    }

    func testHolesTheMaskAFTERTheInvertSoTheHoleStaysAHole() {
        XCTAssertEqual(layerWeight(1, false, 1, 1), 0)
        XCTAssertEqual(layerWeight(0, true, 1, 1), 0)
        XCTAssertEqual(layerWeight(1, false, 0, 0.5), 0.5)
        XCTAssertEqual(layerWeight(1, false, 0.25, 1), 0.75)
    }
}

final class ReadLayersTests: XCTestCase {
    func testTakesJunkAsNoLayersRatherThanThrowing() {
        XCTAssertEqual(readLayers(.null), [])
        XCTAssertEqual(readLayers("nope"), [])
        XCTAssertEqual(readLayers([1, "two", .null]), [])
    }

    func testKeepsALayerWhoseDevelopIsMissingRatherThanDroppingIt() {
        // Deleting somebody's layer on a read is never the answer: it comes back
        // doing nothing, which is visible and fixable.
        let l = normaliseLayer(["id": "x", "mask": ["kind": "luma"]])
        XCTAssertEqual(l?.id, "x")
        XCTAssertEqual(l?.develop, DevelopSettings.default)
        XCTAssertEqual(l?.mask?.kind, .luma)
    }

    func testClampsTheOpacityAndCapsTheStack() {
        XCTAssertEqual(normaliseLayer(["opacity": 4])?.opacity, 1)
        XCTAssertEqual(normaliseLayer(["opacity": -1])?.opacity, 0)
        XCTAssertEqual(normaliseLayer(["opacity": "x"])?.opacity, 1)
        let many = JSONValue.array((0..<(maxLayers + 5)).map { .object(["id": .string("l\($0)")]) })
        XCTAssertEqual(readLayers(many).count, maxLayers)
    }

    func testDefaultsEnabledToOnAndInvertToOff() {
        XCTAssertEqual(normaliseLayer([:])?.enabled, true)
        XCTAssertEqual(normaliseLayer(["enabled": false])?.enabled, false)
        XCTAssertEqual(normaliseLayer([:])?.invert, false)
        XCTAssertEqual(normaliseLayer(["invert": true])?.invert, true)
    }
}

final class SameLayersTests: XCTestCase {
    func testIsByValueAndNoticesAReorder() {
        let a = layer { $0.id = "a" }
        let b = layer { $0.id = "b"; $0.mask = .radial(.default) }
        XCTAssertTrue(sameLayers([a, b], [a, b]))
        XCTAssertFalse(sameLayers([a, b], [b, a]))
        XCTAssertFalse(sameLayers([a], [a, b]))
        XCTAssertTrue(sameLayers(nil, []))
    }

    func testNoticesAChangeInsideALayer() {
        let a = layer { $0.id = "a" }
        var faded = a
        faded.opacity = 0.5
        XCTAssertFalse(sameLayers([a], [faded]))
        var luma = a
        luma.mask = .luma(.default)
        XCTAssertFalse(sameLayers([a], [luma]))
        var lifted = a
        lifted.develop = dev { $0.exposure = 1 }
        XCTAssertFalse(sameLayers([a], [lifted]))
    }

    func testClonesDeeplyEnoughToBeHeldAgainstALiveDraft() {
        var live = [layer { $0.id = "a"; $0.develop = dev { $0.exposure = 0.3 } }]
        let held = cloneLayers(live)
        live[0].develop.exposure = 0.4
        XCTAssertFalse(sameLayers(held, live))
    }
}

final class AdjustLayerListTests: XCTestCase {
    private func stack() -> [AdjustLayer] {
        [layer { $0.id = "a" }, layer { $0.id = "b" }, layer { $0.id = "c" }]
    }

    private func ids(_ list: [AdjustLayer]) -> [String] { list.map(\.id) }

    func testAddsOnTOPWhichIsTheEndOfTheArray() {
        XCTAssertEqual(ids(addLayer(stack(), layer { $0.id = "d" })), ["a", "b", "c", "d"])
        XCTAssertEqual(ids(addLayer(nil, layer { $0.id = "d" })), ["d"])
    }

    func testRefusesToGrowPastTheCap() {
        let full = (0..<maxLayers).map { i in layer { $0.id = "l\(i)" } }
        XCTAssertEqual(addLayer(full, layer { $0.id = "over" }).count, maxLayers)
    }

    func testRemovesByIdAndAMissIsANoOp() {
        XCTAssertEqual(ids(removeLayer(stack(), "b")), ["a", "c"])
        XCTAssertEqual(ids(removeLayer(stack(), "zz")), ["a", "b", "c"])
    }

    func testMovesInSTACKTermsPlusOneIsNearerTheTop() {
        XCTAssertEqual(ids(moveLayer(stack(), "a", 1)), ["b", "a", "c"])
        XCTAssertEqual(ids(moveLayer(stack(), "c", -1)), ["a", "c", "b"])
    }

    func testHoldsAtTheEndsRatherThanWrapping() {
        XCTAssertEqual(ids(moveLayer(stack(), "c", 1)), ["a", "b", "c"])
        XCTAssertEqual(ids(moveLayer(stack(), "a", -1)), ["a", "b", "c"])
        XCTAssertEqual(ids(moveLayer(stack(), "a", 99)), ["b", "c", "a"])
    }

    func testPatchesOneLayerAndLeavesTheRestAlone() {
        let before = stack()
        let next = patchLayer(before, "b") { $0.opacity = 0.25 }
        XCTAssertEqual(next.map(\.opacity), [1, 0.25, 1])
        // Untouched entries are the same values.
        XCTAssertEqual(next[0], before[0])
        XCTAssertEqual(next[2], before[2])
        // And a patch never moves an id.
        XCTAssertEqual(ids(patchLayer(before, "b") { $0.id = "zz" }), ["a", "b", "c"])
    }
}

final class LayerLabelTests: XCTestCase {
    func testUsesTheNameTheAuthorGaveItWhenThereIsOne() {
        XCTAssertEqual(layerLabel(layer { $0.name = "  Sky  " }), "Sky")
    }

    func testDescribesTheMaskWhenThereIsNotAndSaysSoWhenInverted() {
        let shadows = Mask.luma(LumaMask(from: 0, to: 0.3, feather: LumaMask.default.feather))
        XCTAssertEqual(layerLabel(layer { $0.mask = shadows }), "shadows")
        XCTAssertEqual(layerLabel(layer { $0.mask = shadows; $0.invert = true }), "not shadows")
        XCTAssertEqual(layerLabel(layer { $0.mask = nil }), "the whole picture")
    }
}

final class MaskPartsTests: XCTestCase {
    private func base() -> AdjustLayer {
        layer { $0.mask = .radial(.default) }
    }

    func testStartsWithNoPartAndAStoredLayerWithoutTheFieldReadsAsNone() {
        XCTAssertEqual(createLayer(.radial).parts, [])
        XCTAssertEqual(normaliseLayer(["id": "x", "mask": ["kind": "linear"]])?.parts, [])
    }

    func testAddsAPartAtItsDefaultShapeCapsThemAndRefusesASubject() {
        var l = addPart(base(), .subtract, .brush)
        XCTAssertEqual(l.parts, [MaskPart(op: .subtract, mask: .brush(BrushMask(strokes: [])), invert: false)])
        XCTAssertEqual(addPart(l, .add, .subject), l)
        for _ in 0..<10 { l = addPart(l, .add, .linear) }
        XCTAssertEqual(l.parts.count, maxMaskParts)
    }

    func testReadsPartsBackSafelyJunkAndSubjectsDroppedABadOpReadAsAdd() {
        let read = readParts([
            ["op": "intersect", "mask": ["kind": "luma", "from": 0, "to": 0.35, "feather": 0.15], "invert": true],
            ["op": "nope", "mask": ["kind": "radial"]],
            ["op": "add", "mask": ["kind": "subject", "points": [[0.5, 0.5]]]],
            "junk",
            ["op": "add", "mask": .null],
        ])
        XCTAssertEqual(read.map(\.op), [.intersect, .add])
        XCTAssertEqual(read.map(\.mask.kind), [.luma, .radial])
        XCTAssertEqual(read.map(\.invert), [true, false])
    }

    func testComparesClonesAndNamesTheParts() {
        let a = patchPart(addPart(base(), .intersect, .luma), 0) { $0.invert = true }
        let b = cloneLayers([a])[0]
        XCTAssertTrue(sameLayers([a], [b]))
        XCTAssertFalse(sameLayers([a], [patchPart(a, 0) { $0.op = .add }]))
        XCTAssertEqual(layerLabel(a), "radial · 40 % ∩ not shadows")
        XCTAssertEqual(describePart(removePart(addPart(a, .subtract, .colour), 0).parts[0]), "− colour · tap one")
    }

    func testOpensOneComponentAtATimeForTheStageToActOn() {
        let l = addPart(base(), .subtract, .brush)
        XCTAssertEqual(componentMask(l, nil)?.kind, .radial)
        XCTAssertEqual(componentMask(l, 0)?.kind, .brush)
        XCTAssertNil(componentMask(l, 3))
        let stroke = BrushStroke(points: [Point(0.5, 0.5)], radius: 0.1, hardness: 0.5, erase: false)
        let painted = withComponentMask(l, 0, .brush(BrushMask(strokes: [stroke])))
        XCTAssertEqual(painted.mask, l.mask)
        XCTAssertEqual(painted.parts[0].mask.kind, .brush)
        XCTAssertEqual(withComponentMask(l, 5, nil), l)
    }

    func testWeighsThePartsInOrderEachTurnedByItsOwnInvertBeforeTheSubjectHole() {
        // A radial at 1, minus a stroke at 0.75, intersected with a band at 0.5.
        let parts = [
            MaskPartValue(op: .subtract, invert: false, value: 0.75),
            MaskPartValue(op: .intersect, invert: true, value: 0.5),
        ]
        assertClose(layerWeight(1, false, 0, 1, parts), 0.125, 10)
        // Add is the larger of the two, so adding a shape to itself changes nothing.
        XCTAssertEqual(layerWeight(0.4, false, 0, 1, [MaskPartValue(op: .add, invert: false, value: 0.4)]), 0.4)
        // The hole still comes last.
        XCTAssertEqual(layerWeight(0, true, 1, 1, [MaskPartValue(op: .add, invert: false, value: 1)]), 0)
    }
}

// Not in the web spec: the record written, read back, and carried by a roll.
final class LayerRecordTests: XCTestCase {
    func testWritesALayerThatReadsBackAsItself() {
        let stroke = BrushStroke(points: [Point(0.2, 0.3), Point(0.6, 0.5)], radius: 0.1, hardness: 0.4, erase: true)
        let sample = ColourSample(x: 0.5, y: 0.5, r: 0.2, g: 0.4, b: 0.8)
        var l = createLayer(.radial, id: "r")
        l.name = "Sky"
        l.invert = true
        l.except = "s"
        l.opacity = 0.6
        l.develop = dev { $0.exposure = -0.5; $0.temperature = 12 }
        l.parts = [
            MaskPart(op: .subtract, mask: .brush(BrushMask(strokes: [stroke]))),
            MaskPart(op: .intersect, mask: .colour(ColourMask(samples: [sample], range: 0.3)), invert: true),
            MaskPart(op: .add, mask: .luma(.default)),
            MaskPart(op: .add, mask: .linear(LinearMask(x: 0.4, y: 0.6, angle: 30, feather: 0.2))),
        ]
        XCTAssertEqual(normaliseLayer(l.json), l)
        let subject = subjectLayer("s", [Point(0.25, 0.75)])
        XCTAssertEqual(normaliseLayer(subject.json), subject)
        let text = l.json.serialized()
        XCTAssertEqual(normaliseLayer(JSONValue.parse(text)), l)
    }

    func testRidesTheRollAsItsLayersField() {
        var p = createRollPicture(SavedMediaRef(name: "a.jpg", size: 1, lastModified: 0), id: "p")
        XCTAssertEqual(p.layers, [])
        let l = layer { $0.develop = dev { $0.exposure = 0.3 } }
        p.layers = [l]
        XCTAssertEqual(p.layers, [l])
        XCTAssertEqual(pictureEdits(p), [.layers])
        p.layers = []
        XCTAssertNil(p.carried["layers"])
        XCTAssertEqual(p.json.objectValue?["layers"], .array([]))
    }
}
