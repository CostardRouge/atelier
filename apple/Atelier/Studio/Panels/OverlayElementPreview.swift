// One overlay element painted small, by the REAL renderer — the palette's
// cells and the title-style cards. The web approximates the look in CSS
// (`style-preview.ts`: the halation collapsed into a two-stop text-shadow);
// here the thumbnail goes through `OverlayPainter`, the very code the stage
// and the export draw with, so a cell shows the font, the case, the spacing,
// the legibility and the glow the element will really wear.
//
// The element is laid out centred in the preview's own frame at a size the
// caller chooses (a fraction of the frame's SHORTER side, as every overlay
// size is). Nothing here is the element's own placement: a preview is a
// swatch, never the stage.

import SwiftUI
import AtelierKit

struct OverlayElementPreview: View {
    private let element: OverlayElement
    private let theme: StyleTheme?
    private let cue: Cue?
    private let painter: OverlayPainter

    /// - Parameters:
    ///   - element: drawn as given — centre it and size it before handing it in
    ///     (`OverlayElementPreview.centred`).
    ///   - painter: one per consumer (it keeps grain masks across frames).
    init(_ element: OverlayElement, theme: StyleTheme?, cue: Cue? = nil, painter: OverlayPainter) {
        self.element = element
        self.theme = theme
        self.cue = cue
        self.painter = painter
    }

    var body: some View {
        Canvas(opaque: false, rendersAsynchronously: false) { context, size in
            context.withCGContext { cg in
                painter.drawOverlays(in: cg, size: size, elements: [element], cue: cue, time: 0, theme: theme)
            }
        }
        .accessibilityHidden(true)
    }

    /// `element` as a swatch: anchored at the centre of the preview, with no
    /// window, no entrance and no scene (a still at rest), its font `fontShare`
    /// of the preview's short side WHATEVER the theme's size multiplier — as
    /// the web's fixed-size preview is — and a stable id so the painter's
    /// per-element caches do not grow with every redraw.
    static func centred(_ element: OverlayElement, id: String, fontShare: Double, theme: StyleTheme?) -> OverlayElement {
        var el = element
        el.id = id
        el.anchor = .center
        el.x = 0.5
        el.y = 0.5
        let scale = theme?.style.sizeScale ?? 1
        el.sizeFrac = fontShare / (scale > 0 ? scale : 1)
        el.window = nil
        el.animation = nil
        el.sceneId = nil
        el.visible = true
        return el
    }
}
