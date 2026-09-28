// The whole picture, with the window each card shows and its dot in order —
// the web's `src/tools/roadtrip/panels/TourMap.tsx` (`roadtrip.md`, «The
// tour», «And the map is on the cards too»): the one place a move is drawn ON
// the picture, since the stage only ever shows the frame.
//
// Rules kept:
// - a tap on the picture APPENDS a card looking there — it becomes the End —,
//   and the same finger goes on placing it; a press on a dot picks that card
//   and a drag moves it at its own zoom; nothing past `maxCards`;
// - a pinch (two fingers, a trackpad) or the Mac's wheel zooms the PICKED card
//   about the point it looks at; a second finger turns a drag into a pinch
//   and moves nothing;
// - a dot's grab reaches at least 12 points whatever the map's width (at a
//   field's width the dots were 5 px and a drag made a new stop instead);
// - a card is drawn where the view can really CENTRE at its zoom — the model
//   reads the stops back out of the cards, never where a finger landed;
// - everything it writes goes through the editor's card verbs, so the map and
//   the row can never disagree.

import SwiftUI
import AtelierKit

struct PieceTourMap: View {
    /// The picture the tour is over — the selected cell's own file, decoded.
    let picture: PaintPicture?
    let plan: PieceTourPlan
    /// The card in hand, or nil while the needle is between two.
    let selected: Int?
    /// The picked card's zoom, for the wheel; nil between two cards.
    let zoom: Double?
    let onSelect: (Int) -> Void
    /// A tap on the picture: a card there, after the last, which becomes the End.
    let onAdd: (TourStop) -> Void
    /// A card's dot dragged: that card looks at the point, at its own zoom.
    let onMove: (Int, TourStop) -> Void
    /// A pinch or a wheel on the map: the picked card's zoom, by this factor —
    /// applied to the zoom the document holds now, never to a render's copy.
    let onZoomBy: (Double) -> Void

    @Environment(\.palette) private var palette
    @State private var began = false
    @State private var dragging: Int?
    @State private var pinching = false
    @State private var lastMagnification: CGFloat = 1
    @State private var wheel = PieceTourWheel()

    /// The map's own units: 1000 across, whatever the picture's size.
    private static let unit = 1000.0
    private static let dot = 30.0
    /// The least a stop's grab reaches, in points, whatever the map's width.
    private static let minReach = 12.0

