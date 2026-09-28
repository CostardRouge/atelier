// What the month calendar knows about itself while it scrolls — the native
// half of what `MonthCalendar.tsx` reads from the DOM (`offsetTop`,
// `[data-week]` rows, `getBoundingClientRect`), plus the arithmetic its cells
// share.
//
// - `CalendarLayout` is the cell geometry of the web, number for number: the
//   cell a seventh of the column (`monthCell`), blocks side by side only as
//   many as fit at a 34 pt cell, 24 pt between them, the cell 0.9 as tall as
//   it is wide.
// - `CalendarProbe` holds the week rows ON SCREEN, in the scroller's own
//   coordinates, as each row reports its frame. From them it answers what the
//   web answers from the scroll: the block under the viewport's upper third
//   (`visibleBlock`'s rule, a row of blocks read from its LEFT) and the weeks
//   at the pixel for the year map's frame (the kernel's `visibleWeekSpan`).
//   It is an object of its own so a scroll frame redraws the map's frame, the
//   grips and the hover card — never the four hundred day cells.

import SwiftUI
import AtelierKit

/// The web's `COLUMN_GAP`, between two blocks side by side.
let calendarColumnGap: CGFloat = 24
/// The web's `FIT_CELL`: the narrowest cell a row of blocks is packed down to.
let calendarFitCell: CGFloat = 34
/// The ribbon under a week.
let calendarRibbon: CGFloat = 12
/// The grip on an adjusted leg's end — a finger's target.
let calendarGrip: CGFloat = 28
/// The scroller's coordinate space, where rows report and grips are placed.
let calendarSpace = "tripOverviewCalendar"

struct CalendarLayout: Equatable {
    var cols: Int
    var cell: CGFloat
    var cellH: CGFloat
    var step: CGFloat
    var blockWidth: CGFloat

    /// The geometry for a box `width` wide (its gutters already taken off),
    /// at most `columns` blocks to a row. A short trip is always one.
    init(width: CGFloat, columns: Int, short: Bool) {
        let w = max(0, width)
        let packed = CGFloat(monthWidth(Double(calendarFitCell))) + calendarColumnGap
        let fitted = ((w + calendarColumnGap) / packed).rounded(.down)
        let fit = w > 0 ? Int(fitted) : 1
        let cols = short ? 1 : max(1, min(columns, fit))
        let gaps = CGFloat(cols - 1) * calendarColumnGap
        let shared = ((w - gaps) / CGFloat(cols)).rounded(.down)
        let perBlock = cols > 1 ? shared : w
        let cell = CGFloat(monthCell(Double(perBlock)))
        self.cols = cols
        self.cell = cell
        cellH = (cell * 0.9).rounded()
        step = cell + CGFloat(monthGap)
        blockWidth = CGFloat(monthWidth(Double(cell)))
    }

    /// The blocks, `cols` to a row.
    func rows(_ count: Int) -> [[Int]] {
        stride(from: 0, to: count, by: cols).map { start in Array(start..<min(start + cols, count)) }
    }
}

/// One week of one block as it sits on screen.
struct ProbedRow: Equatable {
    var block: Int
    /// The week inside its block.
    var week: Int
    /// The week counted from the trip's first (`weekIndexOf`) — the year map's column.
    var tripWeek: Int?
    /// The row of seven cells, in the scroller's coordinates.
    var frame: CGRect
}

struct CalendarRowsKey: PreferenceKey {
    static let defaultValue: [ProbedRow] = []
    static func reduce(value: inout [ProbedRow], nextValue: () -> [ProbedRow]) {
        value.append(contentsOf: nextValue())
    }
}

/// A day under the pointer, for the hover card.
struct HoveredDay: Equatable {
    var date: IsoDate
    var cell: DayCell
    var stage: OverviewDayStage?
}

@MainActor
@Observable
final class CalendarProbe {
    /// The week rows on screen, in reading order: block by block, top down.
    private(set) var rows: [ProbedRow] = []
    /// The scroller's size.
    private(set) var viewport: CGSize = .zero
    /// The weeks on screen, fractional — the year map's frame.
    private(set) var span: WeekSpan?
    /// The day under the pointer (a Mac, an iPad's trackpad).
    var hovered: HoveredDay?

    @ObservationIgnored private var lastVisible = -1

    /// Take the rows as they report; answer the block now on screen when it
    /// changed, nil otherwise.
    func update(_ reported: [ProbedRow], viewport: CGSize) -> Int? {
        let sorted = reported.sorted { a, b in
            a.block != b.block ? a.block < b.block : a.frame.minY < b.frame.minY
        }
        if sorted != rows { rows = sorted }
        if viewport != self.viewport { self.viewport = viewport }
        let weeks = sorted.compactMap { row -> WeekRow? in
            guard let week = row.tripWeek else { return nil }
            return WeekRow(top: Double(row.frame.minY), height: Double(row.frame.height), week: week)
        }
        let next = visibleWeekSpan(weeks, 0, Double(viewport.height))
        if next != span { span = next }
        let block = visibleBlockIndex(sorted, viewport: viewport)
        guard block >= 0, block != lastVisible else { return nil }
        lastVisible = block
        return block
    }

