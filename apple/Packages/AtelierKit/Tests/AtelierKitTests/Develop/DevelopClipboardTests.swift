// Port of `src/shared/develop/develop-clipboard.test.ts`.

import XCTest
@testable import AtelierKit

final class DevelopClipboardTests: XCTestCase {
    override func setUp() {
        super.setUp()
        clearDevelopClipboard()
    }

    func testHoldsNothingUntilSomethingNonDefaultIsCopied() {
        XCTAssertFalse(hasCopiedDevelop())
        XCTAssertNil(pasteDevelop())
        copyDevelop(.default)
        XCTAssertFalse(hasCopiedDevelop())
        copyDevelop(nil)
        XCTAssertFalse(hasCopiedDevelop())
        // The NUMBERS travel, never the material: a RAW base with nothing else on
        // it is as shot once the base is gone, and nothing is held.
        copyDevelop(dev { $0.base = .gain; $0.rawGain = 2 })
        XCTAssertFalse(hasCopiedDevelop())
    }

    func testPastesACopyNeverTheValueItWasGiven() {
        var src = dev { $0.exposure = 0.7 }
        copyDevelop(src)
        src.exposure = 2
        var pasted = pasteDevelop()
        XCTAssertEqual(pasted?.exposure, 0.7)
        pasted?.exposure = 3
        XCTAssertEqual(pasteDevelop()?.exposure, 0.7)
        // A RAW's base and metered gain stay on the picture they belong to.
        copyDevelop(dev { $0.base = .gain; $0.rawGain = 2; $0.exposure = 0.5 })
        XCTAssertEqual(pasteDevelop()?.exposure, 0.5)
        XCTAssertNil(pasteDevelop()?.base)
        XCTAssertNil(pasteDevelop()?.rawGain)
    }

    func testTellsItsListenersOnEveryCopyAndOnAClear() {
        var ticks = 0
        let off = subscribeDevelopClipboard { ticks += 1 }
        copyDevelop(dev { $0.tint = 5 })
        clearDevelopClipboard()
        off()
        copyDevelop(dev { $0.tint = 6 })
        XCTAssertEqual(ticks, 2)
    }
}
