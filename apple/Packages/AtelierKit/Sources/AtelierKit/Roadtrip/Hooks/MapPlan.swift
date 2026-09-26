// The Itinerary's arithmetic — an AUTHORED map. Port of
// `src/shared/roadtrip/hooks/map-plan.ts`, whole: the stops, every drawing
// option with its default and its bounds, the reader that clamps a stored
// record, the conversion of a retired Route layer (the v20 migration) — and
// the behaviour: the box and the drag, the projection and its inverse, the
// arcs, the phased clock, the pen, the pictures' timing, the score, and the
// itinerary's editing verbs. The variant is `MapVariant.swift`, one frame's
// layout `MapPaint.swift`.
//
// Unlike the retired Route trace (which read the legs and so refused to pin a
// point), every stop here is one the author picked, in the order they chose,
// holding the picture they gave it. Nothing is derived, so nothing is invented.
//
// Names that differ from the web's, and why:
// - `fitProjection` → `fitMapProjection`, returning a `MapProjection` value
//   with `project` / `unproject`: `fitProjection` is already `Geo.swift`'s
//   (the openers' shared one-way projection, a different function).
// - map-plan's own `haversineKm` and `formatDistance` are `Geo.swift`'s — the
//   web carries two identical copies; the kernel keeps one. Its `Point`, `Box`
//   and `LatLon` are `Geometry.swift`'s `Point` and `Rect` and `GeoPoint`.
//
// Rules kept:
// - A stop is a place the AUTHOR picked and, optionally, one picture; a stop
//   with no coordinates is not a stop (`readStops` drops it), and past
//   `mapMaxStops` the rest are dropped on read rather than half-drawn.
// - A stored record is never trusted: every number is read the way
//   JavaScript's `Number()` reads it (a null is 0, a boolean 0 or 1) and then
//   clamped; an unknown word or an unpaintable colour falls back to the
//   default; a colour is kept lower-cased.
// - A stop's picture keeps its ref only when the ref names a file; the
//   picture's coordinates are not read here — the stop's own are what it is
//   drawn at.
// - The clock is PHASES, never one curve over the whole line: a hold, then per
//   hop a travel and a dwell. Travel is shared by LENGTH (in the projection's
//   own units, frame-free), so the pen keeps one pace; the easing shapes each
//   hop. With the drawing off every stop is reached at zero — a still map.
// - The first stop's picture and pin are up from the first frame: it is where
//   the piece starts, not somewhere the pen arrives.
// - The projection runs BACKWARDS too (`unproject`), so a click on the
//   picking map is a pair of coordinates; with fewer than two distinct points
//   it fits the whole world, the only honest reading of an empty map.

import Foundation

/// How a stop's picture is presented.
public enum MapMedia: String, CaseIterable, Sendable {
    case off, pin, card, backdrop, strip
}

public enum MapPosition: String, CaseIterable, Sendable {
    case top, middle, bottom
}

public enum MapAlign: String, CaseIterable, Sendable {
    case left, center, right
}

/// How the hops the pen has not reached yet are drawn.
public enum MapAhead: String, CaseIterable, Sendable {
    case dashed, faint, hidden
}

public enum MapLabels: String, CaseIterable, Sendable {
    case none, ends, current, passed, all
}

public enum MapPen: String, CaseIterable, Sendable {
    case dot, plane, none
}

/// Whether a picture's tile wears a paper border or is drawn bare.
public enum MapMediaFrame: String, CaseIterable, Sendable {
    case paper, bare
}

/// One place on the itinerary, with the picture the author gave it.
public struct MapStop: GeoLocated, Equatable, Sendable {
    /// Stable across edits — what a reorder moves.
    public var id: String
    public var name: String
    public var lat: Double
    public var lon: Double
    /// The one picture this stop shows, or nothing.
    public var picture: HookPickedPicture?

    public init(id: String, name: String, lat: Double, lon: Double, picture: HookPickedPicture? = nil) {
        self.id = id; self.name = name; self.lat = lat; self.lon = lon; self.picture = picture
    }

    /// The stop as the options hold it — a stop with no picture has no key.
    public var json: JSONValue {
        var o: [String: JSONValue] = ["id": .string(id), "name": .string(name), "lat": .number(lat), "lon": .number(lon)]
        if let picture { o["picture"] = picture.json }
        return .object(o)
    }
}

public struct MapOptions: Equatable, Sendable {
    /// The itinerary itself. Everything else is how it is drawn.
    public var stops: [MapStop]
    // --- frame ---
    public var position: MapPosition
    public var align: MapAlign
    public var size: Double
    /// Where a drag on the stage has put the map, as fractions of the frame.
    public var offsetX: Double
    public var offsetY: Double
    public var plate: Bool
    public var plateOpacity: Double
    public var plateColor: String
    /// A faint lat/lon grid behind the line.
    public var graticule: Bool
    // --- path ---
    public var lineWidth: Double
    public var pathColor: String
    public var aheadColor: String
    public var aheadStyle: MapAhead
    /// How far a hop bows away from the straight line, 0 = straight.
    public var curve: Double
    public var underlay: Bool
    // --- places ---
    public var dots: Bool
    public var dotSize: Double
    public var numbers: Bool
    public var labels: MapLabels
    public var labelSize: Double
    /// The trip's own located places that are NOT stops, drawn faint behind.
    public var context: Bool
    // --- motion ---
    public var draw: Bool
    public var drawSeconds: Double
    public var easing: HookEasing
    public var delaySeconds: Double
    /// Seconds the pen waits at each stop it reaches.
    public var dwellSeconds: Double
    public var pen: MapPen
    // --- media ---
    public var media: MapMedia
    public var mediaSize: Double
    /// Seconds a picture takes to arrive.
    public var mediaFade: Double
    /// How far a backdrop is dimmed, so the line stays legible over it.
    public var mediaDim: Double
    public var mediaFrame: MapMediaFrame
    /// A hairline from a pinned picture down to its dot.
    public var pinStem: Bool
    /// Pins stay once they have appeared, rather than only the latest showing.
    public var pinKeep: Bool
    /// The badge's caption says the stop the pen is at, while it travels.
    public var nameInBadge: Bool
    // --- extras ---
    public var compass: Bool
    public var distance: DistanceUnit
    // --- sound ---
    public var sound: Bool
    public var kit: TickKit
    public var tickPitch: Double
    public var tickVolume: Double
    public var mixWithClip: Bool

