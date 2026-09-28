// The badge's TEMPORAL line — the distance between the day a picture was taken
// and the day it is being posted. Port of `src/shared/roadtrip/time-ago.ts`.
//
// This replaced the old "one year ago today" boolean, which fired on any date
// a year or more after the shot and so announced an anniversary on days that
// were not one. The rule here is the one the whole tool holds — **never state
// something that is not true of this picture** — so `anniversary` fires only
// on the actual anniversary (same month, same day), and every other mode says
// something that is true on any day.
//
// The reference day is an INPUT, never the clock: a post is written before it
// goes out, and the line has to read correctly on the day it is published,
// not on the day it was composed.

import Foundation

/// The mode ids are stored on the trip, so each raw value is the web's.
public enum TimeAgoMode: String, CaseIterable, Codable, Sendable {
    /// No temporal line; the kicker is the trip's name.
    case off
    /// The truest striking line for this gap, chosen per post.
    case auto
    /// "1 year ago today" — ONLY on the real anniversary.
    case anniversary
    /// "1 year 4 months ago".
    case yearsMonths = "years-months"
    /// "1 247 days ago" — the one that makes a viewer stop.
    case daysAgo = "days-ago"
    /// "178 weeks ago".
    case weeksAgo = "weeks-ago"
    /// "17 months ago".
    case monthsAgo = "months-ago"
    /// "since 27 Mar 2025" — a fact with no arithmetic to doubt.
    case since
}

/// A mode as the panel offers it: described by what it measures, never by an
/// example of what it would say.
public struct TimeAgoModeEntry: Equatable, Sendable {
    public var id: TimeAgoMode
    public var label: String
    public var hint: String
    public init(id: TimeAgoMode, label: String, hint: String) { self.id = id; self.label = label; self.hint = hint }
}

/// The modes, in the panel's order. "1 year 4 months ago" as a hint beside a
/// picture taken last week is a fabricated value; `timeAgoPreviews` gives the
/// real line instead. The web's `TIME_AGO_MODES`.
public let timeAgoModes: [TimeAgoModeEntry] = [
    TimeAgoModeEntry(id: .off, label: "Off", hint: "No line about when"),
    TimeAgoModeEntry(id: .auto, label: "Auto", hint: "The truest striking line for this gap"),
    TimeAgoModeEntry(id: .anniversary, label: "Anniversary", hint: "Only on the real anniversary"),
    TimeAgoModeEntry(id: .yearsMonths, label: "Years + months", hint: "Years, then the odd months"),
    TimeAgoModeEntry(id: .monthsAgo, label: "Months", hint: "Whole calendar months"),
    TimeAgoModeEntry(id: .weeksAgo, label: "Weeks", hint: "Whole weeks"),
    TimeAgoModeEntry(id: .daysAgo, label: "Days", hint: "Every day counted"),
    TimeAgoModeEntry(id: .since, label: "Since the date", hint: "The picture’s own day, written out"),
]

/// One mode, as it would really read for a given picture and reading day.
public struct TimeAgoPreview: Equatable, Sendable {
    public var id: TimeAgoMode
    public var label: String
    public var hint: String
    /// The line, or nil when this mode has nothing true to say.
    public var text: String?
    public init(id: TimeAgoMode, label: String, hint: String, text: String?) {
        self.id = id; self.label = label; self.hint = hint; self.text = text
    }
}

/// What each mode would actually say about this picture on this day. A mode
/// with nothing true to say answers nil — an anniversary that has not come
/// round, a gap too short for the unit — and the panel shows that as such
/// rather than as an example.
public func timeAgoPreviews(_ date: IsoDate, _ reference: IsoDate, _ words: TimeAgoWords) -> [TimeAgoPreview] {
    timeAgoModes.map {
        TimeAgoPreview(id: $0.id, label: $0.label, hint: $0.hint, text: timeAgoLine(date, reference, $0.id, words))
    }
}

