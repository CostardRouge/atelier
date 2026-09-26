// «Virée» — the arithmetic. Port of `src/shared/roadtrip/hooks/drive-plan.ts`:
// a little car drives a paper map from stop to stop, pausing to show
// pictures; everything a frame needs is read off the plan `prepare` computes
// once. The variant is `DriveVariant.swift`, one frame's layout
// `DrivePaint.swift`.
//
// Three readings decide what the car may claim, each a refusal to say more
// than the document holds:
// - The stops are either the legs' LOCATED places or the pictures' own
//   positions. On places, the road is the trip so far — every leg up to the one
//   this day belongs to, in the order they were lived — and the car arrives at
//   the end of that leg: it marks the LEG, never a spot the dates cannot
//   justify. On pictures, a photo whose EXIF says where it was shot IS a stop,
//   in the order they were shot; one without a position rides along with the
//   stop before it, never on a spot of its own.
// - A picture is shown where the document can put it: with a position, at its
//   own stop or at the nearest place; without, at the end of the leg its day
//   belongs to. Anything that fits nowhere is left out and COUNTED
//   (`LeftOut`), never guessed onto the map.
// - The car's clock is closed-form: a list of phases (a hold, a run, a halt,
//   the arrival, the reveal) with start and end times; where the car is at `t`
//   is a function of `t` alone, so the preview, the export and the score
//   cannot drift.
//
// The path is measured in the projection's OWN units inside a fixed 1000-unit
// box, never in pixels, so every ratio is frame-free; the paint maps plan
// units to the frame through one similarity transform — the camera
// (`DriveView`) — which is what lets it follow the car without changing the
// route's shape.
//
// Names that differ from the web's, and why (one module holds every port):
// - the constants carry a `drive` prefix: `REVEAL_SECONDS` → `driveRevealSeconds`,
//   `MIN_RUN_SECONDS` → `driveMinRunSeconds`, `CARD_POP_SECONDS` →
//   `driveCardPopSeconds`, `CARD_FADE_SECONDS` → `driveCardFadeSeconds`,
//   `MERGE_KM` → `driveMergeKm`, `MAX_PICTURES_PER_STOP` →
//   `driveMaxPicturesPerStop`, `MAX_PICTURE_STOPS` → `driveMaxPictureStops`,
//   `PLAN_SIZE` → `drivePlanSize`, `KM_PER_DEGREE` → `driveKmPerDegree`
//   (`Gazetteer.swift` keeps a private `kmPerDegree`);
// - `View` → `DriveView` (SwiftUI's `View` is in every app file that imports
//   this kernel), `Phase` / `PhaseKind` → `DrivePhase` / `DrivePhaseKind`;
//   `PlanPoint` is `Geometry.swift`'s `Point`;
// - no projection is defined here: the drive plans on `Geo.swift`'s
//   `projectionFor`, so it has no `fitProjection` of its own to collide with
//   `MapPlan.swift`'s `fitMapProjection`.
//
// Pure: a stored options record is never trusted (`driveOptions` clamps every
// number read the way JavaScript's `Number()` reads it, drops an unknown word
// and an unpaintable colour), and the car itself — model, colour, finish,
// gear — is the TRIP's (`TripDoc.car`), never an option of a piece.

import Foundation

public enum DriveStopsOn: String, CaseIterable, Sendable {
    case places, pictures
}

public enum DriveGround: String, CaseIterable, Sendable {
    case paper, picture
}

public enum DrivePath: String, CaseIterable, Sendable {
    case curved, straight
}

public enum DriveAhead: String, CaseIterable, Sendable {
    case dashed, faint, hidden
}

/// Prints beside the car, the picture filling the frame, the picture BEHIND
/// the map, or nothing.
public enum DrivePictures: String, CaseIterable, Sendable {
    case cards, fill, backdrop, none
}

public enum DriveCamera: String, CaseIterable, Sendable {
    case whole, follow
}

public enum DriveEnd: String, CaseIterable, Sendable {
    case reveal, stay
}

public enum DriveLabels: String, CaseIterable, Sendable {
    case none, ends, all
}

public enum DrivePosition: String, CaseIterable, Sendable {
    case top, middle, bottom
}

public struct DriveOptions: Equatable, Sendable {
    // --- road ---
    public var stopsOn: DriveStopsOn
    /// The pictures the author picked — stops on `pictures`, shown at the places on `places`.
    public var picked: [HookPickedPicture]
    /// On `places`: the pictures of the days already told ride along, at the end of their leg.
    public var includePieces: Bool
    public var path: DrivePath
    public var ahead: DriveAhead
    /// The line the car leaves behind it.
    public var trail: Bool
    public var trailColor: String
    public var aheadColor: String
    public var lineWidth: Double
    // --- pictures ---
    public var pictures: DrivePictures
    /// How long the car halts for each picture.
    public var secondsPerPicture: Double
    /// Halt at a stop with no picture too.
    public var pauseEverywhere: Bool
    /// Leave the cards on the map once the car has gone.
    public var cardsStay: Bool
    public var cardSize: Double
    // --- car --- (the car itself is the trip's; a piece keeps how big it is
    // drawn and how the camera looks at it)
    public var carSize: Double
    /// The camera's elevation over the map, degrees; 90 looks straight down.
    public var tilt: Double
    // --- map ---
    public var ground: DriveGround
    public var paperColor: String
    public var inkColor: String
    public var graticule: Bool
    public var vignette: Bool
    public var position: DrivePosition
    public var size: Double
    public var dots: Bool
    public var labels: DriveLabels
    public var labelSize: Double
    public var compass: Bool
    public var scaleBar: Bool
    public var distance: DistanceUnit
    // --- motion ---
    public var driveSeconds: Double
    public var easing: HookEasing
    public var delaySeconds: Double
    public var arriveSeconds: Double
    public var end: DriveEnd
    public var camera: DriveCamera
    /// On `follow`: the share of the route's extent the view spans.
    public var followZoom: Double
    /// Rewrite the badge's place with the stop the car is at, on `places`.
    public var captionFollows: Bool
    // --- sound ---
    public var sound: Bool
    public var kit: TickKit
    public var tickPitch: Double
    public var tickVolume: Double
    /// A shutter click as each picture pops.
    public var shutter: Bool
    public var mixWithClip: Bool

