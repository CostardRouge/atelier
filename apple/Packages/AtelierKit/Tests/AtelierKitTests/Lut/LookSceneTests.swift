// Port of `src/shared/lut/look-scene.test.ts`, case for case. The four
// `asPreviewPicture` cases read DOM shapes (a canvas's own pixels, an `<img>`'s
// natural size) and stay here as skips with the reason — the app's picture is
// a `CIImage` whose extent is its measured size.

import XCTest
@testable import AtelierKit

final class SceneFrameTests: XCTestCase {
    func testLeavesAPictureThatAlreadyFitsAlone() {
        XCTAssertEqual(sceneFrame(800, 600), Size(800, 600))
    }

    func testScalesABigStillDownByAreaKeepingItsAspect() {
        // The maintainer's 48-megapixel drone JPEG.
        let frame = sceneFrame(8064, 6048)
        XCTAssertLessThanOrEqual(frame.width * frame.height, scenePixels)
        assertClose(frame.width / frame.height, 8064.0 / 6048.0, 2)
        // Two buffers of this cost single-digit megabytes, which is the point.
        XCTAssertLessThan(frame.width * frame.height * 4 * 2, 8 * 1024 * 1024)
    }

    func testKeepsAPortraitPortraitTheCanvasIsThePicture() {
        let frame = sceneFrame(3024, 4032)
        XCTAssertGreaterThan(frame.height, frame.width)
        assertClose(frame.width / frame.height, 3024.0 / 4032.0, 2)
    }

    func testAnswersZeroForASourceThatHasNoSizeYet() {
        XCTAssertEqual(sceneFrame(0, 0), Size(0, 0))
    }
}

final class AsPreviewPictureTests: XCTestCase {
    private let reason = "asPreviewPicture reads DOM shapes; the app's picture is a CIImage measured by its extent"

    func testPassesAMeasuredPictureStraightThrough() throws { throw XCTSkip(reason) }
    func testMeasuresACanvasOffItsOwnPixels() throws { throw XCTSkip(reason) }
    func testReadsAnImgOffItsNaturalSizeNotTheBoxItIsDrawnIn() throws { throw XCTSkip(reason) }
    func testAnswersNullForNoPictureAtAll() throws { throw XCTSkip(reason) }
}

final class SceneNoteTests: XCTestCase {
    func testWarnsWhenAConversionIsAimedAtADisplayReferredPicture() {
        XCTAssertTrue(sceneNote(.log, sourceIsLog: false)?.contains("expects a log source") == true)
    }

    func testSaysNothingWhenTheSourceReallyIsLog() {
        XCTAssertNil(sceneNote(.log, sourceIsLog: true))
    }

    func testNeverCautionsACreativeLookOnEitherKindOfSource() {
        XCTAssertNil(sceneNote(.rec709, sourceIsLog: false))
        XCTAssertNil(sceneNote(.rec709, sourceIsLog: true))
    }

    func testSaysNothingAboutALookWhoseFamilyIsUnknown() {
        XCTAssertNil(sceneNote(nil, sourceIsLog: false))
    }
}
