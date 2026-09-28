// The open day, as one strip above the phone's bottom bar — the web's
// `DayStrip.tsx` (`docs/roadtrip-overview-mobile.md` §8.2).
//
// Rules kept:
// - Always there on a phone, never scrolling: a tap on a calendar cell
//   SELECTS the day and this is what changes, so sweeping the calendar never
//   opens a sheet over the thing being swept. The strip is what pulls the
//   day up.
// - A PREVIEW: the date, the leg (its tint as a dot) or "nothing told yet",
//   and the day's pieces as their own hook thumbnails at their own frame —
//   published on a solid accent line, drafts dashed — three at most, then
//   `+N`, the count and ›. The sheet is the list.
// - A day nothing came out of carries the verb instead, `+ Tell it`: telling
//   a day is the tool's commonest gesture, and making it cost a scroll would
//   be the wrong economy.
// - It is the sheet folded: the same top corners, border and grab hint.

import SwiftUI
import AtelierKit

struct DayStripView: View {
    let date: IsoDate
    let cell: DayCell?
    let stage: OverviewDayStage?
    let images: [String: CGImage]
    /// Pull the day up — the sheet with its pieces and its verbs.
    let onOpen: () -> Void

    @Environment(\.palette) private var palette

    private static let shown = 3

    private var posts: [TripPost] { cell?.posts ?? [] }

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onOpen) {
                HStack(spacing: 10) {
                    words
                    Spacer(minLength: 4)
                    if !posts.isEmpty { pictures }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(openLabel)
            if posts.isEmpty {
                Button("+ Tell it", action: onOpen)
                    .buttonStyle(OverviewInkButtonStyle(fill: false))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(alignment: .top) { ground }
    }

    private var ground: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18)
        return ZStack(alignment: .top) {
            shape.fill(palette.surface)
            shape.stroke(palette.lineStrong, lineWidth: 1)
            // The grab hint, centred like the sheet's own handle.
            Capsule()
                .fill(palette.lineStrong)
                .frame(width: 28, height: 3)
                .padding(.top, 6)
        }
        .shadow(color: Color.black.opacity(0.12), radius: 10, y: -6)
        .accessibilityHidden(true)
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text(OverviewWords.weekdayDate(date)).font(Brand.sans(14, weight: .semibold)).foregroundStyle(palette.ink)
                + Text(" · day \(cell.map { String($0.dayNumber) } ?? "—")").font(Brand.sans(14)).foregroundStyle(palette.muted))
                .lineLimit(1)
            HStack(spacing: 6) {
                if let stage {
                    Circle().fill(OverviewLegTint.color(stage.index)).frame(width: 7, height: 7)
                }
                Text(line)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
        }
    }

    /// The leg's line, "nothing told yet" for an empty day no leg covers.
    private var line: String {
        if let stage { return stage.line }
        return posts.isEmpty ? "nothing told yet" : ""
    }

    private var openLabel: String {
        let what = posts.isEmpty ? "nothing told yet" : OverviewWords.count(posts.count, "piece")
        return "Open \(OverviewWords.weekdayDate(date)) — \(what)"
    }

    private var pictures: some View {
        let shown = Array(posts.prefix(Self.shown))
        let rest = posts.count - shown.count
        return HStack(spacing: 4) {
            ForEach(shown, id: \.id) { post in
                hook(post)
            }
            if rest > 0 {
                Text("+\(rest)")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.inkSoft)
                    .padding(.horizontal, 6)
                    .frame(height: 34)
                    .background(RoundedRectangle(cornerRadius: 3).fill(palette.paper2))
            }
            Text("\(posts.count)")
                .font(Brand.mono(12))
                .foregroundStyle(palette.inkSoft)
                .padding(.leading, 2)
            Text("›")
                .font(Brand.sans(14))
                .foregroundStyle(palette.faint)
        }
        .accessibilityHidden(true)
    }

    private func hook(_ post: TripPost) -> some View {
        let published = post.publishedAt != nil
        let image = images[post.id]
        let height: CGFloat = 34
        let width: CGFloat = image.map { img in
            let ratio = CGFloat(img.width) / CGFloat(max(1, img.height))
            return min(40, max(14, height * ratio))
        } ?? 20
        let shape = RoundedRectangle(cornerRadius: 3)
        return ZStack {
            palette.paper2
            if let image {
                Image(decorative: image, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: width, height: height)
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(published ? palette.accentInk : palette.lineStrong,
                               style: StrokeStyle(lineWidth: 1, dash: published ? [] : [3, 2]))
        }
    }
}

#Preview("Day strip") {
    let trip = TripOverviewFixtures.trip()
    let coverage = tripCoverage(trip)
    VStack(spacing: 0) {
        Spacer()
        DayStripView(date: "2025-03-02", cell: coverage.days[1],
                     stage: OverviewDayStage(label: "Perth → Kalbarri", index: 0, day: 2, total: 5),
                     images: [:], onOpen: {})
        Divider()
        DayStripView(date: "2025-03-20", cell: coverage.days[19], stage: nil, images: [:], onOpen: {})
    }
    .frame(width: 390, height: 300)
}
