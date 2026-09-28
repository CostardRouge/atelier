// The edits the stage ruler and the calendar's context menu make to a trip's
// legs: dragging an edge, sliding a whole leg, starting or ending one on a day
// pointed at. Port of `src/shared/roadtrip/stage-edit.ts`. Each is a pure
// function of (trip, …) → new stages, so a gesture only translates points into
// days and hands over; every drag has a keyboard twin built on the same call.
//
// Rules kept (`roadtrip.md`, «The legs are a horizontal RULER»):
// - Every edit keeps a stage INSIDE the trip: a drag past the trip's edge stops
//   at the edge rather than moving the trip, because the trip's dates are the
//   ruler's own frame and a leg cannot be somewhere the trip was not.
// - An edge dragged past the other COLLAPSES the leg to one day, never
//   reverses it.
// - "Start a stage here" INSIDE a leg is a CUT: the covering leg ends the day
//   before and the new one takes its remaining days, the way a cut on a video
//   timeline ends one clip where the next begins.
// - A menu names the REAL leg it would touch — its label in quotes, else its
//   number in the list, never "this stage".
// - A new leg's name is EMPTY: its label derives from its places.
//
// `crypto.randomUUID()` is a parameter (`makeId`), defaulting to a fresh id.

import Foundation

/// Which end of a leg a gesture moves.
public enum StageEdge: String, CaseIterable, Sendable {
    case start
    case end
}

/// A date held inside a span.
private func stageEditClamp(_ trip: TripSpan, _ date: IsoDate) -> IsoDate {
    if date < trip.startDate { return trip.startDate }
    if date > trip.endDate { return trip.endDate }
    return date
}

private func spanOf(_ trip: TripDoc) -> TripSpan {
    TripSpan(startDate: trip.startDate, endDate: trip.endDate)
}

/// Move one edge of a stage to `date`. The other edge holds; dragging the start
/// past the end (or the end before the start) collapses the leg to that one day
/// rather than reversing it.
public func resizeStage(_ trip: TripSpan, _ stage: TripStage, _ edge: StageEdge, _ date: IsoDate) -> TripStage {
    let d = stageEditClamp(trip, date)
    var next = stage
    switch edge {
    case .start:
        next.startDate = d
        next.endDate = d > stage.endDate ? d : stage.endDate
    case .end:
        next.endDate = d
        next.startDate = d < stage.startDate ? d : stage.startDate
    }
    return next
}

public func resizeStage(_ trip: TripDoc, _ stage: TripStage, _ edge: StageEdge, _ date: IsoDate) -> TripStage {
    resizeStage(spanOf(trip), stage, edge, date)
}

/// Which edge of a leg a pointed-at day is nearer to — what a tap moves while a
/// leg is being adjusted on the calendar. Inside the leg the nearer edge moves;
/// outside it the edge on that side does, whatever the distance, because
/// pointing past the end can only mean "end there". A tie goes to the end:
/// extending a stay is the commoner edit.
public func nearerEdge(_ stage: TripSpan, _ date: IsoDate) -> StageEdge {
    if date < stage.startDate { return .start }
    if date > stage.endDate { return .end }
    let toStart = daysBetween(stage.startDate, date) ?? 0
    let toEnd = daysBetween(date, stage.endDate) ?? 0
    return toStart < toEnd ? .start : .end
}

public func nearerEdge(_ stage: TripStage, _ date: IsoDate) -> StageEdge {
    nearerEdge(TripSpan(startDate: stage.startDate, endDate: stage.endDate), date)
}

/// Slide a whole stage by `days` (truncated to whole days), keeping its length.
/// The slide is reduced so the leg stays inside the trip — a leg already
/// against the trip's end does not move at all. A stage whose span does not
/// parse, or a slide that is not a number, comes back as it was.
public func shiftStage(_ trip: TripSpan, _ stage: TripStage, _ days: Double) -> TripStage {
    guard daysBetween(stage.startDate, stage.endDate) != nil, days.isFinite else { return stage }
    let back = daysBetween(trip.startDate, stage.startDate) ?? 0
    let on = daysBetween(stage.endDate, trip.endDate) ?? 0
    let whole = days.rounded(.towardZero)
    let asked = abs(whole) < 1e9 ? Int(whole) : (whole < 0 ? -1_000_000_000 : 1_000_000_000)
    let delta = max(-back, min(on, asked))
    if delta == 0 { return stage }
    guard let startDate = addDays(stage.startDate, delta), let endDate = addDays(stage.endDate, delta) else {
        return stage
    }
    var next = stage
    next.startDate = startDate
    next.endDate = endDate
    return next
}

public func shiftStage(_ trip: TripDoc, _ stage: TripStage, _ days: Double) -> TripStage {
    shiftStage(spanOf(trip), stage, days)
}

/// Where a new stage goes in `stages` so the list stays in lived order: before
/// the first stage that starts after it, else last.
public func insertStageInOrder(_ stages: [TripStage], _ stage: TripStage) -> [TripStage] {
    var next = stages
    let at = stages.firstIndex { $0.startDate > stage.startDate } ?? stages.count
    next.insert(stage, at: at)
    return next
}

