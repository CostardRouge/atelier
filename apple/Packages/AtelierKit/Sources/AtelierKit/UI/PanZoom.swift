// The arithmetic behind looking at ONE picture closely and sliding to the
// next — the lightbox's and the develop sheet's gestures, a view zoom that
// writes nothing. Port of `src/shared/ui/pan-zoom.ts`.
//
// Kept apart from `StageZoom.swift` on purpose: a stage zooms by LAYOUT size
// inside a scroll box, a viewer moves the picture by a TRANSFORM about its
// own centre, so every limit here is arithmetic we own. The rules kept: fit is
// the floor (a viewer showing less than the whole picture shows nothing); the
// ceiling is per surface and every function that can reach a scale takes it
// as its last argument (8× for the lightbox, `inspectMaxZoom` for the develop
// sheet); ONE wheel curve, `exp(−deltaY / 400)`, shared with the framing zoom;
// pan limits are measured off the PICTURE (`containedSize`), never off the
// box; `zoomAbout` keeps the point under the hand still; a `−0` offset is
// spelled `0` so "is this view at rest?" never lies.
//
// Names: the web's `View` is `ViewState` here (`View` is SwiftUI's, and the
// app imports both); its `Box` is Geometry's `Size`, its `Point` Geometry's.
// A framing zoom (Placing) is `Framing.swift`'s `zoomFramingAbout`.

import Foundation

/// Fit is the floor: a viewer showing less than the whole picture shows nothing.
public let minViewZoom = 1.0
public let maxViewZoom = 8.0
/// How far INSPECTING one picture goes — 4000 %, Lightroom's own ceiling. Past
/// `onePixelZoom` what is magnified is the preview's pixels, said rather than
/// refused.
public let inspectMaxZoom = 40.0
/// One press of + or −. Coarser than a stage's: there is no document to aim at.
public let viewZoomStep = 1.5

/// How the picture sits in its slot: scaled about its own centre, then moved
/// by `x`/`y` pixels. `scale: 1, x: 0, y: 0` is the contained fit.
public struct ViewState: Equatable, Sendable {
    public var scale: Double
    public var x: Double
    public var y: Double

    public init(scale: Double, x: Double, y: Double) {
        self.scale = scale; self.x = x; self.y = y
    }

    /// The web's `FITTED`.
    public static let fitted = ViewState(scale: 1, x: 0, y: 0)
}

/// The scale held between the fit and a ceiling. A ceiling under the fit is
/// the fit: nothing goes under 1 whatever it is asked.
public func clampViewZoom(_ scale: Double, _ max: Double = maxViewZoom) -> Double {
    if !scale.isFinite { return minViewZoom }
    let ceiling = Swift.max(minViewZoom, max)
    let floored = Swift.max(minViewZoom, scale)
    return Swift.min(ceiling, floored)
}

/// One step in (`1`) or out (anything else), by `viewZoomStep`.
public func stepViewZoom(_ scale: Double, _ direction: Int, _ max: Double = maxViewZoom) -> Double {
    let next = direction == 1 ? scale * viewZoomStep : scale / viewZoomStep
    return clampViewZoom(next, max)
}

/// The one wheel curve of the suite: a notch of `deltaY` multiplies the scale
/// by `exp(−deltaY / 400)` — exponential, so the gesture feels the same at
/// every scale, and one divisor, so a view and a framing zoom at the same
/// speed under the same hand.
public let wheelZoomDivisor = 400.0

public func wheelZoomFactor(_ deltaY: Double) -> Double {
    deltaY.isFinite ? exp(-deltaY / wheelZoomDivisor) : 1
}

/// A wheel notch applied to a view scale, held under the ceiling.
public func zoomByWheelDelta(_ scale: Double, _ deltaY: Double, _ max: Double = maxViewZoom) -> Double {
    clampViewZoom(scale * wheelZoomFactor(deltaY), max)
}

/// A pinch's finger-distance ratio applied to the scale it started from.
public func zoomByPinchRatio(_ startScale: Double, _ ratio: Double, _ max: Double = maxViewZoom) -> Double {
    if !ratio.isFinite || ratio <= 0 { return clampViewZoom(startScale, max) }
    return clampViewZoom(startScale * ratio, max)
}