    /// The web's `DRIVE_DEFAULTS`.
    public static let defaults = DriveOptions(
        stopsOn: .places, picked: [], includePieces: true, path: .curved, ahead: .dashed, trail: true,
        trailColor: "#d9442a", aheadColor: "#3a332a", lineWidth: 1,
        pictures: .cards, secondsPerPicture: 0.9, pauseEverywhere: false, cardsStay: true, cardSize: 1,
        carSize: 1, tilt: 58,
        ground: .paper, paperColor: "#e8e2d4", inkColor: "#3a332a", graticule: true, vignette: true,
        position: .middle, size: 1, dots: true, labels: .all, labelSize: 1, compass: true, scaleBar: true,
        distance: .km,
        driveSeconds: 4, easing: .easeInOut, delaySeconds: 0.4, arriveSeconds: 0.8, end: .reveal,
        camera: .whole, followZoom: 0.45, captionFollows: false,
        sound: true, kit: .wood, tickPitch: 1, tickVolume: 1, shutter: true, mixWithClip: false
    )

    /// Every option as the document holds it — the whole record, the way the
    /// web's reader hands it back and a panel writes it.
    public var json: HookOptions {
        var o: HookOptions = [:]
        o["stopsOn"] = .string(stopsOn.rawValue)
        o["picked"] = .array(picked.map(\.json))
        o["includePieces"] = .bool(includePieces)
        o["path"] = .string(path.rawValue)
        o["ahead"] = .string(ahead.rawValue)
        o["trail"] = .bool(trail)
        o["trailColor"] = .string(trailColor)
        o["aheadColor"] = .string(aheadColor)
        o["lineWidth"] = .number(lineWidth)
        o["pictures"] = .string(pictures.rawValue)
        o["secondsPerPicture"] = .number(secondsPerPicture)
        o["pauseEverywhere"] = .bool(pauseEverywhere)
        o["cardsStay"] = .bool(cardsStay)
        o["cardSize"] = .number(cardSize)
        o["carSize"] = .number(carSize)
        o["tilt"] = .number(tilt)
        o["ground"] = .string(ground.rawValue)
        o["paperColor"] = .string(paperColor)
        o["inkColor"] = .string(inkColor)
        o["graticule"] = .bool(graticule)
        o["vignette"] = .bool(vignette)
        o["position"] = .string(position.rawValue)
        o["size"] = .number(size)
        o["dots"] = .bool(dots)
        o["labels"] = .string(labels.rawValue)
        o["labelSize"] = .number(labelSize)
        o["compass"] = .bool(compass)
        o["scaleBar"] = .bool(scaleBar)
        o["distance"] = .string(distance.rawValue)
        o["driveSeconds"] = .number(driveSeconds)
        o["easing"] = .string(easing.rawValue)
        o["delaySeconds"] = .number(delaySeconds)
        o["arriveSeconds"] = .number(arriveSeconds)
        o["end"] = .string(end.rawValue)
        o["camera"] = .string(camera.rawValue)
        o["followZoom"] = .number(followZoom)
        o["captionFollows"] = .bool(captionFollows)
        o["sound"] = .bool(sound)
        o["kit"] = .string(kit.rawValue)
        o["tickPitch"] = .number(tickPitch)
        o["tickVolume"] = .number(tickVolume)
        o["shutter"] = .bool(shutter)
        o["mixWithClip"] = .bool(mixWithClip)
        return o
    }
}

/// The bounds each option is clamped to — a stored value is never trusted.
/// The web's `DRIVE_LIMITS`.
public struct DriveLimits: Sendable {
    public let lineWidth = (min: 0.5, max: 2.0)
    public let secondsPerPicture = (min: 0.3, max: 3.0)
    public let cardSize = (min: 0.5, max: 1.8)
    public let carSize = (min: 0.5, max: 2.0)
    public let tilt = (min: 35.0, max: 90.0)
    public let size = (min: 0.5, max: 1.2)
    public let labelSize = (min: 0.6, max: 1.6)
    public let driveSeconds = (min: 1.0, max: 12.0)
    public let delaySeconds = (min: 0.0, max: 2.0)
    public let arriveSeconds = (min: 0.0, max: 3.0)
    public let followZoom = (min: 0.15, max: 1.0)
    public let tickPitch = (min: 0.5, max: 2.0)
    public let tickVolume = (min: 0.0, max: 2.0)
}

public let driveLimits = DriveLimits()

/// How long the map takes to fade off the picture at the end, on `reveal`.
public let driveRevealSeconds = 0.7
/// The least a run between two halts may take, whatever its length.
public let driveMinRunSeconds = 0.35
/// A card's pop, and its fade when the cards do not stay.
public let driveCardPopSeconds = 0.32
public let driveCardFadeSeconds = 0.3
/// Two pictures shot within this distance are one stop.
public let driveMergeKm = 0.15
/// The most pictures a stop shows — past it the rest ride along unseen and are counted.
public let driveMaxPicturesPerStop = 6
/// The most stops a drive makes on pictures; past it the list is thinned evenly.
public let driveMaxPictureStops = 24

