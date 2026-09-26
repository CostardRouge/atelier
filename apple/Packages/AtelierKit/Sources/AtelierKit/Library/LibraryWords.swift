// What the Library SAYS — the lines its rows, tiles, stepper and lightboxes
// draw, lifted out of the web's components so the two apps print the same
// words from the same facts: `AssetSidebar.tsx` (`kindLabel`, `metaFacts`,
// `pairTag`, `fpsText`, `cadenceSentence`, the halves), `DayPicker.tsx` (the
// stepper's line, `spanLabel`, the month's line), `WinnowScopeGrid.tsx` (the
// empty day) and `WinnowLightbox.tsx` (a row's facts and exposure line, the
// placeholder card, the two edge cards). None of these has a web spec of its
// own; `LibraryWordsTests` pins the rules they encode.
//
// Two rules every line keeps (`roadtrip.md`, `architecture.md`): nothing is
// claimed that was not measured — a clip whose log was not read gets no frame
// rate, a row with no capture time says so — and a capture's other files are
// SAID (`JPEG + DNG`, `+DNG`), because a RAW folded silently into its JPEG
// read as a RAW the Library had ignored.

import Foundation

// MARK: - a pool asset

/// A short, human label for a kind chip — `video+srt`, `srt`, `photo`.
public func assetKindLabel(_ kind: AssetKind) -> String {
    switch kind {
    case .videoTelemetry: return "video+srt"
    case .telemetry: return "srt"
    default: return kind.rawValue
    }
}

/// What a row's cover has read of its asset, once it has — the web's `MediaMeta`
/// minus the thumbnail, which is the app's.
public struct CoverFacts: Equatable, Sendable {
    public enum Status: String, Equatable, Sendable {
        case pending, ready, error
    }

    public var status: Status
    public var isVideo: Bool
    public var width: Int?
    public var height: Int?
    /// Seconds, for a clip.
    public var duration: Double?
    /// `RAW`, `JPEG`, … for a picture (`imageTypeLabel`).
    public var imageType: String?
    /// The cadence measured from the clip's `.srt`, when it has one.
    public var timing: TimeScaleReading?

    public init(status: Status, isVideo: Bool, width: Int? = nil, height: Int? = nil, duration: Double? = nil,
                imageType: String? = nil, timing: TimeScaleReading? = nil) {
        self.status = status; self.isVideo = isVideo; self.width = width; self.height = height
        self.duration = duration; self.imageType = imageType; self.timing = timing
    }
}

/// The frame rate the camera SHOT at, as a row label — or nil when the log
/// was never measured: the container knows the rate it plays at and nothing
/// else, so a clip with no telemetry gets no figure rather than a wrong one.
public func coverFpsText(_ timing: TimeScaleReading?) -> String? {
    guard let fps = timing?.captureFps ?? timing?.mediaFps, fps != 0, fps.isFinite else { return nil }
    let text = fps == fps.rounded() && abs(fps) < 1e15 ? String(Int(fps)) : String(format: "%.2f", fps)
    return "\(text) fps"
}

/// What a row's facts line says: pixels, length, the types of the capture's
/// files, the shooting rate, the weight — `reading…` while the cover is out.
public func assetFactsLine(_ asset: Asset, _ cover: CoverFacts?) -> String {
    guard let cover, cover.status != .pending else { return "reading…" }
    var facts: [String] = []
    if let w = cover.width, let h = cover.height, w > 0, h > 0 { facts.append("\(w)×\(h)") }
    if cover.isVideo, let d = cover.duration, d != 0 { facts.append(formatDuration(d)) }
    if !cover.isVideo, let type = cover.imageType, !type.isEmpty {
        facts.append(([type] + siblingTypes(asset.parts)).joined(separator: " + "))
    }
    if let fps = coverFpsText(cover.timing) { facts.append(fps) }
    facts.append(formatBytes(asset.size))
    return facts.joined(separator: " · ")
}

