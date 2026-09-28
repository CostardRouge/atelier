// The stored half of `src/shared/roadtrip/hooks/hook-variant.ts`: the
// `defaults` cases of `hook-variant.test.ts` (the registry and the fold wait
// for the behaviour's port), and the layer list's reader.

import XCTest
@testable import AtelierKit

final class HookVariantStoredTests: XCTestCase {
    func testStartsEveryPieceOnTheBadgeAsAListOfOne() {
        XCTAssertEqual(defaultHookLayers(), [HookLayer(id: defaultHookId, options: [:])])
    }

    func testHandsBackAFreshListSoOnePieceCannotAliasAnother() {
        var a = defaultHookLayers()
        let b = defaultHookLayers()
        a[0].options["mode"] = "run-up"
        XCTAssertEqual(b[0].options, [:])
    }

    func testMergesStoredOptionsOverAVariantsDefaults() {
        XCTAssertEqual(readOptions(["mode": "run-up"], ["mode": "from-start", "stops": 12]), ["mode": "run-up", "stops": 12])
    }

    func testAStoredListKeepsEveryLayerAndItsOptionsVerbatim() {
        let stored: JSONValue = [
            ["id": "scrub", "options": ["mode": "run-up", "future": ["a": 1]]],
            ["id": "from-a-newer-build", "options": [:]],
            "junk",
            ["options": [:]],
        ]
        let layers = readHookLayers(stored)
        XCTAssertEqual(layers.map(\.id), ["scrub", "from-a-newer-build"])
        XCTAssertEqual(layers[0].json, ["id": "scrub", "options": ["mode": "run-up", "future": ["a": 1]]])
    }
}
