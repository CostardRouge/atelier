// One position per day — the whole input of the itinerary deduction. Port of
// `src/shared/roadtrip/day-track.ts`.
//
// The premise the feature rests on: a journey's shape is not in its fifty
// thousand media, it is in ONE POSITION PER DAY. A hundred days of a trip is a
// few kilobytes, no media byte is fetched, and the volume never enters the
// arithmetic.
//
// A `DayPoint` is deliberately NOT a Winnow row. The instance aggregates
// (`/api/assets/geo?by=day`) and the client normalises what arrives into this
// shape at the boundary — so the segmentation can be driven by a local
// library just as well. This module never fetches; it reads `JSONValue`s the
// way the web reads `unknown`.
//
// Two rules are made executable here rather than trusted:
//
// - **A date is a plain `YYYY-MM-DD` or it is refused**, never sliced from an
//   instant. A clip shot at 07:00 in Perth is the 12th on the wall behind the
//   photographer and the 11th in UTC.
// - **`inferred` says the day rests only on machine-guessed positions.** Read
//   it, never recompute it, and never let it decide geometry: an inferred day
//   is a day to bridge OVER, not evidence of where a leg is.

import Foundation

/// Where one calendar day was, and how much that claim is worth. `lat`/`lon`
/// are the MEDIAN of the day's fixes, never the mean — a single frame shot from
/// the plane the evening before drags a centroid and leaves a median alone.
public struct DayPoint: GeoLocated, Equatable, Sendable {
    public var date: IsoDate
    public var lat: Double
    public var lon: Double
    /// Media behind the day, whatever their provenance.
    public var count: Int
    /// How many of those carried a measured or hand-authored position.
    public var measured: Int
    /// The position rests only on batch-inferred fixes.
    public var inferred: Bool

    public init(date: IsoDate, lat: Double, lon: Double, count: Int, measured: Int, inferred: Bool) {
        self.date = date; self.lat = lat; self.lon = lon
        self.count = count; self.measured = measured; self.inferred = inferred
    }
}

/// A non-negative whole count (`Math.round`), 0 for anything else.
private func dayCounted(_ value: JSONValue?) -> Int {
    guard let n = value?.finiteNumber, n >= 0 else { return 0 }
    return Int(min(TripJS.round(n), 1e15))
}

/// One aggregated row, validated. Nil for anything this module refuses to
/// guess at: a date that is not a calendar day, coordinates that are missing,
/// not finite, or outside the globe.
///
/// Null Island is refused too: `0, 0` is what a camera writes when it has no
/// fix, and one such day would drag a leg into the Gulf of Guinea.
public func readDayPoint(_ raw: JSONValue?) -> DayPoint? {
    guard let row = raw?.objectValue else { return nil }

    let date = row["date"]?.stringValue ?? ""
    if !isIsoDate(date) { return nil }

    guard let lat = row["lat"]?.finiteNumber, let lon = row["lon"]?.finiteNumber else { return nil }
    if lat < -90 || lat > 90 || lon < -180 || lon > 180 { return nil }
    if lat == 0 && lon == 0 { return nil }

    let count = dayCounted(row["count"])
    let reported = dayCounted(row["measured"])
    // An instance that says more measured than it holds is contradicting itself;
    // trust the smaller number rather than the flattering one.
    let measured = count > 0 ? min(reported, count) : reported

    // `source` is the instance's own word, and the one it really sends; a
    // boolean `inferred` is read too for an older or stubbed instance, and the
    // counts are the last resort — a row that says nothing about provenance
    // and holds no measured fix is, by construction, inferred.
    let inferred: Bool
    switch row["source"]?.stringValue {
    case "inferred": inferred = true
    case "measured": inferred = false
    default: inferred = row["inferred"]?.boolValue ?? (measured == 0)
    }

    return DayPoint(date: date, lat: lat, lon: lon, count: count, measured: measured, inferred: inferred)
}

/// The days an instance answered with, split into the two things they are.
///
/// A day the filters match but that holds NO position is still sent, with null
/// coordinates — a *declared gap*: "no data for this day" and "no media that
/// day" are different answers, and only the first appears here at all.
///
/// A repeated date keeps the FIRST row, so page order cannot decide. A row
/// whose date is not a calendar day is dropped entirely: it is neither a
/// position nor a gap.
public struct DayTrack: Equatable, Sendable {
    /// Days with a position, in calendar order.
    public var points: [DayPoint]
    /// Days holding media and no position at all, in calendar order.
    public var blind: [IsoDate]
    public init(points: [DayPoint], blind: [IsoDate]) { self.points = points; self.blind = blind }
}

public func readDayTrack(_ rows: [JSONValue]) -> DayTrack {
    var points: [IsoDate: DayPoint] = [:]
    var blind: Set<IsoDate> = []

    for raw in rows {
        guard let row = raw.objectValue, let date = row["date"]?.stringValue, isIsoDate(date) else { continue }
        if points[date] != nil || blind.contains(date) { continue }
        if let point = readDayPoint(raw) { points[date] = point } else { blind.insert(date) }
    }

    return DayTrack(points: points.values.sorted { $0.date < $1.date }, blind: blind.sorted())
}
