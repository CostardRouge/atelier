// The trip as a stack of calendar MONTHS — one block per month the trip
// touches, seven columns Monday → Sunday, the phone's own calendar. Port of
// `src/shared/roadtrip/month-grid.ts`.
//
// It is the answer to a measurement (`docs/roadtrip-overview-mobile.md` §2):
// the weekday heatmap fitted to a 390pt screen gives a 345-day trip a 6px
// cell, and no floor makes that grid and the day ruler usable on one span —
// they are inversely coupled. Turning the axis makes the cell fall out of the
// geometry instead: a seventh of the width, ~46pt, a real target with nothing
// to invent. The weekday pattern the heatmap exists for survives, because the
// columns ARE the weekdays.
//
// Rules kept: a month is drawn WHOLE with the trip's days listed apart; the
// year is said on the first block and on every January; a SHORT trip is one
// block of its own weeks with a week either side; `visibleBlock` reads a row
// of blocks from its LEFT. Pure: the blocks, the runs a leg ribbon is drawn
// from and the cell geometry are all arithmetic, so a view only paints.

import Foundation

private let monthNamesLong = ["January", "February", "March", "April", "May", "June",
                              "July", "August", "September", "October", "November", "December"]

public struct MonthWeek: Equatable, Sendable {
    /// Seven slots, Monday first; nil where the month has no day.
    public var cells: [IsoDate?]
    public init(cells: [IsoDate?]) { self.cells = cells }
}

/// A month beginning inside a block: the row and column of its first day.
public struct MonthMark: Equatable, Sendable {
    public var week: Int
    public var col: Int
    public var label: String
    public init(week: Int, col: Int, label: String) { self.week = week; self.col = col; self.label = label }
}

public struct MonthBlock: Equatable, Sendable {
    /// `YYYY-MM`, the block's stable key and its anchor id — `weeks` for a
    /// short trip's one block. A reader treating the key as `YYYY-MM` must
    /// test for `weeks` first.
    public var key: String
    public var year: Int
    /// 0 = January.
    public var month: Int
    /// "July", and "July 2025" on the first block and every January — a stack
    /// of months needs its year said once per turn.
    public var label: String
    /// The whole calendar month, so a trip joining it mid-way still reads as a month.
    public var weeks: [MonthWeek]
    /// The days of this month that belong to the trip, in order.
    public var tripDays: [IsoDate]
    /// Where another month begins INSIDE the block — a short trip's one block
    /// of weeks runs across a month's edge, and the row holding its 1st says
    /// so. Empty on a month block, whose header is the whole answer.
    public var marks: [MonthMark]

    public init(key: String, year: Int, month: Int, label: String, weeks: [MonthWeek],
                tripDays: [IsoDate], marks: [MonthMark]) {
        self.key = key; self.year = year; self.month = month; self.label = label
        self.weeks = weeks; self.tripDays = tripDays; self.marks = marks
    }
}

/// How many whole weeks are drawn before and after a short trip, to situate
/// it. The web's `SHORT_TRIP_MARGIN_WEEKS`. (Its `SHORT_TRIP_DAYS` is the
/// kernel's one `shortTripDays`.)
public let shortTripMarginWeeks = 1

/// A trip of at most `shortTripDays` days, both ends counted. False for a bad
/// or reversed span.
public func isShortTrip(_ start: IsoDate, _ end: IsoDate) -> Bool {
    guard let length = spanLength(start, end) else { return false }
    return length <= shortTripDays
}

/// A short trip as ONE block: the weeks it touches, `margin` whole weeks
/// before and after, Monday-first, no padding — the row holding a month's
/// first day carries a mark for it unless it is the header's own month.
/// The header names the month the trip STARTS in (with its year), whatever
/// the margin week before belongs to. Empty for a bad or reversed span.
public func weekBlock(_ start: IsoDate, _ end: IsoDate, margin: Int = shortTripMarginWeeks) -> [MonthBlock] {
    guard let a = isoDateFields(start), let b = tripDayCount(end), let s = tripDayCount(start), b >= s else { return [] }
    guard let firstMonday = weekStart(start), let lastMonday = weekStart(end) else { return [] }
    guard let from = addDays(firstMonday, -7 * margin), let to = addDays(lastMonday, 7 * margin + 6) else { return [] }
    let days = enumerateDays(from, to)
    let weeks = stride(from: 0, to: days.count, by: 7).map { i in
        MonthWeek(cells: days[i..<Swift.min(i + 7, days.count)].map { Optional($0) })
    }
    let year = a.year
    let month = a.month - 1
    var marks: [MonthMark] = []
    for (w, week) in weeks.enumerated() {
        for (col, cell) in week.cells.enumerated() {
            guard let date = cell, let f = isoDateFields(date), f.day == 1 else { continue }
            let m = f.month - 1
            if m == month && f.year == year { continue }
            let label = f.year == year ? monthNamesLong[m] : "\(monthNamesLong[m]) \(f.year)"
            marks.append(MonthMark(week: w, col: col, label: label))
        }
    }
    return [MonthBlock(key: "weeks", year: year, month: month,
                       label: "\(monthNamesLong[month]) \(year)",
                       weeks: weeks,
                       tripDays: days.filter { $0 >= start && $0 <= end },
                       marks: marks)]
}

