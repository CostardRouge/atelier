// The pure half of the Stages screens — what the web keeps INSIDE its
// components (`src/tools/roadtrip/StageRuler.tsx`'s `applyDelta` and
// `pinText`, `StagesPanel.tsx`'s legend, card line and `add`, `LegsSheet.tsx`'s
// rows and barcode, `StageDiffList.tsx`'s exported helpers,
// `TimelineImportPanel.tsx`'s `chapterName` and preselection,
// `DeduceStagesPanel.tsx`'s stored settings, `LocatePicturePanel.tsx`'s
// sentences, `RoadTripTool.tsx`'s span note), lifted out so the app's views
// hold no arithmetic and every sentence is pinned by a spec.
//
// Rules kept (`roadtrip.md`, «The legs are a horizontal RULER», «The
// itinerary is DEDUCED», «Situer cette photo»):
// - A drag writes a stage's two DATES and nothing else, through the kernel's
//   own editors (`StageEdit.swift`), clamped to the TRIP.
// - A new leg starts where the story has a hole — the first uncovered day of
//   the span on screen, else its end.
// - A diff's `dropped` row is NEVER ticked by default, an already-linked
//   `unchanged` row is shown INERT rather than hidden, and a pairing that was
//   not by id is named.
// - Every sentence says what is REAL: the leg it touches by name, the span it
//   covers, why nothing is offered.
// - The deduction's settings are a preference of this DEVICE (the web's
//   `localStorage` key), never a field of the trip.
//
// Pure.

import Foundation

// MARK: - the ruler's drag

/// What a press on a bar moves: one of its edges, or the whole leg.
public enum RulerDragMode: String, CaseIterable, Sendable {
    case start
    case end
    case move
}

/// The stage a drag of `days` whole days would leave — the web's `applyDelta`:
/// a slide keeps the length (`shiftStage`), an edge moves alone and collapses
/// the leg rather than reversing it (`resizeStage`). Both clamp to the TRIP,
/// never to the span on screen.
public func applyRulerDelta(_ trip: TripDoc, _ mode: RulerDragMode, _ origin: TripStage, _ days: Int) -> TripStage {
    switch mode {
    case .move:
        return shiftStage(trip, origin, Double(days))
    case .start:
        guard let date = addDays(origin.startDate, days) else { return origin }
        return resizeStage(trip, origin, .start, date)
    case .end:
        guard let date = addDays(origin.endDate, days) else { return origin }
        return resizeStage(trip, origin, .end, date)
    }
}

/// `3 days`, `1 day` — a leg's length as a pin or a legend reads it.
private func daysWord(_ n: Int) -> String {
    "\(n) day\(n == 1 ? "" : "s")"
}

/// What the pin over a drag says: the date the moved edge would land on — or,
/// for a slide, the whole span — and what the leg would then be.
public func rulerPinText(_ mode: RulerDragMode, _ stage: TripStage) -> String {
    let len = spanLength(stage.startDate, stage.endDate)
    let days = len.map { " · \(daysWord($0))" } ?? ""
    switch mode {
    case .move:
        return "\(formatIsoDate(stage.startDate)) → \(formatIsoDate(stage.endDate))\(days)"
    case .start:
        return "\(formatIsoDate(stage.startDate))\(days)"
    case .end:
        return "\(formatIsoDate(stage.endDate))\(days)"
    }
}

/// What a bar says after its label: `4 d · 2 places` (the places counted as
/// the list holds them, a row just started included).
public func rulerBarDetail(_ stage: TripStage) -> String {
    let days = spanLength(stage.startDate, stage.endDate) ?? 0
    let places = stage.places.count
    let tail = places > 0 ? " · \(places) place\(places == 1 ? "" : "s")" : ""
    return "\(days) d\(tail)"
}

/// A bar's full name, for its accessibility label: the leg, its span, its length.
public func rulerBarTitle(_ stage: TripStage) -> String {
    let label = stageLabel(stage)
    let days = spanLength(stage.startDate, stage.endDate) ?? 0
    return "\(label.isEmpty ? "Unnamed stage" : label) · \(formatIsoDate(stage.startDate)) → "
        + "\(formatIsoDate(stage.endDate)) · \(daysWord(days))"
}

