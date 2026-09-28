// Any slide of a piece's deck, at any second, at any size — the one object
// the stage, the rail's thumbnails, the PNG deck and every painted clip draw
// a slide through. What a slide is made of is the kernel's `slideRender`
// (the badge over the hook, a caption over a content picture, the trip's card
// at the end, each with its framing, its shades and its prepared opener);
// its look is `TripSlideLooks`; the paint is `BadgeRenderer`. So a thumbnail
// cannot show a picture the export does not deliver, and the preview IS the
// export resampled.
//
// Rules kept (`roadtrip.md`):
// - The graders are CALLER-OWNED and this is the caller: one per look (grade
//   × develop × film), kept across frames and dropped with the renderer —
//   never one per repaint.
// - A slide drawn SETTLED (a still, the rail) is handed no clock: its picture
//   is drawn at its rest and a collage's cells never leave. A slide PLAYED
//   (the transport, a painted clip) is handed its clock — its screen time
//   and the opener's own length — and its picture moves on it.
// - The opener's pictures and the hook picture's EXIF are READ by the caller
//   and handed in, never fetched here: a renderer with none draws a map
//   without them and a badge without a camera credit, never a stand-in.
// - A slide whose picture is missing still renders — its badge or caption
//   over the flat ground — because losing a file must never cost the piece.

import AtelierKit
import CoreGraphics
import Foundation

/// The clock a slide is PLAYED on: its screen time and the opener's own
/// length. Nil draws the slide settled.
struct SlideClock: Equatable {
    var seconds: Double
    var openerSeconds: Double

    init(seconds: Double, openerSeconds: Double = 0) {
        self.seconds = seconds
        self.openerSeconds = openerSeconds
    }
}

/// A slide's decoded pictures: the lead, or a collage's cells lead first
/// (an empty cell is nil). Loaded by the caller (`BadgeSources`), kept by it
/// across frames.
struct SlideSources {
    var lead: BadgeSource?
    var cells: [BadgeSource?]

    init(lead: BadgeSource? = nil, cells: [BadgeSource?] = []) {
        self.lead = lead
        self.cells = cells
    }

    static let empty = SlideSources()
}

final class SlideRenderer {
    let trip: TripDoc
    let post: TripPost
    /// The frame's aspect (width / height) the piece is composed in.
    let aspect: Double
    /// The opener's pictures, decoded (`HookPictureLoader`).
    let pictures: [String: HookPicture]?
    /// The hook picture's effective EXIF, when the piece credits its camera.
    let exif: ExifData?
    /// The day the WHEN line is read on when the piece names none.
    let today: IsoDate
    let looks: TripSlideLooks
    let badge: BadgeRenderer

    private var made: [Int: SlideRender] = [:]
    private var graders: [String: FrameGrader] = [:]

    init(trip: TripDoc, post: TripPost, aspect: Double? = nil, pictures: [String: HookPicture]? = nil,
         exif: ExifData? = nil, today: IsoDate = todayIso(Date(), in: .current),
         looks: TripSlideLooks = TripSlideLooks(), badge: BadgeRenderer = BadgeRenderer()) {
        self.trip = trip
        self.post = post
        self.aspect = aspect ?? pieceAspect(post)
        self.pictures = pictures
        self.exif = exif
        self.today = today
        self.looks = looks
        self.badge = badge
    }

    /// The deck, in swipe order.
    var slides: [DeckSlide] { deckSlides(trip, post) }

    /// What `slide` is made of, derived once per renderer.
    func render(_ slide: DeckSlide) -> SlideRender {
        if let hit = made[slide.position] { return hit }
        let r = slideRender(trip, post, slide, aspect, pictures, exif, today: today)
        made[slide.position] = r
        return r
    }

    /// The prepared opener, when `slide` is the hook — its length is what a
    /// clock's `openerSeconds` is.
    func hook(_ slide: DeckSlide) -> ResolvedHook? {
        render(slide).hook
    }

    /// When a still of `slide` is taken: past the badge's entrances on the
    /// hook (`hookSeconds`, the badge's settled second), past a collage's
    /// entrance on any slide that holds one.
    func stillSeconds(_ slide: DeckSlide, hookSeconds: Double) -> Double {
        deckStillSeconds(slide, aspect, hookSeconds)
    }

