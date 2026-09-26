// Port of `src/shared/overlay/stagger.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let frame = Size(1000, 2000)
// A 2 × 2 grid: tl, tr, bl, br.
private let grid: [Rect] = [
    Rect(0, 0, 500, 1000),
    Rect(500, 0, 500, 1000),
    Rect(0, 1000, 500, 1000),
    Rect(500, 1000, 500, 1000),
]

final class StaggerRanksTests: XCTestCase {
    func testCountsInSequenceAndInReverse() {
        XCTAssertEqual(staggerRanks(grid, frame, .sequence), [0, 1, 2, 3])
        XCTAssertEqual(staggerRanks(grid, frame, .reverse), [3, 2, 1, 0])
        XCTAssertEqual(staggerRanks([], frame, .rows), [])
    }

    func testLandsAWholeRowOrAWholeColumnAtOnce() {
        XCTAssertEqual(staggerRanks(grid, frame, .rows), [0, 0, 1, 1])
        XCTAssertEqual(staggerRanks(grid, frame, .columns), [0, 1, 0, 1])
    }

    func testTiesFourEquidistantCellsFromTheCentreAndOrdersAHeroFirst() {
        XCTAssertEqual(staggerRanks(grid, frame, .centerOut), [0, 0, 0, 0])
        let hero: [Rect] = [
            Rect(0, 0, 1000, 1000),
            Rect(0, 1000, 500, 1000),
            Rect(500, 1000, 500, 1000),
        ]
        XCTAssertEqual(staggerRanks(hero, frame, .size), [0, 1, 1])
        XCTAssertEqual(staggerRanks(hero, frame, .centerOut)[0], 0)
        XCTAssertEqual(staggerRanks(hero, frame, .edgesIn)[0], 1)
    }

    func testShufflesTheSameWayForTheSameSeedAndDifferentlyForAnother() {
        let a = staggerRanks(grid, frame, .random, seed: 7)
        let b = staggerRanks(grid, frame, .random, seed: 7)
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.sorted(), [0, 1, 2, 3])
        let seeds = Set([1.0, 2, 3, 4, 5, 6].map { staggerRanks(grid, frame, .random, seed: $0).map(String.init).joined(separator: ",") })
        XCTAssertGreaterThan(seeds.count, 1)
    }

    func testSharesARankWithinTheTieBandOnly() {
        let near: [Rect] = [
            Rect(0, 0, 100, 100),
            Rect(0, 10, 100, 100), // 10px apart: within 2% of 1000
            Rect(0, 60, 100, 100), // 60px: past it
        ]
        XCTAssertEqual(staggerRanks(near, frame, .rows), [0, 0, 1])
    }
}

final class StaggerDelaysAndSettleTests: XCTestCase {
    func testTurnsRanksIntoSecondsAndSettlesAfterTheLastRankPlusTheStep() {
        let delays = staggerDelays(grid, frame, Stagger(each: 0.25, order: .rows))
        XCTAssertEqual(delays, [0, 0, 0.25, 0.25])
        assertClose(staggerSettle(delays, AnimStep(preset: .fade, duration: 0.6, easing: .out)), 0.85, 2)
        XCTAssertEqual(staggerSettle(delays, AnimStep(preset: .none, duration: 0, easing: .linear)), 0.25)
        XCTAssertEqual(staggerSettle([], AnimStep(preset: .fade, duration: 0.6, easing: .out)), 0)
    }

    func testReadsAStaggerOutOfJunkAndClampsIt() {
        XCTAssertEqual(normaliseStagger(nil), Stagger(each: 0.1, order: .sequence))
        XCTAssertEqual(normaliseStagger(["each": 9, "order": "sideways", "seed": 4.6]), Stagger(each: 1, order: .sequence, seed: 5))
        XCTAssertEqual(normaliseStagger(["each": -1, "order": "rows"]), Stagger(each: 0, order: .rows))
    }

    // Beyond the web spec: the writer is the reader's inverse.
    func testWritesWhatItReads() {
        let s = Stagger(each: 0.12, order: .random, seed: 42)
        XCTAssertEqual(normaliseStagger(s.json), s)
        XCTAssertEqual(Stagger.default.json, ["each": 0.1, "order": "sequence"])
    }
}
