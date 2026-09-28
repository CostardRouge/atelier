// The Studio inspector's EXPORT tab — the web's Output · Variants · Export
// sections of `StudioEditor.tsx`, over the native run (`StudioExportModel`)
// and the ONE video pipeline (`StudioVariantExport`):
//
// - Output: the file name (the media's own when empty), where the files go
//   (a folder picked AT THE CLICK — pick, then render, then write), the
//   *Delivers* row saying what will really leave from what — the largest
//   frame the variants write, measured against the file that will be
//   encoded, never upscaled — and, over a clip an instance handed over as its
//   proxy, *Render from the proxy* (off: the capture is fetched before the
//   first variant). Instances do not reach the Studio yet — the Library
//   brings them — and the row says so rather than leaving a gap;
// - Variants (`StudioVariantRow.swift`);
// - Export: the button that counts what it will write, the run's line over
//   its bar and its Cancel (the variant in flight ends, what was written
//   stays), what the run cost, what the file could not carry, and — for
//   media an instance handed over — the finals sent home
//   (`StudioFinalsPanel`).
//
// The run is the project's (`editor.exporter`), not this view's: switching
// tab, or walking back to the gallery, leaves it running, and the pill on
// the editor's bar says so.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct StudioExportPanel: View {
    @Bindable var editor: StudioEditor

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if editor.active == nil {
                OverlayPanelNote("Open a clip or a photo to export it.")
                    .padding(.vertical, 12)
            } else {
                StudioExportOutputSection(editor: editor)
                StudioExportVariantsSection(editor: editor)
                StudioExportRunSection(editor: editor)
            }
        }
    }
}

// MARK: - Output

struct StudioExportOutputSection: View {
    @Bindable var editor: StudioEditor
    @FocusState private var naming: Bool
    @Environment(\.palette) private var palette

    static let info = [
        "Each variant is written into the folder you choose when you press Export, named after the file name here (the media's own when it is empty) plus what the variant departs from — 9x16, 1080p, 30fps, clean. A file of the same name is replaced.",
        "A clip leaves through one pipeline: graded frame by frame, cut to its trim, re-timed to its variant's cadence and speed, the overlays burnt in, the outro appended, its own sound copied untouched. A still leaves as a JPEG carrying the original's metadata, signed Atelier.",
    ]

