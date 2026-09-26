// The Itinerary opener's OPTIONS as a trip stores them — port of the stored
// half of `src/shared/roadtrip/hooks/map-plan.ts`: the stops, every drawing
// option with its default and its bounds, the reader that clamps a stored
// record, and the conversion of a retired Route layer (the v20 migration).
//
// Types + reader only; the behaviour of `map-plan.ts` (the box, the drag, the
// projection and its inverse, the arcs, the phased clock, the pen, the
// pictures' timing, the score, the itinerary's editing verbs) is ported later
// INTO THIS FILE. `fitProjection` is already a public name of `Geo.swift`
// (the openers' shared geography), so map-plan's own two-way projection must
// be named differently when it lands here.
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
