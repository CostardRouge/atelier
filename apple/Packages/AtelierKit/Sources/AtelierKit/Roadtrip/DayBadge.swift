// What the day badge SAYS — port of `src/shared/roadtrip/day-badge.ts`: the
// counter's modes, the badge's pieces and every word the badge can say (as the
// trip stores them), then (`MARK: - what a badge says`) the content of a badge
// for a post, the counter's pieces and their previews.
//
// Rules kept:
// - ONE dominant number, everything else subordinate: the word ("Day") is a
//   piece of its own, never part of the headline.
// - Nothing is fabricated: a stage counter over a day no stage covers (or a
//   stage naming no place) falls back to the day of the trip AND says why; a
//   preview is the real line for the post in hand, or a reason.
// - The WHEN line is a piece of its own under the place — it never displaces
//   the trip's name; it reads the reference day, else the caller's today.
// - The camera credit is asked for AND measured: off draws nothing, a picture
//   recording none of the chosen facts draws nothing, and a plate that is only
//   the plain line is that line. An override is always the plain line.
// - An emptied override means "computed", never "blank"; an override is trimmed.
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

// MARK: - what a badge says, computed (the type half of `badgeContent`)

/// Everything a camera plate is drawn from, bar where it lands.
public struct CameraPlateInput: Equatable, Sendable {
    public var facts: CameraFacts
    public var spec: CameraPlateSpec
    public var words: CameraWords

    public init(facts: CameraFacts, spec: CameraPlateSpec, words: CameraWords) {
        self.facts = facts; self.spec = spec; self.words = words
    }
}

/// The badge's pieces for one post. Any may be absent; the headline never is.
/// Computed at every render, never stored — what `badgeContent` returns (its
/// behaviour lands in this file with the rest of `day-badge.ts`) and what a
/// hook variant rewrites a piece of (`HookVariant.swift`).
public struct BadgeContent: Equatable, Sendable {
    /// Small line above — the trip's name.
    public var kicker: String?
    /// The word the number is of ("Day", or the place for a stage count).
    public var label: String?
    /// The dominant piece: the numeral, alone.
    public var headline: String
    /// What it is out of ("of 310"), read as subordinate.
    public var counter: String?
    /// Where it was.
    public var caption: String?
    /// Why it is going out now — "9 months ago", "1 year ago today".
    public var timing: String?
    /// What took it — "DJI Mini 4 Pro · 24 mm · ƒ/1.7 · 1/240 · ISO 100".
    public var exif: String?
    /// The camera credit COMPOSED, when it is more than the plain line; nil
    /// draws `exif` as the line it always was.
    public var plate: CameraPlateInput?

    public init(kicker: String? = nil, label: String? = nil, headline: String, counter: String? = nil,
                caption: String? = nil, timing: String? = nil, exif: String? = nil, plate: CameraPlateInput? = nil) {
        self.kicker = kicker; self.label = label; self.headline = headline; self.counter = counter
        self.caption = caption; self.timing = timing; self.exif = exif; self.plate = plate
    }

    /// One piece's text; the headline is never absent.
    public subscript(piece: BadgePiece) -> String? {
        switch piece {
        case .kicker: return kicker
        case .label: return label
        case .headline: return headline
        case .counter: return counter
        case .caption: return caption
        case .timing: return timing
        case .exif: return exif
        }
    }
}

// MARK: - what a badge says

/// A counter mode with a description of WHAT it counts — never an example of
/// what it would say. The web's `COUNTER_MODES`.
public struct CounterModeOption: Equatable, Sendable {
    public let id: CounterMode
    public let label: String
    public let hint: String
}

public let counterModes: [CounterModeOption] = [
    CounterModeOption(id: .day, label: "Day of trip", hint: "Where this day sits in the whole trip"),
    CounterModeOption(id: .dayRange, label: "Range of days", hint: "A piece covering several days"),
    CounterModeOption(id: .stageDay, label: "Day at the place", hint: "Which day of a stage this is"),
    CounterModeOption(id: .stageLength, label: "Days at the place", hint: "How long the trip stayed there"),
]

/// The web's `BADGE_PIECES`.
public struct BadgePieceOption: Equatable, Sendable {
    public let id: BadgePiece
    public let label: String
}

public let badgePieces: [BadgePieceOption] = [
    BadgePieceOption(id: .kicker, label: "Trip name"),
    BadgePieceOption(id: .label, label: "Word"),
    BadgePieceOption(id: .headline, label: "Number"),
    BadgePieceOption(id: .counter, label: "Out of"),
    BadgePieceOption(id: .caption, label: "Place"),
    BadgePieceOption(id: .timing, label: "When"),
    BadgePieceOption(id: .exif, label: "Camera"),
]

