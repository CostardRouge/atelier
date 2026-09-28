// What the piece editor's CONTENT tab says — the pure halves of
// `src/tools/roadtrip/panels/SlideDelivery.tsx` (`reasonSentence`,
// `choiceHint`, the "On screen" hint), `ContentTab.tsx` (the day of the trip,
// the picture's own date offered, each counter and time mode as the line it
// would really draw) and `CameraPanel.tsx` (the credit's line or its reason,
// the facts' order, the body's alias on the trip, where the plate sits, the
// layout tiles' elements). The web keeps these inside its components; here
// they are one module so the words are tested and the SwiftUI tab only lays
// them out.
//
// Rules kept (`roadtrip.md`):
// - Every mode shows the line it would REALLY draw for this post, or the
//   reason it cannot — a fabricated example, and a silent fallback, both
//   read as a broken feature.
// - The day a piece tells is MEASURED from the picture and OFFERED, never
//   applied: which rung answered is part of the sentence, and a picture dated
//   outside the trip is called out.
// - A slide's delivery says what each choice would really give — its cost
//   (settled, one frame, a held card), never its own name repeated — and a
//   re-timed clip says it goes out without sound, beside the length.
// - A camera credit is measured from the picture and never stored; the
//   plate's tiles are drawn with the REAL facts through the badge's own
//   elements, and a picture recording none of them draws the reason.
// - A body's display name is written ONCE on the trip, keyed by the name the
//   file gives, matched case-insensitively.

import Foundation

// MARK: - how a slide goes out (`SlideDelivery.tsx`)

/// One choice of "Goes out as". The web's `CHOICES`.
public struct SlideMediumChoice: Equatable, Sendable {
    public let id: SlideMedium
    public let label: String
}

public let slideMediumChoices: [SlideMediumChoice] = [
    SlideMediumChoice(id: .auto, label: "Auto"),
    SlideMediumChoice(id: .image, label: "Image"),
    SlideMediumChoice(id: .video, label: "Video"),
]

/// `${speed}×` — `0.25×`, `2×`.
public func clipSpeedLabel(_ speed: Double) -> String {
    "\(TripJS.number(speed))×"
}

/// The sentence a resolved slide deserves — the real one, never a generic. A
/// re-timed clip has no sound (audio is copied, never re-encoded), said here
/// beside the length rather than discovered in the file.
public func reasonSentence(_ reason: SlideReason, _ seconds: Double, _ speed: Double = 1) -> String {
    let pace = speed != 1 ? " at \(clipSpeedLabel(speed)), without sound" : ""
    let length = TripJS.toFixed1(seconds)
    switch reason {
    case .animated:
        return "This slide animates, so it goes out as a \(length)s video\(pace)."
    case .moving:
        return "Its picture is a clip, so it goes out as \(length)s of video\(pace)."
    case .forcedVideo:
        return "A still picture, held for \(length)s of video because you asked."
    case .settled:
        return "This slide animates, but you asked for an image: the badge is drawn settled, as it comes to rest."
    case .frozen:
        return "Its picture is a clip, but you asked for an image: the frame you chose is what goes out."
    case .plain:
        return "A still picture, delivered as one."
    }
}

/// The line under a choice's label, or nil when the label already says it.
/// `Auto` answers with the medium, the one thing it does not say itself; the
/// two explicit choices answer with what they would COST — "Image · image" is
/// a chip repeating its own name. The web's `choiceHint`.
public func slideMediumChoiceHint(_ choice: SlideMedium, _ reason: SlideReason, _ medium: DeckMedium) -> String? {
    if choice == .auto { return medium.rawValue }
    switch reason {
    case .settled: return "settled"
    case .frozen: return "one frame"
    case .forcedVideo: return "a held card"
    default: return nil
    }
}

/// The small print under "On screen": for a video, how much of the clip is
/// left after its in point when that is what caps the slider; for an image,
/// what the length is for.
public func onScreenHint(_ medium: DeckMedium, clipSeconds: Double, ceiling: Double, speed: Double) -> String? {
    guard medium == .video else { return "How long this picture holds the screen when the piece plays." }
    guard clipSeconds > 0, ceiling < maxHookSeconds else { return nil }
    let pace = speed != 1 ? " at \(clipSpeedLabel(speed))" : ""
    return "At most \(TripJS.toFixed1(ceiling))s of the clip is left after its in point\(pace)."
}

