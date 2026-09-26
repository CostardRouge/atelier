// Composer — `src/tools/composer/ComposerTool.tsx`: a DJI clip, its flight
// map and a draggable telemetry readout composed into one frame — the
// aspect, the layout, a look, the card — previewed live and rendered to an
// MP4 (and, natively, the frame under the playhead to a PNG).
//
// The map is the flight path on the blank paper, as the Flight Map's is by
// default. The web's Composer can lay OpenStreetMap tiles under it (and, a
// divergence from the suite's rule recorded in PARITY.md, starts with them
// ON); MapKit tiles are not in the native Composer yet, and the map pane
// says it is offline.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct ComposerToolView: View {
    @State private var model = ComposerModel()
    @State private var files = false
    @State private var photos = false
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }

    var body: some View {
        let clips = shelf.usable(InstrumentTool.composer.accepts)
        let active = shelf.active(in: clips)
        let out = model.settings.out
        let key = ComposerRenderKey(settings: model.settings, grade: model.look.grade,
                                    cues: model.telemetry?.cues.count ?? -1)

        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                InstrumentBar {
                    if clips.isEmpty {
                        Text("Open a DJI clip (video + .srt) to compose.")
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
                            Text("\(Int(out.width))×\(Int(out.height))")
                                .font(Brand.mono(10))
                                .foregroundStyle(palette.muted)
                            Spacer(minLength: 0)
                        }
                    }
                }

                if clips.isEmpty {
                    InstrumentEmpty(text: "The Composer takes a DJI clip together with its .srt — open both and they pair by name.") {
                        Button("From Files…") { files = true }
                            .buttonStyle(.borderedProminent)
                            .tint(palette.accent)
                    }
                }

                if active != nil {
                    ComposerControls(model: model)
                    ComposerPreview(model: model)
                        .frame(maxWidth: .infinity)
                        .frame(height: 460)
                    if let failure = model.playback.failure {
                        InstrumentNotice(text: "\(failure) The composition needs the clip's frames.")
                    }
                    if let error = model.look.cubeError {
                        InstrumentNotice(text: error)
                    }
                    ComposerExportRow(model: model)
                    if let error = model.exportError {
                        InstrumentNotice(text: error)
                    }
                }
            }
            .padding(16)
        }
        .background(palette.paper)
        .navigationTitle(InstrumentTool.composer.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                InstrumentOpenMenu(title: "Open footage", onPhotos: { photos = true }, onFiles: { files = true })
            }
        }
        .task(id: active?.id) { await model.open(active, shelf: shelf) }
        .task(id: active?.parts.srt?.name) {
            if let ref = active?.parts.srt, let url = shelf.url(for: ref) {
                await TelemetryTracks.shared.load(ref, from: url)
            }
        }
        .task(id: model.clipURL) {
            // The clip's frames, read as they come — about sixty looks a second.
            guard model.clipURL != nil else { return }
            while !Task.isCancelled {
                model.pullFrame()
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
        .onChange(of: key) { _, _ in model.rerender() }
        .onChange(of: active?.id) { _, id in
            if let id, id != shelf.activeId { shelf.activeId = id }
        }
        .onDisappear { model.playback.pause() }
        .instrumentImporters(files: $files, photos: $photos, types: InstrumentFileTypes.footage, photoFilter: .videos)
        .instrumentProblemAlert()
    }
}

/// What re-composes the stage besides a new frame.
struct ComposerRenderKey: Equatable {
    let settings: ComposerSettings
    let grade: LookGrade?
    /// The log's length once read (-1 before): a map and a card appear.
    /// (The playhead moves the cue and the aircraft through the frames
    /// themselves: each new one re-composes with the cue under it.)
    let cues: Int
}

/// The live composite, fitted, with the card draggable — the web's canvas
/// and its pointer handlers ("Drag the telemetry readout to reposition it").
struct ComposerPreview: View {
    let model: ComposerModel
    @State private var grab: AtelierKit.Point?
    @Environment(\.palette) private var palette

