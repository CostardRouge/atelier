// Port of `src/shared/roadtrip/hooks/picture-budget.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class TripCoverCropTests: XCTestCase {
    func testKeepsTheCentredSliceOfALandscapePictureAPortraitFrameShows() {
        let c = coverCrop(4000, 3000, 9.0 / 16, .infinity)
        XCTAssertEqual(c.sh, 3000)
        assertClose(c.sw, 3000 * (9.0 / 16), 6)
        assertClose(c.sx, (4000 - c.sw) / 2, 6)
        XCTAssertEqual(c.sy, 0)
    }

    func testKeepsTheCentredBandOfAPortraitPictureALandscapeFrameShows() {
        let c = coverCrop(3000, 4000, 16.0 / 9, .infinity)
        XCTAssertEqual(c.sw, 3000)
        assertClose(c.sh, 3000 / (16.0 / 9), 6)
        XCTAssertEqual(c.sx, 0)
        assertClose(c.sy, (4000 - c.sh) / 2, 6)
    }

    func testDecodesAtTheSizeADeliveredFrameShowsNotTheCameras() {
        let portrait = coverCrop(8000, 6000, 9.0 / 16, .infinity)
        XCTAssertEqual(portrait.width, 1080)
        XCTAssertEqual(portrait.height, 1920)
        let landscape = coverCrop(8000, 6000, 16.0 / 9, .infinity)
        XCTAssertEqual(landscape.width, 1920)
        XCTAssertEqual(landscape.height, 1080)
    }

    func testNeverUpscalesASmallPicture() {
        let c = coverCrop(640, 480, 9.0 / 16, .infinity)
        XCTAssertEqual(c.width, 270)
        XCTAssertEqual(c.height, 480)
    }

    func testShrinksUnderThePixelCapAndKeepsTheFramesShape() {
        let c = coverCrop(8000, 6000, 9.0 / 16, 500_000)
        XCTAssertLessThanOrEqual(c.width * c.height, 500_000 + c.width)
        assertClose(Double(c.width) / Double(c.height), 9.0 / 16, 2)
    }

    func testSurvivesANonsenseAspectAndAZeroSize() {
        let c = coverCrop(0, 0, .nan, 1000)
        XCTAssertGreaterThanOrEqual(c.width, 1)
        XCTAssertGreaterThanOrEqual(c.height, 1)
    }
}

final class TripWholeCropTests: XCTestCase {
    func testKeepsTheWholePictureAtItsOwnShapeNoLargerThanAPrintNeeds() {
        let c = wholeCrop(6000, 4000, .infinity)
        XCTAssertEqual([c.sx, c.sy, c.sw, c.sh], [0, 0, 6000, 4000])
        XCTAssertEqual(Double(c.width), printLongEdge)
        XCTAssertEqual(Double(c.height), (printLongEdge / 1.5).rounded())
        let portrait = wholeCrop(4000, 6000, .infinity)
        XCTAssertEqual(Double(portrait.height), printLongEdge)
        XCTAssertEqual(Double(portrait.width), (printLongEdge / 1.5).rounded(.down))
    }

    func testNeverEnlargesAndShrinksUnderThePixelCap() {
        let small = wholeCrop(300, 200, .infinity)
        XCTAssertEqual(small.width, 300)
        XCTAssertEqual(small.height, 200)
        let capped = wholeCrop(6000, 4000, 300_000)
        XCTAssertLessThanOrEqual(capped.width * capped.height, 300_000 + capped.width)
        assertClose(Double(capped.width) / Double(capped.height), 1.5, 2)
    }
}

final class TripPerPicturePixelsTests: XCTestCase {
    func testLetsADozenPicturesDecodeAtFullFrameSize() {
        XCTAssertGreaterThan(perPicturePixels(12), 1080 * 1920)
    }

    func testSharesOneBudgetSoFortyPicturesHoldNoMoreThanADozenWould() {
        assertClose(perPicturePixels(40) * 40, picturesPixelBudget, 6)
        XCTAssertEqual(perPicturePixels(0), picturesPixelBudget)
    }
}
