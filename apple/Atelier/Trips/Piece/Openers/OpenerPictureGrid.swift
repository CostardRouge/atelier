// The chooser's grid, its tiles and its lightbox — the `groups` / `Tile` /
// `Look` half of the web's `HookPicturesModal.tsx`.
//
// - One scrolling grid in DAY groups: "Day 12" and the date (or the date
//   alone for a day the trip does not hold), how many of the day are ticked,
//   the day's own all / none, and "after this piece’s day — left off" where
//   the opener will not use it.
// - Tiles on PIXEL rows (112 points, 108 on a phone), never a share of
//   anything (`frontend.md`, «A scrolling tile grid pins its ROWS»).
// - A tile's whole face ticks and unticks it; the corner ⤢ looks at it large;
//   its caption names the file — "◇" for the instance's, "left off ·" for
//   one the opener will not use. An instance's tile is its thumbnail
//   (`WinnowThumbView`), a Library tile its cover, read when it shows.
// - Looking at one is the ONE lightbox (`MediaLightbox`): the Library's file
//   or the instance's proxy, the tick in its footer, Return ticks.

import SwiftUI
import AtelierKit

struct OpenerPictureGrid: View {
    let chooser: OpenerPicturesModel
    let compact: Bool
    @Environment(\.palette) private var palette

    private var tileSide: CGFloat { compact ? 96 : 112 }
    private var rowHeight: CGFloat { compact ? 108 : 112 }

