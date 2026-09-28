// One day of the trip, opened from the calendar — the web's `DayPanel.tsx`:
// what has already been told from it, and the one gesture that matters here,
// starting another piece.
//
// Rules kept:
// - Starting a piece is ONE tap: each kind is its own button, it makes the
//   piece with the look the trip last gave that kind and OPENS it — a piece
//   left in a list is a stub, and composing it is why it was made. Its name
//   is given in the editor, where you can see what it shows.
// - The whole row opens the piece. A row's own verbs (Duplicate on this day,
//   Mark published / Back to draft, Delete) never open it too; Delete asks
//   first. On a phone they fold behind ⋯, the one menu a phone learns.
// - The hook is drawn at the frame it was composed for — a 9:16 reel narrow,
//   a 4:5 carousel wider — because recognising the SHAPE is what it is for;
//   only the height is fixed so the rows line up, and a piece never opened
//   keeps its row with a placeholder.
// - `card` is the bordered block of a wide screen with the day as its
//   heading; `sheet` is the phone's day sheet body: no frame, no heading (the
//   sheet's title is the day), the leg as a row that opens it.

import SwiftUI
import AtelierKit

struct DayPanelView: View {
    enum Variant { case card, sheet }

    let trip: TripDoc
    let date: IsoDate
    let cell: DayCell?
    let images: [String: CGImage]
    var variant: Variant = .card
    /// Make a piece of this kind from this day, and open it.
    let onStart: (PostKind) -> Void
    let onOpen: (TripPost) -> Void
    let onDuplicate: (TripPost) -> Void
    let onTogglePublished: (TripPost) -> Void
    let onDelete: (TripPost) -> Void
    /// Open the leg the day belongs to (the sheet's leg row).
    var onEditLeg: ((String) -> Void)?

    @Environment(\.palette) private var palette

    private var posts: [TripPost] { cell?.posts ?? [] }
    private var sheet: Bool { variant == .sheet }

    var body: some View {
        let content = VStack(alignment: .leading, spacing: sheet ? 12 : 16) {
            if sheet { legRow } else { heading }
            if sheet && !posts.isEmpty { toldLegend }
            if posts.isEmpty {
                Text("Nothing told from this day yet.")
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.muted)
            } else {
                VStack(spacing: 0) {
                    ForEach(posts, id: \.id) { post in
                        DayPostRow(post: post, image: images[post.id], compact: sheet,
                                   onOpen: { onOpen(post) },
                                   onDuplicate: { onDuplicate(post) },
                                   onTogglePublished: { onTogglePublished(post) },
                                   onDelete: { onDelete(post) })
                    }
                }
            }
            tellThisDay
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Day \(cell?.dayNumber ?? 0)")
        if sheet {
            content
        } else {
            content
                .padding(20)
                .background(RoundedRectangle(cornerRadius: 18).fill(palette.surface))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(palette.line, lineWidth: 1))
        }
    }

    private var heading: some View {
        let stage = stageAt(trip, date)
        let atStage = stage.flatMap { stageDayNumber($0, date) }
        let total = spanLength(trip.startDate, trip.endDate)
        return HStack(alignment: .firstTextBaseline, spacing: 12) {
            HStack(spacing: 0) {
                Text("Day \(cell.map { String($0.dayNumber) } ?? "—")")
                    .foregroundStyle(palette.ink)
                if let total {
                    Text(" / \(total)").foregroundStyle(palette.faint)
                }
            }
            .font(Brand.display(22))
            Text(formatIsoDate(date))
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
            if let stage {
                Text(stageLabel(stage) + (atStage.map { " · day \($0.day)/\($0.total)" } ?? ""))
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.accentInk)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    /// The day's leg as a row that opens it — the day is where "which leg was
    /// I on" is actually asked.
    @ViewBuilder
    private var legRow: some View {
        if let stage = stageAt(trip, date) {
            let index = trip.stages.firstIndex { $0.id == stage.id } ?? 0
            let atStage = stageDayNumber(stage, date)
            let label = stageLabel(stage)
            let tail = (atStage.map { " · day \($0.day)/\($0.total)" } ?? "")
                + " · \(formatIsoDate(stage.startDate)) → \(formatIsoDate(stage.endDate))"
            Button {
                onEditLeg?(stage.id)
            } label: {
                HStack(spacing: 10) {
                    Circle().fill(OverviewLegTint.color(index)).frame(width: 9, height: 9)
                    (Text(label.isEmpty ? "Unnamed stage" : label).foregroundStyle(palette.ink)
                        + Text(tail).foregroundStyle(palette.muted))
                        .font(Brand.sans(14))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if onEditLeg != nil {
                        Text("EDIT ›")
                            .font(Brand.mono(10))
                            .kerning(0.8)
                            .foregroundStyle(palette.accentInk)
                    }
                }
                .padding(.vertical, 8)
                .overlay(alignment: .top) { Hairline() }
                .overlay(alignment: .bottom) { Hairline() }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onEditLeg == nil)
        }
    }

    private var toldLegend: some View {
        let published = posts.filter { $0.publishedAt != nil }.count
        let drafts = posts.count - published
        let tail = " · \(published) published" + (drafts > 0 ? " · \(OverviewWords.count(drafts, "draft"))" : "")
        return HStack(spacing: 0) {
            Eyebrow("Told from this day")
            Text(tail)
                .font(Brand.mono(11))
                .foregroundStyle(palette.faint)
        }
        .padding(.top, 4)
    }

    private var tellThisDay: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow("Tell this day")
                .padding(.top, sheet ? 0 : 12)
            if sheet {
                HStack(spacing: 8) { kindButtons(fill: true) }
                caption
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        kindButtons(fill: false)
                        caption
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) { kindButtons(fill: false) }
                        caption
                    }
                }
            }
        }
        .padding(.top, 4)
    }

    private var caption: some View {
        Text("It opens straight away — name it and dress it there.")
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func kindButtons(fill: Bool) -> some View {
        ForEach(postKinds, id: \.id) { kind in
            Button(kind.label) { onStart(kind.id) }
                .buttonStyle(OverviewInkButtonStyle(fill: fill))
                .help("\(kind.hint) — opens straight away")
        }
    }
}

