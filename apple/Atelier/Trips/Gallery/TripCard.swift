// One trip in the gallery's Cards view — the web's `TripCard`, `CoverArt`,
// `RhythmBand` and `ProgressLine`.
//
// The WHOLE card opens the trip: a card showing a trip's name, its dates and
// how much of it is told is the thing you point at; the ⋯ keeps its own tap.
// Where you were is one tag, never two — `open` (the trip open in the tool)
// wins over `last opened` (the trip this device opened last).
//
// The cover is what the trip's layout ASKS for, never a promise: `coverTiles`
// has already resolved which pictures exist, so a mosaic of one is a cover, a
// mosaic of none is the RHYTHM — the trip's own weeks on the grid's five-rung
// ramp, so a card and the overview never disagree about a day — and a trip
// kept on an instance and not mirrored here says where its pictures live
// rather than drawing a shape this device does not own. `None` is the
// compact card. The route under the name is DERIVED from the legs
// (`tripRouteLabel`), so a trip with no leg draws none. Progress reads as how
// much of the trip has been TOLD, the number the maintainer tracks — not how
// many files exist.

import SwiftUI
import AtelierKit

struct TripCard: View {
    let trip: TripDoc
    let isOpen: Bool
    /// The trip this device opened last — where "resume" would land.
    let lastOpened: Bool
    /// Kept on an instance and not yet mirrored here: opening pulls it first.
    let remoteOnly: Bool
    let moveTargets: [SourceInfo]
    /// A sentence while a move, a delete or a cover is under way.
    let busy: String?
    /// The hook pictures this device holds.
    let covers: TripCoverThumbs
    let compact: Bool
    let actions: TripCardActions

    @Environment(\.palette) private var palette

    var body: some View {
        let coverage = tripCoverage(trip)
        let tiles = coverTiles(trip, coverage, { covers.has($0) })
        let shape = RoundedRectangle(cornerRadius: Brand.paperRadius)
        VStack(alignment: .leading, spacing: 0) {
            if trip.cover.layout != CoverLayout.none {
                TripCoverArt(trip: trip, coverage: coverage, tiles: tiles, covers: covers, remoteOnly: remoteOnly,
                             compact: compact)
                    .overlay(alignment: .topTrailing) {
                        if remoteOnly { notHereYet }
                    }
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius,
                                                      topTrailingRadius: Brand.paperRadius))
            }
            details(coverage)
        }
        .background(palette.surface, in: shape)
        .overlay(shape.stroke(isOpen ? palette.accent : palette.line, lineWidth: 1))
        .opacity(remoteOnly ? 0.75 : 1)
        .contentShape(shape)
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

    private func details(_ coverage: TripCoverage) -> some View {
        let total = coverage.totalDays
        let fraction = total > 0 ? Double(coverage.toldDays) / Double(total) : 0
        return VStack(alignment: .leading, spacing: compact ? 8 : 10) {
            HStack(spacing: 8) {
                Text(trip.name)
                    .font(Brand.sans(compact ? 14 : 16, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(trip.name)
                if isOpen || lastOpened {
                    TripWhereTag(isOpen: isOpen)
                }
                Spacer(minLength: 0)
                if busy == nil {
                    TripActionsMenu(trip: trip, isOpen: isOpen, remoteOnly: remoteOnly, moveTargets: moveTargets,
                                    actions: actions)
                }
            }
            datesLine
            VStack(alignment: .leading, spacing: 6) {
                TripProgressBar(fraction: fraction)
                TripProgressLine(coverage: coverage, small: compact)
            }
            if let busy {
                Text(busy)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .padding(compact ? 14 : 16)
    }

    /// The span and the route on one line.
    private var datesLine: some View {
        let route = tripRouteLabel(trip)
        let span = Text("\(formatIsoDate(trip.startDate)) → \(formatIsoDate(trip.endDate))")
            .font(Brand.mono(compact ? 10 : 11))
        let line = route.isEmpty
            ? span
            : span + Text(" · ").foregroundStyle(palette.faint) + Text(route).font(Brand.sans(compact ? 11 : 12))
        return line
            .font(Brand.sans(compact ? 11 : 12))
            .foregroundStyle(palette.muted)
            .monospacedDigit()
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private var notHereYet: some View {
        Text("NOT HERE YET")
            .font(Brand.mono(9))
            .kerning(0.7)
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(palette.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(palette.line, lineWidth: 1))
            .padding(10)
    }
}

/// `open` or `last opened` — where you were, as the card, the row and the
/// band say it.
struct TripWhereTag: View {
    let isOpen: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        Text(isOpen ? "OPEN" : "LAST OPENED")
            .font(Brand.mono(9))
            .kerning(0.7)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(isOpen ? palette.accentInk : palette.muted)
            .background(isOpen ? palette.accentWash : palette.paper2, in: RoundedRectangle(cornerRadius: 6))
            .fixedSize()
    }
}

/// The five-point bar of days told.
struct TripProgressBar: View {
    let fraction: Double
    @Environment(\.palette) private var palette

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.paper2)
                Capsule()
                    .fill(palette.accent)
                    .frame(width: geo.size.width * Swift.max(0, Swift.min(1, fraction)))
            }
        }
        .frame(height: 5)
        .animation(.easeOut(duration: 0.5), value: fraction)
        .accessibilityHidden(true)
    }
}

