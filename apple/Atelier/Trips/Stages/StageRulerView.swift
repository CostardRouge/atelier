// The trip's legs on one horizontal track — the native twin of the web's
// `StageRuler.tsx`: a video editor's timeline scaled to days, drawn under the
// calendar on a wide screen (a phone has the legs sheet instead).
//
// Rules kept (`roadtrip.md`, «The legs are a horizontal RULER», «The stage
// ruler is ONE gesture surface»):
// - A leg is a bar per lane (overlapping legs STACK), dragged by either edge
//   to change when it began or ended, or by its middle to slide it whole —
//   WHOLE days, clamped to the TRIP, the leg collapsing rather than reversing
//   (`applyRulerDelta` over the kernel's `resizeStage` / `shiftStage`). A pin
//   follows the hand saying the date it would land on.
// - Three gestures told apart by what the hand does: a TAP opens what it
//   landed on (a leg, or the day under it); a SWIPE travels the track; a
//   finger picks a leg up only after a still HOLD (the web's `LONG_PRESS_MS`,
//   350 ms) — a finger that travels straight away is scrolling, never
//   editing. A mouse picks it up at once.
// - Nothing is drag-only: a focused bar or edge moves with ← / → (Shift: a
//   week), the playhead moves the open day with the same keys, and VoiceOver's
//   adjust gesture moves a leg a day.
// - A run of days no leg covers, wide enough to aim at, offers a `+` that adds
//   a leg over exactly that run and opens it.
// - Month rules with their names, a day's stroke (taller on a Monday or a
//   first of the month, Mondays alone once days crowd), the rung strip of
//   what each day told, and the playhead on the open day.
//
// Native, and different on purpose: a track wider than its box (the whole of a
// long trip with no span) travels in a native horizontal scroll view, which
// glides on after the lift as the web's `useFlingPan` does. Where a host hands
// `onPan` (the web's `onPan`, a loupe driving the span), a swipe over a fitted
// track moves that span by whole weeks, a throw carrying on by what the lift
// predicts; the Stages panel hands none today, exactly as the web's overview.

import SwiftUI
import AtelierKit

struct StageRulerView: View {
    static let space = "stages.ruler"

    let trip: TripDoc
    /// The days the track draws — the months the calendar shows; nil is the
    /// whole trip. The EDITS still clamp to the real trip.
    var span: TripSpan? = nil
    var selectedId: String? = nil
    /// The day open below — where the playhead stands.
    var cursorDate: IsoDate? = nil
    /// Each day's rung (0…4); nil draws no rung strip.
    var rungs: [IsoDate: Int]? = nil
    /// A leg was tapped: open it, and go to the day it began.
    var onOpenStage: (TripStage) -> Void
    /// Another day was asked for — a tap on the track, or the playhead's keys.
    var onScrub: (IsoDate) -> Void
    /// The legs rewritten — every step of a drag.
    var onChange: ([TripStage]) -> Void
    /// A gesture ended: the host seals its undo step.
    var onGestureEnd: () -> Void = {}
    /// Move the span by whole weeks; answers the weeks it really moved.
    var onPan: ((Int) -> Int)? = nil

    @Environment(\.palette) private var palette
    @State private var width: CGFloat = 0
    @State private var drag: RulerLegDrag?
    /// A drag that moved ends in a tap on the same bar; this swallows it.
    @State private var swallowTap = false
    @State private var panCarry: Double = 0
    @State private var panLast: CGFloat?
    @State private var pickups = 0