/// A stored options record, read through the defaults and clamped — the web's
/// `{ ...DRIVE_DEFAULTS, ...raw }`: a key the record holds, even as null, is read.
public func driveOptions(_ raw: HookOptions) -> DriveOptions {
    let d = DriveOptions.defaults
    let L = driveLimits
    func number(_ key: String, _ bounds: (min: Double, max: Double), _ fallback: Double) -> Double {
        let n = raw[key].map { JSLoose.number($0) } ?? fallback
        return n.isFinite ? min(bounds.max, max(bounds.min, n)) : fallback
    }
    func word<T: RawRepresentable>(_ key: String, _ fallback: T) -> T where T.RawValue == String {
        raw[key]?.stringValue.flatMap(T.init(rawValue:)) ?? fallback
    }
    /// `/^#[0-9a-f]{6}$/i`, lower-cased; anything else falls back.
    func hex(_ key: String, _ fallback: String) -> String {
        guard let s = raw[key]?.stringValue else { return fallback }
        let bytes = Array(s.utf8)
        guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return fallback }
        for b in bytes[1...] {
            let digit = (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)
            if !digit { return fallback }
        }
        return s.lowercased()
    }
    /// `o.key !== false`: only a stored `false` turns it off.
    func notFalse(_ key: String) -> Bool { raw[key] != .bool(false) }
    /// `o.key === true`: only a stored `true` turns it on.
    func isTrue(_ key: String) -> Bool { raw[key] == .bool(true) }

    return DriveOptions(
        stopsOn: word("stopsOn", d.stopsOn),
        picked: readPicked(raw["picked"]),
        includePieces: notFalse("includePieces"),
        path: word("path", d.path),
        ahead: word("ahead", d.ahead),
        trail: notFalse("trail"),
        trailColor: hex("trailColor", d.trailColor),
        aheadColor: hex("aheadColor", d.aheadColor),
        lineWidth: number("lineWidth", L.lineWidth, d.lineWidth),
        pictures: word("pictures", d.pictures),
        secondsPerPicture: number("secondsPerPicture", L.secondsPerPicture, d.secondsPerPicture),
        pauseEverywhere: isTrue("pauseEverywhere"),
        cardsStay: notFalse("cardsStay"),
        cardSize: number("cardSize", L.cardSize, d.cardSize),
        carSize: number("carSize", L.carSize, d.carSize),
        tilt: number("tilt", L.tilt, d.tilt),
        ground: word("ground", d.ground),
        paperColor: hex("paperColor", d.paperColor),
        inkColor: hex("inkColor", d.inkColor),
        graticule: notFalse("graticule"),
        vignette: notFalse("vignette"),
        position: word("position", d.position),
        size: number("size", L.size, d.size),
        dots: notFalse("dots"),
        labels: word("labels", d.labels),
        labelSize: number("labelSize", L.labelSize, d.labelSize),
        compass: notFalse("compass"),
        scaleBar: notFalse("scaleBar"),
        distance: word("distance", d.distance),
        driveSeconds: number("driveSeconds", L.driveSeconds, d.driveSeconds),
        easing: word("easing", d.easing),
        delaySeconds: number("delaySeconds", L.delaySeconds, d.delaySeconds),
        arriveSeconds: number("arriveSeconds", L.arriveSeconds, d.arriveSeconds),
        end: word("end", d.end),
        camera: word("camera", d.camera),
        followZoom: number("followZoom", L.followZoom, d.followZoom),
        captionFollows: isTrue("captionFollows"),
        sound: notFalse("sound"),
        kit: word("kit", d.kit),
        tickPitch: number("tickPitch", L.tickPitch, d.tickPitch),
        tickVolume: number("tickVolume", L.tickVolume, d.tickVolume),
        shutter: notFalse("shutter"),
        mixWithClip: isTrue("mixWithClip")
    )
}

// MARK: - the stops

/// A picture shown at a stop: what to draw it by, and where its frame is taken on a clip.
public struct StopPicture: Equatable, Sendable {
    public var key: String
    public var want: HookPictureWant

    public init(key: String, want: HookPictureWant) {
        self.key = key; self.want = want
    }
}

public enum DriveStopKind: String, Sendable {
    case place, picture
}

public struct DriveStop: GeoLocated, Equatable, Sendable {
    public var lat: Double
    public var lon: Double
    /// The place's own name, or `Day N` for a picture stop — never invented.
    public var name: String
    public var kind: DriveStopKind
    /// 0-based leg index on `places`; nil for a picture stop.
    public var leg: Int?
    /// The first stop of a leg (places), or of a day (pictures): the deeper tick.
    public var accent: Bool
    public var pictures: [StopPicture]

    public init(lat: Double, lon: Double, name: String, kind: DriveStopKind, leg: Int?, accent: Bool,
                pictures: [StopPicture] = []) {
        self.lat = lat; self.lon = lon; self.name = name; self.kind = kind; self.leg = leg
        self.accent = accent; self.pictures = pictures
    }
}

/// Why a picture is not on the map, for the panel to say.
public struct LeftOut: Equatable, Sendable {
    /// Shot after this piece's day.
    public var after: Int
    /// Shot outside the trip.
    public var outside: Int
    /// On `pictures`: no position, and no stop to ride along with.
    public var unlocated: Int
    /// On `places`: no position and no driven leg covers its day.
    public var homeless: Int
    /// Past the most a stop shows.
    public var crowded: Int

    public init(after: Int = 0, outside: Int = 0, unlocated: Int = 0, homeless: Int = 0, crowded: Int = 0) {
        self.after = after; self.outside = outside; self.unlocated = unlocated; self.homeless = homeless
        self.crowded = crowded
    }
}

public struct DriveRoute: Equatable, Sendable {
    public var stops: [DriveStop]
    public var leftOut: LeftOut
    /// 1-based, the leg this day belongs to — `places` only.
    public var currentLeg: Int?
    /// Every stop carries a name worth drawing.
    public var named: Bool

    public init(stops: [DriveStop], leftOut: LeftOut, currentLeg: Int?, named: Bool) {
        self.stops = stops; self.leftOut = leftOut; self.currentLeg = currentLeg; self.named = named
    }
}

private func driveSameSpot<A: GeoLocated, B: GeoLocated>(_ a: A, _ b: B) -> Bool {
    abs(a.lat - b.lat) < 1e-6 && abs(a.lon - b.lon) < 1e-6
}

/// A picture as a stop shows it; a clip's frame second only when it is one
/// (the web's truthy `atSeconds`: never 0, never NaN).
private func driveWantOf(_ ref: SavedMediaRef, atSeconds: Double? = nil) -> StopPicture {
    let key = hookPictureKey(ref)
    var want = HookPictureWant(key: key, ref: ref)
    if let at = atSeconds, at != 0, !at.isNaN { want.atSeconds = at }
    return StopPicture(key: key, want: want)
}

