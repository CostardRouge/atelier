// Port of `src/shared/roadtrip/slide-render.test.ts` — every case: the hook
// gets the badge, its shades and its block; a content slide its caption; each
// slide its own framing; the closing card the trip's colours and no title
// style; a badge-less trip an empty overlay.

import XCTest
@testable import AtelierKit

private let aspect = 4.0 / 5

final class SlideRenderTests: XCTestCase {
    func testGivesTheHookTheBadgeItsShadesAndItsBlock() throws {
        let t = deckTrip()
        let p = deckPost()
        let hook = deckSlides(t, p)[0]
        let render = slideRender(t, p, hook, aspect)

        let content = try XCTUnwrap(badgeContent(t, p, BadgeOptions(
            mode: p.badge.mode, words: t.badgeWords, timeAgo: p.badge.timeAgo, referenceDate: p.badge.referenceDate,
            showPin: p.badge.showPin, overrides: p.badge.textOverrides
        )))
        XCTAssertEqual(render.elements, badgeElements(content, p.badge.layout, aspect, p.badge.pieceStyles,
                                                      p.badge.durationSeconds))
        XCTAssertEqual(render.shades, p.badge.shades)
        // A shade that follows the hook needs the block, or it falls back to the
        // plain reach and lands somewhere else than in the preview.
        XCTAssertEqual(render.block, badgeBlockExtent(content, p.badge.layout, aspect))
        XCTAssertNil(render.qr)
    }

    func testGivesAContentSlideItsCaptionAndNothingOfTheBadge() {
        let t = deckTrip()
        var slide = createPostSlide(nil)
        slide.caption = "Over the gorge"
        let p = deckPost { $0.slides = [slide] }
        let render = slideRender(t, p, deckSlides(t, p)[1], aspect)

        XCTAssertEqual(render.elements, contentSlideElements("Over the gorge", aspect))
        XCTAssertNil(render.shades)
        XCTAssertNil(render.block)
        XCTAssertEqual(render.theme, t.theme)
    }

    func testCarriesEachSlidesOwnFraming() {
        let t = deckTrip()
        let own = Framing(scale: 2.5, x: 0.1, y: -0.2, rotation: 90, flipY: true)
        let p = deckPost {
            $0.badge.framing = own
            $0.slides = [createPostSlide(nil)]
        }
        let deck = deckSlides(t, p)
        XCTAssertEqual(slideRender(t, p, deck[0], aspect).framing, own)
        XCTAssertEqual(slideRender(t, p, deck[1], aspect).framing, deck[1].framing)
    }

    func testGivesTheClosingCardTheTripsColoursAndNoTitleStyle() throws {
        let t = deckTrip {
            $0.cta.headline = "Follow the trip"
            $0.cta.url = "https://example.com"
            $0.cta.showQr = true
        }
        let p = deckPost { $0.includeCta = true }
        let deck = deckSlides(t, p)
        let card = deck[deck.count - 1]
        let render = slideRender(t, p, card, aspect)

        XCTAssertEqual(card.kind, .cta)
        XCTAssertNil(render.theme)
        XCTAssertEqual(render.background, t.cta.background)
        let qr = try XCTUnwrap(render.qr)
        XCTAssertEqual(qr.dark, t.cta.ink)
        XCTAssertEqual(qr.light, t.cta.background)
        XCTAssertNil(render.shades)
    }

    func testDrawsABadgeLessTripAsAnEmptyOverlayRatherThanFailing() {
        // A reversed span is what makes `badgeContent` refuse: the slide still
        // renders, as its picture with nothing over it.
        let t = deckTrip {
            $0.startDate = "2026-01-04"
            $0.endDate = "2025-03-01"
        }
        let p = deckPost()
        let render = slideRender(t, p, deckSlides(t, p)[0], aspect)
        XCTAssertEqual(render.elements, [])
        XCTAssertNil(render.block)
    }
}
