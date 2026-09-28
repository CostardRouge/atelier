// A Winnow timeline, read as Road Trip stages — the arithmetic behind seeding
// a trip from an instance and completing one later (`docs/winnow-timeline.md`).
// Port of `src/shared/roadtrip/timeline-import.ts`.
//
// A Winnow CHAPTER (media grouped by place and date) and a Road Trip STAGE (a
// leg: a span, and its places in the order they were lived) are the same
// object reached from opposite ends, so nothing is invented here: this module
// owns the one table that maps the first onto the second, and the panels that
// use it (create a trip · complete a trip · deduce the legs) differ in what
// they show, never in what they compute.
//
// Four rules it holds:
// - **An import creates stages and never posts.** The grid's value is its
//   holes; a calendar pre-filled from a timeline has none left.
// - **Seed, then reconcile by proposal — never sync.** `diffTimeline` says what
//   the timeline has that the trip does not (and the reverse) and
//   `applyTimelineDiff` changes only the entries the author accepted. A leg is
//   paired id → span → first place, because Winnow's chapter ids are derived
//   per request and are not stable: the span and the place are the real path.
// - **Empty means derived.** A chapter whose title is only its route yields a
//   stage with an EMPTY name, so the label keeps deriving when a place is
//   edited; a place's region rides on the place and the stage's own stays
//   empty, so `stageRegionLabel` prints only what the places agree on.
// - **Never invent a place, never recompute a date.** A chapter with no place
//   yields a stage with a span and no place. A date that is not a calendar day
//   is REFUSED rather than sliced out of an instant.
//
// `TimelineChapter` is Atelier's OWN notion of a chapter, not Winnow's wire
// shape: `chapterFromWire` (`Sources/Winnow/WinnowWire.swift`) normalises what
// arrives into a `WinnowChapter`, whose fields are this record's, and the
// itinerary deduction (`TrackChapters.swift`) is a second producer of it. This
// module never fetches. `crypto.randomUUID()` is a parameter (`makeId`).

import Foundation

/// A place as a chapter names it: nil coordinates are the normal case; decimal
/// degrees, south and west negative — EXIF's convention. The wire's own record.
public typealias TimelinePlace = WinnowChapterPlace

/// A chapter, as Atelier reads one. `startDate`/`endDate` are the first and
/// last CAPTURE DATES of its media — camera-local calendar days, never
/// instants. `places` are in lived order. `revision` is whatever the instance
/// offers to detect a re-clustering.
public struct TimelineChapter: Equatable, Sendable {
    public var id: String
    public var title: String?
    public var startDate: String?
    public var endDate: String?
    public var places: [TimelinePlace]
    public var revision: String?

    public init(id: String, title: String? = nil, startDate: String?, endDate: String?, places: [TimelinePlace] = [],
                revision: String? = nil) {
        self.id = id; self.title = title; self.startDate = startDate; self.endDate = endDate
        self.places = places; self.revision = revision
    }

    /// A chapter as the instance's client normalised it — handed over unchanged.
    public init(_ chapter: WinnowChapter) {
        self.init(id: chapter.id, title: chapter.title, startDate: chapter.startDate, endDate: chapter.endDate,
                  places: chapter.places, revision: chapter.revision)
    }

    /// The chapter as JSON, the way the web's object serialises: the title and
    /// the dates written as they stand (null for none), a place's absent
    /// region and coordinates left out, the revision only when there is one.
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "id": .string(id),
            "title": title.map(JSONValue.string) ?? .null,
            "startDate": startDate.map(JSONValue.string) ?? .null,
            "endDate": endDate.map(JSONValue.string) ?? .null,
            "places": .array(places.map { place in
                var p: [String: JSONValue] = ["name": .string(place.name)]
                if let region = place.region { p["region"] = .string(region) }
                if let lat = place.lat { p["lat"] = .number(lat) }
                if let lon = place.lon { p["lon"] = .number(lon) }
                return .object(p)
            }),
        ]
        if let revision { o["revision"] = .string(revision) }
        return .object(o)
    }
}

public struct ImportOptions: Equatable, Sendable {
    /// The instance, as `sourceIdFor()` mints it — what `origin` will name.
    public var sourceId: String
    public var importedAt: Double

    public init(sourceId: String, importedAt: Double) { self.sourceId = sourceId; self.importedAt = importedAt }
}

