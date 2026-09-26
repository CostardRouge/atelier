// The pictures a hook's chooser offers — pure, so the rules are tested and the
// sheet only draws them. Port of `src/shared/roadtrip/hooks/picture-pool.ts`.
//
// The pool is what was SHOT over a span of the trip, wherever it is kept: the
// Library's photographs (dated by their EXIF, `MediaDate.swift`) and, when an
// instance is connected, what it holds for those days. One picture in both —
// a file already brought in from the instance, or a folder copy of the same
// capture — is offered once, from the Library, where it costs no request.
//
// The chooser starts with EVERYTHING in the span ticked (the maintainer's
// gesture: take the lot, untick what does not belong), except when the
// variant already holds a list — then that list is what is ticked, and a
// picture it never had stays unticked until the span changes.
//
// What stays the app's: listing the Library and asking the instance for the
// span, the thumbnails, and — once the author confirms — decoding exactly
// what the variant then asks for (`wantsPictures`) inside the one pixel
// budget (`PictureBudget.swift`).

import Foundation

/// Where a candidate is offered from.
public enum PoolOrigin: String, CaseIterable, Sendable {
    case library, instance
}

/// One picture the chooser may offer.
public struct PoolCandidate: Equatable, Sendable {
    /// Unique within the pool — the list's identity and the tick's.
    public var key: String
    /// How the picture is found again. A Library file's hash is added on confirm.
    public var ref: SavedMediaRef
    /// The day it was shot.
    public var date: IsoDate
    /// The capture instant in ms — orders a day's pictures.
    public var takenAt: Double
    /// Where it was shot, when the file or the instance says.
    public var coords: GeoPoint?
    public var origin: PoolOrigin

    public init(key: String, ref: SavedMediaRef, date: IsoDate, takenAt: Double, coords: GeoPoint? = nil, origin: PoolOrigin) {
        self.key = key; self.ref = ref; self.date = date; self.takenAt = takenAt; self.coords = coords; self.origin = origin
    }
}

/// Anything the chooser lists that carries a candidate — the web's
/// `T extends PoolCandidate`, so an app row with its thumbnail beside the
/// candidate goes through the same rules.
public protocol PoolCandidateCarrying {
    var candidate: PoolCandidate { get }
}

extension PoolCandidate: PoolCandidateCarrying {
    public var candidate: PoolCandidate { self }
}

/// Two days, both ends included.
public struct DateSpan: Equatable, Sendable {
    public var from: IsoDate
    public var to: IsoDate

    public init(from: IsoDate, to: IsoDate) {
        self.from = from; self.to = to
    }
}

/// Two refs to one picture: the same source id, the same content, or the same
/// name (whatever its case) and size.
public func sameRef(_ a: SavedMediaRef, _ b: SavedMediaRef) -> Bool {
    if let x = a.assetId, !x.isEmpty, let y = b.assetId, !y.isEmpty { return x == y }
    if let x = a.hash, !x.isEmpty, let y = b.hash, !y.isEmpty { return x == y }
    return a.name.lowercased() == b.name.lowercased() && a.size == b.size
}

/// Pool order: the day, the instant, the name — a stable sort, as the web's.
public func sortPool<T: PoolCandidateCarrying>(_ items: [T]) -> [T] {
    func order(_ a: PoolCandidate, _ b: PoolCandidate) -> Int {
        let byDate = packLocaleCompare(a.date, b.date)
        if byDate != 0 { return byDate }
        if a.takenAt != b.takenAt { return a.takenAt < b.takenAt ? -1 : 1 }
        return packLocaleCompare(a.ref.name, b.ref.name)
    }
    return items.enumerated()
        .sorted { x, y in
            let c = order(x.element.candidate, y.element.candidate)
            return c != 0 ? c < 0 : x.offset < y.offset
        }
        .map(\.element)
}

/// The key a name-and-size match is made on.
private func poolNameKey(_ ref: SavedMediaRef) -> String {
    "\(ref.name.lowercased()):\(ref.size)"
}

/// The Library's candidates and the instance's as one list, each picture
/// once: an instance row the Library already holds — by its source id, or by
/// name and size — is dropped in favour of the Library's copy.
public func mergePool<T: PoolCandidateCarrying>(_ library: [T], _ instance: [T]) -> [T] {
    let ids = Set(library.compactMap { c -> String? in
        guard let id = c.candidate.ref.assetId, !id.isEmpty else { return nil }
        return id
    })
    let names = Set(library.map { poolNameKey($0.candidate.ref) })
    let fromInstance = instance.filter { item in
        let ref = item.candidate.ref
        if let id = ref.assetId, !id.isEmpty, ids.contains(id) { return false }
        return !names.contains(poolNameKey(ref))
    }
    return sortPool(library + fromInstance)
}

/// Only the candidates shot inside `span`, both ends included.
public func inSpan<T: PoolCandidateCarrying>(_ items: [T], _ span: DateSpan) -> [T] {
    items.filter { $0.candidate.date >= span.from && $0.candidate.date <= span.to }
}

/// One day of the pool, with the trip's day for its heading.
public struct PoolDayGroup<T> {
    public var date: IsoDate
    /// The trip's day, or nil for a day the calendar does not hold.
    public var day: HookDay?
    public var items: [T]

    public init(date: IsoDate, day: HookDay?, items: [T]) {
        self.date = date; self.day = day; self.items = items
    }
}

extension PoolDayGroup: Equatable where T: Equatable {}
extension PoolDayGroup: Sendable where T: Sendable {}

