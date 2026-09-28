// The app's side of the opener contract (`Roadtrip/Hooks/HookVariant.swift`):
// ONE painter that switches on the drawing a prepared layer handed over, the
// web's `ResolvedHook.paint` loop. Each drawing type has its own Core
// Graphics painter beside this file — Défilé (`ScrubPainter`), the Itinerary
// (`MapPainter`), Virée (`DrivePainter`) — and every position, size, colour
// and alpha they draw is the kernel's frame (`ScrubFrame`, `MapFrame`,
// `DriveFrame`), read at `t` from the very plan the content and the score
// read. So the numeral, the picture and the tick cannot drift, and the stage
// and a 1080×1920 export draw the same opener at two scales.
//
// What is shared here, once for the three painters:
// - a colour is `HookInk`: a CSS colour (a document's `#rrggbb`) and ONE
//   alpha — the web's `rgba()` alpha already multiplied by its canvas's
//   `globalAlpha` at that stroke — so the painters keep the canvas's own
//   alpha at 1 and never multiply twice;
// - a line of text is `HookText`, set in the suite's faces with the web's
//   fallback stacks, its halo stroked with round joins UNDER the fill;
// - a name's width is measured here, by Core Text, in the label face at 600 —
//   what the kernel's label placement asks for (`placeLabels`);
// - a decoded picture rides `HookPicture.image` in a `HookBitmap`, the box the
//   kernel's opaque slot takes (the kernel reads only the size).
//
// A picture that cannot be drawn is simply not drawn — the web's try/catch
// around a released bitmap: that frame shows what the kernel's fallback says
// (Défilé's empty day), never a crash in the paint loop.

import AtelierKit
import CoreGraphics
import Foundation

/// A decoded picture as an opener's `HookPicture.image` holds it.
final class HookBitmap: @unchecked Sendable {
    let image: CGImage

    init(_ image: CGImage) {
        self.image = image
    }

    /// The picture a variant may draw, at the size it was decoded at.
    static func picture(_ image: CGImage) -> HookPicture {
        HookPicture(image: HookBitmap(image), width: Double(image.width), height: Double(image.height))
    }
}

enum HookPaint {
    /// The web's `LABEL_FONT`: the suite's face, then its fallbacks.
    static let labelFamilies = [OverlayFontFamily.spaceGrotesk.rawValue, "Helvetica Neue", "Arial", "sans-serif"]
    /// The web's `MONO_FONT`.
    static let monoFamilies = [OverlayFontFamily.jetBrainsMono.rawValue, "SF Mono", "Menlo", "Consolas", "monospace"]

    // MARK: - the dispatch

    /// Draw one layer's drawing onto `c` at `t` — the painter
    /// `ResolvedHook.paint` is handed. A drawing type this build does not
    /// paint draws nothing (the badge's own layer hands none at all).
    static func paint(_ c: PaintCanvas, _ drawing: any HookDrawing, _ t: Double, _ frame: FrameBox) {
        if let scrub = drawing as? ScrubDrawing {
            ScrubPainter.paint(c, scrub, t, frame)
        } else if let map = drawing as? MapDrawing {
            MapPainter.paint(c, map, t, frame)
        } else if let drive = drawing as? DriveDrawing {
            DrivePainter.paint(c, drive, t, frame)
        }
    }

    /// Every layer of a prepared opener, in order, onto `c`'s whole frame.
    static func paint(_ hook: ResolvedHook, _ c: PaintCanvas, _ t: Double) {
        let frame = AtelierKit.Size(width: c.width, height: c.height)
        hook.paint(c, t, frame) { canvas, drawing, time, box in
            HookPaint.paint(canvas, drawing, time, box)
        }
    }

    // MARK: - what the three painters share

    /// A `HookInk` as Core Graphics takes it: the colour, faded by the ink's
    /// alpha. A colour a canvas could not read paints white, as the web's
    /// `hexToRgba` does.
    static func color(_ ink: HookInk) -> CGColor {
        let base = CSSColor.parse(ink.color) ?? CSSColor.white
        let alpha = ink.alpha.isFinite ? max(0, min(1, ink.alpha)) : 0
        return CSSColor.faded(base, alpha)
    }

    static func fill(_ c: PaintCanvas, _ ink: HookInk) {
        c.setFill(.color(color(ink)))
    }

    static func stroke(_ c: PaintCanvas, _ ink: HookInk, width: Double) {
        c.setStroke(.color(color(ink)))
        c.lineWidth = width
    }

    /// A filled disc.
    static func disc(_ c: PaintCanvas, center: AtelierKit.Point, radius: Double, _ ink: HookInk) {
        guard radius > 0 else { return }
        fill(c, ink)
        c.beginPath()
        c.arc(center.x, center.y, radius, 0, Double.pi * 2)
        c.fill()
    }

    /// A filled polygon, closed.
    static func polygon(_ c: PaintCanvas, _ points: [AtelierKit.Point], _ ink: HookInk) {
        guard points.count >= 3 else { return }
        fill(c, ink)
        trace(c, points, close: true)
        c.fill()
    }

    /// A path through `points`, as a fresh path.
    static func trace(_ c: PaintCanvas, _ points: [AtelierKit.Point], close: Bool) {
        c.beginPath()
        for (i, p) in points.enumerated() {
            if i == 0 { c.moveTo(p.x, p.y) } else { c.lineTo(p.x, p.y) }
        }
        if close { c.closePath() }
    }

    /// The canvas's text alignment for a label's.
    static func align(_ a: LabelAlign) -> CanvasTextAlign {
        switch a {
        case .left: return .left
        case .right: return .right
        case .center: return .center
        }
    }

    /// The font a line of an opener is set in.
    static func font(_ text: HookText) -> PaintFont {
        PaintFont(text.face == .mono ? monoFamilies : labelFamilies, size: text.fontPx, weight: text.weight)
    }

    /// One line: its halo stroked first (round joins, so a glyph's corner is
    /// no spike), then the ink over it — the web's `strokeText` + `fillText`.
    static func text(_ c: PaintCanvas, _ line: HookText) {
        guard !line.text.isEmpty, line.fontPx > 0 else { return }
        c.save()
        c.font = font(line)
        c.textAlign = align(line.align)
        c.textBaseline = line.baseline == .top ? .top : .middle
        if let halo = line.halo, line.haloWidth > 0 {
            c.lineJoin = .round
            stroke(c, halo, width: line.haloWidth)
            c.strokeText(line.text, line.at.x, line.at.y)
        }
        fill(c, line.ink)
        c.fillText(line.text, line.at.x, line.at.y)
        c.restore()
    }

    /// The width of a stop's name set in the label face at weight 600 and
    /// `fontPx` — the measure the kernel's label placement takes.
    static func labelWidth(_ text: String, _ fontPx: Double) -> Double {
        PaintFonts.line(text, PaintFont(labelFamilies, size: fontPx, weight: 600)).width
    }

    /// A decoded opener picture as the painters draw it, or nil when there is
    /// none to draw (never decoded, released, or with no area).
    static func picture(_ p: HookPicture?) -> PaintPicture? {
        guard let p, p.width > 0, p.height > 0, let bitmap = p.image as? HookBitmap else { return nil }
        return PaintPicture(bitmap.image, width: p.width, height: p.height)
    }
}
