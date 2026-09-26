// The Studio EDITOR over one project — the web's `StudioEditor.tsx` laid out
// natively, in the darkroom (neutral grey, so the eye does not adapt to warm
// paper and misjudge the frame):
//
// - a wide screen (a Mac, an iPad in regular width): the project bar, the
//   media banners, the clip header, the stage, the transport and the notices
//   in the main column; the inspector a 340 pt column at the right, its five
//   tabs pinned at its top;
// - a phone: the same column with the stage FLEXING, the inspector a DOCKED
//   DRAWER under it (never a sheet over the picture being judged), its tabs
//   the drawer's own strip at the bottom — the app's tab bar hides inside the
//   editor.
//
// The project's NAME is the navigation bar's title, renamed in place; the
// project bar under it holds undo / redo, the sync pill of a project kept on
// an instance, the local save state (a dot and a word, the word only where it
// waits on the author on a phone) and the format chip that opens the settings.
// Media come in from Photos, Files or a folder (the Add menu, a drop), and
// every key the web binds is read here: Space plays (a field keeps it),
// `I` / `O` cut, ← → step, ⌫ removes the selected element, ⌘Z / ⇧⌘Z are the
// window's UndoManager.

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct StudioEditorView: View {
    let projectId: String
    @State private var studio = StudioStore.shared
    @State private var editor: StudioEditor?
    @Environment(\.palette) private var palette

    var body: some View {
        Group {
            if let editor {
                StudioWorkbench(editor: editor)
                    .id(editor.generation)
            } else if studio.open?.doc.id != projectId {
                ContentUnavailableView {
                    Label("This project is not open", systemImage: "film.stack")
                } description: {
                    Text("Go back to the projects and open it again — its media folder is asked for then.")
                }
            } else {
                Color.clear
            }
        }
        .onChange(of: studio.open?.generation, initial: true) { _, _ in rebuild() }
        // Leaving the page SUSPENDS the editor (the owed save written, the
        // clip paused) and keeps it: coming back to the same project resumes
        // its playhead, its selection and its history. The store closes it
        // when another project opens or this one is replaced or deleted.
        .onDisappear { editor?.suspend() }
        .darkroom()
    }

    /// A document replaced UNDER the editor (take theirs, keep as local) is a
    /// new generation: the editor seeds itself from the document when it
    /// opens, so it starts again to see the new copy.
    private func rebuild() {
        guard let open = studio.open, open.doc.id == projectId else {
            editor = nil
            return
        }
        if let editor, editor.generation == open.generation, editor.projectId == projectId { return }
        if let live = studio.liveEditor, live.projectId == projectId, live.generation == open.generation {
            editor = live
            return
        }
        studio.liveEditor?.close()
        let made = StudioEditor(store: studio, open: open)
        studio.liveEditor = made
        editor = made
        made.start()
    }
}

struct StudioWorkbench: View {
    @Bindable var editor: StudioEditor
    @Environment(\.palette) private var palette
    @Environment(\.undoManager) private var undoManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var drawerFraction = 0.4
    @State private var importing: ImportKind?
    @State private var showPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var dropping = false
    @State private var grabbing = false
    @State private var grabbed: InstrumentExportFile?
    @State private var grabProblem: String?
    @FocusState private var focused: Bool

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    #else
    private var compact: Bool { false }
    #endif

    /// What the one file importer is asked for — two importers on one view
    /// answer only the last.
    enum ImportKind {
        case files, folder, repoint
    }

