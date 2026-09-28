// Days with a position, read as LEGS — the arithmetic of the itinerary
// deduction (`DayTrack.swift` is its input, `TrackChapters.swift` its output).
// Port of `src/shared/roadtrip/segment-track.ts`.
//
// A leg is **a run of consecutive days whose position stays within a radius of
// the run so far**. The simplicity is deliberate: stop-detection from the
// literature (ST-DBSCAN and its relatives) is built for traces sampled at 1 Hz
// with noise, while this is fed ONE point per day already reduced to a median.
// At that sampling a threshold on a run is exact, pure, testable and readable.
//
// Blind days do not cut a run, and that is the load-bearing decision: measured
// on the instance, one day in six stays blind for good, and closing a run on a
// day without a position would break a ten-day stay into three legs. So two
// treatments, and the difference between them is moral, not technical:
// - **Bridging** (`bridgeBlind`, on by default) — a blind day whose neighbours
//   belong to the same run is COVERED by the leg. Nothing is invented: a leg is
//   a SPAN, and it claims nothing about where the blind day was photographed.
// - **Interpolating a move** (`interpolateMoves`, off by default) — a blind day
//   between two DIFFERENT places. Giving it a position is a fabrication, so it
//   is opt-in, and the days it mints are marked `inferred`.
// Every leg reports `bridged`; a hole the two ends contradict, or one at the
// edge of the trace, stays a real gap — counted, named, never filled. A short
// halt is LISTED and marked by default, never dropped; folded into the halt it
// was on the way to only when asked, and never across a blind gap.
//
// Pure.

import Foundation

/// What to do with a leg shorter than `minNights`.
public enum ShortLegs: String, CaseIterable, Sendable {
    /// List it, marked `short`.
    case list
    /// Fold it into the halt it was on the way to.
    case merge
}

public struct SegmentOptions: Equatable, Sendable {
    /// Two days within this distance are the same place.
    public var radiusKm: Double
    /// Below this many days a leg is a stop on the way, not a halt.
    public var minNights: Int
    public var shortLegs: ShortLegs
    /// Cover a blind day whose neighbours are the same place.
    public var bridgeBlind: Bool
    /// Invent positions across a blind day between two places.
    public var interpolateMoves: Bool

    public init(radiusKm: Double = 25, minNights: Int = 2, shortLegs: ShortLegs = .list, bridgeBlind: Bool = true,
                interpolateMoves: Bool = false) {
        self.radiusKm = radiusKm; self.minNights = minNights; self.shortLegs = shortLegs
        self.bridgeBlind = bridgeBlind; self.interpolateMoves = interpolateMoves
    }

    /// The web's `DEFAULT_SEGMENT`: 25 km, two nights, listed, bridged, never interpolated.
    public static let `default` = SegmentOptions()
}

public struct TrackLeg: Equatable, Sendable {
    public var startDate: IsoDate
    public var endDate: IsoDate
    /// Where to call it — the MEDIAN of its own days, not the walking mean.
    public var centroid: GeoPoint
    /// Calendar days the leg spans, bridged ones included.
    public var dayCount: Int
    /// Of those, days that carried no position at all.
    public var bridged: Int
    /// Media behind the leg.
    public var count: Int
    /// Not one of its days carried a measured fix.
    public var inferred: Bool
    /// Shorter than `minNights`. Listed and marked, never dropped.
    public var short: Bool
    /// Days folded in from short runs, in `merge` mode.
    public var absorbed: Int

    public init(startDate: IsoDate, endDate: IsoDate, centroid: GeoPoint, dayCount: Int, bridged: Int, count: Int,
                inferred: Bool, short: Bool, absorbed: Int) {
        self.startDate = startDate; self.endDate = endDate; self.centroid = centroid; self.dayCount = dayCount
        self.bridged = bridged; self.count = count; self.inferred = inferred; self.short = short
        self.absorbed = absorbed
    }
}

public struct TrackSegmentation: Equatable, Sendable {
    public var legs: [TrackLeg]
    /// Runs of days the trace could not place — said, never filled.
    public var blind: [Gap]

    public init(legs: [TrackLeg], blind: [Gap]) { self.legs = legs; self.blind = blind }
}

/// A run being built: its days, and the mean that decides what joins it.
private struct TrackRun {
    var points: [DayPoint]
    var mean: GeoPoint
    /// Blind days already covered inside this run.
    var bridged: Int

    init(_ point: DayPoint) {
        points = [point]
        mean = GeoPoint(lat: point.lat, lon: point.lon)
        bridged = 0
    }

    mutating func extend(_ point: DayPoint) {
        points.append(point)
        let n = Double(points.count)
        mean = GeoPoint(lat: mean.lat + (point.lat - mean.lat) / n, lon: mean.lon + (point.lon - mean.lon) / n)
    }
}

