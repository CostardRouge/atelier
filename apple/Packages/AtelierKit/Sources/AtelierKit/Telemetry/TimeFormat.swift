// Capture-time formatting — pure, machine-independent. Port of
// `src/shared/telemetry/time-format.ts`.
//
// What DJI actually writes: the `.srt` carries a bare wall-clock string,
// `2026-05-30 05:49:34.609`. No UTC offset, no zone name — whatever the
// aircraft's clock said, which is whatever the controller (and before it, the
// phone) had set. Nothing in the file says where on Earth that reading belongs.
//
// Why there is no timezone picker: converting a timestamp between zones needs
// the zone it came FROM, which is unknown, and a dropdown would be false
// precision. What is honest — and what fixes the real cases — is a SHIFT: the
// author knows their clock was an hour off, or set to the wrong day, and says
// so. Hours and minutes both (India, Nepal, Chatham), and whole days.
//
// Why the arithmetic is zone-free: the web goes through `Date.UTC` and
// `getUTC*` so the rendering machine's zone can never move a value. Here the
// calendar is plain integer arithmetic (days from the civil date, and back),
// never Foundation's `Calendar` — no zone, no locale, no ICU lookup, the same
// string on every device. `Telemetry.swift`'s private `wallClockMillis` is
// the older twin of `toEpoch(parseWallClock(_:))`, kept for its own caller.

import Foundation

/// A calendar reading with no zone attached — exactly what the SRT gives us.
public struct WallClock: Equatable, Sendable {
    public var year: Int
    /// 1..12
    public var month: Int
    /// 1..31
    public var day: Int
    /// 0..23
    public var hour: Int
    public var minute: Int
    public var second: Int
    public var ms: Int

    public init(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int, ms: Int) {
        self.year = year
        self.month = month
        self.day = day
        self.hour = hour
        self.minute = minute
        self.second = second
        self.ms = ms
    }
}

public enum DateStyle: String, Sendable, CaseIterable {
    /// 2026-05-30
    case iso
    /// 30/05/2026
    case dmy
    /// 05/30/2026
    case mdy
    /// 30 May 2026
    case longDmy = "long-dmy"
    /// May 30, 2026
    case longMdy = "long-mdy"
    /// Sat 30 May 2026
    case weekday
}

public struct TimeFormatOptions: Equatable, Sendable {
    /// 12-hour clock rather than 24-hour.
    public var hour12: Bool
    /// Print AM/PM. Only meaningful with `hour12`.
    public var meridiem: Bool
    /// Include seconds.
    public var seconds: Bool
    /// Include milliseconds (the SRT has them).
    public var milliseconds: Bool
    /// How a date reads.
    public var dateStyle: DateStyle

    public init(hour12: Bool = false, meridiem: Bool = true, seconds: Bool = true,
                milliseconds: Bool = false, dateStyle: DateStyle = .iso) {
        self.hour12 = hour12
        self.meridiem = meridiem
        self.seconds = seconds
        self.milliseconds = milliseconds
        self.dateStyle = dateStyle
    }

    public static let `default` = TimeFormatOptions()
}

/// A correction applied to the capture time. See the note above.
public struct TimeShift: Equatable, Sendable {
    /// Signed minutes — carries into hours and rolls the date.
    public var minutes: Double
    /// Signed whole days, for a clock set to the wrong date entirely.
    public var days: Double

    public init(minutes: Double, days: Double) {
        self.minutes = minutes
        self.days = days
    }

    /// The web's `NO_SHIFT`.
    public static let noShift = TimeShift(minutes: 0, days: 0)
}

private let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
private let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

private let stampRe = try! NSRegularExpression(
    pattern: #"(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?"#
)

private func captured(_ m: NSTextCheckingResult, _ i: Int, in s: String) -> String? {
    let r = m.range(at: i)
    guard r.location != NSNotFound, let range = Range(r, in: s) else { return nil }
    return String(s[range])
}

/// Read a DJI timestamp line into calendar parts. Returns nil when the string
/// carries no recognisable date-and-time, so callers fall back to "—" rather
/// than to a fabricated moment.
public func parseWallClock(_ stamp: String?) -> WallClock? {
    guard let stamp, !stamp.isEmpty else { return nil }
    guard let m = stampRe.firstMatch(in: stamp, range: NSRange(stamp.startIndex..., in: stamp)) else { return nil }
    guard let y = captured(m, 1, in: stamp).flatMap({ Int($0) }),
          let mo = captured(m, 2, in: stamp).flatMap({ Int($0) }),
          let d = captured(m, 3, in: stamp).flatMap({ Int($0) }),
          let h = captured(m, 4, in: stamp).flatMap({ Int($0) }),
          let mi = captured(m, 5, in: stamp).flatMap({ Int($0) }) else { return nil }
    let s = captured(m, 6, in: stamp).flatMap { Int($0) } ?? 0
    // `.25` is 250 ms: the digits are padded to three on the right.
    let ms = captured(m, 7, in: stamp).flatMap { Int($0.padding(toLength: 3, withPad: "0", startingAt: 0)) } ?? 0
    let clock = WallClock(year: y, month: mo, day: d, hour: h, minute: mi, second: s, ms: ms)
    if clock.month < 1 || clock.month > 12 || clock.day < 1 || clock.day > 31 { return nil }
    if clock.hour > 23 || clock.minute > 59 || clock.second > 59 { return nil }
    return clock
}

