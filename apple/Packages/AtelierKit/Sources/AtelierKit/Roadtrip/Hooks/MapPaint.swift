// One frame of the Itinerary, read off the options and the clock `prepare`
// fixed — the layout arithmetic of `src/shared/roadtrip/hooks/map-paint.ts`.
// The strokes themselves (a quadratic, a disc, a tile mounted on paper, a
// line of text with its halo) are the app's Core Graphics painter; every
// position, size, colour and alpha it draws is decided here, from the SAME
// projection, so nothing can sit where the line is not, and the stage and a
// 1080×1920 export draw the same map at two scales (sizes are in units of a
// 1080-wide frame).
//
// The four ways a picture is presented:
// - pin — a small tile beside the stop's own dot, appearing as the pen lands,
//   laid out BEFORE the stops are drawn (its stem runs under the dot, its tile
//   over the map) and DROPPED where it would leave the frame, cover another
//   pin or hide another stop's dot;
// - card — one larger tile under the map (over it when the map sits low),
//   cross-fading, captioned with the stop's name;
// - backdrop — the picture fills the frame behind the map, dimmed so the line
//   survives over it, the veil laid only where a picture was;
// - strip — every stop's picture as a contact row along the edge, the ones
//   still ahead held back behind a veil, the last reached ringed.
// A stop with no picture, or one the shell could not decode, draws NOTHING —
// never a placeholder, never the previous stop's picture standing in.
//
// The path is two layers: what is still to come (the rest of the hop the pen
// is on included — the line's bed), then what the pen has drawn over it; a
// dark underlay runs under every stroke and glyph when asked, which keeps a
// white line legible over a pale sky without a per-frame shadow blur.
//
// A colour is handed over as `HookInk` — `#rrggbb` and ONE alpha, the web's
// `rgba()` alpha already multiplied by the canvas's `globalAlpha` at that
// stroke — and a line of text as `HookText`; both are shared with Virée's
// frame (`DrivePaint.swift`).

import Foundation

/// A colour as the app's painter takes it: `#rrggbb`, and the alpha to fill or
/// stroke it at — the colour's own alpha times the canvas's global alpha.
public struct HookInk: Equatable, Sendable {
    public var color: String
    public var alpha: Double

    public init(_ color: String, _ alpha: Double) {
        self.color = color; self.alpha = alpha
    }
}

/// A line of text as an opener draws it: filled in `ink`, over an optional
/// stroked `halo` of `haloWidth` (the legibility underlay).
public struct HookText: Equatable, Sendable {
    /// The suite's faces, each with the web's fallback stack: `label` is Space
    /// Grotesk, `mono` is JetBrains Mono.
    public enum Face: String, Sendable {
        case label, mono
    }

    public enum Baseline: String, Sendable {
        case middle, top
    }

    public var text: String
    public var at: Point
    public var align: LabelAlign
    public var baseline: Baseline
    public var fontPx: Double
    /// The CSS weight: 500 or 600.
    public var weight: Int
    public var face: Face
    public var ink: HookInk
    public var halo: HookInk?
    public var haloWidth: Double

    public init(text: String, at: Point, align: LabelAlign, baseline: Baseline = .middle, fontPx: Double,
                weight: Int, face: Face, ink: HookInk, halo: HookInk? = nil, haloWidth: Double = 0) {
        self.text = text; self.at = at; self.align = align; self.baseline = baseline; self.fontPx = fontPx
        self.weight = weight; self.face = face; self.ink = ink; self.halo = halo; self.haloWidth = haloWidth
    }
}

/// Everything one frame of the Itinerary draws, in painting order: the
/// backdrop, the plate, the graticule, the path, the context places, the pins'
/// stems, the dots, the pins, the names, the pen, the card, the strip, the
/// compass and the distance. Strokes are drawn with round caps and joins.
public struct MapFrame: Equatable, Sendable {
    /// A picture cover-cropped into the whole frame at `alpha`.
    public struct Layer: Equatable, Sendable {
        public var key: String
        public var alpha: Double
    }

    /// The backdrop: its pictures, then black over the whole frame at `veil` (0 for none).
    public struct Backdrop: Equatable, Sendable {
        public var layers: [Layer]
        public var veil: Double
    }

