// What the day badge SAYS, as the trip document stores it — port of the
// stored half of `src/shared/roadtrip/day-badge.ts`: the counter's modes, the
// badge's pieces, and every word the badge can say.
//
// Types + reader only; the behaviour of `day-badge.ts` (the content of a
// badge for a post, the counter's pieces and their previews, the camera
// plate's input) is ported later INTO THIS FILE.
//
// Rules kept:
// - The words are DATA and English is only their default: every one is an
//   editable field on the trip, so a deck in another language is a handful of
//   fields, never a second vocabulary in the code (the French set is a button,
//   not a built-in language).
// - The place marker is a geometric glyph (◆), never an emoji: measured, an
//   emoji default drew NOTHING where no colour-emoji font existed.
// - The camera plate's words are optional: a trip written before the plate
//   existed has none and reads the English defaults.

import Foundation

/// What the headline counts.
public enum CounterMode: String, CaseIterable, Sendable {
    /// The day of the trip — "Day · 27 · of 310". The founding case.
    case day
    /// A post covering several days — "Days · 27–29 · of 310".
    case dayRange = "day-range"
    /// Where the day sits inside its stage — "Kalbarri · 2 · of 3".
    case stageDay = "stage-day"
    /// How long the trip stayed there — "3 · days in Kalbarri".
    case stageLength = "stage-length"
}

/// The badge's pieces, top to bottom.
public enum BadgePiece: String, CaseIterable, Sendable {
    case kicker, label, headline, counter, caption, timing, exif
}

/// Every word the badge can say.
public struct BadgeWords: Equatable, Sendable {
    /// The counter's LABEL — "Day 27". Capitalised, and separate from the unit
    /// noun in `time` ("515 days ago").
    public var day: String
    public var days: String
    public var of: String
    /// "3 days **in** Kalbarri".
    public var at: String
    /// The marker set before the place — a geometric glyph, not an emoji.
    public var pin: String
    /// Everything the temporal line says (`TimeAgo.swift`).
    public var time: TimeAgoWords
    /// The camera plate's words; nil on a trip that never set them.
    public var camera: CameraWords?

    public init(day: String, days: String, of: String, at: String, pin: String, time: TimeAgoWords, camera: CameraWords? = nil) {
        self.day = day; self.days = days; self.of = of; self.at = at; self.pin = pin; self.time = time; self.camera = camera
    }

    /// The words as the trip holds them — `camera` only when set.
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "day": .string(day), "days": .string(days), "of": .string(of), "at": .string(at),
            "pin": .string(pin), "time": time.json,
        ]
        if let camera { o["camera"] = camera.json }
        return .object(o)
    }
}

/// The place marker every new trip starts with: ◆.
public let badgePinGlyph = "\u{25C6}"

/// The web's `DEFAULT_BADGE_WORDS` — English.
public let defaultBadgeWords = BadgeWords(day: "Day", days: "Days", of: "of", at: "in", pin: badgePinGlyph, time: defaultTimeAgoWords)

/// The web's `FRENCH_BADGE_WORDS` — what the "write it in French" button fills.
public let frenchBadgeWords = BadgeWords(day: "Jour", days: "Jours", of: "sur", at: "à", pin: badgePinGlyph,
                                         time: frenchTimeAgoWords, camera: frenchCameraWords)

extension TimeAgoWords {
    /// The words as the trip holds them, every key written.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        for key in TimeAgoWordKey.allCases { o[key.rawValue] = .string(self[key]) }
        return .object(o)
    }
}

/// Stored temporal words read back — a missing or non-text word takes its
/// English default, a typed one (blank included) is kept.
public func readTimeAgoWords(_ raw: JSONValue?) -> TimeAgoWords {
    var out = defaultTimeAgoWords
    let o = raw?.objectValue ?? [:]
    for key in TimeAgoWordKey.allCases {
        if let word = o[key.rawValue]?.stringValue { out[key] = word }
    }
    return out
}

/// A trip's stored words read back — a missing or non-text word takes its
/// English default, a typed one (blank included) is kept. The web never
/// re-reads them on a current document; this is the port's reading of one.
public func readBadgeWords(_ raw: JSONValue?) -> BadgeWords {
    let o = raw?.objectValue ?? [:]
    let d = defaultBadgeWords
    return BadgeWords(
        day: o["day"]?.stringValue ?? d.day,
        days: o["days"]?.stringValue ?? d.days,
        of: o["of"]?.stringValue ?? d.of,
        at: o["at"]?.stringValue ?? d.at,
        pin: o["pin"]?.stringValue ?? d.pin,
        time: readTimeAgoWords(o["time"]),
        camera: readCameraWords(o["camera"])
    )
}
