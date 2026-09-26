// The stored half of `src/shared/roadtrip/collage.ts`: the cases of
// `collage.test.ts` that create and read a collage (the rest — the cells'
// rects, their motion, re-templating, swapping — wait for the behaviour's
// port), and the writer's round trip.

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