    /// A filled rounded rectangle.
    public struct Panel: Equatable, Sendable {
        public var rect: Rect
        public var radius: Double
        public var ink: HookInk
    }

    public struct Segment: Equatable, Sendable {
        public var from: Point
        public var to: Point
    }

    /// Faint lines of latitude and longitude, clipped to the map's box.
    public struct Graticule: Equatable, Sendable {
        public var clip: Rect
        public var lines: [Segment]
        public var ink: HookInk
        public var width: Double
    }

    /// One quadratic from `start` to `end` through `control`, stroked.
    public struct Arc: Equatable, Sendable {
        public var start: Point
        public var control: Point
        public var end: Point
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

    /// A straight stroke.
    public struct Line: Equatable, Sendable {
        public var from: Point
        public var to: Point
        public var ink: HookInk
        public var width: Double
    }

    /// A stop's dot: its dark underlay, the disc, and its number when asked.
    public struct Dot: Equatable, Sendable {
        public var index: Int
        public var underlay: Disc?
        public var disc: Disc
        public var numeral: HookText?
    }

    /// A picture mounted in a box — the web's `tile` (`cell-paint.ts`, the app's
    /// painter): cover-cropped, on a paper mount with a soft shadow or bare with
    /// rounded corners, the caption in the paper below the picture.
    public struct Tile: Equatable, Sendable {
        public var key: String
        public var rect: Rect
        public var alpha: Double
        public var frame: MapMediaFrame
        /// The stop's name under a card; empty elsewhere.
        public var caption: String
    }

    /// A stroked rounded rectangle.
    public struct Ring: Equatable, Sendable {
        public var rect: Rect
        public var radius: Double
        public var ink: HookInk
        public var width: Double
    }

    /// One tile of the strip, its veil while the pen has not reached it, and
    /// the ring round the last stop reached.
    public struct StripTile: Equatable, Sendable {
        public var tile: Tile
        public var veil: Panel?
        public var ring: Ring?
    }

    /// The pen's tip on the hop it travels.
    public enum Pen: Equatable, Sendable {
        case dot(Disc)
        /// A little aeroplane, nose along the direction of travel: a filled polygon.
        case plane(points: [Point], ink: HookInk)
    }

    /// A north arrow with its letter.
    public struct Compass: Equatable, Sendable {
        /// The shaft, its underlay first when asked.
        public var shaft: [Line]
        /// The arrow's head, a filled triangle.
        public var head: [Point]
        public var headInk: HookInk
        public var letter: HookText
    }