    /// The block covering the viewport's upper third — the nearest top above
    /// the eye, the first of a row sharing it. Rows only exist for what is
    /// laid out, which always includes the rows around the eye.
    private func visibleBlockIndex(_ rows: [ProbedRow], viewport: CGSize) -> Int {
        guard !rows.isEmpty else { return -1 }
        var tops: [Int: CGFloat] = [:]
        for row in rows { tops[row.block] = min(tops[row.block] ?? row.frame.minY, row.frame.minY) }
        let eye = viewport.height / 3
        var best: (block: Int, top: CGFloat)?
        for (block, top) in tops where top <= eye {
            if let current = best {
                if top > current.top || (top == current.top && block < current.block) { best = (block, top) }
            } else {
                best = (block, top)
            }
        }
        return best?.block ?? (tops.keys.min() ?? -1)
    }

    /// The row a block's week sits in on screen, when it is laid out.
    func row(block: Int, week: Int) -> ProbedRow? {
        rows.first { $0.block == block && $0.week == week }
    }

    /// Whether a row is wholly inside the viewport.
    func isOnScreen(block: Int, week: Int, cellHeight: CGFloat) -> Bool {
        guard let row = row(block: block, week: week) else { return false }
        return row.frame.minY >= 0 && row.frame.minY + cellHeight <= viewport.height
    }

    /// The day under a point of the scroller: the row it is over, the column
    /// it falls in — what a grip dragged over the cells reads.
    func day(at point: CGPoint, blocks: [MonthBlock], layout: CalendarLayout) -> IsoDate? {
        guard let row = rows.first(where: { point.y >= $0.frame.minY - 4 && point.y < $0.frame.minY + layout.step + calendarRibbon }),
              row.block < blocks.count, row.week < blocks[row.block].weeks.count else { return nil }
        let raw = ((point.x - row.frame.minX) / layout.step).rounded(.down)
        let col = Int(max(0, min(6, raw)))
        return blocks[row.block].weeks[row.week].cells[col]
    }
}

/// Where a date sits in the blocks: its block, its week, its column.
struct CalendarCellIndex: Equatable {
    var block: Int
    var week: Int
    var col: Int
}

extension OverviewDerived {
    /// Every date the blocks draw, by position — built on demand.
    func cellIndex(_ date: IsoDate) -> CalendarCellIndex? {
        for (b, block) in blocks.enumerated() {
            for (w, week) in block.weeks.enumerated() {
                if let col = week.cells.firstIndex(where: { $0 == date }) {
                    return CalendarCellIndex(block: b, week: w, col: col)
                }
            }
        }
        return nil
    }
}

/// What a told day shows in the Pictures view.
struct OverviewDayPicture {
    /// The hook of the day's first piece (a published one first).
    var image: CGImage
    /// How many pieces the day holds.
    var count: Int
    /// Whether any of them went out.
    var published: Bool
}

/// One line of a day's menu.
struct OverviewMenuItem: Identifiable {
    let id: String
    let label: String
    let run: () -> Void
}

/// A group of a day's menu, named above it — telling the day and editing its
/// leg act on different things.
struct OverviewMenuSection: Identifiable {
    let id: String
    let title: String
    let items: [OverviewMenuItem]
}

/// Everything a calendar cell reads and does.
struct CalendarContext {
    let derived: OverviewDerived
    /// The trip as drawn — the DRAFT where a leg is being adjusted.
    let shown: TripDoc
    let selected: IsoDate?
    let today: IsoDate
    let selectedLegId: String?
    let adjust: AdjustDraft?
    let pictures: [IsoDate: OverviewDayPicture]?
    let layout: CalendarLayout
    let probe: CalendarProbe
    let select: (IsoDate) -> Void
    let openLeg: (String) -> Void
    let menu: (IsoDate) -> [OverviewMenuSection]

    /// Which leg a day wears: the last covering stage, as `stageAt` resolves
    /// it — only the adjusted leg, at its draft dates, while one is.
    func legOf(_ date: IsoDate) -> OverviewLegRun? {
        guard isWithin(shown.startDate, shown.endDate, date) else { return nil }
        if let adjust {
            guard isWithin(adjust.draft.startDate, adjust.draft.endDate, date) else { return nil }
            let index = shown.stages.firstIndex { $0.id == adjust.id } ?? 0
            return OverviewLegRun(stage: adjust.draft, index: index)
        }
        guard let stage = stageAt(shown, date), let index = shown.stages.firstIndex(where: { $0.id == stage.id }) else {
            return nil
        }
        return OverviewLegRun(stage: stage, index: index)
    }

    /// Whether a day is inside the leg being adjusted (all days are, otherwise).
    func inAdjusted(_ date: IsoDate) -> Bool {
        guard let adjust else { return true }
        return isWithin(adjust.draft.startDate, adjust.draft.endDate, date)
    }
}

/// A leg as a ribbon run carries it.
struct OverviewLegRun {
    var stage: TripStage
    var index: Int
}