/// The one line under a trip's name: told, published, and the silence.
struct TripProgressLine: View {
    let coverage: TripCoverage
    /// The Bands row's and a phone card's smaller line.
    var small = false
    @Environment(\.palette) private var palette

    var body: some View {
        line
            .font(Brand.sans(small ? 11 : 12))
            .foregroundStyle(palette.inkSoft)
            .monospacedDigit()
            .lineLimit(2)
    }

    private var line: Text {
        let total = coverage.totalDays
        var text = Text("\(coverage.toldDays)").font(Brand.mono(small ? 11 : 12))
            + Text(" / \(total) day\(total == 1 ? "" : "s") told")
        if coverage.publishedPosts > 0 {
            text = text + Text(" · ").foregroundStyle(palette.faint) + Text("\(coverage.publishedPosts) published")
        }
        if coverage.toldDays > 0, let gap = coverage.longestGap, gap.length >= 3 {
            text = text + Text(" · ").foregroundStyle(palette.faint)
                + Text("\(gap.length) of silence").foregroundStyle(palette.accentInk)
        }
        return text
    }
}

/// What the card shows of the trip — the web's `CoverArt`. Never called for a
/// `None` layout (the compact card draws no cover at all).
struct TripCoverArt: View {
    let trip: TripDoc
    let coverage: TripCoverage
    let tiles: [CoverTile]
    let covers: TripCoverThumbs
    let remoteOnly: Bool
    let compact: Bool
    @Environment(\.palette) private var palette

    /// How tall the cover zone is, in every shape that can fill it: two cards
    /// share a phone's width, so 168 there would be a third of the card
    /// before a word of it is read.
    static func height(compact: Bool) -> CGFloat { compact ? 112 : 168 }

    var body: some View {
        content
            .frame(maxWidth: .infinity)
            .frame(height: TripCoverArt.height(compact: compact))
    }

    @ViewBuilder
    private var content: some View {
        if tiles.isEmpty {
            if remoteOnly {
                // A trip kept there and not here holds no thumbnail at all:
                // saying where the pictures are beats drawing a shape.
                VStack(spacing: 4) {
                    Text("PICTURES LIVE ON")
                    Text(TripActionsMenu.label(trip.sourceId).uppercased())
                }
                .font(Brand.mono(10))
                .kerning(0.8)
                .foregroundStyle(palette.faint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.paper2)
            } else {
                TripRhythmBand(coverage: coverage, compact: compact)
            }
        } else {
            pictures
                .overlay(alignment: .bottom) {
                    LinearGradient(colors: [Color.clear, palette.frame.opacity(0.52)], startPoint: .top, endPoint: .bottom)
                        .frame(height: 56)
                        .allowsHitTesting(false)
                }
                .overlay(alignment: .bottomLeading) {
                    Text(TripCoverArt.caption(tiles[0]).uppercased())
                        .font(Brand.mono(10))
                        .kerning(1)
                        .foregroundStyle(palette.onMedia)
                        .shadow(color: palette.frame.opacity(0.5), radius: 1.5, x: 0, y: 1)
                        .padding(.leading, 12)
                        .padding(.bottom, 10)
                }
                .background(palette.paper2)
        }
    }

