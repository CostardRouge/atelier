// Calendar arithmetic for road trips — the foundation the whole tool derives
// from: "Australie, jour 27/310" is this module answering two subtractions.
// Port of `src/shared/roadtrip/trip-days.ts`.
//
// A trip day is a CALENDAR DATE, not an instant: `2025-03-14` is the same day
// whether you read it in Perth or in Brest. So dates travel as `YYYY-MM-DD`
// strings and every subtraction runs in **UTC** — here as plain integer
// arithmetic on civil days (Howard Hinnant's algorithm), never through
// Foundation's `Calendar` or a local `Date`: parsing locally would let the
// *reading* device's zone move a value, so a trip planned in France and
// reviewed in Australia would disagree about which day a photo belongs to.
// A day is exactly one constant; there is no DST in a day count.
//
// A trip is tracked by CALENDAR DAY, never by file name (`roadtrip.md`).
// Pure; the one clock read (`todayIso`) takes the instant and the zone as
// inputs.

import Foundation

/// A calendar day, `YYYY-MM-DD`. The web's `IsoDate`.
public typealias IsoDate = String

private let tripDayMs = 86_400_000.0

/// Weekday names of the grid, Monday first (the European week). The web's `WEEKDAYS`.
public let tripWeekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

private let tripMonthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// MARK: - JavaScript's number semantics, shared by the Roadtrip ports

/// The few JavaScript number behaviours the Roadtrip modules lean on, in one
/// namespace so no file of this area declares a generic top-level name.
enum TripJS {
    /// `Math.round`: the nearest integer, a half going toward +∞.
    static func round(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        let down = x.rounded(.down)
        return x - down >= 0.5 ? down + 1 : down
    }

    /// `String(n).padStart(width, '0')`.
    static func pad(_ n: Int, _ width: Int) -> String {
        let text = String(n)
        return text.count >= width ? text : String(repeating: "0", count: width - text.count) + text
    }

    /// `${n}`: an integer-valued number prints without `.0`; NaN as `NaN`.
    static func number(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x.isInfinite { return x > 0 ? "Infinity" : "-Infinity" }
        if x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
        return "\(x)"
    }

    /// `Number.prototype.toFixed(1)` on a finite value: the EXACT decimal
    /// value of the double decides, and an exact tie goes away from zero —
    /// `printf` would take the tie to even (`0.25` → `0.2`, where the web
    /// prints `0.3`). At one decimal the only exact ties are the quarters.
    static func toFixed1(_ x: Double) -> String {
        guard x.isFinite else { return number(x) }
        let quarters = x * 4
        if quarters == quarters.rounded(), abs(quarters.truncatingRemainder(dividingBy: 2)) == 1 {
            let tenths = (abs(x) * 10).rounded(.up) * (x < 0 ? -1 : 1)
            return String(format: "%.1f", tenths / 10)
        }
        return String(format: "%.1f", x)
    }
}

// MARK: - civil days (proleptic Gregorian, what `Date.UTC` counts in)

/// Days since 1970-01-01 of a civil date; `m` is 1–12.
private func tripDaysFromCivil(_ year: Int, _ m: Int, _ d: Int) -> Int {
    let y = m <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = m > 2 ? m - 3 : m + 9
    let doy = (153 * mp + 2) / 5 + d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
}

/// The inverse of `tripDaysFromCivil`.
private func tripCivilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return (m <= 2 ? y + 1 : y, m, d)
}

/// The day count of a UTC instant in milliseconds (`getUTC*` reads this day).
private func tripDayOf(_ utcMs: Double) -> Int {
    Int((utcMs / tripDayMs).rounded(.down))
}

/// Days in a month of a year (`month` 1–12).
func tripDaysInMonth(_ year: Int, _ month: Int) -> Int {
    tripDaysFromCivil(month == 12 ? year + 1 : year, month == 12 ? 1 : month + 1, 1)
        - tripDaysFromCivil(year, month, 1)
}

// MARK: - reading and writing a day

/// The year, the month (1–12) and the day of a real `YYYY-MM-DD`, or nil —
/// the `getUTCFullYear` / `getUTCMonth() + 1` / `getUTCDate` of the web's
/// parsed date, read without a `Date`.
public func isoDateFields(_ iso: String) -> (year: Int, month: Int, day: Int)? {
    // `^(\d{4})-(\d{2})-(\d{2})$`: ten ASCII bytes, `\d` being ASCII digits.
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
    if month < 1 || month > 12 || day < 1 || day > 31 { return nil }
    // `Date.UTC` reads a year 0–99 as 1900 + it, so the round trip the web
    // checks fails for those — refused here the same way.
    if year <= 99 { return nil }
    // `2025-02-30` is refused rather than rolled to 2 March.
    if day > tripDaysInMonth(year, month) { return nil }
    return (year, month, day)
}