    var body: some View {
        let groups = chooser.groups
        ScrollView {
            if groups.isEmpty {
                empty.frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(groups, id: \.date) { group in
                        day(group)
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var empty: some View {
        let c = chooser
        let from = c.span.map { formatIsoDate($0.from) } ?? "—"
        let to = c.span.map { formatIsoDate($0.to) } ?? "—"
        var text = c.loading ? "Looking…" : "Nothing shot between \(from) and \(to) in \(c.whereWords)."
        if !c.loading { text += " Widen the days above, or add pictures from \(OpenerWords.device)." }
        if c.connection == nil && !c.loading { text += " Connecting a Winnow on Sources also shows what it holds for these days." }
        return Text(verbatim: text)
            .font(Brand.sans(13))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func day(_ group: PoolDayGroup<OpenerCandidate>) -> some View {
        let keys = group.items.map(\.id)
        let on = keys.filter { chooser.isOn($0) }.count
        let allOn = on == keys.count
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: group.day.map { "Day \($0.dayNumber)" } ?? formatIsoDate(group.date))
                    .font(Brand.sans(13, weight: .semibold))
                    .foregroundStyle(palette.ink)
                if group.day != nil {
                    Text(verbatim: formatIsoDate(group.date)).font(Brand.sans(12)).foregroundStyle(palette.muted)
                }
                Text(verbatim: "\(on)/\(keys.count)").font(Brand.sans(12)).foregroundStyle(palette.faint)
                Button(allOn ? "NONE" : "ALL") { chooser.toggle(keys, on: !allOn) }
                    .font(Brand.mono(9))
                    .kerning(1)
                    .buttonStyle(.plain)
                    .foregroundStyle(palette.muted)
                if chooser.leftOff(group.date) {
                    Text(verbatim: "after this piece’s day — left off").font(Brand.sans(12)).foregroundStyle(palette.accentInk)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: tileSide), spacing: 6)], spacing: 6) {
                ForEach(group.items) { candidate in
                    tile(candidate).frame(height: rowHeight)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(formatIsoDate(group.date))
    }

    private func tile(_ candidate: OpenerCandidate) -> some View {
        let key = candidate.id
        return OpenerPictureTile(candidate: candidate, on: chooser.isOn(key), leftOff: chooser.leftOff(candidate.candidate.date),
                                 client: chooser.client, library: chooser.library, compact: compact,
                                 onToggle: { chooser.toggle([key], on: !chooser.isOn(key)) },
                                 onLook: { chooser.looking = chooser.pool.firstIndex { $0.id == key } })
    }
}

/// One picture on offer: the whole tile ticks and unticks it, the corner
/// looks at it large.
private struct OpenerPictureTile: View {
    let candidate: OpenerCandidate
    let on: Bool
    /// Shot after the piece's day, for an opener that will not use it.
    let leftOff: Bool
    let client: WinnowClient?
    let library: LibraryStore
    let compact: Bool
    let onToggle: () -> Void
    let onLook: () -> Void
    @Environment(\.palette) private var palette

    private var name: String { candidate.candidate.ref.name }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Button(action: onToggle) {
                thumb
                    .opacity(on ? 1 : 0.45)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(on ? "Leave out" : "Take") \(name)")
            .accessibilityAddTraits(on ? .isSelected : [])
            tick
            look
            caption
        }
        .background(palette.frame)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(on ? palette.accent : palette.line, lineWidth: on ? 2 : 1))
    }

    @ViewBuilder
    private var thumb: some View {
        switch candidate.source {
        case .instance(let row, _):
            if let client {
                WinnowThumbView(client: client, id: row.id, label: "photo")
            } else {
                placeholder
            }
        case .library(let assetId, _, _):
            if let image = library.covers[assetId]?.thumbnail {
                Image(decorative: image, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder.onAppear { library.ensureCover(assetId) }
            }
        }
    }

    private var placeholder: some View {
        Text(verbatim: "PHOTO")
            .font(Brand.mono(9))
            .foregroundStyle(palette.onMedia.opacity(0.6))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var tick: some View {
        Text(verbatim: "✓")
            .font(Brand.sans(11, weight: .bold))
            .foregroundStyle(on ? palette.onMedia : Color.clear)
            .frame(width: 18, height: 18)
            .background(RoundedRectangle(cornerRadius: 4).fill(on ? palette.accent : palette.frame.opacity(0.35)))
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(on ? palette.accent : palette.onMedia.opacity(0.7), lineWidth: 1))
            .padding(6)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var look: some View {
        Button(action: onLook) {
            Text(verbatim: "⤢")
                .font(Brand.sans(12))
                .foregroundStyle(palette.onMedia)
                .frame(width: compact ? 32 : 24, height: compact ? 32 : 24)
                .background(RoundedRectangle(cornerRadius: 5).fill(palette.frame.opacity(0.6)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(4)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityLabel("Look at \(name)")
    }

    private var caption: some View {
        let origin: String
        if leftOff {
            origin = "left off · "
        } else if case .instance = candidate.source {
            origin = "◇ "
        } else {
            origin = ""
        }
        return Text(verbatim: "\(origin)\(name)")
            .font(Brand.mono(9))
            .foregroundStyle(palette.onMedia)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.frame.opacity(0.62))
            .frame(maxHeight: .infinity, alignment: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The pool, large, one at a time — the tick in the footer, Return ticks.
struct OpenerPictureLook: View {
    let chooser: OpenerPicturesModel
    @Environment(\.palette) private var palette

    var body: some View {
        let pool = chooser.pool
        let index = Binding<Int>(get: { chooser.looking ?? 0 }, set: { chooser.looking = $0 })
        let from = chooser.connection.map { "from the Library and \($0.id)" } ?? "from the Library"
        MediaLightbox(items: pool.map(item), index: index, from: from, client: chooser.client,
                      onConfirm: toggleOpen, onClose: { chooser.looking = nil }) {
            footer
        }
    }

    private var open: OpenerCandidate? {
        guard let at = chooser.looking, chooser.pool.indices.contains(at) else { return nil }
        return chooser.pool[at]
    }

    @ViewBuilder
    private var footer: some View {
        if let open {
            let on = chooser.isOn(open.id)
            Button(on ? "✓ Taken — leave it out" : "Take this picture", action: toggleOpen)
                .buttonStyle(StagesButtonStyle(kind: on ? .plain : .primary, small: true))
        }
    }

    private func toggleOpen() {
        guard let open else { return }
        chooser.toggle([open.id], on: !chooser.isOn(open.id))
    }

    private func item(_ c: OpenerCandidate) -> LightboxItem {
        var item = LightboxItem(id: c.id, title: c.candidate.ref.name, facts: formatIsoDate(c.candidate.date))
        switch c.source {
        case .library(let assetId, let location, _):
            item.source = location.map { LightboxSource.local($0, raw: false) }
            if let cover = chooser.library.covers[assetId]?.thumbnail {
                item.still = .pixels(LightboxPixels(id: "cover:\(assetId)", image: cover))
            }
            if location == nil { item.unavailable = "This device no longer reaches the file." }
        case .instance(let row, let host):
            if let client = chooser.client {
                item.source = .remote(client.proxyUrl(row.id))
                item.still = .remote(client.thumbUrl(row.id))
            }
            item.taskScope = "\(host)/\(row.id)"
            if let w = row.width, let h = row.height, w > 0, h > 0 { item.natural = CGSize(width: w, height: h) }
        }
        return item
    }
}
