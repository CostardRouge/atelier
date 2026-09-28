// Port of `src/shared/overlay/still-frame.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func timed() -> OverlayElement {
    var el = createTextElement("Hook")
    el.window = TimeWindow(start: 0, end: 2.5)
    el.animation = ElementAnimation(
        in: AnimStep(preset: .slide, duration: 0.6, easing: .out),
        out: AnimStep(preset: .fade, duration: 0.4, easing: .in)
    )
    el.sceneId = "intro"
    return el
}

final class SettleForStillTests: XCTestCase {
    func testDropsTheClockAnElementDependsOn() {
        let el = settleForStill([timed()])[0]
        XCTAssertNil(el.window)
        XCTAssertNil(el.animation)
        XCTAssertNil(el.sceneId)
    }

    func testKeepsEverythingElseAboutTheElement() {
        let source = timed()
        let el = settleForStill([source])[0]
        XCTAssertEqual(el.id, source.id)
        XCTAssertEqual(el.text, "Hook")
        XCTAssertEqual(el.x, source.x)
        XCTAssertEqual(el.y, source.y)
        XCTAssertEqual(el.sizeFrac, source.sizeFrac)
    }

    func testReturnsTheSameDeckWhenNothingIsTimed() {
        // The web checks identity (`toBe`); a Swift array is a value, so equality.
        let deck = [createTextElement("A"), createTextElement("B")]
        XCTAssertEqual(settleForStill(deck), deck)
    }

    func testLeavesUntimedNeighboursIdenticalWhileSettlingTheTimedOne() {
        let plain = createTextElement("Plain")
        let out = settleForStill([plain, timed()])
        XCTAssertEqual(out[0], plain)
        XCTAssertNil(out[1].window)
    }
}