    /// The map's box — what the stage grabs and a drag moves.
    public var box: Rect
    public var backdrop: Backdrop?
    public var plate: Panel?
    public var graticule: Graticule?
    /// The path, in painting order: the line ahead (its underlay, then it),
    /// then the line drawn (its underlay, then it).
    public var arcs: [Arc]
    /// The trip's other places, faint behind the itinerary.
    public var context: [Disc]
    public var stems: [Line]
    public var dots: [Dot]
    public var pins: [Tile]
    public var labels: [HookText]
    public var pen: Pen?
    /// The card under the map: the previous picture fading out, then the current one.
    public var card: [Tile]
    public var strip: [StripTile]
    public var compass: Compass?
    public var distance: HookText?
}

/// The dark underlay under strokes and glyphs.
private let mapUnderlay = "#000000"
private let mapAheadDash: [Double] = [9, 8]
/// The ink of a numbered dot.
private let mapPaperInk = "#1c1a17"
/// A pin's tile at size 1, in 1080-units.
private let mapPinSide = 150.0

/// One frame of the itinerary at `t` on a frame of `frame`'s size, or nil for
/// a frame with no area or an itinerary with no stop (the web draws nothing).
/// `measure` is the app's width of a name set in the label face at weight 600
/// and the given size; without it a name's width is estimated (`placeLabels`).
public func mapFrame(_ o: MapOptions, _ timing: MapTiming, _ context: [MapPlace], _ pictures: [String: HookPicture]?,
                     _ t: Double, _ frame: FrameBox,
                     measure: ((_ text: String, _ fontPx: Double) -> Double)? = nil) -> MapFrame? {
    let w = frame.width
    let h = frame.height
    if w <= 0 || h <= 0 || o.stops.isEmpty { return nil }

    let u = w / 1080
    let box = mapBox(w, h, o)
    // Every stop is fitted from the first frame — the pen reaches all of them,
    // so hiding the hops ahead must not let the map re-scale under the drawing.
    let projection = fitMapProjection(o.stops, box, 8 * u)
    let points = o.stops.map { projection.project($0) }
    let pen = penAt(timing, o.easing, t)
    let fractions = drawnFractions(timing, o.easing, t, max(0, o.stops.count - 1))
    let media = mediaAt(timing, t, o.mediaFade)
    /// The key of a stop's picture when the shell has it — a stop without one draws nothing.
    func pictureKey(_ index: Int) -> String? {
        guard index >= 0, index < o.stops.count, let key = stopPictureKey(o.stops[index]) else { return nil }
        return pictures?[key] != nil ? key : nil
    }

    var out = MapFrame(box: box, backdrop: nil, plate: nil, graticule: nil, arcs: [], context: [], stems: [],
                       dots: [], pins: [], labels: [], pen: nil, card: [], strip: [], compass: nil, distance: nil)

    if o.media == .backdrop { out.backdrop = mapBackdrop(o, media, pictureKey) }
    if o.plate { out.plate = mapPlate(o, box, u, w) }
    if o.graticule { out.graticule = mapGraticule(o, box, projection, u) }

    // --- the path ---
    let arcs: [(from: Point, to: Point, control: Point)] = points.indices.dropFirst().map { i in
        (points[i - 1], points[i], arcControl(points[i - 1], points[i], o.curve))
    }
    func strokeLayer(ahead: Bool, under: Bool) {
        for (i, arc) in arcs.enumerated() {
            let f = max(0, min(1, i < fractions.count ? fractions[i] : 0))
            if ahead ? f >= 1 : f <= 0 { continue }
            let global = ahead ? (o.aheadStyle == .faint ? 0.3 : 0.5) : 1
            let dash = ahead && o.aheadStyle == .dashed ? mapAheadDash.map { $0 * u } : []
            let start: Point
            let control: Point
            let end: Point
            if ahead {
                let tail = quadTail(arc.from, arc.control, arc.to, f)
                (start, control, end) = (tail.start, tail.control, tail.end)
            } else {
                let part = quadSplit(arc.from, arc.control, arc.to, f)
                (start, control, end) = (arc.from, part.control, part.end)
            }
            let ink: HookInk
            let width: Double
            if under {
                ink = HookInk(mapUnderlay, 0.3 * global)
                width = (6 * o.lineWidth + 4) * u
            } else {
                ink = ahead ? HookInk(o.aheadColor, 0.85 * global) : HookInk(o.pathColor, global)
                width = (ahead ? 3.5 : 6) * o.lineWidth * u
            }
            out.arcs.append(MapFrame.Arc(start: start, control: control, end: end, ink: ink, width: width, dash: dash))
        }
    }
    if o.aheadStyle != .hidden {
        if o.underlay { strokeLayer(ahead: true, under: true) }
        strokeLayer(ahead: true, under: false)
    }
    if o.underlay { strokeLayer(ahead: false, under: true) }
    strokeLayer(ahead: false, under: false)

    // --- the trip's other places, faint behind the itinerary ---
    if o.context {
        for place in context {
            let at = projection.project(place)
            if at.x < 0 || at.y < 0 || at.x > w || at.y > h { continue }
            out.context.append(MapFrame.Disc(center: at, radius: 3.5 * u * o.dotSize, ink: HookInk(o.aheadColor, 0.5 * 0.45)))
        }
    }

    // --- the stops ---
    // A stop is "there" once the pen has reached it; the ones still ahead show
    // only when the itinerary ahead is shown at all.
    let reached = points.indices.map { $0 <= pen.stop }
    // A numbered dot is a disc with a numeral in it, so it has to be big enough to read one.
    let dotR = 7 * u * o.dotSize * (o.numbers ? 2.1 : 1)

    // Where each pinned picture goes, decided BEFORE anything else about the
    // stops: its stem runs under the dot and its tile over the map. The boxes
    // are also what the names are placed around.
    var pinned: [LabelBox] = []
    let pins = o.media == .pin
        ? mapLayoutPins(o, timing, points, reached, pictureKey, media, t, u, frame, dotR, &pinned)
        : []
    if o.pinStem {
        for pin in pins {
            let to = Point(pin.spot.x + pin.size / 2, pin.spot.y + pin.size / 2)
            out.stems.append(MapFrame.Line(from: pin.at, to: to, ink: HookInk(o.pathColor, pin.alpha),
                                           width: 2 * u * o.lineWidth))
        }
    }

    if o.dots {
        for (index, at) in points.enumerated() {
            let ahead = !reached[index]
            if ahead && o.aheadStyle == .hidden { continue }
            let global = ahead ? 0.55 : 1
            let underlay = o.underlay
                ? MapFrame.Disc(center: at, radius: dotR + 3 * u, ink: HookInk(mapUnderlay, 0.35 * global))
                : nil
            let fill = ahead ? HookInk(o.aheadColor, 0.8 * global) : HookInk(o.pathColor, global)
            // The numeral is the map's ink on the dot's own fill — a second
            // colour here would make the dots read as two kinds of thing.
            let numeral = o.numbers
                ? HookText(text: "\(index + 1)", at: Point(at.x, at.y + dotR * 0.06), align: .center,
                           fontPx: dotR * 1.15, weight: 600, face: .mono, ink: HookInk(mapPaperInk, global))
                : nil
            out.dots.append(MapFrame.Dot(index: index, underlay: underlay,
                                         disc: MapFrame.Disc(center: at, radius: dotR, ink: fill), numeral: numeral))
        }
    }

    // --- the pinned pictures, over the map and over their own stems ---
    out.pins = pins.map {
        MapFrame.Tile(key: $0.key, rect: Rect(x: $0.spot.x, y: $0.spot.y, width: $0.size, height: $0.size),
                      alpha: $0.alpha, frame: o.mediaFrame, caption: "")
    }

    // --- the names ---
    if o.labels != .none {
        let fontPx = 26 * u * o.labelSize
        let candidates = points.enumerated().map { index, at in
            LabelCandidate(x: at.x, y: at.y, name: o.stops[index].name,
                           wanted: (reached[index] || o.aheadStyle != .hidden)
                               && wantsLabel(o.labels, index, points.count, pen.stop))
        }
        let widthOf: ((String) -> Double)? = measure.map { m in { m($0, fontPx) } }
        let placed = placeLabels(candidates, fontPx, frame, o.dots ? dotR : 2 * u, measure: widthOf, reserved: pinned)
        for label in placed {
            let global = reached[label.index] ? 1.0 : 0.7
            out.labels.append(HookText(
                text: o.stops[label.index].name.trimmingCharacters(in: .whitespacesAndNewlines),
                at: Point(label.x, label.y), align: label.align, fontPx: fontPx, weight: 600, face: .label,
                ink: HookInk(o.pathColor, global),
                halo: o.underlay ? HookInk(mapUnderlay, 0.5 * global) : nil, haloWidth: o.underlay ? 4 * u : 0
            ))
        }
    }

    // --- the pen's tip ---
    if o.draw && o.pen != .none, let hop = pen.hop, hop < arcs.count {
        let arc = arcs[hop]
        let tip = quadAt(arc.from, arc.control, arc.to, pen.fraction)
        let just = quadAt(arc.from, arc.control, arc.to, max(0, pen.fraction - 0.01))
        let ink = HookInk(o.pathColor, 1)
        if o.pen == .plane {
            out.pen = .plane(points: mapPlane(tip, atan2(tip.y - just.y, tip.x - just.x), 11 * u * o.dotSize), ink: ink)
        } else {
            out.pen = .dot(MapFrame.Disc(center: tip, radius: 8 * u * o.dotSize, ink: ink))
        }
    }

    // --- the picture under the map, or along the edge ---
    if o.media == .card { out.card = mapCard(o, media, pictureKey, box, u, frame) }
    if o.media == .strip { out.strip = mapStrip(o, timing, points.count, pictureKey, t, u, frame) }

    if o.compass { out.compass = mapCompass(o, box.x + box.width - 14 * u, box.y - 50 * u, u) }

    if o.distance != .off {
        let km = drawnKm(hopKms(o.stops), fractions)
        let right = o.align == .right
        out.distance = HookText(
            text: formatDistance(km, o.distance),
            at: Point(right ? box.x + box.width : box.x, box.y + box.height + 40 * u),
            align: right ? .right : .left, fontPx: 28 * u, weight: 500, face: .mono, ink: HookInk(o.pathColor, 1),
            halo: o.underlay ? HookInk(mapUnderlay, 0.5) : nil, haloWidth: o.underlay ? 5 * u : 0
        )
    }
    return out
}

extension MapDrawing {
    /// This drawing's frame at `t` — what the app's painter strokes.
    public func frame(at t: Double, _ frame: FrameBox,
                      measure: ((_ text: String, _ fontPx: Double) -> Double)? = nil) -> MapFrame? {
        mapFrame(options, timing, context, pictures, t, frame, measure: measure)
    }
}

/// The current stop's picture over the whole frame, cross-fading, then dimmed —
/// the veil only where a picture was actually laid down: with no picture the
/// piece's own frame shows through, and dimming that would be a change nobody
/// asked for.
private func mapBackdrop(_ o: MapOptions, _ media: MediaAt, _ pictureKey: (Int) -> String?) -> MapFrame.Backdrop {
    var layers: [MapFrame.Layer] = []
    var covered = 0.0
    if let previous = media.previous, let key = pictureKey(previous) {
        layers.append(MapFrame.Layer(key: key, alpha: 1 - media.mix))
        covered = max(covered, 1 - media.mix)
    }
    if let key = pictureKey(media.current) {
        layers.append(MapFrame.Layer(key: key, alpha: media.mix))
        covered = max(covered, media.mix)
    }
    let veil = covered > 0 && o.mediaDim > 0 ? o.mediaDim * covered : 0
    return MapFrame.Backdrop(layers: layers, veil: veil)
}

/// A translucent panel behind the map, for a map over a busy picture.
private func mapPlate(_ o: MapOptions, _ box: Rect, _ u: Double, _ w: Double) -> MapFrame.Panel {
    let padX = 34 * u + (o.labels != .none ? 80 * u * o.labelSize : 0)
    let top = box.y - (o.compass ? 100 * u : 30 * u)
    let bottom = box.y + box.height + (o.distance != .off ? 66 * u : 30 * u)
    let x0 = max(8 * u, box.x - padX)
    let x1 = min(w - 8 * u, box.x + box.width + padX)
    return MapFrame.Panel(rect: Rect(x: x0, y: top, width: x1 - x0, height: bottom - top), radius: 20 * u,
                          ink: HookInk(o.plateColor, o.plateOpacity))
}

/// A faint lat/lon grid behind the line — whole degrees at a step the span
/// chooses, so a city map and a continent map both get a handful of lines.
private func mapGraticule(_ o: MapOptions, _ box: Rect, _ projection: MapProjection, _ u: Double) -> MapFrame.Graticule {
    let lats = o.stops.map(\.lat)
    let lons = o.stops.map(\.lon)
    let minLat = lats.min() ?? 0, maxLat = lats.max() ?? 0
    let minLon = lons.min() ?? 0, maxLon = lons.max() ?? 0
    let span = max(maxLat - minLat, maxLon - minLon)
    let steps: [Double] = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30]
    let step = steps.first { span / $0 <= 6 } ?? 45
    func first(_ min: Double) -> Double { (min / step).rounded(.up) * step }
    var lines: [MapFrame.Segment] = []
    var lat = first(minLat - step * 3)
    while lat <= maxLat + step * 3 {
        let a = projection.project(GeoPoint(lat: lat, lon: minLon - step * 6))
        let b = projection.project(GeoPoint(lat: lat, lon: maxLon + step * 6))
        lines.append(MapFrame.Segment(from: a, to: b))
        lat += step
    }
    var lon = first(minLon - step * 3)
    while lon <= maxLon + step * 3 {
        let a = projection.project(GeoPoint(lat: minLat - step * 6, lon: lon))
        let b = projection.project(GeoPoint(lat: maxLat + step * 6, lon: lon))
        lines.append(MapFrame.Segment(from: a, to: b))
        lon += step
    }
    return MapFrame.Graticule(clip: box, lines: lines, ink: HookInk(o.pathColor, 0.16), width: 1.5 * u)
}

