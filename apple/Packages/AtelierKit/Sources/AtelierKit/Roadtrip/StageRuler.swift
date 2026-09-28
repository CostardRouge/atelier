// The geometry of the stage ruler — the trip's legs laid along one horizontal
// track, DaVinci-style, under the calendar. Port of
// `src/shared/roadtrip/stage-ruler.ts`.
//
// Everything here is in DAY OFFSETS from the trip's first day: a bar starts at
// offset `from` and covers `length` days, so a view only multiplies by a point
// width. A stage that reaches outside the trip is CLIPPED to it for drawing and
// never rewritten — the ruler shows the trip, the stage keeps its own dates
// until the author drags them. Overlapping legs (a travel day) STACK into lanes
// rather than hide one another. On a phone the web draws no ruler at all (the
// legs are a sheet, dragged on the calendar); the arithmetic is the same.
//
// Pure.

import Foundation

public struct RulerBar: Equatable, Sendable {
    public var stage: TripStage
    /// Position of the stage in `trip.stages` — what picks its tint.
    public var index: Int
    /// 0-based day offset from the trip's first day, after clipping.
    public var from: Int
    /// Days covered inside the trip, at least 1.
    public var length: Int
    /// Row on the track; overlapping legs stack downwards.
    public var lane: Int
    /// The stage began before the span drawn — its left edge is the span's, not its own.
    public var clipStart: Bool
    /// The stage ended after the span drawn.
    public var clipEnd: Bool

    public init(stage: TripStage, index: Int, from: Int, length: Int, lane: Int, clipStart: Bool, clipEnd: Bool) {
        self.stage = stage; self.index = index; self.from = from; self.length = length; self.lane = lane
        self.clipStart = clipStart; self.clipEnd = clipEnd
    }
}

/// A run of days no stage covers, where the ruler offers to add one.
public struct RulerGap: Equatable, Sendable {
    public var from: Int
    public var length: Int
    public var startDate: IsoDate
    public var endDate: IsoDate

    public init(from: Int, length: Int, startDate: IsoDate, endDate: IsoDate) {
        self.from = from; self.length = length; self.startDate = startDate; self.endDate = endDate
    }
}

public struct RulerMonth: Equatable, Sendable {
    /// Day offset the label sits at.
    public var offset: Int
    public var label: String

    public init(offset: Int, label: String) { self.offset = offset; self.label = label }
}

/// One stroke of the track's scale — a day, or a week when days crowd.
public struct RulerTick: Equatable, Sendable {
    /// Day offset the stroke stands at.
    public var offset: Int
    /// A Monday or a first of the month — drawn taller.
    public var strong: Bool

    public init(offset: Int, strong: Bool) { self.offset = offset; self.strong = strong }
}

/// Four muted tints, one per leg in turn, so two adjacent legs never share a
/// colour — in oklch at the same lightness and chroma so no leg shouts over
/// another, and well away from the vermilion accent, which means "selected"
/// everywhere in the suite. CSS colours, as the web draws them. The web's
/// `STAGE_TINTS`.
public let stageTints = [
    "oklch(72% 0.07 250)",
    "oklch(72% 0.07 150)",
    "oklch(72% 0.07 65)",
    "oklch(72% 0.07 320)",
]

public func stageTint(_ index: Int) -> String {
    let n = stageTints.count
    return stageTints[((index % n) + n) % n]
}

private let rulerMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// The date `offset` days into a span whose start the caller has already checked.
private func rulerOffsetToDate(_ start: IsoDate, _ offset: Int) -> IsoDate {
    addDays(start, offset) ?? start
}

/// The trip's stages as bars on the track, in `stages` order. A stage with a
/// bad or reversed span, or one entirely outside the trip, has no bar — it
/// still exists, and the editor still lists it, but the ruler has nowhere
/// honest to draw it. Lanes are assigned greedily: a bar takes the first lane
/// where nothing already drawn overlaps it.
public func rulerBars(_ trip: TripSpan, _ stages: [TripStage]) -> [RulerBar] {
    guard let total = spanLength(trip.startDate, trip.endDate) else { return [] }
    var bars: [RulerBar] = []
    var laneEnds: [Int] = [] // exclusive end offset of the last bar per lane
    for (index, stage) in stages.enumerated() {
        guard spanLength(stage.startDate, stage.endDate) != nil,
              let start = daysBetween(trip.startDate, stage.startDate),
              let end = daysBetween(trip.startDate, stage.endDate) else { continue }
        let from = max(0, start)
        let to = min(total - 1, end)
        if to < from { continue }
        let length = to - from + 1
        var lane = 0
        while lane < laneEnds.count && laneEnds[lane] > from { lane += 1 }
        if lane == laneEnds.count { laneEnds.append(from + length) } else { laneEnds[lane] = from + length }
        bars.append(RulerBar(stage: stage, index: index, from: from, length: length, lane: lane,
                             clipStart: start < 0, clipEnd: end > total - 1))
    }
    return bars
}

public func rulerBars(_ trip: TripDoc) -> [RulerBar] {
    rulerBars(TripSpan(startDate: trip.startDate, endDate: trip.endDate), trip.stages)
}

