// Port of `src/shared/overlay/scenes.test.ts`, plus the scene's JSON round trip.

import Foundation
import XCTest
@testable import AtelierKit

private func scene(_ change: (inout OverlayScene) -> Void = { _ in }) -> OverlayScene {
    var s = createIntroScene(end: 4)
    change(&s)
    return s
}

private func el(_ change: (inout OverlayElement) -> Void = { _ in }) -> OverlayElement {
    var e = createTextElement("Hook")
    change(&e)
    return e
}

final class ResolveWindowTests: XCTestCase {
    func testLeavesAnElementOutsideASceneOnItsOwnWindow() {
        XCTAssertEqual(resolveWindow(el { $0.window = TimeWindow(start: 2, end: 6) }, nil), TimeWindow(start: 2, end: 6))
        XCTAssertNil(resolveWindow(el(), nil))
    }

    func testGivesAnElementWithNoWindowOfItsOwnTheScenesWholeSpan() {
        let s = scene { $0.start = 1; $0.end = 4 }
        XCTAssertEqual(resolveWindow(el { $0.sceneId = "intro" }, s), TimeWindow(start: 1, end: 4))
    }

    func testReadsAnElementWindowInsideASceneAsAnOffsetIntoIt() {
        let s = scene { $0.start = 2; $0.end = 8 }
        XCTAssertEqual(resolveWindow(el { $0.window = TimeWindow(start: 1, end: 3) }, s), TimeWindow(start: 3, end: 5))
    }

    func testNeverLetsAnElementOutliveItsScene() {
        let s = scene { $0.start = 0; $0.end = 3 }
        XCTAssertEqual(resolveWindow(el { $0.window = TimeWindow(start: 1, end: 99) }, s), TimeWindow(start: 1, end: 3))
    }

    func testMovesTheWholeStaggerWhenTheSceneMoves() throws {
        let staggered = el { $0.window = TimeWindow(start: 0.5, end: 2) }
        let a = try XCTUnwrap(resolveWindow(staggered, scene { $0.start = 0; $0.end = 4 }))
        let b = try XCTUnwrap(resolveWindow(staggered, scene { $0.start = 1; $0.end = 5 }))
        assertClose(b.start - a.start, 1, 2)
        assertClose(try XCTUnwrap(b.end) - XCTUnwrap(a.end), 1, 2)
    }
}

final class ResolveScenesTests: XCTestCase {
    func testContributesNothingWithoutScenes() {
        XCTAssertEqual(resolveScenes(nil, 3), SceneRender(scrim: nil, outsideAlpha: 1))
        XCTAssertEqual(resolveScenes([], 3), SceneRender(scrim: nil, outsideAlpha: 1))
    }

    func testFadesTheScrimInAndOutAroundTheScene() throws {
        let s = scene { $0.start = 0; $0.end = 4; $0.scrim = SceneScrim(color: "#000", opacity: 0.8, fade: 1) }
        XCTAssertNil(resolveScenes([s], 0).scrim) // nothing yet at the very start
        assertClose(try XCTUnwrap(resolveScenes([s], 0.5).scrim).opacity, 0.4, 2)
        assertClose(try XCTUnwrap(resolveScenes([s], 2).scrim).opacity, 0.8, 2)
        assertClose(try XCTUnwrap(resolveScenes([s], 3.5).scrim).opacity, 0.4, 2)
        XCTAssertNil(resolveScenes([s], 4.5).scrim)
    }

    func testNeverLetsTheScrimFadeLongerThanHalfTheScene() throws {
        let s = scene { $0.start = 0; $0.end = 1; $0.scrim = SceneScrim(color: "#000", opacity: 1, fade: 10) }
        assertClose(try XCTUnwrap(resolveScenes([s], 0.5).scrim).opacity, 1, 2)
    }

    func testHoldsTheHudBackWhileASoloSceneRunsThenFadesItIn() {
        let s = scene { $0.start = 1; $0.end = 4; $0.solo = true; $0.hudFade = 1 }
        assertClose(resolveScenes([s], 0).outsideAlpha, 1, 2)
        assertClose(resolveScenes([s], 0.5).outsideAlpha, 0.5, 2)
        XCTAssertEqual(resolveScenes([s], 2).outsideAlpha, 0)
        assertClose(resolveScenes([s], 4.5).outsideAlpha, 0.5, 2)
        assertClose(resolveScenes([s], 6).outsideAlpha, 1, 2)
    }

    func testCutsTheHudBackInWithAZeroFade() {
        let s = scene { $0.start = 0; $0.end = 2; $0.solo = true; $0.hudFade = 0 }
        XCTAssertEqual(resolveScenes([s], 1).outsideAlpha, 0)
        XCTAssertEqual(resolveScenes([s], 2).outsideAlpha, 1)
    }