    var body: some View {
        let layout = RulerLayout(trip: trip, span: span, width: width, rungs: rungs != nil)
        ZStack(alignment: .topLeading) {
            if let layout {
                ruler(layout)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GeometryReader { g in
                Color.clear
                    .onAppear { width = g.size.width }
                    .onChange(of: g.size.width) { _, w in width = w }
            }
        )
        .sensoryFeedback(Self.pickupFeedback, trigger: pickups)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stage timeline")
    }

    private static var pickupFeedback: SensoryFeedback {
        #if os(macOS)
        return .alignment
        #else
        return .impact(weight: .medium)
        #endif
    }

    // MARK: - the track

    private func ruler(_ layout: RulerLayout) -> some View {
        let fits = layout.trackW <= width + 0.5
        return ScrollView(.horizontal, showsIndicators: !fits) {
            track(layout, panning: fits && onPan != nil)
                .frame(width: max(layout.trackW, 1), height: layout.height, alignment: .topLeading)
        }
        .scrollDisabled(fits)
        .frame(height: layout.height + (fits ? 0 : 8))
        .coordinateSpace(.named(Self.space))
        .overlay(alignment: .topLeading) { pin(layout) }
    }

    private func track(_ layout: RulerLayout, panning: Bool) -> some View {
        ZStack(alignment: .topLeading) {
            // The track's own surface: a tap opens that day below.
            Rectangle()
                .fill(Color.clear)
                .contentShape(Rectangle())
                .frame(width: layout.trackW, height: layout.height)
                .gesture(SpatialTapGesture().onEnded { value in pickDay(value.location.x, layout) })
            scale(layout)
            gapButtons(layout)
            ForEach(layout.bars, id: \.stage.id) { bar in
                barView(bar, layout)
            }
            playhead(layout)
        }
        .simultaneousGesture(panGesture(layout), including: panning ? .all : .subviews)
    }

    /// The head's rule, the rung strip, the month rules and names, the axis
    /// and the day strokes — drawn, never hit.
    private func scale(_ layout: RulerLayout) -> some View {
        let palette = self.palette
        let rungs = self.rungs
        #if os(iOS)
        let panned = onPan != nil
        #endif
        return Canvas { ctx, size in
            let dayW = CGFloat(layout.dayW)
            var head = Path()
            head.move(to: CGPoint(x: 0, y: RulerLayout.head - 0.5))
            head.addLine(to: CGPoint(x: size.width, y: RulerLayout.head - 0.5))
            ctx.stroke(head, with: .color(palette.line), lineWidth: 1)
            #if os(iOS)
            if panned {
                // Where a finger is TOLD the track travels.
                let band = CGRect(x: 0, y: layout.bodyH, width: size.width, height: RulerLayout.axis + 6)
                ctx.fill(Path(roundedRect: band, cornerRadius: 6), with: .color(palette.ink.opacity(0.06)))
            }
            #endif
            if let rungs {
                for i in 0..<layout.total {
                    guard let date = dayAtOffset(layout.drawn, Double(i)) else { continue }
                    let cell = CGRect(x: CGFloat(i) * dayW + 1, y: RulerLayout.head + 2,
                                      width: max(1, dayW - 2), height: RulerLayout.rung)
                    let color = StagesColor.rung(rungs[date] ?? 0, palette)
                    ctx.fill(Path(roundedRect: cell, cornerRadius: 2), with: .color(color))
                }
            }
            for month in layout.months {
                let x = CGFloat(month.offset) * dayW + 0.5
                var rule = Path()
                rule.move(to: CGPoint(x: x, y: layout.lanesTop))
                rule.addLine(to: CGPoint(x: x, y: layout.lanesTop + layout.lanesH + 6))
                ctx.stroke(rule, with: .color(palette.line), lineWidth: 1)
                let label = Text(month.label.uppercased())
                    .font(Brand.mono(9))
                    .kerning(0.7)
                    .foregroundStyle(palette.muted)
                ctx.draw(label, at: CGPoint(x: x + 4, y: layout.lanesTop + layout.lanesH + 10), anchor: .topLeading)
            }
            var axis = Path()
            axis.move(to: CGPoint(x: 0, y: layout.bodyH + 4.5))
            axis.addLine(to: CGPoint(x: size.width, y: layout.bodyH + 4.5))
            ctx.stroke(axis, with: .color(palette.line), lineWidth: 1)
            for tick in layout.ticks {
                let rect = CGRect(x: CGFloat(tick.offset) * dayW, y: layout.bodyH + 4,
                                  width: 1, height: tick.strong ? 6 : 3)
                ctx.fill(Path(rect), with: .color(tick.strong ? palette.faint : palette.lineStrong))
            }
        }
        .frame(width: layout.trackW, height: layout.height)
        .allowsHitTesting(false)
    }

    // MARK: - a gap's +

    private func gapButtons(_ layout: RulerLayout) -> some View {
        ForEach(layout.gaps, id: \.from) { gap in
            let dayW = CGFloat(layout.dayW)
            let wide = CGFloat(gap.length) * dayW
            if Double(wide) >= rulerGapButtonMinWidth {
                Button {
                    addOver(gap)
                } label: {
                    Text("+")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.faint)
                        .frame(width: 18, height: 18)
                        .background(Circle().fill(palette.paper))
                        .overlay(Circle().strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [2, 2])))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Add a stage covering \(formatIsoDate(gap.startDate)) to \(formatIsoDate(gap.endDate))")
                .help("Add a stage covering \(formatIsoDate(gap.startDate)) → \(formatIsoDate(gap.endDate))")
                .offset(x: CGFloat(gap.from) * dayW + wide / 2 - 9, y: layout.lanesTop + RulerLayout.bar / 2 - 9)
            }
        }
    }

    // MARK: - a leg

    private func barView(_ bar: RulerBar, _ layout: RulerLayout) -> some View {
        let stage = bar.stage
        let dayW = CGFloat(layout.dayW)
        let selected = stage.id == selectedId
        let tint = StagesColor.tint(bar.index)
        let label = stageLabel(stage)
        let w = max(CGFloat(bar.length) * dayW, RulerLayout.handle * 2 + 2)
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: bar.clipStart ? 0 : 10, bottomLeadingRadius: bar.clipStart ? 0 : 10,
            bottomTrailingRadius: bar.clipEnd ? 0 : 10, topTrailingRadius: bar.clipEnd ? 0 : 10
        )
        let top = layout.lanesTop + CGFloat(bar.lane) * (RulerLayout.bar + RulerLayout.laneGap)
        let traits: AccessibilityTraits = selected ? [.isButton, .isSelected] : [.isButton]
        return ZStack(alignment: .leading) {
            shape.fill(palette.surface)
            shape.fill(tint.opacity(0.22))
            shape.stroke(selected ? palette.accent : tint, lineWidth: selected ? 2 : 1)
            // The middle: a tap opens the leg, a hold (a press, with a mouse) slides it.
            HStack(spacing: 0) {
                Text(label.isEmpty ? "Unnamed stage" : label)
                    .font(Brand.sans(12, weight: .semibold))
                    .foregroundStyle(label.isEmpty ? palette.muted : palette.ink)
                Text(" · \(rulerBarDetail(stage))")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
            }
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, RulerLayout.handle + 4)
            .frame(width: w, height: RulerLayout.bar, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { tapBar(stage) }
            .simultaneousGesture(legGesture(stage, .move, layout))
            .focusable()
            .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in nudge(stage, .move, press) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(rulerBarTitle(stage))
            .accessibilityHint("Drag to slide it — hold it first on a touch screen — or move it with the arrow keys")
            .accessibilityAddTraits(traits)
            .accessibilityAdjustableAction { direction in
                adjust(stage, .move, direction)
            }
            HStack(spacing: 0) {
                if !bar.clipStart {
                    handle(stage, .start, selected, layout)
                }
                Spacer(minLength: 0)
                if !bar.clipEnd {
                    handle(stage, .end, selected, layout)
                }
            }
            .frame(width: w, height: RulerLayout.bar)
        }
        .frame(width: w, height: RulerLayout.bar)
        .shadow(color: selected ? Color.black.opacity(0.18) : .clear, radius: selected ? 6 : 0, y: selected ? 4 : 0)
        .offset(x: CGFloat(bar.from) * dayW, y: top)
    }

    /// An edge, grabbed to change when the leg began or ended.
    private func handle(_ stage: TripStage, _ mode: RulerDragMode, _ selected: Bool,
                        _ layout: RulerLayout) -> some View {
        let label = stageLabel(stage)
        let who = label.isEmpty ? "this stage" : label
        let spoken = mode == .start
            ? "Arrival of \(who), \(formatIsoDate(stage.startDate))"
            : "Departure from \(who), \(formatIsoDate(stage.endDate))"
        return Capsule()
            .fill(selected ? palette.accentInk : palette.ink.opacity(0.25))
            .frame(width: 3, height: 14)
            .frame(width: RulerLayout.handle, height: RulerLayout.bar)
            .contentShape(Rectangle())
            .gesture(legGesture(stage, mode, layout))
            .focusable()
            .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in nudge(stage, mode, press) }
            #if os(macOS)
            .onHover { inside in
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            #endif
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
            .accessibilityHint("Hold and drag, or use the arrow keys")
            .accessibilityAdjustableAction { direction in
                adjust(stage, mode, direction)
            }
    }

    // MARK: - the playhead

    @ViewBuilder
    private func playhead(_ layout: RulerLayout) -> some View {
        if let cursorDate, let at = dayOffset(layout.drawn, cursorDate) {
            let dayW = CGFloat(layout.dayW)
            let x = (CGFloat(at) + 0.5) * dayW
            Rectangle()
                .fill(palette.ink.opacity(0.5))
                .frame(width: 2, height: layout.bodyH + 6)
                .offset(x: x - 1)
                .allowsHitTesting(false)
            // The keyboard's way through the trip. Deliberately not dragged: a
            // drag on this ruler moves a leg, and only a leg.
            RoundedRectangle(cornerRadius: 3)
                .fill(palette.paper)
                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(palette.ink, lineWidth: 2))
                .frame(width: 10, height: 10)
                .frame(width: 12, height: RulerLayout.head)
                .contentShape(Rectangle())
                .offset(x: x - 6)
                .focusable()
                .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
                    stepDay(cursorDate, press, layout)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("The day open below")
                .accessibilityValue(formatIsoDate(cursorDate))
                .accessibilityAdjustableAction { direction in
                    let delta = direction == .increment ? 1 : -1
                    if let next = addDays(cursorDate, delta), dayOffset(layout.drawn, next) != nil { onScrub(next) }
                }
                .help("\(formatIsoDate(cursorDate)) — the day open below; the arrow keys move it")
        }
    }

    // MARK: - the pin

    @ViewBuilder
    private func pin(_ layout: RulerLayout) -> some View {
        if let drag, let x = drag.x, let stage = trip.stages.first(where: { $0.id == drag.id }) {
            let half: CGFloat = 104
            let lo = min(half + 6, width / 2)
            let hi = max(width - half - 6, width / 2)
            let clampedX = min(max(x, lo), hi)
            let top = layout.lanesTop + CGFloat(drag.lane) * (RulerLayout.bar + RulerLayout.laneGap)
            VStack(spacing: -4) {
                Text(rulerPinText(drag.mode, stage))
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .foregroundStyle(palette.onMedia)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.frame))
                    .shadow(color: .black.opacity(0.28), radius: 9, y: 6)
                Rectangle()
                    .fill(palette.frame)
                    .frame(width: 8, height: 8)
                    .rotationEffect(.degrees(45))
            }
            .fixedSize()
            .position(x: clampedX, y: top - 20)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    // MARK: - gestures

    private func legGesture(_ stage: TripStage, _ mode: RulerDragMode, _ layout: RulerLayout) -> some Gesture {
        #if os(macOS)
        return DragGesture(minimumDistance: 2, coordinateSpace: .named(Self.space))
            .onChanged { value in
                if drag == nil { begin(stage, mode, x: value.startLocation.x) }
                follow(value.translation.width, x: value.location.x, layout)
            }
            .onEnded { _ in finish() }
        #else
        return LongPressGesture(minimumDuration: 0.35, maximumDistance: 6)
            .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space)))
            .onChanged { value in
                guard case .second(true, let moving) = value else { return }
                if drag == nil { begin(stage, mode, x: moving?.startLocation.x) }
                if let moving { follow(moving.translation.width, x: moving.location.x, layout) }
            }
            .onEnded { _ in finish() }
        #endif
    }

    /// The leg is picked up: from here the hand is its.
    private func begin(_ stage: TripStage, _ mode: RulerDragMode, x: CGFloat?) {
        let current = trip.stages.first { $0.id == stage.id } ?? stage
        let lane = RulerLayout.lane(of: stage.id, trip: trip, span: span)
        drag = RulerLegDrag(id: stage.id, mode: mode, origin: current, lane: lane, x: x, moved: false,
                            lastStart: current.startDate, lastEnd: current.endDate)
        pickups += 1
    }

    private func follow(_ dx: CGFloat, x: CGFloat, _ layout: RulerLayout) {
        guard var current = drag, layout.dayW > 0 else { return }
        let days = Int((Double(dx) / layout.dayW).rounded())
        if days != 0 { current.moved = true }
        current.x = x
        let next = applyRulerDelta(trip, current.mode, current.origin, days)
        // Compared with what this drag last WROTE, never with a trip a
        // gesture's closure may hold from an older render.
        let changed = next.startDate != current.lastStart || next.endDate != current.lastEnd
        current.lastStart = next.startDate
        current.lastEnd = next.endDate
        drag = current
        if changed { onChange(trip.stages.map { $0.id == next.id ? next : $0 }) }
    }

    private func finish() {
        guard let ended = drag else { return }
        swallowTap = ended.moved
        drag = nil
        onGestureEnd()
    }

    private func tapBar(_ stage: TripStage) {
        if swallowTap {
            swallowTap = false
            return
        }
        onOpenStage(stage)
    }

    private func panGesture(_ layout: RulerLayout) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                guard drag == nil, let onPan else { return }
                let x = value.translation.width
                let dx = x - (panLast ?? 0)
                panLast = x
                let step = panWeeks(panCarry, Double(-dx), layout.dayW)
                panCarry = step.carry
                if step.weeks != 0 { _ = onPan(step.weeks) }
            }
            .onEnded { value in
                defer {
                    panCarry = 0
                    panLast = nil
                }
                guard drag == nil, let onPan else { return }
                // The throw: what the lift predicts, carried on in whole weeks.
                let glide = value.predictedEndTranslation.width - value.translation.width
                let step = panWeeks(panCarry, Double(-glide), layout.dayW)
                if step.weeks != 0 { _ = onPan(step.weeks) }
            }
    }

    // MARK: - edits

    private func update(_ next: TripStage) {
        guard let current = trip.stages.first(where: { $0.id == next.id }),
              current.startDate != next.startDate || current.endDate != next.endDate else { return }
        onChange(trip.stages.map { $0.id == next.id ? next : $0 })
    }

    private func nudge(_ stage: TripStage, _ mode: RulerDragMode, _ press: KeyPress) -> KeyPress.Result {
        let mods = press.modifiers
        if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) { return .ignored }
        let back = press.key == .leftArrow
        let days = (mods.contains(.shift) ? 7 : 1) * (back ? -1 : 1)
        let current = trip.stages.first { $0.id == stage.id } ?? stage
        update(applyRulerDelta(trip, mode, current, days))
        return .handled
    }

    private func adjust(_ stage: TripStage, _ mode: RulerDragMode, _ direction: AccessibilityAdjustmentDirection) {
        let current = trip.stages.first { $0.id == stage.id } ?? stage
        let days: Int
        switch direction {
        case .increment: days = 1
        case .decrement: days = -1
        @unknown default: return
        }
        update(applyRulerDelta(trip, mode, current, days))
        onGestureEnd()
    }

    private func stepDay(_ from: IsoDate, _ press: KeyPress, _ layout: RulerLayout) -> KeyPress.Result {
        let mods = press.modifiers
        if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) { return .ignored }
        let back = press.key == .leftArrow
        let days = (mods.contains(.shift) ? 7 : 1) * (back ? -1 : 1)
        if let next = addDays(from, days), dayOffset(layout.drawn, next) != nil { onScrub(next) }
        return .handled
    }

    /// A tap on the track opens that day below.
    private func pickDay(_ x: CGFloat, _ layout: RulerLayout) {
        guard layout.dayW > 0, let date = dayAtOffset(layout.drawn, Double(x) / layout.dayW) else { return }
        onScrub(date)
    }

    private func addOver(_ gap: RulerGap) {
        let stage = stageOverGap(trip, gap.startDate, gap.endDate)
        onChange(insertStageInOrder(trip.stages, stage))
        onOpenStage(stage)
        onGestureEnd()
    }
}

