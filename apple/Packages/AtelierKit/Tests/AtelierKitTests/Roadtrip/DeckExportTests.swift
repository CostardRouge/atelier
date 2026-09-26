// `src/shared/roadtrip/deck-export.ts` has no web spec: its render is a
// canvas run. This pins the pure part the port keeps — the deck's one long
// edge and a frame's size, the stills a run writes and their names (numbered
// against the WHOLE deck), and the settled moment each is drawn at.

import XCTest
@testable import AtelierKit

final class DeckExportFrameTests: XCTestCase {
    func testWritesEveryStillOfADeckAtOneLongEdge() {
        XCTAssertEqual(deckLongEdge, 1920)
    }

    func testSizesAFrameByItsLongEdgeInWholePixels() {
        XCTAssertEqual(frameSize(4.0 / 5, 1920), Size(1536, 1920))
        XCTAssertEqual(frameSize(9.0 / 16, 1920), Size(1080, 1920))
        XCTAssertEqual(frameSize(16.0 / 9, 1920), Size(1920, 1080))
        XCTAssertEqual(frameSize(1, 720), Size(720, 720))
        XCTAssertEqual(frameSize(0.0001, 100), Size(1, 100))
    }
}

final class DeckExportStillsTests: XCTestCase {
    private func carousel() -> TripPost {
        deckPost {
            $0.slides = [createPostSlide(deckRef("IMG_2.JPG")), createPostSlide(deckRef("CLIP.MP4"))]
            $0.includeCta = true
        }
    }

    func testWritesTheWholeDeckInSwipeOrderByDefault() {
        let stills = deckStills(deckTrip(), carousel(), 4.0 / 5, 2)
        XCTAssertEqual(stills.map(\.name), [
            "australia-kalbarri-cliffs-01-hook.png",
            "australia-kalbarri-cliffs-02.png",
            "australia-kalbarri-cliffs-03.png",
            "australia-kalbarri-cliffs-04-cta.png",
        ])
    }

    func testNumbersASubsetAgainstTheWholeDeck() {
        let stills = deckStills(deckTrip(), carousel(), 4.0 / 5, 2) { $0.medium == .image && $0.kind == .content }
        XCTAssertEqual(stills.map(\.name), ["australia-kalbarri-cliffs-02.png"])
    }

    func testNamesAnUntitledPieceByItsDay() {
        let post = deckPost { $0.title = "  " }
        XCTAssertEqual(deckStills(deckTrip(), post, 1, 0).map(\.name), ["australia-day-2025-03-27-01-hook.png"])
    }

    func testSettlesTheHookAtTheAskedMomentAndEverythingElseAtRest() {
        let stills = deckStills(deckTrip(), carousel(), 4.0 / 5, 2.5)
        XCTAssertEqual(stills.map(\.timeSeconds), [2.5, 0, 0, 0])
    }

    func testTakesACollageSlidePastItsCellsEntrance() throws {
        var collage = try XCTUnwrap(createCollage("grid-2x2"))
        collage.enter = CollageEnter(step: AnimStep(preset: .fade, duration: 0.5, easing: .linear),
                                     stagger: Stagger(each: 0.25, order: .rows))
        var slide = createPostSlide(deckRef("IMG_2.JPG"))
        slide.collage = collage
        let stills = deckStills(deckTrip(), deckPost { $0.slides = [slide] }, 1080.0 / 1920, 0.1)
        assertClose(stills[1].timeSeconds, collageSettleSeconds(collage, 1080.0 / 1920), 9)
        assertClose(stills[1].timeSeconds, 0.75, 2)
        // The hook's own clock wins when it is later than its cells'.
        XCTAssertEqual(deckStillSeconds(stills[0].slide, 1, 3), 3)
    }
}