/// Narrowest a run of uncovered days may be drawn and still carry its `+`.
public let rulerGapButtonMinWidth = 22.0

/// The day "+ Stage" starts a new leg on: the first day no leg covers inside
/// the span on screen (the whole trip when there is none), else that span's
/// end — a leg added off-screen is a leg the author cannot see appear. Handed
/// to `startStageAt`, which cuts a leg covering that day.
public func newStageDay(_ trip: TripDoc, span: TripSpan? = nil) -> IsoDate {
    let drawn = span ?? TripSpan(startDate: trip.startDate, endDate: trip.endDate)
    let gap = rulerGaps(drawn, rulerBars(drawn, trip.stages)).first
    return gap?.startDate ?? drawn.endDate
}

/// The Stages legend: the span on screen when the ruler follows the calendar,
/// else how many legs the trip has.
public func stagesLegend(_ trip: TripDoc, span: TripSpan?) -> String {
    if let span {
        let days = spanLength(span.startDate, span.endDate).map(String.init) ?? "null"
        return "On screen · \(formatIsoDate(span.startDate)) → \(formatIsoDate(span.endDate)) · \(days) days"
    }
    let n = trip.stages.count
    return "Stages · \(n) leg\(n == 1 ? "" : "s")"
}

// MARK: - the stage card

/// The card's legend: `Stage 2 · 4 days` (`index` 0-based).
public func stageCardHeading(_ stage: TripStage, index: Int) -> String {
    let days = spanLength(stage.startDate, stage.endDate).map { " · \(daysWord($0))" } ?? ""
    return "Stage \(index + 1)\(days)"
}

/// The line under the card's fields: why the leg cannot be used, or what it
/// really says — its label and its span. `problem` is true for the first.
public func stageCardLine(_ trip: TripDoc, _ stage: TripStage) -> (text: String, problem: Bool) {
    if let problem = stageProblem(trip, stage) { return (problem, true) }
    guard spanLength(stage.startDate, stage.endDate) != nil else { return ("", false) }
    let span = "\(formatIsoDate(stage.startDate)) → \(formatIsoDate(stage.endDate))"
    let text = [stageLabel(stage), span].filter { !$0.isEmpty }.joined(separator: " · ")
    return (text, false)
}

// MARK: - the legs sheet

/// How many days of a leg its barcode shows before it samples. The web's `BARS`.
public let legsBarcodeBars = 26

/// One row of the phone's list of legs, in lived order.
public enum LegsSheetRow: Equatable, Sendable {
    /// A leg, with its place in `trip.stages` (what picks its tint).
    case leg(stage: TripStage, index: Int)
    /// A run of days no leg covers, offering to cover exactly it.
    case gap(RulerGap)
}

/// Every leg, and every run of days no leg covers, in the order they were
/// lived — a gap slotted where it falls, a leg before a gap that starts the
/// same day, ties kept in list order.
public func legsSheetRows(_ trip: TripDoc) -> [LegsSheetRow] {
    let span = TripSpan(startDate: trip.startDate, endDate: trip.endDate)
    let gaps = rulerGaps(span, rulerBars(span, trip.stages))
    var rows: [LegsSheetRow] = trip.stages.enumerated().map { .leg(stage: $0.element, index: $0.offset) }
    rows += gaps.map { .gap($0) }
    func start(_ row: LegsSheetRow) -> IsoDate {
        switch row {
        case .leg(let stage, _): return stage.startDate
        case .gap(let gap): return gap.startDate
        }
    }
    return rows.enumerated()
        .sorted { a, b in
            let x = start(a.element)
            let y = start(b.element)
            return x == y ? a.offset < b.offset : x < y
        }
        .map(\.element)
}

/// The sheet's summary: `3 legs · 40/45 days covered`.
public func legsSheetSummary(_ trip: TripDoc) -> String {
    let span = TripSpan(startDate: trip.startDate, endDate: trip.endDate)
    let total = spanLength(trip.startDate, trip.endDate) ?? 0
    let uncovered = rulerGaps(span, rulerBars(span, trip.stages)).reduce(0) { $0 + $1.length }
    let n = trip.stages.count
    return "\(n) leg\(n == 1 ? "" : "s") · \(total - uncovered)/\(total) days covered"
}