public enum ImportWarningKind: String, CaseIterable, Sendable {
    /// Both dates missing: a stage needs a span, so the chapter is left out.
    case noDates = "no-dates"
    /// A date arrived as an instant or garbage; refused, never recomputed.
    case notADate = "not-a-date"
    /// End before start; the two were swapped.
    case reversedSpan = "reversed-span"
    /// A second chapter with an id already seen; the first one is kept.
    case duplicateId = "duplicate-id"
    /// Two legs share days; the LATER one is what a badge names on them.
    case overlap
}

public struct ImportWarning: Equatable, Sendable {
    public var kind: ImportWarningKind
    public var chapterId: String
    /// A sentence the panel prints as is.
    public var message: String

    public init(kind: ImportWarningKind, chapterId: String, message: String) {
        self.kind = kind; self.chapterId = chapterId; self.message = message
    }
}

public struct TimelineImport: Equatable, Sendable {
    /// Stages in lived order (by span), each carrying its `origin`.
    public var stages: [TripStage]
    /// First start to last end of the stages; nil when nothing dated came in.
    public var span: TripSpan?
    /// Runs of days inside the span that belong to no leg — said, never hidden.
    public var uncovered: [Gap]
    /// "Perth → Cairns", derived from the stages — the seed panel's preview of
    /// the route it is about to create. NOT written onto the trip: since v27
    /// nothing stores a route.
    public var destination: String
    public var warnings: [ImportWarning]

    public init(stages: [TripStage], span: TripSpan?, uncovered: [Gap], destination: String, warnings: [ImportWarning]) {
        self.stages = stages; self.span = span; self.uncovered = uncovered; self.destination = destination
        self.warnings = warnings
    }
}

