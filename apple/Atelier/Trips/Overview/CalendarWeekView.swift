// One week of one month block, and the month's own head — the cells, the leg
// ribbons under them, and the band that names the month. The web's
// `MonthBlockView` (`MonthCalendar.tsx`), cut at the week because a lazy stack
// lays out rows, not blocks.
//
// Rules kept:
// - A day outside the trip is drawn (the month reads whole) but opens nothing.
// - A cell's fill is its RUNG — 0 nothing · 1 drafted · 2 published once · 3
//   twice · 4 more — or, in the Pictures view, the hook of the day's piece
//   (a published one first) with its number on a dark strip, a count when the
//   day holds several, a solid accent border when one went out and a dashed
//   line when all are drafts. A told day whose hook is not read yet keeps its
//   rung: the honest fallback, never a blank tile.
// - Today is ringed, the selected day outlined — except while a leg is
//   adjusted, when only that leg's days are at full strength (34 % for the
//   rest) and no day is "selected".
// - The ribbon: which leg you were on, one flat tint, rounded only at the
//   leg's REAL ends and square where the week cuts it, named where the leg
//   begins (or is carried over from a weekend start) and only where it has
//   three cells of room — a stub reads better blank than as three letters and
//   an ellipsis (its tooltip keeps the name). The open leg is darker and bold.
// - A long press (the Mac: a right-click) opens the day's menu: tell it first,
//   edit its leg second.

import SwiftUI
import AtelierKit

private let calendarWeekdayLetters = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

/// A month's name — which stays pinned while its weeks scroll — with how many
/// of its days were told, over the weekday letters.
struct CalendarMonthHeader: View {
    let block: MonthBlock
    let told: Int
    let layout: CalendarLayout
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(block.label)
                    .font(Brand.display(19))
                    .foregroundStyle(palette.ink)
                if !block.tripDays.isEmpty {
                    Text("\(told)/\(block.tripDays.count) told")
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.muted)
                }
            }
            .frame(height: 28, alignment: .bottomLeading)
            HStack(spacing: CGFloat(monthGap)) {
                ForEach(calendarWeekdayLetters, id: \.self) { letter in
                    Text(letter)
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.faint)
                        .frame(width: layout.cell)
                }
            }
            .padding(.bottom, 3)
            .accessibilityHidden(true)
        }
        .frame(width: layout.blockWidth, alignment: .leading)
    }
}

/// One week of block `blockIndex`: seven cells and the ribbons under them.
struct CalendarWeekView: View {
    let blockIndex: Int
    let week: Int
    let context: CalendarContext
    @Environment(\.palette) private var palette

    var body: some View {
        let block = context.derived.blocks[blockIndex]
        let cells = block.weeks[week].cells
        let mark = block.marks.first { $0.week == week }
        VStack(alignment: .leading, spacing: 0) {
            // A short trip's block runs across a month's edge: the row holding
            // its 1st says which month begins here.
            if let mark {
                Text(mark.label)
                    .font(Brand.display(16))
                    .foregroundStyle(palette.inkSoft)
                    .padding(.top, 4)
                    .padding(.bottom, 6)
                    .accessibilityHidden(true)
            }
            cellsRow(cells)
            CalendarRibbons(cells: cells, week: week, context: context)
                .padding(.top, 3)
        }
        .frame(width: context.layout.blockWidth, alignment: .leading)
        .padding(.bottom, 6)
    }

    private func cellsRow(_ cells: [IsoDate?]) -> some View {
        let first = cells.compactMap { $0 }.first
        let tripWeek = first.flatMap { weekIndexOf($0, context.derived.trip.startDate) }
        let block = blockIndex
        let week = self.week
        return HStack(spacing: CGFloat(monthGap)) {
            ForEach(0..<7, id: \.self) { col in
                CalendarDayCell(date: cells[col], context: context)
            }
        }
        .background {
            GeometryReader { geometry in
                Color.clear.preference(
                    key: CalendarRowsKey.self,
                    value: [ProbedRow(block: block, week: week, tripWeek: tripWeek,
                                      frame: geometry.frame(in: .named(calendarSpace)))]
                )
            }
        }
    }
}

/// One day: a target when it belongs to the trip, a grey number otherwise.
struct CalendarDayCell: View {
    let date: IsoDate?
    let context: CalendarContext
    @Environment(\.palette) private var palette

    var body: some View {
        let layout = context.layout
        if let date, let data = context.derived.byDate[date] {
            dayButton(date, data)
        } else if let date {
            // The month's own day outside the trip.
            Text(Self.number(date))
                .font(Brand.mono(12))
                .foregroundStyle(palette.lineStrong)
                .frame(width: layout.cell, height: layout.cellH)
                .accessibilityHidden(true)
        } else {
            Color.clear
                .frame(width: layout.cell, height: layout.cellH)
                .accessibilityHidden(true)
        }
    }

    static func number(_ date: IsoDate) -> String {
        String(Int(date.suffix(2)) ?? 0)
    }

