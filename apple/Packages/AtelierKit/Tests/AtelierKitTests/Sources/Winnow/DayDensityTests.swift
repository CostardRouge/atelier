// Port of `src/shared/sources/winnow/day-density.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let march = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]

final class DensityStripTests: XCTestCase {
    func testScalesToTheMonthItIsDrawingNotToAFixedNumber() {
        let busy = densityStrip(march, ["2026-03-02": 40])
        let quiet = densityStrip(march, ["2026-03-02": 2])
        XCTAssertEqual(busy.bars[1].fill, 1)
        XCTAssertEqual(quiet.bars[1].fill, 1)
    }

    func testKeepsOneFileVisiblyAboveNothing() {
        let bars = densityStrip(march, ["2026-03-01": 60, "2026-03-03": 1]).bars
        XCTAssertEqual(bars[0].fill, 1)
        XCTAssertGreaterThanOrEqual(bars[2].fill, densityFloor)
        XCTAssertEqual(bars[1].fill, 0)
    }

    func testReadsADayTheInstanceDidNotMentionAsEmpty() {
        let strip = densityStrip(march, [:])
        XCTAssertEqual(strip.bars.map(\.fill), [0, 0, 0, 0])
        XCTAssertEqual(strip.peak, 0)
        XCTAssertEqual(strip.total, 0)
    }

    func testCarriesThePeakAndTheMonthTotalForTheLabel() {
        let strip = densityStrip(march, ["2026-03-01": 5, "2026-03-02": 12, "2026-03-04": 3])
        XCTAssertEqual(strip.peak, 12)
        XCTAssertEqual(strip.total, 20)
    }

    func testEchoesTheDaysItWasGivenInOrder() {
        let bars = densityStrip(march, ["2026-03-04": 9]).bars
        XCTAssertEqual(bars.map(\.date), march)
        XCTAssertEqual(bars[3].count, 9)
    }
}