private func chapterTitleOf(_ chapter: TimelineChapter) -> String {
    let own = (chapter.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return own.isEmpty ? "chapter \(chapter.id)" : own
}

private func finiteWithin(_ value: Double?, _ limit: Double) -> Bool {
    guard let value, value.isFinite else { return false }
    return abs(value) <= limit
}

/// The places worth keeping: named, with coordinates only when both are sound.
private func chapterPlaces(_ chapter: TimelineChapter, _ makeId: () -> String) -> [TripPlace] {
    chapter.places
        .filter { !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        .map { place in
            let coords: GeoPoint? = finiteWithin(place.lat, 90) && finiteWithin(place.lon, 180)
                ? GeoPoint(lat: place.lat!, lon: place.lon!) : nil
            return createTripPlace(place.name, place.region ?? "", coords: coords, id: makeId())
        }
}

/// `\s*(?:→|->|–|—|-|\bto\b)\s*`, case-insensitive — what joins the two ends
/// of a route however the instance spelt it.
private let routeJoin = try! NSRegularExpression(pattern: "\\s*(?:→|->|–|—|-|\\bto\\b)\\s*", options: [.caseInsensitive])

/// "Perth → Cairns", "Perth - Cairns", "perth to cairns" all say the route the
/// places already derive. Reduced to the ends, lower-cased, so a title that is
/// ONLY the route is recognised whatever punctuation the instance chose.
private func routeKey(_ text: String) -> String {
    let ns = text as NSString
    var parts: [String] = []
    var cursor = 0
    for match in routeJoin.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        parts.append(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
        cursor = match.range.location + match.range.length
    }
    parts.append(ns.substring(from: cursor))
    return parts
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty }
        .joined(separator: "|")
}

/// The stage's stored name: the chapter's title, unless the title is nothing
/// more than what the places derive — then EMPTY, so the label stays alive when
/// a place is renamed.
private func stageNameFor(_ title: String, _ places: [TripPlace]) -> String {
    let own = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if own.isEmpty { return "" }
    let derived = stageLabel(TripStage(id: "", name: "", region: "", startDate: "", endDate: "", places: places))
    if derived.isEmpty { return own }
    return routeKey(own) == routeKey(derived) ? "" : own
}

/// Lived order: by start, then by end — the only order the dates can give.
private func livedBefore(_ a: TripStage, _ b: TripStage) -> Bool {
    if a.startDate != b.startDate { return a.startDate < b.startDate }
    return a.endDate < b.endDate
}

/// `Array.prototype.sort` is stable; so is this.
private func sortedStably<T>(_ items: [T], _ before: (T, T) -> Bool) -> [T] {
    items.enumerated().sorted { x, y in
        if before(x.element, y.element) { return true }
        if before(y.element, x.element) { return false }
        return x.offset < y.offset
    }.map(\.element)
}

/// The runs of `[start, end]` that no stage covers.
private func uncoveredRuns(_ start: IsoDate, _ end: IsoDate, _ stages: [TripStage]) -> [Gap] {
    var gaps: [Gap] = []
    var run: [IsoDate] = []
    func close() {
        if let first = run.first, let last = run.last { gaps.append(Gap(start: first, end: last, length: run.count)) }
        run = []
    }
    for day in enumerateDays(start, end) {
        if stages.contains(where: { isWithin($0.startDate, $0.endDate, day) }) { close() } else { run.append(day) }
    }
    close()
    return gaps
}

/// Chapters → stages. Every chapter that cannot become a stage is named in
/// `warnings` with the reason; nothing is dropped in silence.
public func importTimeline(_ chapters: [TimelineChapter], _ options: ImportOptions,
                           makeId: () -> String = newTripId) -> TimelineImport {
    var warnings: [ImportWarning] = []
    var seen: Set<String> = []
    var stages: [TripStage] = []

    for chapter in chapters {
        let title = chapterTitleOf(chapter)
        if seen.contains(chapter.id) {
            warnings.append(ImportWarning(kind: .duplicateId, chapterId: chapter.id,
                                          message: "“\(title)” arrived twice under the same id; the first one is kept."))
            continue
        }
        seen.insert(chapter.id)

        let start = chapter.startDate ?? ""
        let end = chapter.endDate ?? ""
        if start.isEmpty && end.isEmpty {
            warnings.append(ImportWarning(kind: .noDates, chapterId: chapter.id,
                                          message: "“\(title)” has no dated media, so it cannot be a leg."))
            continue
        }
        if let bad = [chapter.startDate, chapter.endDate].first(where: { $0 == nil || $0!.isEmpty || !isIsoDate($0!) }) {
            // `${bad ?? 'missing'}`: a null says "missing", an empty text says nothing.
            let said = bad ?? "missing"
            warnings.append(ImportWarning(
                kind: .notADate, chapterId: chapter.id,
                message: "“\(title)” has a date that is not a calendar day (\(said)); "
                    + "it was left out rather than recomputed here."
            ))
            continue
        }
        var startDate = start
        var endDate = end
        if startDate > endDate {
            swap(&startDate, &endDate)
            warnings.append(ImportWarning(kind: .reversedSpan, chapterId: chapter.id,
                                          message: "“\(title)” ended before it started; the two dates were swapped."))
        }

        let places = chapterPlaces(chapter, makeId)
        let revision = (chapter.revision ?? "").isEmpty ? nil : chapter.revision
        var stage = createTripStage(stageNameFor(chapter.title ?? "", places), "", startDate, endDate,
                                    places: places, id: makeId())
        stage.origin = StageOrigin(sourceId: options.sourceId, chapterId: chapter.id, revision: revision,
                                   importedAt: options.importedAt)
        stages.append(stage)
    }

    stages = sortedStably(stages, livedBefore)
    if stages.count > 1 {
        for i in 1..<stages.count {
            let prev = stages[i - 1]
            let cur = stages[i]
            if prev.endDate < cur.startDate { continue }
            let last = prev.endDate < cur.endDate ? prev.endDate : cur.endDate
            let days = (daysBetween(cur.startDate, last) ?? 0) + 1
            let prevName = stageLabel(prev).isEmpty ? prev.origin?.chapterId ?? "" : stageLabel(prev)
            let curName = stageLabel(cur).isEmpty ? cur.origin?.chapterId ?? "" : stageLabel(cur)
            warnings.append(ImportWarning(
                kind: .overlap, chapterId: cur.origin?.chapterId ?? "",
                message: "“\(prevName)” and “\(curName)” share \(days) day\(days == 1 ? "" : "s"); "
                    + "on those, a badge names the later one."
            ))
        }
    }

    var span: TripSpan? = nil
    if let first = stages.first {
        let end = stages.reduce(first.endDate) { $1.endDate > $0 ? $1.endDate : $0 }
        span = TripSpan(startDate: first.startDate, endDate: end)
    }

    return TimelineImport(
        stages: stages,
        span: span,
        uncovered: span.map { uncoveredRuns($0.startDate, $0.endDate, stages) } ?? [],
        destination: tripRouteLabel(stages),
        warnings: warnings
    )
}

/// The same, over what the instance's client normalised.
public func importTimeline(_ chapters: [WinnowChapter], _ options: ImportOptions,
                           makeId: () -> String = newTripId) -> TimelineImport {
    importTimeline(chapters.map(TimelineChapter.init), options, makeId: makeId)
}

/// A brand-new trip from an import — "create a trip from a timeline". Its span
/// and stages come from the timeline; its name from the author; its voice
/// (words, theme, call to action, hook defaults) is the factory's, because a
/// source has no opinion about how a trip is told. No post is created. Nil when
/// nothing dated came in. `sourceId` is where the DOCUMENT lives — this device
/// unless said otherwise — never the instance the timeline came from, which is
/// on every stage's `origin`.
public func tripFromTimeline(_ name: String, _ imported: TimelineImport, sourceId: String = defaultSourceId,
                             now: Double = nowMillis(), id: String = newTripId()) -> TripDoc? {
    guard let span = imported.span else { return nil }
    var doc = createTripDoc(name, span.startDate, span.endDate, sourceId: sourceId, now: now, id: id)
    doc.stages = imported.stages
    return doc
}

// MARK: - the diff

public enum DiffKind: String, CaseIterable, Sendable {
    /// The timeline has a leg the trip does not.
    case add
    /// Matched, and nothing differs.
    case unchanged
    /// Matched, and the timeline's version differs in `changes`.
    case changed
    /// A stage seeded from this source whose chapter is no longer there.
    case dropped
}

/// How an incoming leg was paired with a stage — the web's `MatchedBy`
/// (renamed: the kernel's `MatchedBy` is the media reconcile's). `id` is the
/// fast path; the other two keep the diff right when ids are useless.
public enum TimelineMatchedBy: String, CaseIterable, Sendable {
    case id
    case span
    case place
}

public enum ChangedField: String, CaseIterable, Sendable {
    case name
    case span
    case places
}

public struct DiffEntry: Equatable, Sendable {
    /// Stable within one diff — what a panel ticks and `applyTimelineDiff` reads.
    public var key: String
    public var kind: DiffKind
    /// The leg as the timeline has it; nil for `dropped`.
    public var incoming: TripStage?
    /// The trip's own stage; nil for `add`.
    public var existing: TripStage?
    public var matchedBy: TimelineMatchedBy?
    public var changes: [ChangedField]

    public init(key: String, kind: DiffKind, incoming: TripStage?, existing: TripStage?, matchedBy: TimelineMatchedBy?,
                changes: [ChangedField]) {
        self.key = key; self.kind = kind; self.incoming = incoming; self.existing = existing
        self.matchedBy = matchedBy; self.changes = changes
    }
}

private func firstPlaceName(_ stage: TripStage) -> String {
    stageStart(stage)?.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
}

private func sameSpan(_ a: TripStage, _ b: TripStage) -> Bool {
    a.startDate == b.startDate && a.endDate == b.endDate
}

private func spansOverlap(_ a: TripStage, _ b: TripStage) -> Bool {
    a.startDate <= b.endDate && b.startDate <= a.endDate
}

private func placeNames(_ stage: TripStage) -> [String] {
    stage.places.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty }
}

