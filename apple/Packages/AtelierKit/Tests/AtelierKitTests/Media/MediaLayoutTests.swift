// Port of `src/shared/media/media-layout.test.ts` — the geometry and the
// registry walk; the registry's own rules are in `LayoutTemplatesTests.swift`.

import Foundation
import XCTest
@testable import AtelierKit

private let noSpacing = LayoutSpacing(gap: 0, padding: 0, radius: 0)

/// The web's `toMatchObject` over a cell's placement.
private func assertCell(_ c: CellRect, x: Double, y: Double, w: Double, h: Double,
                        file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(c.x, x, "x", file: file, line: line)
    XCTAssertEqual(c.y, y, "y", file: file, line: line)
    XCTAssertEqual(c.width, w, "w", file: file, line: line)
    XCTAssertEqual(c.height, h, "h", file: file, line: line)
}

final class ParseAreasTests: XCTestCase {
    func testReadsBoxesInReadingOrderLetterOrderBeingTheCellOrder() {
        let boxes = parseAreas("a a b / a a c / d d c")
        XCTAssertEqual(boxes?.map(\.id), ["a", "b", "c", "d"])
        XCTAssertEqual(boxes?[0], AreaBox(id: "a", r0: 0, r1: 1, c0: 0, c1: 1))
        XCTAssertEqual(boxes?[2], AreaBox(id: "c", r0: 1, r1: 2, c0: 2, c1: 2))
    }

    func testSkipsADotAsAnEmptyTrackCell() {
        XCTAssertEqual(parseAreas("a . / . b")?.map(\.id), ["a", "b"])
    }

    func testRefusesRaggedRowsAnEmptyStringAndANonRectangularArea() {
        XCTAssertNil(parseAreas("a b / c"))
        XCTAssertNil(parseAreas(""))
        XCTAssertNil(parseAreas(". ."))
        // An L-shaped 'a' is not one rectangle: refused, never guessed.
        XCTAssertNil(parseAreas("a a / a b"))
    }
}

final class ResolveTracksTests: XCTestCase {
    func testCutsA2x2GridWithGapAndPaddingInShortSideFractions() {
        let t = LayoutTemplate.tracks(cols: [1, 1], rows: [1, 1], areas: "a b / c d")
        let cells = resolveLayout(t, 1000, 2000, LayoutSpacing(gap: 0.02, padding: 0.05, radius: 0))
        // short side 1000: gap 20, padding 50.
        XCTAssertEqual(cells.count, 4)
        assertCell(cells[0], x: 50, y: 50, w: 440, h: 940)
        XCTAssertEqual(cells[0].rotation, 0)
        XCTAssertEqual(cells[0].mount, .none)
        assertCell(cells[1], x: 510, y: 50, w: 440, h: 940)
        assertCell(cells[3], x: 510, y: 1010, w: 440, h: 940)
    }

    func testSpansAnAreaOverTheTracksItNamesGapsIncluded() {
        let t = LayoutTemplate.tracks(cols: [1, 1, 1], rows: [1, 1, 1], areas: "a a b / a a c / d d c")
        let cells = resolveLayout(t, 900, 900, LayoutSpacing(gap: 0.1, padding: 0, radius: 0))
        // Tracks are (900 − 2·90) / 3 = 240 wide, 90 apart.
        assertCell(cells[0], x: 0, y: 0, w: 570, h: 570)
        assertCell(cells[1], x: 660, y: 0, w: 240, h: 240)
        assertCell(cells[2], x: 660, y: 330, w: 240, h: 570)
        assertCell(cells[3], x: 0, y: 660, w: 570, h: 240)
    }

    func testSharesATrackByWeight() {
        let t = LayoutTemplate.tracks(cols: [1], rows: [3, 2], areas: "a / b")
        let cells = resolveLayout(t, 500, 1000, noSpacing)
        assertClose(cells[0].height, 600, 2)
        assertClose(cells[1].y, 600, 2)
        assertClose(cells[1].height, 400, 2)
    }

    func testResolvesToTheSameFractionsAtTheStageSizeAndTheExportSize() {
        let t = layoutTemplate("bento-six")!.template
        let small = resolveLayout(t, 405, 720)
        let big = resolveLayout(t, 1215, 2160)
        for (i, c) in small.enumerated() {
            assertClose(big[i].x / 3, c.x, 6)
            assertClose(big[i].y / 3, c.y, 6)
            assertClose(big[i].width / 3, c.width, 6)
            assertClose(big[i].height / 3, c.height, 6)
        }
    }

    func testYieldsNoCellsForATemplateWhoseAreasDoNotParse() {
        let t = LayoutTemplate.tracks(cols: [1, 1], rows: [1], areas: "a a / a b")
        XCTAssertEqual(resolveLayout(t, 100, 100), [])
        XCTAssertEqual(cellCount(t), 0)
    }
}

final class ResolveInsetAndFreeTests: XCTestCase {
    func testLaysAnInsetInItsCornerOverTheFullCellFramed() {
        let t = LayoutTemplate.inset(insets: [InsetSpec(corner: .br, width: 0.5, aspect: 1)])
        let cells = resolveLayout(t, 1000, 2000, noSpacing)
        let full = cells[0], pip = cells[1]
        assertCell(full, x: 0, y: 0, w: 1000, h: 2000)
        XCTAssertEqual(full.mount, .none)
        XCTAssertEqual(pip.width, 500)
        XCTAssertEqual(pip.height, 500)
        XCTAssertEqual(pip.mount, .stroke)
        // margin = max(gap 0, 3.5% of the short side) = 35
        assertClose(pip.x, 1000 - 35 - 500, 2)
        assertClose(pip.y, 2000 - 35 - 500, 2)
    }