/// The deepest zoom that still shows real pixels: one pixel of the picture per
/// device pixel of the screen. Never under 2×, never over the lightbox's 8×; a
/// size not known yet gets the floor.
public func pixelCeiling(_ natural: Size?, _ contained: Size, _ devicePixelRatio: Double) -> Double {
    let dpr = devicePixelRatio.isFinite && devicePixelRatio > 0 ? devicePixelRatio : 1
    guard let natural, natural.width > 0, contained.width > 0 else { return 2 }
    let onePixel = natural.width / (contained.width * dpr)
    return min(maxViewZoom, max(2, onePixel))
}

/// The scale at which ONE pixel of the picture covers one device pixel — the
/// honest 100 %, a LANDMARK the viewport marks rather than a ceiling. Never
/// under the fit; the fit when the size is unknown.
public func onePixelZoom(_ natural: Size?, _ contained: Size, _ devicePixelRatio: Double) -> Double {
    let dpr = devicePixelRatio.isFinite && devicePixelRatio > 0 ? devicePixelRatio : 1
    guard let natural, natural.width > 0, contained.width > 0 else { return 1 }
    let onePixel = natural.width / (contained.width * dpr)
    return max(minViewZoom, onePixel)
}

/// Where a point of the viewport falls on the picture, as a share of its width
/// and height (0 at the left/top edge, 1 at the right/bottom; outside when the
/// point is off the picture). `anchor` is measured from the viewport's centre,
/// like `zoomAbout`'s.
public func pictureFraction(_ view: ViewState, anchor: Point, content: Size) -> Point {
    let scale = view.scale > 0 ? view.scale : 1
    let x = content.width > 0 ? (anchor.x - view.x) / scale / content.width + 0.5 : 0.5
    let y = content.height > 0 ? (anchor.y - view.y) / scale / content.height + 0.5 : 0.5
    return Point(x, y)
}

/// Where the picture sits in the viewport, in its pixels from the top-left corner.
public func pictureRect(_ view: ViewState, viewport: Size, content: Size) -> Rect {
    let width = content.width * view.scale
    let height = content.height * view.scale
    let x = viewport.width / 2 + view.x - width / 2
    let y = viewport.height / 2 + view.y - height / 2
    return Rect(x: x, y: y, width: width, height: height)
}

/// A part of the picture, as shares of its width and height: `x0 ≤ x1`,
/// `y0 ≤ y1`, all in [0, 1].
public struct PictureWindow: Equatable, Sendable {
    public var x0: Double
    public var y0: Double
    public var x1: Double
    public var y1: Double

    public init(x0: Double, y0: Double, x1: Double, y1: Double) {
        self.x0 = x0; self.y0 = y0; self.x1 = x1; self.y1 = y1
    }

    public static let whole = PictureWindow(x0: 0, y0: 0, x1: 1, y1: 1)
}

/// The part of the picture the viewport shows — the picture's placement
/// (`pictureRect`) cut by the viewport's own box, as shares of the picture.
public func visibleWindow(_ rect: Rect, viewport: Size) -> PictureWindow {
    if !(rect.width > 0) || !(rect.height > 0) { return .whole }
    func share(_ v: Double, _ from: Double, _ size: Double) -> Double {
        clamp01((v - from) / size)
    }
    return PictureWindow(
        x0: share(0, rect.x, rect.width),
        y0: share(0, rect.y, rect.height),
        x1: share(viewport.width, rect.x, rect.width),
        y1: share(viewport.height, rect.y, rect.height)
    )
}

/// What `object-contain` really draws: the picture's own size, fitted into the
/// box without cropping it. The pan limits are measured off THIS, never off
/// the viewport. Nothing measured yet contains to the box itself, which gives
/// no slack and so pans nowhere.
public func containedSize(_ natural: Size?, _ viewport: Size) -> Size {
    guard let natural, natural.width > 0, natural.height > 0 else { return viewport }
    if !(viewport.width > 0) || !(viewport.height > 0) { return viewport }
    let k = min(viewport.width / natural.width, viewport.height / natural.height)
    return Size(natural.width * k, natural.height * k)
}