/// The five plain words a trip edits. The web's `WORD_FIELDS`.
public enum BadgeWordKey: String, CaseIterable, Sendable {
    case day, days, of, at, pin
}

public struct BadgeWordField: Equatable, Sendable {
    public let key: BadgeWordKey
    public let label: String
}

public let wordFields: [BadgeWordField] = [
    BadgeWordField(key: .day, label: "Day (singular)"),
    BadgeWordField(key: .days, label: "Days (plural)"),
    BadgeWordField(key: .of, label: "Out of"),
    BadgeWordField(key: .at, label: "At a place"),
    BadgeWordField(key: .pin, label: "Place marker"),
]

public struct BadgeOptions: Sendable {
    public var mode: CounterMode
    public var words: BadgeWords
    /// What the WHEN line says. `off` leaves the piece out.
    public var timeAgo: TimeAgoMode
    /// The day the post is read on; nil = `today`.
    public var referenceDate: IsoDate?
    /// Set the place behind the marker glyph.
    public var showPin: Bool
    /// Credit the camera. Off by default: a badge is a signature.
    public var showExif: Bool
    /// The exposure line as the caller MEASURED it — the legacy path, read
    /// only while `exif` is not given.
    public var exposure: String?
    /// The hook picture's effective EXIF, as the caller READ it: `.none` is
    /// not given (the legacy `exposure` line is read), `.some(nil)` a picture
    /// that says nothing.
    public var exif: ExifData??
    /// The piece's camera plate; nil is the legacy line under the badge.
    public var camera: CameraPlateSpec?
    /// The trip's display names for bodies, keyed by the name the file gives.
    public var cameraNames: [String: String]?
    /// Free text replacing a computed piece; empty means "computed".
    public var overrides: [BadgePiece: String]?
    /// The real today — the web's `todayIso()` default, handed in.
    public var today: IsoDate

    public init(mode: CounterMode, words: BadgeWords, timeAgo: TimeAgoMode, referenceDate: IsoDate? = nil,
                showPin: Bool = false, showExif: Bool = false, exposure: String? = nil, exif: ExifData?? = .none,
                camera: CameraPlateSpec? = nil, cameraNames: [String: String]? = nil,
                overrides: [BadgePiece: String]? = nil, today: IsoDate = todayIso(Date(), in: .current)) {
        self.mode = mode; self.words = words; self.timeAgo = timeAgo; self.referenceDate = referenceDate
        self.showPin = showPin; self.showExif = showExif; self.exposure = exposure; self.exif = exif
        self.camera = camera; self.cameraNames = cameraNames; self.overrides = overrides; self.today = today
    }
}

/// An en dash, not a hyphen: it is a range, and it is set beside numerals.
private let badgeRangeDash = "–"

