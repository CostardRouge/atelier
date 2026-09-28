// What the Winnow ports share and the web gets for free from JavaScript:
// reading a wire value the way `str()` / `num()` in `client.ts` do, writing a
// number the way `String(n)` does, and `Date.parse` / the `getUTC*` getters /
// `toISOString` for the instants Winnow stamps its rows with.
//
// Internal and prefixed: every name here is used by several files of
// `Sources/Winnow/` and none of them is anybody else's vocabulary.
//
// The date arithmetic is JavaScript's own — proleptic Gregorian civil days,
// no `Calendar` — so an instant read here lands on the day it lands on in the
// browser. The one place a zone enters is JavaScript's: an ISO date-TIME with
// no offset is LOCAL time (a date alone is UTC), and the zone is an argument.

import Foundation

// MARK: - wire values

/// The web's `str()`: a string as-is, a finite number as JavaScript writes it,
/// anything else nil.
func winnowString(_ value: JSONValue?) -> String? {
    switch value {
    case .string(let s)?: return s
    case .number(let n)? where n.isFinite: return winnowJsNumber(n)
    default: return nil
    }
}

/// The web's `num()`: a finite number, else nil.
func winnowNumber(_ value: JSONValue?) -> Double? {
    value?.finiteNumber
}

/// A whole finite number as an `Int` — an id, a byte count, a pixel size.
/// A fraction or a value past 2^53 is not one of those, and reads as nil.
func winnowInt(_ value: JSONValue?) -> Int? {
    guard let n = value?.finiteNumber, n == n.rounded(), abs(n) < 9_007_199_254_740_992 else { return nil }
    return Int(n)
}

/// A non-empty string, else nil — the web's truthy-string test.
func winnowText(_ value: JSONValue?) -> String? {
    guard let s = value?.stringValue, !s.isEmpty else { return nil }
    return s
}

/// JavaScript's `String(n)` / `${n}` for a finite number: an integer-valued
/// number prints without `.0`.
func winnowJsNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e21 {
        if abs(x) < 9_007_199_254_740_992 { return String(Int64(x)) }
    }
    return "\(x)"
}

/// `String(n).padStart(2, '0')`.
func winnowPad2(_ n: Int) -> String {
    n < 10 && n >= 0 ? "0\(n)" : String(n)
}

// MARK: - civil days, the way JavaScript counts them

let winnowDayMs = 86_400_000.0

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's
/// `days_from_civil`); `m` is 1–12, `d` may run past the month, linearly.
func winnowDaysFromCivil(_ year: Int, _ m: Int, _ d: Int) -> Int {
    let y = m <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = m > 2 ? m - 3 : m + 9
    let doy = (153 * mp + 2) / 5 + d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

/// The inverse of `winnowDaysFromCivil`.
func winnowCivilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
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

/// `Date.UTC(year, monthIndex, day)` with JavaScript's roll-over: a month
/// past 11 or below 0 moves the year, a day past the month moves the month.
func winnowUtcDay(year: Int, monthIndex: Int, day: Int) -> Int {
    let total = year * 12 + monthIndex
    let y = total >= 0 ? total / 12 : (total - 11) / 12
    let m = total - y * 12
    return winnowDaysFromCivil(y, m + 1, 1) + (day - 1)
}

/// The `getUTC*` getters of an instant, in ms since the epoch.
struct WinnowUtcParts {
    var year: Int
    /// 1–12, not JavaScript's 0–11.
    var month: Int
    var day: Int
    var hour: Int
    var minute: Int
    var second: Int
    var millisecond: Int
    /// `getUTCDay()`: 0 = Sunday.
    var weekday: Int
}

func winnowUtcParts(_ ms: Double) -> WinnowUtcParts {
    let days = Int((ms / winnowDayMs).rounded(.down))
    let rest = Int(ms - Double(days) * winnowDayMs)
    let civil = winnowCivilFromDays(days)
    let weekday = ((days % 7) + 7 + 4) % 7
    return WinnowUtcParts(
        year: civil.year, month: civil.month, day: civil.day,
        hour: rest / 3_600_000, minute: (rest / 60_000) % 60, second: (rest / 1000) % 60,
        millisecond: rest % 1000, weekday: weekday
    )
}

/// `new Date(ms).toISOString()`.
func winnowIsoString(_ ms: Double) -> String {
    let p = winnowUtcParts(ms)
    let year = p.year >= 0 && p.year < 10000
        ? String(repeating: "0", count: max(0, 4 - String(p.year).count)) + String(p.year)
        : String(p.year)
    let milli = p.millisecond < 10 ? "00\(p.millisecond)" : p.millisecond < 100 ? "0\(p.millisecond)" : "\(p.millisecond)"
    return "\(year)-\(winnowPad2(p.month))-\(winnowPad2(p.day))T\(winnowPad2(p.hour)):\(winnowPad2(p.minute)):\(winnowPad2(p.second)).\(milli)Z"
}

/// A wall-clock time in `timeZone` as an instant — JavaScript's
/// `new Date(y, m, d, h)` with the zone made an argument.
func winnowLocalMs(year: Int, monthIndex: Int, day: Int, hour: Int, minute: Int = 0, second: Int = 0,
                   millisecond: Int = 0, timeZone: TimeZone) -> Double {
    let days = winnowUtcDay(year: year, monthIndex: monthIndex, day: day)
    let wall = Double(days) * winnowDayMs + Double(hour) * 3_600_000 + Double(minute) * 60_000
        + Double(second) * 1000 + Double(millisecond)
    let firstGuess = Double(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: wall / 1000))) * 1000
    let offset = Double(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: (wall - firstGuess) / 1000))) * 1000
    return wall - offset
}

