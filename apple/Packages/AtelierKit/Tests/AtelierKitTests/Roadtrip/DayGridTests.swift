// Port of `src/shared/roadtrip/day-grid.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class TripHeatmapColumnTests: XCTestCase {
    func testIsTheDrawnSizeAt100Percent() {
        XCTAssertEqual(heatmapColumn(1), HeatmapColumn(cellPx: heatmapCell, gapPx: heatmapGap))
    }

    func testRoundsToWholePixels() {
        XCTAssertEqual(heatmapColumn(1.3), HeatmapColumn(cellPx: 18, gapPx: 4))
    }

    func testStopsShrinkingAtACellOf4AndAGutterOf1() {
        XCTAssertEqual(heatmapColumn(0.25), HeatmapColumn(cellPx: 4, gapPx: 1))
        XCTAssertEqual(heatmapColumn(0.1), HeatmapColumn(cellPx: 4, gapPx: 1))
    }
}

final class TripHeatmapWidthTests: XCTestCase {
    func testCountsTheWholeLatticeOneGutterPastTheLastColumn() {
        XCTAssertEqual(heatmapWidth(45, 1), 45 * (heatmapCell + heatmapGap))
    }

    func testNeverShrinksAsTheZoomGrowsWhatTheFloorSearchReliesOn() {
        var last = 0.0
        var s = 0.25
        while s <= 16 {
            let w = heatmapWidth(45, s)
            XCTAssertGreaterThanOrEqual(w, last)
            last = w
            s += 0.05
        }
    }
}

final class TripFittedColumnTests: XCTestCase {
    func testGivesAYearInA1000pxBoxACellWideEnoughToAimAt() {
        let c = fittedColumn(1000, 53)
        XCTAssertGreaterThanOrEqual(c.cellPx, 14)
        XCTAssertLessThanOrEqual(c.cellPx + c.gapPx, ((1000.0 - 34) / 53).rounded(.down))
    }

    func testCapsAShortTripAtTheLargestCellRatherThanDrawingTiles() {
        XCTAssertEqual(fittedColumn(1000, 5).cellPx, maxFitCell)
    }

    func testFloorsAVeryLongTripAtTheSmallestCellSoTheGridScrolls() {
        XCTAssertEqual(fittedColumn(600, 200).cellPx, minFitCell)
    }

    func testFallsBackToThe100PercentColumnWithNoBoxToFit() {
        XCTAssertEqual(fittedColumn(0, 53), HeatmapColumn(cellPx: heatmapCell, gapPx: heatmapGap))
    }
}