    /// The bottom-left caption: which day the cover is looking at.
    static func caption(_ tile: CoverTile) -> String {
        tile.dayNumber.map { "day \($0)" } ?? formatIsoDate(tile.date)
    }

    @ViewBuilder
    private var pictures: some View {
        if tiles.count == 1 {
            picture(tiles[0])
        } else if tiles.count == 2 {
            HStack(spacing: 2) {
                picture(tiles[0])
                picture(tiles[1])
            }
        } else {
            GeometryReader { geo in
                let lead = (geo.size.width - 2) * 1.7 / 2.7
                HStack(spacing: 2) {
                    picture(tiles[0]).frame(width: lead)
                    VStack(spacing: 2) {
                        picture(tiles[1])
                        picture(tiles[2])
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func picture(_ tile: CoverTile) -> some View {
        if let image = covers.image(tile.postId) {
            Image(decorative: image, scale: 1)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
        } else {
            palette.paper2
        }
    }
}

/// The trip's own weeks, for a card with no picture to show — a new trip, a
/// fresh import, an instance whose thumbnails are not mirrored here — the
/// web's `RhythmBand`. On the card's own surface, never on `paper2`: the
/// ramp's bottom rung IS `paper2`, so a trip with nothing told drew an empty
/// box. A told day RISES from a ruler that is always drawn.
struct TripRhythmBand: View {
    let coverage: TripCoverage
    let compact: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        let bars = rhythmBuckets(coverage)
        let barsHeight: CGFloat = compact ? 56 : 92
        VStack(alignment: .leading, spacing: 0) {
            headline
                .font(Brand.mono(10))
                .kerning(0.8)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: compact ? 1 : 2) {
                ForEach(bars, id: \.from) { bar in
                    let level = rhythmLevel(bar)
                    // The web's 12 + level/4 × 76 on a 92-point strip, scaled
                    // to the strip's height.
                    let rise = (12 + Double(level) / 4 * 76) / 92
                    RoundedRectangle(cornerRadius: 2)
                        .fill(palette.heatmapLevel(level))
                        .frame(maxWidth: .infinity)
                        .frame(height: barsHeight * rise)
                }
            }
            .frame(height: barsHeight, alignment: .bottom)
            .accessibilityHidden(true)
        }
        .padding(.horizontal, compact ? 10 : 14)
        .padding(.vertical, compact ? 8 : 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(palette.surface)
        .overlay(alignment: .bottom) { Hairline() }
    }

    private var headline: Text {
        if coverage.toldDays == 0 {
            return Text("\(coverage.totalDays) DAYS, NONE TOLD YET")
        }
        if let gap = coverage.longestGap, gap.length > 1 {
            return Text("\(gap.length) DAYS NEVER TOLD").foregroundStyle(palette.accentInk)
                + Text(" · ").foregroundStyle(palette.faint)
                + Text(formatIsoDate(gap.start).uppercased())
        }
        return Text("\(coverage.toldDays) OF \(coverage.totalDays) DAYS TOLD")
    }
}

#Preview("Trip cards") {
    let trip = createTripDoc("Australie", "2025-03-01", "2025-05-30")
    let actions = TripCardActions(open: {}, export: {}, delete: {}, move: { _ in }, chooseCover: {})
    return HStack(alignment: .top, spacing: 16) {
        TripCard(trip: trip, isOpen: true, lastOpened: false, remoteOnly: false, moveTargets: [], busy: nil,
                 covers: TripCoverThumbs(), compact: false, actions: actions)
        TripCard(trip: trip, isOpen: false, lastOpened: false, remoteOnly: true, moveTargets: [],
                 busy: "moving to winnow.steeve.website…", covers: TripCoverThumbs(), compact: false, actions: actions)
    }
    .frame(width: 580)
    .padding()
}
