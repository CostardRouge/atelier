// Pure helpers to turn parsed DJI telemetry into a flight path — no map
// library. Port of `src/shared/telemetry/flight-path.ts`. Extracts the GPS
// track from the cues `parseSrt` produced, so the same data that drives the
// telemetry panels draws the map.
//
// The web's `[lon, lat]` pairs are a `LonLat` here, the order kept in the
// name; its `Bounds` is `TrackBounds`, so nothing generic sits at the top of
// the module.

import Foundation

/// A GeoJSON position: longitude first, as the web's `[lon, lat]`.
public struct LonLat: Equatable, Sendable {
    public var lon: Double
    public var lat: Double

    public init(lon: Double, lat: Double) {
        self.lon = lon
        self.lat = lat
    }

    public init(_ lon: Double, _ lat: Double) {
        self.lon = lon
        self.lat = lat
    }
}

public struct TrackPoint: Equatable, Sendable {
    public var lon: Double
    public var lat: Double
    /// Cue start time in seconds — lets the path line up with video playback.
    public var t: Double
    /// Relative altitude in metres, when present.
    public var alt: Double?

    public init(lon: Double, lat: Double, t: Double, alt: Double?) {
        self.lon = lon
        self.lat = lat
        self.t = t
        self.alt = alt
    }
}

/// The web's `Bounds`: a bounding box in `[lon, lat]`.
public struct TrackBounds: Equatable, Sendable {
    public var min: LonLat
    public var max: LonLat

    public init(min: LonLat, max: LonLat) {
        self.min = min
        self.max = max
    }
}

private func finiteNumber(_ value: String?) -> Double? {
    guard let value, let n = Double(value), n.isFinite else { return nil }
    return n
}

/// Parse a cue's GPS, or nil when it is missing or a null-island `(0, 0)` fix
/// (DJI writes that before the aircraft has a lock).
public func parsePosition(_ cue: Cue) -> LonLat? {
    guard let lat = finiteNumber(cue.data["latitude"]), let lon = finiteNumber(cue.data["longitude"]) else {
        return nil
    }
    if lat == 0 && lon == 0 { return nil }
    if abs(lat) > 90 || abs(lon) > 180 { return nil }
    return LonLat(lon: lon, lat: lat)
}

/// Extract the ordered list of located points from a clip's cues.
public func extractTrack(_ cues: [Cue]) -> [TrackPoint] {
    var out: [TrackPoint] = []
    for cue in cues {
        guard let pos = parsePosition(cue) else { continue }
        out.append(TrackPoint(lon: pos.lon, lat: pos.lat, t: cue.start, alt: finiteNumber(cue.data["rel_alt"])))
    }
    return out
}

/// Bounding box of a track, or nil when it has no points.
public func trackBounds(_ track: [TrackPoint]) -> TrackBounds? {
    if track.isEmpty { return nil }
    var minLon = Double.infinity
    var minLat = Double.infinity
    var maxLon = -Double.infinity
    var maxLat = -Double.infinity
    for p in track {
        if p.lon < minLon { minLon = p.lon }
        if p.lat < minLat { minLat = p.lat }
        if p.lon > maxLon { maxLon = p.lon }
        if p.lat > maxLat { maxLat = p.lat }
    }
    return TrackBounds(min: LonLat(lon: minLon, lat: minLat), max: LonLat(lon: maxLon, lat: maxLat))
}

/// GeoJSON LineString coordinates (`[lon, lat][]`) for the path.
public func lineCoordinates(_ track: [TrackPoint]) -> [LonLat] {
    track.map { LonLat(lon: $0.lon, lat: $0.lat) }
}
