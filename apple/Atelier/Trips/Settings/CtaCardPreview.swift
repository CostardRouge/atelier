// The closing card as a deck ends with it — a live preview beside the card's
// fields in ⚙ Trip (the web's sheet has none: its closing card is judged on
// the piece's stage behind the sheet, which a phone's full-screen sheet
// covers). Drawn through the very path every slide of a deck takes — the
// kernel's `slideRender` for a `cta` slide, painted by `BadgeRenderer`
// (`QRPainter` for the square, `OverlayPainter` for the lines) — at the
// second a still of it is taken (`deckStillSeconds`), so what shows here is
// what a PNG deck delivers, resampled.

import SwiftUI
import AtelierKit

struct CtaCardPreview: View {
    let trip: TripDoc
    /// The frame's aspect (width / height): the piece's, where there is one.
    let aspect: Double

    @State private var renderer = BadgeRenderer()
    @Environment(\.palette) private var palette

    var body: some View {
        let ratio = aspect.isFinite && aspect > 0 ? aspect : 4.0 / 5
        let options = CtaCardPreview.options(trip, aspect: ratio)
        return Canvas(opaque: true, rendersAsynchronously: false) { context, size in
            context.withCGContext { cg in
                renderer.render(in: cg, size: size, options)
            }
        }
        .aspectRatio(CGFloat(ratio), contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line, lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel("The closing card: \(trip.cta.headline)")
        .accessibilityAddTraits(.isImage)
    }

    /// What the card is painted with — the deck's own closing slide.
    static func options(_ trip: TripDoc, aspect: Double) -> BadgeRenderOptions {
        let slide = DeckSlide(kind: .cta, position: 1, slideId: nil, media: nil, videoTimeSeconds: 0,
                              framing: .default, motion: nil, develop: nil, grade: nil, collage: nil, caption: "",
                              medium: .image, chosen: .image, reason: .plain, seconds: outroSecondsDefault, speed: 1)
        // A closing card reads nothing of the piece; a stand-in carries the call.
        let piece = TripPost(id: "cta-preview", kind: .carousel, date: trip.startDate,
                             badge: defaultPostBadge(.carousel), includeCta: true, createdAt: 0)
        let made = slideRender(trip, piece, slide, aspect)
        var o = BadgeRenderOptions(elements: made.elements, theme: made.theme)
        o.timeSeconds = deckStillSeconds(slide, aspect, 0)
        o.background = made.background
        o.qr = made.qr
        o.framing = made.framing
        return o
    }
}

#Preview("The closing card") {
    VStack(spacing: 16) {
        CtaCardPreview(trip: TripSettingsFixtures.trip(), aspect: 4.0 / 5)
            .frame(width: 220)
        CtaCardPreview(trip: TripSettingsFixtures.trip(), aspect: 9.0 / 16)
            .frame(width: 180)
    }
    .padding(24)
    .background(Palette.paper.surface)
}