/// How far the picture may be moved off centre before an edge would come into
/// the box: half of whatever the scaled picture has over the viewport.
public func panLimit(viewport: Size, content: Size, scale: Double) -> Point {
    let x = max(0, (content.width * scale - viewport.width) / 2)
    let y = max(0, (content.height * scale - viewport.height) / 2)
    return Point(x, y)
}

/// The same view with its offsets held inside those limits. A `−0` is spelled
/// `0`: an offset that compares unequal to the fit makes "is this view at
/// rest?" lie, and the deck asks exactly that.
public func clampView(_ view: ViewState, viewport: Size, content: Size, _ max: Double = maxViewZoom) -> ViewState {
    let scale = clampViewZoom(view.scale, max)
    let limit = panLimit(viewport: viewport, content: content, scale: scale)
    let x = clamp(view.x, -limit.x, limit.x)
    let y = clamp(view.y, -limit.y, limit.y)
    return ViewState(scale: scale, x: x == 0 ? 0 : x, y: y == 0 ? 0 : y)
}

/// Zoom to `next` while keeping the point under `anchor` still.
///
/// `anchor` is in the viewport's own coordinates, measured from its CENTRE —
/// where the transform's origin is. A point of the picture sits at
/// `c × scale + offset`; asking that it still sit at `anchor` afterwards gives
/// `offset' = anchor − (anchor − offset) × next / scale`.
public func zoomAbout(_ view: ViewState, _ next: Double, anchor: Point, viewport: Size, content: Size,
                      _ max: Double = maxViewZoom) -> ViewState {
    let scale = clampViewZoom(next, max)
    if view.scale <= 0 {
        return clampView(ViewState(scale: scale, x: view.x, y: view.y), viewport: viewport, content: content, max)
    }
    let k = scale / view.scale
    let x = anchor.x - (anchor.x - view.x) * k
    let y = anchor.y - (anchor.y - view.y) * k
    return clampView(ViewState(scale: scale, x: x, y: y), viewport: viewport, content: content, max)
}

/// `Math.sign`: 1, −1 or 0.
private func signOf(_ v: Double) -> Double {
    v > 0 ? 1 : (v < 0 ? -1 : 0)
}

/// Resistance past an end of the deck — the iOS curve, asymptotic to about
/// half the width, so a drag that has nowhere to go still moves and still
/// says so.
public func rubberBand(_ distance: Double, _ dimension: Double) -> Double {
    if !(dimension > 0) { return 0 }
    let c = 0.55
    let pull = abs(distance)
    let resisted = 1 - 1 / (pull / (dimension * c) + 1)
    return signOf(distance) * resisted * dimension * c
}

/// Fractions of the slot width, and px per ms, at which a drag becomes a page.
public let swipeDistance = 0.25
public let swipeVelocity = 0.5

/// What a released drag does: `1` next, `−1` previous, `0` snap back. Either
/// far enough or fast enough — but a flick whose speed disagrees with where
/// the fingers ended up is a hesitation, not a page.
public func swipeCommit(_ dx: Double, _ width: Double, _ velocity: Double) -> Int {
    if !(width > 0) || dx == 0 { return 0 }
    let flick = abs(velocity) > swipeVelocity && signOf(velocity) == signOf(dx)
    if !flick && abs(dx) < width * swipeDistance { return 0 }
    return dx < 0 ? 1 : -1
}

/// Wheel pixels past which a trackpad sweep is a page, however wide the slot.
public let sweepCommitPx = 160.0

/// Whether a horizontal wheel sweep IN PROGRESS has already earned its page: a
/// quarter of the slot, capped, because a wheel stream has no release and
/// macOS keeps sending momentum for a second after the fingers lift.
public func sweepCommit(_ swept: Double, _ width: Double) -> Int {
    if !(width > 0) { return 0 }
    if abs(swept) < min(width * swipeDistance, sweepCommitPx) { return 0 }
    return swept < 0 ? 1 : -1
}

/// Whether a wheel event swallowed as a finished sweep's momentum is in fact
/// the START of a new sweep: momentum only ever decays, fingers landing again
/// push the delta back up or reverse it.
public func sweepRestarts(_ previous: Double, _ next: Double) -> Bool {
    let a = abs(previous)
    let b = abs(next)
    if b < 8 { return false }
    if b > a * 2 { return true }
    return previous != 0 && signOf(previous) != signOf(next)
}
