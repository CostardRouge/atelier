// One clip, full view — `src/tools/telemetry/DetailView.tsx` +
// `TelemetryPlayer.tsx`: the clip playing with its flight log in sync, the
// Flight and Camera panels following the cue under the playhead, the missing
// half offered. Native additions below the panels: the log's summary with its
// cadence said (`measureTimeScale` — a slow-motion clip's speeds are per
// second of CAPTURE, and the page says which it read), a chart of the whole
// flight and every cue in a table, both seeking the clip.

import AVKit
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct TelemetryDetailView: View {
    let assetId: String
    @State private var playback = InstrumentPlayback()
    @State private var files = false
    @State private var photos = false
    @State private var importTypes: [UTType] = [InstrumentFileTypes.srt]
    @State private var showsEveryCue = false
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }
    private var tracks: TelemetryTracks { .shared }

    var body: some View {
        let asset = shelf.assets.first { $0.id == assetId }
        let videoURL = shelf.url(for: asset?.parts.video)
        let srtRef = asset?.parts.srt
        let track = tracks.track(for: srtRef)
        let cues = track?.cues ?? []
        let cue = cueAt(cues, playback.time)

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(asset?.parts.video?.name ?? asset?.parts.srt?.name ?? asset?.baseName ?? "")
                    .font(Brand.display(34))
                    .foregroundStyle(palette.ink)
                    .textSelection(.enabled)

                if asset == nil {
                    InstrumentNotice(text: "This clip is no longer open.")
                } else if asset?.parts.video == nil {
                    InstrumentNotice(text: "No video for this telemetry yet.", action: "Add video") {
                        openFiles(TelemetryToolView.videoTypes)
                    }
                } else if srtRef == nil {
                    InstrumentNotice(text: "No telemetry for this video yet.", action: "Add telemetry (.srt)") {
                        openFiles([InstrumentFileTypes.srt])
                    }
                }

                player(hasVideo: videoURL != nil)

                if let failure = playback.failure {
                    InstrumentNotice(text: "The video failed to play. \(failure) The telemetry below still works if the SRT loaded.")
                }
                // Said once the log is READ: an empty one is the web's
                // notice, an unreadable one says so; while it is being
                // read, nothing.
                if videoURL != nil, cues.isEmpty, let srtRef {
                    switch tracks.state(for: srtRef) {
                    case .unreadable?:
                        InstrumentNotice(text: "Telemetry unreadable.")
                    case .ready?:
                        InstrumentNotice(text: "No telemetry loaded yet — select the matching .srt file.")
                    default:
                        EmptyView()
                    }
                }

                if let track { summary(track) }

                TelemetryPanels(cue: cue)

                if let track, !track.cues.isEmpty {
                    TelemetryChart(cues: track.cues, time: playback.time) { playback.seek(to: $0) }
                    DisclosureGroup(isExpanded: $showsEveryCue) {
                        TelemetryCueTable(rows: telemetryRows(track.cues)) { playback.seek(to: $0) }
                            .padding(.top, 8)
                    } label: {
                        Text("Every cue (\(track.cues.count))")
                            .font(Brand.sans(14, weight: .semibold))
                            .foregroundStyle(palette.ink)
                    }
                    .tint(palette.accent)
                }
            }
            .padding(16)
        }
        .background(palette.paper)
        .navigationTitle(asset?.baseName ?? InstrumentTool.telemetry.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: videoURL) { playback.load(videoURL) }
        .task(id: srtRef?.name) {
            if let srtRef, let url = shelf.url(for: srtRef) { await tracks.load(srtRef, from: url) }
        }
        .onDisappear { playback.pause() }
        .instrumentImporters(files: $files, photos: $photos, types: importTypes, photoFilter: .videos)
        .instrumentProblemAlert()
    }

    @ViewBuilder
    private func player(hasVideo: Bool) -> some View {
        if hasVideo {
            VideoPlayer(player: playback.player)
                .aspectRatio(16 / 9, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: 520)
                .background(palette.frame)
                .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        } else {
            Text("Select a video file to begin.")
                .font(Brand.mono(13))
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity)
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
        }
    }

    /// What the log is, in one line: its frames, its altitudes, its colour
    /// profile, where it starts, and its cadence when the clip is conformed.
    private func summary(_ track: TelemetryTrack) -> some View {
        let s = track.summary
        var parts = ["\(s.cueCount) frames"]
        if let low = s.relAltMin, let high = s.relAltMax {
            parts.append("\(String(format: "%.0f", low))–\(String(format: "%.0f", high)) m")
        }
        if let profile = s.colorProfile { parts.append(profile) }
        if let lat = s.startLatitude, let lon = s.startLongitude { parts.append("from \(lat), \(lon)") }
        return VStack(alignment: .leading, spacing: 4) {
            Text(parts.joined(separator: " · "))
            if let cadence = track.cadenceLine {
                Text("\(cadence) — speeds read per second of capture")
                    .foregroundStyle(palette.accentInk)
            }
        }
        .font(Brand.mono(12))
        .foregroundStyle(palette.muted)
        .textSelection(.enabled)
    }

    private func openFiles(_ types: [UTType]) {
        importTypes = types
        files = true
    }
}

#Preview("Full view") {
    InstrumentFixtures.shelf()
    return NavigationStack { TelemetryDetailView(assetId: "dji_0001") }
}
