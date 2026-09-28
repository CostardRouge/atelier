// One frame of «Virée», read off the plan `prepare` fixed — the layout
// arithmetic of `src/shared/roadtrip/hooks/drive-paint.ts`. The strokes
// themselves (a fill, a polyline, a gradient, a rotated print, the car's
// faces) are the app's Core Graphics painter; every position, size, colour
// and alpha it draws is decided here, as a READING of `DrivePlan.at(t)` — the
// same reading the score is written from, so a tick lands on the frame its
// stop appears in. Sizes are in units of a 1080-wide frame.
//
// The variant OWNS the frame: on paper it covers the piece's picture with a
// map of its own — cream paper, a faint graticule, a vignette, the road
// dashed ahead and a solid trail behind the car, a dot and a name at every
// stop, a compass, a scale bar, the distance so far — and on the picture
// ground it draws only the road, the stops and the car over whatever is
// there. Pictures pop as prints beside the car, fanned like a pile on the
// map, sit behind the map, or fill the frame while the car halts.
//
// The reveal: when the car has arrived the map can fade away and leave the
// piece's own picture. The web paints the map whole into a buffer and lays it
// over at a falling alpha — one `drawImage`, not a hundred alphas; here the
// frame says that alpha (`DriveFrame.alpha`) and the app paints the frame in
// ONE transparency layer at it. Nothing is drawn once it reaches 0.
//
// The car is `Mesh3D`'s: its faces ordered, lit and coloured by the kernel
// (`Mesh3D.paintSteps`) and its soft shadow as ellipses
// (`Mesh3D.groundShadow`), so both clients paint the same toy. No shadow blur
// anywhere: shadows are stacked fills. Colours are `HookInk`, text is
// `HookText` (`MapPaint.swift`).

import Foundation

/// The car's length in 1080-units at size 1.
private let driveCarPx = 118.0
/// A card's long edge in 1080-units at size 1.
private let driveCardPx = 190.0
/// A print's paper.
private let drivePrintPaper = "#fbf8f1"
/// The ink of a print's stacked shadow, `rgba(20,16,12,…)`.
private let drivePrintShadow = "#14100c"

/// The box the route is fitted into, on a frame of `w`×`h`.
public func driveBox(_ w: Double, _ h: Double, _ position: DrivePosition, _ size: Double) -> Rect {
    let width = w * 0.8 * size
    let height = min(h * 0.52, w * 1.15) * size
    let x = (w - width) / 2
    let y: Double = position == .top ? h * 0.1 : (position == .bottom ? h * 0.92 - height : (h - height) / 2)
    return Rect(x: x, y: y, width: width, height: height)
}

/// Everything one frame of Virée draws, in painting order: the paper, the
/// pictures behind the map, the graticule, the vignette, the road ahead, the
/// trail, the dots, the ripple, the names, the prints, the car's shadow and
/// the car, the compass, the scale bar, the distance, and the pictures that
/// fill the frame over everything. Strokes have round caps and joins.
public struct DriveFrame: Equatable, Sendable {
    /// A picture cover-cropped into the whole frame at `alpha`.
    public struct Layer: Equatable, Sendable {
        public var key: String
        public var alpha: Double
    }

    /// Faint lines of longitude (`xs`, top to bottom of the frame) and of
    /// latitude (`ys`, across it), stroked in one path.
    public struct Graticule: Equatable, Sendable {
        public var xs: [Double]
        public var ys: [Double]
        public var ink: HookInk
        public var width: Double
    }

    /// A radial gradient over the whole frame, from `inner` to `outer` about `center`.
    public struct Vignette: Equatable, Sendable {
        public var center: Point
        public var innerRadius: Double
        public var outerRadius: Double
        public var inner: HookInk
        public var outer: HookInk
    }

    public struct Polyline: Equatable, Sendable {
        public var points: [Point]
        public var ink: HookInk
        public var width: Double
        /// On and off lengths; empty is a solid line.
        public var dash: [Double]
    }

    public struct Disc: Equatable, Sendable {
        public var center: Point
        public var radius: Double
        public var ink: HookInk
    }