/// "A re-timed clip goes out without sound." — under the speed chips while
/// the speed is not 1.
public func clipSpeedHint(_ speed: Double) -> String? {
    speed != 1 ? "A re-timed clip goes out without sound." : nil
}

// MARK: - the day (`ContentTab.tsx`)

/// `day 27 / 310`, `day 27–29 / 310`, or `outside the trip` when the trip's
/// own span cannot be read.
public func pieceDayOfTrip(_ trip: TripDoc, _ post: TripPost) -> String {
    guard let range = postDayRange(trip, post) else { return "outside the trip" }
    let through = range.to > range.from ? "–\(range.to)" : ""
    return "day \(range.from)\(through) / \(range.total)"
}

/// Which rung dated the picture, as the Day row says it.
public func captureSourceWords(_ captured: CaptureDate) -> String {
    switch captured.source {
    case .exif: return "(the camera’s own record)"
    case .source: return "(the capture time \(captured.via ?? "the source") read at ingest)"
    case .file: return "(the file’s date — a copy or an export rewrites it)"
    }
}

/// What the picture's own date offers the piece.
public struct CaptureOffer: Equatable, Sendable {
    /// The picture's day, and that day written out.
    public var date: IsoDate
    public var dateText: String
    /// Which rung answered, in words.
    public var sourceWords: String
    /// The picture is dated another day than the piece — "file it under that day".
    public var elsewhere: Bool
    /// That day is outside the trip's own dates.
    public var outsideTrip: Bool
}

/// The warning a picture dated outside the trip wears.
public let captureOutsideTripWords =
    "— outside this trip’s dates, so every count here would be about a day this picture has nothing to do with."

/// The offer for the piece in hand, or nil when nothing dated the picture.
/// Never applied here: filing the piece is the author's.
public func captureOffer(_ trip: TripDoc, _ post: TripPost, _ captured: CaptureDate?) -> CaptureOffer? {
    guard let captured else { return nil }
    return CaptureOffer(
        date: captured.date,
        dateText: formatIsoDate(captured.date),
        sourceWords: captureSourceWords(captured),
        elsewhere: captured.date != post.date,
        outsideTrip: !isWithin(trip.startDate, trip.endDate, captured.date)
    )
}

/// What the marker would be set before: the name of the stage covering the
/// piece's day, or nil when none does (or it names nothing).
public func pieceMarkerPlace(_ trip: TripDoc, _ post: TripPost) -> String? {
    let name = stageAt(trip, post.date)?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return name.isEmpty ? nil : name
}

/// The Marker row's hint.
public func markerHint(_ place: String?) -> String {
    if let place { return "The place reads “\(place)”." }
    return "No stage covers this day, so there is no place to mark — add one on the Overview."
}

// MARK: - the counter and time modes, as the real lines

/// A hint that is the line itself (set in mono, in ink) or a sentence saying
/// why there is none.
public enum PieceModeHint: Equatable, Sendable {
    case line(String)
    case reason(String)
}

/// A counter mode as the select offers it.
public struct PieceCounterChoice: Equatable, Sendable {
    public var id: CounterMode
    public var label: String
    public var hint: String
    /// The line it would draw for this post, or nil.
    public var text: String?
    /// Why not, when `text` is nil.
    public var otherwise: String

    /// `Day of trip · Day · 27 · of 310`, or the reason in the line's place.
    public var menuLabel: String { "\(label) · \(text ?? otherwise)" }
}

public func pieceCounterChoices(_ trip: TripDoc, _ post: TripPost) -> [PieceCounterChoice] {
    counterPreviews(trip, post, trip.badgeWords, post.badge.showPin).map { m in
        PieceCounterChoice(id: m.id, label: m.label, hint: m.hint, text: m.text,
                           otherwise: m.reason ?? "nothing to count here")
    }
}

