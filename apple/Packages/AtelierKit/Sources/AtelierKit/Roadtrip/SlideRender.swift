// Everything a renderer needs to draw ONE slide of a deck, in one place.
// Port of `src/shared/roadtrip/slide-render.ts`.
//
// A slide's picture is composed from different things depending on what the
// slide IS — the badge over the hook, a caption over a content picture, the
// trip's card at the end — and every surface that draws a deck (the stage,
// the still export, the rail's thumbnails) derives it HERE, so a thumbnail
// cannot show a picture the export does not deliver.
//
// Rules kept:
// - The badge's CLOCK is not here: it changes sixty times a second while the
//   transport plays; the caller paints at whatever second it is drawing. The
//   opener is handed prepared and time-parameterised (`hook`), with the
//   badge's per-frame elements when it rewrites them (`elementsAt`).
// - The closing card is a flat card: no title style, its own inks, its QR.
// - A shade set to follow the hook ends at the badge block's own edge, so the
//   block travels with the render.
// - The opener's pictures and the hook picture's EXIF are READ by the caller
//   and handed in, never fetched: a caller with none gets a map without them
//   and a badge without a camera credit, rather than a stand-in.
// - A trip whose span cannot be read renders its picture with nothing over it.

import Foundation

/// What one slide is made of, bar its picture, its grade and its clock.
public struct SlideRender {
    public var elements: [OverlayElement]
    /// The trip's title style; never the closing card, which is a flat card.
    public var theme: StyleTheme?
    /// Darkening over the picture, under the badge — the hook's alone.
    public var shades: [Shade]?
    /// The badge block's extent, for a shade that follows the hook.
    public var block: HookBlock?
    /// Painted where no picture covers the frame.
    public var background: String?
    public var qr: QrDraw?
    /// How this slide's picture sits in its frame.
    public var framing: Framing
    /// The piece's OPENER, prepared — the hook slide's alone.
    public var hook: ResolvedHook?
    /// The badge's elements at a moment, when the opener rewrites its words.
    public var elementsAt: ElementsAt?

    public init(elements: [OverlayElement], theme: StyleTheme?, shades: [Shade]?, block: HookBlock?,
                background: String?, qr: QrDraw?, framing: Framing, hook: ResolvedHook?, elementsAt: ElementsAt?) {
        self.elements = elements; self.theme = theme; self.shades = shades; self.block = block
        self.background = background; self.qr = qr; self.framing = framing; self.hook = hook
        self.elementsAt = elementsAt
    }
}

/// What `slide` of `post` draws on a frame of `aspect`. `pictures` are the
/// opener's pictures, already decoded; `exif` the hook picture's effective
/// EXIF, already read (nil: the picture says nothing); `today` the day the
/// WHEN line is read on when the piece names none.
public func slideRender(_ trip: TripDoc, _ post: TripPost, _ slide: DeckSlide, _ aspect: Double,
                        _ pictures: [String: HookPicture]? = nil, _ exif: ExifData? = nil,
                        today: IsoDate = todayIso(Date(), in: .current)) -> SlideRender {
    switch slide.kind {
    case .cta:
        let card = ctaLayout(trip.cta, aspect)
        let qr = card.qr.map {
            QrDraw(x: $0.x, y: $0.y, sizeFrac: $0.sizeFrac, matrix: $0.matrix, dark: trip.cta.ink,
                   light: trip.cta.background)
        }
        // The closing card is not part of the trip's title-style deck.
        return SlideRender(elements: card.elements, theme: nil, shades: nil, block: nil,
                           background: trip.cta.background, qr: qr, framing: slide.framing, hook: nil, elementsAt: nil)

    case .content:
        return SlideRender(elements: contentSlideElements(slide.caption, aspect), theme: trip.theme, shades: nil,
                           block: nil, background: nil, qr: nil, framing: slide.framing, hook: nil, elementsAt: nil)

    case .hook:
        let badge = post.badge
        let content = badgeContent(trip, post, BadgeOptions(
            mode: badge.mode,
            words: trip.badgeWords,
            timeAgo: badge.timeAgo,
            referenceDate: badge.referenceDate,
            showPin: badge.showPin,
            showExif: badge.showExif,
            exif: .some(exif),
            camera: badge.camera,
            cameraNames: trip.cameraNames,
            overrides: badge.textOverrides,
            today: today
        ))
        // The opener's pictures reach it here or not at all.
        let hook = resolveHook(badge.hook, hookContextFor(trip, post, aspect, content, pictures))
        let elements = content.map {
            badgeElements($0, badge.layout, aspect, badge.pieceStyles, badge.durationSeconds, badge.cascade)
        } ?? []
        return SlideRender(
            elements: elements,
            theme: trip.theme,
            shades: badge.shades,
            // A shade that follows the hook ends at the block's own edge.
            block: content.flatMap { badgeBlockExtent($0, badge.layout, aspect) },
            background: nil,
            qr: nil,
            framing: slide.framing,
            hook: hook,
            elementsAt: hookElementsAt(hook, content, badge.layout, aspect, badge.pieceStyles,
                                       badge.durationSeconds, badge.cascade)
        )
    }
}
