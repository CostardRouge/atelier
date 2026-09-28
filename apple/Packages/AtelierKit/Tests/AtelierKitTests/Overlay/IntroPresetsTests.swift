// A spec of its own for `src/shared/overlay/intro-presets.ts`, which has no
// web twin: the rules the presets keep.

import Foundation
import XCTest
@testable import AtelierKit

final class IntroPresetsTests: XCTestCase {
    func testLandsEveryPresetInTheIntroSceneWithAWindowRelativeToIt() {
        for preset in introPresets {
            let el = preset.create()
            XCTAssertEqual(el.sceneId, introSceneId, preset.id.rawValue)
            XCTAssertNotNil(el.window, preset.id.rawValue)
            XCTAssertNil(el.window?.end, "the scene decides when \(preset.id.rawValue) leaves")
            XCTAssertNotNil(el.animation?.inStep, preset.id.rawValue)
            XCTAssertNotNil(el.animation?.outStep, preset.id.rawValue)
        }
    }

    func testKeepsTheWebsIdsAndTheSubtitleAfterTheTitle() {
        XCTAssertEqual(introPresets.map(\.id.rawValue), ["hook-title", "subtitle", "question", "rotate-phone"])
        let title = introPreset(.hookTitle).create()
        let sub = introPreset(.subtitle).create()
        XCTAssertGreaterThan(sub.window?.start ?? 0, title.window?.start ?? 0)
        XCTAssertEqual(introPreset(.question).create().animation?.inStep?.preset, .typewriter)
        XCTAssertEqual(title.kind, .text)
        XCTAssertEqual(title.weight, 700)
    }

    func testMakesAFreshElementEachTime() {
        XCTAssertNotEqual(introPreset(.hookTitle).create().id, introPreset(.hookTitle).create().id)
    }
}
