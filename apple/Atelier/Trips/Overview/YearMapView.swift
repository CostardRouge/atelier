// The whole trip in one band — the web's `YearMap.tsx`: the weekday heatmap
// kept at the size it can still be READ at (the maintainer's ruling: on a
// year-long trip it is the only thing that shows the journey at once), and
// never a target for a DAY.
//
// Rules kept:
// - One column per week, Monday on top, 3…7 pt cells (a column of 4…8 pt
//   with its 1 pt gutter), each day on its rung.
// - The FRAME is the scroll, read at the pixel: one column here is one week,
//   one row of the calendar below is one week, so the frame glides with the
//   thumb (`CalendarProbe.span`). What the calendar is not showing is veiled
//   in paper.
// - A tap lands on a MONTH and brings it to the top; a drag (past 4 pt)
//   carries the frame — grabbed inside it keeps its offset under the finger,
//   grabbed outside it is carried by its middle. Nothing here is a target
//   smaller than a month.
// - The month initials run under the band.
//
// The cells are one Canvas that redraws only when the trip does; the frame
// is a view of its own, the only thing a scroll frame redraws.

import SwiftUI
import AtelierKit

struct YearMapView: View {
    let derived: OverviewDerived
    let probe: CalendarProbe
    /// The box's width, to size a column.
    let width: CGFloat
    /// A month was tapped: bring block `index` to the top.
    let onJump: (Int) -> Void
    /// The frame was dragged: put this (fractional) week at the top.
    let onScrub: (Double) -> Void

    @Environment(\.palette) private var palette
    @State private var grab: Double?

    private static let gap: CGFloat = 1
    private static let slop: CGFloat = 4

    var body: some View {
        let weeks = heatmapWeeks(derived.trip.startDate, derived.trip.endDate)
        let geometry = YearMapGeometry(weeks: weeks, width: width, blocks: derived.blocks)
        if weeks.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 2) {
                ZStack(alignment: .topLeading) {
                    cells(weeks, geometry)
                    YearMapFrame(probe: probe, geometry: geometry)
                }
                .frame(width: geometry.gridWidth, height: geometry.height, alignment: .topLeading)
                .contentShape(Rectangle())
                .gesture(drag(geometry))
                .onTapGesture(coordinateSpace: .local) { point in
                    if let index = geometry.month(at: point.x) { onJump(index) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("The whole trip")
                initials(geometry)
            }
            .padding(.vertical, 6)
            .accessibilityChildren { monthButtons(geometry) }
        }
    }

    private func cells(_ weeks: [[IsoDate?]], _ geometry: YearMapGeometry) -> some View {
        let levels = Dictionary(derived.coverage.days.map { ($0.date, CalendarRungs.level(of: $0)) },
                                uniquingKeysWith: { a, _ in a })
        let fills = palette.heatmapLevels
        let cell = geometry.cell
        let column = geometry.column
        return Canvas { context, _ in
            for (w, week) in weeks.enumerated() {
                for (row, date) in week.enumerated() {
                    guard let date else { continue }
                    let rect = CGRect(x: CGFloat(w) * column, y: CGFloat(row) * column, width: cell, height: cell)
                    let level = max(0, min(fills.count - 1, levels[date] ?? 0))
                    context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(fills[level]))
                }
            }
        }
        .frame(width: geometry.gridWidth, height: geometry.height)
        .accessibilityHidden(true)
    }

    private func initials(_ geometry: YearMapGeometry) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(derived.blocks.enumerated()), id: \.offset) { index, block in
                if let span = geometry.spans[index] {
                    Text(String(block.label.prefix(1)))
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.faint)
                        .offset(x: CGFloat(span.from) * geometry.column)
                }
            }
        }
        .frame(width: geometry.gridWidth, height: 12, alignment: .topLeading)
        .accessibilityHidden(true)
    }

    /// VoiceOver's way in: one button per month.
    private func monthButtons(_ geometry: YearMapGeometry) -> some View {
        ForEach(Array(derived.blocks.enumerated()), id: \.offset) { index, block in
            if geometry.spans[index] != nil {
                Button("Go to \(block.label)") { onJump(index) }
            }
        }
    }

    private func drag(_ geometry: YearMapGeometry) -> some Gesture {
        DragGesture(minimumDistance: Self.slop, coordinateSpace: .local)
            .onChanged { value in
                let at = geometry.week(at: value.location.x)
                if grab == nil {
                    let start = geometry.week(at: value.startLocation.x)
                    if let span = probe.span, start >= span.from, start <= span.to {
                        grab = start - span.from
                    } else if let span = probe.span {
                        grab = (span.to - span.from) / 2
                    } else {
                        grab = 0
                    }
                }
                onScrub(at - (grab ?? 0))
            }
            .onEnded { _ in grab = nil }
    }
}

