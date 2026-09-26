// PENDING SECTIONS — the stand-ins the inspector and the stage call until the
// tasks that own them land. ONE file on purpose: each block below names the
// task that replaces it and the folder its real views live in; that task
// DELETES ITS BLOCK (the last one deletes the file). The names and the
// initialisers here are the CONTRACT `InspectorView` and `StageOverlaySlot`
// call — a task whose view takes other arguments changes the one call line in
// `InspectorView.swift` / `DevelopTool.swift`, not the other way round.
//
// The Adjust sections are NOT here: they landed in `Develop/Panels/` and the
// inspector draws them. Where Develop v0 already did the job, its working
// controls are kept below (aspect + straighten + mirror, one picture's
// JPEG/HEIC export), so the app never loses a feature between two merges.
// Everything else SAYS what is coming — never a blank.

import Photos
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

// MARK: - A small shared face for a section not built yet

/// A section that is coming: its name, what it will hold, and where the web
/// already has it — in the inspector's own fold frame.
struct ComingSection: View {
    let id: String
    let title: String
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        DevelopSection(id: id, title: title) {
            Text(text)
                .font(Brand.sans(13))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// =============================================================================
// MARK: - LOOK — owned by the Looks task (run-sheet #11). Delete when it lands.
// =============================================================================

/// The picture's own look: LUT layers, the output transform, film texture.
struct LookSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ApplySection(editor: editor, verbs: editor.lookApplyVerbs, title: "Apply look to…", id: "look-apply")
            ComingSection(id: "look", title: "Look",
                          text: editor.picture?.grade != nil
                              ? "This picture wears a look set in the web app — kept, and not drawn here yet: the looks (built-in LUTs, your vault, film stocks) come with their own task."
                              : "This picture's own look, applied AFTER its correction — the built-in LUTs, your vault and the film stocks come with their own task.")
        }
    }
}

// =============================================================================
// MARK: - LAYERS — owned by the Layers task (`Develop/Layers/*`): adjustment
// layers, their masks (linear, radial, brightness, colour range, brush,
// subject), combined masks. Delete when it lands.
// =============================================================================

struct LayersSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View {
        let count = readLayers(editor.picture?.carried["layers"]).count
        ComingSection(id: "layers", title: "Layers",
                      text: count > 0
                          ? "This picture carries \(count) layer\(count == 1 ? "" : "s") from the web app — kept, and not drawn here yet. Layers and their masks come with their own task."
                          : "Adjustment layers, each a develop through a mask — linear, radial, brightness, colour range, a brush, a subject. Coming with their own task.")
    }
}

struct MaskStageOverlay: View {
    let context: StageOverlayContext
    var body: some View { PendingOverlayChip(text: "masks are coming with the Layers task") }
}

// =============================================================================
// MARK: - REPAIR — owned by the Repair task (`Develop/Repair/*`): heal, clone,
// the dust field and its proposals. Delete when it lands.
// =============================================================================

struct RepairSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View {
        let patches = readPatches(editor.picture?.carried["repair"])
        ComingSection(id: "repair", title: "Repair",
                      text: patches.isEmpty
                          ? "Heal and clone spots, and find the dust on the sensor — coming with their own task."
                          : "\(describePatches(patches)) from the web app — kept, and not drawn here yet. Repair comes with its own task.")
    }
}

struct RepairStageOverlay: View {
    let context: StageOverlayContext
    var body: some View { PendingOverlayChip(text: "repair is coming with its own task") }
}

// =============================================================================
// MARK: - EXPORT — owned by the Export task (`Develop/Export/*`): every target
// into its folder, the run with progress and a Cancel, metadata groups, the
// watermark, the delivery table, Ultra HDR. Interim: Develop v0's one-picture
// export. Delete when it lands.
// =============================================================================

