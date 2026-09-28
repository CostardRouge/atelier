// Port of `src/shared/render/gain-map.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let W = 8064.0
private let H = 4536.0

/// A 2×2 map over the whole frame, corners first, as the file states one.
private func map(_ gains: [Float], _ over: (inout DngGainMap) -> Void = { _ in }) -> DngGainMap {
    var m = DngGainMap(
        rect: DngRect(top: 0, left: 0, bottom: Int(H), right: Int(W)),
        plane: 0,
        planes: 3,
        rows: 2,
        cols: 2,
        originV: 0,
        originH: 0,
        spacingV: 1,
        spacingH: 1,
        mapPlanes: 3,
        gains: gains
    )
    over(&m)
    return m
}

/// `+g.toFixed(2)` — the gain as a panel would print it.
private func fixed2(_ g: Float) -> Double {
    Double(ExifText.toFixed(Double(g), 2))!
}

final class GainFieldFromTests: XCTestCase {
    func testLaysTheFilesOwnNodesOverTheImageAndKeepsItsNumbersExactly() {
        // top-left 5.93/5.06/4.97, the other three 1.
        let f = gainFieldFrom([map([5.93, 5.06, 4.97, 1, 1, 1, 1, 1, 1, 1, 1, 1])], W, H)!
        XCTAssertEqual(f.cols, 2)
        XCTAssertEqual(f.rows, 2)
        XCTAssertEqual(f.originU, 0)
        XCTAssertEqual(f.originV, 0)
        assertClose(f.stepU, 1, 10)
        assertClose(f.stepV, 1, 10)
        XCTAssertEqual(f.gains[0..<3].map(fixed2), [5.93, 5.06, 4.97])
        // The corner the file asks 5.93× for really answers 5.93×.
        assertClose(gainAt(f, 0, 0).0, 5.93, 5)
        assertClose(gainAt(f, 1, 1).0, 1, 5)
    }

    func testInterpolatesBetweenTheNodesAndHoldsAtTheEdgeOutsideThem() {
        let f = gainFieldFrom([map([3, 3, 3, 1, 1, 1, 3, 3, 3, 1, 1, 1])], W, H)!
        assertClose(gainAt(f, 0.5, 0).0, 2, 5)
        assertClose(gainAt(f, 0.25, 0.5).1, 2.5, 5)
        // Past the grid, the edge node — never an extrapolation.
        assertClose(gainAt(f, -0.4, 0.5).0, 3, 5)
        assertClose(gainAt(f, 1.7, 0.5).0, 1, 5)
    }

    func testSharesOneGridPlaneAcrossTheThreeColoursWhenTheFileWritesOne() {
        let f = gainFieldFrom([map([4, 1, 4, 1]) { $0.mapPlanes = 1 }], W, H)!
        let (r, g, b) = gainAt(f, 0, 0)
        XCTAssertEqual([r, g, b], [4, 4, 4])
    }

    func testHonoursARectangleThatIsNotTheWholeFrame() {
        let half = map([2, 2, 2, 1, 1, 1, 2, 2, 2, 1, 1, 1]) {
            $0.rect = DngRect(top: 0, left: Int(W / 2), bottom: Int(H), right: Int(W))
        }
        let f = gainFieldFrom([half], W, H)!
        assertClose(f.originU, 0.5, 10)
        assertClose(f.stepU, 0.5, 10)
        // Inside the rectangle the numbers are the file's; left of it, held.
        assertClose(gainAt(f, 0.5, 0).0, 2, 5)
        assertClose(gainAt(f, 0.75, 0).0, 1.5, 5)
        assertClose(gainAt(f, 0.1, 0).0, 2, 5)
    }

    func testRefusesNonsenseRatherThanBuildingAFieldThatLies() {
        XCTAssertNil(gainFieldFrom([], W, H))
        XCTAssertNil(gainFieldFrom([map([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])], 0, H))
        XCTAssertNil(gainFieldFrom([map([1]) {
            $0.rows = 1; $0.cols = 1; $0.spacingH = 0; $0.spacingV = 0
        }], W, H))
    }
}

final class GainEncodedTests: XCTestCase {
    func testMultipliesLightNotCodeMidGreyDoubledIsNotTwiceItsCode() {
        // 0.5 encoded is 0.2140 linear; ×2 is 0.4280, which encodes to 0.6858 —
        // not 1.0, which is what multiplying the code would have given.
        assertClose(gainEncoded(0.5, 2), 0.6858, 4)
        XCTAssertEqual(gainEncoded(0.5, 1), 0.5)
        // Black stays black whatever the gain, which is what makes a lift on the
        // corner a lift and not a fog.
        assertClose(gainEncoded(0, 5.93), 0, 6)
    }
}

final class MaxGainAndIsFlatFieldTests: XCTestCase {
    func testSaysWhatTheFileAsksForAtItsStrongest() {
        let f = gainFieldFrom([map([5.93, 5.06, 4.97, 1, 1, 1, 1, 1, 1, 1, 1, 1])], W, H)!
        assertClose(maxGain(f), 5.93, 5)
        XCTAssertFalse(isFlatField(f))
        XCTAssertEqual(maxGain(nil), 1)
    }

    func testKnowsAFieldThatWouldMultiplyNothingSoNoPassIsBuiltForIt() {
        let flat = gainFieldFrom([map([Float](repeating: 1, count: 12))], W, H)!
        XCTAssertTrue(isFlatField(flat))
        XCTAssertTrue(isFlatField(nil))
    }
}