/// The band's arithmetic: a column per week, the months' columns.
struct YearMapGeometry {
    let column: CGFloat
    let cell: CGFloat
    let total: Int
    let gridWidth: CGFloat
    let height: CGFloat
    /// Each block's first and last column, nil for a block the trip only frames.
    let spans: [(from: Int, to: Int)?]

    init(weeks: [[IsoDate?]], width: CGFloat, blocks: [MonthBlock]) {
        let count = weeks.count
        total = count
        let share = count > 0 ? (width / CGFloat(count)).rounded(.down) : 6
        let column: CGFloat = width > 0 ? max(4, min(8, share)) : 6
        self.column = column
        cell = column - 1
        gridWidth = max(0, CGFloat(count) * column - 1)
        height = 7 * (column - 1) + 6
        let first = weeks.first?.compactMap { $0 }.first
        let lead = weeks.first?.firstIndex { $0 != nil } ?? 0
        func columnOf(_ date: IsoDate) -> Int {
            guard let first, let offset = daysBetween(first, date) else { return 0 }
            return (max(0, lead) + offset) / 7
        }
        spans = blocks.map { block -> (from: Int, to: Int)? in
            guard let a = block.tripDays.first, let b = block.tripDays.last else { return nil }
            return (from: columnOf(a), to: columnOf(b))
        }
    }

    /// The fractional week under `x`, clamped to the band.
    func week(at x: CGFloat) -> Double {
        guard column > 0 else { return 0 }
        return Double(max(0, min(CGFloat(total), x / column)))
    }

    /// The block whose columns hold `x`.
    func month(at x: CGFloat) -> Int? {
        let col = Int((x / max(1, column)).rounded(.down))
        return spans.firstIndex { span in
            guard let span else { return false }
            return col >= span.from && col <= span.to
        }
    }
}

/// The frame over what the calendar shows, and the paper over the rest.
private struct YearMapFrame: View {
    let probe: CalendarProbe
    let geometry: YearMapGeometry
    @Environment(\.palette) private var palette

    var body: some View {
        if let span = probe.span {
            let total = Double(geometry.total)
            let left = CGFloat(max(0, min(total, span.from))) * geometry.column
            let right = CGFloat(max(0, min(total, span.to))) * geometry.column - 1
            let frameWidth = max(4, right - left + 2)
            ZStack(alignment: .topLeading) {
                palette.paper.opacity(0.65)
                    .frame(width: max(0, left), height: geometry.height + 4)
                palette.paper.opacity(0.65)
                    .frame(width: max(0, geometry.gridWidth - max(0, right)), height: geometry.height + 4)
                    .offset(x: max(0, right))
                RoundedRectangle(cornerRadius: 3)
                    .stroke(palette.ink, lineWidth: 1.5)
                    .frame(width: frameWidth, height: geometry.height + 4)
                    .offset(x: left - 1)
            }
            .offset(y: -2)
            .frame(width: geometry.gridWidth, height: geometry.height, alignment: .topLeading)
            .allowsHitTesting(false)
        }
    }
}
