// The PICKING MAP — where the author chooses the Itinerary's stops. The
// native twin of `src/shared/roadtrip/hooks/map-field.tsx`.
//
// It is the SAME projection the opener paints with (`fitMapProjection`), run
// backwards (`unproject`): a press comes back as a coordinate pair, so a stop
// can be dropped where there is nothing to press on, and what you point at is
// exactly what the export draws — the same scale, the same bow on every hop.
//
// Rules kept (`roadtrip.md`, «The picking map is the export's own
// projection, run backwards»):
// - NO tiles and NO request of any kind: the backdrop is a graticule, the
//   trip's own located places are the landmarks (a hollow ring; a press adopts
//   one), and a place you cannot see is found by NAME in the panel beside.
// - A pin is dropped on the way UP and only if the finger stayed put (4
//   points): a drag over the field must not leave a trail of stops.
// - A stop pressed is selected and follows the finger; a landmark pressed is
//   adopted at once.
// - Every gesture has its keyboard twin in the panel: the chips, the search
//   field, two number fields, the order buttons.
//
// Two things differ on purpose: while a stop is dragged the field keeps the
// projection it had when the press began (and refits on release) — the web
// refits on every move, so the dragged stop, one end of the fitted box,
// slides out from under the pointer as the map rescales around it; and the
// stop keeps the grip it was pressed at, so a tap selects without nudging.

import SwiftUI
import AtelierKit

struct MapFieldView: View {
    let stops: [MapStop]
    /// The trip's located places that are not stops — landmarks to adopt.
    let places: [MapPlace]
    let selectedId: String?
    let curve: Double
    let onSelect: (String) -> Void
    /// A pin dropped where there was nothing.
    let onDrop: (GeoPoint) -> Void
    /// One of the trip's own places adopted as a stop.
    let onAdopt: (MapPlace) -> Void
    /// A stop dragged to a new position.
    let onMove: (String, GeoPoint) -> Void

    /// The field's own coordinate space; the view keeps its aspect.
    static let view = CGSize(width: 320, height: 200)
    static let pad = 18.0

    @Environment(\.palette) private var palette
    /// What the press landed on, while a finger is down.
    @State private var press: FieldPress?
    /// The projection frozen for a stop's drag.
    @State private var frozen: MapProjection?

    private enum FieldPress: Equatable {
        case ground
        /// A stop, and where its centre sat from the press — so a drag keeps
        /// the grip and a tap never nudges it.
        case stop(String, dx: Double, dy: Double)
        case adopted
    }

    /// Both sets are fitted, so adopting a landmark never makes the map jump.
    private var projection: MapProjection {
        if let frozen { return frozen }
        var fitted: [GeoPoint] = stops.map { GeoPoint(lat: $0.lat, lon: $0.lon) }
        fitted += places.map { GeoPoint(lat: $0.lat, lon: $0.lon) }
        let box = AtelierKit.Rect(0, 0, Double(Self.view.width), Double(Self.view.height))
        return fitMapProjection(fitted, box, Self.pad)
    }

    var body: some View {
        GeometryReader { geo in
            let scale = geo.size.width / Self.view.width
            Canvas { context, _ in
                draw(&context, scale: scale)
            }
            .contentShape(Rectangle())
            .gesture(drag(scale: scale))
        }
        .aspectRatio(Self.view.width / Self.view.height, contentMode: .fit)
        .background(palette.frame)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("The itinerary on a map: \(stops.count) \(stops.count == 1 ? "stop" : "stops"). \(OpenerWords.click) to add one; the places below add the same stops from the keyboard.")
        .accessibilityAddTraits(.isImage)
    }

    // MARK: - drawing

    private func draw(_ context: inout GraphicsContext, scale: CGFloat) {
        context.scaleBy(x: scale, y: scale)
        let project = projection
        graticule(&context)
        for place in places {
            let at = cg(project.project(place))
            let ring = Path(ellipseIn: CGRect(x: at.x - 2.6, y: at.y - 2.6, width: 5.2, height: 5.2))
            context.stroke(ring, with: .color(palette.faint), lineWidth: 1)
        }
        let points = stops.map { project.project($0) }
        var arcs = Path()
        for i in points.indices.dropFirst() {
            let control = arcControl(points[i - 1], points[i], curve)
            arcs.move(to: cg(points[i - 1]))
            arcs.addQuadCurve(to: cg(points[i]), control: cg(control))
        }
        let line = StrokeStyle(lineWidth: 1.6, lineCap: .round)
        context.stroke(arcs, with: .color(palette.onMedia.opacity(0.9)), style: line)
        for (index, stop) in stops.enumerated() {
            marker(&context, stop, index: index, at: cg(points[index]))
        }
    }

    /// A faint grid, so an empty field still reads as a projection of the world.
    private func graticule(_ context: inout GraphicsContext) {
        var grid = Path()
        var x: CGFloat = 40
        while x < Self.view.width {
            grid.move(to: CGPoint(x: x, y: 0))
            grid.addLine(to: CGPoint(x: x, y: Self.view.height))
            x += 40
        }
        var y: CGFloat = 40
        while y < Self.view.height {
            grid.move(to: CGPoint(x: 0, y: y))
            grid.addLine(to: CGPoint(x: Self.view.width, y: y))
            y += 40
        }
        context.stroke(grid, with: .color(palette.onMedia.opacity(0.12)), lineWidth: 0.5)
    }

