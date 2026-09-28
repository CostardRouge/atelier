// The trip as a stack of calendar months — the web's `MonthCalendar.tsx`, the
// overview's one day surface at every width since 2026-09-22
// (`docs/roadtrip-overview-mobile.md` §8): one block per month, seven columns
// Monday to Sunday, the cell a seventh of the column (~47 pt on a phone), the
// blocks side by side on a wide screen as many as fit at a 34 pt cell. A trip
// of 31 days or fewer is ONE block of its weeks, a week either side, and no
// year map.
//
// Rules kept:
// - Above it the year map keeps the whole trip in view and jumps a month; its
//   frame is the scroll position, never a brush. `between` is drawn between
//   the map and the scroller (the wide screen's stages); `tail` scrolls away
//   after the blocks (the medium screen's day panel).
// - The side room is paid INSIDE the scroller (`gutter`), never around it: a
//   gutter outside a scroll box is paper an outline is clipped against.
// - The route says where you are: the calendar opens on the selected day's
//   month without an animation, and follows a day chosen from elsewhere (the
//   silence figure, a leg opened) only when its cell is off screen. Entering
//   the adjust mode brings the leg on screen — keyed on the leg alone, so a
//   drag that moves its start never scrolls.
// - The month on screen is published (`onVisible`) for the Pictures view's
//   window and the stages' span.
// - A leg being ADJUSTED carries a grip at each end, dragged over the cells —
//   one cell, one day, across weeks — with a light haptic on pickup. The
//   grips live in one layer over the scroller, so a drag keeps its grip as
//   the edge crosses into another week.
// - A pointer resting on a day shows its card (a Mac, an iPad's trackpad):
//   ours, not the system tooltip, which is far too slow to sweep with.

import SwiftUI
import AtelierKit

struct MonthCalendarView<Between: View, Tail: View>: View {
    let derived: OverviewDerived
    /// The trip as drawn — the draft of an adjusted leg in place.
    let shown: TripDoc
    let selected: IsoDate?
    let selectedLegId: String?
    let adjust: AdjustDraft?
    let pictures: [IsoDate: OverviewDayPicture]?
    /// At most this many blocks side by side.
    let columns: Int
    let gutter: CGFloat
    let onSelect: (IsoDate) -> Void
    let onOpenLeg: (String) -> Void
    let onVisible: (String) -> Void
    let menu: (IsoDate) -> [OverviewMenuSection]
    let onEdge: (StageEdge, IsoDate) -> Void
    let between: Between
    let tail: Tail

    @Environment(\.palette) private var palette
    @State private var probe = CalendarProbe()
    @State private var today = todayIso(Date(), in: .current)

    init(derived: OverviewDerived, shown: TripDoc, selected: IsoDate?, selectedLegId: String?,
         adjust: AdjustDraft?, pictures: [IsoDate: OverviewDayPicture]?, columns: Int, gutter: CGFloat,
         onSelect: @escaping (IsoDate) -> Void, onOpenLeg: @escaping (String) -> Void,
         onVisible: @escaping (String) -> Void, menu: @escaping (IsoDate) -> [OverviewMenuSection],
         onEdge: @escaping (StageEdge, IsoDate) -> Void,
         @ViewBuilder between: () -> Between, @ViewBuilder tail: () -> Tail) {
        self.derived = derived
        self.shown = shown
        self.selected = selected
        self.selectedLegId = selectedLegId
        self.adjust = adjust
        self.pictures = pictures
        self.columns = columns
        self.gutter = gutter
        self.onSelect = onSelect
        self.onOpenLeg = onOpenLeg
        self.onVisible = onVisible
        self.menu = menu
        self.onEdge = onEdge
        self.between = between()
        self.tail = tail()
    }

