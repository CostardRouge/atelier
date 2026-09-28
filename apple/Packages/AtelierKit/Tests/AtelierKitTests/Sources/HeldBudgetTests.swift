// Port of `src/shared/sources/held-budget.test.ts`.

import XCTest
@testable import AtelierKit

private let mib = 1024 * 1024

private func e(_ key: String, _ mb: Int, _ lastUsed: Double) -> HeldEntry {
    HeldEntry(key: key, bytes: mb * mib, lastUsed: lastUsed)
}

final class HeldCeilingTests: XCTestCase {
    func testIsAQuarterOfTheDevicesMemoryBetween256MiBAnd1GiB() {
        XCTAssertEqual(heldCeiling(2), 512 * mib)
        XCTAssertEqual(heldCeiling(4), 1024 * mib)
        XCTAssertEqual(heldCeiling(8), 1024 * mib)
        XCTAssertEqual(heldCeiling(0.5), 256 * mib)
    }

    func testFallsBackWhereThePlatformSaysNothing() {
        XCTAssertEqual(heldCeiling(nil), defaultHeldCeiling)
        XCTAssertEqual(heldCeiling(0), defaultHeldCeiling)
        XCTAssertEqual(heldCeiling(.nan), defaultHeldCeiling)
        XCTAssertEqual(heldCeiling(.infinity), defaultHeldCeiling)
        XCTAssertEqual(heldCeiling(-1), defaultHeldCeiling)
    }
}

final class ToEvictTests: XCTestCase {
    func testDropsNothingUnderTheCeiling() {
        XCTAssertEqual(toEvict([e("a", 74, 1), e("b", 74, 2)], 200 * mib), [])
    }

    func testDropsTheLeastRecentlyUsedFirstUntilTheRestFits() {
        let held = [e("a", 74, 3), e("b", 74, 1), e("c", 74, 2), e("d", 9, 4)]
        // 231 MiB held, 150 allowed: b (oldest) then c go; a and d stay at 83.
        XCTAssertEqual(toEvict(held, 150 * mib), ["b", "c"])
        // 160 allowed: b alone brings it to 157, and c is kept.
        XCTAssertEqual(toEvict(held, 160 * mib), ["b"])
    }

    func testNeverDropsTheFileUsedLastEvenAloneOverTheCeiling() {
        XCTAssertEqual(toEvict([e("big", 300, 1)], 256 * mib), [])
        XCTAssertEqual(toEvict([e("old", 74, 1), e("big", 300, 2)], 256 * mib), ["old"])
    }

    func testCountsAReadAsAUse() {
        // `a` was fetched first but read most recently, so `b` is the one to go.
        XCTAssertEqual(toEvict([e("a", 74, 5), e("b", 74, 2)], 100 * mib), ["b"])
    }

    func testTiesOnTheTickKeepTheirListedOrderAsAStableSortWould() {
        XCTAssertEqual(toEvict([e("a", 74, 1), e("b", 74, 1), e("c", 74, 2)], 100 * mib), ["a", "b"])
    }
}

final class ConstrainedDeviceTests: XCTestCase {
    func testTakesItsOwnFlatCeilingWhateverThePlatformSaysAboutItsMemory() {
        XCTAssertEqual(heldCeiling(nil, .constrained), constrainedHeldCeiling)
        XCTAssertEqual(heldCeiling(8, .constrained), constrainedHeldCeiling)
        XCTAssertEqual(constrainedHeldCeiling, 192 * 1024 * 1024)
        XCTAssertEqual(heldCeiling(8, .roomy), 1024 * 1024 * 1024)
    }
}
