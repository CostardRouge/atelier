// The part of `src/shared/roadtrip/hook-video.ts` the trip document reads:
// the `defaultHookSeconds` cases of `hook-video.test.ts`.

import XCTest
@testable import AtelierKit

final class HookVideoDefaultSecondsTests: XCTestCase {
    func testGivesTheBadgeItsHoldPlusABeatOfPicture() {
        XCTAssertEqual(defaultHookSeconds(4), 5)
    }

    func testStaysInsideWhatTheControlOffersWhateverItIsHanded() {
        for d in [-10, 0, 0.2, 4, 120, Double.nan, Double.infinity] {
            let v = defaultHookSeconds(d)
            XCTAssertGreaterThanOrEqual(v, minHookSeconds)
            XCTAssertLessThanOrEqual(v, maxHookSeconds)
        }
    }

    func testAHoldThatWasNeverWrittenIsTheShortestHook() {
        XCTAssertEqual(defaultHookSeconds(nil), 1)
    }
}
