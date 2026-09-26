// Flight Map — `src/tools/map/MapTool.tsx`: a DJI clip's GPS path, drawn with
// no map under it until the person asks for one, and the clip beneath —
// scrubbing it walks the aircraft along the path. The live fix, its altitude,
// speed and heading sit in the stage's corner.
//
// The path is read from the `.srt` alone (`FlightPath.swift`'s
// `extractTrack`), so a loose `.srt` maps too; the aircraft sits on the live
// cue's fix, or on the path's start while the clip has none, so it is never
// orphaned. The map background is the opt-in (`BaseMapConsent`).

import AVKit
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct FlightMapToolView: View {
    @State private var playback = InstrumentPlayback()
    @State private var tilesOn = false
    @State private var files = false
    @State private var photos = false
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    private var shelf: InstrumentShelf { .shared }
    private var tracks: TelemetryTracks { .shared }

    var body: some View {
        let clips = shelf.usable(InstrumentTool.map.accepts)
        let active = shelf.active(in: clips)
        let videoURL = shelf.url(for: active?.parts.video)
        let flight = tracks.track(for: active?.parts.srt)
        let cues = flight?.cues ?? []
        let track = flight?.track ?? []
        let cue = cueAt(cues, playback.time)
        let position = cue.flatMap(parsePosition) ?? track.first.map { LonLat(lon: $0.lon, lat: $0.lat) }

        VStack(spacing: 10) {
            InstrumentBar {
                if clips.isEmpty {
                    Text("Open a DJI clip (or a loose .srt) to map its flight.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                } else {
                    HStack(spacing: 10) {
                        if clips.count > 1 {
                            ClipStepper(ids: clips.map(\.id), activeId: active?.id) { shelf.activeId = $0 }
                        }
                        Text(active?.baseName ?? "")
                            .font(Brand.sans(14, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 8)
                        BaseMapConsent(on: $tilesOn)
                    }
                }
            }

            stage(clips: clips, flight: flight, track: track, position: position, cue: cue)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .frame(minHeight: 280)

            if let active {
                if videoURL != nil {
                    VideoPlayer(player: playback.player)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .frame(maxHeight: 260)
                        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
                } else if active.parts.video == nil {
                    Text("Telemetry only — add this clip's video to scrub along the path.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
                }
            }
        }
        .padding(16)
        .background(palette.paper)
        .navigationTitle(InstrumentTool.map.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                InstrumentOpenMenu(title: "Open footage", onPhotos: { photos = true }, onFiles: { files = true })
            }
        }
        .task(id: videoURL) { playback.load(videoURL) }
        .task(id: active?.parts.srt?.name) {
            if let ref = active?.parts.srt, let url = shelf.url(for: ref) { await tracks.load(ref, from: url) }
        }
        .onChange(of: active?.id) { _, id in
            // Reflect the effective active clip back, so every instrument agrees.
            if let id, id != shelf.activeId { shelf.activeId = id }
        }
        .onDisappear { playback.pause() }
        .instrumentImporters(files: $files, photos: $photos, types: InstrumentFileTypes.footage, photoFilter: .videos)
        .instrumentProblemAlert()
    }

    @ViewBuilder
    private func stage(clips: [Asset], flight: TelemetryTrack?, track: [TrackPoint], position: LonLat?, cue: Cue?) -> some View {
        ZStack {
            if tilesOn {
                FlightBaseMap(track: track, position: position)
            } else {
                FlightTrackCanvas(track: track, position: position)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
        .overlay {
            if !clips.isEmpty, flight != nil, track.isEmpty {
                MediaChip(text: "No GPS fixes in this clip's telemetry.")
            }
        }
        .overlay(alignment: .topLeading) {
            if !tilesOn, !clips.isEmpty { OfflineMapBadge().padding(10) }
        }
        .overlay(alignment: .bottomLeading) {
            if let position, !track.isEmpty { readout(position: position, cue: cue).padding(10) }
        }
    }

    /// The live fix, bottom-left: six decimals, then the altitude and the motion.
    private func readout(position: LonLat, cue: Cue?) -> some View {
        let motion = motionAt(cue)
        let moving = [formatGroundSpeed(motion.groundSpeed), formatHeading(motion.heading)].compactMap { $0 }
        let alt = cue?.data["rel_alt"].map { "\($0) m" } ?? "—"
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(String(format: "%.6f", position.lat)), \(String(format: "%.6f", position.lon))")
                .monospacedDigit()
            Text(([alt] + moving).joined(separator: "  ·  "))
                .foregroundStyle(palette.onMedia.opacity(0.85))
        }
        .font(Brand.mono(10))
        .foregroundStyle(palette.onMedia)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
        .allowsHitTesting(false)
    }
}

#Preview("Flight map") {
    InstrumentFixtures.shelf()
    return NavigationStack { FlightMapToolView() }
}