private func badgeTrim(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The camera credit: its line, and — when the author composed it — the plate.
private func badgeCredit(_ opts: BadgeOptions) -> (exif: String?, plate: CameraPlateInput?) {
    if !opts.showExif { return (nil, nil) }
    // The legacy path: a finished line handed over by the caller.
    guard let given = opts.exif else {
        let line = badgeTrim(opts.exposure ?? "")
        return (line.isEmpty ? nil : line, nil)
    }
    let facts = cameraFacts(given, names: opts.cameraNames)
    let spec = opts.camera.map { readPlateSpec($0.json) } ?? defaultPlateSpec()
    let line = factsLine(facts, spec.fields)
    if line.isEmpty { return (nil, nil) }
    // The plain line under the badge is the PIECE it always was.
    let plain = spec.layout == .line && spec.place == .badge && spec.size == 1
    return (line, plain ? nil : CameraPlateInput(facts: facts, spec: spec, words: cameraWordsOf(opts.words.camera)))
}

extension BadgeContent {
    /// One piece written — what an override does.
    fileprivate mutating func set(_ piece: BadgePiece, _ text: String) {
        switch piece {
        case .kicker: kicker = text
        case .label: label = text
        case .headline: headline = text
        case .counter: counter = text
        case .caption: caption = text
        case .timing: timing = text
        case .exif: exif = text
        }
    }
}

/// Apply the author's free text over the derived pieces.
private func applyOverrides(_ content: BadgeContent, _ overrides: [BadgePiece: String]?) -> BadgeContent {
    guard let overrides else { return content }
    var out = content
    // A credit the author wrote is a line of their own: it replaces the plate.
    if !badgeTrim(overrides[.exif] ?? "").isEmpty { out.plate = nil }
    for piece in BadgePiece.allCases {
        let value = badgeTrim(overrides[piece] ?? "")
        if !value.isEmpty { out.set(piece, value) }
    }
    return out
}

/// What a counter mode produced, and why it could not produce it.
public struct CounterPieces: Equatable, Sendable {
    public var label: String?
    public var headline: String
    public var counter: String?
    public var caption: String?
    /// Why the mode the author ASKED for could not be honoured, in a sentence,
    /// or nil when it was. The pieces then hold the day of the trip.
    public var unavailable: String?

    public init(label: String?, headline: String, counter: String?, caption: String?, unavailable: String?) {
        self.label = label; self.headline = headline; self.counter = counter; self.caption = caption
        self.unavailable = unavailable
    }
}

/// The counting half of the badge: everything but the trip's name and the
/// WHEN line. Nil only when the trip's own span cannot be read.
public func counterPieces(_ trip: TripDoc, _ post: TripPost, _ mode: CounterMode, _ words: BadgeWords,
                          _ showPin: Bool = false) -> CounterPieces? {
    let w = words
    guard let range = postDayRange(trip, post) else { return nil }

    let stage = stageAt(trip, post.date)
    // The stage's own name when it has one, else the leg its places describe.
    let place: String? = stage.map(stageLabel).flatMap { $0.isEmpty ? nil : $0 }
    let marker = badgeTrim(w.pin)
    let pin = { (text: String?) -> String? in
        guard let text, !text.isEmpty, showPin, !marker.isEmpty else { return text }
        return "\(marker) \(text)"
    }

    var unavailable: String? = nil

    if mode == .stageDay || mode == .stageLength {
        if let stage, let place, let at = stageDayNumber(stage, post.date) {
            let region = stageRegionLabel(stage)
            if mode == .stageLength {
                let total = spanLength(stage.startDate, stage.endDate) ?? at.total
                let unit = total == 1 ? w.day.lowercased() : w.days.lowercased()
                return CounterPieces(label: nil, headline: "\(total)", counter: "\(unit) \(w.at) \(place)",
                                     caption: pin(region.isEmpty ? nil : region), unavailable: nil)
            }
            return CounterPieces(label: pin(place), headline: "\(at.day)", counter: "\(w.of) \(at.total)",
                                 caption: pin(region.isEmpty ? nil : region), unavailable: nil)
        }
        // Outside every stage there is no place to count within.
        unavailable = stage != nil
            ? "The stage covering \(formatIsoDate(post.date)) names no place."
            : "No stage covers \(formatIsoDate(post.date))."
    }

    let isRange = mode == .dayRange && range.to > range.from
    if mode == .dayRange && !isRange {
        unavailable = "This piece tells a single day — give it an end date to count a range."
    }

    return CounterPieces(
        label: isRange ? w.days : w.day,
        headline: isRange ? "\(range.from)\(badgeRangeDash)\(range.to)" : "\(range.from)",
        counter: "\(w.of) \(range.total)",
        caption: pin(place),
        unavailable: unavailable
    )
}

/// One mode, as it would really read for THIS post.
public struct CounterPreview: Equatable, Sendable {
    public var id: CounterMode
    public var label: String
    public var hint: String
    /// The line this mode would draw, or nil when it cannot draw its own.
    public var text: String?
    /// Why not, when `text` is nil.
    public var reason: String?
}

/// What each mode would actually say for the post in hand — the real value or
/// nothing, never a fabricated example.
public func counterPreviews(_ trip: TripDoc, _ post: TripPost, _ words: BadgeWords,
                            _ showPin: Bool = false) -> [CounterPreview] {
    counterModes.map { mode in
        let pieces = counterPieces(trip, post, mode.id, words, showPin)
        var text: String? = nil
        if let pieces, pieces.unavailable == nil {
            text = [pieces.label, pieces.headline, pieces.counter]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
        let reason = pieces.map { $0.unavailable } ?? "The trip’s own dates are the wrong way round."
        return CounterPreview(id: mode.id, label: mode.label, hint: mode.hint, text: text, reason: reason)
    }
}

/// The badge for a post, or nil when the trip's own span cannot be read (a
/// reversed date range) — a badge with no trustworthy total says nothing.
public func badgeContent(_ trip: TripDoc, _ post: TripPost, _ opts: BadgeOptions) -> BadgeContent? {
    guard let pieces = counterPieces(trip, post, opts.mode, opts.words, opts.showPin) else { return nil }
    let credit = badgeCredit(opts)
    let name = badgeTrim(trip.name)
    let reference = opts.referenceDate ?? opts.today
    let content = BadgeContent(
        kicker: name.isEmpty ? nil : name,
        label: pieces.label,
        headline: pieces.headline,
        counter: pieces.counter,
        caption: pieces.caption,
        timing: timeAgoLine(post.date, reference, opts.timeAgo, opts.words.time),
        exif: credit.exif,
        plate: credit.plate
    )
    return applyOverrides(content, opts.overrides)
}