private func changesBetween(_ existing: TripStage, _ incoming: TripStage) -> [ChangedField] {
    var out: [ChangedField] = []
    if stageLabel(existing) != stageLabel(incoming) { out.append(.name) }
    if !sameSpan(existing, incoming) { out.append(.span) }
    if placeNames(existing) != placeNames(incoming) { out.append(.places) }
    return out
}

/// What re-running an import would change, leg by leg, for the author to
/// accept or reject. Stages made by hand are never `dropped` — the timeline has
/// no say over them — but they can be matched by span or by first place, so a
/// hand-drawn Kalbarri and the chapter Winnow computed for it meet instead of
/// doubling up.
public func diffTimeline(_ trip: TripDoc, _ imported: TimelineImport, _ sourceId: String) -> [DiffEntry] {
    // The trip's stages not yet paired, by index, in the trip's order.
    var unmatched = Array(trip.stages.indices)
    var entries: [DiffEntry] = []

    func pair(_ incoming: TripStage, _ at: Int, _ matchedBy: TimelineMatchedBy) {
        unmatched.removeAll { $0 == at }
        let existing = trip.stages[at]
        let changes = changesBetween(existing, incoming)
        entries.append(DiffEntry(key: "chapter:\(incoming.origin?.chapterId ?? "")",
                                 kind: changes.isEmpty ? .unchanged : .changed,
                                 incoming: incoming, existing: existing, matchedBy: matchedBy, changes: changes))
    }

    var pending: [TripStage] = []
    for incoming in imported.stages {
        let id = incoming.origin?.chapterId
        let byId = unmatched.first { i in
            let o = trip.stages[i].origin
            return o?.sourceId == sourceId && o?.chapterId == id
        }
        if let byId { pair(incoming, byId, .id) } else { pending.append(incoming) }
    }
    var stillPending: [TripStage] = []
    for incoming in pending {
        if let bySpan = unmatched.first(where: { sameSpan(trip.stages[$0], incoming) }) {
            pair(incoming, bySpan, .span)
        } else {
            stillPending.append(incoming)
        }
    }
    for incoming in stillPending {
        let name = firstPlaceName(incoming)
        let byPlace = name.isEmpty ? nil : unmatched.first { i in
            firstPlaceName(trip.stages[i]) == name && spansOverlap(trip.stages[i], incoming)
        }
        if let byPlace {
            pair(incoming, byPlace, .place)
        } else {
            entries.append(DiffEntry(key: "chapter:\(incoming.origin?.chapterId ?? "")", kind: .add,
                                     incoming: incoming, existing: nil, matchedBy: nil, changes: []))
        }
    }
    for i in unmatched {
        let existing = trip.stages[i]
        guard existing.origin?.sourceId == sourceId else { continue }
        entries.append(DiffEntry(key: "stage:\(existing.id)", kind: .dropped, incoming: nil, existing: existing,
                                 matchedBy: nil, changes: []))
    }

    return sortedStably(entries) { a, b in
        guard let x = a.incoming ?? a.existing, let y = b.incoming ?? b.existing else { return false }
        return livedBefore(x, y)
    }
}