    private func dayButton(_ date: IsoDate, _ data: DayCell) -> some View {
        let stage = context.derived.stage(date)
        let isSelected = date == context.selected && context.adjust == nil
        return Button {
            context.select(date)
        } label: {
            face(date, data, isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .opacity(context.inAdjusted(date) ? 1 : 0.34)
        .contextMenu { menu(date) }
        .onHover { inside in hover(date, data, stage, inside) }
        .accessibilityLabel(OverviewWords.cellTitle(data, stage))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private func menu(_ date: IsoDate) -> some View {
        ForEach(context.menu(date)) { section in
            Section(section.title) {
                ForEach(section.items) { item in
                    Button(item.label, action: item.run)
                }
            }
        }
    }

    private func hover(_ date: IsoDate, _ data: DayCell, _ stage: OverviewDayStage?, _ inside: Bool) {
        // Sweeping the calendar is what the card is for; while a leg is
        // adjusted, nothing is said about any other day.
        guard context.adjust == nil else { return }
        if inside {
            context.probe.hovered = HoveredDay(date: date, cell: data, stage: stage)
        } else if context.probe.hovered?.date == date {
            context.probe.hovered = nil
        }
    }

    private func face(_ date: IsoDate, _ data: DayCell, isSelected: Bool) -> some View {
        let layout = context.layout
        let level = CalendarRungs.level(of: data)
        let picture = context.pictures?[date]
        let isToday = date == context.today
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return ZStack {
            if let picture {
                pictureFace(date, picture)
            } else {
                palette.heatmapLevel(level)
                Text(Self.number(date))
                    .font(Brand.mono(12))
                    .monospacedDigit()
                    .foregroundStyle(CalendarRungs.ink(level, palette))
            }
        }
        .frame(width: layout.cell, height: layout.cellH)
        .clipShape(shape)
        .overlay { pictureBorder(picture, shape) }
        .overlay {
            if isToday && !isSelected {
                shape.strokeBorder(palette.muted, lineWidth: 2)
            }
        }
        .overlay {
            if isSelected {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(palette.ink, lineWidth: 2)
                    .padding(-3)
            }
        }
        .contentShape(shape)
    }

    private func pictureFace(_ date: IsoDate, _ picture: OverviewDayPicture) -> some View {
        ZStack {
            Image(decorative: picture.image, scale: 1, orientation: .up)
                .resizable()
                .scaledToFill()
            VStack(spacing: 0) {
                HStack {
                    Spacer(minLength: 0)
                    if picture.count > 1 {
                        Text("\(picture.count)")
                            .font(Brand.mono(9))
                            .foregroundStyle(palette.onMedia)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 14, minHeight: 14)
                            .background(Capsule().fill(palette.frame.opacity(0.75)))
                            .padding(2)
                    }
                }
                Spacer(minLength: 0)
                // The number on a dark strip along the foot, so it reads on any picture.
                Text(Self.number(date))
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.onMedia)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 1)
                    .background(palette.frame.opacity(0.55))
            }
        }
    }

    @ViewBuilder
    private func pictureBorder(_ picture: OverviewDayPicture?, _ shape: RoundedRectangle) -> some View {
        if let picture {
            if picture.published {
                shape.strokeBorder(palette.accentInk, lineWidth: 1)
            } else {
                shape.strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
            }
        }
    }
}

/// The leg ribbons under one week.
struct CalendarRibbons: View {
    let cells: [IsoDate?]
    let week: Int
    let context: CalendarContext
    @Environment(\.palette) private var palette

    var body: some View {
        let runs = weekRuns(cells, { context.legOf($0) }, same: { $0.stage.id == $1.stage.id })
        ZStack(alignment: .topLeading) {
            ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                ribbon(run)
            }
        }
        .frame(width: context.layout.blockWidth, height: calendarRibbon, alignment: .topLeading)
    }

    private func ribbon(_ run: WeekRun<OverviewLegRun>) -> some View {
        let layout = context.layout
        let stage = run.value.stage
        let first = cells[run.from] ?? stage.startDate
        let last = cells[run.to] ?? stage.endDate
        let startsHere = first == stage.startDate
        let endsHere = last == stage.endDate
        let sinceStart = daysBetween(stage.startDate, first)
        let carried = run.from == 0 && (sinceStart.map { $0 > 0 && $0 <= 2 } ?? false)
        let named = run.to - run.from >= 2 && (startsHere || carried || (run.from == 0 && week == 0))
        let on = stage.id == context.selectedLegId
        let span = CGFloat(run.to - run.from)
        let width = (span + 1) * layout.cell + span * CGFloat(monthGap)
        let label = stageLabel(stage)
        let name = label.isEmpty ? "Unnamed stage" : label
        let lead: CGFloat = startsHere ? 6 : 0
        let trail: CGFloat = endsHere ? 6 : 0
        let shape = UnevenRoundedRectangle(topLeadingRadius: lead, bottomLeadingRadius: lead,
                                           bottomTrailingRadius: trail, topTrailingRadius: trail)
        return Button {
            context.openLeg(stage.id)
        } label: {
            Text(named ? name : "")
                .font(Brand.sans(9, weight: on ? .semibold : .regular))
                .foregroundStyle(on ? palette.ink : palette.inkSoft)
                .lineLimit(1)
                .padding(.horizontal, 6)
                .frame(width: width, height: calendarRibbon, alignment: .leading)
                .background(shape.fill(OverviewLegTint.ribbon(run.value.index, open: on)))
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .offset(x: CGFloat(run.from) * layout.step)
        .allowsHitTesting(context.adjust == nil)
        .help("\(name) · \(formatIsoDate(stage.startDate)) → \(formatIsoDate(stage.endDate))")
        .accessibilityLabel("Open the stage \(label)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
