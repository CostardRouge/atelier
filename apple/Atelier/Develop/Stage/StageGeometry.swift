// Where a point of the stage is on the PICTURE, and back — the one transform
// every tool that touches the photograph goes through (the web's
// `DevelopPicture.pointAt` / `stagePoint` over `framePoint` / `unframePoint`,
// `use-develop-picture.ts`). A mask's brush, a repair ring, a subject's tap,
// the eyedropper, the crop's zone and the wipe's divider all ask it; none of
// them re-derives it.
//
// Three spaces, all y-DOWN like the web's canvas and SwiftUI alike:
//
// - SOURCE — the decoded picture, oriented, in its own pixels
//   (`DecodedPicture.width × height`). Where every pass runs, and where a
//   stored point lives (a patch, a subject tap, a colour sample: the web
//   stores them as shares of the source, `u, v ∈ [0, 1]`).
// - FRAME — the delivered picture (the crop's output) in source-pixel units:
//   the largest box of the picture's aspect inside the source, the framing's
//   cover-fit applied (`Framing.swift`'s `framePoint` / `unframePoint`, exact
//   at any rotation and mirror).
// - VIEW — the stage box, in points, measured from its top-left corner: the
//   frame fitted inside it (less an inset) and then moved by the Looking zoom
//   (`PanZoom.swift`'s `ViewState`, offsets from the box's CENTRE).
//
// The rules the web learned (`develop-roll.md`, «The compare is a switch»):
// a point is computed from the view's ARITHMETIC, never from a measured frame
// — a measured rect lags the picture by one render on every pan — and a point
// outside the frame is SAID (`inside: false`) rather than clamped silently.

import CoreGraphics
import AtelierKit

struct StageGeometry: Equatable {
    /// The decoded picture, in its own pixels.
    var source: CGSize
    /// The picture's framing (nil on the roll is `.default` here).
    var framing: Framing
    /// The picture's aspect id — `original`, a preset, `free:<ratio>`.
    var aspect: String
    /// The stage box, in points.
    var viewport: CGSize
    /// Room kept round the picture at the fit, in points.
    var inset: CGFloat
    /// The Looking zoom — a transform about the box's centre, gone at the fit.
    var view: ViewState

    init(source: CGSize, framing: Framing = .default, aspect: String = "original",
         viewport: CGSize, inset: CGFloat = 12, view: ViewState = .fitted) {
        self.source = source; self.framing = framing; self.aspect = aspect
        self.viewport = viewport; self.inset = inset; self.view = view
    }

    // MARK: - the three boxes

    /// The delivered frame, in source-pixel units — the largest box of the
    /// aspect inside the source (`PictureRenderer.deliveredSize`'s arithmetic,
    /// unrounded).
    var frame: CGSize {
        let w = Double(source.width)
        let h = Double(source.height)
        guard w > 0, h > 0 else { return .zero }
        let ratio = pictureAspectRatio(aspect, w, h)
        guard ratio > 0, ratio.isFinite else { return source }
        if w / h > ratio { return CGSize(width: h * ratio, height: h) }
        return CGSize(width: w, height: w / ratio)
    }

    /// The frame fitted inside the box less its inset, at the fit — the
    /// `content` every `PanZoom` function measures against.
    var fitted: CGSize {
        let room = Size(Double(max(0, viewport.width - inset * 2)), Double(max(0, viewport.height - inset * 2)))
        let f = frame
        let c = containedSize(Size(Double(f.width), Double(f.height)), room)
        return CGSize(width: c.width, height: c.height)
    }

    /// Where the frame is drawn now, in view points: the fitted frame moved by
    /// the Looking zoom.
    var drawnRect: CGRect {
        let fit = fitted
        let r = AtelierKit.pictureRect(view, viewport: Size(Double(viewport.width), Double(viewport.height)),
                                       content: Size(Double(fit.width), Double(fit.height)))
        return CGRect(x: r.x, y: r.y, width: r.width, height: r.height)
    }

    /// View points per frame (= source) pixel, at the current zoom.
    var pointsPerPixel: CGFloat {
        let f = frame
        return f.width > 0 ? drawnRect.width / f.width : 0
    }

