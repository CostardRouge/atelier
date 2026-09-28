// `hooks/colour.ts` and `hooks/easing.ts` have no web spec; these pin the
// rules each module states.

import Foundation
import XCTest
@testable import AtelierKit

final class TripHexToRgbaTests: XCTestCase {
    func testConvertsAStoredHexAtAnAlpha() {
        XCTAssertEqual(hexToRgba("#ff8000", 0.5), "rgba(255,128,0,0.5)")
        XCTAssertEqual(hexToRgba("#FF8000", 1), "rgba(255,128,0,1)")
        XCTAssertEqual(hexToRgba("#0a0B0c", 0.35), "rgba(10,11,12,0.35)")
    }

    func testClampsTheAlpha() {
        XCTAssertEqual(hexToRgba("#000000", 2), "rgba(0,0,0,1)")
        XCTAssertEqual(hexToRgba("#000000", -1), "rgba(0,0,0,0)")
    }

    func testPaintsWhiteRatherThanThrowingOnAnUnreadableValue() {
        for bad in ["", "#fff", "ff8000", "#gg0000", "#ff80001", "red"] {
            XCTAssertEqual(hexToRgba(bad, 1), "rgba(255,255,255,1)", bad)
        }
    }
}

final class TripHookEasingTests: XCTestCase {
    func testKeepsTheStoredIdsInTheWebsOrder() {
        XCTAssertEqual(hookEasingIds.map(\.rawValue), ["ease-out", "ease-out-hard", "linear", "ease-in", "ease-in-out"])
    }

    func testAliasesTheOneRegistrysCurves() {
        XCTAssertEqual(hookEasingCurve[.easeOut], .outCubic)
        XCTAssertEqual(hookEasingCurve[.easeOutHard], .outExpo)
        XCTAssertEqual(hookEasingCurve[.linear], .linear)
        XCTAssertEqual(hookEasingCurve[.easeIn], .inCubic)
        XCTAssertEqual(hookEasingCurve[.easeInOut], .inOutCubic)
        for id in hookEasingIds {
            let spec = hookEasings[id]!
            let curve = curveOf(hookEasingCurve[id]!)
            for u in samples(21) { XCTAssertEqual(spec.ease(u), curve.at(u, nil), id.rawValue) }
        }
    }

    func testPlacesAStopExactlyEveryCurveIsInvertedToFloatingPrecision() {
        for id in hookEasingIds {
            let spec = hookEasings[id]!
            XCTAssertEqual(spec.ease(0), 0, accuracy: 1e-12, id.rawValue)
            XCTAssertEqual(spec.ease(1), 1, accuracy: 1e-12, id.rawValue)
            for u in samples(101) { assertClose(spec.inverse(spec.ease(u)), u, 9) }
        }
    }

    func testSaysEachCurveInTheOpenersOwnWords() {
        XCTAssertEqual(hookEasings[.easeOut]?.label, "Settle")
        XCTAssertEqual(hookEasings[.easeOutHard]?.label, "Brake")
        XCTAssertEqual(hookEasings[.linear]?.label, "Even")
        XCTAssertEqual(hookEasings[.easeIn]?.label, "Wind up")
        XCTAssertEqual(hookEasings[.easeInOut]?.label, "Glide")
    }
}
