// Port of `src/shared/ui/sheet-snap.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class ClampFractionTests: XCTestCase {
    func testKeepsASheetOnTheScreen() {
        XCTAssertEqual(clampFraction(0.5), 0.5)
        XCTAssertEqual(clampFraction(2), 0.96)
        XCTAssertEqual(clampFraction(-1), 0.08)
        XCTAssertEqual(clampFraction(.nan), 0)
    }
}

final class NearestSnapTests: XCTestCase {
    func testPicksTheClosestDeclaredRest() {
        XCTAssertEqual(nearestSnap(0.5), 0.55)
        XCTAssertEqual(nearestSnap(0.9), 0.92)
        XCTAssertEqual(nearestSnap(0.7, [0.4, 0.9]), 0.9)
        XCTAssertEqual(nearestSnap(0.6, [0.4, 0.9]), 0.4)
    }

    func testGivesATieToTheSmallerSoAHesitantDragDoesNotGrow() {
        XCTAssertEqual(nearestSnap(0.5, [0.4, 0.6]), 0.4)
    }

    func testHasAnAnswerWithNoSnapsAtAll() {
        XCTAssertEqual(nearestSnap(0.42, []), 0.42)
    }
}

final class SnapAfterDragTests: XCTestCase {
    func testRestsOnTheNearestPointWhenTheDragStaysUp() {
        XCTAssertEqual(snapAfterDrag(0.5), 0.55)
        XCTAssertEqual(snapAfterDrag(0.88), 0.92)
    }

    func testClosesOnADragPastTheFloor() {
        XCTAssertNil(snapAfterDrag(0.2))
        XCTAssertNil(snapAfterDrag(0.08))
    }

    func testLetsASheetWithALowFirstSnapStillRestOnIt() {
        // Its own floor is 0.8 × 0.2 = 0.16, well under the shared 0.3 — so a
        // deliberate drag to its smallest rest lands there instead of dismissing.
        let low: SnapPoints = [0.2, 0.9]
        XCTAssertEqual(snapAfterDrag(0.21, low), 0.2)
        XCTAssertEqual(snapAfterDrag(0.25, low), 0.2)
        XCTAssertNil(snapAfterDrag(0.1, low))
    }

    func testNeverDismissesAboveTheSharedThreshold() {
        XCTAssertNotNil(snapAfterDrag(dismissBelow))
    }
}

final class DragFractionTests: XCTestCase {
    func testShrinksTheSheetWhenTheFingerTravelsDown() {
        // 84px down an 840px screen is a tenth of the sheet's height, taken off.
        assertClose(dragFraction(0.6, 84, 840), 0.5, 6)
    }

    func testGrowsTheSheetWhenTheFingerTravelsUp() {
        assertClose(dragFraction(0.6, -84, 840), 0.7, 6)
    }

    func testStaysOnScreenHoweverFarTheFingerGoes() {
        XCTAssertEqual(dragFraction(0.6, -5000, 840), 0.96)
        XCTAssertEqual(dragFraction(0.6, 5000, 840), 0.08)
    }

    func testHoldsStillOnAViewportNothingHasMeasuredYet() {
        XCTAssertEqual(dragFraction(0.6, 100, 0), 0.6)
    }
}

final class NextSnapTests: XCTestCase {
    func testCyclesUpwardAndWraps() {
        XCTAssertEqual(nextSnap(0.55), 0.92)
        XCTAssertEqual(nextSnap(0.92), 0.55)
    }

    func testStartsFromWhereverTheSheetActuallyIs() {
        XCTAssertEqual(nextSnap(0.5), 0.92)
        XCTAssertEqual(nextSnap(0.9), 0.55)
    }

    func testWalksThreeStopsInOrder() {
        let three: SnapPoints = [0.3, 0.6, 0.9]
        XCTAssertEqual(nextSnap(0.3, three), 0.6)
        XCTAssertEqual(nextSnap(0.6, three), 0.9)
        XCTAssertEqual(nextSnap(0.9, three), 0.3)
    }

    func testDefaultsToTwoStops() {
        XCTAssertEqual(defaultSnaps, [0.55, 0.92])
    }
}