public struct AppliedDiff: Equatable, Sendable {
    public var trip: TripDoc
    /// The trip's span had to grow to hold an accepted leg; it never shrinks.
    public var spanWidened: Bool

    public init(trip: TripDoc, spanWidened: Bool) { self.trip = trip; self.spanWidened = spanWidened }
}

/// Apply the entries the author ticked, and only those. An accepted `changed`
/// takes the timeline's name, span and places onto the SAME stage (its id and
/// the region the author typed survive); an accepted `unchanged` only stamps
/// the origin onto a stage that was matched without one, so the next diff finds
/// it by id. Posts, words, theme, call to action and hook defaults are never
/// touched — a source has no opinion about them. Nothing accepted gives the
/// trip back as it was.
public func applyTimelineDiff<S: Sequence>(_ trip: TripDoc, _ entries: [DiffEntry], _ accepted: S,
                                           now: Double = nowMillis()) -> AppliedDiff where S.Element == String {
    let chosen = Set(accepted)
    var stages = trip.stages
    var touched = false

    for entry in entries where chosen.contains(entry.key) {
        touched = true
        switch entry.kind {
        case .add:
            if let incoming = entry.incoming { stages.append(incoming) }
        case .dropped:
            if let existing = entry.existing { stages.removeAll { $0.id == existing.id } }
        case .changed, .unchanged:
            guard let incoming = entry.incoming, let existing = entry.existing else { continue }
            stages = stages.map { s in
                guard s.id == existing.id else { return s }
                var next = s
                if entry.kind == .changed {
                    next.name = incoming.name
                    next.startDate = incoming.startDate
                    next.endDate = incoming.endDate
                    next.places = incoming.places
                }
                if var origin = incoming.origin {
                    origin.importedAt = now
                    next.origin = origin
                }
                return next
            }
        }
    }
    if !touched { return AppliedDiff(trip: trip, spanWidened: false) }

    stages = sortedStably(stages, livedBefore)
    var startDate = trip.startDate
    var endDate = trip.endDate
    for s in stages {
        if s.startDate < startDate { startDate = s.startDate }
        if s.endDate > endDate { endDate = s.endDate }
    }
    let spanWidened = startDate != trip.startDate || endDate != trip.endDate
    var next = trip
    next.stages = stages
    next.startDate = startDate
    next.endDate = endDate
    next.updatedAt = now
    return AppliedDiff(trip: next, spanWidened: spanWidened)
}
