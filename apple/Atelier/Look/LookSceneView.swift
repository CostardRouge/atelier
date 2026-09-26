// The SCENE — the aimed look on the host's own picture, above the grid. The
// web's `LookScene.tsx`.
//
// The picture is shown WHOLE in the band, on the dark of a light table, and
// the graded half is the render graph's cube pass on it (`LookGalleryModel`
// renders; this draws). The wipe reads BEFORE → AFTER, the suite's one way:
// the ORIGINAL left of the divider, the graded picture right
// (`develop-roll.md`). It is looked INTO, like the lightbox: pinch, a double
// tap, the ± pill, a drag that pans once zoomed — fit to 8×, the lightbox's
// ceiling, since what is on screen is a 720p raster and magnifying a preview
// pixel says nothing about a look. At the fit a press across the picture
// places the divider; zoomed, a drag pans and only the divider's own handle
// still wipes.

import CoreGraphics
import Observation
import SwiftUI
import AtelierKit

/// The scene's view zoom — a view that writes nothing (`frontend.md`,
/// «Two uses, one hand»: LOOKING), fit the floor, 8× the ceiling, every zoom
/// keeping the point under the hand still (`zoomAbout`), a pan clamped at the
/// write.
@MainActor
@Observable
final class SceneZoom {
    private(set) var view: ViewState = .fitted
    private(set) var settling = false
    @ObservationIgnored private var viewport = Size(0, 0)
    @ObservationIgnored private var content = Size(0, 0)
    let ceiling = maxViewZoom

    var zoomed: Bool { view.scale > 1.0001 }
    var label: String { zoomLabel(view.scale) }

    func layout(viewport: CGSize, content: CGSize) {
        self.viewport = Size(Double(viewport.width), Double(viewport.height))
        self.content = Size(Double(content.width), Double(content.height))
        let next = clampView(view, viewport: self.viewport, content: self.content, ceiling)
        if next != view { view = next }
    }

    func reset() {
        settling = false
        view = .fitted
    }

    func fit() {
        settling = true
        view = .fitted
    }

    func zoomIn(about anchor: CGPoint? = nil) {
        settling = true
        apply(stepViewZoom(view.scale, 1, ceiling), anchor)
    }

    func zoomOut() {
        settling = true
        apply(stepViewZoom(view.scale, -1, ceiling), nil)
    }

    func toggle(about anchor: CGPoint) {
        if zoomed { fit() } else { zoomIn(about: anchor) }
    }

    func pinch(from start: Double, ratio: Double, anchor: CGPoint) {
        settling = false
        apply(zoomByPinchRatio(start, ratio, ceiling), anchor)
    }

    func pan(dx: Double, dy: Double) {
        settling = false
        let moved = ViewState(scale: view.scale, x: view.x + dx, y: view.y + dy)
        view = clampView(moved, viewport: viewport, content: content, ceiling)
    }

    /// `anchor` in the box's coordinates (top-left origin), or its centre.
    private func apply(_ scale: Double, _ anchor: CGPoint?) {
        let centred = anchor.map {
            AtelierKit.Point(Double($0.x) - viewport.width / 2, Double($0.y) - viewport.height / 2)
        } ?? AtelierKit.Point(0, 0)
        view = zoomAbout(view, scale, anchor: centred, viewport: viewport, content: content, ceiling)
    }
}

struct LookSceneView: View {
    /// The picture as it is, fitted to the scene's budget.
    let original: CGImage?
    /// The same through the aimed look — nil while it loads, or for "No look".
    let graded: CGImage?
    let compare: Bool
    /// Where the divider sits, 0…1 — the original on its left.
    let splitX: Double
    /// A press across the picture, or the handle, moves the divider — and turns the wipe on.
    let onSplit: (Double) -> Void
    /// True while the aimed look's lattice is being read.
    let busy: Bool
    /// Why the aimed look cannot be shown, when it cannot.
    let error: String?
    /// Changes with the picture: the view starts over.
    let resetKey: String

    @State private var zoom = SceneZoom()
    @State private var pinchStart: Double?
    @State private var dragLast: CGSize?
    @Environment(\.palette) private var palette