    /// A stop's dot: its halo, its fill, and its outline stroked over the fill.
    public struct Dot: Equatable, Sendable {
        public var index: Int
        public var halo: Disc
        public var fill: Disc
        public var stroke: HookInk
        public var strokeWidth: Double
    }

    /// A stroked circle.
    public struct Ring: Equatable, Sendable {
        public var center: Point
        public var radius: Double
        public var ink: HookInk
        public var width: Double
    }

    /// A print lying on the map. The app translates to `center`, turns by
    /// `angle` (radians, clockwise on screen), scales by `scale`, then draws
    /// the shadows, the paper and the picture in the print's own coordinates.
    public struct Card: Equatable, Sendable {
        public struct Shadow: Equatable, Sendable {
            public var rect: Rect
            public var ink: HookInk
        }

        public var key: String
        public var center: Point
        public var angle: Double
        public var scale: Double
        /// The whole print's alpha — already folded into every ink below.
        public var alpha: Double
        public var radius: Double
        /// Stacked, no blur — outermost first.
        public var shadows: [Shadow]
        public var paper: Rect
        public var paperInk: HookInk
        /// Where the picture is drawn, whole (not cropped), at `alpha`.
        public var picture: Rect
    }

    /// The car, as the kernel lays it down.
    public struct Car: Equatable, Sendable {
        public var pose: Mesh3D.Pose
        public var shadow: Mesh3D.GroundShadow
        public var faces: [Mesh3D.PaintStep]
    }

    /// A compass rose: a four-point star and its N.
    public struct Compass: Equatable, Sendable {
        /// The star's outline, eight points.
        public var star: [Point]
        /// The star is stroked in the halo at `haloWidth`, filled in the halo,
        /// then outlined in the ink at `inkWidth`.
        public var halo: HookInk
        public var haloWidth: Double
        public var ink: HookInk
        public var inkWidth: Double
        /// The north point, filled in the ink.
        public var north: [Point]
        public var letter: HookText
    }

    /// A scale bar: a halo line under an inked bracket, and its label.
    public struct ScaleBarMark: Equatable, Sendable {
        public var bar: DriveScaleBar
        public var halo: Polyline
        public var bracket: Polyline
        public var label: HookText
    }

    /// The map's alpha — 1, or the reveal's falling alpha: the app paints this
    /// frame in one transparency layer at it.
    public var alpha: Double
    /// The box the route is fitted into.
    public var box: Rect
    /// The camera: plan units to frame pixels.
    public var view: DriveView
    /// The paper over the whole frame, on the paper ground.
    public var paper: HookInk?
    public var backdrop: [Layer]
    public var graticule: Graticule?
    public var vignette: Vignette?
    public var road: Polyline?
    /// The trail behind the car: its halo, then its colour.
    public var trail: [Polyline]
    public var dots: [Dot]
    public var ripple: Ring?
    public var labels: [HookText]
    public var cards: [Card]
    public var car: Car
    public var compass: Compass?
    public var scaleBar: ScaleBarMark?
    public var distance: HookText?
    /// Pictures filling the frame while the car halts, over everything of the map.
    public var fill: [Layer]
}

/// Ease-out with a little overshoot — the pop of a print landing on the map.
private func driveOvershoot(_ x: Double) -> Double {
    let c1 = 1.70158
    let c3 = c1 + 1
    let d = x - 1
    return 1 + c3 * d * d * d + c1 * d * d
}

/// The sample before `s` on the path — what the trail is drawn up to.
private func driveSampleBefore(_ path: RoadPath, _ s: Double) -> Int {
    let cum = path.cum
    var lo = 0
    var hi = cum.count - 1
    if hi <= 0 { return 0 }
    while hi - lo > 1 {
        let mid = (lo + hi) >> 1
        if cum[mid] <= s { lo = mid } else { hi = mid }
    }
    return lo
}