/// One pinned picture, once it is known where it goes.
private struct MapPlacedPin {
    /// The dot it belongs to.
    var at: Point
    /// The tile's top-left corner, and its side.
    var spot: Point
    var size: Double
    var alpha: Double
    var key: String
}

/// Where the pinned pictures go. Each is tried above its dot, then right,
/// left, below, and DROPPED if it would leave the frame, overlap a pin already
/// placed, or cover ANOTHER stop's dot — a stop hidden behind a picture reads
/// as a stop that is not on the itinerary.
private func mapLayoutPins(_ o: MapOptions, _ timing: MapTiming, _ points: [Point], _ reached: [Bool],
                           _ pictureKey: (Int) -> String?, _ media: MediaAt, _ t: Double, _ u: Double,
                           _ frame: FrameBox, _ dotR: Double, _ placed: inout [LabelBox]) -> [MapPlacedPin] {
    var pins: [MapPlacedPin] = []
    let size = mapPinSide * u * o.mediaSize
    let gap = dotR + 14 * u
    for (index, at) in points.enumerated() {
        if !reached[index] { continue }
        guard let key = pictureKey(index) else { continue }
        let alpha = o.pinKeep || index == media.current ? pinAlphaAt(timing, t, index, o.mediaFade) : 0
        if alpha <= 0 { continue }
        let tries = [
            Point(at.x - size / 2, at.y - gap - size),
            Point(at.x + gap, at.y - size / 2),
            Point(at.x - gap - size, at.y - size / 2),
            Point(at.x - size / 2, at.y + gap),
        ]
        let spot = tries.first { candidate in
            let b = LabelBox(x0: candidate.x, y0: candidate.y, x1: candidate.x + size, y1: candidate.y + size)
            if b.x0 < 4 * u || b.y0 < 4 * u || b.x1 > frame.width - 4 * u || b.y1 > frame.height - 4 * u {
                return false
            }
            if placed.contains(where: { p in b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0 }) { return false }
            return !points.enumerated().contains { other, p in
                other != index && p.x > b.x0 - dotR && p.x < b.x1 + dotR && p.y > b.y0 - dotR && p.y < b.y1 + dotR
            }
        }
        guard let spot else { continue }
        placed.append(LabelBox(x0: spot.x, y0: spot.y, x1: spot.x + size, y1: spot.y + size))
        pins.append(MapPlacedPin(at: at, spot: spot, size: size, alpha: alpha, key: key))
    }
    return pins
}

