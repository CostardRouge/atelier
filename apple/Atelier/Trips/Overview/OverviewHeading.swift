// The overview's summary — the web's heading (`TripOverview.tsx`): the trip's
// name renamed in place, the route and the dates, and the three figures the
// tool exists for; on a phone the same summary as one bar and one mono line,
// because the height is spent on the month, not on the summary.
//
// Rules kept:
// - The name is renamed IN PLACE, here rather than in a sheet: the sheet that
//   holds the trip's other words is reached from a piece, and a trip with no
//   piece yet could never be renamed from it. An emptied field gives the old
//   name back rather than saving a blank; Escape (the Mac) drops the edit.
// - The route line is DERIVED from the legs (`tripRouteLabel`), never stored;
//   it and the dates open the dates sheet.
// - Three figures: days told of the trip's days, what went out (· n drafted),
//   and the longest silence — in the accent, and a link to its first day.

import SwiftUI
import AtelierKit

/// The trip's name, renamed in place.
struct TripNameField: View {
    let name: String
    /// The serif's size: 30 on a wide screen's heading, 19 in a phone's bar.
    let size: CGFloat
    let onRename: (String) -> Void

    @Environment(\.palette) private var palette
    @State private var draft: String?
    @FocusState private var focused: Bool

    var body: some View {
        if draft != nil {
            TextField("Trip name", text: Binding(get: { draft ?? "" }, set: { draft = $0 }))
                .font(Brand.display(size))
                .textFieldStyle(.plain)
                .focused($focused)
                .onSubmit(commit)
                .onChange(of: focused) { _, isFocused in
                    if !isFocused { commit() }
                }
                #if os(macOS)
                .onExitCommand { draft = nil }
                #endif
                .onAppear { focused = true }
                .frame(maxWidth: 448, alignment: .leading)
                .accessibilityLabel("Trip name")
        } else {
            Button {
                draft = name
            } label: {
                Text(name)
                    .font(Brand.display(size))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 448, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Rename the trip")
            .accessibilityLabel("\(name), rename the trip")
        }
    }

    private func commit() {
        guard let value = draft else { return }
        draft = nil
        let next = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !next.isEmpty, next != name { onRename(next) }
    }
}

/// One figure of the heading: the number in the mono face, the word under it.
struct OverviewFigure: View {
    let value: Text
    let label: String
    var accent = false
    var help: String?
    var action: (() -> Void)?

    @Environment(\.palette) private var palette

    var body: some View {
        if let action {
            Button(action: action) { face }
                .buttonStyle(.plain)
                .help(help ?? "")
        } else {
            face
        }
    }

    private var face: some View {
        VStack(alignment: .trailing, spacing: 3) {
            value
                .font(Brand.mono(20))
                .monospacedDigit()
                .foregroundStyle(accent ? palette.accentInk : palette.ink)
            Text(label)
                .font(Brand.sans(11))
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .underline(action != nil, color: palette.accent.opacity(0.6))
        }
        .accessibilityElement(children: .combine)
    }
}

/// The wide screen's heading: the name, the route and dates, the figures.
struct OverviewHeading: View {
    let derived: OverviewDerived
    let onRename: (String) -> Void
    let onEditDates: () -> Void
    let onSilence: (IsoDate) -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        let trip = derived.trip
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: 24) {
                titles(trip)
                Spacer(minLength: 12)
                figures
            }
            VStack(alignment: .leading, spacing: 12) {
                titles(trip)
                figures
            }
        }
        .padding(.bottom, 8)
    }

    private func titles(_ trip: TripDoc) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            TripNameField(name: trip.name, size: 30, onRename: onRename)
            Button(action: onEditDates) {
                routeLine(trip)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .help("Change the trip's dates")
        }
    }

    /// "Perth → Cairns · 1 Mar 2025 → 20 May 2025 · 81 days · 3 stages".
    private func routeLine(_ trip: TripDoc) -> Text {
        let route = tripRouteLabel(trip)
        let days = derived.coverage.totalDays
        let stages = trip.stages.count
        var tail = " · " + OverviewWords.count(days, "day")
        if stages > 0 { tail += " · " + OverviewWords.count(stages, "stage") }
        let dates = Text("\(formatIsoDate(trip.startDate)) → \(formatIsoDate(trip.endDate))").font(Brand.mono(12))
        return Text(route.isEmpty ? "" : "\(route) · ") + dates + Text(tail)
    }

    private var figures: some View {
        let coverage = derived.coverage
        let drafted = derived.drafted
        return HStack(alignment: .bottom, spacing: 24) {
            OverviewFigure(value: Text("\(coverage.toldDays)") + Text("/\(coverage.totalDays)").foregroundStyle(palette.muted),
                           label: "days told")
            OverviewFigure(value: Text("\(coverage.publishedPosts)"),
                           label: drafted > 0 ? "published · \(drafted) drafted" : "published")
            if let gap = coverage.longestGap {
                OverviewFigure(value: Text("\(gap.length)"),
                               label: "\(gap.length == 1 ? "day" : "days") of silence at most",
                               accent: true,
                               help: "\(formatIsoDate(gap.start)) → \(formatIsoDate(gap.end)) — go there",
                               action: { onSilence(gap.start) })
            }
        }
    }
}