/// One frame of the drive at `t` on a frame of `frame`'s size, or nil for a
/// frame with no area or once the reveal has faded the map away (the web draws
/// nothing). `measure` is the app's width of a name set in the label face at
/// weight 600 and the given size; without it a name's width is estimated.
func driveFrame(_ plan: DrivePlan, _ pictures: [String: HookPicture]?, _ scratch: DriveScratch, _ t: Double,
                _ frame: FrameBox, measure: ((_ text: String, _ fontPx: Double) -> Double)? = nil) -> DriveFrame? {
    let o = plan.options
    let w = frame.width
    let h = frame.height
    if w <= 0 || h <= 0 { return nil }
    let moment = plan.at(t)
    if moment.mapAlpha <= 0 { return nil }

    let u = w / 1080
    let carPx = driveCarPx * u * o.carSize
    let box = driveBox(w, h, o.position, o.size)
    let view = viewAt(plan, box, carPx * 0.7, (camera: o.camera, followZoom: o.followZoom), moment)
    let onPaper = o.ground == .paper
    let ink = onPaper ? o.inkColor : "#ffffff"
    let halo = onPaper ? HookInk(o.paperColor, 1) : HookInk("#000000", 0.55)
    let lw = o.lineWidth

    let showing = o.pictures == .none ? [] : plan.showing(t)
    // A picture behind (or over) the map: it takes the paper's place while
    // the car halts, and fades as the car leaves.
    func fullFrame() -> [DriveFrame.Layer] {
        showing.compactMap { item in
            guard pictures?[item.pop.key] != nil else { return nil }
            let leaving = t < item.pop.leaves ? 1 : max(0, 1 - (t - item.pop.leaves) / driveCardFadeSeconds)
            let alpha = min(1, item.rise) * leaving
            return alpha > 0 ? DriveFrame.Layer(key: item.pop.key, alpha: alpha) : nil
        }
    }

    var paper: HookInk? = nil
    var graticule: DriveFrame.Graticule? = nil
    var vignette: DriveFrame.Vignette? = nil
    let backdrop = o.pictures == .backdrop ? fullFrame() : []
    if onPaper {
        paper = HookInk(o.paperColor, 1)
        if o.graticule { graticule = driveGraticule(plan, view, o, u, frame) }
        if o.vignette {
            let r = hypot(w, h) / 2
            vignette = DriveFrame.Vignette(center: Point(w / 2, h / 2), innerRadius: r * 0.45, outerRadius: r * 1.02,
                                           inner: HookInk(o.inkColor, 0), outer: HookInk(o.inkColor, 0.26))
        }
    }

    // The road: the whole path faint and dashed ahead, the trail solid behind.
    let pts = plan.path.points.map { applyView(view, $0) }
    var road: DriveFrame.Polyline? = nil
    var trail: [DriveFrame.Polyline] = []
    if pts.count > 1 {
        if o.ahead != .hidden {
            let aheadInk = onPaper ? HookInk(o.aheadColor, o.ahead == .faint ? 0.35 : 0.6) : HookInk("#ffffff", 0.55)
            road = DriveFrame.Polyline(points: pts, ink: aheadInk, width: 3 * u * lw,
                                       dash: o.ahead == .dashed ? [7 * u * lw, 9 * u * lw] : [])
        }
        if o.trail && moment.s > 0 {
            let index = driveSampleBefore(plan.path, moment.s)
            let line = Array(pts[0...index]) + [applyView(view, moment.point)]
            trail = [
                DriveFrame.Polyline(points: line, ink: halo, width: 9 * u * lw, dash: []),
                DriveFrame.Polyline(points: line, ink: HookInk(o.trailColor, 1), width: 5.5 * u * lw, dash: []),
            ]
        }
    }

    // The stops: a dot each, filled once the car has passed, a ripple where it halts.
    let stops = plan.points.map { applyView(view, $0) }
    let dotR = 7 * u
    var dots: [DriveFrame.Dot] = []
    if o.dots {
        for (i, p) in stops.enumerated() {
            let reached = i <= moment.reached
            let fill = reached ? HookInk(o.trailColor, 1) : (onPaper ? HookInk(o.paperColor, 1) : HookInk("#ffffff", 0.9))
            dots.append(DriveFrame.Dot(index: i, halo: DriveFrame.Disc(center: p, radius: dotR + 2.5 * u, ink: halo),
                                       fill: DriveFrame.Disc(center: p, radius: dotR, ink: fill),
                                       stroke: reached ? HookInk(o.trailColor, 1) : HookInk(ink, 1),
                                       strokeWidth: 2.2 * u))
        }
    }
    var ripple: DriveFrame.Ring? = nil
    if let at = moment.at, !moment.over, moment.phase == .halt || moment.phase == .arrive, at < stops.count {
        let k = min(1, moment.since / 0.7)
        if k < 1 {
            ripple = DriveFrame.Ring(center: stops[at], radius: dotR + 34 * u * k,
                                     ink: HookInk(o.trailColor, 0.6 * (1 - k)), width: 3 * u)
        }
    }

    // The cards, so the names can keep clear of them.
    var cardBoxes: [LabelBox] = []
    var cards: [DriveFrame.Card] = []
    if o.pictures == .cards {
        for item in showing {
            guard let picture = pictures?[item.pop.key], picture.width > 0, picture.height > 0 else { continue }
            let long = driveCardPx * u * o.cardSize
            let landscape = picture.width >= picture.height
            let cw = landscape ? long : (long * picture.width) / picture.height
            let ch = landscape ? (long * picture.height) / picture.width : long
            let border = long * 0.05
            let outer = Size(width: cw + 2 * border, height: ch + 2 * border)
            let place = cardPlacement(stops[item.pop.stop], item.pop.rank, item.pop.key, outer, frame, carPx * 0.55,
                                      item.pop.stop)
            let half = hypot(outer.width, outer.height) / 2
            cardBoxes.append(LabelBox(x0: place.x - half, y0: place.y - half, x1: place.x + half, y1: place.y + half))
            if let card = driveCard(item, place, cw, ch, border, u) { cards.append(card) }
        }
    }

    // The names, each the stop's own, never on top of another or of a card.
    var labels: [HookText] = []
    if o.labels != .none && plan.route.named {
        let fontPx = 24 * u * o.labelSize
        let count = plan.route.stops.count
        let candidates = plan.route.stops.enumerated().map { i, stop in
            LabelCandidate(x: stops[i].x, y: stops[i].y, name: stop.name, wanted: wantsStopLabel(o.labels, i, count))
        }
        let widthOf: ((String) -> Double)? = measure.map { m in { m($0, fontPx) } }
        for label in placeLabels(candidates, fontPx, frame, dotR, measure: widthOf, reserved: cardBoxes) {
            let reached = label.index <= moment.reached
            labels.append(HookText(text: plan.route.stops[label.index].name, at: Point(label.x, label.y),
                                   align: label.align, fontPx: fontPx, weight: 600, face: .label,
                                   ink: HookInk(ink, reached ? 1 : 0.62), halo: halo, haloWidth: 5 * u))
        }
    }

    // The car, its shadow first.
    let car = driveCar(plan, scratch, view, moment, carPx, o, onPaper)

    // The furniture: a compass, a scale bar, the distance so far.
    let pad = 30 * u
    let compass = o.compass ? driveCompass(w - pad - 22 * u, pad + 30 * u, u, HookInk(ink, 1), halo) : nil
    var scale: DriveFrame.ScaleBarMark? = nil
    if o.scaleBar {
        let bar = scaleBar(plan.geo.scale * view.scale, box.width * 0.26, o.distance == .mi ? .mi : .km)
        let x = box.x
        let y = box.y + box.height + 40 * u
        if bar.px > 8 * u {
            scale = DriveFrame.ScaleBarMark(
                bar: bar,
                halo: DriveFrame.Polyline(points: [Point(x, y), Point(x + bar.px, y)], ink: halo, width: 6 * u, dash: []),
                bracket: DriveFrame.Polyline(points: [Point(x, y - 6 * u), Point(x, y), Point(x + bar.px, y),
                                                      Point(x + bar.px, y - 6 * u)],
                                             ink: HookInk(ink, 1), width: 2.5 * u, dash: []),
                label: HookText(text: bar.label, at: Point(x, y + 8 * u), align: .left, baseline: .top, fontPx: 22 * u,
                                weight: 500, face: .mono, ink: HookInk(ink, 1), halo: halo, haloWidth: 4 * u)
            )
        }
    }
    var distance: HookText? = nil
    if o.distance != .off {
        distance = HookText(text: formatDistance(plan.kmAt(moment.s), o.distance),
                            at: Point(box.x + box.width, box.y + box.height + 44 * u), align: .right, fontPx: 26 * u,
                            weight: 500, face: .mono, ink: HookInk(ink, 1), halo: halo, haloWidth: 5 * u)
    }

    return DriveFrame(alpha: min(1, moment.mapAlpha), box: box, view: view, paper: paper, backdrop: backdrop,
                      graticule: graticule, vignette: vignette, road: road, trail: trail, dots: dots, ripple: ripple,
                      labels: labels, cards: cards, car: car, compass: compass, scaleBar: scale, distance: distance,
                      fill: o.pictures == .fill ? fullFrame() : [])
}