    var body: some View {
        Group {
            if compact { phone } else { wide }
        }
        // The frame grab's save panel and the Photos picker each on a view of
        // their own: file panels chained on ONE view answer only the last.
        .background {
            Color.clear
                .fileExporter(isPresented: Binding(get: { grabbed != nil }, set: { if !$0 { grabbed = nil } }),
                              document: grabbed, contentType: .jpeg,
                              defaultFilename: grabbed?.name ?? "frame.jpg") { _ in
                    grabbed = nil
                }
        }
        .background {
            Color.clear
                .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 50,
                              matching: .any(of: [.videos, .images]), preferredItemEncoding: .current)
        }
        .background(palette.paper)
        .overlay { if dropping { dropVeil } }
        .dropDestination(for: URL.self) { urls, _ in
            editor.library.add(urls: urls)
            return true
        } isTargeted: { dropping = $0 }
        .navigationTitle(editor.edit.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(palette.paper2, for: .navigationBar)
        .toolbar(compact ? .hidden : .automatic, for: .tabBar)
        #endif
        .toolbar { toolbar }
        .fileImporter(isPresented: Binding(get: { importing != nil }, set: { if !$0 { importing = nil } }),
                      allowedContentTypes: importing == .files ? InstrumentFileTypes.media + [.folder] : [.folder],
                      allowsMultipleSelection: importing == .files) { result in
            let kind = importing
            importing = nil
            guard case .success(let urls) = result else { return }
            switch kind {
            case .repoint:
                if let folder = urls.first { Task { await editor.store.repoint(folder) } }
            default:
                editor.library.add(urls: urls)
            }
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                for item in items {
                    if let file = try? await item.loadTransferable(type: PickedMediaFile.self) {
                        editor.library.add(receivedCopy: file.url)
                        try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent())
                    }
                }
                photoItems = []
            }
        }
        .sheet(isPresented: $editor.settingsOpen) {
            ProjectSettingsSheet(editor: editor).darkroom()
        }
        .sheet(isPresented: $editor.developOpen) {
            StudioDevelopSheet(editor: editor)
        }
        // Keys: the editor's own, read while no field of it types.
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: [.down, .repeat]) { press in
            guard let key = EditorKeyPress(press) else { return .ignored }
            return editor.handleKey(key) ? .handled : .ignored
        }
        .documentSyncLifecycle(editor.store.sync)
        .onAppear {
            editor.undoManager = undoManager
            focused = true
        }
        .onChange(of: undoManager) { _, manager in editor.undoManager = manager }
        .onChange(of: editor.library.assets) { _, _ in editor.mediaChanged() }
        .onChange(of: editor.playback.duration) { _, _ in editor.clipDurationChanged() }
        .onChange(of: LookLibrary.shared.packs.map(\.id)) { _, _ in editor.refreshLook() }
        .onChange(of: LookLibrary.shared.interpolation) { _, _ in
            editor.refreshLook()
        }
        .onChange(of: editor.textEditing) { _, typing in if !typing { focused = true } }
        .onChange(of: editor.settingsOpen) { _, open in if !open { focused = true } }
        .onChange(of: editor.developOpen) { _, open in if !open { focused = true } }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                editor.playback.pause()
                Task { await editor.flushSave() }
            }
        }
        .task(id: editor.activeVideo.map(fileIdentity)) {
            // The clip's frames, read as they come — about sixty looks a second.
            guard editor.activeVideo != nil else { return }
            while !Task.isCancelled {
                editor.frameTick()
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
        .alert("No frame to capture", isPresented: Binding(get: { grabProblem != nil }, set: { if !$0 { grabProblem = nil } })) {
            Button("OK", role: .cancel) { grabProblem = nil }
        } message: {
            Text(grabProblem ?? "")
        }
    }

    // MARK: - the two layouts

    private var column: some View {
        VStack(alignment: .leading, spacing: 10) {
            StudioProjectBar(editor: editor, compact: compact)
            StudioMediaBanners(editor: editor, onRepoint: { importing = .repoint })
            if editor.active != nil { StudioMediaHeader(editor: editor) }
            StudioStageView(editor: editor, compact: compact, emptyText: emptyText)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .frame(minHeight: compact ? 180 : 240)
            StudioTransportBar(editor: editor, onGrab: grab, grabbing: grabbing)
            StudioStageNotices(editor: editor)
        }
    }

    private var wide: some View {
        HStack(spacing: 0) {
            column
                .padding(.horizontal, 14)
                .padding(.top, 10)
                .padding(.bottom, 10)
            if editor.active != nil {
                Rectangle().fill(palette.line).frame(width: 1)
                StudioInspector(editor: editor, showsTabs: true)
                    .frame(width: 340)
                    .background(palette.surface)
            }
        }
    }

    private var phone: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                column
                    .padding(.horizontal, 8)
                    .padding(.top, 6)
                    .padding(.bottom, 6)
                if editor.active != nil {
                    if editor.inspectorOpen {
                        StudioInspectorDrawer(editor: editor, columnHeight: geo.size.height, fraction: $drawerFraction)
                            .transition(.move(edge: .bottom))
                    }
                    StudioSectionStrip(editor: editor)
                }
            }
        }
    }

    // MARK: - the bar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            StudioProjectTitle(editor: editor, compact: compact)
        }
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button { showPhotos = true } label: { Label("From Photos…", systemImage: "photo.on.rectangle") }
                Button { importing = .files } label: { Label("From Files…", systemImage: "doc") }
                    .keyboardShortcut("o", modifiers: [.command])
                Button { importing = .folder } label: { Label("A folder…", systemImage: "folder") }
                Divider()
                Button { importing = .repoint } label: {
                    Label("Point to the media folder…", systemImage: "folder.badge.gearshape")
                }
            } label: {
                Label("Add media", systemImage: "plus")
            }
        }
    }

    // MARK: - a drop, and the empty stage

    private var dropVeil: some View {
        ZStack {
            palette.frame.opacity(0.55)
            Text("Drop clips, their .srt, photos or their folder: they join this project's media.")
                .font(Brand.sans(16))
                .foregroundStyle(palette.onMedia)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: 420)
        }
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.accent, style: StrokeStyle(lineWidth: 2, dash: [8, 5])))
        .allowsHitTesting(false)
    }

    private var emptyText: String {
        if editor.clips.isEmpty {
            return "No media in this project yet — add clips or photos with +, or point to the media folder from the menu."
        }
        if let problem = editor.photoProblem { return problem }
        if let failure = editor.playback.failure { return failure }
        return editor.isPhoto ? "Decoding the photo…" : "Select a clip to edit."
    }

    /// ⌾ — the composed frame under the playhead, saved where the person says.
    private func grab() {
        guard !grabbing else { return }
        grabbing = true
        Task {
            let file = await editor.grabFrame()
            grabbing = false
            if let file {
                grabbed = file
            } else {
                grabProblem = "No decoded frame to capture yet — play or scrub first."
            }
        }
    }
}