/// One picture under the map (over it, when the map sits low), captioned with
/// the stop's name: a picture under a place name is a postcard.
private func mapCard(_ o: MapOptions, _ media: MediaAt, _ pictureKey: (Int) -> String?, _ box: Rect, _ u: Double,
                     _ frame: FrameBox) -> [MapFrame.Tile] {
    let below = frame.height - (box.y + box.height)
    let above = box.y
    let under = below >= above
    let room = max(0, (under ? below : above) - 28 * u)
    if room <= 40 * u { return [] }
    let height = min(room, 300 * u * o.mediaSize)
    let width = min(frame.width - 40 * u, height * 1.5)
    let x = box.x + box.width / 2 - width / 2
    let y = under ? box.y + box.height + 20 * u : box.y - 20 * u - height

    var tiles: [MapFrame.Tile] = []
    func draw(_ index: Int, _ alpha: Double) {
        guard let key = pictureKey(index), alpha > 0 else { return }
        let name = index < o.stops.count ? o.stops[index].name.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        tiles.append(MapFrame.Tile(key: key, rect: Rect(x: x, y: y, width: width, height: height), alpha: alpha,
                                   frame: o.mediaFrame, caption: name))
    }
    if let previous = media.previous { draw(previous, 1 - media.mix) }
    draw(media.current, media.mix)
    return tiles
}