/// The stops on the legs' places: the trip so far, ending where this day's leg ends.
private func drivePlaceStops(_ stages: [HookStage], _ calendar: [HookDay], _ date: IsoDate,
                             _ o: DriveOptions) -> DriveRoute {
    let current = currentLegIndex(stages, date)
    let driven: [(stage: HookStage, index: Int)] = current.map { c in
        Array(stages.prefix(c + 1).enumerated().map { ($0.element, $0.offset) })
    } ?? stages.enumerated().map { ($0.element, $0.offset) }
    let currentLeg = current.map { $0 + 1 }

    var stops: [DriveStop] = []
    for (stage, index) in driven {
        var first = true
        for place in stage.places {
            if let previous = stops.last, driveSameSpot(previous, place) {
                first = false
                continue
            }
            stops.append(DriveStop(lat: place.lat, lon: place.lon,
                                   name: place.name.trimmingCharacters(in: .whitespacesAndNewlines),
                                   kind: .place, leg: index, accent: first))
            first = false
        }
    }
    var leftOut = LeftOut()
    if stops.isEmpty { return DriveRoute(stops: stops, leftOut: leftOut, currentLeg: currentLeg, named: true) }

    // The last stop of each driven leg — where a picture with only a date lands.
    var legEnd: [Int: Int] = [:]
    for (i, stop) in stops.enumerated() {
        if let leg = stop.leg { legEnd[leg] = i }
    }
    func legOfDay(_ day: IsoDate) -> Int? {
        var found: Int? = nil
        for (stage, index) in driven where stage.startDate <= day && day <= stage.endDate { found = index }
        return found
    }
    func nearest(_ p: GeoPoint) -> Int {
        var best = 0
        var bestKm = Double.infinity
        for (i, stop) in stops.enumerated() {
            let km = haversineKm(stop, p)
            if km < bestKm {
                bestKm = km
                best = i
            }
        }
        return best
    }
    func place(_ ref: SavedMediaRef, date day: IsoDate, coords: GeoPoint?, atSeconds: Double? = nil) {
        if let coords {
            let at = nearest(coords)
            stops[at].pictures.append(driveWantOf(ref, atSeconds: atSeconds))
            return
        }
        guard let leg = legOfDay(day), let end = legEnd[leg] else {
            leftOut.homeless += 1
            return
        }
        stops[end].pictures.append(driveWantOf(ref, atSeconds: atSeconds))
    }

    if o.pictures != .none {
        let split = partitionPicked(calendar, date, o.picked)
        leftOut.after = split.after
        leftOut.outside = split.outside
        for picture in split.inReach { place(picture.ref, date: picture.date, coords: picture.coords) }

        if o.includePieces {
            let heroIndex = calendar.firstIndex { $0.date == date }
            let picked = Set(o.picked.map { hookPictureKey($0.ref) })
            let before = heroIndex.map { Array(calendar.prefix($0)) } ?? calendar
            for day in before where day.told {
                guard let piece = standingPiece(day), let media = piece.media,
                      !picked.contains(hookPictureKey(media)) else { continue }
                place(media, date: day.date, coords: nil, atSeconds: piece.videoSeconds)
            }
        }
    }
    driveCrowd(&stops, &leftOut)
    return DriveRoute(stops: stops, leftOut: leftOut, currentLeg: currentLeg,
                      named: stops.contains { !$0.name.isEmpty })
}

/// The stops on the pictures' own positions, in the order they were shot.
private func drivePictureStops(_ calendar: [HookDay], _ date: IsoDate, _ o: DriveOptions) -> DriveRoute {
    var leftOut = LeftOut()
    let split = partitionPicked(calendar, date, o.picked)
    leftOut.after = split.after
    leftOut.outside = split.outside
    var dayNumber: [IsoDate: Int] = [:]
    for day in calendar { dayNumber[day.date] = day.dayNumber }

    // Located pictures become stops, a run within `driveMergeKm` of the last
    // one joining it; the rest ride with the stop shot just before them.
    var stops: [DriveStop] = []
    var orphansBeforeFirst: [HookPickedPicture] = []
    var lastDate = ""
    for picture in split.inReach {
        guard let coords = picture.coords else {
            if stops.isEmpty {
                orphansBeforeFirst.append(picture)
            } else {
                stops[stops.count - 1].pictures.append(driveWantOf(picture.ref))
            }
            continue
        }
        if let last = stops.last, haversineKm(last, coords) <= driveMergeKm {
            stops[stops.count - 1].pictures.append(driveWantOf(picture.ref))
            continue
        }
        let first = picture.date != lastDate
        lastDate = picture.date
        let name = dayNumber[picture.date].map { "Day \($0)" } ?? ""
        stops.append(DriveStop(lat: coords.lat, lon: coords.lon, name: name, kind: .picture, leg: nil,
                               accent: first, pictures: [driveWantOf(picture.ref)]))
    }
    if stops.isEmpty {
        leftOut.unlocated = orphansBeforeFirst.count
    } else {
        stops[0].pictures.insert(contentsOf: orphansBeforeFirst.map { driveWantOf($0.ref) }, at: 0)
    }
    var kept = sampleEvenly(stops, driveMaxPictureStops)
    if o.pictures == .none {
        for i in kept.indices { kept[i].pictures = [] }
    }
    driveCrowd(&kept, &leftOut)
    return DriveRoute(stops: kept, leftOut: leftOut, currentLeg: nil, named: kept.contains { !$0.name.isEmpty })
}

/// Trim each stop to what it can show, counting the rest.
private func driveCrowd(_ stops: inout [DriveStop], _ leftOut: inout LeftOut) {
    for i in stops.indices {
        // One picture once per stop.
        var seen = Set<String>()
        stops[i].pictures = stops[i].pictures.filter { seen.insert($0.key).inserted }
        if stops[i].pictures.count > driveMaxPicturesPerStop {
            leftOut.crowded += stops[i].pictures.count - driveMaxPicturesPerStop
            stops[i].pictures = Array(stops[i].pictures.prefix(driveMaxPicturesPerStop))
        }
    }
}

/// The route for a piece: its stops, and what could not be placed.
public func driveRoute(_ stages: [HookStage], _ calendar: [HookDay], _ date: IsoDate, _ o: DriveOptions) -> DriveRoute {
    o.stopsOn == .pictures ? drivePictureStops(calendar, date, o) : drivePlaceStops(stages, calendar, date, o)
}

/// The pictures a route draws, once each, in the shape the style wants.
public func driveWants(_ route: DriveRoute, _ o: DriveOptions) -> [HookPictureWant] {
    if o.pictures == .none { return [] }
    var seen = Set<String>()
    var out: [HookPictureWant] = []
    for stop in route.stops {
        for picture in stop.pictures where seen.insert(picture.key).inserted {
            var want = picture.want
            want.shape = o.pictures == .cards ? .own : .frame
            out.append(want)
        }
    }
    return out
}

// MARK: - the path

public struct RoadPath: Equatable, Sendable {
    /// The sampled path, in plan units.
    public var points: [Point]
    /// Arc length at each point.
    public var cum: [Double]
    public var length: Double
    /// Arc length at each stop.
    public var stopS: [Double]

    public init(points: [Point], cum: [Double], length: Double, stopS: [Double]) {
        self.points = points; self.cum = cum; self.length = length; self.stopS = stopS
    }
}

/// The plan's box: the projection fits the stops into this many units.
public let drivePlanSize = 1000.0
private let driveSamplesPerSegment = 24

