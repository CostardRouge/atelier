// Port of `src/shared/media/compose-layout.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class EvenOutputSizeTests: XCTestCase {
    func testRoundsToEven() {
        XCTAssertEqual(even(1080), 1080)
        XCTAssertEqual(even(1083), 1084)
        XCTAssertEqual(even(607), 608)
    }

    func testDerivesOutputSizeFromAspectAndLongEdge() {
        XCTAssertEqual(outputSize(16, 9, 1920), Size(1920, 1080))
        XCTAssertEqual(outputSize(9, 16, 1920), Size(1080, 1920))
        XCTAssertEqual(outputSize(1, 1, 1080), Size(1080, 1080))
    }
}

final class PaneRectsTests: XCTestCase {
    func testSplitsSideBySideByTheVideoFraction() {
        let r = paneRects(1000, 500, .sideBySide, 0.6, 0.3, .br)
        XCTAssertEqual(r.video, Rect(0, 0, 600, 500))
        XCTAssertEqual(r.map, Rect(600, 0, 400, 500))
    }

    func testSplitsStackedByTheVideoFraction() {
        let r = paneRects(800, 1000, .stacked, 0.5, 0.3, .br)
        XCTAssertEqual(r.video, Rect(0, 0, 800, 500))
        XCTAssertEqual(r.map, Rect(0, 500, 800, 500))
    }

    func testClampsAnExtremeSplit() {
        let r = paneRects(1000, 500, .sideBySide, 0.99, 0.3, .br)
        XCTAssertEqual(r.video.width, 900) // clamped to 0.9
    }

    func testInsetsTheMapPipIntoACornerOverTheFullVideo() {
        let r = paneRects(1000, 1000, .pipMap, 0.5, 0.25, .br)
        XCTAssertEqual(r.video, Rect(0, 0, 1000, 1000))
        XCTAssertEqual(r.map.width, 250)
        XCTAssertEqual(r.map.height, 250)
        let margin = 30.0 // round(1000 * 0.03)
        XCTAssertEqual(r.map.x, 1000 - 250 - margin)
        XCTAssertEqual(r.map.y, 1000 - 250 - margin)
    }

    func testPipVideoSwapsWhichPaneIsFull() {
        let r = paneRects(1000, 1000, .pipVideo, 0.5, 0.25, .tl)
        XCTAssertEqual(r.map, Rect(0, 0, 1000, 1000))
        XCTAssertEqual(r.video.x, 30)
        XCTAssertEqual(r.video.y, 30)
    }
}

final class FitRectTests: XCTestCase {
    private let dst = Rect(0, 0, 100, 100)

    func testCoverCropsAWideSourceToASquarePane() {
        let r = fitRect(200, 100, dst, .cover)
        XCTAssertEqual(r.sw, 100) // crop width to match square
        XCTAssertEqual(r.sh, 100)
        XCTAssertEqual(r.sx, 50) // centred crop
        XCTAssertEqual(r.dw, 100)
        XCTAssertEqual(r.dh, 100)
    }

    func testContainLetterboxesAWideSourceInsideASquarePane() {
        let r = fitRect(200, 100, dst, .contain)
        XCTAssertEqual(r.dw, 100)
        XCTAssertEqual(r.dh, 50)
        XCTAssertEqual(r.dy, 25) // vertically centred bars
        XCTAssertEqual(r.sx, 0)
        XCTAssertEqual(r.sw, 200)
    }
}
