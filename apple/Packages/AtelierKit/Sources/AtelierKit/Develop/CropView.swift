// How closely the crop STAGE looks at the picture — inspection only, never
// the zone. Port of `src/tools/develop/crop-view.ts`. A pinch, the wheel, the
// ± pill and `Z` move it; the crop stored on the roll is exactly what it was.
//
// The arithmetic is the Develop viewport's (`UI/PanZoom.swift`): the
// quarter-turned picture, fitted ONCE inside the stage with room for the
// handles, is the CONTENT; the stage is the viewport; the view is a scale about
// the stage's centre plus an offset, held so the picture never leaves the
// middle of the stage. Sharing it is what makes a zoom here feel like a zoom on
// the Adjust tab — the same hand, the same ceiling shape, the same anchor.
//
// **Clamped when it is WRITTEN, never only when it is drawn.** The web's first
// crop stage clamped the pan at paint time and stored whatever the gesture
// produced: the drawn origin and the stored one then disagreed the moment a
// pan hit its limit, and the next notch anchored from an origin that was not
// on screen — the picture drifted under a still pointer. Every write goes
// through `clampCropView`, so what is stored is what is drawn.

import Foundation

/// `zoom` 1 = the picture fitted; `x`/`y` pan the view in points, about the stage's centre.
public struct CropView: Equatable, Sendable {
    public var zoom: Double
    public var x: Double
    public var y: Double

    public init(zoom: Double, x: Double, y: Double) {
        self.zoom = zoom; self.x = x; self.y = y
    }

    /// The web's `CROP_VIEW_FIT`.
    public static let fit = CropView(zoom: 1, x: 0, y: 0)
}

/// Eight times the fit — a crop is aimed, not pixel-peeped (that is the Adjust tab's 4000 %).
public let cropViewMax = 8.0
/// Room kept round the fitted picture for the handles, in points.
public let cropPad = 28.0

/// The picture's size once quarter-turned — a fine angle never refits it.
public func quarterTurned(_ src: PictureDims, _ rotation: Double) -> Size {
    let quarter = splitRotation(rotation).quarter
    let odd = Int(abs(quarter).rounded()) % 180 == 90
    return odd ? Size(src.height, src.width) : Size(src.width, src.height)
}

/// Source pixels → stage points at the fit, with the handles' room kept.
public func cropFitScale(_ box: Size, _ src: PictureDims, _ rotation: Double) -> Double {
    let q = quarterTurned(src, rotation)
    let across = (box.width - 2 * cropPad) / q.width
    let down = (box.height - 2 * cropPad) / q.height
    return max(0.0001, min(across, down))
}

/// The fitted picture's size on the stage — the content the view moves.
public func cropContent(_ box: Size, _ src: PictureDims, _ rotation: Double) -> Size {
    let q = quarterTurned(src, rotation)
    let k = cropFitScale(box, src, rotation)
    return Size(q.width * k, q.height * k)
}

private func viewState(_ v: CropView) -> ViewState {
    ViewState(scale: v.zoom, x: v.x, y: v.y)
}

private func cropViewOf(_ v: ViewState) -> CropView {
    CropView(zoom: v.scale, x: v.x, y: v.y)
}

/// The view held inside its limits: the zoom between the fit and the ceiling,
/// the pan to half of what the scaled picture has over the stage. Back at the
/// fit the offsets are zero, so `Z` and the pill land exactly where the stage
/// first opened. Before the stage is measured only the zoom is bounded.
public func clampCropView(_ view: CropView, _ box: Size?, _ src: PictureDims?, _ rotation: Double) -> CropView {
    guard let box, let src else {
        return CropView(zoom: min(cropViewMax, max(1, view.zoom)), x: view.x, y: view.y)
    }
    let content = cropContent(box, src, rotation)
    let held = cropViewOf(clampView(viewState(view), viewport: box, content: content, cropViewMax))
    return held.zoom <= 1 ? .fit : held
}

/// The view at `zoom` with the point under `anchor` — stage points from its
/// top-left corner — kept still: the wheel's pointer, a pinch's centre.
public func zoomCropViewAbout(_ view: CropView, _ zoom: Double, _ anchor: Point, _ box: Size, _ src: PictureDims,
                              _ rotation: Double) -> CropView {
    let centred = Point(anchor.x - box.width / 2, anchor.y - box.height / 2)
    let content = cropContent(box, src, rotation)
    let next = cropViewOf(zoomAbout(viewState(view), zoom, anchor: centred, viewport: box, content: content, cropViewMax))
    return next.zoom <= 1 ? .fit : next
}

/// Where the fitted, zoomed picture's origin (its centre, the zone frame's
/// origin) and scale land on the stage — what the painter draws with. A point
/// `(zx, zy)` of the zone's frame is at `(ox + k·zx, oy + k·zy)` on the stage.
public func cropStageTransform(_ box: Size, _ src: PictureDims, _ rotation: Double,
                               _ view: CropView) -> (k: Double, ox: Double, oy: Double) {
    let k = cropFitScale(box, src, rotation) * view.zoom
    return (k, box.width / 2 + view.x, box.height / 2 + view.y)
}

/// One press of the crop pill's ± (`STAGE_ZOOM_STEP`), about the middle of the
/// view: the offsets scale with the zoom so the middle stays put, and a step
/// that lands at or under the fit IS the fit.
public func stepCropView(_ view: CropView, _ factor: Double) -> CropView {
    let zoom = max(1, min(cropViewMax, view.zoom * factor))
    if zoom == 1 { return .fit }
    let ratio = view.zoom > 0 ? zoom / view.zoom : 1
    return CropView(zoom: zoom, x: view.x * ratio, y: view.y * ratio)
}

/// `Z` on the Crop tab: back to the fit, or two steps closer about the middle.
public func toggleCropView(_ view: CropView) -> CropView {
    view.zoom > 1 ? .fit : CropView(zoom: stageZoomStep * stageZoomStep, x: view.x, y: view.y)
}
