// `layout-templates.ts` has no spec of its own on the web (its registry is
// walked by `media-layout.test.ts`, ported in `MediaLayoutTests.swift`). This
// one pins what a document depends on: the ids, their order on the shelf,
// their groups and their cell counts — a stored `SlideCollage.layout` names
// one of these strings.

import Foundation
import XCTest
@testable import AtelierKit

final class LayoutTemplatesTests: XCTestCase {
    func testKeepsTheWebsIdsInShelfOrder() {
        XCTAssertEqual(layoutTemplates.map(\.id), [
            "grid-2x2", "grid-2x3", "grid-3x3", "grid-1x4",
            "stack-2", "stack-3", "stack-tall", "stack-cols",
            "bento-hero", "bento-six", "bento-band", "bento-l",
            "inset-1", "inset-2",
            "prints-3", "prints-4",
        ])
        XCTAssertEqual(layoutGroups.map(\.rawValue), ["Grid", "Stack", "Bento", "Inset", "Free"])
    }

    func testGroupsEveryEntryUnderItsShelf() {
        for entry in layoutTemplates {
            let shelf: LayoutGroup
            switch entry.template.kind {
            case .tracks:
                shelf = entry.id.hasPrefix("grid-") ? .grid : entry.id.hasPrefix("stack-") ? .stack : .bento
            case .inset:
                shelf = .inset
            case .free:
                shelf = .free
            }
            XCTAssertEqual(entry.group, shelf, entry.id)
        }
    }

    func testAnswersTheCellCountOfEveryId() {
        let counts: [String: Int] = [
            "grid-2x2": 4, "grid-2x3": 6, "grid-3x3": 9, "grid-1x4": 4,
            "stack-2": 2, "stack-3": 3, "stack-tall": 2, "stack-cols": 2,
            "bento-hero": 4, "bento-six": 6, "bento-band": 5, "bento-l": 3,
            "inset-1": 2, "inset-2": 3,
            "prints-3": 3, "prints-4": 4,
        ]
        for (id, count) in counts {
            XCTAssertEqual(layoutCellCount(id), count, id)
            XCTAssertEqual(layoutTemplate(id)?.id, id)
        }
        XCTAssertNil(layoutTemplate(""))
        XCTAssertFalse(isLayoutId(nil))
    }

    func testKeepsTheTallTopAndTheBandsWeights() {
        guard case .tracks(_, let rows, _) = layoutTemplate("stack-tall")!.template else { return XCTFail("stack-tall is tracks") }
        XCTAssertEqual(rows, [3, 2])
        guard case .tracks(_, let band, _) = layoutTemplate("bento-band")!.template else { return XCTFail("bento-band is tracks") }
        XCTAssertEqual(band, [1, 1.3, 1])
        guard case .inset(let insets) = layoutTemplate("inset-2")!.template else { return XCTFail("inset-2 is inset") }
        XCTAssertEqual(insets.map(\.corner), [.tl, .br])
        XCTAssertEqual(insets.map(\.width), [0.34, 0.42])
    }
}
