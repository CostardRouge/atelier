// Pure layout maths for the composer — given an output size and a layout
// choice, where do the video and map panes go, and how does each source map
// into its pane (object-fit cover/contain → drawImage rects). Port of
// `src/shared/media/compose-layout.ts`.
//
// The web's `Rect { x, y, w, h }` is the kernel's `Rect` (`Geometry.swift`,
// `width`/`height`), its `Fit` the one `Framing.swift` already declares, and
// `Corner` is declared here because `MediaLayout.swift` reads it from this
// module exactly as the web does.

import Foundation

public enum LayoutKind: String, Codable, Sendable {
    case sideBySide = "side-by-side"
    case stacked
    case pipMap = "pip-map"
    case pipVideo = "pip-video"
}

public enum Corner: String, Codable, Sendable {
    case tl, tr, bl, br
}

public struct PaneRects: Equatable, Sendable {
    public var video: Rect
    public var map: Rect
    public init(video: Rect, map: Rect) { self.video = video; self.map = map }
}

/// JavaScript's `Math.round`: halves go toward +∞, never away from zero.
private func roundHalfUp(_ v: Double) -> Double {
    let down = v.rounded(.down)
    return v - down >= 0.5 ? down + 1 : down
}

/// Round to the nearest even integer (encoders prefer even dimensions).
public func even(_ n: Double) -> Double {
    2 * roundHalfUp(n / 2)
}

/// Output pixel size from an aspect ratio and a target long edge.
public func outputSize(_ aspectW: Double, _ aspectH: Double, _ longEdge: Double) -> Size {
    if aspectW >= aspectH {
        return Size(even(longEdge), even((longEdge * aspectH) / aspectW))
    }
    return Size(even((longEdge * aspectW) / aspectH), even(longEdge))
}

private func cornerRect(_ corner: Corner, _ outW: Double, _ outH: Double, _ w: Double, _ h: Double, _ margin: Double) -> Rect {
    let x = corner == .tl || corner == .bl ? margin : outW - w - margin
    let y = corner == .tl || corner == .tr ? margin : outH - h - margin
    return Rect(x, y, w, h)
}

/// The video and map pane rectangles within an `outW`×`outH` frame.
/// - side-by-side / stacked: `split` (0.1..0.9) is the video's fraction.
/// - pip-map / pip-video: the inset pane is `inset` (0.15..0.6) of the width, in
///   `corner`, over the full-frame other pane.
public func paneRects(_ outW: Double, _ outH: Double, _ layout: LayoutKind, _ split: Double, _ inset: Double, _ corner: Corner) -> PaneRects {
    let s = min(0.9, max(0.1, split))
    if layout == .sideBySide {
        let vw = roundHalfUp(outW * s)
        return PaneRects(video: Rect(0, 0, vw, outH), map: Rect(vw, 0, outW - vw, outH))
    }
    if layout == .stacked {
        let vh = roundHalfUp(outH * s)
        return PaneRects(video: Rect(0, 0, outW, vh), map: Rect(0, vh, outW, outH - vh))
    }
    let full = Rect(0, 0, outW, outH)
    let frac = min(0.6, max(0.15, inset))
    let iw = roundHalfUp(outW * frac)
    let ih = roundHalfUp((iw * outH) / outW) // inset keeps the output aspect
    let margin = roundHalfUp(outW * 0.03)
    let pip = cornerRect(corner, outW, outH, iw, ih, margin)
    return layout == .pipMap ? PaneRects(video: full, map: pip) : PaneRects(video: pip, map: full)
}

/// The source crop and the destination rect of one `drawImage`.
public struct DrawRect: Equatable, Sendable {
    public var sx: Double
    public var sy: Double
    public var sw: Double
    public var sh: Double
    public var dx: Double
    public var dy: Double
    public var dw: Double
    public var dh: Double

    public init(sx: Double, sy: Double, sw: Double, sh: Double, dx: Double, dy: Double, dw: Double, dh: Double) {
        self.sx = sx; self.sy = sy; self.sw = sw; self.sh = sh
        self.dx = dx; self.dy = dy; self.dw = dw; self.dh = dh
    }
}

/// Map a `srcW`×`srcH` source into `dst` with object-fit semantics:
/// - cover: crop the source to fill the pane (no bars).
/// - contain: fit the whole source inside the pane (letterboxed).
public func fitRect(_ srcW: Double, _ srcH: Double, _ dst: Rect, _ mode: Fit) -> DrawRect {
    if srcW <= 0 || srcH <= 0 {
        return DrawRect(sx: 0, sy: 0, sw: srcW, sh: srcH, dx: dst.x, dy: dst.y, dw: dst.width, dh: dst.height)
    }
    let srcAR = srcW / srcH
    let dstAR = dst.width / dst.height
    if mode == .cover {
        var sw = srcW
        var sh = srcH
        if srcAR > dstAR { sw = srcH * dstAR } else { sh = srcW / dstAR }
        return DrawRect(sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw: sw, sh: sh,
                        dx: dst.x, dy: dst.y, dw: dst.width, dh: dst.height)
    }
    var dw = dst.width
    var dh = dst.height
    if srcAR > dstAR { dh = dst.width / srcAR } else { dw = dst.height * srcAR }
    return DrawRect(sx: 0, sy: 0, sw: srcW, sh: srcH,
                    dx: dst.x + (dst.width - dw) / 2, dy: dst.y + (dst.height - dh) / 2, dw: dw, dh: dh)
}