/// The phone's one mono line under the bar: what went out, what waits, and
/// the longest silence as a link to its first day.
struct OverviewPhoneLine: View {
    let derived: OverviewDerived
    let onSilence: (IsoDate) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        let coverage = derived.coverage
        let drafted = derived.drafted
        HStack(spacing: 0) {
            Text("\(coverage.publishedPosts) published" + (drafted > 0 ? " · \(drafted) drafted" : ""))
                .foregroundStyle(palette.muted)
            if let gap = coverage.longestGap {
                Text(" · ").foregroundStyle(palette.muted)
                Button {
                    onSilence(gap.start)
                } label: {
                    Text("\(OverviewWords.count(gap.length, "day")) of silence at most")
                        .foregroundStyle(palette.accentInk)
                        .underline(color: palette.accent.opacity(0.6))
                }
                .buttonStyle(.plain)
                .help("\(formatIsoDate(gap.start)) → \(formatIsoDate(gap.end)) — go there")
            }
            Spacer(minLength: 0)
        }
        .font(Brand.mono(11))
        .lineLimit(1)
    }
}

/// The band of the adjust mode, in place of the phone's line: which leg, its
/// draft span, and the two ways out.
struct AdjustLegBand: View {
    let draft: TripStage
    let index: Int
    let onCancel: () -> Void
    let onDone: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        let label = stageLabel(draft)
        let days = (daysBetween(draft.startDate, draft.endDate) ?? 0) + 1
        HStack(spacing: 8) {
            Circle().fill(OverviewLegTint.color(index)).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 1) {
                Text(label.isEmpty ? "Unnamed stage" : label)
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                Text("\(formatIsoDate(draft.startDate)) → \(formatIsoDate(draft.endDate)) · \(days) d")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.accentInk)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button("Cancel", action: onCancel)
                .buttonStyle(DevelopPillButtonStyle())
                .keyboardShortcut(.cancelAction)
            Button("Done", action: onDone)
                .buttonStyle(OverviewInkButtonStyle(fill: false))
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.accentWash))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).strokeBorder(palette.accent.opacity(0.4), lineWidth: 1))
    }
}

/// The keyboard twin of the grips, visible — nothing in this suite is
/// drag-only: one day per press, a week with Shift (the Mac) or from the
/// button's own menu (a long press).
struct AdjustSteppers: View {
    let draft: TripStage
    let onEdge: (StageEdge, IsoDate) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 8) {
            stepper(.start)
            stepper(.end)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(palette.surface)
        .overlay(alignment: .top) { Rectangle().fill(palette.lineStrong).frame(height: 1) }
    }

    private func stepper(_ edge: StageEdge) -> some View {
        let value = edge == .start ? draft.startDate : draft.endDate
        let noun = edge == .start ? "Arrival" : "Departure"
        return HStack(spacing: 4) {
            Text(edge == .start ? "ARRIVED" : "LEFT")
                .font(Brand.mono(9))
                .kerning(0.8)
                .foregroundStyle(palette.muted)
            stepButton(edge, value, back: true, label: "\(noun) a day earlier")
            Text(formatIsoDate(value))
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            stepButton(edge, value, back: false, label: "\(noun) a day later")
        }
        .frame(maxWidth: .infinity)
    }

    private func stepButton(_ edge: StageEdge, _ value: IsoDate, back: Bool, label: String) -> some View {
        Button {
            step(edge, value, by: (back ? -1 : 1) * (shiftHeld ? 7 : 1))
        } label: {
            OverviewRoundGlyph(symbol: back ? "chevron.left" : "chevron.right", lit: false)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .contextMenu {
            Button(back ? "A week earlier" : "A week later") {
                step(edge, value, by: back ? -7 : 7)
            }
        }
    }

    private func step(_ edge: StageEdge, _ value: IsoDate, by days: Int) {
        if let next = addDays(value, days) { onEdge(edge, next) }
    }

    /// Shift on the Mac's keyboard at the moment of the click.
    private var shiftHeld: Bool {
        #if os(macOS)
        return NSEvent.modifierFlags.contains(.shift)
        #else
        return false
        #endif
    }
}

#Preview("Heading, line, adjust") {
    let trip = TripOverviewFixtures.trip()
    let derived = OverviewDerived(trip)
    VStack(alignment: .leading, spacing: 24) {
        OverviewHeading(derived: derived, onRename: { _ in }, onEditDates: {}, onSilence: { _ in })
        OverviewPhoneLine(derived: derived, onSilence: { _ in })
            .frame(width: 358)
        AdjustLegBand(draft: trip.stages[0], index: 0, onCancel: {}, onDone: {})
            .frame(width: 374)
        AdjustSteppers(draft: trip.stages[0], onEdge: { _, _ in })
            .frame(width: 390)
    }
    .padding(24)
}
