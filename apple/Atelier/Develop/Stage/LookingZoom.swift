// LOOKING at the picture closely — the Develop stage's view zoom, which
// writes nothing (`frontend.md`, «Two uses, one hand»). Fit is the floor,
// 4000 % the ceiling (`inspectMaxZoom`, Lightroom's own), one pixel of the
// picture per device pixel a LANDMARK the % pill names rather than a limit;
// every zoom keeps the point under the hand still (`zoomAbout`); a pan is
// clamped at the WRITE, never only when drawn, so what is stored is what is
// drawn and the next notch anchors where the picture really is.
//
// It is the kernel's `ZoomTarget`, so the one reading of the hand
// (`ZoomGestureMachine`) drives it wherever raw events exist — the Mac's
// scroll wheel and trackpad (`WheelCatcher`) — while SwiftUI's own pinch,
// drag and double tap call the same three verbs. Past the stage's 1:1 the
// picture is drawn smooth or as pixels (`pixelView`, the web's
// `atelier.develop.pixelView`); the loupe that decodes the file whole there
// is not built yet, and the pill says the stage's pixels are what is magnified.

import CoreGraphics
import Foundation
import Observation
import AtelierKit

enum PixelView: String {
    case smooth, pixels
}

@MainActor
@Observable
final class LookingZoom: ZoomTarget {
    private(set) var view: ViewState = .fitted
    /// Animate the next change (a button, a key), never a finger.
    private(set) var settling = false
    /// The stage box, in points.
    @ObservationIgnored private(set) var viewport = Size(0, 0)
    /// The picture fitted in it (`StageGeometry.fitted`).
    @ObservationIgnored private(set) var content = Size(0, 0)
    /// The delivered frame's own pixels, for the 1:1 landmark.
    @ObservationIgnored private(set) var natural: Size?
    /// Device pixels per point.
    @ObservationIgnored var displayScale: Double = 2
    /// The stage render's own pixels — past them the picture is magnified.
    @ObservationIgnored var renderedWidth: Double = 0

    /// How a magnified pixel is drawn — a preference of this device, never the roll's.
    private(set) var pixelView: PixelView

    func setPixelView(_ next: PixelView) {
        pixelView = next
        UserDefaults.standard.set(next.rawValue, forKey: LookingZoom.pixelViewKey)
    }

    static let pixelViewKey = "atelier.develop.pixelView"
    let ceiling = inspectMaxZoom

    init() {
        pixelView = PixelView(rawValue: UserDefaults.standard.string(forKey: LookingZoom.pixelViewKey) ?? "") ?? .smooth
    }

    var zoomed: Bool { view.scale > 1.0001 }

    /// One pixel of the picture per device pixel — the honest 100 %.
    var onePixel: Double { onePixelZoom(natural, content, displayScale) }

    /// Past the STAGE's own pixels: what is on screen is the preview, magnified.
    var magnifying: Bool {
        renderedWidth > 0 && view.scale * content.width * displayScale > renderedWidth + 0.5
    }

    /// The pill's text: `100%` at the fit.
    var label: String { zoomLabel(view.scale) }

    /// The boxes changed (a rotation, a new picture, the drawer): keep the view
    /// inside them.
    func layout(viewport: CGSize, content: CGSize, natural: CGSize?) {
        self.viewport = Size(Double(viewport.width), Double(viewport.height))
        self.content = Size(Double(content.width), Double(content.height))
        self.natural = natural.map { Size(Double($0.width), Double($0.height)) }
        let next = clampView(view, viewport: self.viewport, content: self.content, ceiling)
        if next != view { view = next }
    }

    // MARK: - verbs

    func fit() {
        settle { view = .fitted }
    }

    /// Back to the fit at once — another picture opened: the view starts over.
    func reset() {
        settling = false
        view = .fitted
    }

    func zoomIn(about anchor: CGPoint? = nil) {
        let next = stepViewZoom(view.scale, 1, ceiling)
        settle { apply(scale: next, anchor: anchor) }
    }

    func zoomOut(about anchor: CGPoint? = nil) {
        let next = stepViewZoom(view.scale, -1, ceiling)
        settle { apply(scale: next, anchor: anchor) }
    }

    /// The pill's `100 %` rung.
    func zoom(to scale: Double) {
        settle { apply(scale: scale, anchor: nil) }
    }

    /// `Z` and a double tap: closer, or back to the fit.
    func toggle(about anchor: CGPoint? = nil) {
        if zoomed { fit() } else { zoomIn(about: anchor) }
    }

    /// A pinch in flight: the scale it began at times the fingers' ratio.
    func pinch(from start: Double, ratio: Double, anchor: CGPoint) {
        settling = false
        apply(scale: zoomByPinchRatio(start, ratio, ceiling), anchor: anchor)
    }

    func pan(dx: Double, dy: Double) {
        settling = false
        let moved = ViewState(scale: view.scale, x: view.x + dx, y: view.y + dy)
        view = clampView(moved, viewport: viewport, content: content, ceiling)
    }

    /// `anchor` in the box's own coordinates (top-left origin), or its centre.
    private func apply(scale: Double, anchor: CGPoint?) {
        let centred = anchor.map { Point(Double($0.x) - viewport.width / 2, Double($0.y) - viewport.height / 2) } ?? .zero
        view = zoomAbout(view, scale, anchor: centred, viewport: viewport, content: content, ceiling)
    }

    private func settle(_ change: () -> Void) {
        settling = true
        change()
    }

    // MARK: - ZoomTarget (the machine's hand, in the box's coordinates)

    nonisolated func scaleAt(_ at: Point) -> Double {
        MainActor.assumeIsolated { view.scale }
    }

    nonisolated func zoomTo(_ scale: Double, anchor: Point, by: ZoomBy) {
        MainActor.assumeIsolated {
            settling = false
            apply(scale: scale, anchor: CGPoint(x: anchor.x, y: anchor.y))
        }
    }

    nonisolated func panBy(_ dx: Double, _ dy: Double, at: Point, by: PanBy) {
        MainActor.assumeIsolated { pan(dx: dx, dy: dy) }
    }
}