/// Under the counter's select: the chosen mode's line, or its reason and what
/// is counted meanwhile.
public func pieceCounterHint(_ choices: [PieceCounterChoice], _ mode: CounterMode) -> PieceModeHint? {
    guard let active = choices.first(where: { $0.id == mode }) else { return nil }
    guard let text = active.text else {
        let meanwhile = mode == .dayRange
            ? "It counts the single day above meanwhile."
            : "Stages are edited on the trip’s Overview; the day of the trip is counted meanwhile."
        return .reason("\(active.otherwise) \(meanwhile)")
    }
    return text.isEmpty ? nil : .line(text)
}

/// A temporal mode as the select offers it.
public struct PieceTimeChoice: Equatable, Sendable {
    public var id: TimeAgoMode
    public var label: String
    public var hint: String
    /// The line it would draw on the reading day, or nil (always nil for `off`).
    public var text: String?
    public var otherwise: String

    /// `Days · 515 days ago`, or the bare label when it would draw nothing.
    public var menuLabel: String { text.map { "\(label) · \($0)" } ?? label }
}

public func pieceTimeChoices(_ date: IsoDate, _ reference: IsoDate, _ words: TimeAgoWords) -> [PieceTimeChoice] {
    timeAgoPreviews(date, reference, words).map { m in
        PieceTimeChoice(id: m.id, label: m.label, hint: m.hint, text: m.id == .off ? nil : m.text,
                        otherwise: m.id == .off ? "no line" : "nothing true to say on that day")
    }
}

/// Under the time's select: the line in quotes, or why it is left out.
public func pieceTimeHint(_ choices: [PieceTimeChoice], _ mode: TimeAgoMode) -> PieceModeHint {
    if let line = choices.first(where: { $0.id == mode })?.text, !line.isEmpty {
        return .line("“\(line)”")
    }
    switch mode {
    case .off: return .reason("No line about when. The trip’s name is on the badge either way.")
    case .anniversary:
        return .reason("Not the anniversary on that day, so the line is left out. Nothing claims a date it is not.")
    default: return .reason("Nothing true to say about that gap yet, so the line is left out.")
    }
}

// MARK: - the camera credit (`CameraPanel.tsx`)

/// Beside the credit's switch: the hand-written line, the real composed line,
/// or why there is nothing to credit. `exifRead` is the web's truthy `exif` —
/// the picture was read, even if it recorded nothing.
public func cameraCreditHint(override: String?, line: String, exifRead: Bool) -> PieceModeHint {
    let written = override?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !written.isEmpty {
        return .reason("Written by hand on the Camera piece: “\(written)”. Clear it there to compose the credit here.")
    }
    if !line.isEmpty { return .line("“\(line)”") }
    if exifRead { return .reason("This picture records none of the facts ticked below — nothing to credit.") }
    return .reason("This picture records no camera, lens or exposure — nothing to credit. Write the line yourself on the Camera piece if you want one.")
}

/// The facts as the panel lists them: the chosen ones in their order, then
/// the rest in the table's own.
public func cameraFieldRows(_ chosen: [CameraField]) -> [CameraFieldInfo] {
    let picked = chosen.compactMap { id in cameraFields.first { $0.id == id } }
    return picked + cameraFields.filter { !chosen.contains($0.id) }
}

/// A fact ticked (appended at the end of the order) or unticked.
public func cameraFieldsToggled(_ chosen: [CameraField], _ id: CameraField, _ want: Bool) -> [CameraField] {
    if want { return chosen.contains(id) ? chosen : chosen + [id] }
    return chosen.filter { $0 != id }
}

/// A chosen fact moved one place up (`-1`) or down (`+1`), or nil when it
/// cannot move that way.
public func cameraFieldsMoved(_ chosen: [CameraField], _ id: CameraField, _ by: Int) -> [CameraField]? {
    guard let i = chosen.firstIndex(of: id) else { return nil }
    let j = i + by
    guard j >= 0, j < chosen.count else { return nil }
    var next = chosen
    next.swapAt(i, j)
    return next
}