/// The stops in plan units, and the projection that put them there.
public func planPoints<P: GeoLocated>(_ stops: [P]) -> (points: [Point], geo: Projection) {
    let geo = projectionFor(stops, drivePlanSize, drivePlanSize)
    return (stops.map { geo.at($0, drivePlanSize / 2, drivePlanSize / 2) }, geo)
}

/// The path through the stops: a centripetal Catmull-Rom spline (it passes
/// through every stop, never loops, and its tangent is continuous — a road)
/// or the bare polyline. Sampled, then measured, so any later question is a
/// lookup by arc length.
public func buildPath(_ points: [Point], _ path: DrivePath) -> RoadPath {
    if points.isEmpty { return RoadPath(points: [], cum: [], length: 0, stopS: []) }
    if points.count == 1 { return RoadPath(points: [points[0]], cum: [0], length: 0, stopS: [0]) }

    var sampled: [Point] = []
    var stopIndex: [Int] = []
    let n = points.count
    for i in 0..<(n - 1) {
        stopIndex.append(sampled.count)
        if path == .straight {
            sampled.append(points[i])
            continue
        }
        let p0 = points[max(0, i - 1)]
        let p1 = points[i]
        let p2 = points[i + 1]
        let p3 = points[min(n - 1, i + 2)]
        for k in 0..<driveSamplesPerSegment {
            sampled.append(catmullRom(p0, p1, p2, p3, Double(k) / Double(driveSamplesPerSegment)))
        }
    }
    stopIndex.append(sampled.count)
    sampled.append(points[n - 1])

    var cum = [0.0]
    for i in 1..<sampled.count {
        let step = hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y)
        cum.append(cum[i - 1] + step)
    }
    return RoadPath(points: sampled, cum: cum, length: cum[cum.count - 1], stopS: stopIndex.map { cum[$0] })
}

/// Centripetal Catmull-Rom between p1 and p2 at `t` in 0..1.
public func catmullRom(_ p0: Point, _ p1: Point, _ p2: Point, _ p3: Point, _ t: Double) -> Point {
    // `prev + Math.sqrt(Math.hypot(…)) || prev + 1e-6`: only a zero (or NaN)
    // knot is nudged, so a first segment starting on its own ghost point moves.
    func knot(_ a: Point, _ b: Point, _ prev: Double) -> Double {
        let v = prev + hypot(b.x - a.x, b.y - a.y).squareRoot()
        return (v == 0 || v.isNaN) ? prev + 1e-6 : v
    }
    let t0 = 0.0
    let t1 = knot(p0, p1, t0)
    let t2 = knot(p1, p2, t1)
    let t3 = knot(p2, p3, t2)
    let u = t1 + (t2 - t1) * t
    func blend(_ a: Point, _ b: Point, _ ta: Double, _ tb: Double) -> Point {
        let w = tb - ta == 0 ? 0 : (u - ta) / (tb - ta)
        return Point(a.x + (b.x - a.x) * w, a.y + (b.y - a.y) * w)
    }
    let a1 = blend(p0, p1, t0, t1)
    let a2 = blend(p1, p2, t1, t2)
    let a3 = blend(p2, p3, t2, t3)
    let b1 = blend(a1, a2, t0, t2)
    let b2 = blend(a2, a3, t1, t3)
    return blend(b1, b2, t1, t2)
}

/// The point at arc length `s`, and the index of the sample before it.
public func pointAt(_ path: RoadPath, _ s: Double) -> (point: Point, index: Int) {
    let points = path.points
    let cum = path.cum
    if points.isEmpty { return (Point(drivePlanSize / 2, drivePlanSize / 2), 0) }
    if points.count == 1 || s <= 0 { return (points[0], 0) }
    if s >= path.length { return (points[points.count - 1], points.count - 2) }
    // Binary search for the sample before `s`.
    var lo = 0
    var hi = cum.count - 1
    while hi - lo > 1 {
        let mid = (lo + hi) >> 1
        if cum[mid] <= s { lo = mid } else { hi = mid }
    }
    let span = cum[hi] - cum[lo]
    let w = span > 0 ? (s - cum[lo]) / span : 0
    let x = points[lo].x + (points[hi].x - points[lo].x) * w
    let y = points[lo].y + (points[hi].y - points[lo].y) * w
    return (Point(x, y), lo)
}

/// The unit direction of travel at `s`, blended across a corner so the car
/// turns rather than snaps. `blend` defaults to 3 % of the path's length.
public func headingAt(_ path: RoadPath, _ s: Double, _ blend: Double? = nil) -> Point {
    let points = path.points
    let cum = path.cum
    if points.count < 2 { return Point(0, -1) }
    let blend = blend ?? path.length * 0.03
    func dir(_ i: Int) -> Point {
        let a = points[max(0, min(points.count - 2, i))]
        let b = points[max(1, min(points.count - 1, i + 1))]
        let len = hypot(b.x - a.x, b.y - a.y)
        return len > 0 ? Point((b.x - a.x) / len, (b.y - a.y) / len) : Point(0, -1)
    }
    let index = pointAt(path, s).index
    let here = dir(index)
    if blend <= 0 { return here }
    // Nearer than `blend` to the sample's far end: lean toward the next direction.
    let toNext = cum[min(cum.count - 1, index + 1)] - s
    let fromPrev = s - cum[index]
    var mix = here
    if index + 1 < points.count - 1 && toNext < blend {
        let next = dir(index + 1)
        let w = 0.5 * (1 - toNext / blend)
        mix = Point(here.x * (1 - w) + next.x * w, here.y * (1 - w) + next.y * w)
    } else if index > 0 && fromPrev < blend {
        let prev = dir(index - 1)
        let w = 0.5 * (1 - fromPrev / blend)
        mix = Point(here.x * (1 - w) + prev.x * w, here.y * (1 - w) + prev.y * w)
    }
    let len = hypot(mix.x, mix.y)
    return len > 1e-6 ? Point(mix.x / len, mix.y / len) : here
}

// MARK: - the schedule

public enum DrivePhaseKind: String, Sendable {
    case hold, run, halt, arrive, reveal
}

public struct DrivePhase: Equatable, Sendable {
    public var kind: DrivePhaseKind
    public var start: Double
    public var end: Double
    /// For a run: the arc lengths it covers.
    public var s0: Double
    public var s1: Double
    /// For a hold, a halt or the arrival: the stop the car sits at.
    public var stop: Int