/// The chip a picture's cover wears when a camera RAW sits beside it — `+DNG`,
/// `+ARW` — nil for a lone file and for a JPEG + HEIF pair, whose second half
/// is no material of its own.
public func libraryPairTag(_ parts: AssetParts) -> String? {
    guard hasRawSibling(parts) else { return nil }
    let raws = (parts.siblings ?? []).filter { isRawImage($0.name) }
    let types = siblingTypes(AssetParts(siblings: raws))
    return types.isEmpty ? nil : "+" + types.joined(separator: "+")
}

/// What a row's help says about cadence: a clip whose log gives a playback
/// rate but no conform is told so plainly — `30 fps` alone would read as the
/// rate it was shot at, which is exactly the claim that cannot be made.
public func cadenceSentence(_ timing: TimeScaleReading?, _ fpsLabel: String?) -> String {
    guard let timing else { return "" }
    if timing.basis == .none {
        guard let fpsLabel else { return "" }
        return "plays at \(fpsLabel) — shooting cadence not measurable"
    }
    let parts = [describeTimeScale(timing.scale) ?? "real time", formatCadence(timing)].compactMap { $0 }
    return parts.filter { !$0.isEmpty }.joined(separator: " · ")
}

// MARK: - the instance's two halves

/// One cell of the `All · Incoming · Gallery` row, in Winnow's own words.
public struct LibraryHalfOption: Equatable, Sendable {
    /// Nil for both halves — the default.
    public var half: LibraryHalf?
    public var label: String
    public var hint: String

    public init(half: LibraryHalf?, label: String, hint: String) { self.half = half; self.label = label; self.hint = hint }
}

/// The three cells, in their order.
public let libraryHalves: [LibraryHalfOption] = [
    LibraryHalfOption(half: nil, label: "All", hint: "Incoming and Gallery together"),
    LibraryHalfOption(half: .incoming, label: "Incoming", hint: "Media still to cull"),
    LibraryHalfOption(half: .final, label: "Gallery", hint: "Finished exports"),
]

// MARK: - the day stepper

/// `Thu 12 Feb 2026` — a day read by a human.
public func libraryDayName(_ iso: String) -> String {
    "\(tripWeekdays[weekdayIndex(iso) ?? 0]) \(formatIsoDate(iso))"
}

/// `25 → 27 Mar 2025`, or the two whole dates when the months differ.
public func spanLabel(_ span: DaySpan) -> String {
    let a = formatIsoDate(span.from)
    let b = formatIsoDate(span.to)
    let sameMonth = span.from.prefix(7) == span.to.prefix(7)
    guard sameMonth, let day = Int(span.from.suffix(2)) else { return "\(a) → \(b)" }
    return "\(day) → \(b)"
}

/// Where the stepper's view sits, in words: against the tool's day when one
/// is followed — from a piece, "the day before" is the day before the PIECE —
/// and against today when the day was picked here.
public func stepperWhere(day: String, anchor: DaySpan?, publisher: String?, overridden: Bool, today: String) -> String {
    if let anchor {
        if overridden { return relativeToAnchor(day, anchor) ?? day }
        return "open in \(publisher ?? "the tool")"
    }
    return describeRelativeDay(day, today: today) ?? day
}

/// The count under the stepper: `asking…`, `no answer`, `nothing here`, `3 files`.
public func stepperCount(asking: Bool, count: Int?) -> String {
    if asking { return "asking…" }
    guard let count else { return "no answer" }
    if count == 0 { return "nothing here" }
    return "\(count) file\(count == 1 ? "" : "s")"
}

/// The month popover's line — what it is waiting for, the day under the
/// pointer, or the month's total and its busiest day.
public func monthStripLine(host: String, monthKey: String, busy: Bool, failed: Bool, hovered: String?,
                           hoveredCount: Int, strip: DensityStrip) -> String {
    if busy { return "asking \(host)…" }
    if let hovered {
        let what = hoveredCount > 0 ? "\(hoveredCount) file\(hoveredCount == 1 ? "" : "s")" : "nothing"
        return "\(formatIsoDate(hovered)) · \(what)"
    }
    if failed { return "could not ask \(host)" }
    if strip.total == 0 { return "nothing in \(monthLabel(monthKey))" }
    return "\(strip.total) file\(strip.total == 1 ? "" : "s") · busiest day \(strip.peak)"
}

