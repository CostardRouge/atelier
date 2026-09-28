// The gallery's Bands view — the web's `ResumeBand`, `TripRow` and
// `DayStrip`: the trip you were on first, with the one verb that matters
// (Resume) and the sentence the whole tool exists for — how much is told, and
// how long the silence has run — then every other trip as a progress row.
//
// A row's strip is the trip's days as cells: one per day up to two months,
// then bucketed exactly as the card's rhythm band is (`rhythmBuckets`), on
// the grid's own five-rung ramp — a row and the overview must not disagree
// about a day. The view is a wide-screen reading: a phone always gets the
// cards, as on the web.

import SwiftUI
import AtelierKit

/// The trip's days as a strip of cells, at most 62.
struct TripDayBars: View {
    let coverage: TripCoverage
    @Environment(\.palette) private var palette

    var body: some View {
        let bars = rhythmBuckets(coverage, max: Swift.min(62, coverage.totalDays))
        HStack(spacing: 1) {
            ForEach(bars, id: \.from) { bar in
                RoundedRectangle(cornerRadius: 1)
                    .fill(palette.heatmapLevel(rhythmLevel(bar)))
                    .frame(maxWidth: .infinity)
                    .help(TripDayBars.label(bar))
            }
        }
        .accessibilityHidden(true)
    }

    /// `14 Mar 2025 → 20 Mar 2025 · 2/7 told`.
    static func label(_ bar: RhythmBucket) -> String {
        let span = bar.days > 1 ? "\(formatIsoDate(bar.from)) → \(formatIsoDate(bar.to))" : formatIsoDate(bar.from)
        return "\(span) · \(bar.told)/\(bar.days) told"
    }
}

/// The band at the top of the Bands view: the trip open, else the one opened
/// last.
struct TripResumeBand: View {
    let trip: TripDoc
    let isOpen: Bool
    let moveTargets: [SourceInfo]
    let busy: String?
    let covers: TripCoverThumbs
    let actions: TripCardActions
    @Environment(\.palette) private var palette

    var body: some View {
        let coverage = tripCoverage(trip)
        let tiles = coverTiles(trip, coverage, { covers.has($0) })
        let lead = tiles.first.flatMap { covers.image($0.postId) }
        let shape = RoundedRectangle(cornerRadius: Brand.paperRadius)
        HStack(alignment: .center, spacing: 20) {
            leadPicture(lead, coverage: coverage)
                .frame(width: 120, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 8) {
                title(coverage)
                TripDayBars(coverage: coverage)
                    .frame(height: 20)
                if let busy {
                    Text(busy)
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.muted)
                        .accessibilityAddTraits(.updatesFrequently)
                } else {
                    summary(coverage)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                Button(isOpen ? "Resume" : "Open", action: actions.open)
                    .buttonStyle(.borderedProminent)
                    .disabled(busy != nil)
                if busy == nil {
                    TripActionsMenu(trip: trip, isOpen: isOpen, remoteOnly: false, moveTargets: moveTargets,
                                    actions: actions, large: true)
                }
            }
        }
        .padding(16)
        .background(palette.surface, in: shape)
        .overlay(shape.stroke(isOpen ? palette.accent : palette.line, lineWidth: 1))
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private func leadPicture(_ image: CGImage?, coverage: TripCoverage) -> some View {
        if let image {
            Image(decorative: image, scale: 1)
                .resizable()
                .scaledToFill()
                .frame(width: 120, height: 84)
                .clipped()
        } else {
            TripDayBars(coverage: coverage)
                .padding(8)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.paper2)
        }
    }

    private func title(_ coverage: TripCoverage) -> some View {
        let total = coverage.totalDays
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(trip.name)
                .font(Brand.display(22))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
            Text("\(formatIsoDate(trip.startDate)) → \(formatIsoDate(trip.endDate)) · \(total) day\(total == 1 ? "" : "s")")
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
                .monospacedDigit()
                .lineLimit(1)
            TripWhereTag(isOpen: isOpen)
        }
    }

    private func summary(_ coverage: TripCoverage) -> some View {
        let told = coverage.toldDays
        var line = Text("\(told) day\(told == 1 ? "" : "s") told of \(coverage.totalDays)")
            .font(Brand.sans(14, weight: .semibold))
            .foregroundStyle(palette.ink)
        if coverage.publishedPosts > 0 {
            line = line + Text(" · \(coverage.publishedPosts) published")
        }
        if let gap = coverage.longestGap, gap.length >= 2 {
            line = line + Text(" · ")
                + Text("\(gap.length) day\(gap.length == 1 ? "" : "s") of silence since \(formatIsoDate(gap.start))")
                .foregroundStyle(palette.accentInk)
        }
        return line
            .font(Brand.sans(14))
            .foregroundStyle(palette.inkSoft)
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A row of the Bands view: name and dates, the strip, the progress.
struct TripBandRow: View {
    let trip: TripDoc
    let isOpen: Bool
    let remoteOnly: Bool
    let moveTargets: [SourceInfo]
    let busy: String?
    let actions: TripCardActions
    @Environment(\.palette) private var palette
    @State private var hovering = false

    var body: some View {
        let coverage = tripCoverage(trip)
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 2) {
                Text(trip.name)
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(trip.name)
                datesLine
            }
            .frame(minWidth: 160, idealWidth: 200, maxWidth: 224, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                TripDayBars(coverage: coverage)
                    .frame(height: 12)
                if let busy {
                    Text(busy)
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.muted)
                        .accessibilityAddTraits(.updatesFrequently)
                } else {
                    TripProgressLine(coverage: coverage, small: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if busy == nil {
                TripActionsMenu(trip: trip, isOpen: isOpen, remoteOnly: remoteOnly, moveTargets: moveTargets,
                                actions: actions)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(rowGround)
        .overlay(alignment: .bottom) { Hairline() }
        .opacity(remoteOnly ? 0.75 : 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture {
            if busy == nil { actions.open() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Open \(trip.name)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: "Open") {
            if busy == nil { actions.open() }
        }
    }

    private var rowGround: Color {
        if isOpen { return palette.accentWash.opacity(0.5) }
        return hovering ? palette.surface : Color.clear
    }

    private var datesLine: some View {
        let route = tripRouteLabel(trip)
        let span = Text("\(formatIsoDate(trip.startDate)) → \(formatIsoDate(trip.endDate))").font(Brand.mono(11))
        let line = route.isEmpty ? span : span + Text(" · \(route)").font(Brand.sans(11))
        return line
            .foregroundStyle(palette.muted)
            .monospacedDigit()
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

#Preview("Bands") {
    let trip = createTripDoc("Australie", "2025-03-01", "2025-05-30")
    let other = createTripDoc("Corse", "2024-07-02", "2024-07-19")
    let actions = TripCardActions(open: {}, export: {}, delete: {}, move: { _ in }, chooseCover: {})
    return VStack(spacing: 0) {
        TripResumeBand(trip: trip, isOpen: true, moveTargets: [], busy: nil, covers: TripCoverThumbs(), actions: actions)
        TripBandRow(trip: other, isOpen: false, remoteOnly: false, moveTargets: [], busy: nil, actions: actions)
        TripBandRow(trip: other, isOpen: false, remoteOnly: true, moveTargets: [], busy: "deleting on winnow…",
                    actions: actions)
    }
    .frame(width: 900)
    .padding()
}