    public init(kind: DrivePhaseKind, start: Double, end: Double, s0: Double, s1: Double, stop: Int) {
        self.kind = kind; self.start = start; self.end = end; self.s0 = s0; self.s1 = s1; self.stop = stop
    }
}

public struct PicturePop: Equatable, Sendable {
    public var key: String
    public var stop: Int
    /// Its rank among the stop's pictures.
    public var rank: Int
    /// When it pops, and when the car leaves the stop.
    public var at: Double
    public var leaves: Double

    public init(key: String, stop: Int, rank: Int, at: Double, leaves: Double) {
        self.key = key; self.stop = stop; self.rank = rank; self.at = at; self.leaves = leaves
    }
}

public struct DriveSchedule: Equatable, Sendable {
    public var phases: [DrivePhase]
    public var pops: [PicturePop]
    /// When the car reaches each stop; the first at 0.
    public var arrivals: [Double]
    /// The whole opener, reveal included.
    public var total: Double
    /// When the car has reached the last stop.
    public var arrivedAt: Double
    /// When the reveal starts (= total when there is none).
    public var revealAt: Double

    public init(phases: [DrivePhase], pops: [PicturePop], arrivals: [Double], total: Double, arrivedAt: Double,
                revealAt: Double) {
        self.phases = phases; self.pops = pops; self.arrivals = arrivals; self.total = total
        self.arrivedAt = arrivedAt; self.revealAt = revealAt
    }
}

/// Whether the car halts at a stop under the options.
public func haltsAt(_ stop: DriveStop, _ o: DriveOptions) -> Bool {
    o.pauseEverywhere || (o.pictures != .none && !stop.pictures.isEmpty)
}

/// How long the car halts at a stop: a beat per picture, one beat with none when asked.
public func haltSeconds(_ stop: DriveStop, _ o: DriveOptions) -> Double {
    let shown = o.pictures == .none ? 0 : stop.pictures.count
    if shown > 0 { return Double(shown) * o.secondsPerPicture }
    return o.pauseEverywhere ? o.secondsPerPicture : 0
}

/// The curve and its inverse — every opener id has both (`HookEasing.swift`).
private func driveEase(_ easing: HookEasing, _ u: Double) -> Double {
    hookEasings[easing]?.ease(u) ?? u
}

private func driveInverse(_ easing: HookEasing, _ p: Double) -> Double {
    hookEasings[easing]?.inverse(p) ?? p
}

public func buildSchedule(_ stops: [DriveStop], _ path: RoadPath, _ o: DriveOptions) -> DriveSchedule {
    var phases: [DrivePhase] = []
    var pops: [PicturePop] = []
    var arrivals: [Double] = []
    var t = 0.0
    let n = stops.count
    if n == 0 { return DriveSchedule(phases: [], pops: [], arrivals: [], total: 0, arrivedAt: 0, revealAt: 0) }

    func addPops(_ stop: Int, _ start: Double, _ leaves: Double) {
        if o.pictures == .none { return }
        for (rank, picture) in stops[stop].pictures.enumerated() {
            pops.append(PicturePop(key: picture.key, stop: stop, rank: rank,
                                   at: start + Double(rank) * o.secondsPerPicture, leaves: leaves))
        }
    }

    // The hold on the first stop, then its own halt.
    arrivals.append(0)
    if o.delaySeconds > 0 {
        phases.append(DrivePhase(kind: .hold, start: t, end: t + o.delaySeconds, s0: 0, s1: 0, stop: 0))
        t += o.delaySeconds
    }
    let firstHalt = haltSeconds(stops[0], o)
    if firstHalt > 0 && n > 1 {
        phases.append(DrivePhase(kind: .halt, start: t, end: t + firstHalt, s0: 0, s1: 0, stop: 0))
        addPops(0, t, t + firstHalt)
        t += firstHalt
    }

    // Runs between halting stops, each taking its share of the driving time.
    var runs: [(from: Int, to: Int)] = []
    var from = 0
    if n > 1 {
        for i in 1..<n where i == n - 1 || haltsAt(stops[i], o) {
            runs.append((from, i))
            from = i
        }
    }
    let drivable = path.length
    for run in runs {
        let s0 = path.stopS[run.from]
        let s1 = path.stopS[run.to]
        let share = drivable > 0 ? (s1 - s0) / drivable : 1 / Double(runs.count)
        let seconds = max(driveMinRunSeconds, o.driveSeconds * share)
        let start = t
        phases.append(DrivePhase(kind: .run, start: t, end: t + seconds, s0: s0, s1: s1, stop: run.to))
        t += seconds
        // Every stop passed on the run is reached when the car crosses it.
        for i in (run.from + 1)...run.to {
            let passed = s1 > s0 ? (path.stopS[i] - s0) / (s1 - s0) : 1
            arrivals.append(start + seconds * driveInverse(o.easing, min(1, passed)))
        }
        if run.to < n - 1 {
            let halt = haltSeconds(stops[run.to], o)
            phases.append(DrivePhase(kind: .halt, start: t, end: t + halt, s0: s1, s1: s1, stop: run.to))
            addPops(run.to, t, t + halt)
            t += halt
        }
    }

    // The arrival: the last stop's pictures, then a beat at rest.
    let arrivedAt = t
    let lastHalt = n > 1 ? haltSeconds(stops[n - 1], o) : haltSeconds(stops[0], o)
    let arrive = lastHalt + o.arriveSeconds
    let lastStop = n - 1
    phases.append(DrivePhase(kind: .arrive, start: t, end: t + arrive, s0: path.length, s1: path.length, stop: lastStop))
    addPops(lastStop, t, t + arrive)
    t += arrive

    let revealAt = t
    if o.end == .reveal {
        phases.append(DrivePhase(kind: .reveal, start: t, end: t + driveRevealSeconds, s0: path.length,
                                 s1: path.length, stop: lastStop))
        t += driveRevealSeconds
    }
    return DriveSchedule(phases: phases, pops: pops, arrivals: arrivals, total: t, arrivedAt: arrivedAt,
                         revealAt: revealAt)
}

// MARK: - reading the plan at a moment

public struct DriveMoment: Equatable, Sendable {
    /// Arc length along the path.
    public var s: Double
    public var point: Point
    /// The unit direction of travel.
    public var heading: Point
    public var phase: DrivePhaseKind
    /// The stop the car sits at, or nil while running.
    public var at: Int?
    /// The last stop the car reached.
    public var reached: Int
    /// 0..1 through the whole path.
    public var progress: Double
    /// The map's presence, 1 until the reveal fades it.
    public var mapAlpha: Double
    /// Past the end: the car rests, the map stays or is gone.
    public var over: Bool
    /// Seconds since the current phase began — a ripple as the car halts.
    public var since: Double
}

