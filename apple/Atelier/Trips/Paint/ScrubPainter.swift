// «Défilé» painted — the strokes of `src/shared/roadtrip/hooks/scrub-paint.ts`
// over the kernel's `ScrubFrame` (`Roadtrip/Hooks/ScrubPaint.swift`), which
// already decided every position, size, colour and alpha from the plan the
// numeral and the ticks are read from.
//
// What a frame shows while the sweep runs: the stop's picture cover-cropped
// into the frame, or — a stop with none, or one that could not be drawn — the
// frame dark (`scrubEmptyDayColor`), never a stand-in; a frame of darkness as
// the head lands (the dip); then the tape. Once the sweep has come to rest
// the tape alone is drawn, and the piece's own picture below is the frame.
//
// The band and the track fade at their ends through a GRADIENT fill, never a
// mask: a shadow is dropped under a `destination-*` composite (`studio.md`),
// and the head's glow is one shadow blur a frame on one small shape.

import AtelierKit
import CoreGraphics
import Foundation

enum ScrubPainter {
    static func paint(_ c: PaintCanvas, _ drawing: ScrubDrawing, _ t: Double, _ frame: FrameBox) {
        guard let f = drawing.frame(at: t, frame) else { return }
        let w = frame.width
        let h = frame.height
        c.save()

        if let flash = f.flash {
            var drew = false
            if case .picture(let key) = flash, let picture = HookPaint.picture(drawing.pictures?[key]) {
                CellPainter.drawFramed(c, picture, w, h)
                drew = true
            }
            if !drew {
                c.setFill(scrubEmptyDayColor)
                c.fillRect(0, 0, w, h)
            }
            if f.dipAlpha > 0 {
                c.save()
                c.globalAlpha = f.dipAlpha
                c.setFill("#000000")
                c.fillRect(0, 0, w, h)
                c.restore()
            }
        }

        if let band = f.band { bar(c, band, rounded: true) }
        if let track = f.track { bar(c, track, rounded: false) }

        for tick in f.ticks {
            HookPaint.fill(c, HookInk(tick.color, tick.alpha))
            c.fillRect(tick.rect.x, tick.rect.y, tick.rect.width, tick.rect.height)
        }

        head(c, f.head)
        c.restore()
    }

    /// The band (rounded) or the track (square): flat at its alpha, or the
    /// edge fade's gradient left to right along the bar.
    private static func bar(_ c: PaintCanvas, _ b: ScrubBar, rounded: Bool) {
        let r = b.rect
        c.save()
        if let stops = b.gradient, let gradient = gradient(b.color, stops) {
            c.setFill(.linear(gradient, from: CGPoint(x: r.x, y: 0), to: CGPoint(x: r.x + r.width, y: 0)))
        } else {
            HookPaint.fill(c, HookInk(b.color, b.alpha))
        }
        if rounded {
            CellPainter.roundedRect(c, r.x, r.y, r.width, r.height, b.radius)
            c.fill()
        } else {
            c.fillRect(r.x, r.y, r.width, r.height)
        }
        c.restore()
    }

    /// A horizontal gradient of one colour at the stops' alphas.
    private static func gradient(_ color: String, _ stops: [ScrubGradientStop]) -> CGGradient? {
        guard !stops.isEmpty else { return nil }
        let colors = stops.map { HookPaint.color(HookInk(color, $0.alpha)) }
        let locations = stops.map { CGFloat($0.offset) }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        return CGGradient(colorsSpace: space, colors: colors as CFArray, locations: locations)
    }

    /// The reading head at its alpha, with its glow — the passed colour at 0.75.
    private static func head(_ c: PaintCanvas, _ mark: ScrubHeadMark) {
        c.save()
        c.globalAlpha = mark.alpha
        if let blur = mark.glowBlur {
            c.setShadow(color: hexToRgba(mark.color, 0.75), blur: blur)
        }
        c.setFill(hexToRgba(mark.color, 1))
        switch mark.shape {
        case .dot(let center, let radius):
            c.beginPath()
            c.arc(center.x, center.y, radius, 0, Double.pi * 2)
            c.fill()
        case .needle(let tip, let left, let right):
            c.beginPath()
            c.moveTo(tip.x, tip.y)
            c.lineTo(left.x, left.y)
            c.lineTo(right.x, right.y)
            c.closePath()
            c.fill()
        case .bar(let rect, let radius):
            CellPainter.roundedRect(c, rect.x, rect.y, rect.width, rect.height, radius)
            c.fill()
        }
        c.restore()
    }
}