    func testPlacesAPrintAtItsCentreTurnedAndMovesItByItsPlace() {
        let t = LayoutTemplate.free(prints: [PrintSpec(cx: 0.5, cy: 0.5, width: 0.5, aspect: 1, rotation: -6)])
        let rest = resolveLayout(t, 1000, 2000, noSpacing)[0]
        assertCell(rest, x: 250, y: 750, w: 500, h: 500)
        XCTAssertEqual(rest.rotation, -6)
        XCTAssertEqual(rest.mount, .print)
        let moved = resolveLayout(t, 1000, 2000, noSpacing, [CellPlace(dx: 0.1, dy: -0.1, rotation: 4)])[0]
        assertClose(moved.x, 350, 2)
        assertClose(moved.y, 550, 2)
        XCTAssertEqual(moved.rotation, -2)
    }

    func testCapsAPrintAtAThirdOfTheFrameHeightKeepingItsShape() {
        let t = LayoutTemplate.free(prints: [PrintSpec(cx: 0.5, cy: 0.5, width: 0.9, aspect: 0.5, rotation: 0)])
        let p = resolveLayout(t, 1000, 1000, noSpacing)[0]
        assertClose(p.height, 360, 2)
        assertClose(p.width, 180, 2)
    }

    func testIgnoresAPlaceKeptFromABiggerLayout() {
        let t = layoutTemplate("prints-3")!.template
        let places: [CellPlace?] = [nil, nil, nil, CellPlace(dx: 0.3, dy: 0.3, rotation: 10)]
        XCTAssertEqual(resolveLayout(t, 900, 1600, noSpacing, places).count, 3)
    }
}

final class LayoutRegistryTests: XCTestCase {
    private func inside(_ c: CellRect, _ w: Double, _ h: Double) -> Bool {
        c.x >= -1e-6 && c.y >= -1e-6 && c.x + c.width <= w + 1e-6 && c.y + c.height <= h + 1e-6
    }

    func testResolvesEveryTemplateInsideA916A45AndA11Frame() {
        for entry in layoutTemplates {
            let frames: [(Double, Double)] = [(1080, 1920), (1080, 1350), (1080, 1080)]
            for (w, h) in frames {
                let cells = resolveLayout(entry.template, w, h)
                XCTAssertEqual(cells.count, cellCount(entry.template), entry.id)
                XCTAssertGreaterThan(cells.count, 1, entry.id)
                for c in cells {
                    XCTAssertGreaterThan(c.width, 0, entry.id)
                    XCTAssertGreaterThan(c.height, 0, entry.id)
                    // A tilted print's corners may poke out; its box must not.
                    if entry.template.kind != .free {
                        XCTAssertTrue(inside(c, w, h), "\(entry.id) at \(w)×\(h)")
                    }
                }
            }
        }
    }

    func testHasUniqueIdsAndAnswersThem() {
        let ids = layoutTemplates.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertTrue(isLayoutId("bento-six"))
        XCTAssertFalse(isLayoutId("bento-seven"))
        XCTAssertEqual(layoutCellCount("grid-3x3"), 9)
        XCTAssertEqual(layoutCellCount("nope"), 0)
        XCTAssertNil(layoutTemplate(nil))
    }
}

final class CellAtTests: XCTestCase {
    func testFindsTheCellUnderAPointTheLastDrawnWinning() {
        let t = layoutTemplate("inset-1")!.template
        let cells = resolveLayout(t, 1000, 2000, noSpacing)
        XCTAssertEqual(cellAt(cells, 10, 10), 0)
        XCTAssertEqual(cellAt(cells, 900, 1900), 1)
        XCTAssertEqual(cellAt(cells, -5, 10), -1)
    }

    func testHonoursAPrintsTilt() {
        let cells = [CellRect(x: 0, y: 0, width: 100, height: 20, rotation: 90, mount: .print)]
        // Turned a quarter, the box stands 20 wide and 100 tall about (50, 10).
        XCTAssertEqual(cellAt(cells, 50, 55), 0)
        XCTAssertEqual(cellAt(cells, 95, 10), -1)
    }
}

final class LayoutNormaliserTests: XCTestCase {
    func testReadsASpacingOutOfJunkAndClampsIt() {
        XCTAssertEqual(normaliseSpacing(nil), LayoutSpacing(gap: 0.012, padding: 0.016, radius: 0.016))
        XCTAssertEqual(normaliseSpacing(["gap": -1, "padding": 9, "radius": "x"]),
                       LayoutSpacing(gap: 0, padding: 0.2, radius: 0.016))
    }

    func testClampsAPlaceToWhatAPrintMayTravel() {
        XCTAssertEqual(normaliseCellPlace(["dx": 2, "dy": -2, "rotation": 90]), CellPlace(dx: 0.4, dy: -0.4, rotation: 30))
        XCTAssertEqual(normaliseCellPlace(.null), CellPlace(dx: 0, dy: 0, rotation: 0))
    }

    // Not in the web spec: the writers are the readers' inverse.
    func testWritesWhatItReads() {
        let spacing = LayoutSpacing(gap: 0.03, padding: 0.1, radius: 0.05)
        XCTAssertEqual(normaliseSpacing(spacing.json), spacing)
        let place = CellPlace(dx: -0.2, dy: 0.1, rotation: 12)
        XCTAssertEqual(normaliseCellPlace(place.json), place)
    }
}