    /// The web's `MAP_DEFAULTS`.
    public static let defaults = MapOptions(
        stops: [], position: .middle, align: .center, size: 1, offsetX: 0, offsetY: 0,
        plate: false, plateOpacity: 0.35, plateColor: "#000000", graticule: false,
        lineWidth: 1, pathColor: "#ffffff", aheadColor: "#ffffff", aheadStyle: .dashed, curve: 0.18, underlay: true,
        dots: true, dotSize: 1, numbers: false, labels: .current, labelSize: 1, context: false,
        draw: true, drawSeconds: 2.4, easing: .easeInOut, delaySeconds: 0.2, dwellSeconds: 0.5, pen: .dot,
        media: .pin, mediaSize: 1, mediaFade: 0.25, mediaDim: 0.45, mediaFrame: .paper, pinStem: true, pinKeep: true,
        nameInBadge: false, compass: false, distance: .off,
        sound: false, kit: .ratchet, tickPitch: 1, tickVolume: 1, mixWithClip: false
    )

    /// Every option as the document holds it — the whole record, the way the
    /// web's reader hands it back and a panel writes it.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        o["stops"] = .array(stops.map(\.json))
        o["position"] = .string(position.rawValue)
        o["align"] = .string(align.rawValue)
        o["size"] = .number(size)
        o["offsetX"] = .number(offsetX)
        o["offsetY"] = .number(offsetY)
        o["plate"] = .bool(plate)
        o["plateOpacity"] = .number(plateOpacity)
        o["plateColor"] = .string(plateColor)
        o["graticule"] = .bool(graticule)
        o["lineWidth"] = .number(lineWidth)
        o["pathColor"] = .string(pathColor)
        o["aheadColor"] = .string(aheadColor)
        o["aheadStyle"] = .string(aheadStyle.rawValue)
        o["curve"] = .number(curve)
        o["underlay"] = .bool(underlay)
        o["dots"] = .bool(dots)
        o["dotSize"] = .number(dotSize)
        o["numbers"] = .bool(numbers)
        o["labels"] = .string(labels.rawValue)
        o["labelSize"] = .number(labelSize)
        o["context"] = .bool(context)
        o["draw"] = .bool(draw)
        o["drawSeconds"] = .number(drawSeconds)
        o["easing"] = .string(easing.rawValue)
        o["delaySeconds"] = .number(delaySeconds)
        o["dwellSeconds"] = .number(dwellSeconds)
        o["pen"] = .string(pen.rawValue)
        o["media"] = .string(media.rawValue)
        o["mediaSize"] = .number(mediaSize)
        o["mediaFade"] = .number(mediaFade)
        o["mediaDim"] = .number(mediaDim)
        o["mediaFrame"] = .string(mediaFrame.rawValue)
        o["pinStem"] = .bool(pinStem)
        o["pinKeep"] = .bool(pinKeep)
        o["nameInBadge"] = .bool(nameInBadge)
        o["compass"] = .bool(compass)
        o["distance"] = .string(distance.rawValue)
        o["sound"] = .bool(sound)
        o["kit"] = .string(kit.rawValue)
        o["tickPitch"] = .number(tickPitch)
        o["tickVolume"] = .number(tickVolume)
        o["mixWithClip"] = .bool(mixWithClip)
        return .object(o)
    }
}

/// The bounds every stored number is clamped to. The web's `MAP_LIMITS`.
public struct MapLimits: Sendable {
    public let size = (min: 0.5, max: 1.2)
    /// Far enough to put the map in any corner, never far enough to lose it.
    public let offset = (min: -0.45, max: 0.45)
    public let plateOpacity = (min: 0.1, max: 0.9)
    public let lineWidth = (min: 0.5, max: 2.0)
    public let curve = (min: 0.0, max: 0.6)
    public let dotSize = (min: 0.5, max: 2.0)
    public let labelSize = (min: 0.6, max: 1.6)
    public let drawSeconds = (min: 0.6, max: 8.0)
    public let delaySeconds = (min: 0.0, max: 2.0)
    public let dwellSeconds = (min: 0.0, max: 2.0)
    public let mediaSize = (min: 0.5, max: 2.0)
    public let mediaFade = (min: 0.0, max: 1.0)
    public let mediaDim = (min: 0.0, max: 0.85)
    public let tickPitch = (min: 0.5, max: 2.0)
    public let tickVolume = (min: 0.0, max: 2.0)
}

public let mapLimits = MapLimits()

/// The most stops one itinerary draws; extra stops are dropped on read.
public let mapMaxStops = 24

/// `Number(value)`, clamped; a value that is not a finite number falls back.
private func mapNumber(_ value: JSONValue?, _ bounds: (min: Double, max: Double), _ fallback: Double) -> Double {
    let n = JSLoose.number(value)
    return n.isFinite ? min(bounds.max, max(bounds.min, n)) : fallback
}

private func mapWord<T: RawRepresentable>(_ value: JSONValue?, _ fallback: T) -> T where T.RawValue == String {
    value?.stringValue.flatMap(T.init(rawValue:)) ?? fallback
}