    func testLeavesTheHudAloneWhenSoloIsOff() {
        XCTAssertEqual(resolveScenes([scene { $0.solo = false }], 1).outsideAlpha, 1)
    }

    func testIgnoresAnEmptyScene() {
        let s = scene { $0.start = 2; $0.end = 2; $0.solo = true }
        XCTAssertEqual(resolveScenes([s], 2).outsideAlpha, 1)
    }

    func testTakesTheStrongestScrimAndTheDimmestHudWhenScenesOverlap() {
        let a = scene { $0.id = "a"; $0.start = 0; $0.end = 4; $0.scrim = SceneScrim(color: "#000", opacity: 0.3, fade: 0) }
        let b = scene {
            $0.id = "b"; $0.start = 1; $0.end = 3; $0.solo = true
            $0.scrim = SceneScrim(color: "#fff", opacity: 0.9, fade: 0)
        }
        let out = resolveScenes([a, b], 2)
        XCTAssertEqual(out.scrim, SceneScrimRender(color: "#fff", opacity: 0.9))
        XCTAssertEqual(out.outsideAlpha, 0)
    }
}

final class SceneCascadeTests: XCTestCase {
    private let members = [
        el { $0.id = "title"; $0.sceneId = "intro"; $0.x = 0.5; $0.y = 0.4; $0.sizeFrac = 0.1 },
        el { $0.id = "sub"; $0.sceneId = "intro"; $0.x = 0.5; $0.y = 0.5; $0.sizeFrac = 0.05 },
        el { $0.id = "hud"; $0.sceneId = nil; $0.x = 0.1; $0.y = 0.9; $0.sizeFrac = 0.03 },
    ]

    func testIsNothingWithoutAStaggerAndRanksTheMembersOnly() throws {
        XCTAssertEqual(sceneStaggerDelays(scene(), members, 9.0 / 16).count, 0)
        let delays = sceneStaggerDelays(scene { $0.stagger = Stagger(each: 0.3, order: .rows) }, members, 9.0 / 16)
        // The web's Map lists `title` then `sub`; a dictionary has no order, the entries are the same.
        XCTAssertEqual(delays.count, 2)
        XCTAssertEqual(delays["title"], 0)
        assertClose(try XCTUnwrap(delays["sub"]), 0.3, 9)
        XCTAssertNil(delays["hud"])
    }

    func testAddsToAnElementsOwnDelayAndGivesAPlainElementACutOnItsBeat() throws {
        let own = staggeredAnimation(ElementAnimation(in: AnimStep(preset: .fade, duration: 1, easing: .out, delay: 0.2)), 0.3)
        assertClose(try XCTUnwrap(own?.inStep?.delay), 0.5, 2)
        XCTAssertEqual(own?.inStep?.preset, .fade)
        let cut = staggeredAnimation(nil, 0.3)
        XCTAssertEqual(cut?.inStep, AnimStep(preset: .none, duration: 0, easing: .linear, delay: 0.3))
        XCTAssertNil(staggeredAnimation(nil, 0))
    }
}

final class SceneJSONTests: XCTestCase {
    func testRoundTripsAStoredScene() throws {
        let raw: JSONValue = [
            "id": "intro", "name": "Introduction", "start": 0, "end": 3,
            "scrim": ["color": "#0b0a09", "opacity": 0.55, "fade": 0.4],
            "solo": true, "hudFade": 0.5, "stagger": ["each": 0.3, "order": "rows"],
            "future": ["kept": true],
        ]
        let s = try XCTUnwrap(readOverlayScene(raw))
        XCTAssertEqual(s.staggerValue, Stagger(each: 0.3, order: .rows))
        XCTAssertEqual(s.scrim, SceneScrim.default)
        XCTAssertEqual(s.carried["future"], ["kept": true])
        XCTAssertEqual(s.json, raw)
    }

    func testKeepsANullStaggerAndAnOffScrimAsWritten() throws {
        let raw: JSONValue = [
            "id": "intro", "name": "Introduction", "start": 0, "end": 3, "scrim": nil, "solo": false,
            "hudFade": 0.5, "stagger": nil,
        ]
        let s = try XCTUnwrap(readOverlayScene(raw))
        XCTAssertNil(s.staggerValue)
        XCTAssertEqual(s.json, raw)
        XCTAssertNil(readOverlayScene(["name": "no id"]))
    }

    func testFindsASceneById() {
        XCTAssertEqual(findScene([createIntroScene()], "intro")?.name, "Introduction")
        XCTAssertNil(findScene([createIntroScene()], nil))
        XCTAssertNil(findScene(nil, "intro"))
    }
}
