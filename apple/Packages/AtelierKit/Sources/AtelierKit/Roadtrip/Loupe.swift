// The loupe: the window of a long trip that the stage ruler details. Port of
// `src/shared/roadtrip/loupe.ts`.
//
// A year's heatmap shows the whole journey; the ruler under it, at the 6px a
// day needs to be grabbed, showed five months of it and scrolled for the
// rest. The loupe was a window dragged OVER the heatmap, and the ruler drew
// exactly that window. Since 2026-09-22 the web's loupe IS the scroll of the
// calendar of months (`roadtrip.md`), and this module stays for the ruler's
// `panWeeks` and the window arithmetic.
//
// Pure: a span of whole days, clamped to the trip, that keeps its width when
// it moves and follows the open day when the day leaves it. The trip is
// handed in as its two dates (`TripSpan`) — the web reads them off `TripDoc`,
// which this module needs nothing else of.

import Foundation

public struct Loupe: Equatable, Sendable {
    public var start: IsoDate
    public var end: IsoDate
    public init(start: IsoDate, end: IsoDate) { self.start = start; self.end = end }
}

/// A trip's two dates, the only part of `TripDoc` the loupe reads.
public struct TripSpan: Equatable, Sendable {
    public var startDate: IsoDate
    public var endDate: IsoDate
    public init(startDate: IsoDate, endDate: IsoDate) { self.startDate = startDate; self.endDate = endDate }
}

public enum LoupeEdge: String, Sendable {
    case start
    case end
}

/// How many days the loupe opens on: eight weeks, a leg or two at a glance.
/// The web's `DEFAULT_LOUPE_DAYS`.
public let defaultLoupeDays = 56
/// Narrowest the window may be dragged to. The web's `MIN_LOUPE_DAYS`.
public let minLoupeDays = 7

/// Days in the window, at least 1.
public func loupeLength(_ loupe: Loupe) -> Int {
    spanLength(loupe.start, loupe.end) ?? 1
}

/// The date `offset` days into the trip. The web asserts it non-null (`!`); a
/// trip whose start is not a date answers its own start string rather than
/// trapping — garbage kept, never a crash.
private func dayInto(_ trip: TripSpan, _ offset: Int) -> IsoDate {
    addDays(trip.startDate, offset) ?? trip.startDate
}

/// A window of `days` around `focus`, clamped to the trip: it starts on the
/// Monday of the focus's week when it can, so the window's edges fall where
/// the heatmap's columns do. A trip shorter than the window is the window.
public func defaultLoupe(_ trip: TripSpan, _ focus: IsoDate?, days: Int = defaultLoupeDays) -> Loupe {
    let total = spanLength(trip.startDate, trip.endDate) ?? 1
    let width = min(days, total)
    let anchor: IsoDate
    if let focus, isWithin(trip.startDate, trip.endDate, focus) { anchor = focus } else { anchor = trip.startDate }
    let from = daysBetween(trip.startDate, anchor) ?? 0
    // Two weeks before the focus keeps it inside the window with context behind
    // it, pulled back to that week's Monday: the heatmap is drawn in weeks, so a
    // window that starts mid-week would frame half a column.
    let guess = max(0, from - 14)
    let monday = guess - (weekdayIndex(dayInto(trip, guess)) ?? 0)
    let wanted = max(0, min(total - width, monday))
    return clampLoupe(trip, Loupe(start: dayInto(trip, wanted), end: dayInto(trip, wanted + width - 1)))
}

/// Slide the window by whole days, keeping its width, never past the trip.
public func moveLoupe(_ trip: TripSpan, _ loupe: Loupe, _ deltaDays: Int) -> Loupe {
    let total = spanLength(trip.startDate, trip.endDate) ?? 1
    let width = loupeLength(loupe)
    let from = daysBetween(trip.startDate, loupe.start) ?? 0
    let next = max(0, min(total - width, from + deltaDays))
    return Loupe(start: dayInto(trip, next), end: dayInto(trip, next + width - 1))
}

/// The whole weeks a sideways scroll moves the loupe, and what did not make a
/// week — carried to the next event.
public struct WeekPan: Equatable, Sendable {
    public var weeks: Int
    public var carry: Double
    public init(weeks: Int, carry: Double) { self.weeks = weeks; self.carry = carry }
}

/// A sideways scroll over the ruler, in points, turned into the whole WEEKS the
/// loupe moves — the loupe lives in weeks, like every other way of moving it —
/// with what did not make a week carried to the next event. `dayPx` is the
/// ruler's drawn day width, so a week of scrolling is a week of track.
public func panWeeks(_ carry: Double, _ px: Double, _ dayPx: Double) -> WeekPan {
    if !(dayPx > 0) { return WeekPan(weeks: 0, carry: 0) }
    let total = carry + px
    let quotient = (total / (7 * dayPx)).rounded(.towardZero)
    // The web's `|| 0` turns a -0 (and a NaN) into 0.
    let weeks = quotient.isFinite ? Int(quotient) : 0
    return WeekPan(weeks: weeks, carry: total - Double(weeks) * 7 * dayPx)
}

/// Move one edge to a date; the window never shrinks under `minLoupeDays`.
public func resizeLoupe(_ trip: TripSpan, _ loupe: Loupe, _ edge: LoupeEdge, _ date: IsoDate) -> Loupe {
    let clamped = clampLoupeDate(trip, date)
    switch edge {
    case .start:
        let latest = addDays(loupe.end, -(minLoupeDays - 1)) ?? loupe.end
        return Loupe(start: clamped <= latest ? clamped : latest, end: loupe.end)
    case .end:
        let earliest = addDays(loupe.start, minLoupeDays - 1) ?? loupe.start
        return Loupe(start: loupe.start, end: clamped >= earliest ? clamped : earliest)
    }
}

/// The window that holds `date`: this one if it already does, else slid the shortest way.
public func loupeContaining(_ trip: TripSpan, _ loupe: Loupe, _ date: IsoDate) -> Loupe {
    if !isWithin(trip.startDate, trip.endDate, date) { return loupe }
    if date >= loupe.start && date <= loupe.end { return loupe }
    if let before = daysBetween(date, loupe.start), before > 0 { return moveLoupe(trip, loupe, -before) }
    let after = daysBetween(loupe.end, date) ?? 0
    return moveLoupe(trip, loupe, after)
}

/// Whether the window is the whole trip — nothing to detail, then.
public func loupeIsWhole(_ trip: TripSpan, _ loupe: Loupe) -> Bool {
    loupe.start == trip.startDate && loupe.end == trip.endDate
}

private func clampLoupeDate(_ trip: TripSpan, _ date: IsoDate) -> IsoDate {
    if date < trip.startDate { return trip.startDate }
    if date > trip.endDate { return trip.endDate }
    return date
}

private func clampLoupe(_ trip: TripSpan, _ loupe: Loupe) -> Loupe {
    let start = clampLoupeDate(trip, loupe.start)
    let end = clampLoupeDate(trip, loupe.end)
    return end < start ? Loupe(start: start, end: start) : Loupe(start: start, end: end)
}
