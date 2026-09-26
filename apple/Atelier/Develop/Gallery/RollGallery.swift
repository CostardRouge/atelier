// The Develop tool's front door — the web's `RollGallery.tsx`: rolls as cards,
// newest first, GROUPED BY THE SOURCE they are kept on (one group even with
// one source — provenance is always shown), each card opening its roll, the
// rest behind its ⋯, a dashed tile completing the grid that makes a roll or
// takes a dropped `.roll.json`. On paper: the darkroom is the editor's.
//
// A roll file always becomes a NEW roll — importing a backup twice never
// replaces one (`rollDocFromFile`: fresh ids, the pictures' too). Rolls kept
// on a Winnow, the Move verb and a remote-only card wait for the app's Winnow
// client (`PARITY.md`).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct RollGallery: View {
    @Environment(RollStore.self) private var store
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @State private var creating = false
    @State private var importing = false
    @State private var notice: String?
    /// The roll pushed onto the stack — set by a card, by a new roll, by a drop.
    @State private var opened: String?
    /// The roll last opened here: its card says `open`, its verb `Resume`.
    @State private var lastOpened: String?
    @State private var exporting: RollFileDocument?
    @State private var renaming: RollDoc?
    @State private var newName = ""

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let notice {
                    Text(notice)
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.danger)
                }
                if store.rolls.isEmpty {
                    emptyState
                } else {
                    ForEach(groupBySource(store.rolls, sourceId: { $0.sourceId }), id: \.id) { group in
                        section(group)
                    }
                }
            }
            .padding(.horizontal, compact ? 12 : 24)
            .padding(.vertical, compact ? 12 : 20)
        }
        .background(palette.paper)
        .navigationTitle("Rolls")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    importing = true
                } label: {
                    Label("Import", systemImage: "square.and.arrow.down")
                }
                .help("Create a roll from an exported \(rollFileExtension) file")
                Button {
                    creating = true
                } label: {
                    Label("New roll", systemImage: "plus")
                }
                #if os(iOS)
                // The Mac's is the File menu's New Roll.
                .keyboardShortcut("n", modifiers: [.command])
                #endif
            }
        }
        .navigationDestination(item: $opened) { id in
            RollEditorView(rollId: id)
        }
        .sheet(isPresented: $creating) {
            NewRollSheet { name in
                creating = false
                let doc = store.create(name: name)
                open(doc.id)
            } onCancel: {
                creating = false
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result { importFile(url) }
        }
        .fileExporter(isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
                      document: exporting, contentType: .json,
                      defaultFilename: exporting?.fileName ?? rollFileName("roll")) { _ in
            exporting = nil
        }
        .alert("Rename roll", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let roll = renaming { store.rename(roll.id, to: newName) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    private func open(_ id: String) {
        lastOpened = id
        opened = id
    }

    // MARK: - the groups

    private func section(_ group: SourceGroup<RollDoc>) -> some View {
        let known = SourceRegistry().sourceById(group.id)
        let count = group.items.count
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 0) {
                Eyebrow("source: \(known?.label ?? group.id)")
                Text(" · ").font(Brand.eyebrow).foregroundStyle(palette.faint)
                Eyebrow("\(count) roll\(count == 1 ? "" : "s")")
                if known == nil {
                    Text(" · NOT CONNECTED").font(Brand.eyebrow).foregroundStyle(palette.faint)
                }
            }
            if count == 0 && group.id != defaultSourceId {
                Text("Nothing kept here yet.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.faint)
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: compact ? 12 : 20) {
                    ForEach(group.items, id: \.id) { roll in
                        RollCard(roll: roll, isOpen: roll.id == lastOpened, compact: compact,
                                 onOpen: { open(roll.id) },
                                 onRename: {
                                     newName = roll.name
                                     renaming = roll
                                 },
                                 onExport: { exportRoll(roll) },
                                 onDelete: { store.delete(roll.id) })
                    }
                    if group.id == defaultSourceId {
                        NewRollTile(onCreate: { creating = true }, onDropFile: importFile)
                    }
                }
            }
        }
    }

    private var columns: [GridItem] {
        compact
            ? [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
            : [GridItem(.adaptive(minimum: 240), spacing: 20)]
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No rolls yet", systemImage: "camera.aperture")
        } description: {
            Text("A roll is the set of photographs you mean to develop — from a folder or a day on your Winnow — each keeping its own light and colour, and its own look.")
        } actions: {
            Button("Start the first one") { creating = true }
                .buttonStyle(.borderedProminent)
            Button("or import a roll file") { importing = true }
                .buttonStyle(.borderless)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: - the roll file

    private func exportRoll(_ roll: RollDoc) {
        store.flush()
        guard let text = store.fileText(roll.id) else { return }
        exporting = RollFileDocument(text: text, fileName: rollFileName(roll.name))
    }

    /// A roll file always becomes a NEW roll, kept on this device.
    private func importFile(_ url: URL) {
        notice = nil
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
            notice = RollFileError.notJSON.message
            return
        }
        switch store.importRoll(text: text) {
        case .success: break
        case .failure(let error): notice = error.message
        }
    }
}

/// A `.roll.json` as the file exporter carries it — the web's bytes.
struct RollFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    static var writableContentTypes: [UTType] { [.json] }

    var text: String
    var fileName: String

    init(text: String, fileName: String) {
        self.text = text
        self.fileName = fileName
    }

    init(configuration: ReadConfiguration) throws {
        text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? ""
        fileName = configuration.file.filename ?? rollFileName("roll")
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

/// The dashed tile that completes the grid, and the drop zone for a roll file.
struct NewRollTile: View {
    let onCreate: () -> Void
    let onDropFile: (URL) -> Void
    @Environment(\.palette) private var palette
    @State private var over = false

    var body: some View {
        Button(action: onCreate) {
            VStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 22))
                Text("New roll").font(Brand.sans(14, weight: .semibold))
                Text("or drop a \(rollFileExtension) file here").font(Brand.sans(12))
            }
            .frame(maxWidth: .infinity, minHeight: 190)
            .foregroundStyle(over ? palette.accentInk : palette.muted)
            .background(over ? palette.accentWash : Color.clear, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.paperRadius)
                    .strokeBorder(over ? palette.accent : palette.lineStrong, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .dropDestination(for: URL.self) { urls, _ in
            guard let file = urls.first(where: { $0.pathExtension.lowercased() == "json" }) else { return false }
            onDropFile(file)
            return true
        } isTargeted: { over = $0 }
    }
}

#Preview("Rolls") {
    NavigationStack { RollGallery() }
        .environment(RollStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")))
}