/// The blocks a trip is drawn as: its weeks when short, its months otherwise.
public func tripBlocks(_ start: IsoDate, _ end: IsoDate) -> [MonthBlock] {
    isShortTrip(start, end) ? weekBlock(start, end) : monthBlocks(start, end)
}

/// One block per calendar month between `start` and `end`, inclusive — the
/// WHOLE month each time, with the trip's own days listed apart. A month is
/// drawn whole because a week that starts mid-month reads as a mistake, and
/// because a leg or a day chosen at the trip's edge still needs its neighbours
/// to be recognisable as a calendar. Empty for a bad or reversed span.
public func monthBlocks(_ start: IsoDate, _ end: IsoDate) -> [MonthBlock] {
    guard let first = isoDateFields(start), let last = isoDateFields(end),
          let a = tripDayCount(start), let b = tripDayCount(end), b >= a else { return [] }
    var blocks: [MonthBlock] = []
    var year = first.year
    var month = first.month - 1
    let stopYear = last.year
    let stopMonth = last.month - 1
    while year < stopYear || (year == stopYear && month <= stopMonth) {
        let daysIn = tripDaysInMonth(year, month + 1)
        let monthStart = "\(TripJS.pad(year, 4))-\(TripJS.pad(month + 1, 2))-01"
        let monthEnd = "\(TripJS.pad(year, 4))-\(TripJS.pad(month + 1, 2))-\(TripJS.pad(daysIn, 2))"
        let days = enumerateDays(monthStart, monthEnd)
        let lead = days.first.flatMap(weekdayIndex) ?? 0
        var cells: [IsoDate?] = Array(repeating: nil, count: lead) + days.map { Optional($0) }
        while cells.count % 7 != 0 { cells.append(nil) }
        let weeks = stride(from: 0, to: cells.count, by: 7).map { MonthWeek(cells: Array(cells[$0..<$0 + 7])) }
        let withYear = blocks.isEmpty || month == 0
        blocks.append(MonthBlock(key: "\(year)-\(TripJS.pad(month + 1, 2))",
                                 year: year, month: month,
                                 label: withYear ? "\(monthNamesLong[month]) \(year)" : monthNamesLong[month],
                                 weeks: weeks,
                                 tripDays: days.filter { $0 >= start && $0 <= end },
                                 marks: []))
        month += 1
        if month == 12 {
            month = 0
            year += 1
        }
    }
    return blocks
}

/// A run of consecutive cells in one week that share a value — a leg's ribbon.
public struct WeekRun<T> {
    /// Column of the first cell, 0..6.
    public var from: Int
    /// Column of the last cell, inclusive.
    public var to: Int
    public var value: T
    public init(from: Int, to: Int, value: T) { self.from = from; self.to = to; self.value = value }
}

extension WeekRun: Equatable where T: Equatable {}
extension WeekRun: Sendable where T: Sendable {}

/// The runs of one week: consecutive cells whose `keyOf` answers the same
/// value, split where it changes and broken by a nil cell or a nil answer. A
/// leg ribbon is one run per week it covers; two legs that abut are two runs.
/// `same` decides what "the same value" means.
public func weekRuns<T>(_ cells: [IsoDate?], _ keyOf: (IsoDate) -> T?,
                        same: (T, T) -> Bool) -> [WeekRun<T>] {
    var runs: [WeekRun<T>] = []
    var run: WeekRun<T>?
    for (col, cell) in cells.enumerated() {
        guard let cell, let value = keyOf(cell) else {
            if let r = run { runs.append(r) }
            run = nil
            continue
        }
        if var r = run, same(r.value, value) {
            r.to = col
            run = r
            continue
        }
        if let r = run { runs.append(r) }
        run = WeekRun(from: col, to: col, value: value)
    }
    if let r = run { runs.append(r) }
    return runs
}

/// `weekRuns` with `==` as sameness — the web's default `===`.
public func weekRuns<T: Equatable>(_ cells: [IsoDate?], _ keyOf: (IsoDate) -> T?) -> [WeekRun<T>] {
    weekRuns(cells, keyOf, same: ==)
}

/// The gutter between two cells, at every width. The web's `MONTH_GAP`.
public let monthGap = 4.0
/// Narrowest a cell is drawn: below this a day is not a target, and the column
/// should be wider. The web's `MIN_MONTH_CELL`.
public let minMonthCell = 28.0
/// Widest: past this a month stops being a calendar and becomes tiles. The
/// web's `MAX_MONTH_CELL`.
public let maxMonthCell = 56.0

/// A cell's side for a box `width` wide: a seventh of what the gutters leave,
/// in whole pixels, clamped. At 358 (a 390 phone less the shell's gutter) that
/// is 47 — the target the design asked for, with nothing to choose. Zero width
/// (unmeasured) answers the minimum, so nothing is drawn at zero.
public func monthCell(_ width: Double) -> Double {
    if !(width > 0) { return minMonthCell }
    let cell = ((width - 6 * monthGap) / 7).rounded(.down)
    return Swift.max(minMonthCell, Swift.min(maxMonthCell, cell))
}

