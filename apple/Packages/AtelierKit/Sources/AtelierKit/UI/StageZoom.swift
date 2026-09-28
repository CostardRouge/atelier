// The arithmetic behind a zone's VIEW zoom — how much of a day-sized thing you
// are looking at, not anything the document remembers. Port of
// `src/shared/ui/stage-zoom.ts`.
//
// A zone zooms by LAYOUT size inside a scroll box (the web's day grid and
// stage ruler), so panning is the scroll itself and the correction after a
// zoom is a scroll position (`scrollAfterZoom`). The rules kept: a quarter to
// sixteen times, one press of ± is ×1.25 and a step that would cross 1 lands
// ON 1 (fit is what the author keeps coming back to); a zone raises the floor
// through `minScaleToFill`, a bisection because a zone's width is a
// staircase of whole pixels, never above 1; `growthRatio` says how much the
// content REALLY grew, which is not the scale ratio once a zone has a pixel
// floor; ⌘/ctrl-wheel always zooms and a bare vertical wheel zooms only under
// `any`, a shift-wheel or a sideways sweep staying the scroll.
//
// `ZoomControls` is the contract a ± pill takes; drawing it is the app's.

import Foundation

/// Below 1 the content is smaller than its fit; above it a single day gets big
/// enough to aim at. The zone sets the real floor when it has one.
public let minStageZoom = 0.25
public let maxStageZoom = 16.0
/// One press of + or −.
public let stageZoomStep = 1.25

/// A zone's own floor, held inside the range and never above 1 — capping at 1
/// keeps 100 % and the reset button reachable whatever a zone asks for.
public func zoomFloor(_ min: Double? = nil) -> Double {
    let asked = min ?? minStageZoom
    return Swift.min(1, Swift.max(minStageZoom, asked))
}

public func clampZoom(_ scale: Double, _ min: Double? = nil) -> Double {
    if !scale.isFinite { return 1 }
    return Swift.min(maxStageZoom, Swift.max(zoomFloor(min), scale))
}

/// One step in (`1`) or out (anything else). A step that would cross 1 lands
/// ON 1 instead: a geometric ladder from 1.25 never hits it again.
public func stepZoom(_ scale: Double, _ direction: Int, _ min: Double? = nil) -> Double {
    let next = direction == 1 ? scale * stageZoomStep : scale / stageZoomStep
    if (scale < 1 && next > 1) || (scale > 1 && next < 1) { return 1 }
    return clampZoom(next, min)
}

/// A wheel notch (or a trackpad pinch, which arrives as a ctrl-wheel) as a
/// multiplier — the same 400-unit divisor the picture's own framing zoom uses.
public func zoomByWheel(_ scale: Double, _ deltaY: Double, _ min: Double? = nil) -> Double {
    clampZoom(scale * exp(-deltaY / 400), min)
}

/// A pinch's finger-distance ratio applied to the scale it started from.
public func zoomByPinch(_ startScale: Double, _ ratio: Double, _ min: Double? = nil) -> Double {
    if !ratio.isFinite || ratio <= 0 { return clampZoom(startScale, min) }
    return clampZoom(startScale * ratio, min)
}

/// The smallest scale at which a zone still fills its box — its floor.
///
/// `width` is the zone's own content width at a scale, and must never shrink
/// as the scale grows. A bisection rather than algebra because a zone's width
/// is a staircase, not a line; the invariant is that `hi` always fills, so the
/// answer never lands a pixel short. A box not measured yet floors nothing.
public func minScaleToFill(_ width: (Double) -> Double, _ viewportWidth: Double) -> Double {
    if !(viewportWidth > 0) { return minStageZoom }
    if width(minStageZoom) >= viewportWidth { return minStageZoom }
    if width(1) < viewportWidth { return 1 }
    var lo = minStageZoom
    var hi = 1.0
    for _ in 0..<24 {
        let mid = (lo + hi) / 2
        if width(mid) >= viewportWidth { hi = mid } else { lo = mid }
    }
    return hi
}

/// How much the scaling content really grew — NOT the ratio of the two scales
/// whenever a zone has a pixel floor or rounds to whole pixels. `fallback` is
/// the scale ratio, for a zone that is genuinely linear.
public func growthRatio(_ prevWidth: Double, _ nextWidth: Double, _ fallback: Double) -> Double {
    if !(prevWidth > 0) || !(nextWidth > 0) { return fallback }
    return nextWidth / prevWidth
}

public struct StageScroll: Equatable, Sendable {
    public var left: Double
    public var top: Double
    public init(left: Double, top: Double) { self.left = left; self.top = top }
}

