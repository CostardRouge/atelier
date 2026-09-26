// The stored half of `src/shared/roadtrip/badge-layout.ts`: the reading of a
// cascade from `badge-layout.test.ts` (its settle time waits for the
// behaviour's port), the hook's two durations, and a piece style's writer
// keeping "absent" and "null" apart.

import XCTest
@testable import AtelierKit

final class BadgeLayoutStoredTests: XCTestCase {
    func testReadsJunkAsNoCascadeAndAJunkStepAsAPlainFade() throws {
        XCTAssertNil(readCascade(nil))
        XCTAssertNil(readCascade(["stagger": [:]]))
        let read = try XCTUnwrap(readCascade([
            "step": ["preset": "zoom", "duration": -1, "easing": "wobble"],
            "stagger": ["order": "rows"],
        ]))
        XCTAssertEqual(read.step, AnimStep(preset: .fade, duration: 0, easing: .out))
        XCTAssertEqual(read.stagger, Stagger(each: 0.1, order: .rows))
    }

    func testAStepReadForTheBadgeKeepsNoDelayUnlikeAnOverlayElementsStep() throws {
        let raw: JSONValue = ["preset": "slide", "duration": 0.4, "easing": "out", "delay": 2, "inside": true]
        XCTAssertNil(readAnimStep(raw).delay)
        XCTAssertNil(readAnimStep(raw).inside)
        XCTAssertEqual(AnimStep(json: raw)?.delay, 2)
    }

    func testANewHookLastsTwoSecondsAndAStoredOneThatNeverSaidReadsFour() {
        XCTAssertEqual(defaultBadgeDuration, 2)
        XCTAssertEqual(legacyBadgeDuration, 4)
        XCTAssertEqual(defaultBadgeLayout, BadgeLayout(anchor: .bottomLeft, x: 0.07, y: 0.9, sizeFrac: 0.17))
    }

    func testAPieceStyleWritesBackAbsentAsAbsentAndNullAsNull() {
        let stored: JSONValue = [
            "textCase": "upper", "color": nil, "boxColor": "#000000", "boxPadFrac": 0.3,
            "animation": ["in": ["preset": "fade", "duration": 0.5, "easing": "out"], "out": nil],
        ]
        let style = readBadgePieceStyle(stored)
        XCTAssertEqual(style.color, .some(nil))
        XCTAssertTrue(style.borderColor == nil)
        XCTAssertEqual(style.json, stored)
    }

    func testPieceStylesKeepOnlyThePiecesTheBadgeHas() {
        let styles = readBadgePieceStyles(["headline": ["textCase": "lower"], "footer": ["textCase": "upper"], "caption": 3])
        XCTAssertEqual(Array(styles.keys), [.headline])
        XCTAssertEqual(badgePieceStylesJSON(styles), ["headline": ["textCase": "lower"]])
    }
}