/// The pool in day groups, in calendar order, each with the trip's day for
/// its heading.
public func groupByDay<T: PoolCandidateCarrying>(_ items: [T], _ calendar: [HookDay]) -> [PoolDayGroup<T>] {
    // `new Map(...)`: a date listed twice keeps its LAST day.
    var byDate: [IsoDate: HookDay] = [:]
    for day in calendar { byDate[day.date] = day }
    var order: [IsoDate] = []
    var groups: [IsoDate: [T]] = [:]
    for item in sortPool(items) {
        let date = item.candidate.date
        if groups[date] == nil { order.append(date) }
        groups[date, default: []].append(item)
    }
    return order.map { PoolDayGroup(date: $0, day: byDate[$0], items: groups[$0] ?? []) }
}

/// The trip so far: its first day to this piece's own. What a sweep or a
/// drive can tell — a picture shot later has no place on the tape — and so
/// the span the chooser OPENS on. Nil when the piece is dated outside its trip.
public func reachSpan(_ calendar: [HookDay], _ date: IsoDate) -> DateSpan? {
    guard let first = calendar.first, calendar.contains(where: { $0.date == date }) else { return nil }
    return DateSpan(from: first.date, to: date)
}

/// The whole trip, first day to last: how far the chooser's dates may be
/// moved. Wider than `reachSpan` on purpose — a variant that cannot tell a
/// later picture says so on the tile (`laterLeftOff`) rather than the chooser
/// refusing to show it.
public func tripSpan(_ calendar: [HookDay]) -> DateSpan? {
    guard let first = calendar.first, let last = calendar.last else { return nil }
    return DateSpan(from: first.date, to: last.date)
}

/// The span the chooser opens on. With a list already held, the days it
/// covers (inside the trip, so a picture kept from past this piece reopens
/// where it can be seen and is not dropped on confirm); with none, the trip up
/// to the day BEFORE this one — the days a sweep runs through — or this day
/// alone on the trip's first. `includeThisDay` moves that edge to the piece's
/// own day, for a variant whose pictures are not a run-up to it.
public func defaultSpan(_ calendar: [HookDay], _ date: IsoDate, _ selected: [HookPickedPicture],
                        includeThisDay: Bool = false) -> DateSpan? {
    guard let reach = reachSpan(calendar, date), let trip = tripSpan(calendar) else { return nil }
    let held = selected.map(\.date).filter { $0 >= trip.from && $0 <= trip.to }.sorted()
    if let first = held.first, let last = held.last { return DateSpan(from: first, to: last) }
    if includeThisDay { return reach }
    let heroIndex = calendar.firstIndex { $0.date == date } ?? -1
    return DateSpan(from: reach.from, to: heroIndex > 0 ? calendar[heroIndex - 1].date : date)
}

/// Whether a candidate is shot after this piece's day and the variant will
/// leave it off — a sweep and a drive tell the trip up to the piece, never
/// past it (`partitionPicked`). Offered all the same, and marked.
public func laterLeftOff(_ candidateDate: IsoDate, _ pieceDate: IsoDate, _ keepsLater: Bool) -> Bool {
    !keepsLater && candidateDate > pieceDate
}

/// Which one-click span a `QuickSpan` is.
public enum QuickSpanId: String, CaseIterable, Sendable {
    case whole, trip, leg, week, day
}

/// A one-click span, with its words.
public struct QuickSpan: Equatable, Sendable {
    public var id: QuickSpanId
    public var label: String
    public var from: IsoDate
    public var to: IsoDate

    public init(id: QuickSpanId, label: String, from: IsoDate, to: IsoDate) {
        self.id = id; self.label = label; self.from = from; self.to = to
    }
}

/// One-click spans, widest first: the whole trip, the trip so far, this leg
/// so far, the last seven days, this day alone. A span that would say the
/// same as an earlier one is left out.
public func quickSpans(_ calendar: [HookDay], _ date: IsoDate, _ stages: [HookStage] = []) -> [QuickSpan] {
    guard let reach = reachSpan(calendar, date), let trip = tripSpan(calendar) else { return [] }
    // `reachSpan` has checked the date is a day of the calendar.
    let heroIndex = calendar.firstIndex { $0.date == date } ?? 0
    let before = heroIndex > 0 ? calendar[heroIndex - 1].date : date
    var out: [QuickSpan] = [
        QuickSpan(id: .whole, label: "Whole trip", from: trip.from, to: trip.to),
        QuickSpan(id: .trip, label: "Trip so far", from: reach.from, to: before),
    ]
    if let leg = stages.first(where: { $0.startDate <= date && date <= $0.endDate }),
       leg.startDate > reach.from, leg.startDate < date {
        out.append(QuickSpan(id: .leg, label: "This leg", from: leg.startDate, to: before))
    }
    let weekStart = calendar[max(0, heroIndex - 7)].date
    if heroIndex > 7 { out.append(QuickSpan(id: .week, label: "Last 7 days", from: weekStart, to: before)) }
    out.append(QuickSpan(id: .day, label: "This day", from: date, to: date))
    var kept: [QuickSpan] = []
    for (i, span) in out.enumerated() {
        let repeats = out[..<i].contains { $0.from == span.from && $0.to == span.to }
        if !repeats { kept.append(span) }
    }
    return kept
}

/// Which candidates start unticked. Nothing, when the variant holds no list —
/// everything in the span is taken. With a list, every candidate it does not
/// name.
public func initialExclusions<T: PoolCandidateCarrying>(_ candidates: [T], _ selected: [HookPickedPicture]) -> Set<String> {
    if selected.isEmpty { return [] }
    return Set(candidates.compactMap { item -> String? in
        let c = item.candidate
        return selected.contains { sameRef($0.ref, c.ref) } ? nil : c.key
    })
}
