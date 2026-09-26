// Port of `src/shared/raw/decoded-cache.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class MakeDecodedCacheTests: XCTestCase {
    func testRecallsWhatItHoldsAndCountsARecallAsAUse() {
        let cache: DecodedCache<String> = makeDecodedCache { 100 }
        cache.remember("a", "A", 40)
        cache.remember("b", "B", 40)
        XCTAssertEqual(cache.recall("a"), "A")
        // `a` was just used; `c` pushes the total past the ceiling and `b` goes.
        cache.remember("c", "C", 40)
        XCTAssertEqual(cache.keys().sorted(), ["a", "c"])
        XCTAssertNil(cache.recall("b"))
        XCTAssertEqual(cache.size(), 80)
    }

    func testNeverLetsGoOfTheEntryUsedLastEvenAloneOverTheCeiling() {
        let cache: DecodedCache<Int> = makeDecodedCache { 10 }
        cache.remember("big", 1, 50)
        XCTAssertEqual(cache.recall("big"), 1)
        cache.remember("bigger", 2, 60)
        XCTAssertEqual(cache.keys(), ["bigger"])
        cache.clear()
        XCTAssertEqual(cache.size(), 0)
    }

    func testKeysAFileByNameWeightAndInstant() {
        XCTAssertEqual(fileKey(name: "DJI_0101.DNG", size: 74_000_000, lastModified: 1_700_000_000_000),
                       "DJI_0101.DNG:74000000:1700000000000")
    }
}