/// Every word the temporal line can say. Unit nouns are shared with the
/// counter's own `day`/`days`, so "Day 27" and "1247 days ago" can never
/// disagree about how the word is spelled. Every word is an editable field on
/// the trip.
public struct TimeAgoWords: Equatable, Sendable {
    public var day: String
    public var days: String
    public var week: String
    public var weeks: String
    public var month: String
    public var months: String
    public var year: String
    public var years: String
    /// `{n}` is the whole quantity phrase — "1247 days", "1 year 4 months".
    public var agoTemplate: String
    /// `{date}` is the picture's own day, written out.
    public var sinceTemplate: String
    /// The exact anniversary, one year on.
    public var anniversary: String
    /// The exact anniversary, `{n}` years on.
    public var anniversaryPlural: String

    public init(day: String, days: String, week: String, weeks: String, month: String, months: String,
                year: String, years: String, agoTemplate: String, sinceTemplate: String,
                anniversary: String, anniversaryPlural: String) {
        self.day = day; self.days = days; self.week = week; self.weeks = weeks
        self.month = month; self.months = months; self.year = year; self.years = years
        self.agoTemplate = agoTemplate; self.sinceTemplate = sinceTemplate
        self.anniversary = anniversary; self.anniversaryPlural = anniversaryPlural
    }

    /// One word by its key — what an editor of the trip's words writes through.
    public subscript(key: TimeAgoWordKey) -> String {
        get {
            switch key {
            case .day: return day
            case .days: return days
            case .week: return week
            case .weeks: return weeks
            case .month: return month
            case .months: return months
            case .year: return year
            case .years: return years
            case .agoTemplate: return agoTemplate
            case .sinceTemplate: return sinceTemplate
            case .anniversary: return anniversary
            case .anniversaryPlural: return anniversaryPlural
            }
        }
        set {
            switch key {
            case .day: day = newValue
            case .days: days = newValue
            case .week: week = newValue
            case .weeks: weeks = newValue
            case .month: month = newValue
            case .months: months = newValue
            case .year: year = newValue
            case .years: years = newValue
            case .agoTemplate: agoTemplate = newValue
            case .sinceTemplate: sinceTemplate = newValue
            case .anniversary: anniversary = newValue
            case .anniversaryPlural: anniversaryPlural = newValue
            }
        }
    }
}

/// A field of `TimeAgoWords`, named as the web's `keyof TimeAgoWords` names it.
public enum TimeAgoWordKey: String, CaseIterable, Sendable {
    case day, days, week, weeks, month, months, year, years
    case agoTemplate, sinceTemplate, anniversary, anniversaryPlural
}

/// The web's `DEFAULT_TIME_AGO_WORDS` — English is the default.
public let defaultTimeAgoWords = TimeAgoWords(
    day: "day", days: "days", week: "week", weeks: "weeks",
    month: "month", months: "months", year: "year", years: "years",
    agoTemplate: "{n} ago", sinceTemplate: "since {date}",
    anniversary: "1 year ago today", anniversaryPlural: "{n} years ago today")

/// The web's `FRENCH_TIME_AGO_WORDS`.
public let frenchTimeAgoWords = TimeAgoWords(
    day: "jour", days: "jours", week: "semaine", weeks: "semaines",
    month: "mois", months: "mois", year: "an", years: "ans",
    agoTemplate: "il y a {n}", sinceTemplate: "depuis le {date}",
    anniversary: "il y a 1 an, jour pour jour", anniversaryPlural: "il y a {n} ans, jour pour jour")

/// A word the trip's settings offer to edit, with its label.
public struct TimeAgoWordField: Equatable, Sendable {
    public var key: TimeAgoWordKey
    public var label: String
    public init(key: TimeAgoWordKey, label: String) { self.key = key; self.label = label }
}

/// The web's `TIME_AGO_WORD_FIELDS`, in its order.
public let timeAgoWordFields: [TimeAgoWordField] = [
    TimeAgoWordField(key: .agoTemplate, label: "… ago"),
    TimeAgoWordField(key: .sinceTemplate, label: "Since"),
    TimeAgoWordField(key: .anniversary, label: "Anniversary"),
    TimeAgoWordField(key: .anniversaryPlural, label: "Anniversary (n)"),
    TimeAgoWordField(key: .week, label: "week"),
    TimeAgoWordField(key: .weeks, label: "weeks"),
    TimeAgoWordField(key: .month, label: "month"),
    TimeAgoWordField(key: .months, label: "months"),
    TimeAgoWordField(key: .year, label: "year"),
    TimeAgoWordField(key: .years, label: "years"),
]

