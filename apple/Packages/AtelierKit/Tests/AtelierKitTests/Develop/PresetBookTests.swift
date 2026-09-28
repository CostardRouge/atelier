// Port of `src/shared/develop/develop-presets.test.ts`,
// `src/shared/develop/preset-book.test.ts` and
// `src/shared/develop/preset-book-remote.test.ts`.

import XCTest
@testable import AtelierKit

private let lifted = dev { $0.exposure = 0.5; $0.shadows = 20 }
private func light(_ exposure: Double) -> DevelopSettings { dev { $0.exposure = exposure } }
private func preset(_ id: String, _ name: String, _ exposure: Double = 0.5) -> DevelopPreset {
    DevelopPreset(id: id, name: name, settings: light(exposure))
}
private func presetJSON(_ id: String, _ name: String, _ exposure: Double = 0.5) -> JSONValue {
    ["id": .string(id), "name": .string(name), "settings": light(exposure).json]
}

// MARK: - develop-presets.test.ts

final class SavePresetInTests: XCTestCase {
    func testAddsACopyUnderATrimmedName() {
        let list = savePresetIn([], "  Desert noon ", lifted, "p1")
        XCTAssertEqual(list, [DevelopPreset(id: "p1", name: "Desert noon", settings: lifted)])
        // A value is a copy by construction: the web's `not.toBe(lifted)` holds here for free.
    }

    func testReplacesANameAlreadyTakenInPlaceKeepingItsIdAndPosition() {
        var list = savePresetIn([], "Dusk", lifted, "p1")
        list = savePresetIn(list, "Noon", lifted, "p2")
        list = savePresetIn(list, "Dusk", dev { $0.blacks = -6 }, "p3")
        XCTAssertEqual(list.map { "\($0.id) \($0.name)" }, ["p1 Dusk", "p2 Noon"])
        XCTAssertEqual(list[0].settings.blacks, -6)
    }

    func testTreatsANameAsTakenHoweverItIsCasedKeepingTheNewSpelling() {
        let list = savePresetIn(savePresetIn([], "Dusk", lifted, "p1"), "dusk", dev { $0.blacks = -4 }, "p2")
        XCTAssertEqual(list.map { "\($0.id) \($0.name) \($0.settings.blacks)" }, ["p1 dusk -4.0"])
    }

    func testHandsBackTheSameListForABlankNameOrAnAsShotDevelop() {
        let list = savePresetIn([], "Dusk", lifted, "p1")
        XCTAssertEqual(savePresetIn(list, "   ", lifted, "p2"), list)
        XCTAssertEqual(savePresetIn(list, "Zeros", .default, "p2"), list)
        XCTAssertEqual(savePresetIn(list, "Nothing", nil, "p2"), list)
    }

    func testNeverKeepsAMaterial() {
        let onRaw = dev { $0.exposure = 0.5; $0.base = .gain; $0.rawGain = 2 }
        let list = savePresetIn([], "Raw", onRaw, "p1")
        XCTAssertNil(list[0].settings.base)
        XCTAssertNil(list[0].settings.rawGain)
    }
}

final class RemovePresetFromTests: XCTestCase {
    func testDropsThePresetOrHandsBackTheSameListWhenItIsNotThere() {
        let list = savePresetIn([], "Dusk", lifted, "p1")
        XCTAssertEqual(removePresetFrom(list, "p1"), [])
        XCTAssertEqual(removePresetFrom(list, "nope"), list)
    }
}

// MARK: - preset-book.test.ts

final class PresetBookTests: XCTestCase {
    func testStartsEmptyOnThisDeviceHavingMergedNoTrip() {
        XCTAssertEqual(createPresetBook("b1", now: 10),
                       PresetBook(id: "b1", version: 1, sourceId: "local", updatedAt: 10, presets: [], mergedTripIds: []))
    }

    func testSavesAndRemovesThroughTheSharedListRules() {
        var book = savePresetInBook(createPresetBook("b1", now: 0), "Desert noon", light(0.7), "p1", now: 5)
        XCTAssertEqual(book.presets.map(\.name), ["Desert noon"])
        XCTAssertEqual(book.updatedAt, 5)
        XCTAssertEqual(savePresetInBook(book, "Zeros", .default, "p2", now: 6), book)
        book = removePresetFromBook(book, "p1", now: 7)
        XCTAssertEqual(book.presets, [])
        XCTAssertEqual(removePresetFromBook(book, "p1", now: 8), book)
    }

    func testReadsAStoredBookSafelyJunkDroppedOnePresetPerName() {
        let book = readPresetBook([
            "id": "b1",
            "sourceId": "winnow.example",
            "updatedAt": 3,
            "presets": [presetJSON("p1", "Dusk"), ["id": "x"], presetJSON("p2", " dusk ", 1), presetJSON("p3", "Noon")],
            "mergedTripIds": ["t1", 4],
        ])!
        XCTAssertEqual(book.presets.map(\.id), ["p1", "p3"])
        XCTAssertEqual(book.mergedTripIds, ["t1"])
        XCTAssertEqual(book.sourceId, "winnow.example")
        XCTAssertNil(readPresetBook(["presets": []]))
        XCTAssertNil(readPresetBook([]))
    }

    func testLeavesWithoutItsSource() {
        XCTAssertNil(bookToWire(createPresetBook("b1")).objectValue?["sourceId"])
        XCTAssertNotNil(createPresetBook("b1").json.objectValue?["sourceId"])
    }
}