/// Every stop's picture as a row along the frame's edge: the ones the pen has
/// reached at full strength, the ones still ahead held back behind a veil — the
/// only mode that shows what is still to come, and says from the first frame
/// how many stops there are.
private func mapStrip(_ o: MapOptions, _ timing: MapTiming, _ count: Int, _ pictureKey: (Int) -> String?,
                      _ t: Double, _ u: Double, _ frame: FrameBox) -> [MapFrame.StripTile] {
    let withPictures = (0..<count).compactMap { index in pictureKey(index).map { (index: index, key: $0) } }
    if withPictures.isEmpty { return [] }
    let n = Double(withPictures.count)
    let gap = 8 * u
    let maxTile = 130 * u * o.mediaSize
    let available = frame.width - 32 * u
    let size = min(maxTile, (available - gap * (n - 1)) / n)
    if size < 24 * u { return [] }
    let rowWidth = size * n + gap * (n - 1)
    let x0 = frame.width / 2 - rowWidth / 2
    let y = o.position == .bottom ? 26 * u : frame.height - size - 26 * u
    let last = mapLastReached(timing, t)

    return withPictures.enumerated().map { slot, item in
        let x = x0 + Double(slot) * (size + gap)
        let arrived = pinAlphaAt(timing, t, item.index, o.mediaFade)
        let tile = MapFrame.Tile(key: item.key, rect: Rect(x: x, y: y, width: size, height: size), alpha: 1,
                                 frame: o.mediaFrame, caption: "")
        let veil = arrived < 1
            ? MapFrame.Panel(rect: Rect(x: x, y: y, width: size, height: size), radius: 5 * u,
                             ink: HookInk("#0c0b09", 0.62 * (1 - arrived)))
            : nil
        let ring = arrived > 0 && item.index == last
            ? MapFrame.Ring(rect: Rect(x: x - 2 * u, y: y - 2 * u, width: size + 4 * u, height: size + 4 * u),
                            radius: 6 * u, ink: HookInk(o.pathColor, 1), width: 3 * u * o.lineWidth)
            : nil
        return MapFrame.StripTile(tile: tile, veil: veil, ring: ring)
    }
}

