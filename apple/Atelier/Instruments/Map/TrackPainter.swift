// A flight path on a BLANK map — the native twin of the web's tiles-free
// MapLibre style (`src/shared/map/track-map.ts`): the paper backdrop
// `#e8e2d4`, the accent line `#d9442a` at 3 px with round caps and joins and
// 90 % opacity, the aircraft a 14 px accent dot ringed in white. Fixed colours,
// not theme tokens: a map is a picture and does not turn dark at night.
//
// ONE painter for every size it is drawn at — the Flight Map's stage, the
// Composer's preview and the Composer's export — the web's rule that a
// preview and a file are the same code at two sizes. It paints in a y-DOWN
// Core Graphics context (a SwiftUI canvas's, or a bitmap flipped once), and
// where each fix lands is the kernel's `TrackCamera`.

import CoreGraphics
import SwiftUI
import AtelierKit

enum TrackPainter {
    /// `MAP_PAPER_BG`.
    static let paper = CGColor(srgbRed: 0xE8 / 255, green: 0xE2 / 255, blue: 0xD4 / 255, alpha: 1)
    /// `MAP_ACCENT`.
    static let accent = CGColor(srgbRed: 0xD9 / 255, green: 0x44 / 255, blue: 0x2A / 255, alpha: 1)

    /// Paint the path (and the aircraft, when there is a fix) into `rect` of a
    /// y-down context. `view` is a zoom about the rect's centre plus a pan, in
    /// the rect's px — the Flight Map's pinch; the line and the dot keep their
    /// on-screen size whatever it is, as MapLibre's do.
    static func draw(_ cg: CGContext, in rect: CGRect, track: [TrackPoint], position: LonLat?,
                     camera: TrackCamera?, view: ViewState = .fitted, scale: CGFloat = 1) {
        cg.saveGState()
        defer { cg.restoreGState() }
        cg.clip(to: rect)
        cg.setFillColor(paper)
        cg.fill(rect)
        guard let camera else { return }

        let size = Size(Double(rect.width), Double(rect.height))
        func place(_ lat: Double, _ lon: Double) -> CGPoint {
            let p = camera.point(lat: lat, lon: lon, in: size)
            // The view zoom: about the rect's centre, then the pan.
            let cx = size.width / 2
            let cy = size.height / 2
            let x = cx + view.x + (p.x - cx) * view.scale
            let y = cy + view.y + (p.y - cy) * view.scale
            return CGPoint(x: rect.minX + CGFloat(x), y: rect.minY + CGFloat(y))
        }

        if track.count > 1 {
            let path = CGMutablePath()
            for (i, p) in track.enumerated() {
                let point = place(p.lat, p.lon)
                if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            cg.addPath(path)
            cg.setStrokeColor(accent.copy(alpha: 0.9) ?? accent)
            cg.setLineWidth(3 * scale)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            cg.strokePath()
        }

        if let position {
            let centre = place(position.lat, position.lon)
            let radius = 7 * scale
            let dot = CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2)
            // The 1 px dark hairline the web's box-shadow draws around the ring.
            cg.setFillColor(CGColor(gray: 0, alpha: 0.4))
            cg.fillEllipse(in: dot.insetBy(dx: -1 * scale, dy: -1 * scale))
            cg.setFillColor(CGColor(gray: 1, alpha: 1))
            cg.fillEllipse(in: dot)
            cg.setFillColor(accent)
            cg.fillEllipse(in: dot.insetBy(dx: 2 * scale, dy: 2 * scale))
        }
    }
}

/// The Flight Map's stage with no map under it: the path drawn by
/// `TrackPainter`, framed by the kernel's camera (48 px of padding, never
/// past zoom 17, a lone fix at zoom 16 — the web's `fitBounds`), zoomed by a
/// pinch or ±, panned by a drag once zoomed, fitted again by a double tap.
struct FlightTrackCanvas: View {
    let track: [TrackPoint]
    let position: LonLat?
    @State private var view = ViewState.fitted
    @State private var gestureStart: ViewState?
    @Environment(\.palette) private var palette

    /// A map zooms further than a picture: 32× the fit.
    private let ceiling = 32.0

    var body: some View {
        GeometryReader { geo in
            let viewport = Size(Double(geo.size.width), Double(geo.size.height))
            let camera = fitTrackCamera(track, viewport: viewport, padding: 48, maxZoom: 17, singleZoom: 16)
            Canvas { context, size in
                context.withCGContext { cg in
                    TrackPainter.draw(cg, in: CGRect(origin: .zero, size: size), track: track, position: position,
                                      camera: camera, view: view)
                }
            }
            .contentShape(Rectangle())
            .gesture(pan(viewport))
            .simultaneousGesture(pinch(viewport))
            .onTapGesture(count: 2) { withAnimation(.easeOut(duration: 0.2)) { view = .fitted } }
            .overlay(alignment: .topTrailing) { zoomButtons(viewport) }
        }
        .onChange(of: track.count) { _, _ in view = .fitted }
    }

    private func pan(_ viewport: Size) -> some Gesture {
        DragGesture()
            .onChanged { drag in
                let start = gestureStart ?? view
                if gestureStart == nil { gestureStart = view }
                let moved = ViewState(scale: start.scale, x: start.x + Double(drag.translation.width),
                                      y: start.y + Double(drag.translation.height))
                view = clampView(moved, viewport: viewport, content: viewport, ceiling)
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func pinch(_ viewport: Size) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = gestureStart ?? view
                if gestureStart == nil { gestureStart = view }
                let anchor = Point(Double(value.startLocation.x) - viewport.width / 2,
                                   Double(value.startLocation.y) - viewport.height / 2)
                view = zoomAbout(start, start.scale * Double(value.magnification), anchor: anchor,
                                 viewport: viewport, content: viewport, ceiling)
            }
            .onEnded { _ in gestureStart = nil }
    }

    /// The web's NavigationControl: zoom in, zoom out.
    private func zoomButtons(_ viewport: Size) -> some View {
        VStack(spacing: 0) {
            Button { step(1, viewport) } label: { Image(systemName: "plus").frame(width: 30, height: 30) }
                .accessibilityLabel("Zoom in")
            Divider().frame(width: 30)
            Button { step(-1, viewport) } label: { Image(systemName: "minus").frame(width: 30, height: 30) }
                .accessibilityLabel("Zoom out")
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color(white: 0.2))
        .background(Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 6))
        .padding(10)
    }

    private func step(_ direction: Int, _ viewport: Size) {
        let next = stepViewZoom(view.scale, direction, ceiling)
        withAnimation(.easeOut(duration: 0.15)) {
            view = zoomAbout(view, next, anchor: .zero, viewport: viewport, content: viewport, ceiling)
        }
    }
}

#Preview("Blank map") {
    FlightTrackCanvas(track: InstrumentFixtures.track.track,
                      position: parsePosition(InstrumentFixtures.track.cues[200]))
        .frame(height: 360)
}