    var body: some View {
        GeometryReader { geo in
            let preview = model.settings.previewSize
            let canvas = CGSize(width: preview.width, height: preview.height)
            let rect = stageFitRect(canvas, in: geo.size)
            ZStack(alignment: .topLeading) {
                palette.frame
                if let image = model.stage.image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                } else {
                    ProgressView()
                        .tint(palette.onMedia)
                        .frame(width: geo.size.width, height: geo.size.height)
                }
                offlineBadge(rect: rect, preview: preview)
            }
            .contentShape(Rectangle())
            .gesture(drag(rect: rect, preview: preview))
            .help("Drag the telemetry readout to reposition it")
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    /// "Offline · no tiles loaded" at the map pane's corner, so a blank map
    /// never reads as a broken one. Drawn over the preview, never into a file.
    @ViewBuilder
    private func offlineBadge(rect: CGRect, preview: AtelierKit.Size) -> some View {
        let s = model.settings
        let pane = paneRects(preview.width, preview.height, s.layout, s.split, s.inset, s.corner).map
        let k = preview.width > 0 ? rect.width / CGFloat(preview.width) : 0
        if k > 0, pane.width * Double(k) > 150 {
            MediaChip(text: "Offline · no tiles loaded")
                .offset(x: rect.minX + CGFloat(pane.x) * k + 8, y: rect.minY + CGFloat(pane.y) * k + 8)
                .allowsHitTesting(false)
        }
    }

    /// A press on the card picks it up where it was held; anywhere else, nothing.
    private func drag(rect: CGRect, preview: AtelierKit.Size) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard rect.width > 0 else { return }
                let k = Double(preview.width) / Double(rect.width)
                let at = AtelierKit.Point(Double(value.location.x - rect.minX) * k,
                                          Double(value.location.y - rect.minY) * k)
                if grab == nil {
                    let start = AtelierKit.Point(Double(value.startLocation.x - rect.minX) * k,
                                                 Double(value.startLocation.y - rect.minY) * k)
                    guard let box = ComposerPainter.readoutArea(model.previewScene),
                          start.x >= box.x, start.x <= box.x + box.width,
                          start.y >= box.y, start.y <= box.y + box.height else { return }
                    grab = AtelierKit.Point(start.x - box.x, start.y - box.y)
                }
                guard let grab else { return }
                model.moveReadout(corner: AtelierKit.Point(at.x - grab.x, at.y - grab.y))
            }
            .onEnded { _ in grab = nil }
    }
}

/// The transport and the two ways out: Export MP4 (with its progress and a
/// Cancel) and Save frame (PNG).
struct ComposerExportRow: View {
    let model: ComposerModel
    @State private var png: InstrumentExportFile?
    @State private var savingPNG = false
    @Environment(\.palette) private var palette

    var body: some View {
        let moving = Binding<Bool>(
            get: { model.exported != nil },
            set: { if !$0 { model.exported = nil } }
        )
        VStack(alignment: .leading, spacing: 8) {
            InstrumentTransport(playback: model.playback, showsTimecode: false)
            HStack(spacing: 12) {
                Spacer(minLength: 0)
                if model.exporting {
                    Text(model.exportRatio.map { "\(Int(($0 * 100).rounded()))%" } ?? "Rendering…")
                        .font(Brand.mono(12))
                        .monospacedDigit()
                        .foregroundStyle(palette.inkSoft)
                    Button("Cancel") { model.cancelExport() }
                        .buttonStyle(.plain)
                        .font(Brand.sans(14, weight: .semibold))
                        .foregroundStyle(palette.accentInk)
                        .underline()
                        .keyboardShortcut(.cancelAction)
                } else {
                    Button {
                        Task {
                            if let data = await model.framePNG() {
                                png = InstrumentExportFile(data: data, name: instrumentOutputName(model.clipName, "composition", ext: "png"))
                                savingPNG = true
                            }
                        }
                    } label: {
                        Text("Save frame (PNG)").font(Brand.sans(14, weight: .semibold))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .disabled(model.savingFrame || model.stage.image == nil)
                    .help("The frame under the playhead, at the output's size")
                    Button {
                        model.exportMP4()
                    } label: {
                        Text("Export MP4").font(Brand.sans(14, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(palette.ink)
                    .help("Render the composition to an MP4")
                }
            }
            // Its own view: two file panels on one view present one of them.
            .fileExporter(isPresented: $savingPNG, document: png, contentType: .png,
                          defaultFilename: png?.name) { _ in
                png = nil
            }
        }
        .fileMover(isPresented: moving, file: model.exported) { _ in
            model.discardExported()
        }
    }
}

#Preview("Composer") {
    InstrumentFixtures.shelf()
    return NavigationStack { ComposerToolView() }
}