final class MergeTripPresetsTests: XCTestCase {
    func testBringsATripsPresetsInTheBooksOwnNumbersWinningOnAName() {
        let book = savePresetInBook(createPresetBook("b1", now: 0), "Dusk", light(-1), "mine", now: 1)
        let merged = mergeTripPresets(book, [(id: "t1", developPresets: [preset("a", "dusk", 2), preset("b", "Blue hour", 0.3)])], now: 9)
        XCTAssertEqual(merged.presets.map { "\($0.name) \($0.settings.exposure)" }, ["Dusk -1.0", "Blue hour 0.3"])
        XCTAssertEqual(merged.mergedTripIds, ["t1"])
    }

    func testNeverBringsBackAPresetDeletedAfterItsTripWasMerged() {
        var book = mergeTripPresets(createPresetBook("b1", now: 0), [(id: "t1", developPresets: [preset("a", "Dusk")])], now: 1)
        book = removePresetFromBook(book, "a", now: 2)
        XCTAssertEqual(mergeTripPresets(book, [(id: "t1", developPresets: [preset("a", "Dusk")])], now: 3), book)
    }
}

final class MergeBooksTests: XCTestCase {
    func testKeepsTheServersOrderAndRowTheLocalCopyOfANameWinningLocalOnlyNamesAppended() {
        var server = createPresetBook("server-id", now: 1, sourceId: "winnow.example")
        server.presets = [preset("s1", "Dusk", 1), preset("s2", "Noon", 2)]
        server.mergedTripIds = ["t1"]
        var local = createPresetBook("local-id", now: 1, sourceId: "winnow.example")
        local.presets = [preset("l1", "noon", 5), preset("l2", "Night", 3)]
        local.mergedTripIds = ["t2"]
        let merged = mergeBooks(local, server, now: 9)
        XCTAssertEqual(merged.id, "server-id")
        XCTAssertEqual(merged.presets.map { "\($0.name) \($0.settings.exposure)" }, ["Dusk 1.0", "noon 5.0", "Night 3.0"])
        XCTAssertEqual(merged.mergedTripIds.sorted(), ["t1", "t2"])
    }
}

final class PresetBookIdentityTests: XCTestCase {
    func testIsReadWrittenOnceAndSurvivesAMergeTheEditedCopyWinning() {
        let book = createPresetBook("b", now: 1)
        XCTAssertNil(readPresetBook(book.json)!.identity)
        let signed = withIdentity(book, DeliveryIdentity(creator: " Steeve Pommier ", copyright: ""), now: 2)
        XCTAssertEqual(signed.identity, DeliveryIdentity(creator: "Steeve Pommier", copyright: "© {year} {creator}. All rights reserved."))
        XCTAssertEqual(signed.updatedAt, 2)
        XCTAssertEqual(withIdentity(signed, DeliveryIdentity(creator: "Steeve Pommier", copyright: "© {year} {creator}. All rights reserved.")), signed)
        XCTAssertEqual(readPresetBook(JSONValue.parse(signed.json.serialized()))!.identity, signed.identity)

        let other = withIdentity(createPresetBook("s", now: 1), DeliveryIdentity(creator: "Other", copyright: "x"), now: 1)
        XCTAssertEqual(mergeBooks(signed, other).identity?.creator, "Steeve Pommier")
        XCTAssertEqual(mergeBooks(book, other).identity?.creator, "Other")
        XCTAssertNil(mergeBooks(book, createPresetBook("s", now: 1)).identity)
    }
}

final class PresetLookTests: XCTestCase {
    private let look: JSONValue = [
        "layers": [["id": "classic-black-and-white", "source": "builtin", "name": "B&W", "customText": nil, "intensity": 0.8, "enabled": true]],
        "output": "none",
        "film": nil,
    ]

    func testIsSavedWithItsLookALookAloneIncludedAndReadBackFromTheBook() {
        let book = createPresetBook("b", now: 1)
        let withLook = savePresetInBook(book, "Mono", dev { $0.exposure = 0.3 }, "p1", now: 2, look: look)
        XCTAssertEqual(withLook.presets[0].look, look)
        let lookOnly = savePresetInBook(book, "Just mono", nil, "p2", now: 2, look: look)
        XCTAssertEqual(lookOnly.presets.map(\.name), ["Just mono"])
        XCTAssertEqual(savePresetInBook(book, "Nothing", nil, "p3", now: 2), book)
        let back = readPresetBook(JSONValue.parse(withLook.json.serialized()))!
        let layer = back.presets[0].look?.objectValue?["layers"]?.arrayValue?.first?.objectValue
        XCTAssertEqual(layer?["id"], "classic-black-and-white")
        XCTAssertEqual(layer?["intensity"], 0.8)
        // A book written before looks existed reads with none.
        var old = book.json.objectValue!
        old["presets"] = [["id": "x", "name": "Old", "settings": ["exposure": 1]]]
        XCTAssertNil(readPresetBook(.object(old))!.presets[0].look)
    }
}

// MARK: - preset-book-remote.test.ts

final class BookFromWireTests: XCTestCase {
    func testTakesTheIdAndTheSourceFromTheRequestNeverFromTheBody() throws {
        let book = savePresetInBook(createPresetBook("b1", now: 10), "Dusk", dev { $0.blacks = -5 }, "p1", now: 20)
        var wire = bookToWire(book).objectValue!
        wire["id"] = "forged"
        wire["sourceId"] = "elsewhere"
        let back = try bookFromWire(.object(wire), "b1", "winnow.example")
        XCTAssertEqual(back.id, "b1")
        XCTAssertEqual(back.sourceId, "winnow.example")
        XCTAssertEqual(back.presets.map(\.name), ["Dusk"])
    }

    func testRefusesABodyThatIsNotABook() {
        for body: JSONValue? in [nil, .null, [], ["presets": "no"]] {
            XCTAssertThrowsError(try bookFromWire(body, "b1", "w")) { error in
                XCTAssertTrue((error as? WireDocError)?.message.contains("not a preset book") == true, "\(error)")
            }
        }
    }
}
