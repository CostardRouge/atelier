// Port of `src/shared/ui/menu-anchor.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let viewport = Size(1280, 800)
private let menu = Size(192, 140)

/// A ⋯ button near the top-left of a gallery card, overridden per case.
private func input(trigger: AnchorRect = AnchorRect(left: 300, right: 328, top: 200, bottom: 228),
                   menu: Size = menu, viewport: Size = viewport,
                   side: MenuSide = .below, align: MenuAlign = .end) -> MenuAnchorInput {
    MenuAnchorInput(trigger: trigger, menu: menu, viewport: viewport, side: side, align: align)
}

final class MenuAnchorTests: XCTestCase {
    func testOpensBelowTheTriggerItsRightEdgeOnTheTriggers() {
        let a = menuAnchor(input())
        XCTAssertEqual(a.placed, .below)
        XCTAssertEqual(a.top, 234) // 228 + 6
        XCTAssertEqual(a.left, 328 - 192)
    }

    func testLinesItsLeftEdgeUpWhenAskedToAlignAtTheStart() {
        XCTAssertEqual(menuAnchor(input(align: .start)).left, 300)
    }

    func testFlipsAboveWhenTheBottomOfTheScreenCannotHoldIt() {
        let a = menuAnchor(input(trigger: AnchorRect(left: 300, right: 328, top: 700, bottom: 728)))
        XCTAssertEqual(a.placed, .above)
        XCTAssertEqual(a.top, 700 - 6 - 140)
    }

    func testFlipsBelowWhenTheTopCannotHoldIt() {
        let a = menuAnchor(input(trigger: AnchorRect(left: 300, right: 328, top: 40, bottom: 68), side: .above))
        XCTAssertEqual(a.placed, .below)
        XCTAssertEqual(a.top, 74)
    }

    func testStaysOnTheAskedSideWhenNeitherFitsAndScrollsInstead() {
        let a = menuAnchor(input(trigger: AnchorRect(left: 300, right: 328, top: 380, bottom: 408),
                                 menu: Size(192, 900)))
        XCTAssertEqual(a.placed, .below)
        XCTAssertEqual(a.maxHeight, 800 - 8 - 408 - 6)
        XCTAssertGreaterThanOrEqual(a.top, 8)
    }

    func testSlidesBackInFromTheRightEdgeRatherThanHangingOffIt() {
        let a = menuAnchor(input(trigger: AnchorRect(left: 1250, right: 1276, top: 200, bottom: 228)))
        XCTAssertEqual(a.left, 1280 - 8 - 192)
    }

    func testSlidesBackInFromTheLeftEdge() {
        let a = menuAnchor(input(trigger: AnchorRect(left: 4, right: 32, top: 200, bottom: 228), align: .end))
        XCTAssertEqual(a.left, 8)
    }

    func testGivesUpTheMarginRatherThanTheMenuWhenItIsWiderThanTheScreen() {
        let a = menuAnchor(input(menu: Size(400, 140), viewport: Size(360, 800)))
        XCTAssertEqual(a.left, 8)
    }

    func testKeepsAFloorOfRoomOnAShortViewportNeverANegativeHeight() {
        let a = menuAnchor(input(trigger: AnchorRect(left: 20, right: 48, top: 270, bottom: 296),
                                 viewport: Size(360, 300)))
        XCTAssertGreaterThan(a.maxHeight, 0)
        XCTAssertGreaterThanOrEqual(a.top, 8)
        XCTAssertLessThanOrEqual(a.top + min(140, a.maxHeight), 300 - 8 + 1)
    }
}
