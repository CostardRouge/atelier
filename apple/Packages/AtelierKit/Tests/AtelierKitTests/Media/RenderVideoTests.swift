// Port of the pure cases of `src/shared/media/render-video.test.ts`:
// `paintedOutputSize` and `paintedFps`. Its `encodeFrames` cases drive a
// stubbed WebCodecs encoder and the real mp4-muxer; the native loop runs on
// `AVAssetWriter`, which no Linux spec can reach — the first device run is
// where it is measured (`apple/Atelier/Video/VideoExport.swift`).

import Foundation
import XCTest
@testable import AtelierKit

final class RenderVideoTests: XCTestCase {
    // MARK: paintedOutputSize

    func testKeepsAnAlreadyEvenSize() {
        let size = paintedOutputSize(1080, 1920)
        XCTAssertEqual(size.w, 1080)
        XCTAssertEqual(size.h, 1920)
    }

    func testRoundsAnOddDimensionWhichH264CannotEncode() {
        let size = paintedOutputSize(1081, 1921)
        XCTAssertEqual(size.w, 1082)
        XCTAssertEqual(size.h, 1922)
    }

    func testNeverReturnsZeroWhateverItIsHanded() {
        let zero = paintedOutputSize(0, 0)
        XCTAssertEqual(zero.w, 2)
        XCTAssertEqual(zero.h, 2)
        let nonsense = paintedOutputSize(Double.nan, -40)
        XCTAssertEqual(nonsense.w, 2)
        XCTAssertEqual(nonsense.h, 2)
    }

    // MARK: paintedFps

    func testDefaultsWhenNothingIsAskedFor() {
        XCTAssertEqual(paintedFps(nil), defaultPaintedFps)
    }

    func testClampsToASaneRangeAndRounds() {
        XCTAssertEqual(paintedFps(24.4), 24)
        XCTAssertEqual(paintedFps(500), 60)
        XCTAssertEqual(paintedFps(0), defaultPaintedFps)
        XCTAssertEqual(paintedFps(Double.nan), defaultPaintedFps)
    }
}