    /// One stop: a ring when selected, the accent disc, its number, and a
    /// corner mark when it holds a picture — a mark, not a thumbnail: a tile
    /// would need a decode per stop in a panel redrawn on every slider step.
    private func marker(_ context: inout GraphicsContext, _ stop: MapStop, index: Int, at: CGPoint) {
        if stop.id == selectedId {
            let ring = Path(ellipseIn: CGRect(x: at.x - 9, y: at.y - 9, width: 18, height: 18))
            context.stroke(ring, with: .color(palette.accent), lineWidth: 1.4)
        }
        let disc = Path(ellipseIn: CGRect(x: at.x - 5.4, y: at.y - 5.4, width: 10.8, height: 10.8))
        context.fill(disc, with: .color(palette.accent))
        let number = Text(verbatim: "\(index + 1)")
            .font(Brand.mono(6.4, weight: .semibold))
            .foregroundStyle(palette.frame)
        context.draw(number, at: at, anchor: .center)
        if stop.picture != nil {
            let mark = Path(roundedRect: CGRect(x: at.x + 4, y: at.y - 10, width: 6, height: 6), cornerRadius: 1)
            context.fill(mark, with: .color(palette.onMedia))
            context.stroke(mark, with: .color(palette.frame), lineWidth: 0.8)
        }
    }

    private func cg(_ p: AtelierKit.Point) -> CGPoint {
        CGPoint(x: p.x, y: p.y)
    }

    // MARK: - gestures

    /// One gesture for the whole field: what the press landed on decides —
    /// a stop is selected and dragged, a landmark adopted, the ground takes a
    /// pin on the way up if the finger stayed put.
    private func drag(scale: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                let point = fieldPoint(value.location, scale)
                if press == nil { begin(at: fieldPoint(value.startLocation, scale)) }
                let moved = hypot(value.translation.width, value.translation.height) > 1
                if moved, case .stop(let id, let dx, let dy) = press, let frozen {
                    onMove(id, frozen.unproject(AtelierKit.Point(point.x + dx, point.y + dy)))
                }
            }
            .onEnded { value in
                defer {
                    press = nil
                    frozen = nil
                }
                guard press == .ground else { return }
                let travel = hypot(value.translation.width, value.translation.height)
                guard travel <= 4 else { return }
                onDrop(projection.unproject(fieldPoint(value.location, scale)))
            }
    }

    private func begin(at point: AtelierKit.Point) {
        let project = projection
        if let hit = nearestStop(point, project) {
            let at = project.project(hit)
            press = .stop(hit.id, dx: at.x - point.x, dy: at.y - point.y)
            frozen = project
            onSelect(hit.id)
        } else if let place = nearestPlace(point, project) {
            press = .adopted
            onAdopt(place)
        } else {
            press = .ground
        }
    }

    /// The topmost stop under a press — its disc and a little slop.
    private func nearestStop(_ point: AtelierKit.Point, _ project: MapProjection) -> MapStop? {
        for stop in stops.reversed() {
            let at = project.project(stop)
            if hypot(at.x - point.x, at.y - point.y) <= 9 { return stop }
        }
        return nil
    }

    /// A landmark under a press — its 6-unit target, as the web's.
    private func nearestPlace(_ point: AtelierKit.Point, _ project: MapProjection) -> MapPlace? {
        places.first { place in
            let at = project.project(place)
            return hypot(at.x - point.x, at.y - point.y) <= 6
        }
    }

    /// A point of the view, in the field's own space — one uniform scale,
    /// the view keeping the field's aspect.
    private func fieldPoint(_ p: CGPoint, _ scale: CGFloat) -> AtelierKit.Point {
        let s = max(0.0001, Double(scale))
        return AtelierKit.Point(Double(p.x) / s, Double(p.y) / s)
    }
}

private struct MapFieldPreview: View {
    @State private var stops: [MapStop] = [
        MapStop(id: "a", name: "Perth", lat: -31.95, lon: 115.86),
        MapStop(id: "b", name: "Kalbarri", lat: -27.71, lon: 114.16),
        MapStop(id: "c", name: "Exmouth", lat: -21.93, lon: 114.13),
    ]
    @State private var selected: String?

    var body: some View {
        MapFieldView(stops: stops, places: [MapPlace(name: "Karijini", lat: -22.6, lon: 118.3)], selectedId: selected,
                     curve: 0.18, onSelect: { selected = $0 },
                     onDrop: { at in stops = addStop(stops, at, UUID().uuidString) },
                     onAdopt: { place in stops = addStop(stops, GeoPoint(lat: place.lat, lon: place.lon), name: place.name, UUID().uuidString) },
                     onMove: { id, at in stops = patchStop(stops, id) { $0.lat = at.lat; $0.lon = at.lon } })
            .frame(width: 320)
            .padding(16)
    }
}

#Preview("Picking map") {
    MapFieldPreview()
        .darkroom()
}
