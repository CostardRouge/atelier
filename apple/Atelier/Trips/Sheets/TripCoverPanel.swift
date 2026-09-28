// Choosing what a trip shows of itself in the gallery — the web's
// `CoverPanel.tsx`: the LAYOUT, and the pieces PINNED to it.
//
// A controlled panel rather than a screen, because it has two homes and
// neither can be the only one: the trip's dates sheet (`TripDetailsSheet`),
// where the trip's own properties are edited, and the gallery card's
// "Choose a cover…" (`TripCoverSheet`), where a cover is looked at. One panel,
// so the two can never drift.
//
// Rules kept:
// - every thumbnail of the trip is read here, not the handful a card needs —
//   the point of the panel is to see the pieces and pick among them;
// - the previews are resolved at the WIDEST layout, never the selected one:
//   asking for the chosen layout's count made the Mosaic preview lose its two
//   side pictures while Cover was picked, so the layout being compared drew as
//   an emptier thing than it is. `coverTiles` answers a narrower layout with a
//   prefix of a wider one, so Cover still shows exactly its picture;
// - a preview with nothing to draw shows bare SLOTS, which is what the card
//   would do — never an invented arrangement, never a flat fill; the Rhythm
//   preview is the trip's real weeks folded onto ten bars;
// - a pin naming a piece that is gone is SAID (`droppedPins`) and forgotten
//   only when the sheet is saved (`prunePins`, the caller's), so the note is
//   read before it disappears.

import SwiftUI
import AtelierKit

struct TripCoverPanel: View {
    let trip: TripDoc
    @Binding var cover: TripCover
    /// Where the hooks are kept, and the store's version of them.
    let thumbs: TripThumbs
    let version: Int

    @Environment(\.palette) private var palette
    @State private var pictures = TripCoverThumbs()

    /// The web's `LAYOUTS`, word for word.
    private struct LayoutOption {
        let id: CoverLayout
        let label: String
        let needs: String
        let note: String
    }

    private static let layouts: [LayoutOption] = [
        LayoutOption(id: .mosaic, label: "Mosaic", needs: "3 pictures",
                     note: "Three pieces, so the trip reads as a place."),
        LayoutOption(id: .cover, label: "Cover", needs: "1 picture", note: "One picture, filling the card."),
        LayoutOption(id: .rhythm, label: "Rhythm", needs: "your days", note: "No picture: the trip’s own weeks."),
        LayoutOption(id: .none, label: "None", needs: "no cover", note: "The compact card, for a screen full of trips."),
    ]

    var body: some View {
        let shown = shownTrip
        let coverage = tripCoverage(shown)
        let widest = coverTileCount(.mosaic)
        let tiles = coverTiles(shown, coverage, { pictures.has($0) }, limit: widest)
        let previewImages = tiles.map { pictures.image($0.postId) }
        let choices = pinChoices
        let dropped = droppedPins(shown)
        VStack(alignment: .leading, spacing: 16) {
            layoutSection(previewImages)
            if coverTileCount(cover.layout) > 0 && !choices.isEmpty {
                pinsSection(choices)
            }
            if !dropped.isEmpty {
                droppedNote(dropped.count)
            }
        }
        .task(id: loadKey) {
            await pictures.load(trip.posts.map(\.id), from: thumbs, version: version)
        }
    }

    /// The trip as it would show with the cover being chosen.
    private var shownTrip: TripDoc {
        var doc = trip
        doc.cover = cover
        return doc
    }

    private var loadKey: String {
        "\(version)|" + trip.posts.map(\.id).joined(separator: ",")
    }

    /// Every piece that has a picture here, in the order the trip was lived.
    private var pinChoices: [TripPost] {
        let drawable = trip.posts.filter { pictures.has($0.id) }
        // A stable sort by date — the web's `slice().sort` on the day alone.
        let indexed = Array(drawable.enumerated())
        let sorted = indexed.sorted { a, b in
            if a.element.date != b.element.date { return a.element.date < b.element.date }
            return a.offset < b.offset
        }
        return sorted.map(\.element)
    }

    // MARK: - the layout