/// What a fact reads beside its tick: its value, the EV that is zero (read,
/// never drawn in a line), or that the picture does not record it.
public func cameraFactValue(_ facts: CameraFacts, _ field: CameraField) -> String {
    if let fact = facts.facts[field] { return fact.value }
    if field == .ev && facts.evStops != nil { return "±0 — the camera’s own reading, not drawn in a line" }
    return "not recorded by this picture"
}

/// What this trip calls the body the file names `rawBody` — matched
/// case-insensitively, the table's keys walked sorted (a Swift dictionary has
/// no insertion order; `cameraFacts` walks them the same way); empty when the
/// trip never named it.
public func cameraBodyAlias(_ names: [String: String]?, _ rawBody: String) -> String {
    let want = rawBody.lowercased()
    guard let names else { return "" }
    for key in names.keys.sorted() where key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == want {
        return names[key] ?? ""
    }
    return ""
}

/// The trip's names with `rawBody` renamed `value` — every spelling of that
/// body dropped first, and none written back for a blank name.
public func withCameraBodyAlias(_ names: [String: String]?, _ rawBody: String, _ value: String) -> [String: String] {
    let want = rawBody.lowercased()
    var next = (names ?? [:]).filter { $0.key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != want }
    if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { next[rawBody] = value }
    return next
}

/// The Place row's hint: where the layout goes, and whether it meets the badge.
public func cameraPlaceHint(_ spec: CameraPlateSpec, badgeAnchor: OverlayAnchor) -> String {
    switch spec.layout {
    case .bar: return "An edge bar runs along the bottom — or the top, from a top cell."
    case .margin: return "A margin runs down the right — or the left, from a left cell."
    default: break
    }
    guard case .cell(let cell) = spec.place else { return "Hung under the badge, and moves with it." }
    return cell == badgeAnchor
        ? "The badge is anchored in this cell too — they will overlap."
        : "In a cell of its own, where the badge is not."
}

/// The edge an edge bar runs along: the top from a top cell, else the bottom.
public func cameraBarEdge(_ spec: CameraPlateSpec) -> ShadeDirection {
    if case .cell(let cell) = spec.place, cell.rawValue.hasPrefix("top-") { return .top }
    return .bottom
}

/// "Shade under the bar": a soft dark band along the bar's edge.
public func cameraBarShade(_ spec: CameraPlateSpec, id: String = newTripId()) -> Shade {
    createShade(id: id, direction: cameraBarEdge(spec), reach: 0.24, strength: 0.7, falloff: .inOut, core: 0.4)
}

/// The Size row's value: `${Math.round(v * 100)}%`.
public func plateSizeLabel(_ size: Double) -> String {
    "\(TripJS.number(TripJS.round(size * 100)))%"
}

/// A layout tile's frame, width over height — the web's 240 × 150 canvas.
public let plateTileAspect = 240.0 / 150

/// What a tile says where the picture records none of the facts ticked.
public let plateTileNothing = "nothing recorded"

/// One layout drawn with the picture's REAL facts, as the badge draws them:
/// centred in the tile and as large as it holds both ways — a tile shows the
/// layout's type, not where the piece will put it (the stage says that). An
/// edge layout decides its own side; every other sits in the centre-left cell.
/// Empty when none of `fields` is recorded.
public func plateTileElements(_ facts: CameraFacts, _ fields: [CameraField], _ words: CameraWords,
                              _ layout: PlateLayout, aspect: Double = plateTileAspect) -> [OverlayElement] {
    let edge = layout == .bar || layout == .margin
    let spec = CameraPlateSpec(fields: fields, layout: layout, place: edge ? .badge : .cell(.centerLeft), size: 1)
    guard let probe = plateRuns(facts, spec, words, .left) else { return [] }
    // Its short side is its height, and it is `aspect` of those wide.
    let byHeight = 0.74 / max(1, probe.height)
    let byWidth = (0.84 * aspect) / max(1, plateSpan(probe))
    let unit = min(0.1, byHeight, byWidth)
    let runs = plateRuns(facts, spec, words, .left, aspect / unit) ?? probe
    return plateElements(runs, gridOrigin(runs, unit, aspect), unit, aspect, "tile:\(layout.rawValue)")
}
