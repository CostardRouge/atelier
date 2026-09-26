// `src/shared/roadtrip/collage.ts`: every case of `collage.test.ts` — the
// ones that create and read a collage (`CollageReaderTests`, plus the
// writer's round trip), then the behaviour's: the cells' motion, their
// rects, re-templating, swapping and writing a cell (`CollageMotionTests`,
// `CollageCellsTests`).

import XCTest
@testable import AtelierKit

private func ref(_ name: String) -> SavedMediaRef {
    SavedMediaRef(name: name, size: 1, lastModified: 1)
}

final class CollageReaderTests: XCTestCase {
    func testStartsACollageWithEmptyCellsAfterTheLead() throws {
        let c = try XCTUnwrap(createCollage("grid-2x2"))
        XCTAssertEqual(c.cells.count, 3)
        XCTAssertTrue(c.cells.allSatisfy { $0.media == nil })
        XCTAssertEqual(collageCellCount(c), 4)
        XCTAssertNil(createCollage("nope"))
    }

    func testReadsAStoredCollageAndRefusesAnUnknownTemplate() throws {
        XCTAssertNil(readCollage(nil))
        XCTAssertNil(readCollage(["template": "from-the-future", "cells": []]))
        let c = try XCTUnwrap(readCollage([
            "template": "bento-hero",
            "spacing": ["gap": 2],
            "background": "red",
            "cells": [["media": ["name": "b.jpg", "size": 1, "lastModified": 1], "framing": ["scale": 2]], "junk"],
        ]))
        XCTAssertEqual(c.spacing.gap, 0.1)
        XCTAssertEqual(c.background, "#100f0d")
        XCTAssertEqual(c.cells[0].media?.name, "b.jpg")
        XCTAssertEqual(c.cells[0].framing.scale, 2)
        XCTAssertNil(c.cells[1].media)
        XCTAssertEqual(c.place, CellPlace(dx: 0, dy: 0, rotation: 0))
    }

    func testReadsStoredMotionAnEntranceWithItsInsideAndRefusesAJunkExit() throws {
        let read = try XCTUnwrap(readCollage([
            "template": "grid-2x2",
            "enter": ["step": ["preset": "scale", "duration": 0.3, "easing": "back", "inside": true], "stagger": ["order": "size"]],
            "exit": "nope",
        ]))
        XCTAssertEqual(read.enter?.step.preset, .scale)
        XCTAssertEqual(read.enter?.step.easing, .back)
        XCTAssertEqual(read.enter?.step.inside, true)
        XCTAssertEqual(read.enter?.stagger.order, .size)
        XCTAssertNil(read.exit)
    }

    func testReadsACellsMotionBackPastTheTemplatesOwnCount() throws {
        let moving = FramingMotion(keys: [FramingKey(at: 0, scale: 2, x: 0, y: 0)], easing: .linear, start: .slide)
        var c = try XCTUnwrap(createCollage("bento-six"))
        c.cells[4] = CollageCell(media: ref("six.jpg"), motion: moving)
        XCTAssertEqual(readCollage(c.json)?.cells[4].motion, moving)
    }

    func testWritesWhatItReads() throws {
        var c = try XCTUnwrap(createCollage("grid-2x2"))
        c.cells[0].media = ref("a.jpg")
        c.enter = defaultCollageEnter()
        c.exit = defaultCollageExit()
        XCTAssertEqual(readCollage(c.json), c)
        XCTAssertEqual(readCollage(c.json)?.json, c.json)
    }
}

private let lead = CollageLead(media: ref("lead.jpg"), framing: .default, develop: nil, motion: nil)

private let moving = FramingMotion(keys: [FramingKey(at: 0, scale: 2, x: 0, y: 0)], easing: .linear, start: .slide)

final class CollageMotionTests: XCTestCase {
    private let frame = Size(1080, 1920)
    private let enter = CollageEnter(
        step: AnimStep(preset: .fade, duration: 0.5, easing: .linear),
        stagger: Stagger(each: 0.25, order: .rows)
    )