/// One piece of the day, as a row that opens it.
struct DayPostRow: View {
    let post: TripPost
    let image: CGImage?
    let compact: Bool
    let onOpen: () -> Void
    let onDuplicate: () -> Void
    let onTogglePublished: () -> Void
    let onDelete: () -> Void

    @Environment(\.palette) private var palette
    @State private var confirming = false

    private var published: Bool { post.publishedAt != nil }

    var body: some View {
        HStack(spacing: 12) {
            // The whole row opens the piece — the thumbnail and the title are
            // small targets in a list you sweep through.
            Button(action: onOpen) {
                HStack(spacing: 12) {
                    thumb
                    kindPill
                    titles
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(post.title.isEmpty ? "this piece" : post.title)")
            verbs
        }
        .padding(.vertical, 8)
        .confirmationDialog("Delete this piece?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Keep", role: .cancel) {}
        } message: {
            Text("Its hook thumbnail goes with it. The day stays on the calendar.")
        }
    }

    /// The hook at the frame it was composed for: only the height is fixed.
    private var thumb: some View {
        let height: CGFloat = 48
        let width: CGFloat = image.map { img in
            let ratio = CGFloat(img.width) / CGFloat(max(1, img.height))
            return min(96, max(20, height * ratio))
        } ?? 38
        let border = compact && !published
        return ZStack {
            palette.paper2
            if let image {
                Image(decorative: image, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay {
            RoundedRectangle(cornerRadius: 4)
                .strokeBorder(border ? palette.lineStrong : palette.line,
                              style: StrokeStyle(lineWidth: 1, dash: border ? [3, 2] : []))
        }
        .accessibilityHidden(true)
    }

    private var kindPill: some View {
        Text(OverviewWords.kindLabel(post.kind).uppercased())
            .font(Brand.mono(9))
            .kerning(1)
            .foregroundStyle(published ? palette.accentInk : palette.muted)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(published ? palette.accentWash : Color.clear))
            .overlay(Capsule().strokeBorder(published ? palette.accent : palette.line, lineWidth: 1))
            .fixedSize()
    }

    private var titles: some View {
        VStack(alignment: .leading, spacing: 2) {
            if post.title.isEmpty {
                Text("Untitled")
                    .font(Brand.sans(14))
                    .italic()
                    .foregroundStyle(palette.faint)
            } else {
                Text(post.title)
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
            }
            Text(subtitle)
                .font(Brand.mono(11))
                .foregroundStyle(palette.faint)
                .lineLimit(1)
        }
    }

    private var subtitle: String {
        let state = post.publishedAt.map(OverviewWords.published) ?? "draft"
        guard let media = post.media else { return state }
        return "\(state) · \(media.name)"
    }

    @ViewBuilder
    private var verbs: some View {
        if compact {
            // On a phone the three secondary verbs live behind one glyph.
            Menu {
                Button("Open", action: onOpen)
                Button(published ? "Back to draft" : "Mark published", action: onTogglePublished)
                Button("Duplicate on this day", action: onDuplicate)
                Button("Delete…", role: .destructive) { confirming = true }
            } label: {
                OverviewRoundGlyph(symbol: "ellipsis", lit: false)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("More actions for \(post.title.isEmpty ? "this piece" : post.title)")
        } else {
            HStack(spacing: 6) {
                Button(action: onDuplicate) {
                    OverviewRoundGlyph(symbol: "plus.square.on.square", lit: false)
                }
                .buttonStyle(.plain)
                .help("Duplicate — a copy of this piece on the same day")
                .accessibilityLabel("Duplicate this piece")
                Button(action: onTogglePublished) {
                    OverviewRoundGlyph(symbol: "checkmark", lit: published)
                }
                .buttonStyle(.plain)
                .help(published ? "Back to draft" : "Mark published")
                .accessibilityLabel(published ? "Back to draft" : "Mark published")
                Button {
                    confirming = true
                } label: {
                    OverviewRoundGlyph(symbol: "xmark", lit: false)
                }
                .buttonStyle(.plain)
                .help("Delete this piece")
                .accessibilityLabel("Delete this piece")
                Button("Open", action: onOpen)
                    .buttonStyle(OverviewInkButtonStyle(fill: false))
            }
        }
    }
}

/// A row's secondary verb: a small round glyph, named by its help and label.
struct OverviewRoundGlyph: View {
    let symbol: String
    let lit: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(lit ? palette.accentInk : palette.inkSoft)
            .frame(width: 28, height: 28)
            .background(Circle().fill(lit ? palette.accentWash : palette.paper))
            .overlay(Circle().strokeBorder(lit ? palette.accent : palette.line, lineWidth: 1))
            .contentShape(Circle())
    }
}

/// The ink pill of a primary verb — Tell this day, Open: ink ground, paper
/// words, the accent under the finger. `fill` stretches it to share a row (a
/// phone's sheet, 44 pt tall).
struct OverviewInkButtonStyle: ButtonStyle {
    var fill = false

    func makeBody(configuration: Configuration) -> some View {
        InkBody(configuration: configuration, fill: fill)
    }

    private struct InkBody: View {
        let configuration: ButtonStyleConfiguration
        let fill: Bool
        @Environment(\.palette) private var palette
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let ground = configuration.isPressed ? palette.accent : palette.ink
            configuration.label
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(palette.paper)
                .lineLimit(1)
                .padding(.horizontal, fill ? 8 : 14)
                .frame(maxWidth: fill ? .infinity : nil, minHeight: fill ? 44 : 32)
                .background(Capsule().fill(ground))
                .opacity(isEnabled ? 1 : 0.5)
                .contentShape(Capsule())
        }
    }
}

#Preview("Day panel — card and sheet") {
    let trip = TripOverviewFixtures.trip()
    let coverage = tripCoverage(trip)
    let cell = coverage.days.first { $0.date == "2025-03-02" }
    ScrollView {
        VStack(spacing: 24) {
            DayPanelView(trip: trip, date: "2025-03-02", cell: cell, images: [:], variant: .card,
                         onStart: { _ in }, onOpen: { _ in }, onDuplicate: { _ in },
                         onTogglePublished: { _ in }, onDelete: { _ in })
            DayPanelView(trip: trip, date: "2025-03-02", cell: cell, images: [:], variant: .sheet,
                         onStart: { _ in }, onOpen: { _ in }, onDuplicate: { _ in },
                         onTogglePublished: { _ in }, onDelete: { _ in }, onEditLeg: { _ in })
                .frame(width: 374)
            DayPanelView(trip: trip, date: "2025-03-20", cell: coverage.days[19], images: [:], variant: .card,
                         onStart: { _ in }, onOpen: { _ in }, onDuplicate: { _ in },
                         onTogglePublished: { _ in }, onDelete: { _ in })
        }
        .padding(24)
    }
}