/// A drive, planned once: the route, the path, the schedule and the readings
/// every follower takes of them — the car, the cards, the caption and the score.
public struct DrivePlan: Equatable, Sendable {
    public let route: DriveRoute
    public let points: [Point]
    public let geo: Projection
    public let path: RoadPath
    public let schedule: DriveSchedule
    /// Kilometres along the stops, cumulative.
    public let kmAtStop: [Double]
    public let seconds: Double
    /// The options the plan was made under — what `at` and `showing` read.
    public let options: DriveOptions

    /// A picture showing at a moment, with its pop progress and its fade.
    public struct Showing: Equatable, Sendable {
        public var pop: PicturePop
        public var rise: Double
        public var fade: Double
    }

    /// Where the car is at `t`, and what it is doing.
    public func at(_ t: Double) -> DriveMoment {
        let o = options
        let phases = schedule.phases
        let over = t >= schedule.total
        let phase = phases.first { t < $0.end } ?? phases[phases.count - 1]
        var s: Double
        var atStop: Int?
        if phase.kind == .run {
            let u = max(0, min(1, (t - phase.start) / (phase.end - phase.start)))
            s = phase.s0 + (phase.s1 - phase.s0) * driveEase(o.easing, u)
            atStop = nil
        } else {
            s = phase.s0
            atStop = phase.stop
        }
        if over {
            s = path.length
            atStop = route.stops.count - 1
        }
        var reached = 0
        for (i, stopS) in path.stopS.enumerated() where stopS <= s + 1e-9 { reached = i }
        let mapAlpha = o.end == .reveal && t >= schedule.revealAt
            ? max(0, 1 - (t - schedule.revealAt) / driveRevealSeconds)
            : 1
        return DriveMoment(
            s: s,
            point: pointAt(path, s).point,
            heading: headingAt(path, s),
            phase: over ? (o.end == .reveal ? .reveal : .arrive) : phase.kind,
            at: atStop,
            reached: reached,
            progress: path.length > 0 ? s / path.length : 1,
            mapAlpha: mapAlpha,
            over: over,
            since: over ? t - schedule.total : t - phase.start
        )
    }

    /// Kilometres the car has covered by `s`.
    public func kmAt(_ s: Double) -> Double {
        let stopS = path.stopS
        if stopS.count < 2 { return 0 }
        for i in 1..<stopS.count where s <= stopS[i] {
            let span = stopS[i] - stopS[i - 1]
            let w = span > 0 ? (s - stopS[i - 1]) / span : 1
            return kmAtStop[i - 1] + (kmAtStop[i] - kmAtStop[i - 1]) * max(0, min(1, w))
        }
        return kmAtStop[kmAtStop.count - 1]
    }

    /// The pictures showing at `t`, each with its pop progress and its fade.
    public func showing(_ t: Double) -> [Showing] {
        var out: [Showing] = []
        for pop in schedule.pops where t >= pop.at {
            let rise = min(1, (t - pop.at) / driveCardPopSeconds)
            var fade = 1.0
            if !options.cardsStay && t >= pop.leaves {
                fade = max(0, 1 - (t - pop.leaves) / driveCardFadeSeconds)
                if fade <= 0 { continue }
            }
            out.append(Showing(pop: pop, rise: rise, fade: fade))
        }
        return out
    }
}

/// Plan a drive. Nil when there is nothing to drive between and nothing to show.
public func drivePlan(_ route: DriveRoute, _ o: DriveOptions) -> DrivePlan? {
    let stops = route.stops
    if stops.isEmpty { return nil }
    let hasPictures = o.pictures != .none && stops.contains { !$0.pictures.isEmpty }
    if stops.count < 2 && !hasPictures { return nil }

    let (points, geo) = planPoints(stops)
    let path = buildPath(points, o.path)
    let schedule = buildSchedule(stops, path, o)
    var kmAtStop = [0.0]
    for i in stops.indices.dropFirst() { kmAtStop.append(kmAtStop[i - 1] + haversineKm(stops[i - 1], stops[i])) }
    return DrivePlan(route: route, points: points, geo: geo, path: path, schedule: schedule, kmAtStop: kmAtStop,
                     seconds: schedule.total, options: o)
}

// MARK: - the camera

/// A similarity transform from plan units to the frame. The web's `View`.
public struct DriveView: Equatable, Sendable {
    public var scale: Double
    public var tx: Double
    public var ty: Double

    public init(scale: Double, tx: Double, ty: Double) {
        self.scale = scale; self.tx = tx; self.ty = ty
    }
}

public func applyView(_ view: DriveView, _ p: Point) -> Point {
    Point(p.x * view.scale + view.tx, p.y * view.scale + view.ty)
}

/// The plan's bounding box, over the path and the stops.
public func planBounds(_ plan: DrivePlan) -> (x0: Double, y0: Double, x1: Double, y1: Double) {
    let pts = plan.path.points.isEmpty ? plan.points : plan.path.points
    guard !pts.isEmpty else {
        let c = drivePlanSize / 2
        return (c, c, c, c)
    }
    var x0 = Double.infinity, y0 = Double.infinity
    var x1 = -Double.infinity, y1 = -Double.infinity
    for p in pts {
        x0 = min(x0, p.x)
        y0 = min(y0, p.y)
        x1 = max(x1, p.x)
        y1 = max(y1, p.y)
    }
    return (x0, y0, x1, y1)
}

/// The view for a moment: the whole route fitted inside `box` with `margin`
/// pixels kept clear for the car and the cards, or that scale zoomed in by the
/// follow share with the car held at the box's centre.
public func viewAt(_ plan: DrivePlan, _ box: Rect, _ margin: Double,
                   _ o: (camera: DriveCamera, followZoom: Double), _ moment: DriveMoment) -> DriveView {
    let b = planBounds(plan)
    let w = max(1e-6, b.x1 - b.x0)
    let h = max(1e-6, b.y1 - b.y0)
    let roomW = max(1, box.width - 2 * margin)
    let roomH = max(1, box.height - 2 * margin)
    let whole = w < 1e-3 && h < 1e-3 ? 1 : min(roomW / w, roomH / h)
    let cx = box.x + box.width / 2
    let cy = box.y + box.height / 2
    if o.camera == .follow {
        let scale = whole / o.followZoom
        return DriveView(scale: scale, tx: cx - moment.point.x * scale, ty: cy - moment.point.y * scale)
    }
    let midX = (b.x0 + b.x1) / 2
    let midY = (b.y0 + b.y1) / 2
    return DriveView(scale: whole, tx: cx - midX * whole, ty: cy - midY * whole)
}