    private func alphas(_ c: SlideCollage, _ cells: [CellRect], _ t: Double, _ seconds: Double?) throws -> [Double] {
        let motions = try XCTUnwrap(collageCellMotions(c, cells, frame, t, seconds))
        return try motions.map { try XCTUnwrap($0).transform.alpha }
    }

    func testIsStillWithoutAnEntranceOrAnExitAndMovesWithEither() throws {
        let c = try XCTUnwrap(createCollage("grid-2x2"))
        XCTAssertFalse(collageAnimates(c))
        XCTAssertNil(collageCellMotions(c, resolveCollage(c, 1080, 1920), frame, 1, 3))
        var entering = c
        entering.enter = enter
        XCTAssertTrue(collageAnimates(entering))
        var leaving = c
        leaving.exit = CollageExit(step: enter.step, reverse: true)
        XCTAssertTrue(collageAnimates(leaving))
        XCTAssertFalse(collageAnimates(nil))
    }

    func testLandsARowAtATimeAndSettlesAfterTheLastRowPlusTheStep() throws {
        var c = try XCTUnwrap(createCollage("grid-2x2"))
        c.enter = enter
        let cells = resolveCollage(c, 1080, 1920)
        XCTAssertEqual(try alphas(c, cells, 0, nil), [0, 0, 0, 0])
        let quarter = try alphas(c, cells, 0.25, nil)
        assertClose(quarter[0], 0.5, 6)
        assertClose(quarter[1], 0.5, 6)
        XCTAssertEqual(Array(quarter[2...]), [0, 0])
        XCTAssertEqual(try alphas(c, cells, 1, nil), [1, 1, 1, 1])
        assertClose(collageSettleSeconds(c, 1080.0 / 1920), 0.75, 2)
        XCTAssertEqual(collageSettleSeconds(createCollage("grid-2x2"), 1), 0)
    }

    func testLaysAStaggeredExitAgainstTheScreenTimeAsEarlierWindowEnds() throws {
        var c = try XCTUnwrap(createCollage("grid-2x2"))
        c.enter = enter
        var out = enter.step
        out.duration = 0.5
        c.exit = CollageExit(step: out, reverse: true)
        let cells = resolveCollage(c, 1080, 1920)
        // Reverse (last in, first out): the bottom row arrived last, so its window
        // ends first, at 3 − 0.25; the top row's ends at 3.
        let late = try alphas(c, cells, 2.9, 3)
        assertClose(late[0], 0.2, 6)
        assertClose(late[1], 0.2, 6)
        XCTAssertEqual(Array(late[2...]), [0, 0])
        var fifo = c
        fifo.exit?.reverse = false
        let inOrder = try alphas(fifo, cells, 2.9, 3)
        XCTAssertEqual(Array(inOrder[..<2]), [0, 0])
        assertClose(inOrder[2], 0.2, 6)
        assertClose(inOrder[3], 0.2, 6)
        XCTAssertEqual(try alphas(c, cells, 3.1, 3), [0, 0, 0, 0])
        // A still (no screen time) never leaves.
        XCTAssertEqual(try alphas(c, cells, 10, nil), [1, 1, 1, 1])
    }

    func testMirrorsAnEntranceIntoAnExitTravellingBackAndReadsStoredMotion() throws {
        let mirrored = mirroredExit(CollageEnter(
            step: AnimStep(preset: .slide, duration: 0.4, easing: .out, direction: .up, delay: 1),
            stagger: Stagger(each: 0.1, order: .sequence)
        ))
        XCTAssertEqual(mirrored.step.direction, .down)
        XCTAssertNil(mirrored.step.delay)
        XCTAssertTrue(mirrored.reverse)
        // The stored half of this case is `CollageReaderTests`'s
        // `testReadsStoredMotionAnEntranceWithItsInsideAndRefusesAJunkExit`.
    }
}