    // MARK: - the options

    /// Everything one frame of `slide` at `t` is painted with.
    func options(_ slide: DeckSlide, _ sources: SlideSources, at t: Double, clock: SlideClock? = nil,
                 ghostId: String? = nil) -> BadgeRenderOptions {
        let r = render(slide)
        var o = BadgeRenderOptions(elements: r.elements, theme: r.theme)
        o.timeSeconds = t
        o.background = r.background
        o.shades = r.shades
        o.block = r.block
        o.hook = r.hook
        o.elementsAt = r.elementsAt
        o.qr = r.qr
        o.framing = r.framing
        o.ghostId = ghostId
        let motionClock = clock.map {
            MotionClock(motion: slide.motion, seconds: $0.seconds, openerSeconds: $0.openerSeconds)
        }

        if let collage = slide.collage {
            let lead = CollageLead(media: slide.media, framing: slide.framing, develop: slide.develop, motion: slide.motion)
            var items: [CollageItem] = []
            for i in 0..<collageCellCount(collage) {
                let cell = collageCellAt(lead, collage, i)
                let source = i < sources.cells.count ? sources.cells[i] : nil
                let graded = graderFor(slide, develop: .some(cell.develop))
                items.append(CollageItem(source: source, framing: cell.framing, motion: cell.motion,
                                         grader: graded?.grader, gradeKey: graded?.key))
            }
            o.collage = CollageRender(collage: collage, items: items, seconds: clock?.seconds, clock: motionClock)
        } else {
            o.source = sources.lead
            let graded = graderFor(slide)
            o.grader = graded?.grader
            o.gradeKey = graded?.key
            o.motion = motionClock
        }
        return o
    }

    /// The grader one picture of the deck is rendered through, made once per
    /// look and kept; nil where nothing grades it (the closing card, a look
    /// that changes no pixel).
    private func graderFor(_ slide: DeckSlide, develop: DevelopSettings?? = .none) -> (grader: FrameGrader, key: String)? {
        guard let key = looks.key(slide, trip, post, develop: develop) else { return nil }
        let filmKey = looks.film(slide, trip, post).map { $0.json.serialized() } ?? "no-film"
        let full = "\(key)|\(filmKey)"
        if let kept = graders[full] { return (kept, full) }
        guard let made = looks.grader(slide, trip, post, develop: develop) else { return nil }
        graders[full] = made.grader
        return (made.grader, full)
    }

    // MARK: - drawing

    /// `slide` at `t` onto `c`'s whole frame.
    func draw(_ slide: DeckSlide, _ sources: SlideSources, at t: Double, on c: PaintCanvas,
              clock: SlideClock? = nil, ghostId: String? = nil) {
        badge.render(c, options(slide, sources, at: t, clock: clock, ghostId: ghostId))
    }

    /// The same into a context whose user space is the `size` frame, y down —
    /// a SwiftUI `Canvas`'s space, or an `OverlayRaster` bitmap.
    func draw(_ slide: DeckSlide, _ sources: SlideSources, at t: Double, in cg: CGContext, size: CGSize,
              clock: SlideClock? = nil, ghostId: String? = nil) {
        badge.render(in: cg, size: size, options(slide, sources, at: t, clock: clock, ghostId: ghostId))
    }

    /// `slide` at `t` as a `width`×`height` image — a still, a thumbnail, one
    /// frame of a painted clip.
    func image(_ slide: DeckSlide, _ sources: SlideSources, at t: Double, width: Int, height: Int,
               clock: SlideClock? = nil) -> CGImage? {
        badge.image(width: width, height: height, options(slide, sources, at: t, clock: clock))
    }

    /// The hit boxes of `slide`'s elements at `t` on a `size` frame — the
    /// stage's selection outline and tap target, laid out as the paint is.
    func measure(_ slide: DeckSlide, at t: Double, size: CGSize, ghostId: String? = nil) -> [OverlayGeometry.ElementBox] {
        badge.measure(size: size, options(slide, .empty, at: t, ghostId: ghostId))
    }

    /// Let go of every grader and every held grade — a new look is coming.
    func releaseGrades() {
        graders.removeAll()
    }
}