/// A gap row's words: `3 days without a stage`.
public func legsGapLine(_ gap: RulerGap) -> String {
    "\(gap.length) day\(gap.length == 1 ? "" : "s") without a stage"
}

/// The days a leg's barcode draws: every day while they fit, one every
/// `ceil(n / bars)` days past that, so a long leg stays one row wide.
public func legBarcodeDays(_ stage: TripStage, bars: Int = legsBarcodeBars) -> [IsoDate] {
    let all = enumerateDays(stage.startDate, stage.endDate)
    let perBar = Int((Double(all.count) / Double(max(1, bars))).rounded(.up))
    let stride = max(1, perBar)
    return all.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
}

// MARK: - a leg's tint, as a screen paints it

/// `oklch(72% 0.07 250)` → its three numbers (L 0…1, C, h in degrees).
private func oklchParts(_ css: String) -> (l: Double, c: Double, h: Double)? {
    guard let open = css.firstIndex(of: "("), let close = css.lastIndex(of: ")"), open < close else { return nil }
    let inner = css[css.index(after: open)..<close]
    let parts = inner.split(whereSeparator: { $0 == " " || $0 == "," }).map(String.init)
    guard parts.count >= 3 else { return nil }
    let lText = parts[0]
    let l: Double?
    if lText.hasSuffix("%") { l = Double(lText.dropLast()).map { $0 / 100 } } else { l = Double(lText) }
    guard let l, let c = Double(parts[1]), let h = Double(parts[2]) else { return nil }
    return (l, c, h)
}

/// OKLab's linear sRGB, gamma-encoded and clipped the way a browser draws an
/// in-gamut colour.
private func oklchSrgb(_ l: Double, _ c: Double, _ hDegrees: Double) -> (red: Double, green: Double, blue: Double) {
    let h = hDegrees * .pi / 180
    let a = c * cos(h)
    let b = c * sin(h)
    let lp = l + 0.3963377774 * a + 0.2158037573 * b
    let mp = l - 0.1055613458 * a - 0.0638541728 * b
    let sp = l - 0.0894841775 * a - 1.2914855480 * b
    let lc = lp * lp * lp
    let mc = mp * mp * mp
    let sc = sp * sp * sp
    let r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
    let g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
    let bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc
    func encode(_ x: Double) -> Double {
        let v = min(1, max(0, x))
        return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055
    }
    return (encode(r), encode(g), encode(bl))
}

/// A leg's tint as sRGB components 0…1 — `stageTint(index)` (the web's CSS
/// `oklch()` string, the ONE place the four tints are written) converted, so a
/// screen paints the very colour the web's calendar and ruler draw.
public func stageTintSrgb(_ index: Int) -> (red: Double, green: Double, blue: Double) {
    guard let p = oklchParts(stageTint(index)) else { return (0.5, 0.5, 0.5) }
    return oklchSrgb(p.l, p.c, p.h)
}

// MARK: - a reconcile's rows (`StageDiffList.tsx`)

/// `5 Nov 2025 → 8 Nov 2025`, or one day — the dates half of `diffSpanText`.
public func diffSpanDates(_ start: String, _ end: String) -> String {
    start == end ? formatIsoDate(start) : "\(formatIsoDate(start)) → \(formatIsoDate(end))"
}

/// `5 Nov 2025 → 8 Nov 2025 · 4 days`, or one day. The web's `spanText`.
public func diffSpanText(_ start: String, _ end: String) -> String {
    let dates = diffSpanDates(start, end)
    guard let days = spanLength(start, end) else { return dates }
    return "\(dates) · \(daysWord(days))"
}

/// A leg's route as a line of its places, `A → B → C`.
private func diffRouteOf(_ stage: TripStage) -> String {
    stage.places
        .map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: " \(placeArrow) ")
}

private func diffLabel(_ stage: TripStage?, _ empty: String) -> String {
    guard let stage else { return empty }
    let label = stageLabel(stage)
    return label.isEmpty ? empty : label
}

