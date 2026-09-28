// Port of `src/shared/render/render-size.test.ts`.

import XCTest
@testable import AtelierKit

final class FitRenderSizeTests: XCTestCase {
    func testLeavesAPictureInsideTheCapExactlyAsItIs() {
        XCTAssertEqual(fitRenderSize(8064, 6048, 8192), RenderSize(width: 8064, height: 6048))
        XCTAssertEqual(fitRenderSize(8192, 100, 8192), RenderSize(width: 8192, height: 100))
        XCTAssertFalse(exceedsRenderSize(8064, 6048, 8192))
    }

    func testScalesABiggerOneDownSoItsLongEdgeIsTheCapAspectKept() {
        // A 61-megapixel still on an 8192 GPU.
        let fitted = fitRenderSize(9504, 6336, 8192)
        XCTAssertEqual(fitted.width, 8192)
        XCTAssertEqual(fitted.height, Int((6336.0 * 8192 / 9504).rounded()))
        XCTAssertTrue(exceedsRenderSize(9504, 6336, 8192))
        // And a portrait, by its height.
        XCTAssertEqual(fitRenderSize(6336, 9504, 8192), RenderSize(width: Int((6336.0 * 8192 / 9504).rounded()), height: 8192))
    }

    func testNeverReturnsAPixelPastTheCapNorAZeroEdge() {
        // Rounding must not push the long edge to cap + 1.
        for (w, h) in [(16385.0, 16384.0), (20001, 3), (3, 20001)] {
            let f = fitRenderSize(w, h, 16384)
            XCTAssertEqual(max(f.width, f.height), 16384)
            XCTAssertGreaterThanOrEqual(min(f.width, f.height), 1)
        }
    }

    func testTreatsNoCapAsNoLimit() {
        XCTAssertEqual(fitRenderSize(50000, 40000, .infinity), RenderSize(width: 50000, height: 40000))
        XCTAssertEqual(fitRenderSize(50000, 40000, 0), RenderSize(width: 50000, height: 40000))
        XCTAssertFalse(exceedsRenderSize(50000, 40000, .infinity))
    }
}