    private func layoutSection(_ images: [CGImage?]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow("Layout")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(TripCoverPanel.layouts, id: \.id) { option in
                    layoutTile(option, images: images)
                }
            }
            if pictures.images.isEmpty {
                Text("No piece of this trip has a picture on this device yet, so Mosaic and Cover have nothing to draw — the card falls back to the trip’s rhythm until one does. A piece bakes its picture the first time you open it in the editor.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func layoutTile(_ option: LayoutOption, images: [CGImage?]) -> some View {
        let on = cover.layout == option.id
        let shape = RoundedRectangle(cornerRadius: Brand.controlRadius)
        return Button {
            cover.layout = option.id
        } label: {
            VStack(spacing: 0) {
                TripCoverLayoutPreview(layout: option.id, trip: trip, images: images)
                    .frame(maxWidth: .infinity)
                    .frame(height: 60)
                    .clipped()
                VStack(alignment: .leading, spacing: 1) {
                    Text(option.label)
                        .font(Brand.sans(12, weight: .semibold))
                        .foregroundStyle(on ? palette.accentInk : palette.inkSoft)
                    Text(option.needs.uppercased())
                        .font(Brand.mono(9))
                        .kerning(0.5)
                        .foregroundStyle(palette.faint)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .overlay(alignment: .top) { Hairline() }
            }
            .background(palette.paper)
            .clipShape(shape)
            .overlay(shape.stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .help(option.note)
        .accessibilityLabel("\(option.label), \(option.needs)")
        .accessibilityHint(option.note)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - the pins

    private func pinsSection(_ choices: [TripPost]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Eyebrow("Pinned pieces")
                Spacer(minLength: 0)
                if !cover.pinned.isEmpty {
                    Button("Clear pins") { cover.pinned = [] }
                        .buttonStyle(.plain)
                        .font(Brand.sans(12))
                        .underline()
                        .foregroundStyle(palette.muted)
                }
            }
            Text("Pin up to three. Whatever you leave unpinned fills from the trip’s busiest days — clear them all and the cover follows the trip on its own.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.inkSoft)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 62, maximum: 62), spacing: 8)],
                          alignment: .leading, spacing: 8) {
                    ForEach(choices, id: \.id) { post in
                        pinButton(post)
                    }
                }
                .padding(2)
            }
            .frame(maxHeight: 208)
        }
    }

    private func pinButton(_ post: TripPost) -> some View {
        let rank = cover.pinned.firstIndex(of: post.id)
        let day = dayNumberOf(trip, post.date)
        let shape = RoundedRectangle(cornerRadius: 10)
        let title = post.title.isEmpty ? "piece" : post.title
        let help = day.map { "Day \($0) — \(title)" } ?? post.date
        return Button {
            cover.pinned = togglePin(cover.pinned, post.id)
        } label: {
            ZStack {
                if let image = pictures.image(post.id) {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 62, height: 82)
                        .clipped()
                } else {
                    palette.paper2
                }
                if let rank {
                    Text("\(rank + 1)")
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.onMedia)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(palette.accent))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(4)
                }
                if let day {
                    Text("\(day)")
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.onMedia)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 1)
                        .background(palette.frame.opacity(0.45))
                        .frame(maxHeight: .infinity, alignment: .bottom)
                }
            }
            .frame(width: 62, height: 82)
            .clipShape(shape)
            .overlay(shape.stroke(rank != nil ? palette.accent : palette.line, lineWidth: rank != nil ? 1.5 : 1))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(help)
        .accessibilityValue(rank.map { "pinned \($0 + 1)" } ?? "not pinned")
        .accessibilityAddTraits(rank != nil ? .isSelected : [])
    }

    // MARK: - the pins that point at nothing

    private func droppedNote(_ count: Int) -> some View {
        let head = count == 1 ? "One pin points at nothing." : "\(count) pins point at nothing."
        let rest = count == 1
            ? "The piece it named is gone, so the cover takes the next busiest day instead. Saving forgets it."
            : "The pieces they named are gone, so the cover takes the next busiest day instead. Saving forgets them."
        return (Text(head).font(Brand.sans(12, weight: .semibold)).foregroundStyle(palette.accentInk)
            + Text(" " + rest).font(Brand.sans(12)).foregroundStyle(palette.inkSoft))
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.danger.opacity(0.35), lineWidth: 1))
    }
}

/// A layout drawn with the pictures it would really use — the web's
/// `LayoutPreview`. `images` are the widest resolution's tiles, in order.
struct TripCoverLayoutPreview: View {
    let layout: CoverLayout
    let trip: TripDoc
    let images: [CGImage?]
    @Environment(\.palette) private var palette

    var body: some View {
        switch layout {
        case .mosaic:
            GeometryReader { geo in
                let lead = (geo.size.width - 2) * 1.7 / 2.7
                HStack(spacing: 2) {
                    tile(0).frame(width: lead)
                    VStack(spacing: 2) {
                        tile(1)
                        tile(2)
                    }
                }
            }
        case .cover:
            tile(0)
        case .rhythm:
            rhythm
        case .none:
            // The compact card's own three lines: a name, a date, a figure.
            GeometryReader { geo in
                VStack(alignment: .leading, spacing: 6) {
                    Capsule().fill(palette.lineStrong).frame(width: geo.size.width * 0.56, height: 6)
                    Capsule().fill(palette.line).frame(width: geo.size.width * 0.78, height: 4)
                    Capsule().fill(palette.line).frame(width: geo.size.width * 0.40, height: 4)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .background(palette.surface)
        }
    }

    /// The trip's real weeks, folded onto ten bars — a made-up pattern here
    /// would be the fabricated example the tool refuses everywhere else.
    private var rhythm: some View {
        let bars = rhythmBuckets(tripCoverage(trip), max: 10)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(bars, id: \.from) { bar in
                let level = rhythmLevel(bar)
                RoundedRectangle(cornerRadius: 2)
                    .fill(palette.heatmapLevel(level))
                    .frame(height: 6 + Double(level) / 4 * 38)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .padding(8)
        .background(palette.surface)
    }

    @ViewBuilder
    private func tile(_ index: Int) -> some View {
        if index < images.count, let image = images[index] {
            Image(decorative: image, scale: 1)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
        } else {
            // A bare SLOT: what the card itself would draw with no picture.
            Image(systemName: "photo")
                .font(.system(size: 13))
                .foregroundStyle(palette.faint)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.paper2)
                .overlay(Rectangle().stroke(palette.line, lineWidth: 1))
        }
    }
}

/// The panel over a fixture trip with no thumbnail on this device: the slots,
/// the real rhythm, and the sentence that says why Mosaic draws nothing.
private struct TripCoverPanelPreview: View {
    @State private var cover = TripCover(layout: .rhythm, pinned: ["gone"])
    private let trip = createTripDoc("Australie", "2025-03-01", "2025-05-30")

    var body: some View {
        ScrollView {
            TripCoverPanel(trip: trip, cover: $cover,
                           thumbs: TripThumbs(root: FileManager.default.temporaryDirectory
                               .appendingPathComponent("atelier-preview")),
                           version: 0)
                .padding(24)
        }
    }
}

#Preview("Cover panel") {
    TripCoverPanelPreview()
        .frame(width: 520, height: 560)
}