    var body: some View {
        GeometryReader { geo in
            let box = geo.size
            let natural = original.map { CGSize(width: $0.width, height: $0.height) } ?? .zero
            let fitted = LookSceneView.contained(natural, in: box)
            let rect = drawnRect(fitted, in: box)
            ZStack {
                palette.frame
                if let original {
                    picture(original, fitted)
                    if compare {
                        divider(rect, box)
                        if !zoom.zoomed { halfNames(rect) }
                    }
                }
                chrome
            }
            .coordinateSpace(.named(LookSceneView.space))
            .contentShape(Rectangle())
            .gesture(sceneGesture(rect))
            .simultaneousGesture(SpatialTapGesture(count: 2).onEnded { value in
                zoom.toggle(about: value.location)
            })
            .onChange(of: LayoutKey(box: box, fitted: fitted), initial: true) { _, key in
                zoom.layout(viewport: key.box, content: key.fitted)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .onChange(of: resetKey) { _, _ in zoom.reset() }
    }

    static let space = "look-scene"

    // MARK: - geometry

    /// The picture's own box, fitted WHOLE into the band.
    static func contained(_ natural: CGSize, in box: CGSize) -> CGSize {
        let size = containedSize(Size(Double(natural.width), Double(natural.height)), Size(Double(box.width), Double(box.height)))
        return CGSize(width: size.width, height: size.height)
    }

    /// Where the picture is on screen after the zoom — the divider and the
    /// pointer are measured on it, never on the band.
    private func drawnRect(_ fitted: CGSize, in box: CGSize) -> CGRect {
        let scale = CGFloat(zoom.view.scale)
        let w = fitted.width * scale
        let h = fitted.height * scale
        let x = (box.width - w) / 2 + CGFloat(zoom.view.x)
        let y = (box.height - h) / 2 + CGFloat(zoom.view.y)
        return CGRect(x: x, y: y, width: w, height: h)
    }

    private func fraction(_ location: CGPoint, _ rect: CGRect) -> Double {
        guard rect.width > 0 else { return 0.5 }
        return clamp01(Double((location.x - rect.minX) / rect.width))
    }

    // MARK: - the picture

    private func picture(_ original: CGImage, _ fitted: CGSize) -> some View {
        ZStack(alignment: .leading) {
            Image(decorative: graded ?? original, scale: 1, orientation: .up)
                .resizable()
                .interpolation(.high)
                .frame(width: fitted.width, height: fitted.height)
            if compare && graded != nil {
                Image(decorative: original, scale: 1, orientation: .up)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: fitted.width, height: fitted.height)
                    .mask(alignment: .leading) {
                        Rectangle().frame(width: max(0, fitted.width * CGFloat(splitX)))
                    }
            }
        }
        .frame(width: fitted.width, height: fitted.height)
        .scaleEffect(zoom.view.scale)
        .offset(x: zoom.view.x, y: zoom.view.y)
        .animation(zoom.settling ? .easeOut(duration: 0.22) : nil, value: zoom.view)
        .accessibilityLabel(graded == nil ? "Your picture, as it is" : "Your picture, through the look")
    }

    /// A grab strip, not a hairline: zoomed, it is the only thing that still
    /// wipes instead of panning, so a finger must reach it.
    private func divider(_ rect: CGRect, _ box: CGSize) -> some View {
        let x = min(max(rect.minX + rect.width * CGFloat(splitX), 14), box.width - 14)
        let top = max(rect.minY, 0)
        let bottom = min(rect.maxY, box.height)
        let height = max(0, bottom - top)
        return ZStack {
            Rectangle()
                .fill(palette.onMedia.opacity(0.9))
                .frame(width: 2, height: height)
            if zoom.zoomed {
                Image(systemName: "chevron.left.chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(palette.inkSoft)
                    .frame(width: 24, height: 24)
                    .background(palette.surface.opacity(0.92), in: Circle())
                    .overlay(Circle().stroke(palette.lineStrong, lineWidth: 1))
            }
        }
        .frame(width: 28, height: height)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named(LookSceneView.space)).onChanged { value in
            onSplit(fraction(value.location, rect))
        })
        .help("Drag to compare with the original")
        .position(x: x, y: top + height / 2)
    }

    /// The two words name the picture's own halves — drawn only while both are
    /// on screen: panned into a corner, a "Graded" would name whatever is under it.
    private func halfNames(_ rect: CGRect) -> some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            sceneChip("Original")
                .position(x: rect.minX + 44, y: rect.maxY - 18)
            sceneChip("Graded")
                .position(x: rect.maxX - 40, y: rect.maxY - 18)
        }
        .allowsHitTesting(false)
    }

    private func sceneChip(_ text: String) -> some View {
        Text(text.uppercased())
            .font(Brand.mono(9))
            .kerning(1)
            .foregroundStyle(palette.onMedia)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(palette.frame.opacity(0.7), in: Capsule())
    }

    // MARK: - over the picture

    private var chrome: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                zoomPill
                Spacer(minLength: 8)
                if busy { sceneChip("Reading…") }
            }
            Spacer(minLength: 0)
            if let error {
                Text(error)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.onMedia)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(palette.frame.opacity(0.8), in: RoundedRectangle(cornerRadius: 8))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
    }

    /// The way back from a zoom, drawn at every width and at rest too.
    private var zoomPill: some View {
        HStack(spacing: 0) {
            Button { zoom.zoomOut() } label: { Image(systemName: "minus").frame(width: 26, height: 26) }
                .disabled(!zoom.zoomed)
                .accessibilityLabel("Zoom out")
            Button { zoom.fit() } label: {
                Text(zoom.label)
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .frame(width: 44, height: 26)
            }
            .help("wheel, or pinch — a tap fits")
            Button { zoom.zoomIn() } label: { Image(systemName: "plus").frame(width: 26, height: 26) }
                .disabled(zoom.view.scale >= zoom.ceiling - 1e-6)
                .accessibilityLabel("Zoom in")
        }
        .buttonStyle(.plain)
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(palette.inkSoft)
        .background(palette.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.line, lineWidth: 1))
    }

    // MARK: - the hand

    private func sceneGesture(_ rect: CGRect) -> some Gesture {
        let pinch = MagnifyGesture()
            .onChanged { value in
                guard original != nil else { return }
                let start = pinchStart ?? zoom.view.scale
                if pinchStart == nil { pinchStart = start }
                zoom.pinch(from: start, ratio: Double(value.magnification), anchor: value.startLocation)
            }
            .onEnded { _ in pinchStart = nil }
        let drag = DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard original != nil, pinchStart == nil else { return }
                if zoom.zoomed {
                    let last = dragLast ?? .zero
                    zoom.pan(dx: Double(value.translation.width - last.width),
                             dy: Double(value.translation.height - last.height))
                    dragLast = value.translation
                } else if compare {
                    onSplit(fraction(value.location, rect))
                }
            }
            .onEnded { _ in dragLast = nil }
        return SimultaneousGesture(pinch, drag)
    }
}

private struct LayoutKey: Equatable {
    let box: CGSize
    let fitted: CGSize
}

#Preview("Scene") {
    LookSceneView(original: LookFixtures.chart, graded: LookFixtures.warmChart, compare: true, splitX: 0.4,
                  onSplit: { _ in }, busy: false, error: nil, resetKey: "chart")
        .frame(width: 420, height: 260)
        .padding()
}