private func trackMedian(_ values: [Double]) -> Double {
    let sorted = values.sorted()
    let mid = sorted.count >> 1
    return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

private func closeRun(_ run: TrackRun, _ minNights: Int) -> TrackLeg {
    let startDate = run.points[0].date
    let endDate = run.points[run.points.count - 1].date
    let dayCount = spanLength(startDate, endDate) ?? run.points.count
    // The WALK needs an online estimate, so it uses the running mean; the PLACE
    // is named from a robust one, because a single travel day that slipped into
    // the run must not move the name.
    let centroid = GeoPoint(lat: trackMedian(run.points.map(\.lat)), lon: trackMedian(run.points.map(\.lon)))
    return TrackLeg(
        startDate: startDate, endDate: endDate, centroid: centroid, dayCount: dayCount, bridged: run.bridged,
        count: run.points.reduce(0) { $0 + $1.count }, inferred: run.points.allSatisfy(\.inferred),
        short: dayCount < minNights, absorbed: 0
    )
}

/// The days between two points, as positions walked in a straight line. Only
/// reached with `interpolateMoves` on; every day it mints is `inferred`, holds
/// no media of its own, and is therefore a claim the panel marks.
private func walkBetween(_ from: DayPoint, _ to: DayPoint, _ holeDays: Int) -> [DayPoint] {
    var made: [DayPoint] = []
    if holeDays < 1 { return made }
    for i in 1...holeDays {
        guard let date = addDays(from.date, i) else { break }
        let t = Double(i) / Double(holeDays + 1)
        made.append(DayPoint(date: date, lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t,
                             count: 0, measured: 0, inferred: true))
    }
    return made
}

/// A short leg (`last`) folded into the halt it was on the way to (`target`).
private func foldedBefore(_ target: TrackLeg, _ last: TrackLeg) -> TrackLeg {
    var next = target
    next.startDate = last.startDate
    next.dayCount = target.dayCount + last.dayCount
    next.bridged = target.bridged + last.bridged
    next.count = target.count + last.count
    next.inferred = target.inferred && last.inferred
    next.absorbed = target.absorbed + last.dayCount
    return next
}

/// Fold a short leg into the halt it was on the way to — the NEXT one, because
/// that is where you were going; the previous one when it is the last leg. It
/// only ever folds into an ADJACENT leg: merging across a blind gap would make
/// the halt claim days nothing supports.
private func mergeShort(_ legs: [TrackLeg]) -> [TrackLeg] {
    var out: [TrackLeg] = []
    var pending: [TrackLeg] = []

    func adjacent(_ before: TrackLeg, _ after: TrackLeg) -> Bool {
        addDays(before.endDate, 1) == after.startDate
    }

    for leg in legs {
        if leg.short {
            pending.append(leg)
            continue
        }
        var target = leg
        while let last = pending.last {
            if !adjacent(last, target) { break }
            pending.removeLast()
            target = foldedBefore(target, last)
        }
        out.append(contentsOf: pending)
        pending.removeAll()
        out.append(target)
    }

    // What is still pending had no halt after it: give it to the one before.
    while !pending.isEmpty {
        let first = pending.removeFirst()
        if let last = out.last, !last.short, adjacent(last, first) {
            var next = last
            next.endDate = first.endDate
            next.dayCount = last.dayCount + first.dayCount
            next.bridged = last.bridged + first.bridged
            next.count = last.count + first.count
            next.inferred = last.inferred && first.inferred
            next.absorbed = last.absorbed + first.dayCount
            out[out.count - 1] = next
        } else {
            out.append(first)
        }
    }

    return out.enumerated().sorted { a, b in
        if a.element.startDate != b.element.startDate { return a.element.startDate < b.element.startDate }
        return a.offset < b.offset
    }.map(\.element)
}

public func segmentTrack(_ points: [DayPoint], _ options: SegmentOptions = .default) -> TrackSegmentation {
    var legs: [TrackLeg] = []
    var blind: [Gap] = []
    guard let firstPoint = points.first else { return TrackSegmentation(legs: legs, blind: blind) }

    func joins<P: GeoLocated>(_ run: TrackRun, _ point: P) -> Bool {
        haversineKm(run.mean, point) <= options.radiusKm
    }

    var run = TrackRun(firstPoint)

    for i in 1..<points.count {
        let previous = points[i - 1]
        let point = points[i]
        let step = daysBetween(previous.date, point.date)
        let holeDays = step.map { $0 - 1 } ?? 0

        if holeDays > 0 {
            // One predicate decides both questions: a hole is bridged exactly
            // when the day after it would have joined the run anyway.
            if options.bridgeBlind && joins(run, point) {
                run.bridged += holeDays
                run.extend(point)
                continue
            }

            if options.interpolateMoves {
                for made in walkBetween(previous, point, holeDays) {
                    if joins(run, made) {
                        run.extend(made)
                    } else {
                        legs.append(closeRun(run, options.minNights))
                        run = TrackRun(made)
                    }
                }
            } else {
                if let start = addDays(previous.date, 1), let end = addDays(point.date, -1) {
                    blind.append(Gap(start: start, end: end, length: holeDays))
                }
                legs.append(closeRun(run, options.minNights))
                run = TrackRun(point)
                continue
            }
        }

        if joins(run, point) {
            run.extend(point)
        } else {
            legs.append(closeRun(run, options.minNights))
            run = TrackRun(point)
        }
    }

    legs.append(closeRun(run, options.minNights))

    return TrackSegmentation(legs: options.shortLegs == .merge ? mergeShort(legs) : legs, blind: blind)
}