    var body: some View {
        let model = editor.exporter
        DevelopSection(id: "studio.export.output", title: "Output", info: Self.info, remember: .local) {
            nameRow
            OverlayPanelRow("Destination",
                            hint: "A folder on this device, asked for when you press Export — every variant is written into it as it finishes.") {
                Text(verbatim: model.folderName ?? "Asked at the click")
                    .font(Brand.mono(12))
                    .foregroundStyle(model.folderName == nil ? palette.muted : palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            StudioDeliversRow(editor: editor, model: model)
            if let proxy = editor.exportClipProxy {
                fromProxyRow(proxy, model)
            }
        }
    }

    private var nameRow: some View {
        OverlayPanelRow("File name") {
            TextField("File name", text: editor.binding(\.exportFileName),
                      prompt: Text(verbatim: editor.active?.baseName ?? "export"))
                .textFieldStyle(.roundedBorder)
                .font(Brand.sans(13))
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .focused($naming)
                .onChange(of: naming) { _, on in editor.textEditing = on }
                .onDisappear { if naming { editor.textEditing = false } }
                .accessibilityLabel("File name")
        }
    }

    private func fromProxyRow(_ origin: MediaOrigin, _ model: StudioExportModel) -> some View {
        let hint = fromProxyHint(sourceId: origin.sourceId, proxyHeight: editor.clipHeight,
                                 fetchesOriginal: !model.renderFromProxy)
        return OverlayPanelRow("From proxy", hint: hint) {
            OverlayPanelToggle("Render from the proxy", isOn: model.renderFromProxy, words: "For a quick look") { on in
                model.renderFromProxy = on
            }
        }
    }
}

/// What the export will really deliver, from which file — the calculator's
/// sentence (`deliversLine`) over the LARGEST frame the variants write.
struct StudioDeliversRow: View {
    @Bindable var editor: StudioEditor
    let model: StudioExportModel
    @Environment(\.palette) private var palette

    static let localHint = "The largest frame the variants write, from this file on this device at its own density. A variant never upscales — a row that asks for more says what it really gets. Media an instance hands over, and the capture fetched behind its proxy, reach the Studio with the Library; until then nothing is fetched."

    /// Over a proxy whose original is a RAW, this device does not read the
    /// render inside it (the web measures a megabyte of its head) — said, so
    /// the kernel's "read at export" is never promised here.
    static let rawReason = "its original is a RAW: only the render inside it is decodable, and this device does not read that render's size yet — the proxy is what leaves"

    var body: some View {
        let said = words
        OverlayPanelRow("Delivers", hint: said.hint, alignTop: true) {
            Text(verbatim: said.line ?? "—")
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(said.line == nil ? palette.muted : palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var words: (line: String?, hint: String) {
        // A still over its proxy: the delivery decision the run takes too.
        if editor.isPhoto, let origin = editor.exportPhotoProxy {
            let summary = editor.exportStillDelivery()
            let overRaw = isProxyOverRaw(origin) && summary != nil
            let reason: String? = overRaw ? StudioDeliversRow.rawReason : summary?.reason
            return (summary?.line, proxyDeliversHint(sourceId: origin.sourceId, reason: reason, measured: summary != nil))
        }
        let proxy = editor.exportClipProxy
        let fetches = proxy != nil && !model.renderFromProxy
        guard let file = editor.exportSourceSize(renderFromProxy: model.renderFromProxy),
              let frame = editor.exportLargestFrame(renderFromProxy: model.renderFromProxy) else {
            let waiting = editor.isPhoto ? "Measured once the picture is decoded." : "Measured once the clip has been read."
            return (nil, waiting)
        }
        let label = fetches ? originalLabel(originalOf(proxy)) : sourceLabel(proxy != nil)
        let line = deliversLine(label, frame, pixelHeadroom(file, nil, frame))
        guard proxy != nil else { return (line, StudioDeliversRow.localHint) }
        let from = fetches ? "the capture, fetched before the first variant" : "the proxy, as it is on this device"
        return (line, "The largest frame the variants write, from \(from).")
    }
}

// MARK: - Export

struct StudioExportRunSection: View {
    @Bindable var editor: StudioEditor
    @State private var picking = false
    @Environment(\.palette) private var palette

    var body: some View {
        let model = editor.exporter
        let media = editor.active?.id
        DevelopSection(id: "studio.export.run", title: "Export", remember: .local) {
            if model.running {
                progress(model)
            } else {
                idle(model, media: media)
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            switch result {
            case .success(let folder):
                model.start(editor, into: folder)
            case .failure(let error):
                model.say("No folder could be chosen — \(error.localizedDescription)", media: editor.active?.id)
            }
        }
    }

    private func progress(_ model: StudioExportModel) -> some View {
        let line = studioExportProgressLine(fetchingFrom: model.fetchingFrom, fetching: model.fetching,
                                            index: model.index, total: model.total, ratio: model.ratio)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(verbatim: line)
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
                    .accessibilityAddTraits(.updatesFrequently)
                if model.fetching {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    ProgressView(value: model.ratio)
                        .tint(palette.accent)
                }
            }
            Button("Cancel") { model.cancel() }
                .buttonStyle(DevelopLinkButtonStyle())
                .help("Stop the variant in flight — what was written stays")
        }
    }

    @ViewBuilder
    private func idle(_ model: StudioExportModel, media: String?) -> some View {
        let variants = editor.edit.variants
        let medium: VariantMedium = editor.isPhoto ? .photo : .video
        if model.finished(variants, media: media) {
            exported(model)
            // Only offered for what was just rendered, only to the instance it came from.
            if let target = model.finalsTarget, !model.delivered.isEmpty {
                StudioFinalsPanel(model: model, target: target)
            }
        }
        if model.owns(media) {
            ForEach(model.notes, id: \.self) { sentence in
                OverlayPanelHint(sentence)
            }
            if let note = model.note {
                Text(verbatim: note)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = model.error {
                Text(verbatim: error)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
        Button {
            picking = true
        } label: {
            Label(studioExportVerb(medium, variants.count), systemImage: "square.and.arrow.up")
                .font(Brand.sans(13, weight: .semibold))
        }
        .buttonStyle(.borderedProminent)
        .tint(palette.accent)
        .disabled(editor.active == nil || variants.isEmpty)
        .help(studioExportHelp(medium))
    }

    private func exported(_ model: StudioExportModel) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Exported", systemImage: "checkmark")
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(palette.ok)
            Text(verbatim: describeExportRun(model.runStats))
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(palette.inkSoft)
            if let folder = model.folderName {
                Text(verbatim: "into \(folder)")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.ok.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.ok.opacity(0.35), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - previews

/// An editor to preview the tab on: a project with two variants and an outro,
/// no media — a preview has no files, so the Output and Export sections wait.
enum StudioExportPreview {
    @MainActor static func editor() -> StudioEditor {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-studio-export-preview")
        let store = StudioStore(root: root, connections: ConnectionStore.shared)
        var doc = createProjectDoc("Coast at dawn", "9:16", [], .default, now: 0, id: "preview-export")
        var reel = createVariant("9:16", id: "reel")
        reel.resolution = .shortSide(1080)
        reel.frameRate = .fps(30)
        var clean = createVariant("source", id: "master")
        clean.overlays = false
        doc.exportPrefs.variants = [reel, clean]
        doc.outro = createOutroCard("Coast at dawn")
        let open = StudioOpenProject(doc: doc, reconciliation: nil, generation: 0,
                                     library: StudioLibrary(projectId: doc.id))
        return StudioEditor(store: store, open: open)
    }
}

#Preview("Export tab") {
    ScrollView {
        StudioExportPanel(editor: StudioExportPreview.editor())
            .padding(.horizontal, 14)
    }
    .frame(width: 360, height: 700)
    .darkroom()
}

#Preview("Export — the run") {
    ScrollView {
        StudioExportRunSection(editor: StudioExportPreview.editor())
            .padding(.horizontal, 14)
    }
    .frame(width: 360, height: 300)
    .darkroom()
}