extension DriveDrawing {
    /// This drawing's frame at `t` — what the app's painter strokes. Nil once
    /// the reveal has faded the map away.
    public func frame(at t: Double, _ frame: FrameBox,
                      measure: ((_ text: String, _ fontPx: Double) -> Double)? = nil) -> DriveFrame? {
        driveFrame(plan, pictures, scratch, t, frame, measure: measure)
    }
}

/// Faint lines of latitude and longitude at a round step, across the frame:
/// screen → plan → geo at the frame's corners, then back at each round degree.
private func driveGraticule(_ plan: DrivePlan, _ view: DriveView, _ o: DriveOptions, _ u: Double,
                            _ frame: FrameBox) -> DriveFrame.Graticule? {
    let geo = plan.geo
    if !(geo.scale > 0) || !(geo.k > 0) { return nil }
    let pxPerDegree = geo.scale * view.scale
    let step = graticuleStep(pxPerDegree, 96 * u)
    let half = drivePlanSize / 2
    func lonOf(_ px: Double) -> Double { ((px - half) / geo.scale + geo.midX) / geo.k }
    func latOf(_ py: Double) -> Double { -((py - half) / geo.scale + geo.midY) }
    let ax = (0 - view.tx) / view.scale
    let ay = (0 - view.ty) / view.scale
    let bx = (frame.width - view.tx) / view.scale
    let by = (frame.height - view.ty) / view.scale
    let lon0 = min(lonOf(ax), lonOf(bx))
    let lon1 = max(lonOf(ax), lonOf(bx))
    let lat0 = min(latOf(ay), latOf(by))
    let lat1 = max(latOf(ay), latOf(by))
    if !lon0.isFinite || !lat0.isFinite || (lon1 - lon0) / step > 200 || (lat1 - lat0) / step > 200 { return nil }
    var xs: [Double] = []
    var lon = (lon0 / step).rounded(.up) * step
    while lon <= lon1 {
        let px = (lon * geo.k - geo.midX) * geo.scale + half
        xs.append(px * view.scale + view.tx)
        lon += step
    }
    var ys: [Double] = []
    var lat = (lat0 / step).rounded(.up) * step
    while lat <= lat1 {
        let py = (-lat - geo.midY) * geo.scale + half
        ys.append(py * view.scale + view.ty)
        lat += step
    }
    return DriveFrame.Graticule(xs: xs, ys: ys, ink: HookInk(o.inkColor, 0.13), width: 1.2 * u)
}