struct ExportSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @State private var format: ExportFormat = .jpeg
    @State private var busy = false
    @State private var file: ExportedFile?
    @State private var said: String?

    private let edges: [(label: String, size: ExportSize?)] = [
        ("Source size", nil),
        ("1080 px", ExportSize(mode: .long, value: 1080)),
        ("2048 px", ExportSize(mode: .long, value: 2048)),
        ("4096 px", ExportSize(mode: .long, value: 4096)),
    ]

    var body: some View {
        let export = editor.roll?.export ?? .default
        let target = export.primary
        let offered = edges.contains { $0.size == target.size } ? edges : edges + [(describeSize(target.size), target.size)]
        VStack(alignment: .leading, spacing: 0) {
            DevelopSection(id: "export-one", title: "This picture") {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Format", selection: $format) {
                        ForEach(ExportFormat.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Picker("Long edge", selection: Binding(get: { target.size }, set: { size in
                        editor.update { r in
                            var out = r
                            out.export.primary.size = size
                            out.updatedAt = nowMillis()
                            return out
                        }
                    })) {
                        ForEach(offered.indices, id: \.self) { i in Text(offered[i].label).tag(offered[i].size) }
                    }
                    HStack {
                        Slider(value: Binding(get: { target.quality }, set: { q in
                            editor.update { r in
                                var out = r
                                out.export.primary.quality = q
                                out.updatedAt = nowMillis()
                                return out
                            }
                        }), in: qualityLimits.min...qualityLimits.max, step: 0.01)
                        Text("\(Int((target.quality * 100).rounded())) %")
                            .font(Brand.mono(12))
                            .frame(width: 48, alignment: .trailing)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Delivers \(editor.exportFileName(format))")
                        if let size = editor.deliveredSize { Text("\(size.width) × \(size.height)") }
                        if export.targets.count > 1 {
                            Text("The roll has \(export.targets.count) targets; this writes the first. The others are kept for the web app.")
                        }
                        if !editor.unrendered.isEmpty {
                            Text("Not rendered here yet: \(editor.unrendered.joined(separator: ", ")). The web app delivers them.")
                                .foregroundStyle(palette.warn)
                        }
                        if let said { Text(said).foregroundStyle(palette.inkSoft) }
                    }
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    HStack(spacing: 8) {
                        Button("Export…") { run { data in file = ExportedFile(data: data, type: format.type) } }
                            .buttonStyle(.borderedProminent)
                        Button("Save to Photos") { run(saveToPhotos) }
                            .buttonStyle(.bordered)
                        if busy { ProgressView().controlSize(.small) }
                    }
                    .disabled(busy || editor.picture == nil)
                }
            }
            ComingSection(id: "export-run", title: "The roll",
                          text: "Every target of the roll into its folders, the run with its progress and a Cancel, the metadata groups, the watermark and the table of what leaves — coming with the Export task.")
        }
        .fileExporter(isPresented: Binding(get: { file != nil }, set: { if !$0 { file = nil } }),
                      document: file, contentType: file?.type ?? .jpeg,
                      defaultFilename: editor.exportFileName(format)) { _ in file = nil }
    }

    private func run(_ then: @escaping (Data) -> Void) {
        guard !busy else { return }
        busy = true
        said = nil
        Task {
            if let data = await editor.exportData(format) { then(data) } else { said = "This picture could not be rendered." }
            busy = false
        }
    }

    private func saveToPhotos(_ data: Data) {
        let name = editor.exportFileName(format)
        Task {
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard status == .authorized || status == .limited else {
                said = "Photos refused access."
                return
            }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
                }
                said = "\(name) is in your library."
            } catch {
                said = "Photos refused it: \(error.localizedDescription)"
            }
        }
    }
}

/// The rendered picture, as the file exporter carries it to a folder.
struct ExportedFile: FileDocument {
    static var readableContentTypes: [UTType] { [.jpeg, .heic] }
    static var writableContentTypes: [UTType] { [.jpeg, .heic] }

    var data: Data
    var type: UTType

    init(data: Data, type: UTType) {
        self.data = data
        self.type = type
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
        type = configuration.contentType
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

// MARK: - the overlays' shared stand-in

/// A chip on the stage saying a tool's overlay is not built yet — never a
/// silent stage.
struct PendingOverlayChip: View {
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack {
            Text(text)
                .font(Brand.mono(11))
                .foregroundStyle(palette.inkSoft)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(palette.surface.opacity(0.86), in: Capsule())
                .padding(10)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(false)
    }
}