/// What accepting one entry would do, in a sentence. The web's `describe`.
public func describeDiffEntry(_ entry: DiffEntry) -> String {
    let incoming = entry.incoming
    let existing = entry.existing
    switch entry.kind {
    case .add:
        let span = incoming.map { diffSpanText($0.startDate, $0.endDate) } ?? ""
        return "Add “\(diffLabel(incoming, "an unnamed leg"))” · \(span)"
    case .dropped:
        let span = existing.map { diffSpanText($0.startDate, $0.endDate) } ?? ""
        return "Drop “\(diffLabel(existing, "an unnamed leg"))” · \(span) — it is no longer there"
    case .unchanged:
        if existing?.origin != nil { return "“\(diffLabel(existing, ""))” · unchanged" }
        return "“\(diffLabel(existing, "an unnamed leg"))” matches one of these legs — link it, so the next run finds it"
    case .changed:
        var parts: [String] = []
        if entry.changes.contains(.name) {
            parts.append("now called “\(diffLabel(incoming, "nothing"))”")
        }
        if entry.changes.contains(.span), let incoming {
            parts.append("now \(diffSpanText(incoming.startDate, incoming.endDate))")
        }
        if entry.changes.contains(.places) {
            let route = incoming.map(diffRouteOf) ?? ""
            parts.append("route now \(route.isEmpty ? "no place" : route)")
        }
        return "“\(diffLabel(existing, "an unnamed leg"))” · \(parts.joined(separator: " · "))"
    }
}

/// An entry already linked and identical: shown, never actionable.
public func isInertDiffEntry(_ entry: DiffEntry) -> Bool {
    entry.kind == .unchanged && entry.existing?.origin != nil
}

/// Entries the author can actually do something with.
public func actionableDiffEntries(_ entries: [DiffEntry]) -> [DiffEntry] {
    entries.filter { !isInertDiffEntry($0) }
}

/// The default tick: take what the source gained or moved, link what it
/// matched, and never drop on its own. `holdBack` is the producer's own doubt
/// — rows it would rather the author looked at before accepting.
public func defaultAcceptedDiff(_ entries: [DiffEntry], holdBack: Set<String> = []) -> Set<String> {
    Set(entries
        .filter { e in
            e.kind == .add || e.kind == .changed || (e.kind == .unchanged && e.existing?.origin == nil)
        }
        .filter { !holdBack.contains($0.key) }
        .map(\.key))
}

/// How many of the ticked keys an Apply would really act on.
public func tickedActionableCount(_ entries: [DiffEntry], _ ticked: Set<String>) -> Int {
    let keys = Set(actionableDiffEntries(entries).map(\.key))
    return ticked.filter { keys.contains($0) }.count
}

/// A row's small tag: its kind (`link` for a match to be linked), and how it
/// was paired when that was not by id.
public func diffEntryTag(_ entry: DiffEntry) -> String {
    let kind = entry.kind == .unchanged && !isInertDiffEntry(entry) ? "link" : entry.kind.rawValue
    guard let by = entry.matchedBy, by != .id else { return kind }
    return "\(kind) · matched by \(by.rawValue)"
}

// MARK: - the timeline sheet (`TimelineImportPanel.tsx`)

