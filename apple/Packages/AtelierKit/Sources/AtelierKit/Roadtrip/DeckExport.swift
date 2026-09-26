// Rendering a whole deck to stills — the pure part of
// `src/shared/roadtrip/deck-export.ts`: which slides go, what each file is
// called, at what size and at what moment of its clock. The draw itself
// (`badgeToPng`, decoding a picture or a collage's cells, grading each cell
// with ITS develop) is the app's, over `slideRender` for what a slide is made
// of; a slide that fails to decode is skipped by the app, never the run.
//
// Rules kept:
// - One long edge for every still of a deck (`deckLongEdge`), exported,
//   because the *Delivers* row must ask its question against the very frame
//   the renderer writes.
// - A file is numbered against the WHOLE deck, never against the subset being
//   written: a carousel's third picture is `03` even when it is the only still.
// - A still is SETTLED: the hook past its badge's entrances (the caller's
//   `timeSeconds`), any slide holding a collage past its cells' entrance; a
//   content slide or the closing card otherwise at 0.
// - The closing card is never graded: it carries no picture.

import Foundation

/// The long edge every still of a deck is written at. The web's `DECK_LONG_EDGE`.
public let deckLongEdge = 1920

/// A frame of `aspect` (width / height) whose longest edge is `longEdge`
/// pixels — whole pixels, never below one. `badge-render.ts`'s `frameSize`.
public func frameSize(_ aspect: Double, _ longEdge: Double) -> Size {
    let w = aspect >= 1 ? longEdge : TripJS.round(longEdge * aspect)
    let h = aspect >= 1 ? TripJS.round(longEdge / aspect) : longEdge
    return Size(max(1, w), max(1, h))
}

/// One still of the run: the slide, its file, and the moment it is drawn at.
public struct DeckStill: Equatable, Sendable {
    public var slide: DeckSlide
    public var name: String
    /// Where the slide's animations are up to — settled.
    public var timeSeconds: Double

    public init(slide: DeckSlide, name: String, timeSeconds: Double) {
        self.slide = slide; self.name = name; self.timeSeconds = timeSeconds
    }
}

/// The moment a still of `slide` is drawn at: past the badge's entrances on
/// the hook (`timeSeconds`), past the cells' own entrance on a collage.
public func deckStillSeconds(_ slide: DeckSlide, _ aspect: Double, _ timeSeconds: Double) -> Double {
    max(slide.kind == .hook ? timeSeconds : 0, collageSettleSeconds(slide.collage, aspect))
}

/// The stills a deck render writes, in swipe order: every slide, or those
/// `include` keeps (the piece export passes the stills alone, the rest going
/// out as video), each named against the whole deck.
public func deckStills(_ trip: TripDoc, _ post: TripPost, _ aspect: Double, _ timeSeconds: Double,
                       include: ((DeckSlide) -> Bool)? = nil) -> [DeckStill] {
    let all = deckSlides(trip, post)
    let slides = include.map { all.filter($0) } ?? all
    let title = post.title.trimmingCharacters(in: .whitespacesAndNewlines)
    let slug = title.isEmpty ? "day-\(post.date)" : title
    return slides.map { slide in
        DeckStill(slide: slide, name: slideFileName(trip.name, slug, slide, all.count),
                  timeSeconds: deckStillSeconds(slide, aspect, timeSeconds))
    }
}