/// Days since 1970-01-01 of a real `YYYY-MM-DD`, or nil.
func tripDayCount(_ iso: String) -> Int? {
    guard let f = isoDateFields(iso) else { return nil }
    return tripDaysFromCivil(f.year, f.month, f.day)
}

/// `YYYY-MM-DD` of a day count.
func tripIsoDate(dayCount days: Int) -> IsoDate {
    let c = tripCivilFromDays(days)
    return "\(TripJS.pad(c.year, 4))-\(TripJS.pad(c.month, 2))-\(TripJS.pad(c.day, 2))"
}

/// UTC midnight of a `YYYY-MM-DD` string in milliseconds, or nil when it is
/// not a real date. Rejects the calendar impossibilities `Date.UTC` would
/// silently roll over (`2025-02-30` → 2 March), because a trip whose end date
/// silently moved is worse than one that refuses to be created.
public func parseIsoDate(_ iso: String) -> Double? {
    guard let days = tripDayCount(iso) else { return nil }
    return Double(days) * tripDayMs
}

public func isIsoDate(_ iso: String) -> Bool {
    isoDateFields(iso) != nil
}

/// UTC milliseconds back to `YYYY-MM-DD` (the UTC day the instant falls in).
public func toIsoDate(_ utcMs: Double) -> IsoDate {
    tripIsoDate(dayCount: tripDayOf(utcMs))
}

/// Today as the user's own calendar reads it. "Today" is the one place a LOCAL
/// reading is correct — it is the date on the wall behind the person, not an
/// instant — so the instant is moved by the zone's offset, then frozen into
/// an `IsoDate`, after which every comparison is UTC like the rest of the
/// module. `now` is epoch milliseconds; the offset is the zone's at `now`.
public func todayIso(now: Double, utcOffsetSeconds: Int) -> IsoDate {
    toIsoDate(now + Double(utcOffsetSeconds) * 1000)
}

/// `todayIso` for an instant read in a zone — the app passes `Date()` and
/// `.current`; the kernel never reads the clock itself.
public func todayIso(_ now: Date, in zone: TimeZone) -> IsoDate {
    todayIso(now: now.timeIntervalSince1970 * 1000, utcOffsetSeconds: zone.secondsFromGMT(for: now))
}

/// `iso` shifted by whole days; nil when `iso` is not a date.
public func addDays(_ iso: IsoDate, _ days: Int) -> IsoDate? {
    guard let d = tripDayCount(iso) else { return nil }
    return tripIsoDate(dayCount: d + days)
}

/// Whole days from `from` to `to` (negative when `to` is earlier).
public func daysBetween(_ from: IsoDate, _ to: IsoDate) -> Int? {
    guard let a = tripDayCount(from), let b = tripDayCount(to) else { return nil }
    return b - a
}

/// The 1-based day number of `iso` inside a span starting at `start` — the "27"
/// of "jour 27/310". Days before the start count backwards (0, -1, …) rather
/// than being refused: a photo shot the day before departure is a real thing to
/// hold, and the caller decides whether to show it. Nil only for a bad date.
public func dayNumber(_ start: IsoDate, _ iso: IsoDate) -> Int? {
    daysBetween(start, iso).map { $0 + 1 }
}

/// Whole years elapsed from `from` to `to` — the "1" of "one year ago today".
/// Counted on the calendar, not by dividing days: the anniversary of 29
/// February falls on 1 March in common years, and 365.25 would put it either
/// side by turns. Negative when `to` precedes `from`; nil for a bad date.
public func yearsBetween(_ from: IsoDate, _ to: IsoDate) -> Int? {
    guard let a = isoDateFields(from), let b = isoDateFields(to) else { return nil }
    var years = b.year - a.year
    let monthDelta = b.month - a.month
    let dayDelta = b.day - a.day
    // The anniversary has not come round yet this year.
    if monthDelta < 0 || (monthDelta == 0 && dayDelta < 0) { years -= 1 }
    return years
}

/// Whole months elapsed from `from` to `to`, on the calendar. Same shape as
/// `yearsBetween` and for the same reason: a month is not 30.44 days.
public func monthsBetween(_ from: IsoDate, _ to: IsoDate) -> Int? {
    guard let a = isoDateFields(from), let b = isoDateFields(to) else { return nil }
    var months = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day { months -= 1 }
    return months
}

/// Whether two dates fall on the same day of the same month — what makes a
/// date an ANNIVERSARY rather than merely a year or more later. 29 February
/// has no anniversary in a common year, and saying so is more honest than
/// quietly moving it.
public func sameDayOfYear(_ a: IsoDate, _ b: IsoDate) -> Bool {
    guard let x = isoDateFields(a), let y = isoDateFields(b) else { return false }
    return x.month == y.month && x.day == y.day
}