/// What a chapter is called before it is a stage — the import's own rule: its
/// title, else its places' two ends, else its id.
public func timelineChapterName(_ chapter: WinnowChapter) -> String {
    let title = (chapter.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !title.isEmpty { return title }
    let names = chapter.places.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    guard let first = names.first, let last = names.last else { return "chapter \(chapter.id)" }
    return first == last ? first : "\(first) \(placeArrow) \(last)"
}

/// A chapter's second line: its span or `undated`, its media, and where its
/// place or its days were NOT measured — before it becomes a stage's.
public func timelineChapterLine(_ chapter: WinnowChapter) -> String {
    let start = chapter.startDate ?? ""
    let end = chapter.endDate ?? ""
    var line = !start.isEmpty && !end.isEmpty ? diffSpanText(start, end) : "undated"
    line += " · \(chapter.assetCount) media"
    if chapter.placeInferred && !chapter.places.isEmpty { line += " · place guessed from the legs around it" }
    if chapter.tzOffsetHours == nil && !start.isEmpty { line += " · days read at UTC" }
    return line
}

/// Which legs a seed starts with: a link's preselection when it names legs
/// that exist, else every leg — the span is the point.
public func seedPreselection(_ chapters: [WinnowChapter], _ preselect: [String]) -> Set<String> {
    if !preselect.isEmpty {
        let named = Set(preselect)
        let present = chapters.filter { named.contains($0.id) }.map(\.id)
        if !present.isEmpty { return Set(present) }
    }
    return Set(chapters.map(\.id))
}

/// The days a seed would leave to no leg, said once: `3 days belong to no leg:
/// 5 Nov 2025 → 7 Nov 2025.` Nil when every day is covered.
public func uncoveredSentence(_ imported: TimelineImport) -> String? {
    guard !imported.uncovered.isEmpty else { return nil }
    let n = imported.uncovered.reduce(0) { $0 + $1.length }
    let list = imported.uncovered.map { diffSpanDates($0.start, $0.end) }.joined(separator: ", ")
    return "\(n) day\(n == 1 ? "" : "s") belong to no leg: \(list)."
}

/// Why a read of an instance came to nothing, and where to sign in when that
/// is why.
public struct StageReadProblem: Equatable, Sendable {
    public var text: String
    /// The instance's login page, when the answer was "not signed in".
    public var loginUrl: String?

    public init(text: String, loginUrl: String? = nil) { self.text = text; self.loginUrl = loginUrl }
}

private func stageReadProblem(_ error: Error, _ client: WinnowClient, notFound: String) -> StageReadProblem {
    if let w = error as? WinnowError {
        if w.kind == .unauthenticated {
            return StageReadProblem(text: "Not signed in to \(client.config.baseUrl).", loginUrl: client.loginUrl())
        }
        if w.kind == .notfound { return StageReadProblem(text: notFound) }
        return StageReadProblem(text: w.message)
    }
    return StageReadProblem(text: (error as? LocalizedError)?.errorDescription ?? String(describing: error))
}

/// A timeline read's failure — a 404 here means "too old for legs", not "gone":
/// no capability flag announces the route.
public func timelineReadProblem(_ error: Error, _ client: WinnowClient) -> StageReadProblem {
    stageReadProblem(error, client,
                     notFound: "\(client.config.baseUrl) does not serve a timeline — it has no legs to read.")
}

/// A day-positions read's failure.
public func geoDaysReadProblem(_ error: Error, _ client: WinnowClient) -> StageReadProblem {
    stageReadProblem(error, client,
                     notFound: "\(client.config.baseUrl) cannot answer for a day's position yet — it is too old for this.")
}

/// What the tool says when an accepted leg made the trip longer.
public func spanWidenedSentence(_ trip: TripDoc) -> String {
    "The trip now runs \(trip.startDate) → \(trip.endDate): its dates grew to hold a leg you accepted."
}

/// A reconcile with nothing to do: `Your trip already matches …`.
public func alreadyMatchesSentence(_ count: Int, deduced: Bool) -> String {
    let what = deduced ? "what the days say" : "the timeline"
    return "Your trip already matches \(what) — \(count) leg\(count == 1 ? "" : "s"), nothing to change."
}

// MARK: - the deduction's settings (`DeduceStagesPanel.tsx`)

/// Where this device keeps them — the web's `localStorage` key, a JSON object.
public let deduceSettingsKey = "atelier.roadtrip.deduce"

/// The stored settings read back, each field clamped the way the web reads
/// it: a radius that is not a positive number and a halt under one day fall to
/// the defaults, a halt rounds, `merge` is the one other way to treat a short
/// halt, a blind day is covered unless it was switched OFF, and a move is
/// invented only where it was switched ON.
public func readDeduceSettings(_ raw: JSONValue?) -> SegmentOptions {
    guard let saved = raw?.objectValue else { return .default }
    let fallback = SegmentOptions.default
    var radius = fallback.radiusKm
    if case .number(let r)? = saved["radiusKm"], r.isFinite, r > 0 { radius = r }
    var nights = fallback.minNights
    if case .number(let n)? = saved["minNights"], n.isFinite, n >= 1 { nights = Int(min(TripJS.round(n), 1e9)) }
    return SegmentOptions(
        radiusKm: radius,
        minNights: nights,
        shortLegs: saved["shortLegs"]?.stringValue == "merge" ? .merge : .list,
        bridgeBlind: saved["bridgeBlind"] != .bool(false),
        interpolateMoves: saved["interpolateMoves"] == .bool(true)
    )
}

/// The settings as they are stored.
public func deduceSettingsJSON(_ options: SegmentOptions) -> JSONValue {
    .object([
        "radiusKm": .number(options.radiusKm),
        "minNights": .number(Double(options.minNights)),
        "shortLegs": .string(options.shortLegs.rawValue),
        "bridgeBlind": .bool(options.bridgeBlind),
        "interpolateMoves": .bool(options.interpolateMoves),
    ])
}

/// What the trip really holds before any proposal: `45 days · 38 placed · 2
/// with media and no position`, and the missing index said when it is.
public func deduceSummary(totalDays: Int, placed: Int, blind: Int, hasCities: Bool) -> String {
    var line = "\(totalDays) day\(totalDays == 1 ? "" : "s") · \(placed) placed · \(blind) with media and no position"
    if !hasCities { line += " · no city index, so legs arrive unnamed" }
    return line
}

/// Why the deduction proposes nothing at all.
public func deduceEmptySentence(placed: Int) -> String {
    placed == 0
        ? "No day of this trip carries a position, so there is no itinerary to work out."
        : "These settings produce no leg — try a wider radius."
}

/// The word a doubtful row carries under its sentence.
public let deduceDoubtNote = "left unticked — a short stop, or placed only from guessed positions"

/// The keys `diffTimeline` gives the deduction's doubtful legs.
public func deduceHeldKeys(_ proposed: [TrackChapter]) -> Set<String> {
    Set(doubtful(proposed).map { "chapter:\($0)" })
}

// MARK: - one picture located (`LocatePicturePanel.tsx`)

/// Where a picture's day came from, said as plainly as it is known.
public func captureDayWords(_ capture: CaptureDate) -> String {
    switch capture.source {
    case .exif: return "the camera’s own record"
    case .source: return "as \(capture.via ?? "the instance it came from") read it"
    case .file: return "the file’s own date — a weak guess, rewritten by any copy or re-grade"
    }
}

/// The index's name for the point and how far it is: `Kalbarri (AU), 3.2 km
/// away`. Nil when nothing was near enough.
public func locateCityLine(_ location: PictureLocation) -> String? {
    guard let city = location.city else { return nil }
    var line = city.name
    if !city.country.isEmpty { line += " (\(city.country))" }
    if let km = location.km { line += ", \(TripJS.toFixed1(km)) km away" }
    return line
}

/// Why nothing is offered, in a sentence that says what to do instead.
public func locateSilenceWords(_ trip: TripDoc, _ location: PictureLocation) -> String {
    switch location.silence {
    case .noPosition?:
        return "This picture carries no position: its EXIF says nothing about where it was taken, and no instance vouched for one."
    case .nullIsland?:
        return "Its position reads 0, 0 — what a camera writes when it never got a fix. Refused rather than believed."
    case .noDate?:
        return "Nothing says which day this picture belongs to, so there is no leg to offer its place to."
    case .outsideTrip?:
        let day = location.date.map(formatIsoDate) ?? "Its day"
        return "\(day) is not a day of this trip (\(formatIsoDate(trip.startDate)) → \(formatIsoDate(trip.endDate))), so nothing is offered here."
    case .noName?:
        return "Nothing in the city index is within \(TripJS.number(gazetteerDefaultMaxKm)) km of that position, so there is no name to offer. The leg keeps its dates."
    case .already?:
        guard let stage = location.stage, let city = location.city else {
            return "That place is already on the leg of this day."
        }
        let label = stageLabel(stage)
        let who = label.isEmpty ? "The leg of that day" : "“\(label)”"
        return "\(who) already names \(city.name). Nothing to add."
    case nil:
        return ""
    }
}
