// Port of `src/shared/roadtrip/deck-strip.test.ts` — every case: looping, the
// strip's layout, locating a moment, time ↔ x, snapping, stepping, a clip's
// screen length and a slide's motion marks.

import XCTest
@testable import AtelierKit

// A hook of 5s, a still of 3s, a half-second clip, the closing card of 3s —
// at 40 px a second with a 24 px floor and 2 px between cells.
private let layout = stripLayout([5, 3, 0.5, 3], 40, 24, 2)

final class DeckStripLoopingTests: XCTestCase {
    func testMovesOnThroughThePieceAndStartsItOverAfterTheLastSlide() {
        XCTAssertEqual(nextAtEnd(0, 4, .piece), 1)
        XCTAssertEqual(nextAtEnd(2, 4, .piece), 3)
        XCTAssertEqual(nextAtEnd(3, 4, .piece), 0)
    }

    func testStartsTheOpenSlideOverWhenTheSlideLoopsOrWhenItIsTheWholePiece() {
        XCTAssertEqual(nextAtEnd(2, 4, .slide), 2)
        XCTAssertEqual(nextAtEnd(0, 1, .piece), 0)
        XCTAssertTrue(loopsOpenSlide(.slide, 4))
        XCTAssertFalse(loopsOpenSlide(.piece, 4))
        XCTAssertTrue(loopsOpenSlide(.piece, 1))
    }

    func testNeverPointsPastTheDeck() {
        XCTAssertEqual(nextAtEnd(9, 4, .slide), 3)
        XCTAssertEqual(nextAtEnd(0, 0, .piece), 0)
    }
}

final class DeckStripLayoutTests: XCTestCase {
    func testLaysTheSlidesEndToEndOnOneClock() {
        XCTAssertEqual(layout.cells.map(\.start), [0, 5, 8, 8.5])
        XCTAssertEqual(layout.seconds, 11.5)
    }

    func testKeepsAShortSlideWideEnoughToLandOn() {
        XCTAssertEqual(layout.cells.map(\.width), [200, 120, 24, 120])
        XCTAssertEqual(layout.cells.map(\.left), [0, 202, 324, 350])
        XCTAssertEqual(layout.width, 470)
    }

    func testIsEmptyForAnEmptyDeck() {
        XCTAssertEqual(stripLayout([], 40, 24, 2), StripLayout(cells: [], seconds: 0, width: 0))
        XCTAssertEqual(locate(stripLayout([], 40, 24, 2), 3), StripPlace(index: 0, local: 0))
    }
}

final class DeckStripLocateTests: XCTestCase {
    func testNamesTheSlideUnderAMomentAndHowFarIntoIt() {
        XCTAssertEqual(locate(layout, 0), StripPlace(index: 0, local: 0))
        XCTAssertEqual(locate(layout, 6), StripPlace(index: 1, local: 1))
        XCTAssertEqual(locate(layout, 8.25), StripPlace(index: 2, local: 0.25))
    }

    func testGivesABoundaryToTheSlideThatStartsThere() {
        XCTAssertEqual(locate(layout, 5).index, 1)
    }

    func testGivesTheEndOfThePieceToTheLastSlideAtItsEnd() {
        XCTAssertEqual(locate(layout, 11.5), StripPlace(index: 3, local: 3))
        XCTAssertEqual(locate(layout, 99), StripPlace(index: 3, local: 3))
        XCTAssertEqual(locate(layout, -1), StripPlace(index: 0, local: 0))
    }
}

final class DeckStripTimeAndXTests: XCTestCase {
    func testIsLinearInsideACell() {
        XCTAssertEqual(xAtTime(layout, 2.5), 100)
        XCTAssertEqual(xAtTime(layout, 8.25), 336)
        XCTAssertEqual(timeAtX(layout, 100), 2.5)
        XCTAssertEqual(timeAtX(layout, 336), 8.25)
    }

    func testRoundTripsThroughTheFloorOfAShortCell() {
        for t in [0, 1.3, 5, 7.9, 8.1, 8.4, 10] {
            assertClose(timeAtX(layout, xAtTime(layout, t)), t, 9)
        }
    }

    func testReadsAGapAsTheEndOfTheCellBeforeItAndClamps() {
        XCTAssertEqual(timeAtX(layout, 201), 5)
        XCTAssertEqual(timeAtX(layout, -40), 0)
        XCTAssertEqual(timeAtX(layout, 9999), 11.5)
    }
}

final class DeckStripSnapTests: XCTestCase {
    func testPullsAMomentOntoASlideEdgeWithinTheTolerance() {
        // 5.1s is 4 px into the still.
        XCTAssertEqual(snapToEdge(layout, 5.1, 8), 5)
        XCTAssertEqual(snapToEdge(layout, 4.9, 8), 5)
    }

    func testLeavesAMomentAwayFromEveryEdgeAlone() {
        XCTAssertEqual(snapToEdge(layout, 6.5, 8), 6.5)
    }
}

final class DeckStripStepTests: XCTestCase {
    func testGoesToTheNextSlideOrTheEndOfThePiece() {
        XCTAssertEqual(stepSlide(layout, 1, 1), 5)
        XCTAssertEqual(stepSlide(layout, 9, 1), 11.5)
    }

    func testGoesBackToThisSlideThenToTheOneBefore() {
        XCTAssertEqual(stepSlide(layout, 6, -1), 5)
        XCTAssertEqual(stepSlide(layout, 5, -1), 0)
        XCTAssertEqual(stepSlide(layout, 0, -1), 0)
    }
}

final class DeckStripScreenLengthTests: XCTestCase {
    func testHoldsTheStoredSecondsWhenNothingCapsThem() {
        XCTAssertEqual(screenLength(seconds: 5, videoTimeSeconds: 1, speed: 1, 0), 5)
        XCTAssertEqual(screenLength(seconds: 5, videoTimeSeconds: 1, speed: 1, 20), 5)
    }

    func testCapsAClipToWhatIsLeftAfterItsInPoint() {
        XCTAssertEqual(screenLength(seconds: 5, videoTimeSeconds: 1, speed: 1, 3), 2)
        XCTAssertEqual(screenLength(seconds: 5, videoTimeSeconds: 1, speed: 2, 3), 1)
    }
}

final class DeckStripMotionMarksTests: XCTestCase {
    private func m(_ at: Double, _ start: MotionStart = .slide) -> FramingMotion {
        FramingMotion(keys: [FramingKey(at: at, scale: 2, x: 0, y: 0)], easing: .linear, start: start)
    }

    func testMarksTheLeadsFramesAndItsRest() {
        XCTAssertEqual(slideMotionMarks(motion: m(0), collage: nil, 4), [0, 4])
        XCTAssertEqual(slideMotionMarks(motion: nil, collage: nil, 4), [])
    }

    func testMergesADrawnCellsFramesAndLeavesAKeptCellOut() throws {
        var collage = try XCTUnwrap(createCollage("stack-2"))
        var first = collage.cells[0]
        first.motion = m(0.5)
        var second = collage.cells[0]
        second.motion = m(0.25)
        collage.cells = [first, second]
        // Cell 3 is past the two-row template: kept, not drawn, not marked.
        XCTAssertEqual(slideMotionMarks(motion: m(0), collage: collage, 4), [0, 2, 4])
    }

    func testWaitsForTheOpenerWhenTheMotionDoes() {
        XCTAssertEqual(slideMotionMarks(motion: m(0, .afterOpener), collage: nil, 5, 1), [1, 5])
    }
}
