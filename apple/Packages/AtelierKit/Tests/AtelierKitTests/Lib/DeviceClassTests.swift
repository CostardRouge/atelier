// The type half of `src/shared/lib/device-class.ts` has no spec of its own on
// the web; this pins what the app and the budgets read.

import XCTest
@testable import AtelierKit

final class DeviceClassTests: XCTestCase {
    func testIsTheWebsTwoWordsAndNothingElse() {
        XCTAssertEqual(DeviceClass.allCases.map(\.rawValue), ["constrained", "roomy"])
        XCTAssertEqual(DeviceClass(rawValue: "constrained"), .constrained)
        XCTAssertEqual(DeviceClass(rawValue: "roomy"), .roomy)
        // The web's `localStorage['atelier.device']` override accepts only these two.
        XCTAssertNil(DeviceClass(rawValue: "phone"))
    }
}