/// What `scrollAfterZoom` may be told beyond the two scales.
public struct ScrollAfterZoom: Equatable, Sendable {
    /// One optional number per axis.
    public struct Axes: Equatable, Sendable {
        public var x: Double?
        public var y: Double?
        public init(x: Double? = nil, y: Double? = nil) { self.x = x; self.y = y }
    }

    /// Pixels of content before the part that scales — the day grid's weekday
    /// rail, which keeps its width at every zoom. Without it the correction
    /// treats the rail as if it grew too.
    public var fixed: Axes
    /// How much the scaling content actually grew, when the zone knows (see
    /// `growthRatio`). Absent, the scale ratio is used.
    public var grew: Axes

    public init(fixed: Axes = Axes(), grew: Axes = Axes()) {
        self.fixed = fixed; self.grew = grew
    }
}

/// Where the scroll box must land so the content under `anchor` (a point in
/// the viewport's own coordinates) stays under it after the scale changes.
/// The content's origin only moves with the scroll once it is larger than the
/// viewport; while it still fits the scroll is 0 anyway, which the clamp at 0
/// covers. A previous scale that is not positive leaves the scroll alone.
public func scrollAfterZoom(_ scroll: StageScroll, anchor: Point, _ prevScale: Double, _ nextScale: Double,
                            _ options: ScrollAfterZoom = ScrollAfterZoom()) -> StageScroll {
    if prevScale <= 0 { return scroll }
    let ratio = nextScale / prevScale
    let kx = options.grew.x ?? ratio
    let ky = options.grew.y ?? ratio
    let fx = options.fixed.x ?? 0
    let fy = options.fixed.y ?? 0
    let left = fx + (scroll.left + anchor.x - fx) * kx - anchor.x
    let top = fy + (scroll.top + anchor.y - fy) * ky - anchor.y
    return StageScroll(left: max(0, left), top: max(0, top))
}

/// What a bare wheel means over a zone: `modifier` — only ⌘/ctrl (and the
/// trackpad pinch that arrives as one) zooms; `any` — a bare wheel zooms too,
/// for a zone that has nothing else to do with it.
public enum WheelZoom: String, Sendable {
    case modifier, any
}

/// The bits of a wheel event the decision needs.
public struct WheelLike: Equatable, Sendable {
    public var deltaX: Double
    public var deltaY: Double
    public var ctrlKey: Bool
    public var metaKey: Bool
    public var shiftKey: Bool

    public init(deltaX: Double, deltaY: Double, ctrlKey: Bool = false, metaKey: Bool = false, shiftKey: Bool = false) {
        self.deltaX = deltaX; self.deltaY = deltaY
        self.ctrlKey = ctrlKey; self.metaKey = metaKey; self.shiftKey = shiftKey
    }
}

/// Whether this wheel event zooms. ⌘/ctrl always does. Under `any`, a bare
/// vertical wheel does too — but a shift-wheel and a sideways trackpad swipe
/// stay the horizontal scroll, which is how a zoomed-in track is panned.
public func wheelZooms(_ e: WheelLike, _ mode: WheelZoom) -> Bool {
    if e.ctrlKey || e.metaKey { return true }
    if mode == .modifier || e.shiftKey { return false }
    return abs(e.deltaY) > abs(e.deltaX)
}

/// What a ± pill needs to drive a zoom, and all it needs. `zoomTo` is
/// optional: a zone whose pill is only `− label +` never needs one.
public struct ZoomControls {
    /// 1 = the content at its fitted size.
    public var scale: Double
    public var label: String
    public var canZoomIn: Bool
    public var canZoomOut: Bool
    public var zoomIn: () -> Void
    public var zoomOut: () -> Void
    public var reset: () -> Void
    public var zoomTo: ((Double) -> Void)?

    public init(scale: Double, label: String, canZoomIn: Bool, canZoomOut: Bool,
                zoomIn: @escaping () -> Void, zoomOut: @escaping () -> Void, reset: @escaping () -> Void,
                zoomTo: ((Double) -> Void)? = nil) {
        self.scale = scale; self.label = label
        self.canZoomIn = canZoomIn; self.canZoomOut = canZoomOut
        self.zoomIn = zoomIn; self.zoomOut = zoomOut; self.reset = reset; self.zoomTo = zoomTo
    }
}

/// "100%" — what the control shows between its two buttons. Rounded half up
/// like `Math.round` (the scale is never negative).
public func zoomLabel(_ scale: Double) -> String {
    let percent = (scale * 100).rounded(.toNearestOrAwayFromZero)
    return "\(Int(percent))%"
}
