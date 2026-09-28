// The day the Library's instance tab looks at when it is NOT the one the
// active tool published. Port of `src/shared/sources/scope-override.ts`.
//
// A tool publishes the span it is on and the tab follows it. But the day
// before and the day after are worth looking at from a piece of another day —
// a teaser, a picture shot past midnight — without moving the piece. So the
// sidebar keeps an override of its own, and the tool never learns of it: the
// seam stays one-way, and the piece's date is untouched.
//
// The override is ANCHORED to the span it was taken from and holds only while
// that span is still what is published. Opening another piece, or another day
// of the overview, therefore gives the tab back to the tool with no effect to
// reset anything — a stale override is not a state this can reach, which is
// the "pile of days visited" the instance's tab was designed to never become
// (`architecture.md`). Nothing here is persisted, for the same reason.
//
// An override is always ONE day, whatever the anchor spans: stepping out of a
// three-day piece lands on the day before its first or after its last.
//
// Plain `YYYY-MM-DD` strings in UTC, with the web's own arithmetic: a day is
// parsed the way `Date.UTC` reads it (a month or a day past its range rolls
// over, never refuses; a year 00–99 is 1900 + it) and formatted the way
// `toISOString().slice(0, 10)` writes it — so the two clients agree on every
// string, the odd ones included. No `Calendar`: the civil-day arithmetic is
// pure and proleptic Gregorian, which is exactly what JavaScript's is.

import Foundation

public struct DaySpan: Equatable, Sendable {
    /// Inclusive, `YYYY-MM-DD` each.
    public var from: String
    public var to: String

    public init(from: String, to: String) { self.from = from; self.to = to }
}

public struct DayOverride: Equatable, Sendable {
    /// The published span this was taken from.
    public var anchor: DaySpan
    /// The one day looked at instead.
    public var day: String

    public init(anchor: DaySpan, day: String) { self.anchor = anchor; self.day = day }
}

public struct ViewedSpan: Equatable, Sendable {
    public var from: String
    public var to: String
    /// What the tool published, or nil when no tool says anything.
    public var anchor: DaySpan?
    /// True while the tab looks somewhere the tool is not.
    public var overridden: Bool

    public init(from: String, to: String, anchor: DaySpan?, overridden: Bool) {
        self.from = from; self.to = to; self.anchor = anchor; self.overridden = overridden
    }
}

// MARK: - civil days, the way JavaScript counts them

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's
/// `days_from_civil`); `m` is 1–12, `d` may run past the month, linearly.
private func daysFromCivil(_ year: Int, _ m: Int, _ d: Int) -> Int {
    let y = m <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = m > 2 ? m - 3 : m + 9
    let doy = (153 * mp + 2) / 5 + d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

/// The inverse of `daysFromCivil`.
private func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
    let z = days + 719468
    let era = (z >= 0 ? z : z - 146096) / 146097
    let doe = z - era * 146097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return (m <= 2 ? y + 1 : y, m, d)
}

/// `Date.UTC(year, monthIndex, day)` as a day count: a two-digit year is
/// 1900 + it, a month index outside 0–11 carries into the year, and a day
/// outside the month carries into the next — ECMAScript's `MakeDay`.
private func makeDay(year: Int, monthIndex: Int, day: Int) -> Int {
    let y = (0...99).contains(year) ? 1900 + year : year
    let carried = Int((Double(monthIndex) / 12).rounded(.down))
    let ym = y + carried
    let mn = monthIndex - carried * 12
    return daysFromCivil(ym, mn + 1, 1) + day - 1
}

/// A day count for `YYYY-MM-DD` (four digits, two, two — the web's regex),
/// nil for anything else.
private func parseDay(_ iso: String) -> Int? {
    let bytes = Array(iso.utf8)
    let dash = UInt8(ascii: "-")
    guard bytes.count == 10, bytes[4] == dash, bytes[7] == dash else { return nil }
    func digits(_ range: Range<Int>) -> Int? {
        var value = 0
        for i in range {
            let c = bytes[i]
            guard c >= 48, c <= 57 else { return nil }
            value = value * 10 + Int(c - 48)
        }
        return value
    }
    guard let year = digits(0..<4), let month = digits(5..<7), let day = digits(8..<10) else { return nil }
    return makeDay(year: year, monthIndex: month - 1, day: day)
}

private func padded(_ n: Int, _ width: Int) -> String {
    let text = String(n)
    return text.count >= width ? text : String(repeating: "0", count: width - text.count) + text
}

/// `YYYY-MM-DD` of a day count — `toISOString().slice(0, 10)`.
private func formatDay(_ days: Int) -> String {
    let civil = civilFromDays(days)
    return "\(padded(civil.year, 4))-\(padded(civil.month, 2))-\(padded(civil.day, 2))"
}

/// `iso` moved by whole days; nil when it is not a date. Pure.
public func shiftDay(_ iso: String, _ days: Int) -> String? {
    guard let day = parseDay(iso) else { return nil }
    return formatDay(day + days)
}

/// Whole days from `a` to `b`, negative when `b` is earlier. Pure.
private func daysFrom(_ a: String, _ b: String) -> Int? {
    guard let x = parseDay(a), let y = parseDay(b) else { return nil }
    return y - x
}

private func sameSpan(_ a: DaySpan, _ b: DaySpan) -> Bool {
    a.from == b.from && a.to == b.to
}

/// What the tab lists: the override while its anchor is still published, else
/// the published span, else the day picked by hand when no tool publishes.
/// Pure.
public func viewedSpan(_ published: DaySpan?, _ override: DayOverride?, _ manualDay: String) -> ViewedSpan {
    guard let published else {
        return ViewedSpan(from: manualDay, to: manualDay, anchor: nil, overridden: false)
    }
    let anchor = DaySpan(from: published.from, to: published.to)
    if let override, sameSpan(override.anchor, anchor) {
        return ViewedSpan(from: override.day, to: override.day, anchor: anchor, overridden: true)
    }
    return ViewedSpan(from: anchor.from, to: anchor.to, anchor: anchor, overridden: false)
}

/// One step out of what is shown: the day before its first day (`dir` < 0),
/// or the day after its last. For a single day, simply the neighbour. Pure.
public func stepOut(_ span: DaySpan, _ dir: Int) -> String? {
    shiftDay(dir < 0 ? span.from : span.to, dir < 0 ? -1 : 1)
}

/// The override that looking at `day` means under `anchor` — or nil when
/// `day` IS a single-day anchor, because stepping back onto the tool's own day
/// is following it again, not a second state that happens to look the same.
/// Pure.
public func overrideTo(_ anchor: DaySpan, _ day: String) -> DayOverride? {
    anchor.from == anchor.to && anchor.from == day ? nil : DayOverride(anchor: anchor, day: day)
}

/// Where `day` sits against the anchor, in the words the tab prints — "the day
/// before", "3 days after", "day 2 of 4". Measured from the anchor, never from
/// today: from a piece, "yesterday" is the day before the PIECE. Nil for a bad
/// date. Pure.
public func relativeToAnchor(_ day: String, _ anchor: DaySpan) -> String? {
    guard let before = daysFrom(day, anchor.from),
          let after = daysFrom(anchor.to, day),
          let length = daysFrom(anchor.from, anchor.to) else { return nil }
    if before > 0 { return before == 1 ? "the day before" : "\(before) days before" }
    if after > 0 { return after == 1 ? "the day after" : "\(after) days after" }
    if length == 0 { return "the same day" }
    return "day \(1 - before) of \(length + 1)"
}
