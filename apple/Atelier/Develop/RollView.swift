// The Develop workbench: the stage, the filmstrip and the inspector — side by
// side on a Mac and an iPad, stacked on a phone — in the darkroom.

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit
#if canImport(Photos)
import Photos
#endif

struct RollView: View {
    let rollId: String
    @Environment(RollStore.self) private var store
    @State private var editor: RollEditor?

    var body: some View {
        Group {
            if let editor {
                RollWorkbench(editor: editor)
            } else {
                Color.clear
            }
        }
        .onAppear {
            if editor == nil { editor = RollEditor(store: store, rollId: rollId) }
        }
        .darkroom()
    }
}

struct RollWorkbench: View {
    @Bindable var editor: RollEditor
    @Environment(RollStore.self) private var store
    @Environment(\.palette) private var palette
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var exporting = false
    @State private var exportFile: ExportedFile?
    @State private var exportBusy = false
    @State private var savedToPhotos: String?

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var isCompact: Bool { sizeClass == .compact }
    #else
    private var isCompact: Bool { false }
    #endif

    var body: some View {
        Group {
            if isCompact { stacked } else { sideBySide }
        }
        .background(palette.paper)
        .navigationTitle(editor.roll?.name ?? "Roll")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(palette.paper2, for: .navigationBar)
        #endif
        .toolbar { toolbar }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 50, matching: .images)
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.image, .rawImage], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result {
                for url in urls { store.addPicture(to: editor.rollId, url: url) }
                editor.selectFirstIfNone()
            }
        }
        .fileExporter(isPresented: $exporting, document: exportFile, contentType: exportFile?.type ?? .jpeg, defaultFilename: editor.exportFileName) { _ in
            exportFile = nil
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
        .alert("Saved to Photos", isPresented: Binding(get: { savedToPhotos != nil }, set: { if !$0 { savedToPhotos = nil } })) {
            Button("OK") { savedToPhotos = nil }
        } message: {
            Text(savedToPhotos ?? "")
        }
    }

    // MARK: - layouts

    private var stacked: some View {
        VStack(spacing: 0) {
            DevelopStage(editor: editor)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Hairline()
            FilmstripView(editor: editor)
                .frame(height: 84)
            Hairline()
            sectionPicker
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            ScrollView {
                panel.padding(.horizontal, 16).padding(.bottom, 16)
            }
            .frame(height: 300)
            .background(palette.paper2)
        }
    }

    private var sideBySide: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                DevelopStage(editor: editor)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Hairline()
                FilmstripView(editor: editor)
                    .frame(height: 96)
            }
            Rectangle().fill(palette.line).frame(width: 1)
            VStack(spacing: 0) {
                sectionPicker
                    .padding(12)
                Hairline()
                ScrollView {
                    panel.padding(16)
                }
            }
            .frame(width: 320)
            .background(palette.paper2)
        }
    }

    private var sectionPicker: some View {
        Picker("Section", selection: $editor.section) {
            ForEach(WorkbenchSection.allCases) { section in
                Text(section.title).tag(section)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }

    @ViewBuilder
    private var panel: some View {
        if editor.picture == nil {
            VStack(alignment: .leading, spacing: 8) {
                Text("No picture open.")
                    .foregroundStyle(palette.inkSoft)
                Text("Add pictures from Photos or from a folder, then pick one in the strip.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            switch editor.section {
            case .develop: DevelopPanel(editor: editor)
            case .crop: CropPanel(editor: editor)
            case .export: ExportPanel(editor: editor, onExport: { exportPicture() }, onSaveToPhotos: { saveToPhotos() }, busy: exportBusy)
            }
        }
    }

    // MARK: - the bar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Menu {
                Button { showPhotos = true } label: { Label("From Photos…", systemImage: "photo.on.rectangle") }
                Button { showFiles = true } label: { Label("From Files…", systemImage: "folder") }
            } label: {
                Label("Add pictures", systemImage: "plus")
            }
            Button {
                editor.setCompare(!editor.compare)
            } label: {
                Label("Before / after", systemImage: editor.compare ? "square.lefthalf.filled" : "square.righthalf.filled")
            }
            .disabled(editor.picture == nil)
            .keyboardShortcut("b", modifiers: [])
            Button {
                editor.showInfo.toggle()
            } label: {
                Label("Info", systemImage: editor.showInfo ? "info.circle.fill" : "info.circle")
            }
            .disabled(editor.picture == nil)
            .keyboardShortcut("i", modifiers: [])
        }
    }

    // MARK: - in and out

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        let stamp = Int(Date().timeIntervalSince1970)
        for (i, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            store.addPicture(to: editor.rollId, data: data, name: "IMG_\(stamp)_\(i + 1).\(ext)")
        }
        photoItems = []
        editor.selectFirstIfNone()
    }

    private func exportPicture() {
        guard !exportBusy else { return }
        exportBusy = true
        Task {
            if let data = await editor.exportData() {
                exportFile = ExportedFile(data: data, type: editor.exportFormat.type)
                exporting = true
            }
            exportBusy = false
        }
    }

    private func saveToPhotos() {
        guard !exportBusy else { return }
        exportBusy = true
        Task {
            defer { exportBusy = false }
            guard let data = await editor.exportData() else { return }
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard status == .authorized || status == .limited else { return }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: data, options: nil)
                }
                savedToPhotos = "\(editor.exportFileName) is in your library."
            } catch {
                savedToPhotos = "Photos refused it: \(error.localizedDescription)"
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