/// The width seven cells and six gutters take — what a block is drawn at.
public func monthWidth(_ cell: Double) -> Double {
    7 * cell + 6 * monthGap
}

/// Which block is "the one on screen" for a scroller at `scrollTop` showing
/// `viewport` points: the block covering the viewport's upper third, which is
/// where the eye rests while a list scrolls — the nearest top above it, and,
/// where several blocks share that top (a row of a wide screen's grid), the
/// FIRST of them: the row is read from its left. `tops` are the blocks'
/// offsets in the scroller, non-decreasing. -1 with no blocks.
public func visibleBlock(_ tops: [Double], _ scrollTop: Double, _ viewport: Double) -> Int {
    guard var best = tops.first else { return -1 }
    let eye = scrollTop + viewport / 3
    for top in tops {
        if top <= eye { best = top } else { break }
    }
    return tops.firstIndex(of: best) ?? -1
}

/// A block's first and last trip day.
public struct BlockSpan: Equatable, Sendable {
    public var start: IsoDate
    public var end: IsoDate
    public init(start: IsoDate, end: IsoDate) { self.start = start; self.end = end }
}

/// The first and last trip day of a block, or nil for a block the trip only frames.
public func blockSpan(_ block: MonthBlock) -> BlockSpan? {
    guard let first = block.tripDays.first, let last = block.tripDays.last else { return nil }
    return BlockSpan(start: first, end: last)
}

/// The Monday on or before `date` — where a block's row for it begins. Nil for a bad date.
public func weekStart(_ date: IsoDate) -> IsoDate? {
    guard let wd = weekdayIndex(date) else { return nil }
    return addDays(date, -wd)
}

/// A calendar week's index from the trip's first week: 0 for the week the
/// trip starts in, 1 for the next. It is the year map's COLUMN for that week
/// (`heatmapWeeks` lays the map out Monday-first from the same origin), so a
/// calendar row and a map column meet on this one number. Nil for a bad date.
public func weekIndexOf(_ date: IsoDate, _ tripStart: IsoDate) -> Int? {
    guard let monday = weekStart(date), let origin = weekStart(tripStart),
          let days = daysBetween(origin, monday) else { return nil }
    return Int((Double(days) / 7).rounded(.down))
}

/// A week row as the calendar's scroller holds it: where it sits, how tall, which week.
public struct WeekRow: Equatable, Sendable {
    public var top: Double
    public var height: Double
    /// Its `weekIndexOf`. A week straddling two months is two rows with the same index.
    public var week: Int
    public init(top: Double, height: Double, week: Int) { self.top = top; self.height = height; self.week = week }
}

/// A window of weeks, in FRACTIONAL weeks: `from` inclusive, `to` exclusive.
public struct WeekSpan: Equatable, Sendable {
    public var from: Double
    public var to: Double
    public init(from: Double, to: Double) { self.from = from; self.to = to }
}

/// The weeks on screen for a scroller at `scrollTop` showing `viewport`
/// points — the year map's frame, read from the scroll at the PIXEL: the
/// first row cut by the top edge contributes the fraction of it that is
/// hidden, the last row cut by the bottom edge the fraction that shows, so the
/// frame glides with the thumb instead of jumping a month at a time. Nil with
/// no rows.
public func visibleWeekSpan(_ rows: [WeekRow], _ scrollTop: Double, _ viewport: Double) -> WeekSpan? {
    guard let end = rows.last else { return nil }
    let bottom = scrollTop + viewport
    var first: WeekRow?
    var last: WeekRow?
    for row in rows {
        if row.top + row.height <= scrollTop { continue }
        if row.top >= bottom { break }
        if first == nil { first = row }
        last = row
    }
    guard let first, let last else {
        // Scrolled past every row (a tail below the blocks): the last week stays framed.
        return WeekSpan(from: Double(end.week + 1), to: Double(end.week + 1))
    }
    func part(_ row: WeekRow, _ y: Double) -> Double {
        row.height > 0 ? Swift.min(1, Swift.max(0, (y - row.top) / row.height)) : 0
    }
    return WeekSpan(from: Double(first.week) + part(first, scrollTop),
                    to: Double(last.week) + part(last, bottom))
}

/// The inverse: the `scrollTop` that puts fractional `week` at the top edge —
/// what a drag on the year map's frame asks for. A week that is two rows
/// (straddling a month) answers with its first; a week off either end clamps
/// to the nearest row. Nil with no rows.
public func scrollForWeek(_ rows: [WeekRow], _ week: Double) -> Double? {
    guard let head = rows.first, let end = rows.last else { return nil }
    let whole = week.rounded(.down)
    let frac = week - whole
    if let row = rows.first(where: { Double($0.week) == whole }) { return row.top + frac * row.height }
    if whole < Double(head.week) { return head.top }
    return end.top + end.height
}
