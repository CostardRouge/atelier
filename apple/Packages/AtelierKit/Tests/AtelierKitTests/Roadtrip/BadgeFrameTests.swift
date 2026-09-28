// `src/shared/roadtrip/thumbnail.test.ts`, one for one, plus the piece's own
// aspect (the web's `ASPECT_PRESETS.find(…) ?? ASPECT_PRESETS[0]`).

import XCTest
@testable import AtelierKit

final class ThumbSizeTests: XCTestCase {
    func testFitsTheLongestEdgeKeepingTheShape() {
        XCTAssertTrue(thumbSize(720, 900, 224) == (179, 224))
        XCTAssertTrue(thumbSize(900, 720, 224) == (224, 179))
    }

    func testNeverUpscalesASmallPreviewStaysSmall() {
        XCTAssertTrue(thumbSize(120, 150, 224) == (120, 150))
    }

    func testKeepsASquareSquare() {
        let size = thumbSize(900, 900)
        XCTAssertEqual(size.w, Int(thumbLongEdge))
        XCTAssertEqual(size.h, Int(thumbLongEdge))
    }

    // The badge preview is at least `previewLongEdge` (720), so the stored
    // size is always reached — what makes raising the thumbnail's edge do
    // anything, since it never upscales.
    func testIsFullyReachedFromTheSmallestPreviewTheStageEverPaints() {
        XCTAssertLessThanOrEqual(thumbLongEdge, previewLongEdge)
        let size = thumbSize(405, previewLongEdge)
        XCTAssertEqual(max(size.w, size.h), Int(thumbLongEdge))
    }

    func testNeverReturnsAZeroSideForAVeryWideSource() {
        let size = thumbSize(4000, 20, 224)
        XCTAssertGreaterThan(size.w, 0)
        XCTAssertGreaterThan(size.h, 0)
    }

    func testIsNothingAtAllForAnEmptyCanvas() {
        XCTAssertTrue(thumbSize(0, 0) == (0, 0))
    }
}

final class PieceAspectTests: XCTestCase {
    func testAPieceIsComposedInItsOwnPreset() {
        var post = createTripPost(.photo, "2025-03-27", "Cliffs")
        post.badge.aspectId = "4:5"
        XCTAssertEqual(pieceAspect(post), 4.0 / 5)
        XCTAssertEqual(pieceAspectPreset(post).id, "4:5")
    }

    func testAnUnknownAspectFallsBackToTheFirstPreset() {
        var post = createTripPost(.photo, "2025-03-27", "Cliffs")
        post.badge.aspectId = "7:3"
        XCTAssertEqual(pieceAspectPreset(post).id, aspectPresets[0].id)
        XCTAssertEqual(pieceAspect(post), 9.0 / 16)
    }
}