// MARK: - the map's furniture

private let driveDegreeSteps: [Double] = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 45]

/// The graticule's step in degrees: the smallest that keeps lines `minPx` apart.
public func graticuleStep(_ pxPerDegree: Double, _ minPx: Double) -> Double {
    for step in driveDegreeSteps where step * pxPerDegree >= minPx { return step }
    return driveDegreeSteps[driveDegreeSteps.count - 1]
}

private let driveKmSteps: [Double] = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
/// Kilometres per degree of latitude.
public let driveKmPerDegree = 111.32

/// A scale bar: a round length, how long it is drawn, and what it says.
public struct DriveScaleBar: Equatable, Sendable {
    public var value: Double
    public var px: Double
    public var label: String
}

/// A scale bar: the longest round length that fits in `maxPx`, in km or miles
/// (any unit but `.mi` reads kilometres).
public func scaleBar(_ pxPerDegreeLat: Double, _ maxPx: Double, _ unit: DistanceUnit) -> DriveScaleBar {
    let miles = unit == .mi
    let perKm = pxPerDegreeLat / driveKmPerDegree
    let perUnit = miles ? perKm * 1.609344 : perKm
    var chosen = driveKmSteps[0]
    for step in driveKmSteps where step * perUnit <= maxPx { chosen = step }
    let px = chosen * perUnit
    let word = miles ? "mi" : "km"
    if chosen < 1 {
        let label = miles ? "\(TripJS.number(TripJS.round(chosen * 1760))) yd" : "\(TripJS.number(chosen * 1000)) m"
        return DriveScaleBar(value: chosen, px: px, label: label)
    }
    return DriveScaleBar(value: chosen, px: px, label: "\(TripJS.number(chosen)) \(word)")
}

/// Which stops carry a name under `labels`.
public func wantsStopLabel(_ labels: DriveLabels, _ index: Int, _ count: Int) -> Bool {
    if labels == .none || count == 0 { return false }
    if labels == .all { return true }
    return index == 0 || index == count - 1
}

/// A small seeded jitter in -1..1, stable per key — a card's tilt. FNV-1a over
/// the key's UTF-16 units, as the web's `Math.imul` loop.
public func jitter(_ key: String, _ salt: Int = 0) -> Double {
    var h = UInt32(2_166_136_261) ^ UInt32(truncatingIfNeeded: salt)
    for unit in key.utf16 {
        h ^= UInt32(unit)
        h = h &* 16_777_619
    }
    return Double(h % 2000) / 1000 - 1
}

/// Where a card sits beside its stop, and how it is turned.
public struct DriveCardPlacement: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var angle: Double
}

/// Where a card sits beside its stop, in the frame: a PILE above and to one
/// side of the stop — each later print a little further up, across and turned,
/// the way prints land on a table — so a stop's pictures cover one patch of
/// the map and not the road. The side alternates from stop to stop
/// (`stopIndex`), the tilt is seeded by the key so a frame never differs from
/// the last, and the pile is kept inside the frame by clamping. All in pixels;
/// the paint decides the sizes.
public func cardPlacement(_ stop: Point, _ rank: Int, _ key: String, _ card: Size, _ frame: Size, _ lift: Double,
                          _ stopIndex: Int = 0) -> DriveCardPlacement {
    let side: Double = stopIndex % 2 == 0 ? 1 : -1
    let r = Double(rank)
    let step = min(card.width, card.height) * 0.09
    let jx = jitter(key) * card.width * 0.04
    let jy = jitter(key, 7) * card.height * 0.04
    let x = stop.x + side * (card.width * 0.58 + lift * 0.3) + r * step * side + jx
    let y = stop.y - lift * 0.6 - card.height * 0.55 - r * step + jy
    let angle = side * 0.07 + r * 0.06 * side + jitter(key, 3) * 0.07
    let pad = 8.0
    let half = hypot(card.width, card.height) / 2
    return DriveCardPlacement(
        x: max(pad + half, min(frame.width - pad - half, x)),
        y: max(pad + half, min(frame.height - pad - half, y)),
        angle: angle
    )
}

// MARK: - the score

/// The drive, heard: the kit's landing at every stop the car reaches, its leg
/// voice on an accented stop (a leg's first place, a day's first picture), the
/// seat when the car arrives — and, when asked, a shutter as each picture
/// pops. Nothing at volume 0.
public func driveScore(_ plan: DrivePlan, _ o: DriveOptions) -> [SoundEvent] {
    if !(o.tickVolume > 0) { return [] }
    let kit = o.kit.spec
    let stops = plan.route.stops
    let arrivals = plan.schedule.arrivals
    let arrivedAt = plan.schedule.arrivedAt
    var out: [SoundEvent] = []
    let last = stops.count - 1
    for (i, stop) in stops.enumerated() {
        if i == 0 && stops.count > 1 { continue }
        if i != last && i >= arrivals.count { continue }
        let at = i == last ? arrivedAt : arrivals[i]
        if i == last {
            out.append(SoundEvent(at: at, voice: kit.seat.rawValue, gain: 0.8 * o.tickVolume, rate: o.tickPitch))
        } else if stop.accent {
            out.append(SoundEvent(at: at, voice: kit.leg.voice.rawValue, gain: 0.75 * o.tickVolume * kit.leg.gain,
                                  rate: o.tickPitch * kit.leg.rate))
        } else {
            out.append(SoundEvent(at: at, voice: kit.tick.rawValue, gain: 0.7 * o.tickVolume, rate: o.tickPitch))
        }
    }
    if o.shutter && o.pictures != .none {
        for pop in plan.schedule.pops {
            out.append(SoundEvent(at: pop.at + 0.05, voice: VoiceName.click.rawValue, gain: 0.55 * o.tickVolume,
                                  rate: o.tickPitch * 1.15))
        }
    }
    // A stable sort, as the web's.
    return out.enumerated()
        .sorted { a, b in a.element.at < b.element.at || (a.element.at == b.element.at && a.offset < b.offset) }
        .map(\.element)
}