/// "1 day" / "12 days" — the noun picked by the number, never by a rule.
private func timeQuantity(_ n: Int, _ singular: String, _ plural: String) -> String {
    "\(n) \(n == 1 ? singular : plural)"
}

/// JavaScript's `String.prototype.replace` with a string pattern: the FIRST
/// occurrence only.
private func replacingFirst(_ text: String, _ pattern: String, _ with: String) -> String {
    guard let range = text.range(of: pattern) else { return text }
    return text.replacingCharacters(in: range, with: with)
}

/// How far apart two days are, in every unit the line might use. Negative days
/// mean the reference precedes the picture, which the caller treats as
/// "nothing to say".
public struct TimeGap: Equatable, Sendable {
    public var days: Int
    public var weeks: Int
    public var months: Int
    public var years: Int
    /// True only on the same month-and-day, a year or more later.
    public var isAnniversary: Bool
    public init(days: Int, weeks: Int, months: Int, years: Int, isAnniversary: Bool) {
        self.days = days; self.weeks = weeks; self.months = months; self.years = years
        self.isAnniversary = isAnniversary
    }
}

/// Nil when either date is unreadable.
public func timeGap(_ from: IsoDate, _ to: IsoDate) -> TimeGap? {
    guard let days = daysBetween(from, to), let months = monthsBetween(from, to),
          let years = yearsBetween(from, to) else { return nil }
    let weeks = Int((Double(days) / 7).rounded(.down))
    return TimeGap(days: days, weeks: weeks, months: months, years: years,
                   isAnniversary: years >= 1 && sameDayOfYear(from, to))
}

/// Which mode `auto` resolves to for a given gap. Every branch is a statement
/// that is true on the day it is read — the anniversary only on the day it
/// really is one, and the coarser units only once they have something to say.
public func autoMode(_ gap: TimeGap) -> TimeAgoMode {
    if gap.isAnniversary { return .anniversary }
    if gap.years >= 1 { return .yearsMonths }
    if gap.months >= 2 { return .monthsAgo }
    if gap.days >= 14 { return .weeksAgo }
    return .daysAgo
}

/// The temporal line for a picture taken on `from`, read on `to`.
///
/// Nil when there is nothing true to say: the reference day is the picture's
/// own day or earlier, the dates do not parse, or `anniversary` was asked for
/// on a day that is not one. A nil falls back to the trip's name rather than
/// printing an empty kicker.
public func timeAgoLine(_ from: IsoDate, _ to: IsoDate, _ mode: TimeAgoMode, _ words: TimeAgoWords) -> String? {
    if mode == .off { return nil }
    guard let gap = timeGap(from, to) else { return nil }

    // "since" states a date and needs no elapsed time to be true.
    if mode == .since { return replacingFirst(words.sinceTemplate, "{date}", formatIsoDate(from)) }
    if gap.days <= 0 { return nil }

    let resolved = mode == .auto ? autoMode(gap) : mode
    func ago(_ phrase: String) -> String { replacingFirst(words.agoTemplate, "{n}", phrase) }

    switch resolved {
    case .anniversary:
        // Explicitly asked for on a day that is not the anniversary: say
        // nothing rather than announce one that has not come round.
        if !gap.isAnniversary { return nil }
        return gap.years == 1 ? words.anniversary : replacingFirst(words.anniversaryPlural, "{n}", String(gap.years))
    case .yearsMonths:
        if gap.years < 1 { return ago(timeQuantity(gap.months, words.month, words.months)) }
        let trailing = gap.months - gap.years * 12
        let yearPart = timeQuantity(gap.years, words.year, words.years)
        return ago(trailing > 0 ? "\(yearPart) \(timeQuantity(trailing, words.month, words.months))" : yearPart)
    case .monthsAgo:
        return ago(timeQuantity(gap.months, words.month, words.months))
    case .weeksAgo:
        return ago(timeQuantity(gap.weeks, words.week, words.weeks))
    case .daysAgo, .off, .auto, .since:
        return ago(timeQuantity(gap.days, words.day, words.days))
    }
}