/// `/^#[0-9a-f]{6}$/i`, lower-cased; anything else falls back.
private func mapHex(_ value: JSONValue?, _ fallback: String) -> String {
    guard let s = value?.stringValue else { return fallback }
    let bytes = Array(s.utf8)
    guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return fallback }
    for b in bytes[1...] {
        let digit = (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)
        if !digit { return fallback }
    }
    return s.lowercased()
}

/// A picture's ref kept only when it names a file — the web keeps the stored
/// record itself; here it is read onto the ref's own fields.
private func mapPictureRef(_ raw: JSONValue?) -> SavedMediaRef? {
    guard let r = raw?.objectValue, let name = r["name"]?.stringValue, !name.isEmpty else { return nil }
    let size = r["size"]?.finiteNumber ?? 0
    var ref = SavedMediaRef(name: name, size: abs(size) < 9e15 ? Int(size) : 0,
                            lastModified: r["lastModified"]?.finiteNumber ?? 0)
    if let assetId = r["assetId"]?.stringValue, !assetId.isEmpty { ref.assetId = assetId }
    if let hash = r["hash"]?.stringValue, !hash.isEmpty { ref.hash = hash }
    return ref
}

/// A stored picture reference, read defensively: anything that cannot name a
/// file again is dropped, and the stop then simply has no picture.
private func readStopPicture(_ raw: JSONValue?) -> HookPickedPicture? {
    guard let p = raw?.objectValue, let ref = mapPictureRef(p["ref"]) else { return nil }
    let takenAt = JSLoose.number(p["takenAt"])
    return HookPickedPicture(ref: ref, date: p["date"]?.stringValue ?? "", takenAt: takenAt.isFinite ? takenAt : nil)
}