/// Inclusive length of a span in days ("310"); nil for a bad or reversed span.
public func spanLength(_ start: IsoDate, _ end: IsoDate) -> Int? {
    guard let delta = daysBetween(start, end), delta >= 0 else { return nil }
    return delta + 1
}

/// Whether `iso` falls inside `[start, end]`, both ends included.
public func isWithin(_ start: IsoDate, _ end: IsoDate, _ iso: IsoDate) -> Bool {
    guard let a = tripDayCount(start), let b = tripDayCount(end), let x = tripDayCount(iso) else { return false }
    return x >= a && x <= b
}

/// Every date of `[start, end]`, in order. Empty for a reversed or bad span.
public func enumerateDays(_ start: IsoDate, _ end: IsoDate) -> [IsoDate] {
    guard let a = tripDayCount(start), let b = tripDayCount(end), b >= a else { return [] }
    return (a...b).map(tripIsoDate(dayCount:))
}

/// 0 = Monday … 6 = Sunday. Nil for a bad date.
public func weekdayIndex(_ iso: IsoDate) -> Int? {
    guard let d = tripDayCount(iso) else { return nil }
    // 1970-01-01 was a Thursday (index 3 with Monday first).
    return (((d + 3) % 7) + 7) % 7
}

/// The trip laid out as a GitHub-style contribution grid: one column per
/// calendar week, seven rows Monday→Sunday. Cells outside the trip are nil so
/// the first and last weeks keep their real shape — a trip starting on a
/// Thursday must start three cells down, or the whole grid reads as the wrong
/// weekday and the "I never post on Sundays" pattern the grid exists to reveal
/// would be a lie.
public func heatmapWeeks(_ start: IsoDate, _ end: IsoDate) -> [[IsoDate?]] {
    let days = enumerateDays(start, end)
    guard let first = days.first else { return [] }
    let lead = weekdayIndex(first) ?? 0
    var cells: [IsoDate?] = Array(repeating: nil, count: lead) + days.map { Optional($0) }
    while cells.count % 7 != 0 { cells.append(nil) }
    return stride(from: 0, to: cells.count, by: 7).map { Array(cells[$0..<$0 + 7]) }
}

/// A month label above the heatmap: the column it starts at.
public struct MonthLabel: Equatable, Sendable {
    public var column: Int
    public var label: String
    public init(column: Int, label: String) { self.column = column; self.label = label }
}

/// Which column each month starts in, for the labels above the grid. A month is
/// labelled on the first week that CONTAINS its first day present in the grid,
/// and the first month is labelled at column 0 even when the trip joins it
/// mid-month — an unlabelled leading column reads as "no month".
public func monthLabels(_ weeks: [[IsoDate?]]) -> [MonthLabel] {
    var out: [MonthLabel] = []
    var lastMonth = -1
    for (column, week) in weeks.enumerated() {
        for cell in week {
            guard let iso = cell else { continue }
            guard let f = isoDateFields(iso) else { continue }
            let month = f.month - 1
            if month != lastMonth {
                lastMonth = month
                out.append(MonthLabel(column: column, label: tripMonthsShort[month]))
            }
            break
        }
    }
    return out
}

/// How a day reads against the one being lived — `today`, `yesterday`,
/// `3 days ago`, `in 2 days`. The reference day is an INPUT, for the same
/// reason `timeAgoLine` takes one: the phrase has to be true on the day it is
/// read, not on the day it was composed. Nil for a date that does not parse,
/// so a caller falls back to the date itself rather than printing a lie.
public func describeRelativeDay(_ iso: IsoDate, today: IsoDate) -> String? {
    guard let delta = daysBetween(iso, today) else { return nil }
    if delta == 0 { return "today" }
    if delta == 1 { return "yesterday" }
    if delta == -1 { return "tomorrow" }
    return delta > 0 ? "\(delta) days ago" : "in \(-delta) days"
}

/// `14 Mar 2025` — a date read by a human, never parsed back.
public func formatIsoDate(_ iso: IsoDate) -> String {
    guard let f = isoDateFields(iso) else { return iso }
    return "\(f.day) \(tripMonthsShort[f.month - 1]) \(f.year)"
}

/// Up to this many days a trip is SHORT. On the web the same 31 is named
/// twice (`trip-days.ts` and `month-grid.ts`, the old day strip's threshold
/// kept by the calendar): here it is this one constant. The web's `SHORT_TRIP_DAYS`.
public let shortTripDays = 31

public func isShortTrip(_ totalDays: Int) -> Bool {
    totalDays > 0 && totalDays <= shortTripDays
}
