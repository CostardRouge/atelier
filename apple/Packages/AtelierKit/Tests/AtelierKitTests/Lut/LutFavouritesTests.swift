// A spec of its own for `LutFavourites.swift` — the web's
// `use-lut-favourites.ts` has none, being a hook over `localStorage`; these pin
// the rules its comments state.

import XCTest
@testable import AtelierKit

final class LutFavouritesTests: XCTestCase {
    func testReadsAnArrayOfNonEmptyStringsAndNothingElse() {
        let raw: JSONValue = .array([.string("classic-warm"), .number(3), .string(""), .string("film:reversal-vivid"), .null])
        XCTAssertEqual(readLutFavourites(raw), ["classic-warm", "film:reversal-vivid"])
    }

    func testJunkAndNothingReadAsAnEmptyList() {
        XCTAssertEqual(readLutFavourites(nil), [])
        XCTAssertEqual(readLutFavourites(.string("classic-warm")), [])
        XCTAssertEqual(readLutFavourites(.object(["a": .string("b")])), [])
    }

    func testReadsNoMoreThanTheShortlistHolds() {
        let raw = JSONValue.array((0..<80).map { .string("look-\($0)") })
        let list = readLutFavourites(raw)
        XCTAssertEqual(list.count, maxLutFavourites)
        XCTAssertEqual(list.first, "look-0")
    }

    func testANewStarGoesToTheEndSoNothingJumpsUnderThePointer() {
        let list = toggledLutFavourite(["a", "b"], "pack:pk_1/creative/one")
        XCTAssertEqual(list, ["a", "b", "pack:pk_1/creative/one"])
    }

    func testAStarAlreadyThereLeavesAndTheOthersKeepTheirOrder() {
        XCTAssertEqual(toggledLutFavourite(["a", "b", "c"], "b"), ["a", "c"])
    }

    func testAnEmptyIdChangesNothing() {
        XCTAssertEqual(toggledLutFavourite(["a"], ""), ["a"])
    }

    func testPastTheShortlistTheOldestGo() {
        let full = (0..<maxLutFavourites).map { "look-\($0)" }
        let next = toggledLutFavourite(full, "new")
        XCTAssertEqual(next.count, maxLutFavourites)
        XCTAssertEqual(next.first, "look-1")
        XCTAssertEqual(next.last, "new")
    }

    func testWritesWhatItReadsBack() {
        let list = ["classic-warm", "film:mono-panchromatic"]
        XCTAssertEqual(readLutFavourites(lutFavouritesJSON(list)), list)
    }
}
