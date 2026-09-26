// LUT Studio — `src/tools/lut/LutStudio.tsx`: a `.cube` look previewed on
// the clips (and, natively, the photos) of the instruments' shelf, with a
// before/after wipe and an Original / Graded switch, then every clip graded
// into MP4s in one run.
//
// The web's page grades clips only; a photo is previewed here through the
// very same graph (a photograph is delivered from Develop, so no photo is
// exported from this page, and the export bar says so).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct LutStudioView: View {
    @State private var model = LutStudioModel()
    @State private var files = false
    @State private var photos = false
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }

    var body: some View {
        let options = shelf.usable(InstrumentTool.lut.accepts)
        let active = shelf.active(in: options)
        let clips = options.filter { $0.parts.video != nil }
        let look = model.look
        let key = LutRenderKey(grade: look.grade, bypass: model.bypass, compare: model.compareOn)

        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                InstrumentBar {
                    InstrumentLookControls(look: look)
                    Hairline()
                    HStack(spacing: 8) {
                        InstrumentChip(title: "Compare", pressed: model.compareOn) { model.toggleCompare() }
                            .disabled(look.lut == nil)
                            .help("Drag a divider across the preview: original on the left, grade on the right")
                        LutSourceSwitch(original: model.bypass || look.lut == nil, canGrade: look.lut != nil,
                                        onOriginal: { model.showOriginal() }, onGraded: { model.showGraded() })
                    }
                }

                if let active {
                    clipRow(options: options, active: active)
                }

                LutStage(model: model)
                    .frame(maxWidth: .infinity)
                    .frame(height: 420)

                if case .clip = model.media {
                    InstrumentTransport(playback: model.playback)
                }

                if let error = look.cubeError {
                    InstrumentNotice(text: error)
                }
                if options.isEmpty {
                    InstrumentEmpty(text: "Open a clip (or a photo) to preview a look on it. Clips are graded into MP4s from the bar below.") {
                        HStack {
                            Button("From Files…") { files = true }
                                .buttonStyle(.borderedProminent)
                            Button("From Photos…") { photos = true }
                                .buttonStyle(.bordered)
                        }
                        .tint(palette.accent)
                    }
                }

                LutExportResults(model: model)
                LutExportBar(model: model, clipCount: clips.count,
                             hasPhoto: options.contains { $0.parts.video == nil }) { folder in
                    let jobs = clips.compactMap { clip -> (id: String, name: String, url: URL)? in
                        guard let ref = clip.parts.video, let url = shelf.url(for: ref) else { return nil }
                        return (id: clip.id, name: ref.name, url: url)
                    }
                    model.exportAll(jobs, to: folder)
                }
            }
            .padding(16)
        }
        .background(palette.paper)
        .navigationTitle(InstrumentTool.lut.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                InstrumentOpenMenu(title: "Open", onPhotos: { photos = true }, onFiles: { files = true })
            }
        }
        .task(id: active?.id) { await model.open(active, shelf: shelf) }
        .task(id: model.media) {
            // The clip's frames, read as they come — about sixty looks a second.
            guard case .clip = model.media else { return }
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
        .instrumentImporters(files: $files, photos: $photos, types: InstrumentFileTypes.media,
                             photoFilter: .any(of: [.videos, .images]))
        .instrumentProblemAlert()
    }

    private func clipRow(options: [Asset], active: Asset) -> some View {
        HStack(spacing: 10) {
            if options.count > 1 {
                ClipStepper(ids: options.map(\.id), activeId: active.id) { shelf.activeId = $0 }
            }
            Text(active.parts.video?.name ?? active.parts.image?.name ?? active.baseName)
                .font(Brand.sans(14, weight: .semibold))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            if !model.detail.isEmpty {
                Text(model.detail)
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

/// What, besides the frame and the stage's size, re-grades the stage.
struct LutRenderKey: Equatable {
    let grade: LookGrade?
    let bypass: Bool
    let compare: Bool
}

/// Original / Graded — a segmented switch, clearer than a "Viewing: X"
/// button: the active source reads at a glance. Graded waits for a look.
struct LutSourceSwitch: View {
    let original: Bool
    let canGrade: Bool
    let onOriginal: () -> Void
    let onGraded: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 0) {
            segment("Original", on: original, enabled: true, help: "Show the original, ungraded image", action: onOriginal)
            segment("Graded", on: !original, enabled: canGrade,
                    help: canGrade ? "Show the graded image" : "Pick a LUT first", action: onGraded)
        }
        .padding(3)
        .background(palette.paper, in: Capsule())
        .overlay(Capsule().stroke(palette.lineStrong, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Preview source")
    }

    private func segment(_ title: String, on: Bool, enabled: Bool, help: String,
                         action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(on ? palette.paper : (enabled ? palette.muted : palette.faint))
                .padding(.horizontal, 12)
                .frame(height: 26)
                .background(on ? palette.ink : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(help)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

#Preview("LUT Studio") {
    InstrumentFixtures.shelf()
    return NavigationStack { LutStudioView() }
        .environment(LookLibrary.preview)
}
