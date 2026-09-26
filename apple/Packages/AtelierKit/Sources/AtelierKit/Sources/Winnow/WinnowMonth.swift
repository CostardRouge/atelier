// Month arithmetic for the Winnow browser's calendar — port of
// `src/shared/sources/winnow/month.ts` — on `YYYY-MM-DD` strings and in UTC,
// the rule Road Trip's `trip-days.ts` follows, because a local-time
// subtraction across a DST edge is how a day goes missing. The arithmetic is
// JavaScript's `Date.UTC` (a month past 12 rolls into the next year); the
// month's NAME is the one place a locale enters, as `toLocaleDateString` does.

import Foundation

public struct MonthSpan: Equatable, Sendable {
    /// `YYYY-MM`.
    public var key: String
    /// First and last day, `YYYY-MM-DD`.
    public var from: String
    public var to: String
    /// Every day of the month, in order.
    public var days: [String]
    /// 0 = Monday … 6 = Sunday, of the first day — where the grid starts.
    public var leading: Int
}

/// `2025-07-09` → `2025-07`.
public func monthKeyOf(_ iso: String) -> String {
    String(iso.prefix(7))
}

/// `2025-07` → its year and month (1–12), as `split('-').map(Number)` reads it.
private func yearMonth(_ key: String) -> (year: Int, month: Int)? {
    let bits = key.split(separator: "-", omittingEmptySubsequences: false)
    guard bits.count >= 2, let y = Int(bits[0]), let m = Int(bits[1]) else { return nil }
    return (y, m)
}

/// The month `key` names — its days and where its grid starts. A key that is
/// not `YYYY-MM` names no month: no days, and empty edges.
public func monthSpan(_ key: String) -> MonthSpan {
    guard let (y, m) = yearMonth(key) else {
        return MonthSpan(key: key, from: "", to: "", days: [], leading: 0)
    }
    // `new Date(Date.UTC(y, m, 0)).getUTCDate()`: the last day of month m.
    let first = winnowUtcDay(year: y, monthIndex: m - 1, day: 1)
    let next = winnowUtcDay(year: y, monthIndex: m, day: 1)
    let count = Swift.max(0, next - first)
    let days = (0..<count).map { "\(key)-\(winnowPad2($0 + 1))" }
    // getUTCDay: 0 = Sunday. Shift so Monday leads, like the Road Trip grid.
    let weekday = ((first % 7) + 7 + 4) % 7
    let leading = (weekday + 6) % 7
    return MonthSpan(key: key, from: days.first ?? "", to: days.last ?? "", days: days, leading: leading)
}

/// The month `by` months from `key`.
public func shiftMonth(_ key: String, _ by: Int) -> String {
    guard let (y, m) = yearMonth(key) else { return key }
    let civil = winnowCivilFromDays(winnowUtcDay(year: y, monthIndex: m - 1 + by, day: 1))
    return "\(civil.year)-\(winnowPad2(civil.month))"
}

/// A formatter for month names in `locale` (a BCP 47 tag such as `en-GB`, or
/// nil for the viewer's own), reading UTC.
private func monthFormatter(_ template: String, _ locale: String?) -> DateFormatter {
    let f = DateFormatter()
    f.locale = locale.map { Locale(identifier: $0.replacingOccurrences(of: "-", with: "_")) } ?? Locale.current
    f.timeZone = TimeZone(identifier: "UTC")
    f.setLocalizedDateFormatFromTemplate(template)
    return f
}

private func monthDate(_ year: Int, _ month: Int) -> Date {
    Date(timeIntervalSince1970: Double(winnowUtcDay(year: year, monthIndex: month - 1, day: 1)) * winnowDayMs / 1000)
}

/// `2025-07` → `July 2025`, in the viewer's language.
public func monthLabel(_ key: String, locale: String? = nil) -> String {
    guard let (y, m) = yearMonth(key) else { return key }
    return monthFormatter("MMMMy", locale).string(from: monthDate(y, m))
}

public struct MonthOption: Equatable, Sendable {
    public var key: String
    public var label: String

    public init(key: String, label: String) { self.key = key; self.label = label }
}

public struct YearOptions: Equatable, Sendable {
    public var year: String
    /// Oldest first inside a year — a picker reads January to December.
    public var months: [MonthOption]

    public init(year: String, months: [MonthOption]) { self.year = year; self.months = months }
}

/// Every month between two dates, grouped by year for a picker with one group
/// per year — newest year first, so the recent trip is at the top. Empty when
/// the bounds are inverted.
public func monthOptions(_ minIso: String, _ maxIso: String, locale: String? = nil) -> [YearOptions] {
    let first = monthKeyOf(minIso)
    let last = monthKeyOf(maxIso)
    if first > last { return [] }
    let formatter = monthFormatter("MMMM", locale)
    var order: [String] = []
    var byYear: [String: [MonthOption]] = [:]
    var key = first
    while key <= last {
        let year = String(key.prefix(4))
        guard let (y, m) = yearMonth(key) else { break }
        let label = formatter.string(from: monthDate(y, m))
        if byYear[year] == nil { order.append(year) }
        byYear[year, default: []].append(MonthOption(key: key, label: label))
        let next = shiftMonth(key, 1)
        if next <= key { break }
        key = next
    }
    return order.sorted { $0 > $1 }.map { YearOptions(year: $0, months: byYear[$0] ?? []) }
}
