// The Develop tool's front door — the web's `RollGallery.tsx`: rolls as cards,
// newest first, GROUPED BY THE SOURCE they are kept on (one group even with
// one source — provenance is always shown), each card opening its roll, the
// rest behind its ⋯, a dashed tile completing this device's grid that makes a
// roll or takes a dropped `.roll.json`. On paper: the darkroom is the editor's.
//
// A connected instance's list is asked for beside the mirrors
// (`RollDocuments`): a roll mirrored here is one card, a roll only there a
// greyed card that MIRRORS on open; a header says "checking…" while the
// instance answers, and why it could not; an instance whose bucket does not
// keep rolls is said under the heading rather than left out in silence. A new
// or imported roll may be kept THERE — asked only when a second source can
// keep rolls — and a roll moves between sources from its ⋯. A roll file always
// becomes a NEW roll — importing a backup twice never replaces one
// (`rollDocFromFile`: fresh ids, the pictures' too).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct RollGallery: View {
    @Environment(RollStore.self) private var store
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    /// Rolls kept on a Winnow — the groups, the verbs that cross a source.
    @Environment(RollDocuments.self) private var documents: RollDocuments?
    /// The shell's Library — what the `Develop` verb starts a roll from, and
    /// the pictures a new roll may start with.
    @Environment(LibraryStore.self) private var library: LibraryStore?

    @State private var creating = false
    @State private var importing = false
    /// Where an import lands, asked only when a second source can keep rolls.
    @State private var importTarget = defaultSourceId
    @State private var choosingImportSource = false
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

    /// The sources a roll can be kept on — this device alone without a bridge.
    private var sources: [SourceInfo] {
        documents?.documentSources ?? [localSource]
    }

    private var groups: [AtelierKit.DocumentGroup<RollDoc>] {
        if let documents { return documents.groups }
        return groupDocuments(store.rolls, id: { $0.id }, sourceId: { $0.sourceId }, remoteSourceIds: [],
                              remoteLists: [:])
    }

    /// The photographs ticked in the Library — what a new roll may start with.
    private var ticked: [DroppedAsset] {
        guard let library else { return [] }
        return library.assets
            .filter { library.selection.contains($0.id) && $0.kind == .photo && $0.parts.image != nil }
            .compactMap { library.dropped($0) }
    }

    var body: some View {
        page
            .background(palette.paper)
            .navigationTitle("Rolls")
            .toolbar { bar }
            .task { await documents?.refresh() }
            .refreshable { await documents?.refresh() }
            .navigationDestination(item: $opened) { id in
                RollEditorView(rollId: id)
            }
            .sheet(isPresented: $creating) { newRollSheet }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                if case .success(let url) = result { importFile(url, to: importTarget) }
            }
            .confirmationDialog("Import a roll file", isPresented: $choosingImportSource, titleVisibility: .visible) {
                ForEach(sources, id: \.id) { source in
                    Button(source.id == defaultSourceId ? "This device (local)" : source.label) {
                        importTarget = source.id
                        importing = true
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Creates a new roll from an exported \(rollFileExtension) file — it never overwrites one you already have.")
            }
            .modifier(RollGalleryDialogs(exporting: $exporting, renaming: $renaming, newName: $newName,
                                         onRename: { roll, name in store.rename(roll.id, to: name) }))
            .onChange(of: documents?.closedByDelete ?? false) { _, closed in
                if closed { opened = nil }
            }
            .publishMediaActions(developOffer)
    }

    private var page: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let said = notice ?? documents?.gallery.notice {
                    Text(said)
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if store.storageFailed {
                    Text("This device refused to save a roll — the disk is full, or the app's storage is not writable.")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.danger)
                }
                AbsentSourceNotes(absent: documents?.absent ?? [])
                content
            }
            .padding(.horizontal, compact ? 12 : 24)
            .padding(.vertical, compact ? 12 : 20)
        }
    }

    @ViewBuilder
    private var content: some View {
        let empty = documents?.nothingAnywhere ?? store.rolls.isEmpty
        if empty {
            emptyState
        } else {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(groups, id: \.id) { group in
                    section(group)
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var bar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                startImport()
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

    private var newRollSheet: some View {
        NewRollSheet(sources: sources, tickedCount: ticked.count) { choices in
            creating = false
            create(choices)
        } onCancel: {
            creating = false
        }
    }

    /// `Develop` under a picture looked at large — the web's D10: a NEW roll
    /// from that one picture, named as the New-roll sheet would name it, kept
    /// on this device, opened at once.
    private var developOffer: MediaActions? {
        guard let library else { return nil }
        return MediaActions(
            key: "new-roll",
            heading: "starts a new roll with this picture",
            actions: [
                MediaAction(id: "new-roll", label: "Develop", hint: "a new roll from this picture, opened at once") { view in
                    guard let asset = library.activeAsset, asset.kind == .photo, let dropped = library.dropped(asset) else {
                        notice = "Only a photograph can start a roll."
                        return
                    }
                    let doc = store.create(name: defaultRollName())
                    if case .added(let id) = store.add(dropped, to: doc.id), let rendition = view?.rendition {
                        store.update(doc.id) { roll in roll = patchPicture(roll, id) { $0.rendition = rendition } }
                    }
                    open(doc.id)
                },
            ]
        )
    }

    private func open(_ id: String) {
        lastOpened = id
        opened = id
    }

    /// A new roll where it was asked, with the Library's ticked photographs
    /// when that was asked too — written on an instance first.
    private func create(_ choices: NewRollChoices) {
        notice = nil
        guard let documents else {
            let doc = store.create(name: choices.name)
            open(doc.id)
            return
        }
        let start = choices.withTicked ? ticked : []
        Task {
            if let doc = await documents.create(name: choices.name, sourceId: choices.sourceId, ticked: start) {
                open(doc.id)
            }
        }
    }

    /// A roll only there: mirrored, then opened.
    private func openRemote(_ row: RemoteDocRow<RollDoc>) {
        guard let documents else { return }
        let doc = documents.mirror(row)
        open(doc.id)
    }

    // MARK: - the groups

    private func section(_ group: AtelierKit.DocumentGroup<RollDoc>) -> some View {
        let registry = documents?.connections.registry ?? SourceRegistry()
        let known = registry.sourceById(group.id)
        let count = group.items.count + group.remoteOnly.count
        let moveTargets = sources.filter { $0.id != group.id }
        return VStack(alignment: .leading, spacing: 12) {
            sectionHeader(group, label: known?.label ?? group.id, known: known != nil, count: count)
            if count == 0 && group.id != defaultSourceId {
                Text("Nothing kept here yet.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.faint)
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: compact ? 12 : 20) {
                    ForEach(group.items, id: \.id) { roll in
                        card(roll, moveTargets: moveTargets)
                    }
                    if group.id == defaultSourceId {
                        NewRollTile(onCreate: { creating = true }, onDropFile: { importFile($0, to: defaultSourceId) })
                    }
                    ForEach(group.remoteOnly, id: \.doc.id) { row in
                        remoteCard(row)
                    }
                }
            }
        }
    }

    private func card(_ roll: RollDoc, moveTargets: [SourceInfo]) -> some View {
        RollCard(roll: roll, isOpen: roll.id == lastOpened, remoteOnly: false, moveTargets: moveTargets,
                 busy: documents?.busyLine(roll.id), compact: compact,
                 onOpen: { open(roll.id) },
                 onRename: {
                     newName = roll.name
                     renaming = roll
                 },
                 onExport: { exportRoll(roll) },
                 onDelete: { delete(roll) },
                 onMove: { target in
                     Task { await documents?.move(roll, to: target) }
                 })
    }

    private func remoteCard(_ row: RemoteDocRow<RollDoc>) -> some View {
        RollCard(roll: row.doc, isOpen: false, remoteOnly: true, moveTargets: [],
                 busy: documents?.busyLine(row.doc.id), compact: compact,
                 onOpen: { openRemote(row) },
                 onRename: {}, onExport: {},
                 onDelete: {
                     Task { await documents?.remove(row.doc, etagHint: row.etag) }
                 },
                 onMove: { _ in })
    }

    private func delete(_ roll: RollDoc) {
        if lastOpened == roll.id { lastOpened = nil }
        guard let documents else {
            store.delete(roll.id)
            return
        }
        Task { await documents.remove(roll) }
    }

    private func sectionHeader(_ group: AtelierKit.DocumentGroup<RollDoc>, label: String, known: Bool,
                               count: Int) -> some View {
        HStack(spacing: 0) {
            Eyebrow("source: \(label)")
            Text(" · ").font(Brand.eyebrow).foregroundStyle(palette.faint)
            Eyebrow("\(count) roll\(count == 1 ? "" : "s")")
            if !known {
                Text(" · NOT CONNECTED").font(Brand.eyebrow).foregroundStyle(palette.faint)
            }
            listStatus(group.list)
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }

    @ViewBuilder
    private func listStatus(_ list: RemoteList<RemoteDocRow<RollDoc>>?) -> some View {
        switch list {
        case .loading?:
            Text(" · CHECKING…").font(Brand.eyebrow).foregroundStyle(palette.faint)
        case .failed(let text, let login)?:
            Text(" · \(text)").font(Brand.sans(11)).foregroundStyle(palette.faint)
            if let login, let url = URL(string: login) {
                Text(" ")
                Link("Sign in", destination: url)
                    .font(Brand.sans(11, weight: .semibold))
                    .foregroundStyle(palette.accentInk)
            }
        default:
            EmptyView()
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
            Button("or import a roll file") { startImport() }
                .buttonStyle(.borderless)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: - the roll file

    /// With one source there is nothing to ask: the file dialog opens at once.
    private func startImport() {
        if sources.count > 1 {
            choosingImportSource = true
        } else {
            importTarget = defaultSourceId
            importing = true
        }
    }

    private func exportRoll(_ roll: RollDoc) {
        store.flush()
        guard let text = store.fileText(roll.id) else { return }
        exporting = RollFileDocument(text: text, fileName: rollFileName(roll.name))
    }

    /// A roll file always becomes a NEW roll, kept where it was asked.
    private func importFile(_ url: URL, to target: String) {
        notice = nil
        let scoped = url.startAccessingSecurityScopedResource()
        let data = try? Data(contentsOf: url)
        if scoped { url.stopAccessingSecurityScopedResource() }
        guard let data, let text = String(data: data, encoding: .utf8) else {
            notice = RollFileError.notJSON.message
            return
        }
        guard let documents else {
            if case .failure(let error) = store.importRoll(text: text) { notice = error.message }
            return
        }
        Task { _ = await documents.importRoll(text: text, to: target) }
    }
}

/// The export and rename dialogs, apart so the gallery's chain stays short.
private struct RollGalleryDialogs: ViewModifier {
    @Binding var exporting: RollFileDocument?
    @Binding var renaming: RollDoc?
    @Binding var newName: String
    let onRename: (RollDoc, String) -> Void

    func body(content: Content) -> some View {
        content
            .fileExporter(isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
                          document: exporting, contentType: .json,
                          defaultFilename: exporting?.fileName ?? rollFileName("roll")) { _ in
                exporting = nil
            }
            .alert("Rename roll", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newName)
                Button("Rename") {
                    if let roll = renaming { onRename(roll, newName) }
                    renaming = nil
                }
                Button("Cancel", role: .cancel) { renaming = nil }
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