public func laneCount(_ bars: [RulerBar]) -> Int {
    bars.reduce(0) { max($0, $1.lane + 1) }
}

/// The days of the trip no bar covers, as runs. Empty when fully covered.
public func rulerGaps(_ trip: TripSpan, _ bars: [RulerBar]) -> [RulerGap] {
    guard let total = spanLength(trip.startDate, trip.endDate) else { return [] }
    var covered = [Bool](repeating: false, count: total)
    for bar in bars {
        for i in bar.from..<(bar.from + bar.length) where i >= 0 && i < total { covered[i] = true }
    }
    var gaps: [RulerGap] = []
    var runFrom = -1
    func close(_ end: Int) {
        guard runFrom >= 0 else { return }
        gaps.append(RulerGap(from: runFrom, length: end - runFrom,
                             startDate: rulerOffsetToDate(trip.startDate, runFrom),
                             endDate: rulerOffsetToDate(trip.startDate, end - 1)))
        runFrom = -1
    }
    for (i, on) in covered.enumerated() {
        if !on && runFrom < 0 { runFrom = i }
        if on { close(i) }
    }
    close(total)
    return gaps
}

/// Month labels along the track: the trip's own first day, then every first of
/// a month inside it. The first label is placed at offset 0 even when the trip
/// joins a month midway — an unlabelled leading stretch reads as "no month".
public func rulerMonths(_ trip: TripSpan) -> [RulerMonth] {
    guard let total = spanLength(trip.startDate, trip.endDate) else { return [] }
    var out: [RulerMonth] = []
    for i in 0..<total {
        guard let f = isoDateFields(rulerOffsetToDate(trip.startDate, i)) else { continue }
        if i == 0 || f.day == 1 { out.append(RulerMonth(offset: i, label: rulerMonthNames[f.month - 1])) }
    }
    return out
}

/// Narrowest two strokes of the scale may stand apart. Below it a run of day
/// ticks stops reading as days and becomes a grey band, so the scale steps up
/// to weeks instead. The web's `MIN_TICK_GAP`.
public let rulerMinTickGap = 9.0

/// The day strokes along the track, for the day width actually drawn. Days
/// while they fit; Mondays alone once they do not — real Mondays, not every
/// seventh day of the trip. Offset 0 is never a stroke: it is the trip's own
/// edge, where the first month rule already stands.
public func rulerTicks(_ trip: TripSpan, _ dayWidth: Double) -> [RulerTick] {
    guard let total = spanLength(trip.startDate, trip.endDate) else { return [] }
    let everyDay = dayWidth >= rulerMinTickGap
    if !everyDay && dayWidth * 7 < rulerMinTickGap { return [] }
    var out: [RulerTick] = []
    if total < 2 { return out }
    for i in 1..<total {
        let date = rulerOffsetToDate(trip.startDate, i)
        let monday = weekdayIndex(date) == 0
        let firstOfMonth = isoDateFields(date)?.day == 1
        if everyDay {
            out.append(RulerTick(offset: i, strong: monday || firstOfMonth))
        } else if monday {
            out.append(RulerTick(offset: i, strong: true))
        }
    }
    return out
}

/// Narrowest a day may be drawn at 100 %. A bar thinner than this cannot be
/// grabbed by an edge, so it is the BASE the zoom multiplies, not a clamp
/// applied after it: clamping after froze the whole track (a 616-day trip in a
/// 460 px box drew the same picture from 25 % to 800 %). The web's `MIN_DAY`.
public let rulerMinDay = 6.0

/// A day's width on the track: the box's share of it, or 6 points, times the zoom.
public func rulerDayWidth(_ viewportWidth: Double, _ total: Int, _ scale: Double) -> Double {
    let fitted = viewportWidth > 0 && total > 0 ? viewportWidth / Double(total) : rulerMinDay
    return max(rulerMinDay, fitted) * scale
}

/// The whole track's width — what tells the zoom how much the content grew.
public func rulerTrackWidth(_ viewportWidth: Double, _ total: Int, _ scale: Double) -> Double {
    rulerDayWidth(viewportWidth, total, scale) * Double(total)
}

/// The day at an offset along the track (a fraction of a day floors), clamped to the trip.
public func dayAtOffset(_ trip: TripSpan, _ offset: Double) -> IsoDate? {
    guard let total = spanLength(trip.startDate, trip.endDate) else { return nil }
    let floored = offset.rounded(.down)
    let whole: Int
    if floored.isNaN {
        whole = 0
    } else if floored < 0 {
        whole = 0
    } else {
        whole = floored >= Double(total - 1) ? total - 1 : Int(floored)
    }
    return rulerOffsetToDate(trip.startDate, whole)
}

/// 0-based offset of a date from the trip's first day, or nil off the trip.
public func dayOffset(_ trip: TripSpan, _ date: IsoDate) -> Int? {
    guard let total = spanLength(trip.startDate, trip.endDate), let i = daysBetween(trip.startDate, date),
          i >= 0, i < total else { return nil }
    return i
}