    var body: some View {
        GeometryReader { box in
            let inner = max(0, box.size.width - 2 * gutter)
            let layout = CalendarLayout(width: inner, columns: columns, short: derived.short)
            // The reader holds the map too: its taps and drags scroll the
            // calendar below it.
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: 0) {
                    if !derived.short {
                        YearMapView(derived: derived, probe: probe, width: inner,
                                    onJump: { index in jump(index, layout: layout, proxy: proxy) },
                                    onScrub: { week in scrub(week, layout: layout, proxy: proxy) })
                            .padding(.horizontal, gutter)
                    }
                    between
                    scroller(layout, proxy: proxy)
                }
            }
        }
    }

    private func context(_ layout: CalendarLayout) -> CalendarContext {
        CalendarContext(derived: derived, shown: shown, selected: selected, today: today,
                        selectedLegId: selectedLegId, adjust: adjust, pictures: pictures, layout: layout,
                        probe: probe, select: onSelect, openLeg: onOpenLeg, menu: menu)
    }

    /// Bring block `index` to the top.
    private func jump(_ index: Int, layout: CalendarLayout, proxy: ScrollViewProxy) {
        withAnimation(.easeInOut(duration: 0.3)) {
            proxy.scrollTo(CalendarScroll.head(forBlock: index, layout: layout), anchor: .top)
        }
    }

    /// Put trip week `week` at the top, following the finger — no smoothing,
    /// which would lag it.
    private func scrub(_ week: Double, layout: CalendarLayout, proxy: ScrollViewProxy) {
        guard let target = CalendarScroll.line(forTripWeek: week, derived: derived, layout: layout) else { return }
        proxy.scrollTo(target, anchor: .top)
    }

    private func scroller(_ layout: CalendarLayout, proxy: ScrollViewProxy) -> some View {
        let ctx = context(layout)
        let rows = layout.rows(derived.blocks.count)
        return GeometryReader { viewport in
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                        gridRow(r, row, ctx)
                    }
                    tail
                }
                .padding(.horizontal, gutter)
                .padding(.bottom, 16)
            }
            .overlay {
                CalendarOverlays(context: ctx, onEdge: onEdge)
            }
            .coordinateSpace(.named(calendarSpace))
            .onPreferenceChange(CalendarRowsKey.self) { reported in
                MainActor.assumeIsolated {
                    if let block = probe.update(reported, viewport: viewport.size),
                       block < derived.blocks.count {
                        onVisible(derived.blocks[block].key)
                    }
                }
            }
            .onAppear {
                // Open on the selected day's month, without an animation.
                guard let selected, let at = derived.cellIndex(selected) else { return }
                DispatchQueue.main.async {
                    proxy.scrollTo(CalendarScroll.head(forBlock: at.block, layout: layout), anchor: .top)
                }
            }
            .onChange(of: selected) { _, next in
                follow(next, layout: layout, proxy: proxy)
            }
            .onChange(of: adjust?.id) { _, id in
                guard id != nil, let start = adjust?.draft.startDate, let at = derived.cellIndex(start) else { return }
                jump(at.block, layout: layout, proxy: proxy)
            }
        }
    }

    /// A day chosen from elsewhere: brought on screen only when it is not.
    private func follow(_ date: IsoDate?, layout: CalendarLayout, proxy: ScrollViewProxy) {
        guard let date, let at = derived.cellIndex(date) else { return }
        if probe.isOnScreen(block: at.block, week: at.week, cellHeight: layout.cellH) { return }
        withAnimation(.easeInOut(duration: 0.3)) {
            proxy.scrollTo(CalendarScroll.head(forBlock: at.block, layout: layout), anchor: .top)
        }
    }

    /// One row of blocks: their heads pinned while their weeks scroll.
    private func gridRow(_ r: Int, _ row: [Int], _ ctx: CalendarContext) -> some View {
        let layout = ctx.layout
        let weeks = row.map { derived.blocks[$0].weeks.count }.max() ?? 0
        let alignment: Alignment = layout.cols == 1 ? .center : .leading
        return Section {
            ForEach(0..<weeks, id: \.self) { w in
                HStack(alignment: .top, spacing: calendarColumnGap) {
                    ForEach(row, id: \.self) { b in
                        if w < derived.blocks[b].weeks.count {
                            CalendarWeekView(blockIndex: b, week: w, context: ctx)
                        } else {
                            Color.clear.frame(width: layout.blockWidth, height: 1)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: alignment)
                .id(CalendarScroll.lineId(r, w))
            }
            Color.clear.frame(height: 12)
        } header: {
            HStack(alignment: .bottom, spacing: calendarColumnGap) {
                ForEach(row, id: \.self) { b in
                    CalendarMonthHeader(block: derived.blocks[b], told: told(b), layout: layout)
                }
            }
            .frame(maxWidth: .infinity, alignment: alignment)
            .background(palette.paper.opacity(0.94))
            .id(CalendarScroll.headId(r))
        }
    }

    private func told(_ block: Int) -> Int {
        derived.blocks[block].tripDays.filter { !(derived.byDate[$0]?.posts.isEmpty ?? true) }.count
    }
}

/// The scroller's anchors: one per row of blocks (its pinned head) and one
/// per line of weeks.
enum CalendarScroll {
    static func headId(_ row: Int) -> String { "head-\(row)" }
    static func lineId(_ row: Int, _ week: Int) -> String { "line-\(row)-\(week)" }

    static func head(forBlock block: Int, layout: CalendarLayout) -> String {
        headId(block / max(1, layout.cols))
    }

    /// The line holding trip week `week` (its whole part) — what a drag on the
    /// year map scrolls to. A week straddling two months answers with its first.
    static func line(forTripWeek week: Double, derived: OverviewDerived, layout: CalendarLayout) -> String? {
        let whole = Int(week.rounded(.down))
        for (b, block) in derived.blocks.enumerated() {
            for (w, days) in block.weeks.enumerated() {
                guard let first = days.cells.compactMap({ $0 }).first,
                      let index = weekIndexOf(first, derived.trip.startDate) else { continue }
                if index >= whole { return lineId(b / max(1, layout.cols), w) }
            }
        }
        return nil
    }
}

/// What sits over the scroller in its own coordinates: the grips of an
/// adjusted leg, and the hover card.
private struct CalendarOverlays: View {
    let context: CalendarContext
    let onEdge: (StageEdge, IsoDate) -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let adjust = context.adjust {
                AdjustGrip(edge: .start, date: adjust.draft.startDate, context: context, onEdge: onEdge)
                AdjustGrip(edge: .end, date: adjust.draft.endDate, context: context, onEdge: onEdge)
            }
            DayHoverLayer(context: context)
                .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// One end of the adjusted leg: a round grip over the cell's foot, dragged
/// along the days.
private struct AdjustGrip: View {
    let edge: StageEdge
    let date: IsoDate
    let context: CalendarContext
    let onEdge: (StageEdge, IsoDate) -> Void
    @Environment(\.palette) private var palette
    @State private var pickups = 0
    @State private var dragging = false

    var body: some View {
        if let at = context.derived.cellIndex(date),
           let row = context.probe.row(block: at.block, week: at.week) {
            let layout = context.layout
            let x = row.frame.minX + CGFloat(at.col) * layout.step + layout.cell / 2
            let y = row.frame.minY + layout.cellH + 4
            Circle()
                .fill(palette.paper)
                .overlay(Circle().strokeBorder(palette.ink, lineWidth: 3))
                .shadow(color: Color.black.opacity(0.3), radius: 3, y: 2)
                .frame(width: calendarGrip, height: calendarGrip)
                .contentShape(Circle().inset(by: -8))
                .gesture(drag)
                .sensoryFeedback(.impact(weight: .light), trigger: pickups)
                .accessibilityElement()
                .accessibilityLabel(label)
                .accessibilityAdjustableAction { direction in
                    let delta = direction == .increment ? 1 : -1
                    if let next = addDays(date, delta) { onEdge(edge, next) }
                }
                .position(x: x, y: y)
        }
    }

    private var label: String {
        let which = edge == .start ? "Arrival" : "Departure"
        return "\(which), \(formatIsoDate(date)) — drag over the days, or use the steppers below"
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(calendarSpace))
            .onChanged { value in
                if !dragging {
                    dragging = true
                    pickups += 1
                }
                let blocks = context.derived.blocks
                if let day = context.probe.day(at: value.location, blocks: blocks, layout: context.layout), day != date {
                    onEdge(edge, day)
                }
            }
            .onEnded { _ in dragging = false }
    }
}

/// The hover card, over the day under the pointer.
private struct DayHoverLayer: View {
    let context: CalendarContext

    var body: some View {
        if let hovered = context.probe.hovered,
           let at = context.derived.cellIndex(hovered.date),
           let row = context.probe.row(block: at.block, week: at.week) {
            let layout = context.layout
            let half: CGFloat = 92
            let width = context.probe.viewport.width
            let rawX = row.frame.minX + CGFloat(at.col) * layout.step + layout.cell / 2
            let x = min(max(rawX, half + 6), max(half + 6, width - half - 6))
            // Above the cell, unless the cell is too near the top to hold it.
            let above = row.frame.minY > 118
            Color.clear
                .frame(width: 1, height: 1)
                .overlay(alignment: above ? .bottom : .top) {
                    DayHoverCard(cell: hovered.cell, stage: hovered.stage)
                        .fixedSize()
                }
                .position(x: x, y: above ? row.frame.minY - 6 : row.frame.minY + layout.cellH + 6)
        }
    }
}