// MARK: - the geometry of one render

/// A leg being dragged: which, how, from where, and whether it has moved a day.
private struct RulerLegDrag: Equatable {
    var id: String
    var mode: RulerDragMode
    var origin: TripStage
    var lane: Int
    /// Where the hand is, in the ruler's space; nil until it has moved.
    var x: CGFloat?
    var moved: Bool
    /// The dates this drag last wrote.
    var lastStart: IsoDate
    var lastEnd: IsoDate
}

/// Everything the track measures, read once per render from the kernel's
/// ruler (`StageRuler.swift`) — the web's measures, in points.
private struct RulerLayout {
    /// The strip above the lanes where the playhead stands.
    static let head: CGFloat = 16
    static let bar: CGFloat = 34
    static let laneGap: CGFloat = 4
    static let axis: CGFloat = 20
    static let rung: CGFloat = 10
    static let rungGap: CGFloat = 6
    static let handle: CGFloat = 10

    let drawn: TripSpan
    let total: Int
    let bars: [RulerBar]
    let gaps: [RulerGap]
    let months: [RulerMonth]
    let ticks: [RulerTick]
    let dayW: Double
    let lanesTop: CGFloat
    let lanesH: CGFloat

    var bodyH: CGFloat { lanesTop + lanesH }
    var height: CGFloat { bodyH + Self.axis + 6 }
    var trackW: CGFloat { CGFloat(dayW) * CGFloat(total) }

