// The shades painted — `paintShades` of `src/shared/roadtrip/badge-render.ts`:
// the kernel says what each shade draws (`shadeGradient`,
// `Roadtrip/ShadeGradient.swift`) in fractions of the frame, this turns the
// fractions into pixels. The same function paints the stage, the PNG deck
// and every frame of a burned-in clip, so a gradient that appeared in the
// still cannot vanish in the reel.
//
// Shades run BEFORE the badge, never after: darkening the text just drawn
// would defeat the point. A radial's radii are fractions of the SHORTER side,
// so it keeps its shape on a 9:16 frame. A gradient holds its end colours
// past its endpoints (a canvas gradient does; CG does with both extend
// options), which is why a band runs edge to edge about its centre.

import AtelierKit
import CoreGraphics
import Foundation

enum ShadePainter {
    /// Every shade of the stack over `c`'s `w`×`h` frame; `block` is the
    /// badge's extent, for a shade that follows the hook.
    static func paintShades(_ c: PaintCanvas, _ w: Double, _ h: Double, _ shades: [Shade], _ block: HookBlock?) {
        let short = min(w, h)
        for shade in shades {
            guard let g = shadeGradient(shade, block) else { continue }
            let stops = g.stops
            guard !stops.isEmpty, let gradient = cgGradient(shade.color, stops) else { continue }
            c.cg.saveGState()
            c.cg.setAlpha(CGFloat(c.globalAlpha))
            c.cg.setBlendMode(.normal)
            c.cg.clip(to: CGRect(x: 0, y: 0, width: w, height: h))
            let extend: CGGradientDrawingOptions = [.drawsBeforeStartLocation, .drawsAfterEndLocation]
            switch g {
            case .linear(let l):
                c.cg.drawLinearGradient(gradient, start: CGPoint(x: l.x0 * w, y: l.y0 * h),
                                        end: CGPoint(x: l.x1 * w, y: l.y1 * h), options: extend)
            case .radial(let r):
                let center = CGPoint(x: r.cx * w, y: r.cy * h)
                c.cg.drawRadialGradient(gradient, startCenter: center, startRadius: CGFloat(r.r0 * short),
                                        endCenter: center, endRadius: CGFloat(max(r.r1 * short, 1)), options: extend)
            }
            c.cg.restoreGState()
        }
    }

    /// The stops in the shade's colour at each stop's alpha — the web's
    /// `rgba(color, alpha)`: a `#rrggbb` takes the stop's alpha, any other
    /// colour a canvas reads is passed through as it is.
    private static func cgGradient(_ color: String, _ stops: [ShadeStop]) -> CGGradient? {
        let base = CSSColor.parse(color) ?? CSSColor.black
        let hex = isHex6(color)
        let colors = stops.map { stop -> CGColor in
            hex ? CSSColor.faded(base, max(0, min(1, stop.alpha))) : base
        }
        let locations = stops.map { CGFloat(max(0, min(1, $0.at))) }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        return CGGradient(colorsSpace: space, colors: colors as CFArray, locations: locations)
    }

    /// `/^#([0-9a-f]{2}){3}$/i` after a trim.
    private static func isHex6(_ color: String) -> Bool {
        let s = color.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count == 7, s.hasPrefix("#") else { return false }
        return s.dropFirst().allSatisfy { $0.isHexDigit }
    }
}