/// Stored stops, read through the same discipline as the rest of the options.
public func readStops(_ raw: JSONValue?) -> [MapStop] {
    guard let list = raw?.arrayValue else { return [] }
    var out: [MapStop] = []
    for row in list {
        guard let s = row.objectValue else { continue }
        let lat = JSLoose.number(s["lat"])
        let lon = JSLoose.number(s["lon"])
        // A place with no coordinates is a complete place everywhere else in
        // this tool; it simply cannot be a point on a map.
        if !lat.isFinite || !lon.isFinite { continue }
        if abs(lat) > 90 || abs(lon) > 180 { continue }
        let id = s["id"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? "stop\(out.count)"
        out.append(MapStop(id: id, name: s["name"]?.stringValue ?? "", lat: lat, lon: lon, picture: readStopPicture(s["picture"])))
        if out.count >= mapMaxStops { break }
    }
    return out
}

/// A stored options record, read through the defaults and clamped — the web's
/// `{ ...MAP_DEFAULTS, ...raw }`: a key the record holds, even as null, is read.
public func mapOptions(_ raw: HookOptions) -> MapOptions {
    let d = MapOptions.defaults
    let L = mapLimits
    // A key the record does not hold reads the default; one it holds is read.
    func v(_ key: String, _ fallback: JSONValue) -> JSONValue { raw[key] ?? fallback }
    var o = d
    o.stops = raw["stops"].map(readStops) ?? []
    o.position = mapWord(raw["position"], d.position)
    o.align = mapWord(raw["align"], d.align)
    o.size = mapNumber(v("size", .number(d.size)), L.size, d.size)
    o.offsetX = mapNumber(v("offsetX", .number(d.offsetX)), L.offset, d.offsetX)
    o.offsetY = mapNumber(v("offsetY", .number(d.offsetY)), L.offset, d.offsetY)
    o.plate = raw["plate"].map { $0 == .bool(true) } ?? d.plate
    o.plateOpacity = mapNumber(v("plateOpacity", .number(d.plateOpacity)), L.plateOpacity, d.plateOpacity)
    o.plateColor = mapHex(raw["plateColor"], d.plateColor)
    o.graticule = raw["graticule"].map { $0 == .bool(true) } ?? d.graticule
    o.lineWidth = mapNumber(v("lineWidth", .number(d.lineWidth)), L.lineWidth, d.lineWidth)
    o.pathColor = mapHex(raw["pathColor"], d.pathColor)
    o.aheadColor = mapHex(raw["aheadColor"], d.aheadColor)
    o.aheadStyle = mapWord(raw["aheadStyle"], d.aheadStyle)
    o.curve = mapNumber(v("curve", .number(d.curve)), L.curve, d.curve)
    o.underlay = raw["underlay"].map { $0 != .bool(false) } ?? d.underlay
    o.dots = raw["dots"].map { $0 != .bool(false) } ?? d.dots
    o.dotSize = mapNumber(v("dotSize", .number(d.dotSize)), L.dotSize, d.dotSize)
    o.numbers = raw["numbers"].map { $0 == .bool(true) } ?? d.numbers
    o.labels = mapWord(raw["labels"], d.labels)
    o.labelSize = mapNumber(v("labelSize", .number(d.labelSize)), L.labelSize, d.labelSize)
    o.context = raw["context"].map { $0 == .bool(true) } ?? d.context
    o.draw = raw["draw"].map { $0 != .bool(false) } ?? d.draw
    o.drawSeconds = mapNumber(v("drawSeconds", .number(d.drawSeconds)), L.drawSeconds, d.drawSeconds)
    o.easing = mapWord(raw["easing"], d.easing)
    o.delaySeconds = mapNumber(v("delaySeconds", .number(d.delaySeconds)), L.delaySeconds, d.delaySeconds)
    o.dwellSeconds = mapNumber(v("dwellSeconds", .number(d.dwellSeconds)), L.dwellSeconds, d.dwellSeconds)
    o.pen = mapWord(raw["pen"], d.pen)
    o.media = mapWord(raw["media"], d.media)
    o.mediaSize = mapNumber(v("mediaSize", .number(d.mediaSize)), L.mediaSize, d.mediaSize)
    o.mediaFade = mapNumber(v("mediaFade", .number(d.mediaFade)), L.mediaFade, d.mediaFade)
    o.mediaDim = mapNumber(v("mediaDim", .number(d.mediaDim)), L.mediaDim, d.mediaDim)
    o.mediaFrame = mapWord(raw["mediaFrame"], d.mediaFrame)
    o.pinStem = raw["pinStem"].map { $0 != .bool(false) } ?? d.pinStem
    o.pinKeep = raw["pinKeep"].map { $0 != .bool(false) } ?? d.pinKeep
    o.nameInBadge = raw["nameInBadge"].map { $0 == .bool(true) } ?? d.nameInBadge
    o.compass = raw["compass"].map { $0 == .bool(true) } ?? d.compass
    o.distance = mapWord(raw["distance"], d.distance)
    o.sound = raw["sound"].map { $0 == .bool(true) } ?? d.sound
    o.kit = mapWord(raw["kit"], d.kit)
    o.tickPitch = mapNumber(v("tickPitch", .number(d.tickPitch)), L.tickPitch, d.tickPitch)
    o.tickVolume = mapNumber(v("tickVolume", .number(d.tickVolume)), L.tickVolume, d.tickVolume)
    o.mixWithClip = raw["mixWithClip"].map { $0 == .bool(true) } ?? d.mixWithClip
    return o
}

/// A located place, as a stop list is seeded from.
public struct MapPlace: GeoLocated, Equatable, Sendable {
    public var name: String
    public var lat: Double
    public var lon: Double
    public init(name: String, lat: Double, lon: Double) { self.name = name; self.lat = lat; self.lon = lon }
}

/// The trip's own located places as an itinerary — the one-click start.
public func stopsFromPlaces(_ places: [MapPlace], _ makeId: (Int) -> String) -> [MapStop] {
    places.prefix(mapMaxStops).enumerated().map { i, place in
        MapStop(id: makeId(i), name: place.name, lat: place.lat, lon: place.lon)
    }
}

/// Where a stop list seeded from places comes from, as JSON — `readStops`
/// reads it back the way the web's `mapOptions` reads the list it was handed,
/// so a place whose name is not text or whose coordinates are not numbers
/// lands exactly as there.
private func placesAsStops(_ places: [(name: JSONValue?, lat: JSONValue?, lon: JSONValue?)], _ makeId: (Int) -> String) -> JSONValue {
    .array(places.prefix(mapMaxStops).enumerated().map { i, place in
        var o: [String: JSONValue] = ["id": .string(makeId(i))]
        if let name = place.name { o["name"] = name }
        if let lat = place.lat { o["lat"] = lat }
        if let lon = place.lon { o["lon"] = lon }
        return .object(o)
    })
}

/// A retired ROUTE layer's options as an Itinerary's (the v20 migration): the
/// trip's own located places become the stops, and every option that means
/// the same thing in both comes across. The Route's "trip so far" is the line
/// the pen draws here and its "legs ahead" what is still to come; its accent
/// (the current leg) has no counterpart and is the one thing a converted piece
/// loses. The pictures start off — an itinerary whose stops hold none would
/// draw an empty card — and the line straight, which is what the Route drew.
/// Everything goes back through `mapOptions`, so a hand-edited document lands
/// clamped.
public func mapFromRoute(_ raw: HookOptions, _ places: [MapPlace], _ makeId: (Int) -> String) -> MapOptions {
    let stored = places.map { (name: JSONValue?.some(.string($0.name)), lat: JSONValue?.some(.number($0.lat)), lon: JSONValue?.some(.number($0.lon))) }
    return mapFromRoute(raw, storedPlaces: stored, makeId)
}

/// The same, over places read straight out of a stored document, so a name or
/// a coordinate of the wrong type is read exactly as the web reads it.
func mapFromRoute(_ raw: HookOptions, storedPlaces places: [(name: JSONValue?, lat: JSONValue?, lon: JSONValue?)],
                  _ makeId: (Int) -> String) -> MapOptions {
    var carried: HookOptions = ["stops": placesAsStops(places, makeId)]
    let renamed: [(to: String, from: String)] = [
        ("position", "position"), ("align", "align"), ("size", "size"),
        ("plate", "plate"), ("plateOpacity", "plateOpacity"), ("plateColor", "plateColor"),
        ("lineWidth", "lineWidth"), ("pathColor", "pastColor"), ("aheadColor", "futureColor"),
        ("aheadStyle", "futureStyle"), ("underlay", "underlay"), ("dots", "dots"), ("dotSize", "dotSize"),
        ("labels", "labels"), ("labelSize", "labelSize"), ("draw", "draw"), ("drawSeconds", "drawSeconds"),
        ("easing", "easing"), ("delaySeconds", "delaySeconds"), ("pen", "pen"), ("compass", "compass"),
        ("distance", "distance"), ("sound", "sound"), ("kit", "kit"), ("tickPitch", "tickPitch"),
        ("tickVolume", "tickVolume"), ("mixWithClip", "mixWithClip"),
    ]
    // An option the Route never wrote is left out, so the default stands.
    for (to, from) in renamed { if let value = raw[from] { carried[to] = value } }
    carried["media"] = .string(MapMedia.off.rawValue)
    carried["curve"] = .number(0)
    return mapOptions(carried)
}

// MARK: - Geometry

/// How the map is placed: the coarse anchor, its size, and the drag's offset.
/// The web's `MapPlacement` (a `Pick` of the options).
public struct MapPlacement: Equatable, Sendable {
    public var position: MapPosition
    public var align: MapAlign
    public var size: Double
    public var offsetX: Double
    public var offsetY: Double

    public init(position: MapPosition, align: MapAlign, size: Double, offsetX: Double, offsetY: Double) {
        self.position = position; self.align = align; self.size = size; self.offsetX = offsetX; self.offsetY = offsetY
    }
}

extension MapOptions {
    /// The options' own placement.
    public var placement: MapPlacement {
        MapPlacement(position: position, align: align, size: size, offsetX: offsetX, offsetY: offsetY)
    }
}

/// The box the map is fitted into, on a frame of `w`×`h` — the anchor the
/// author chose, plus wherever they have since dragged it. Everything else the
/// opener draws is measured from this box, so the drag moves the line, the
/// dots, the names and the card together.
public func mapBox(_ w: Double, _ h: Double, _ p: MapPlacement) -> Rect {
    let width = w * 0.76 * p.size
    let height = min(h * 0.42, w * 0.95) * p.size
    let anchorX: Double = p.align == .left ? w * 0.08 : (p.align == .right ? w * 0.92 - width : (w - width) / 2)
    let anchorY: Double = p.position == .top ? h * 0.1 : (p.position == .bottom ? h * 0.88 - height : (h - height) / 2)
    return Rect(x: anchorX + w * p.offsetX, y: anchorY + h * p.offsetY, width: width, height: height)
}

/// The same, read off the options.
public func mapBox(_ w: Double, _ h: Double, _ o: MapOptions) -> Rect {
    mapBox(w, h, o.placement)
}

/// The map after a drag of `dx`, `dy` — fractions of the frame, incremental.
/// Clamped rather than free: a map dragged off the frame is a hook that draws
/// nothing, with no way back but the panel.
public func moveMap(_ o: MapOptions, _ dx: Double, _ dy: Double) -> MapOptions {
    let L = mapLimits.offset
    var out = o
    out.offsetX = min(L.max, max(L.min, o.offsetX + dx))
    out.offsetY = min(L.max, max(L.min, o.offsetY + dy))
    return out
}

/// Whether the map has been dragged away from the anchor it was placed on.
public func mapMoved(_ o: MapOptions) -> Bool {
    o.offsetX != 0 || o.offsetY != 0
}

/// A projection fitting some points inside a box, and its inverse — the web's
/// `fitProjection` in `map-plan.ts` (see the header for the name). Both
/// directions share one scale, so a point projected and unprojected is itself.
public struct MapProjection: Equatable, Sendable {
    /// The inner box's centre, in frame pixels.
    public let cx: Double
    public let cy: Double
    /// The fitted points' middle, in projected (pre-scale) units.
    public let midX: Double
    public let midY: Double
    /// Pixels per degree of latitude.
    public let scale: Double
    /// The longitude's squeeze at the mean latitude, never below 0.05.
    public let k: Double

    /// A located place, on the frame.
    public func project<P: GeoLocated>(_ p: P) -> Point {
        Point(cx + (p.lon * k - midX) * scale, cy + (-p.lat - midY) * scale)
    }

    /// A point of the frame, as a located place: the latitude clamped to the
    /// poles, the longitude wrapped — a drag off the left edge of the world
    /// comes back on the right.
    public func unproject(_ p: Point) -> GeoPoint {
        let lat = -(midY + (p.y - cy) / scale)
        let lon = (midX + (p.x - cx) / scale) / k
        return GeoPoint(lat: min(90, max(-90, lat)), lon: mapWrapLon(lon))
    }
}

/// `((lon + 180) % 360 + 360) % 360 - 180`, JavaScript's `%` being a truncating remainder.
private func mapWrapLon(_ lon: Double) -> Double {
    let once = (lon + 180).truncatingRemainder(dividingBy: 360)
    return (once + 360).truncatingRemainder(dividingBy: 360) - 180
}

/// A projection fitting `points` inside `box`, `padding` pixels in from its
/// edges, and its inverse.
///
/// The inverse is what makes the picking map a map rather than a picture of
/// one: a click comes back as a coordinate pair, so a stop can be dropped where
/// there is no place to click on.
///
/// With fewer than two distinct points there is no scale to derive. The
/// fallback is the WHOLE WORLD fitted to the box rather than an arbitrary zoom:
/// an empty itinerary's first pin has to land somewhere real, and "somewhere on
/// Earth" is the only honest reading of a map with nothing on it yet.
public func fitMapProjection<P: GeoLocated>(_ points: [P], _ box: Rect, _ padding: Double = 0) -> MapProjection {
    let innerX = box.x + padding
    let innerY = box.y + padding
    let innerW = max(1, box.width - padding * 2)
    let innerH = max(1, box.height - padding * 2)
    let cx = innerX + innerW / 2
    let cy = innerY + innerH / 2

    let meanLat = points.isEmpty ? 0 : points.reduce(0.0) { $0 + $1.lat } / Double(points.count)
    // Never let the cosine collapse at a pole: a scale of 0 is a projection
    // that cannot be inverted.
    let k = max(0.05, cos(meanLat * Double.pi / 180))
    let xs = points.map { $0.lon * k }
    let ys = points.map { -$0.lat }
    let minX = xs.min() ?? 0, maxX = xs.max() ?? 0
    let minY = ys.min() ?? 0, maxY = ys.max() ?? 0
    let spanX = maxX - minX
    let spanY = maxY - minY

    var midX = 0.0
    var midY = 0.0
    let scale: Double
    if spanX < 1e-9 && spanY < 1e-9 {
        // One point, or none: the world, centred on what there is.
        if let x = xs.first, let y = ys.first {
            midX = x
            midY = y
        }
        scale = min(innerW / (360 * k), innerH / 170)
    } else {
        midX = (minX + maxX) / 2
        midY = (minY + maxY) / 2
        let byWidth = spanX > 1e-9 ? innerW / spanX : Double.infinity
        let byHeight = spanY > 1e-9 ? innerH / spanY : Double.infinity
        scale = min(byWidth, byHeight)
    }
    return MapProjection(cx: cx, cy: cy, midX: midX, midY: midY, scale: scale, k: k)
}

/// The control point of the hop's arc. A straight hop reads as a ruler line;
/// a bowed one reads as a journey, which is the whole idiom of a travel map.
/// The bow is always to the LEFT of the direction of travel, so a there-and-
/// back itinerary draws two arcs rather than one line drawn twice.
public func arcControl(_ a: Point, _ b: Point, _ curve: Double) -> Point {
    let mx = (a.x + b.x) / 2
    let my = (a.y + b.y) / 2
    if curve <= 0 { return Point(mx, my) }
    let dx = b.x - a.x
    let dy = b.y - a.y
    let length = hypot(dx, dy)
    if length < 1e-9 { return Point(mx, my) }
    // The quadratic's peak is half-way to its control point, so the bow the
    // eye sees is `curve / 2` of the hop's length.
    return Point(mx + (dy / length) * length * curve, my - (dx / length) * length * curve)
}

/// A point on the quadratic Bézier at `s` (0..1).
public func quadAt(_ a: Point, _ c: Point, _ b: Point, _ s: Double) -> Point {
    let u = 1 - s
    let x = u * u * a.x + 2 * u * s * c.x + s * s * b.x
    let y = u * u * a.y + 2 * u * s * c.y + s * s * b.y
    return Point(x, y)
}

/// The first `s` of a quadratic, as a quadratic of its own (de Casteljau) —
/// what lets a partly-drawn hop be one quadratic rather than a polyline the
/// arc's own curvature would betray at the join.
public func quadSplit(_ a: Point, _ c: Point, _ b: Point, _ s: Double) -> (control: Point, end: Point) {
    let p01 = Point(a.x + (c.x - a.x) * s, a.y + (c.y - a.y) * s)
    let p12 = Point(c.x + (b.x - c.x) * s, c.y + (b.y - c.y) * s)
    return (p01, Point(p01.x + (p12.x - p01.x) * s, p01.y + (p12.y - p01.y) * s))
}

/// The REST of a quadratic, from `s` to its end, as a quadratic of its own —
/// the other half of the same split. It is what lets the line still to come go
/// on being drawn under the pen: without it, the moment the pen entered a hop
/// that hop's remainder vanished, and the shape of the journey stopped being
/// readable exactly where it matters most.
public func quadTail(_ a: Point, _ c: Point, _ b: Point, _ s: Double) -> (start: Point, control: Point, end: Point) {
    let p01 = Point(a.x + (c.x - a.x) * s, a.y + (c.y - a.y) * s)
    let p12 = Point(c.x + (b.x - c.x) * s, c.y + (b.y - c.y) * s)
    return (Point(p01.x + (p12.x - p01.x) * s, p01.y + (p12.y - p01.y) * s), p12, b)
}

/// Each hop's length in kilometres, in the itinerary's order.
public func hopKms(_ stops: [MapStop]) -> [Double] {
    guard stops.count > 1 else { return [] }
    return (1..<stops.count).map { haversineKm(stops[$0 - 1], stops[$0]) }
}

/// Each hop's length in the projection's own units — frame-free, since the
/// projection is one uniform scale. What the travel times are shared out by,
/// so the pen's pace is the same whatever size the frame is drawn at.
public func planarHops(_ stops: [MapStop]) -> [Double] {
    guard stops.count > 1 else { return [] }
    let projection = fitMapProjection(stops, Rect(x: 0, y: 0, width: 1000, height: 1000))
    return (1..<stops.count).map { i in
        let a = projection.project(stops[i - 1])
        let b = projection.project(stops[i])
        return hypot(b.x - a.x, b.y - a.y)
    }
}

// MARK: - The clock

/// One hop's share of the run: the travel, then the wait at the stop it lands on.
public struct MapHop: Equatable, Sendable {
    public var travel: Double
    public var dwell: Double

    public init(travel: Double, dwell: Double) {
        self.travel = travel; self.dwell = dwell
    }
}

public struct MapTiming: Equatable, Sendable {
    /// The hold on the first stop before the pen leaves.
    public var delay: Double
    public var hops: [MapHop]
    /// When each stop is reached. The first is reached when the hold ends.
    public var arrivals: [Double]
    public var total: Double

    public init(delay: Double, hops: [MapHop], arrivals: [Double], total: Double) {
        self.delay = delay; self.hops = hops; self.arrivals = arrivals; self.total = total
    }
}

/// The itinerary's clock. Travel is shared out by hop LENGTH, so a long hop
/// takes longer than a short one and the pen keeps one pace; each arrival is
/// followed by the dwell, including the last, which is what gives the final
/// picture time to be looked at.
///
/// With the drawing off there is no clock at all: every hop is there from the
/// first frame and the hook occupies nothing.
public func mapTiming(_ lengths: [Double], _ o: MapOptions) -> MapTiming {
    if !o.draw {
        // A still map: every stop is reached at zero, which is what makes the
        // whole path drawn, every pin up and the last stop the one showing —
        // with no branch anywhere downstream on "is this one moving".
        return MapTiming(delay: 0, hops: lengths.map { _ in MapHop(travel: 0, dwell: 0) },
                         arrivals: [0] + lengths.map { _ in 0 }, total: 0)
    }
    if lengths.isEmpty { return MapTiming(delay: 0, hops: [], arrivals: [0], total: 0) }
    let total = lengths.reduce(0, +)
    let hops = lengths.map { length in
        // A degenerate itinerary — every stop on one spot — still has to
        // advance, or the pen would never arrive and the dwells never run.
        MapHop(travel: o.drawSeconds * (total > 1e-9 ? length / total : 1 / Double(lengths.count)),
               dwell: o.dwellSeconds)
    }
    var arrivals = [o.delaySeconds]
    var at = o.delaySeconds
    for hop in hops {
        at += hop.travel
        arrivals.append(at)
        at += hop.dwell
    }
    return MapTiming(delay: o.delaySeconds, hops: hops, arrivals: arrivals, total: at)
}

/// The curve itself — every opener id has one (`HookEasing.swift`).
private func mapEase(_ easing: HookEasing, _ u: Double) -> Double {
    hookEasings[easing]?.ease(u) ?? u
}

/// Where the pen is at `t`.
public struct PenAt: Equatable, Sendable {
    /// The hop being travelled, or nil when the pen is waiting on a stop.
    public var hop: Int?
    /// How far along that hop, eased, 0..1.
    public var fraction: Double
    /// The last stop reached.
    public var stop: Int
    public var moving: Bool

    public init(hop: Int?, fraction: Double, stop: Int, moving: Bool) {
        self.hop = hop; self.fraction = fraction; self.stop = stop; self.moving = moving
    }
}

public func penAt(_ timing: MapTiming, _ easing: HookEasing, _ t: Double) -> PenAt {
    if timing.hops.isEmpty { return PenAt(hop: nil, fraction: 1, stop: 0, moving: false) }
    if t < timing.delay { return PenAt(hop: nil, fraction: 0, stop: 0, moving: false) }
    var at = timing.delay
    for (i, hop) in timing.hops.enumerated() {
        if t < at + hop.travel {
            let u = hop.travel > 0 ? (t - at) / hop.travel : 1
            return PenAt(hop: i, fraction: mapEase(easing, max(0, min(1, u))), stop: i, moving: true)
        }
        at += hop.travel
        if t < at + hop.dwell { return PenAt(hop: nil, fraction: 1, stop: i + 1, moving: false) }
        at += hop.dwell
    }
    return PenAt(hop: nil, fraction: 1, stop: timing.hops.count, moving: false)
}

/// How much of each hop is drawn at `t`, 0..1 — the pen's trail.
public func drawnFractions(_ timing: MapTiming, _ easing: HookEasing, _ t: Double, _ count: Int) -> [Double] {
    let pen = penAt(timing, easing, t)
    return (0..<max(0, count)).map { i -> Double in
        guard let hop = pen.hop else { return i < pen.stop ? 1 : 0 }
        if i < hop { return 1 }
        if i == hop { return pen.fraction }
        return 0
    }
}

/// Which picture is showing at `t`, and how far it has arrived.
///
/// The FIRST stop's picture is up from the first frame — it is where the piece
/// starts, not somewhere the pen travels to — so a hold at the start shows it
/// rather than an empty frame. Every later one cross-fades from the one before
/// as the pen lands.
public struct MediaAt: Equatable, Sendable {
    public var current: Int
    public var previous: Int?
    /// 0 = the previous picture still, 1 = the current one alone.
    public var mix: Double

    public init(current: Int, previous: Int?, mix: Double) {
        self.current = current; self.previous = previous; self.mix = mix
    }
}

public func mediaAt(_ timing: MapTiming, _ t: Double, _ fade: Double) -> MediaAt {
    var current = 0
    for i in timing.arrivals.indices.dropFirst() where t + 1e-9 >= timing.arrivals[i] {
        current = i
    }
    // The first stop, and a still map (the drawing off), are wholly there:
    // there is nothing for them to arrive from.
    if current == 0 || timing.total <= 0 { return MediaAt(current: current, previous: nil, mix: 1) }
    let since = t - timing.arrivals[current]
    let mix = fade > 0 ? max(0, min(1, since / fade)) : 1
    return MediaAt(current: current, previous: mix < 1 ? current - 1 : nil, mix: mix)
}

/// How present a stop's own pin is at `t`, 0..1 — for the pins that stay.
///
/// The FIRST stop is whole from the first frame, never faded in: it is where
/// the piece begins rather than somewhere the pen arrives, and `mediaAt` reads
/// it the same way. Two readings of "is stop 0 there yet" is how a pinned
/// picture and a backdrop of the same stop start disagreeing.
public func pinAlphaAt(_ timing: MapTiming, _ t: Double, _ index: Int, _ fade: Double) -> Double {
    // A still map (the drawing off) has nothing to arrive: everything is up.
    if index == 0 || timing.total <= 0 { return 1 }
    guard index > 0, index < timing.arrivals.count else { return 0 }
    let at = timing.arrivals[index]
    if t < at { return 0 }
    return fade > 0 ? max(0, min(1, (t - at) / fade)) : 1
}

/// Which stops carry their name under `labels`, given where the pen is.
///
/// `passed` is the one that accumulates: a name appears as the pen reaches its
/// stop and STAYS, so the itinerary reads as a list being written rather than
/// as one name following the pen around. `current` is the opposite reading and
/// both are wanted — which is why this is a list of modes and not a switch.
public func wantsLabel(_ labels: MapLabels, _ index: Int, _ count: Int, _ at: Int) -> Bool {
    if labels == .none || count == 0 { return false }
    switch labels {
    case .all: return true
    case .current: return index == at
    case .passed: return index <= at
    case .ends, .none: return index == 0 || index == count - 1
    }
}

/// The kilometres the pen has covered — each hop's length times how much of it
/// is drawn. The straight-line sum between the stops, never a road distance.
public func drawnKm(_ kms: [Double], _ fractions: [Double]) -> Double {
    var sum = 0.0
    for (i, km) in kms.enumerated() {
        sum += km * (i < fractions.count ? fractions[i] : 0)
    }
    return sum
}

/// The itinerary, heard: a tick at every stop the pen reaches, the seat where
/// it comes to rest. The first stop's tick is the departure, at the end of the
/// hold. Timed on the arrivals, so a tick cannot land before its dot.
public func mapScore(_ timing: MapTiming, _ tuning: (kit: TickKit, pitch: Double), _ volume: Double) -> [SoundEvent] {
    if !(volume > 0) || timing.hops.isEmpty { return [] }
    let kit = tuning.kit.spec
    let pitch = tuning.pitch
    let last = timing.arrivals.count - 1
    return timing.arrivals.enumerated().map { i, at -> SoundEvent in
        if i == last {
            return SoundEvent(at: at, voice: kit.seat.rawValue, gain: 0.8 * volume, rate: pitch)
        }
        if i == 0 {
            return SoundEvent(at: at, voice: kit.leg.voice.rawValue, gain: 0.75 * volume * kit.leg.gain,
                              rate: pitch * kit.leg.rate)
        }
        return SoundEvent(at: at, voice: kit.tick.rawValue, gain: 0.75 * volume, rate: pitch)
    }
}

/// The pictures the itinerary will draw, each under the key the shell decodes
/// it by. Only what is actually shown: with the media off, nothing is fetched
/// at all, and one picture used at two stops is decoded once.
public func mapWants(_ o: MapOptions) -> [HookPictureWant] {
    if o.media == .off { return [] }
    var seen = Set<String>()
    var out: [HookPictureWant] = []
    for stop in o.stops {
        guard let picture = stop.picture else { continue }
        let key = hookPictureKey(picture.ref)
        if seen.insert(key).inserted { out.append(HookPictureWant(key: key, ref: picture.ref)) }
    }
    return out
}

/// A stop's picture key, or nil — what the paint looks a picture up by.
public func stopPictureKey(_ stop: MapStop) -> String? {
    stop.picture.map { hookPictureKey($0.ref) }
}

/// Two positions within a millionth of a degree — the same place typed twice.
private func mapNear<A: GeoLocated, B: GeoLocated>(_ a: A, _ b: B) -> Bool {
    abs(a.lat - b.lat) < 1e-6 && abs(a.lon - b.lon) < 1e-6
}

/// The trip's own located places that are NOT already stops, for the faint
/// context layer and for the panel's "add a place" chips. Matched on position
/// rather than on name: the same place typed twice is one place.
public func otherPlaces(_ stages: [HookStage]?, _ stops: [MapStop]) -> [MapPlace] {
    var out: [MapPlace] = []
    for stage in stages ?? [] {
        for place in stage.places {
            if stops.contains(where: { mapNear($0, place) }) || out.contains(where: { mapNear($0, place) }) { continue }
            out.append(MapPlace(name: place.name, lat: place.lat, lon: place.lon))
        }
    }
    return out
}

// MARK: - Editing the itinerary — pure, so the panel only draws

/// A stop added at the end. The name is the author's to write.
public func addStop(_ stops: [MapStop], _ at: GeoPoint, name: String? = nil, _ id: String) -> [MapStop] {
    if stops.count >= mapMaxStops { return stops }
    return stops + [MapStop(id: id, name: name ?? "", lat: at.lat, lon: at.lon)]
}

/// One stop changed in place; everything else, including its picture, kept.
/// The patch may not change the stop's id (the web's `Omit<MapStop, 'id'>`).
public func patchStop(_ stops: [MapStop], _ id: String, _ patch: (inout MapStop) -> Void) -> [MapStop] {
    stops.map { stop in
        guard stop.id == id else { return stop }
        var patched = stop
        patch(&patched)
        patched.id = stop.id
        return patched
    }
}

public func removeStop(_ stops: [MapStop], _ id: String) -> [MapStop] {
    stops.filter { $0.id != id }
}

/// A stop moved one place earlier or later. Out of range is a no-op, not a wrap.
public func moveStop(_ stops: [MapStop], _ id: String, _ delta: Int) -> [MapStop] {
    guard let from = stops.firstIndex(where: { $0.id == id }) else { return stops }
    let to = from + delta
    if to < 0 || to >= stops.count { return stops }
    var out = stops
    let moved = out.remove(at: from)
    out.insert(moved, at: to)
    return out
}

/// The pictures the chooser came back with, landing on the stops.
///
/// The first goes to the stop the author asked from. The rest fill the stops
/// AFTER it that have none — never one that already holds a picture, so a
/// generous pick can never quietly undo earlier work, and never a stop before
/// the one asked from, which would edit behind the author's back. Anything
/// left over is reported by the panel rather than dropped in silence.
public func assignPictures(_ stops: [MapStop], _ index: Int,
                           _ picked: [HookPickedPicture]) -> (stops: [MapStop], used: Int) {
    var out = stops
    if index < 0 || index >= out.count { return (out, 0) }
    guard let first = picked.first else {
        // An empty pick is "this stop shows nothing" — the way to take a
        // picture off a stop from inside the chooser.
        out[index].picture = nil
        return (out, 0)
    }
    out[index].picture = first
    var used = 1
    var i = index + 1
    while i < out.count && used < picked.count {
        if out[i].picture == nil {
            out[i].picture = picked[used]
            used += 1
        }
        i += 1
    }
    return (out, used)
}

/// Every located place of the trip, in the order it was lived.
public func tripPlaces(_ stages: [HookStage]?) -> [MapPlace] {
    var out: [MapPlace] = []
    for stage in stages ?? [] {
        for place in stage.places where !out.contains(where: { mapNear($0, place) }) {
            out.append(MapPlace(name: place.name, lat: place.lat, lon: place.lon))
        }
    }
    return out
}