private func mapLastReached(_ timing: MapTiming, _ t: Double) -> Int {
    var index = 0
    for i in timing.arrivals.indices.dropFirst() where t + 1e-9 >= timing.arrivals[i] { index = i }
    return index
}

/// A little aeroplane at `at`, nose along `angle`, `r` from its centre to its nose.
private func mapPlane(_ at: Point, _ angle: Double, _ r: Double) -> [Point] {
    let c = cos(angle)
    let s = sin(angle)
    let outline = [(r, 0.0), (-r * 0.7, r * 0.62), (-r * 0.35, 0.0), (-r * 0.7, -r * 0.62)]
    return outline.map { p in Point(at.x + p.0 * c - p.1 * s, at.y + p.0 * s + p.1 * c) }
}

/// A north arrow with its letter — north is up because the projection is.
private func mapCompass(_ o: MapOptions, _ cx: Double, _ cy: Double, _ u: Double) -> MapFrame.Compass {
    let half = 17 * u
    let from = Point(cx, cy + half)
    let to = Point(cx, cy - half + 6 * u)
    var shaft: [MapFrame.Line] = []
    if o.underlay { shaft.append(MapFrame.Line(from: from, to: to, ink: HookInk(mapUnderlay, 0.5), width: 8 * u)) }
    shaft.append(MapFrame.Line(from: from, to: to, ink: HookInk(o.pathColor, 1), width: 3.5 * u))
    let head = [Point(cx, cy - half - 2 * u), Point(cx - 7 * u, cy - half + 12 * u), Point(cx + 7 * u, cy - half + 12 * u)]
    let letter = HookText(text: "N", at: Point(cx, cy - half - 16 * u), align: .center, fontPx: 20 * u, weight: 600,
                          face: .mono, ink: HookInk(o.pathColor, 1),
                          halo: o.underlay ? HookInk(mapUnderlay, 0.5) : nil, haloWidth: o.underlay ? 4 * u : 0)
    return MapFrame.Compass(shaft: shaft, head: head, headInk: HookInk(o.pathColor, 1), letter: letter)
}