final class CollageCellsTests: XCTestCase {
    func testCellZeroIsTheLeadAndTheRestAreTheList() throws {
        let c = withCollageCell(lead, try XCTUnwrap(createCollage("grid-2x2")), 2, CollageCellPatch(media: .some(ref("c.jpg")))).collage
        XCTAssertEqual(collageCellAt(lead, c, 0).media?.name, "lead.jpg")
        XCTAssertEqual(collageCellAt(lead, c, 2).media?.name, "c.jpg")
        XCTAssertNil(collageCellAt(lead, c, 9).media)
        XCTAssertEqual(collageMediaRefs(lead, c).map(\.name), ["lead.jpg", "c.jpg"])
    }

    func testWritesTheLeadThroughCellZero() throws {
        let out = withCollageCell(lead, try XCTUnwrap(createCollage("grid-2x2")), 0, CollageCellPatch(media: .some(ref("new.jpg"))))
        XCTAssertEqual(out.lead.media?.name, "new.jpg")
        XCTAssertEqual(out.collage.cells.count, 3)
    }

    func testSwapsPicturesFramingsAndDevelopsButNeverPlaces() throws {
        var c = try XCTUnwrap(createCollage("prints-3"))
        c = withCollageCell(lead, c, 1, CollageCellPatch(media: .some(ref("b.jpg")), place: CellPlace(dx: 0.1, dy: 0, rotation: 3))).collage
        let out = swapCollageCells(lead, c, 0, 1)
        XCTAssertEqual(out.lead.media?.name, "b.jpg")
        XCTAssertEqual(out.collage.cells[0].media?.name, "lead.jpg")
        XCTAssertEqual(out.collage.cells[0].place, CellPlace(dx: 0.1, dy: 0, rotation: 3))
        XCTAssertEqual(out.collage.place, CellPlace(dx: 0, dy: 0, rotation: 0))
    }

    func testCarriesAPicturesMotionWithItWhenTwoCellsSwap() throws {
        let c = withCollageCell(lead, try XCTUnwrap(createCollage("grid-2x2")), 1,
                                CollageCellPatch(media: .some(ref("b.jpg")), motion: .some(moving))).collage
        let out = swapCollageCells(lead, c, 0, 1)
        XCTAssertEqual(out.lead.motion, moving)
        XCTAssertNil(out.collage.cells[0].motion)
        XCTAssertEqual(withCollageCell(lead, c, 0, CollageCellPatch(motion: .some(moving))).lead.motion, moving)
    }

    func testMovesTheSlideOnlyWhenADrawnCellMoves() throws {
        var c = try XCTUnwrap(createCollage("bento-six"))
        c = withCollageCell(lead, c, 5, CollageCellPatch(media: .some(ref("six.jpg")), motion: .some(moving))).collage
        XCTAssertTrue(collageCellsMove(c))
        // Six down to four: cell 6 is kept and draws nothing, so nothing moves.
        XCTAssertFalse(collageCellsMove(retemplateCollage(c, "grid-2x2")))
        XCTAssertEqual(readCollage(c.json)?.cells[4].motion, moving)
    }

    func testKeepsPicturesPastASmallerTemplateAndPadsUpToABiggerOne() throws {
        var c = try XCTUnwrap(createCollage("bento-six"))
        c = withCollageCell(lead, c, 5, CollageCellPatch(media: .some(ref("six.jpg")))).collage
        let small = try XCTUnwrap(retemplateCollage(c, "grid-2x2"))
        XCTAssertEqual(small.cells.count, 5)
        XCTAssertEqual(collageKept(small), [KeptCollagePicture(cell: 6, media: ref("six.jpg"))])
        let big = try XCTUnwrap(retemplateCollage(small, "grid-3x3"))
        XCTAssertEqual(big.cells.count, 8)
        XCTAssertEqual(collageKept(big), [])
        XCTAssertNil(retemplateCollage(c, "nope"))
    }

    func testResolvesToItsTemplatesCellsAtAnyFrame() throws {
        let c = try XCTUnwrap(createCollage("stack-2"))
        let cells = resolveCollage(c, 1080, 1920)
        XCTAssertEqual(cells.count, 2)
        XCTAssertGreaterThan(cells[1].y, cells[0].y)
    }
}