/// What the instance's grid says for a span it holds nothing on.
public func instanceEmptyLine(host: String, span: DaySpan) -> String {
    let when = span.from == span.to ? "on \(span.from)" : "from \(span.from) to \(span.to)"
    return "\(host) holds nothing shot \(when)."
}

// MARK: - an instance's row, large

/// The row's facts line: the day and hour it was shot — as the camera wrote
/// it, never converted — its pixels, length, weight and flight log.
public func rowFactsLine(_ row: WinnowAssetRow, timeZone: TimeZone = .current) -> String {
    let stamp = exifTimestampFromIso(row.capturedAt, timeZone: timeZone)
    let day = isoFromExifDateTime(stamp)
    var facts: [String] = []
    if let day {
        let clock = stamp.map { String($0.dropFirst(11).prefix(5)) }
        facts.append(formatIsoDate(day) + (clock.map { " · \($0)" } ?? ""))
    } else {
        facts.append("no capture time")
    }
    if let w = row.width, let h = row.height, w > 0, h > 0 { facts.append("\(w)×\(h)") }
    if row.mediaType == .video, let d = row.durationS, d != 0 { facts.append(formatDuration(d)) }
    if let size = row.fileSize, size > 0 { facts.append(formatBytes(size)) }
    if row.hasTelemetry { facts.append("flight log") }
    return facts.joined(separator: " · ")
}

/// The body and the glass on their own line — `exifFromRow`'s reading plus
/// the two display labels it leaves out on purpose (the camera's name, the
/// lens), added here where they are read rather than drawn.
public func rowCameraLine(_ row: WinnowAssetRow, timeZone: TimeZone = .current) -> String {
    var exif = exifFromRow(row, timeZone: timeZone) ?? ExifData()
    exif.lensModel = row.lens
    return exposureSummary(exif, body: row.cameraModel)
}

/// The title of the one card a day with no picture to show carries.
public func placeholderTitle(_ span: DaySpan) -> String {
    span.from == span.to ? libraryDayName(span.from) : "\(formatIsoDate(span.from)) → \(formatIsoDate(span.to))"
}

/// What is known of the nearest day with media on one side — the web's `Neighbour`.
public enum NeighbourDay: Equatable, Sendable {
    case asking
    case none
    case failed
    case day(date: String, count: Int)
}

/// The words of a card at one end of the day: its title, its facts line and
/// the sentence drawn in the frame.
public struct EdgeCardWords: Equatable, Sendable {
    public var title: String
    public var facts: String
    public var line: String

    public init(title: String, facts: String, line: String) { self.title = title; self.facts = facts; self.line = line }
}

/// The card at one end of the day: the nearest day with media that way, or
/// why there is none to go to.
public func edgeCardWords(_ side: WalkSide, _ next: NeighbourDay, host: String) -> EdgeCardWords {
    let arrow = side == .after ? "→" : "←"
    let way = side == .after ? "next" : "previous"
    switch next {
    case .day(let date, let count):
        return EdgeCardWords(title: libraryDayName(date), facts: "the \(way) day with media",
                             line: "\(arrow) \(libraryDayName(date)) · \(count) file\(count == 1 ? "" : "s")")
    case .asking:
        return EdgeCardWords(title: "The \(way) day", facts: "asking…", line: "looking for the \(way) day with media…")
    case .none:
        return EdgeCardWords(title: "No \(way) day", facts: "the edge of what it holds",
                             line: "\(host) holds nothing \(side == .after ? "after" : "before") this day")
    case .failed:
        return EdgeCardWords(title: "The \(way) day", facts: "no answer", line: "could not ask \(host)")
    }
}
