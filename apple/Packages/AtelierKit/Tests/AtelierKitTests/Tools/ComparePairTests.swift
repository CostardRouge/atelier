// Port of `src/tools/compare/compare.test.ts`, case for case (the web's
// `clamp01` is `clampWipe` here — see `ComparePair.swift`).

import Foundation
import XCTest
@testable import AtelierKit

final class ClampWipeTests: XCTestCase {
    func testClampsToZeroOneAndToleratesNonFiniteInput() {
        XCTAssertEqual(clampWipe(-0.5), 0)
        XCTAssertEqual(clampWipe(0.5), 0.5)
        XCTAssertEqual(clampWipe(2), 1)
        XCTAssertEqual(clampWipe(Double.nan), 0)
    }
}

final class InsetForSplitTests: XCTestCase {
    func testInsetsTheTopLayerFromTheLeftBySplitTrimmingZeros() {
        XCTAssertEqual(insetForSplit(0), "inset(0 0 0 0%)")
        XCTAssertEqual(insetForSplit(0.5), "inset(0 0 0 50%)")
        XCTAssertEqual(insetForSplit(1), "inset(0 0 0 100%)")
    }

    func testKeepsFractionalPrecisionAndClampsOutOfRange() {
        XCTAssertEqual(insetForSplit(1.0 / 3.0), "inset(0 0 0 33.3333%)")
        XCTAssertEqual(insetForSplit(2), "inset(0 0 0 100%)")
    }
}

final class ReconcilePairTests: XCTestCase {
    func testFillsBothSlotsFromAnEmptyChoice() {
        XCTAssertEqual(reconcilePair(nil, nil, ["x", "y", "z"]), ComparePair(a: "x", b: "y"))
    }

    func testKeepsAStillValidPairStable() {
        XCTAssertEqual(reconcilePair("z", "x", ["x", "y", "z"]), ComparePair(a: "z", b: "x"))
    }

    func testReplacesADroppedSideFromTheRemainingPool() {
        // A ('gone') is no longer available; keep B='y' and refill A from the pool.
        XCTAssertEqual(reconcilePair("gone", "y", ["x", "y"]), ComparePair(a: "x", b: "y"))
    }

    func testDedupesWhenTheSameIdLandsInBothSlots() {
        XCTAssertEqual(reconcilePair("x", "x", ["x", "y"]), ComparePair(a: "x", b: "y"))
    }

    func testPutsALoneAssetInAAndLeavesBEmpty() {
        XCTAssertEqual(reconcilePair(nil, nil, ["only"]), ComparePair(a: "only", b: nil))
        XCTAssertEqual(reconcilePair("gone", "only", ["only"]), ComparePair(a: "only", b: nil))
    }

    func testEmptiesBothWhenNothingIsAvailable() {
        XCTAssertEqual(reconcilePair("x", "y", []), ComparePair(a: nil, b: nil))
    }
}