/// A print as it pops: a little overshoot on its scale, and its alpha from
/// its rise and its fade — nothing when that alpha is 0.
private func driveCard(_ item: DrivePlan.Showing, _ place: DriveCardPlacement, _ cw: Double, _ ch: Double,
                       _ border: Double, _ u: Double) -> DriveFrame.Card? {
    let scale = 0.72 + 0.28 * driveOvershoot(max(0, min(1, item.rise)))
    let alpha = item.fade * min(1, item.rise * 4)
    if alpha <= 0 { return nil }
    let W = cw + 2 * border
    let H = ch + 2 * border
    let stack: [(grow: Double, dy: Double, a: Double)] = [(1.06, 7 * u, 0.1), (1.03, 4 * u, 0.14), (1.0, 2 * u, 0.18)]
    let shadows = stack.map { s in
        DriveFrame.Card.Shadow(rect: Rect(x: (-W * s.grow) / 2, y: -H / 2 + s.dy, width: W * s.grow, height: H * s.grow),
                               ink: HookInk(drivePrintShadow, s.a * alpha))
    }
    return DriveFrame.Card(key: item.pop.key, center: Point(place.x, place.y), angle: place.angle, scale: scale,
                           alpha: alpha, radius: 3 * u, shadows: shadows,
                           paper: Rect(x: -W / 2, y: -H / 2, width: W, height: H),
                           paperInk: HookInk(drivePrintPaper, alpha),
                           picture: Rect(x: -cw / 2, y: -ch / 2, width: cw, height: ch))
}