public struct StageEditResult: Equatable, Sendable {
    public var stages: [TripStage]
    /// The leg the edit is about, for the editor to open.
    public var selectedId: String

    public init(stages: [TripStage], selectedId: String) { self.stages = stages; self.selectedId = selectedId }
}

/// A new leg beginning on `date` — "from here, a new leg". It runs until the
/// day before the next leg begins, else to the trip's end, and a leg that was
/// covering this day is CUT to end the day before: pointing inside a leg and
/// starting another is how a leg is split. A leg that itself begins on this
/// very day is left alone and the new one is a single day beside it, to be
/// dragged wider. Never shorter than the one day pointed at.
public func startStageAt(_ trip: TripDoc, _ date: IsoDate, makeId: () -> String = newTripId) -> StageEditResult {
    let start = stageEditClamp(spanOf(trip), date)
    var end = trip.endDate
    for s in trip.stages {
        if s.startDate > start, let before = addDays(s.startDate, -1), before < end { end = before }
        if s.startDate == start { end = start }
        // A split hands the cut leg's remaining days to the new one.
        if s.startDate < start && s.endDate >= start && s.endDate < end { end = s.endDate }
    }
    if end < start { end = start }
    let stage = createTripStage("", "", start, end, id: makeId())
    let cut = addDays(start, -1)
    let stages = trip.stages.map { s -> TripStage in
        guard let cut, s.startDate < start, s.endDate >= start else { return s }
        var trimmed = s
        trimmed.endDate = cut
        return trimmed
    }
    return StageEditResult(stages: insertStageInOrder(stages, stage), selectedId: stage.id)
}

/// A new leg covering exactly a gap the ruler found, held inside the trip.
public func stageOverGap(_ trip: TripSpan, _ startDate: IsoDate, _ endDate: IsoDate,
                         makeId: () -> String = newTripId) -> TripStage {
    createTripStage("", "", stageEditClamp(trip, startDate), stageEditClamp(trip, endDate), id: makeId())
}

public func stageOverGap(_ trip: TripDoc, _ startDate: IsoDate, _ endDate: IsoDate,
                         makeId: () -> String = newTripId) -> TripStage {
    stageOverGap(spanOf(trip), startDate, endDate, makeId: makeId)
}

/// Which of the three things the calendar's context menu offers.
public enum DayStageActionKind: String, CaseIterable, Sendable {
    case start
    case end
    case extend
}

/// What the calendar's context menu offers for one day. Nothing here mutates:
/// `apply` is run by the caller, on the trip as it is when the item is chosen.
public struct DayStageAction: Sendable {
    public var id: DayStageActionKind
    public var label: String
    public var apply: @Sendable (TripDoc) -> StageEditResult

    public init(id: DayStageActionKind, label: String, apply: @escaping @Sendable (TripDoc) -> StageEditResult) {
        self.id = id; self.label = label; self.apply = apply
    }
}

/// How the menu names a leg: its label in quotes, else its number in the list —
/// the same "Stage 2" the editor's own header prints — never a placeholder like
/// "this stage" that could be any of them.
private func stageMenuName(_ stage: TripStage, index: Int) -> String {
    let label = stageLabel(stage)
    return label.isEmpty ? "stage \(index + 1)" : "“\(label)”"
}

/// The actions that make sense on `date`, in the order they are offered: start
/// a leg here (always); end the leg covering this day here (when one does and
/// does not already end on it); extend the last leg that ended before this day
/// to reach it (when the day is uncovered and such a leg exists). Each label
/// names the REAL leg it would touch — "End “Perth → Kalbarri” here".
public func dayStageActions(_ trip: TripDoc, _ date: IsoDate) -> [DayStageAction] {
    if !isWithin(trip.startDate, trip.endDate, date) { return [] }
    var actions = [DayStageAction(id: .start, label: "Start a stage here") { t in startStageAt(t, date) }]
    if let index = tripStageIndexAt(trip, date) {
        let covering = trip.stages[index]
        if covering.endDate != date {
            let id = covering.id
            actions.append(DayStageAction(id: .end, label: "End \(stageMenuName(covering, index: index)) here") { t in
                StageEditResult(stages: t.stages.map { $0.id == id ? resizeStage(t, $0, .end, date) : $0 }, selectedId: id)
            })
        }
        return actions
    }
    var previous: Int? = nil
    for (i, s) in trip.stages.enumerated() where s.endDate < date {
        if let p = previous, s.endDate < trip.stages[p].endDate { continue }
        previous = i
    }
    if let index = previous {
        let target = trip.stages[index]
        let id = target.id
        actions.append(DayStageAction(id: .extend, label: "Extend \(stageMenuName(target, index: index)) to here") { t in
            StageEditResult(stages: t.stages.map { $0.id == id ? resizeStage(t, $0, .end, date) : $0 }, selectedId: id)
        })
    }
    return actions
}
