// The Studio's front door — the web's `ProjectGallery.tsx`: saved projects as
// cards (the thumbnail baked at save time, so nothing decodes), newest first,
// GROUPED BY THE SOURCE they are kept on — one group even with one source, so
// the day an instance appears its projects land in a section of their own
// instead of reshaping the page. A connected instance's list is asked for
// beside the mirrors and merged by id: a project mirrored here is one card, a
// project only there a greyed card that pulls on open. On paper; the darkroom
// is the editor's.
//
// The verbs are the web's: the WHOLE card opens; Use as template, Move to …
// and Delete… behind its ⋯, the destructive one confirmed; New project and
// Import in the bar (on a phone the web moves them to the thumb zone — here
// the navigation bar is already there); a dashed tile completing the local
// grid that creates, and takes a dropped `.atelier.json`. Importing asks
// WHERE only when there is a choice.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct StudioGallery: View {
    @State private var studio = StudioStore.shared
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @State private var creating = false
    /// The file dialog for an import, and where the file lands.
    @State private var importing = false
    @State private var importTarget = defaultSourceId
    @State private var choosingImportSource = false
    /// The project pushed onto the stack.
    @State private var opened: String?

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    private var gallery: DocumentGalleryModel<ProjectDoc> { studio.gallery }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !compact { heading }
                if let notice = gallery.notice {
                    Text(notice)
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isStaticText)
                }
                if studio.storageFailed {
                    Text("This device refused to save a project — the disk is full, or the app's storage is not writable.")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.danger)
                }
                AbsentSourceNotes(absent: gallery.absent)
                content
            }
            .padding(.horizontal, compact ? 12 : 24)
            .padding(.vertical, compact ? 12 : 20)
        }
        .background(palette.paper)
        .navigationTitle("Projects")
        #if os(iOS)
        .navigationBarTitleDisplayMode(compact ? .inline : .automatic)
        #endif
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    startImport()
                } label: {
                    Label("Import", systemImage: "square.and.arrow.down")
                }
                .help("Create a project from an exported settings file (\(projectFileExtension))")
                Button {
                    creating = true
                } label: {
                    Label("New project", systemImage: "plus")
                }
                #if os(iOS)
                .keyboardShortcut("n", modifiers: [.command])
                #endif
            }
        }
        .task { await studio.refresh() }
        .refreshable { await studio.refresh() }
        .navigationDestination(item: $opened) { id in
            StudioEditorView(projectId: id)
        }
        .sheet(isPresented: $creating) {
            NewProjectSheet(templates: gallery.docs ?? [], sources: gallery.documentSources) { choices in
                creating = false
                Task {
                    if await studio.create(choices) { opened = studio.open?.doc.id }
                }
            } onCancel: {
                creating = false
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            guard case .success(let url) = result else { return }
            let target = importTarget
            Task { await studio.importProject(from: url, to: target) }
        }
        .confirmationDialog("Import a project file", isPresented: $choosingImportSource, titleVisibility: .visible) {
            ForEach(gallery.documentSources, id: \.id) { source in
                Button(source.id == defaultSourceId ? "This device (local)" : source.label) {
                    importTarget = source.id
                    importing = true
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Creates a new project from an exported \(projectFileExtension) settings file — it never overwrites one you already have.")
        }
        .onChange(of: studio.closedByDelete) { _, closed in
            if closed { opened = nil }
        }
    }

    /// With one source there is nothing to ask: the file dialog opens at once.
    private func startImport() {
        if gallery.documentSources.count > 1 {
            choosingImportSource = true
        } else {
            importTarget = defaultSourceId
            importing = true
        }
    }

    private func open(_ doc: ProjectDoc) {
        Task {
            if await studio.openProject(doc) { opened = doc.id }
        }
    }

    // MARK: - the page

    private var heading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("Projects")
                .font(Brand.display(30))
                .foregroundStyle(palette.ink)
                .accessibilityHidden(true)
            if let docs = gallery.docs {
                Text("\(docs.count)")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var content: some View {
        if gallery.docs == nil {
            HStack(spacing: 10) {
                ProgressView()
                Text("Loading projects…")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 40)
        } else if gallery.nothingAnywhere && gallery.allListed {
            emptyState
        } else {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(gallery.groups, id: \.id) { group in
                    section(group)
                }
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No projects yet", systemImage: "film.stack")
        } description: {
            Text("A project keeps your overlays, look and layout — and remembers which folder its media lives in, so it reopens in one click.")
        } actions: {
            Button("Create the first one") { creating = true }
                .buttonStyle(.borderedProminent)
            Button("or import a project file") { startImport() }
                .buttonStyle(.borderless)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: - one source

    private func section(_ group: DocumentGroup<ProjectDoc>) -> some View {
        let known = gallery.connections.registry.sourceById(group.id)
        let count = group.items.count + group.remoteOnly.count
        let moveTargets = gallery.documentSources.filter { $0.id != group.id }
        return VStack(alignment: .leading, spacing: 12) {
            sectionHeader(group, label: known?.label ?? group.id, known: known != nil, count: count)
            if count == 0 && group.id != defaultSourceId {
                Text("Nothing kept here yet.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.faint)
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: compact ? 12 : 20) {
                    ForEach(group.items, id: \.id) { doc in
                        StudioProjectCard(doc: doc, isOpen: doc.id == studio.lastOpenedId, remoteOnly: false,
                                          moveTargets: moveTargets, busy: busyLine(doc.id), compact: compact,
                                          onOpen: { open(doc) },
                                          onDelete: { Task { await studio.remove(doc) } },
                                          onDuplicate: { Task { await studio.duplicate(doc) } },
                                          onMove: { target in Task { await studio.move(doc, to: target) } })
                    }
                    if group.id == defaultSourceId {
                        NewProjectTile(onCreate: { creating = true }) { url in
                            Task { await studio.importProject(from: url, to: defaultSourceId) }
                        }
                    }
                    ForEach(group.remoteOnly, id: \.doc.id) { row in
                        StudioProjectCard(doc: row.doc, isOpen: false, remoteOnly: true, moveTargets: [],
                                          busy: busyLine(row.doc.id), compact: compact,
                                          onOpen: {
                                              Task {
                                                  if await studio.openRemote(row) { opened = row.doc.id }
                                              }
                                          },
                                          onDelete: { Task { await studio.remove(row.doc, etagHint: row.etag) } },
                                          onDuplicate: {}, onMove: { _ in })
                    }
                }
            }
        }
    }

    private func busyLine(_ id: String) -> String? {
        if studio.opening == id { return "opening…" }
        return gallery.busy[id]
    }

    private func sectionHeader(_ group: DocumentGroup<ProjectDoc>, label: String, known: Bool,
                               count: Int) -> some View {
        HStack(spacing: 0) {
            Eyebrow("source: \(label)")
            Text(" · ").font(Brand.eyebrow).foregroundStyle(palette.faint)
            Eyebrow("\(count) project\(count == 1 ? "" : "s")")
            if !known {
                Text(" · NOT CONNECTED — MEDIA MAY BE UNREACHABLE").font(Brand.eyebrow).foregroundStyle(palette.faint)
            }
            listStatus(group.list)
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }

    @ViewBuilder
    private func listStatus(_ list: RemoteList<RemoteDocRow<ProjectDoc>>?) -> some View {
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

    /// Two columns on a phone, as Trips does — a column of single cards
    /// wastes the half of the screen a 16:9 preview does not need.
    private var columns: [GridItem] {
        compact
            ? [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
            : [GridItem(.adaptive(minimum: 240), spacing: 20)]
    }
}

/// The dashed tile that completes the grid: a way to start a project where
/// the next card would be, and the drop zone for an exported settings file.
struct NewProjectTile: View {
    let onCreate: () -> Void
    let onDropFile: (URL) -> Void
    @Environment(\.palette) private var palette
    @State private var over = false

    var body: some View {
        Button(action: onCreate) {
            VStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 22))
                Text("New project").font(Brand.sans(14, weight: .semibold))
                Text("or drop a \(projectFileExtension) file here").font(Brand.sans(12))
                    .multilineTextAlignment(.center)
            }
            .padding(12)
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

#Preview("Projects") {
    NavigationStack { StudioGallery() }
}