    init?(trip: TripDoc, span: TripSpan?, width: CGFloat, rungs: Bool) {
        let drawn = span ?? TripSpan(startDate: trip.startDate, endDate: trip.endDate)
        guard let total = spanLength(drawn.startDate, drawn.endDate) else { return nil }
        self.drawn = drawn
        self.total = total
        bars = rulerBars(drawn, trip.stages)
        gaps = rulerGaps(drawn, bars)
        months = rulerMonths(drawn)
        let lanes = max(1, laneCount(bars))
        dayW = rulerDayWidth(Double(width), total, 1)
        ticks = rulerTicks(drawn, dayW)
        lanesTop = Self.head + (rungs ? Self.rung + Self.rungGap : 0)
        lanesH = CGFloat(lanes) * Self.bar + CGFloat(lanes - 1) * Self.laneGap
    }

    /// The lane a leg is drawn on, for the pin over it.
    static func lane(of id: String, trip: TripDoc, span: TripSpan?) -> Int {
        let drawn = span ?? TripSpan(startDate: trip.startDate, endDate: trip.endDate)
        return rulerBars(drawn, trip.stages).first { $0.stage.id == id }?.lane ?? 0
    }
}

#Preview("Stage ruler") {
    StageRulerView(trip: StagesFixtures.trip, selectedId: StagesFixtures.trip.stages[1].id,
                   cursorDate: "2025-11-12", rungs: StagesColor.rungs(StagesFixtures.trip),
                   onOpenStage: { _ in }, onScrub: { _ in }, onChange: { _ in })
        .padding(16)
        .frame(width: 720)
        .background(Palette.paper.paper)
}