    // MARK: - view ↔ frame

    /// A point of the view as a point of the delivered frame, in its pixels.
    func toFrame(view p: CGPoint) -> CGPoint {
        let rect = drawnRect
        let f = frame
        guard rect.width > 0, rect.height > 0 else { return .zero }
        return CGPoint(x: (p.x - rect.minX) / rect.width * f.width, y: (p.y - rect.minY) / rect.height * f.height)
    }

    /// A point of the delivered frame as a point of the view.
    func toView(frame p: CGPoint) -> CGPoint {
        let rect = drawnRect
        let f = frame
        guard f.width > 0, f.height > 0 else { return rect.origin }
        return CGPoint(x: rect.minX + p.x / f.width * rect.width, y: rect.minY + p.y / f.height * rect.height)
    }

    /// Where a point of the view falls across the frame, as shares of its
    /// width and height (0 at the left/top edge, 1 at the right/bottom) — the
    /// wipe's divider reads it.
    func fraction(atView p: CGPoint) -> CGPoint {
        let rect = drawnRect
        guard rect.width > 0, rect.height > 0 else { return CGPoint(x: 0.5, y: 0.5) }
        return CGPoint(x: (p.x - rect.minX) / rect.width, y: (p.y - rect.minY) / rect.height)
    }

    // MARK: - view ↔ source

    /// A point of the view as a point of the SOURCE, in its pixels — the
    /// inverse of what the renderer composes (`unframePoint`).
    func toSource(view p: CGPoint) -> CGPoint {
        let fp = toFrame(view: p)
        let f = frame
        let (x, y) = unframePoint(Double(fp.x), Double(fp.y), Double(source.width), Double(source.height),
                                  Double(f.width), Double(f.height), framing)
        return CGPoint(x: x, y: y)
    }

    /// A point of the SOURCE (its pixels) as a point of the view (`framePoint`).
    func toView(source p: CGPoint) -> CGPoint {
        let f = frame
        let (x, y) = AtelierKit.framePoint(Double(p.x), Double(p.y), Double(source.width), Double(source.height),
                                           Double(f.width), Double(f.height), framing)
        return toView(frame: CGPoint(x: x, y: y))
    }

    // MARK: - the web's two names, over the source's shares

    /// Where the source's own `[u, v]` (shares of its width and height) is on
    /// the stage, and whether the crop kept it — the web's `stagePoint`. Nil
    /// before a picture is decoded.
    func stagePoint(u: Double, v: Double) -> (point: CGPoint, inside: Bool)? {
        guard source.width > 0, source.height > 0 else { return nil }
        let f = frame
        let (fx, fy) = AtelierKit.framePoint(u * Double(source.width), v * Double(source.height),
                                             Double(source.width), Double(source.height),
                                             Double(f.width), Double(f.height), framing)
        let inside = fx >= 0 && fy >= 0 && fx <= Double(f.width) && fy <= Double(f.height)
        return (toView(frame: CGPoint(x: fx, y: fy)), inside)
    }

    /// The source's `[u, v]` under a point of the view — the web's `pointAt`.
    /// Nil when the point is off the delivered frame, unless `unbounded` (a
    /// hand that strays past the edge mid-drag still moves what it holds).
    func pointAt(view p: CGPoint, unbounded: Bool = false) -> (u: Double, v: Double)? {
        guard source.width > 0, source.height > 0 else { return nil }
        let fp = toFrame(view: p)
        let f = frame
        if !unbounded && (fp.x < 0 || fp.y < 0 || fp.x > f.width || fp.y > f.height) { return nil }
        let s = toSource(view: p)
        return (Double(s.x / source.width), Double(s.y / source.height))
    }

    /// A length of the view (a brush radius on screen) in SOURCE pixels —
    /// through the framing's own scale (its cover-fit times its zoom).
    func sourceLength(ofViewLength length: CGFloat) -> Double {
        let ppp = Double(pointsPerPixel)
        let f = frame
        let t = framingTransform(Double(source.width), Double(source.height), Double(f.width), Double(f.height), framing)
        guard ppp > 0, t.scale > 0 else { return 0 }
        return Double(length) / ppp / t.scale
    }
}
