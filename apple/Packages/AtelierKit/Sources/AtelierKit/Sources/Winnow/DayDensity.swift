// A month drawn as a strip of bars — one per day, its height the number of
// media the instance holds that day. Port of
// `src/shared/sources/winnow/day-density.ts`.
//
// It answers the question a date field cannot: *which days of this month have
// anything on them*. The instance already knows (`/api/assets/calendar` gives
// a count per day), so the strip is a reading of that answer, never an
// estimate. Normalised to the MONTH'S OWN peak, so a quiet month reads as a
// shape and not as a flat line; a day holding anything never draws below
// `densityFloor`, so one file is visibly different from none.

import Foundation

public struct DayBar: Equatable, Sendable {
    /// `YYYY-MM-DD`.
    public var date: String
    public var count: Int
    /// 0 for a day that holds nothing, else `densityFloor`…1 of the drawn height.
    public var fill: Double

    public init(date: String, count: Int, fill: Double) { self.date = date; self.count = count; self.fill = fill }
}

public struct DensityStrip: Equatable, Sendable {
    public var bars: [DayBar]
    /// The busiest day's count; 0 when the month holds nothing.
    public var peak: Int
    /// Every file the month holds, across its days.
    public var total: Int
}

/// The shortest a bar with something in it may draw, as a fraction of the
/// peak — the web's `FLOOR`. Below about a fifth it reads as noise against the
/// empty days' stub.
public let densityFloor = 0.22

/// The strip for `days`, counted by `counts` (a day the map does not name
/// holds nothing). The days are echoed in the order given — the caller owns
/// the calendar arithmetic, this owns only the reading.
public func densityStrip(_ days: [String], _ counts: [String: Int]) -> DensityStrip {
    var peak = 0
    var total = 0
    for day in days {
        let n = counts[day] ?? 0
        if n > peak { peak = n }
        total += n
    }
    let bars = days.map { date -> DayBar in
        let count = counts[date] ?? 0
        let fill = count == 0 || peak == 0 ? 0 : densityFloor + (1 - densityFloor) * (Double(count) / Double(peak))
        return DayBar(date: date, count: count, fill: fill)
    }
    return DensityStrip(bars: bars, peak: peak, total: total)
}
