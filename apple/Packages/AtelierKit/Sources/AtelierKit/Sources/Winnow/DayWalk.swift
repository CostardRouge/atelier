// Walking an instance's library a day at a time, past the end of a day's
// pictures — the arithmetic behind the lightbox's "next day" card. Port of
// `src/shared/sources/winnow/day-walk.ts`.
//
// Paging past the last picture of a day lands on the first picture of the
// NEXT DAY THAT HOLDS ANY, not on an empty Tuesday. The neighbour is asked of
// `/api/assets/calendar` in two steps at most — a window of a couple of months
// first, then, only if that came back empty, the rest of the way to the edge
// of what the library holds (`bounds`).
//
// The deck is `[before, ...pictures, after]`: the two edge cards are ordinary
// items of the lightbox, so its gestures, pager and wrap-around need no
// change; what that costs is knowing which way a page went, which three items
// or more make unambiguous. The effect over this is the app's.

import Foundation

/// Which side of a span — the web's `Side` (renamed: the name is too generic
/// for a module every tool shares).
public enum WalkSide: String, Equatable, Sendable, CaseIterable {
    case before, after
}

/// How far the first question reaches, in days — the web's `FIRST_WINDOW_DAYS`.
public let firstWindowDays = 62

public struct MediaDay: Equatable, Sendable {
    public var date: String
    public var count: Int

    public init(date: String, count: Int) { self.date = date; self.count = count }
}

/// The nearest day holding media on one side of `span`, among a calendar's
/// days — which need not be sorted. Days inside the span, or on the wrong
/// side, are ignored.
public func nearestMediaDay(_ days: [MediaDay], _ span: DaySpan, _ side: WalkSide) -> MediaDay? {
    var best: MediaDay?
    for d in days {
        if d.count <= 0 { continue }
        if side == .after ? d.date <= span.to : d.date >= span.from { continue }
        if let b = best {
            if side == .after ? d.date < b.date : d.date > b.date { best = d }
        } else {
            best = d
        }
    }
    return best
}

/// The first window to ask, or nil when there is nowhere to look: nothing is
/// shot after `today`.
public func firstWindow(_ span: DaySpan, _ side: WalkSide, _ today: String) -> DaySpan? {
    if side == .after {
        guard let from = shiftDay(span.to, 1), let far = shiftDay(span.to, firstWindowDays), from <= today else { return nil }
        return DaySpan(from: from, to: far < today ? far : today)
    }
    guard let from = shiftDay(span.from, -firstWindowDays), let to = shiftDay(span.from, -1) else { return nil }
    return DaySpan(from: from, to: to)
}

/// Where to look once `asked` came back empty: the rest of the way to the
/// edge of the library, or nil when `asked` already reached it (or the
/// instance holds nothing dated at all).
public func restWindow(_ asked: DaySpan, _ side: WalkSide, _ bounds: CalendarBounds?, _ today: String) -> DaySpan? {
    guard let bounds else { return nil }
    if side == .after {
        let edge = bounds.max < today ? bounds.max : today
        guard let from = shiftDay(asked.to, 1), from <= edge else { return nil }
        return DaySpan(from: from, to: edge)
    }
    guard let to = shiftDay(asked.from, -1), bounds.min <= to else { return nil }
    return DaySpan(from: bounds.min, to: to)
}

/// What a deck index is: an edge card, or a picture of the day.
public enum DeckEntry: Equatable, Sendable {
    case edge(WalkSide)
    case body(index: Int)
}

/// The deck is `[before, ...body, after]`, `bodyLength` ≥ 1 (a day with no
/// picture to show still has its one card saying so).
public func deckEntry(_ at: Int, _ bodyLength: Int) -> DeckEntry {
    if at <= 0 { return .edge(.before) }
    if at > bodyLength { return .edge(.after) }
    return .body(index: at - 1)
}

/// Which way a page went, from the index it left to the one it landed on, in
/// a deck that wraps. Unambiguous from three items up.
public func pageDirection(_ from: Int, _ to: Int, _ count: Int) -> Int {
    guard count > 0 else { return -1 }
    return (from + 1) % count == to ? 1 : -1
}
