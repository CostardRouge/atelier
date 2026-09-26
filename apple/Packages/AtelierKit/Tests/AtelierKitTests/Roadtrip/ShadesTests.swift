// The stored half of `src/shared/roadtrip/shades.ts`: the cases of
// `shades.test.ts` that pin the factories (the gradient's own cases wait for
// the behaviour's port), plus the reader's rules — the optional fields absent
// stay absent, an unknown key is carried, a junk strength draws nothing.

import XCTest
@testable import AtelierKit

final class ShadeFactoryTests: XCTestCase {
    func testTheVignetteIsARadialInvertedDarkAtTheCorners() {
        // The web also reads its gradient's first stop (clear in the middle):
        // `shadeGradient` is the behaviour, ported later into `Shades.swift`.
        let v = vignetteShade(0.5)
        XCTAssertEqual(v.direction, .radial)
        XCTAssertTrue(v.invert)
        XCTAssertEqual(v.reach, 1)
        XCTAssertEqual(v.strength, 0.5)
    }

    func testTheVignetteTakesAColourBecauseBlackIsAChoiceAndNotALaw() {
        XCTAssertEqual(vignetteShade(0.5, color: "#1b1813").color, "#1b1813")
    }

    func testGivesEveryShadeItsOwnId() {
        XCTAssertNotEqual(createShade().id, createShade().id)
    }

    func testLeavesRoomForAHandfulNotAPaintJob() {
        XCTAssertGreaterThan(maxShades, 1)
        XCTAssertLessThan(maxShades, 9)
    }

    func testANewShadeSaysItFollowsNoAnchorAndIsOn() {
        let o = createShade(id: "s").json.objectValue ?? [:]
        XCTAssertEqual(o["followAnchor"], false)
        XCTAssertEqual(o["enabled"], true)
        XCTAssertNil(o["falloff"])
        XCTAssertNil(o["core"])
        XCTAssertNil(o["center"])
    }
}

final class ShadeReaderTests: XCTestCase {
    func testAShadeStoredBeforeTheOptionalFieldsReadsBackWithoutThem() throws {
        let stored: JSONValue = [
            "id": "a", "direction": "top", "reach": 0.5, "strength": 0.4, "color": "#101010",
            "invert": false, "followHook": true,
        ]
        let shade = try XCTUnwrap(readShade(stored))
        XCTAssertNil(shade.followAnchor)
        XCTAssertNil(shade.enabled)
        XCTAssertNil(shade.falloff)
        XCTAssertEqual(shade.json, stored)
    }

    func testTheFadesShapeReadsBack() throws {
        let stored: JSONValue = [
            "id": "b", "direction": "middle-vertical", "reach": 1, "strength": 0.9, "color": "#000000", "invert": false,
            "followHook": false, "followAnchor": false, "enabled": true, "falloff": "in-out", "core": 0.3,
            "center": ["x": 0.5, "y": 0.62],
        ]
        let shade = try XCTUnwrap(readShade(stored))
        XCTAssertEqual(shade.falloff, .inOut)
        XCTAssertEqual(shade.core, 0.3)
        XCTAssertEqual(shade.center, Point(0.5, 0.62))
        XCTAssertEqual(shade.json, stored)
    }

    func testCarriesAKeyItDoesNotKnow() throws {
        let stored: JSONValue = [
            "id": "c", "direction": "radial", "reach": 1, "strength": 0.4, "color": "#000000",
            "invert": true, "followHook": false, "feather": 0.2,
        ]
        XCTAssertEqual(try XCTUnwrap(readShade(stored)).json, stored)
    }

    func testAStrengthOrAReachThatIsNotANumberDrawsNothingAsOnTheWeb() throws {
        let shade = try XCTUnwrap(readShade(["id": "d", "strength": "0.5"]))
        XCTAssertEqual(shade.strength, 0)
        XCTAssertEqual(shade.reach, 0)
        XCTAssertEqual(shade.direction, .bottom)
    }

    func testMintsAnIdForAShadeThatHasNoneAndDropsWhatIsNotAShade() {
        let shades = readShades([["direction": "left"], "junk", nil], makeId: { "minted" })
        XCTAssertEqual(shades.map(\.id), ["minted"])
    }
}