    var body: some View {
        let aspect = CGFloat(max(0.1, plan.aspect))
        GeometryReader { geo in
            ZStack {
                palette.frame
                if let picture {
                    Image(decorative: picture.image, scale: 1)
                        .resizable()
                        .interpolation(.medium)
                        .frame(width: geo.size.width, height: geo.size.height)
                }
                overlay(geo.size)
            }
            .contentShape(Rectangle())
            .gesture(press(geo.size))
            .simultaneousGesture(pinch)
            #if os(macOS)
            .overlay(WheelCatcher(target: wheelTarget(), enabled: zoom != nil))
            #endif
        }
        .aspectRatio(aspect, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("The whole picture: tap to add a card, drag a card's dot to move it, pinch or scroll to zoom the picked card")
        .accessibilityValue("\(plan.stops.count) \(plan.stops.count == 1 ? "card" : "cards")")
    }

    // MARK: - the drawing

    private func overlay(_ size: CGSize) -> some View {
        let stops = plan.stops
        let windows = plan.windows
        let picked = selected ?? -1
        let ink = palette.onMedia
        let accent = palette.accent
        let ground = palette.frame
        return Canvas { ctx, box in
            let w = Double(box.width)
            let h = Double(box.height)
            let k = w / PieceTourMap.unit
            func at(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: CGFloat(x * w), y: CGFloat(y * h)) }

            // The path the view travels, card to card.
            if stops.count > 1 {
                var path = Path()
                path.move(to: at(stops[0].x, stops[0].y))
                for s in stops.dropFirst() { path.addLine(to: at(s.x, s.y)) }
                ctx.stroke(path, with: .color(ink.opacity(0.75)), style: StrokeStyle(lineWidth: 2, dash: [8, 7]))
            }
            for (i, window) in windows.enumerated() where !window.isEmpty {
                var poly = Path()
                poly.move(to: at(window[0].x, window[0].y))
                for p in window.dropFirst() { poly.addLine(to: at(p.x, p.y)) }
                poly.closeSubpath()
                if i == picked {
                    ctx.fill(poly, with: .color(accent.opacity(0.14)))
                    ctx.stroke(poly, with: .color(accent), lineWidth: 2)
                } else {
                    ctx.stroke(poly, with: .color(ink.opacity(0.55)), lineWidth: 1)
                }
            }
            let r = CGFloat(PieceTourMap.dot * k)
            for (i, s) in stops.enumerated() {
                let c = at(s.x, s.y)
                let disc = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
                ctx.fill(disc, with: .color(i == picked ? accent : ground.opacity(0.82)))
                ctx.stroke(disc, with: .color(ink), lineWidth: 2)
                let number = Text("\(i + 1)").font(Brand.sans(max(8, r * 1.1), weight: .bold)).foregroundColor(ink)
                ctx.draw(number, at: c, anchor: .center)
            }
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(false)
    }

    // MARK: - the hand

    private func stopAt(_ p: CGPoint, _ size: CGSize) -> TourStop? {
        guard size.width > 0, size.height > 0 else { return nil }
        let x = min(1, max(0, Double(p.x / size.width)))
        let y = min(1, max(0, Double(p.y / size.height)))
        return TourStop(x: x, y: y)
    }

    /// The card whose dot is under `p`, the nearest first.
    private func hit(_ p: CGPoint, _ size: CGSize) -> Int? {
        let w = Double(size.width)
        let h = Double(size.height)
        let reach = max(PieceTourMap.minReach, PieceTourMap.dot * 1.4 * w / PieceTourMap.unit)
        var best: Int?
        var gap = Double.infinity
        for (i, s) in plan.stops.enumerated() {
            let d = hypot((s.x * w) - Double(p.x), (s.y * h) - Double(p.y))
            if d <= reach && d < gap {
                best = i
                gap = d
            }
        }
        return best
    }

    private func press(_ size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { g in
                guard !pinching else { return }
                if !began {
                    began = true
                    if let index = hit(g.startLocation, size) {
                        onSelect(index)
                        dragging = index
                    } else if plan.stops.count < maxCards, let stop = stopAt(g.startLocation, size) {
                        // The card just added is the last; the same finger goes on placing it.
                        dragging = plan.stops.count
                        onAdd(stop)
                    } else {
                        dragging = nil
                    }
                    return
                }
                guard let index = dragging, let stop = stopAt(g.location, size) else { return }
                onMove(index, stop)
            }
            .onEnded { _ in
                began = false
                dragging = nil
            }
    }

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                if !pinching {
                    pinching = true
                    dragging = nil
                    lastMagnification = 1
                }
                let factor = value.magnification / max(0.0001, lastMagnification)
                lastMagnification = value.magnification
                if zoom != nil { onZoomBy(Double(factor)) }
            }
            .onEnded { _ in
                pinching = false
                lastMagnification = 1
            }
    }

    /// The wheel's target, handed this render's zoom and verb.
    private func wheelTarget() -> PieceTourWheel {
        wheel.current = zoom ?? 1
        wheel.apply = onZoomBy
        return wheel
    }
}

/// The Mac's wheel over the map, read by the kernel's one reading of the hand
/// (`ZoomGestureMachine`, through `WheelCatcher`): it zooms the PICKED card,
/// handing on the factor between the scale it asks for and the one it had.
@MainActor
final class PieceTourWheel: ZoomTarget {
    var current = 1.0
    var apply: (Double) -> Void = { _ in }

    nonisolated func scaleAt(_ at: AtelierKit.Point) -> Double {
        MainActor.assumeIsolated { current }
    }

    nonisolated func zoomTo(_ scale: Double, anchor: AtelierKit.Point, by: ZoomBy) {
        MainActor.assumeIsolated {
            let next = min(maxFramingScale, max(1, scale))
            let factor = next / max(current, 1e-6)
            current = next
            apply(factor)
        }
    }

    nonisolated func panBy(_ dx: Double, _ dy: Double, at: AtelierKit.Point, by: PanBy) {}
}

#Preview("Tour map") {
    let plan = PieceTourPlan(
        stops: [TourStop(x: 0.25, y: 0.5), TourStop(x: 0.55, y: 0.4), TourStop(x: 0.8, y: 0.55)],
        windows: [
            [AtelierKit.Point(0.1, 0.2), AtelierKit.Point(0.4, 0.2), AtelierKit.Point(0.4, 0.8), AtelierKit.Point(0.1, 0.8)],
            [AtelierKit.Point(0.4, 0.1), AtelierKit.Point(0.7, 0.1), AtelierKit.Point(0.7, 0.7), AtelierKit.Point(0.4, 0.7)],
            [AtelierKit.Point(0.6, 0.2), AtelierKit.Point(1.0, 0.2), AtelierKit.Point(1.0, 0.9), AtelierKit.Point(0.6, 0.9)],
        ],
        aspect: 3.0 / 2
    )
    return PieceTourMap(picture: nil, plan: plan, selected: 1, zoom: 1.4, onSelect: { _ in }, onAdd: { _ in },
                        onMove: { _, _ in }, onZoomBy: { _ in })
        .frame(width: 340)
        .padding(16)
        .darkroom()
}