// MARK: - the zone-free calendar

/// Days since 1970-01-01 for a civil date; a day past the month's end rolls
/// forward exactly as `Date.UTC` rolls it (Howard Hinnant's algorithm).
private func daysFromCivil(_ year: Int, _ month: Int, _ day: Int) -> Int {
    // A month outside 1...12 carries into the year, as `Date.UTC` carries it.
    let m0 = month - 1
    let carry = m0 >= 0 ? m0 / 12 : -((-m0 + 11) / 12)
    var y = year + carry
    let m = ((m0 % 12) + 12) % 12 + 1
    y -= m <= 2 ? 1 : 0
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (m + 9) % 12
    let doy = (153 * mp + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
}

private func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
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

private let msPerDay = 86_400_000.0

/// Epoch milliseconds for a zone-free reading, computed as `Date.UTC` would,
/// so the rendering machine's own zone can never move it. Public because
/// measuring a clip's cadence needs to subtract two readings.
public func toEpoch(_ wc: WallClock) -> Double {
    let days = Double(daysFromCivil(wc.year, wc.month, wc.day))
    let clock = Double(wc.hour) * 3_600_000 + Double(wc.minute) * 60_000
    let rest = Double(wc.second) * 1000 + Double(wc.ms)
    return days * msPerDay + clock + rest
}

private func fromEpoch(_ ms: Double) -> WallClock {
    let whole = ms.rounded(.down)
    let days = Int((whole / msPerDay).rounded(.down))
    var rem = Int(whole - Double(days) * msPerDay)
    let civil = civilFromDays(days)
    let hour = rem / 3_600_000
    rem %= 3_600_000
    let minute = rem / 60_000
    rem %= 60_000
    let second = rem / 1000
    let msPart = rem % 1000
    return WallClock(year: civil.year, month: civil.month, day: civil.day,
                     hour: hour, minute: minute, second: second, ms: msPart)
}

/// Apply the author's correction. Minutes carry naturally into hours and roll
/// the date — 23:30 shifted +60 is 00:30 the next day, which is the whole point
/// of doing this on a real calendar rather than with a modulo on the hour.
public func shiftWallClock(_ wc: WallClock, _ shift: TimeShift?) -> WallClock {
    guard let shift, shift.minutes != 0 || shift.days != 0 else { return wc }
    let ms = toEpoch(wc) + shift.minutes * 60_000 + shift.days * msPerDay
    return fromEpoch(ms)
}

/// Day of the week for a reading, 0 = Sunday.
public func weekdayOf(_ wc: WallClock) -> Int {
    // 1970-01-01 was a Thursday.
    let days = daysFromCivil(wc.year, wc.month, wc.day)
    return (((days + 4) % 7) + 7) % 7
}

// MARK: - formatting

private func pad(_ n: Int, _ width: Int = 2) -> String {
    let text = String(n)
    return text.count >= width ? text : String(repeating: "0", count: width - text.count) + text
}

private func monthName(_ month: Int) -> String {
    month >= 1 && month <= 12 ? months[month - 1] : ""
}

/// The time of day, e.g. `05:49:34`, `5:49:34 AM`, `17:49`.
public func formatClock(_ wc: WallClock, _ opts: TimeFormatOptions = .default) -> String {
    // 12-hour hours are unpadded (1:05 PM, not 01:05 PM); 24-hour hours are
    // padded, which is what keeps a HUD readout from twitching in width.
    var hour: String
    var suffix = ""
    if opts.hour12 {
        let h = wc.hour % 12 == 0 ? 12 : wc.hour % 12
        hour = String(h)
        if opts.meridiem { suffix = wc.hour < 12 ? " AM" : " PM" }
    } else {
        hour = pad(wc.hour)
    }

    var text = "\(hour):\(pad(wc.minute))"
    if opts.seconds { text += ":\(pad(wc.second))" }
    if opts.milliseconds { text += ".\(pad(wc.ms, 3))" }
    return text + suffix
}

/// The calendar date in the chosen style.
public func formatDate(_ wc: WallClock, _ opts: TimeFormatOptions = .default) -> String {
    let mon = monthName(wc.month)
    switch opts.dateStyle {
    case .dmy:
        return "\(pad(wc.day))/\(pad(wc.month))/\(wc.year)"
    case .mdy:
        return "\(pad(wc.month))/\(pad(wc.day))/\(wc.year)"
    case .longDmy:
        return "\(wc.day) \(mon) \(wc.year)"
    case .longMdy:
        return "\(mon) \(wc.day), \(wc.year)"
    case .weekday:
        return "\(weekdays[weekdayOf(wc)]) \(wc.day) \(mon) \(wc.year)"
    case .iso:
        return "\(wc.year)-\(pad(wc.month))-\(pad(wc.day))"
    }
}

/// Date and time together, each in its chosen style.
public func formatTimestamp(_ wc: WallClock, _ opts: TimeFormatOptions = .default) -> String {
    "\(formatDate(wc, opts)) \(formatClock(wc, opts))"
}