/// The car at the moment's point, nose along the road, wheels turned by the
/// distance travelled on screen, over its ground shadow.
private func driveCar(_ plan: DrivePlan, _ scratch: DriveScratch, _ view: DriveView, _ moment: DriveMoment,
                      _ carPx: Double, _ o: DriveOptions, _ onPaper: Bool) -> DriveFrame.Car {
    let parts = scratch.parts
    let model = scratch.model
    let p = applyView(view, moment.point)
    let heading = moment.heading
    let length = hypot(heading.x, heading.y)
    let len = length == 0 || length.isNaN ? 1 : length
    let scale = carPx / model.length
    let travelled = moment.s * view.scale
    let spin = travelled / (model.wheelRadius * scale)
    var spins: [String: Double] = [:]
    for part in parts where part.spin != nil { spins[part.id] = -spin }
    let pose = Mesh3D.Pose(fx: heading.x / len, fy: -heading.y / len, tilt: o.tilt * Double.pi / 180, scale: scale,
                           x: p.x, y: p.y, spins: spins)
    let shadow = Mesh3D.groundShadow(pose, halfLength: model.length / 2, halfWidth: model.width / 2,
                                     alpha: onPaper ? 0.28 : 0.4)
    let faces = Mesh3D.paintSteps(Mesh3D.renderOrder(parts, pose, carLight(scratch.spec.finish)),
                                  palette: carPalette(scratch.spec.color),
                                  ink: onPaper ? hexToRgba(o.inkColor, 0.85) : "rgba(10,8,6,0.85)",
                                  outlineWidth: max(0.9, carPx / 78))
    return DriveFrame.Car(pose: pose, shadow: shadow, faces: faces)
}

/// A compass rose: a four-point star and its N. North is up because the projection is.
private func driveCompass(_ cx: Double, _ cy: Double, _ u: Double, _ ink: HookInk, _ halo: HookInk) -> DriveFrame.Compass {
    let R = 22 * u
    let r = 7 * u
    let star: [Point] = (0..<8).map { i in
        let a = (Double(i) / 8) * Double.pi * 2 - Double.pi / 2
        let rad = i % 2 == 0 ? R : r
        return Point(cx + rad * cos(a), cy + rad * sin(a))
    }
    let north = [
        Point(cx, cy - R),
        Point(cx + r * cos(-Double.pi / 4), cy + r * sin(-Double.pi / 4)),
        Point(cx, cy),
        Point(cx + r * cos(-3 * Double.pi / 4), cy + r * sin(-3 * Double.pi / 4)),
    ]
    let letter = HookText(text: "N", at: Point(cx, cy - R - 12 * u), align: .center, fontPx: 16 * u, weight: 600,
                          face: .mono, ink: ink, halo: halo, haloWidth: 4 * u)
    return DriveFrame.Compass(star: star, halo: halo, haloWidth: 6 * u, ink: ink, inkWidth: 2 * u, north: north,
                              letter: letter)
}
