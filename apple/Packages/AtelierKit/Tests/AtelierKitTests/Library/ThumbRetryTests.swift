// Pins `ThumbRetry.swift` — the schedule inside the web's `WinnowThumb.tsx`.

import Foundation
import XCTest
@testable import AtelierKit

final class ThumbRetryTests: XCTestCase {
    func testTheFirstFailureHealsTheCacheEntryRatherThanAskingTheSameQuestion() {
        XCTAssertEqual(thumbAfterFailure(0), .heal)
    }

    func testAHealedEntryIsAskedForPlainlyAnUnansweredOneByADiscriminatedUrl() {
        XCTAssertEqual(thumbAfterHeal(true), 1)
        XCTAssertEqual(thumbAfterHeal(false), 2)
    }

    func testLaterFailuresWaitLongerEachTime() {
        XCTAssertEqual(thumbAfterFailure(1), .retry(attempt: 2, afterMs: 800))
        XCTAssertEqual(thumbAfterFailure(2), .retry(attempt: 3, afterMs: 1200))
        XCTAssertEqual(thumbAfterFailure(3), .retry(attempt: 4, afterMs: 1600))
    }

    func testGivesUpPastThreeRetriesAndSaysSo() {
        XCTAssertEqual(thumbRetries, 3)
        XCTAssertFalse(thumbGaveUp(3))
        XCTAssertTrue(thumbGaveUp(4))
    }

    func testOnlyTheFirstTwoAttemptsAskThePlainUrl() {
        let client = WinnowClient(config: WinnowConfig(baseUrl: "https://winnow.example", auth: .cookie),
                                  transport: { _ in WinnowResponse(status: 200) })
        XCTAssertEqual(client.thumbRetryUrl(7, 0), "https://winnow.example/api/assets/7/thumb")
        XCTAssertEqual(client.thumbRetryUrl(7, 1), "https://winnow.example/api/assets/7/thumb")
        XCTAssertEqual(client.thumbRetryUrl(7, 2), "https://winnow.example/api/assets/7/thumb?retry=2")
    }
}
