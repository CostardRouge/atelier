// One clip in the DJI Telemetry gallery — `src/tools/telemetry/VideoCard.tsx`:
// its number, its altitude chip, its picture, its name, weight and length, the
// live readout and the summary line, the missing half offered, and the verb
// that opens it.
//
// The card shows the clip's POSTER, not a player: the web's card plays
// inline, but seven AVPlayers in a grid is what its own "never hold 50 URLs
// open" rule was about, and the readout it keeps alive is the opening cue
// either way ("before playback it shows the opening frame, so the card never
// reads as empty"). Playback is the full view's.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct TelemetryClipCard: View {
    let asset: Asset
    let index: Int
    let onOpen: () -> Void
    /// Offer the missing half: a video or a `.srt`.
    let onAdd: (_ video: Bool) -> Void
    let onRemove: () -> Void

    @State private var poster: CGImage?
    @State private var duration: Double?
    @State private var durationRead = false
    private var shelf: InstrumentShelf { .shared }
    private var tracks: TelemetryTracks { .shared }
    @Environment(\.palette) private var palette

    private var title: String { asset.parts.video?.name ?? asset.parts.srt?.name ?? asset.baseName }

    var body: some View {
        let state = tracks.state(for: asset.parts.srt)
        let track = tracks.track(for: asset.parts.srt)
        let liveCue = track?.cues.first

        VStack(alignment: .leading, spacing: 0) {
            media(liveCue: liveCue)
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(Brand.sans(16, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(title)
                if let video = asset.parts.video {
                    HStack(spacing: 8) {
                        Text(formatBytes(video.size))
                        Text("·").foregroundStyle(palette.faint)
                        Text(durationRead ? formatDuration(duration) : "…")
                    }
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
                }
                telemetry(state: state, track: track, liveCue: liveCue)
                Spacer(minLength: 0)
                if asset.parts.video != nil || asset.parts.srt != nil {
                    Button(action: onOpen) {
                        Text(openTitle)
                            .font(Brand.sans(14, weight: .semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(palette.ink)
                    .controlSize(.large)
                }
            }
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 18, trailing: 18))
        }
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
        .contextMenu {
            Button(role: .destructive, action: onRemove) { Label("Remove from the instruments", systemImage: "minus.circle") }
        }
        .task(id: asset.parts.video?.name) { await loadVideoFacts() }
        .task(id: asset.parts.srt?.name) {
            if let ref = asset.parts.srt, let url = shelf.url(for: ref) { await tracks.load(ref, from: url) }
        }
    }

    private var openTitle: String {
        if asset.parts.srt != nil && asset.parts.video != nil { return "Open full view" }
        return asset.parts.srt != nil ? "Open telemetry" : "Open video"
    }

    // MARK: - the picture

    @ViewBuilder
    private func media(liveCue: Cue?) -> some View {
        ZStack {
            if asset.parts.video != nil {
                palette.frame
                if let poster {
                    Image(decorative: poster, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                } else {
                    Text(durationRead && duration == nil ? "Playback unavailable on this device." : "…")
                        .font(Brand.mono(12))
                        .foregroundStyle(palette.muted)
                }
            } else {
                palette.paper2
                VStack(spacing: 12) {
                    Text("No video for this telemetry yet.")
                        .font(Brand.mono(12))
                        .foregroundStyle(palette.muted)
                    Button("Add video") { onAdd(true) }
                        .buttonStyle(.bordered)
                        .tint(palette.accent)
                }
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .overlay(alignment: .topLeading) {
            MediaChip(text: "NO. " + String(format: "%02d", index + 1)).padding(10)
        }
        .overlay(alignment: .topTrailing) {
            if let alt = liveCue?.data["rel_alt"], !alt.isEmpty {
                MediaChip(text: "\(alt) m", dot: true).padding(10)
            }
        }
    }

    // MARK: - the log

    @ViewBuilder
    private func telemetry(state: TelemetryTracks.State?, track: TelemetryTrack?, liveCue: Cue?) -> some View {
        if asset.parts.srt == nil {
            HStack(spacing: 4) {
                Text("No .srt — telemetry unavailable.")
                    .foregroundStyle(palette.muted)
                Button("Add telemetry") { onAdd(false) }
                    .buttonStyle(.plain)
                    .foregroundStyle(palette.accentInk)
                    .underline()
            }
            .font(Brand.sans(14))
        } else if let track, !track.cues.isEmpty {
            LiveTelemetryReadout(cue: liveCue)
            summaryLine(track)
        } else if case .reading? = state {
            Text("Reading telemetry…").font(Brand.sans(14)).foregroundStyle(palette.muted)
        } else if state == nil {
            Text("Reading telemetry…").font(Brand.sans(14)).foregroundStyle(palette.muted)
        } else {
            Text("Telemetry unreadable.").font(Brand.sans(14)).foregroundStyle(palette.muted)
        }
    }

    /// `600 frames · 20–60 m · dlog_m`, and the cadence when the clip is conformed.
    private func summaryLine(_ track: TelemetryTrack) -> some View {
        let s = track.summary
        var parts = ["\(s.cueCount) frames"]
        if let low = s.relAltMin, let high = s.relAltMax {
            parts.append("\(String(format: "%.0f", low))–\(String(format: "%.0f", high)) m")
        }
        if let profile = s.colorProfile { parts.append(profile) }
        if let tag = timeScaleTag(track.reading.scale) { parts.append(tag) }
        return Text(parts.joined(separator: " · "))
            .font(Brand.mono(10))
            .foregroundStyle(palette.muted)
    }

    private func loadVideoFacts() async {
        guard let ref = asset.parts.video, let url = shelf.url(for: ref) else { return }
        async let posterImage = InstrumentClips.poster(url, maxSize: CGSize(width: 640, height: 640))
        async let length = InstrumentClips.duration(url)
        poster = await posterImage
        duration = await length
        durationRead = true
    }
}

#Preview("Clip card") {
    let shelf = InstrumentFixtures.shelf()
    let clip = shelf.usable(InstrumentTool.telemetry.accepts).first!
    return TelemetryClipCard(asset: clip, index: 0, onOpen: {}, onAdd: { _ in }, onRemove: {})
        .frame(width: 340)
        .padding()
}