// MARK: - Date.parse, for the ISO forms an instance sends

/// JavaScript's `Date.parse` for the ISO 8601 forms a Winnow row carries —
/// `2025-07-09`, `2025-07-09T08:30:15.000Z`, `…+00:00`, `…T08:30` — in ms, or
/// nil where the browser answers NaN. A date alone is UTC; a date-time with no
/// offset is local time, in `timeZone`. A space may stand for the `T`, as V8
/// accepts. Anything else (`someday`, a month name) is nil: the web's legacy
/// fallbacks are not a format anything here writes.
func winnowParseInstant(_ text: String, timeZone: TimeZone = .current) -> Double? {
    let b = Array(text.utf8)
    var i = 0
    func digits(_ n: Int) -> Int? {
        guard i + n <= b.count else { return nil }
        var v = 0
        for k in i..<(i + n) {
            let c = b[k]
            guard c >= 48, c <= 57 else { return nil }
            v = v * 10 + Int(c - 48)
        }
        i += n
        return v
    }
    func take(_ c: UInt8) -> Bool {
        guard i < b.count, b[i] == c else { return false }
        i += 1
        return true
    }
    guard let year = digits(4) else { return nil }
    var month = 1, day = 1
    if take(UInt8(ascii: "-")) {
        guard let m = digits(2) else { return nil }
        month = m
        if take(UInt8(ascii: "-")) {
            guard let d = digits(2) else { return nil }
            day = d
        }
    }
    guard month >= 1, month <= 12, day >= 1, day <= 31 else { return nil }
    let dayCount = winnowDaysFromCivil(year, month, day)
    if i == b.count { return Double(dayCount) * winnowDayMs }

    guard take(UInt8(ascii: "T")) || take(UInt8(ascii: " ")),
          let hour = digits(2), take(UInt8(ascii: ":")), let minute = digits(2) else { return nil }
    var second = 0, milli = 0
    if take(UInt8(ascii: ":")) {
        guard let s = digits(2) else { return nil }
        second = s
        if take(UInt8(ascii: ".")) || take(UInt8(ascii: ",")) {
            var count = 0, value = 0
            while i < b.count, b[i] >= 48, b[i] <= 57 {
                if count < 3 { value = value * 10 + Int(b[i] - 48) }
                count += 1
                i += 1
            }
            guard count > 0 else { return nil }
            var scale = count
            while scale < 3 {
                value *= 10
                scale += 1
            }
            milli = value
        }
    }
    guard minute <= 59, second <= 59,
          hour < 24 || (hour == 24 && minute == 0 && second == 0 && milli == 0) else { return nil }
    let wall = Double(dayCount) * winnowDayMs + Double(hour) * 3_600_000 + Double(minute) * 60_000
        + Double(second) * 1000 + Double(milli)

    if i == b.count {
        return winnowLocalMs(year: year, monthIndex: month - 1, day: day, hour: hour, minute: minute,
                             second: second, millisecond: milli, timeZone: timeZone)
    }
    if take(UInt8(ascii: "Z")) || take(UInt8(ascii: "z")) {
        return i == b.count ? wall : nil
    }
    let sign: Double
    if take(UInt8(ascii: "+")) { sign = 1 } else if take(UInt8(ascii: "-")) { sign = -1 } else { return nil }
    guard let oh = digits(2) else { return nil }
    _ = take(UInt8(ascii: ":"))
    guard let om = digits(2), i == b.count, oh <= 23, om <= 59 else { return nil }
    return wall - sign * (Double(oh) * 3_600_000 + Double(om) * 60_000)
}
