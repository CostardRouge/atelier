// The Develop EDITOR over one roll — the web's `RollEditor.tsx` +
// `PictureWorkbench.tsx` laid out natively, in the darkroom:
//
// - a wide screen (a Mac, an iPad in regular width): the stage bar, the
//   stage, the roll's status line and the filmstrip in the main column, the
//   inspector a column at the right with its five tabs pinned at its top;
// - a phone: the bar on two lines (the name, then the verbs at a finger's
//   height), the stage FLEXING, the status line, the strip, the inspector a
//   DOCKED DRAWER under them (never a sheet over the picture being judged),
//   and the five sections as the drawer's own strip at the bottom — the app's
//   tab bar hides inside the editor.
//
// The navigation bar holds the roll's name (renamed in place — an emptied
// field gives the old name back), undo / redo and ONE Add menu (Photos, Files,
// a folder, a variant of the open picture). Every key the web binds is read
// here and handed to the store (`RollEditor.handleKey`); the ⌘ chords are the
// platform's (`EditorCommands.swift`).

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct RollEditorView: View {
    let rollId: String
    @Environment(RollStore.self) private var store
    @Environment(PicturePool.self) private var pool
    @Environment(PresetBookStore.self) private var presets
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
            if editor == nil {
                let made = RollEditor(store: store, pool: pool, presets: presets, rollId: rollId)
                // Every pass a picture carries, in the web's order, for the
                // stage, the snapshot and the export alike.
                made.installFullRenderPlan()
                editor = made
            }
        }
        .onDisappear { editor?.close() }
        .darkroom()
    }
}

struct RollWorkbench: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @Environment(\.undoManager) private var undoManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var zoom = LookingZoom()
    @State private var showPhotos = false
    @State private var importing: ImportKind?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var dropping = false
    @State private var drawerFraction = 0.4
    @FocusState private var focused: Bool

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    #else
    private var compact: Bool { false }
    #endif

    var body: some View {
        Group {
            if editor.pictures.isEmpty {
                emptyRoll
            } else if compact {
                phone
            } else {
                wide
            }
        }
        .background(palette.paper)
        .overlay { if dropping { dropVeil } }
        .overlay(alignment: .top) { if editor.store.storageFailed { storageBanner } }
        .dropDestination(for: URL.self) { urls, _ in
            editor.addFiles(urls)
            return true
        } isTargeted: { dropping = $0 }
        .navigationTitle(editor.roll?.name ?? "Roll")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(palette.paper2, for: .navigationBar)
        .toolbar(compact ? .hidden : .automatic, for: .tabBar)
        #endif
        .toolbar { toolbar }
        // Pushed over the gallery with a bar of its own: the pill comes too.
        .taskPill()
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 200, matching: .images)
        // ONE importer, two kinds: two `fileImporter`s on one view answer only the last.
        .fileImporter(isPresented: Binding(get: { importing != nil }, set: { if !$0 { importing = nil } }),
                      allowedContentTypes: importing == .folder ? [.folder] : [.image, .rawImage],
                      allowsMultipleSelection: importing != .folder) { result in
            let kind = importing
            importing = nil
            guard case .success(let urls) = result else { return }
            if kind == .folder, let folder = urls.first {
                editor.addFolder(folder)
            } else {
                editor.addFiles(urls)
            }
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                await editor.addFromPhotos(items)
                photoItems = []
            }
        }
        .sheet(isPresented: $editor.settingsOpen) {
            SettingsSheet(editor: editor).darkroom()
        }
        .sheet(isPresented: $editor.helpOpen) {
            ShortcutsSheet().darkroom()
        }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { editor.confirmRemove != nil },
                                                                 set: { if !$0 { editor.confirmRemove = nil } }),
                            titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                if let p = editor.confirmRemove { editor.remove(p) }
                editor.confirmRemove = nil
            }
            Button("Cancel", role: .cancel) { editor.confirmRemove = nil }
        } message: {
            if let p = editor.confirmRemove {
                Text("What was done to it goes with it — \(pictureEdits(p).map(\.rawValue).joined(separator: ", ")). The file stays where it is.")
            }
        }
        // Keys: the editor's own, read while no field of it types.
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: [.down, .repeat, .up]) { press in
            guard let key = EditorKeyPress(press) else { return .ignored }
            if press.phase == .up {
                editor.handleKeyUp(key.key)
                return .ignored
            }
            return editor.handleKey(key, zoom: zoom) ? .handled : .ignored
        }
        #if os(macOS)
        .onCopyCommand {
            guard !editor.asShot, !editor.textEditing else { return [] }
            editor.copyDevelopHere()
            return [NSItemProvider(object: describeDevelop(editor.developDraft) as NSString)]
        }
        .onPasteCommand(of: [.plainText, .utf8PlainText, .json]) { _ in
            guard !editor.textEditing else { return }
            editor.pasteDevelopHere()
        }
        #else
        .background { EditorChordButtons(editor: editor) }
        #endif
        .focusedSceneValue(\.rollEditor, editor)
        .onAppear {
            editor.undoManager = undoManager
            focused = true
        }
        .onChange(of: undoManager) { _, manager in editor.undoManager = manager }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                editor.flushDrafts()
                editor.store.flush()
                editor.presets.flush()
            }
        }
        // The keys come back to the editor when a sheet or a field lets them go.
        .onChange(of: editor.settingsOpen) { _, open in if !open { focused = true } }
        .onChange(of: editor.helpOpen) { _, open in if !open { focused = true } }
        .onChange(of: editor.textEditing) { _, typing in if !typing { focused = true } }
        // The crop stage takes the keys once pressed (its arrows nudge the
        // zone); leaving the Crop tab takes it away, and the keys come back here.
        .onChange(of: editor.tab) { old, _ in if old == .crop { focused = true } }
    }

    /// What the one file importer is asked for.
    enum ImportKind {
        case files, folder
    }

    /// A refused local write is SAID, never swallowed — the web's banner.
    private var storageBanner: some View {
        Text("This roll could not be saved — the device refused the write (the disk is full, or the app's storage is not writable). Your edits are still on screen.")
            .font(Brand.sans(13))
            .foregroundStyle(palette.accentInk)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.accent, lineWidth: 1))
            .padding(10)
            .accessibilityAddTraits(.isStaticText)
    }

    private var confirmTitle: String {
        editor.confirmRemove.map { "Take \(pictureLabel($0)) off the roll?" } ?? ""
    }

    // MARK: - the two layouts

    private var wide: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                StageBar(editor: editor, zoom: zoom, compact: false)
                DevelopStageView(editor: editor, zoom: zoom, emptyText: emptyText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                ProgressLine(editor: editor, onReopenFolder: { importing = .folder })
                FilmstripView(editor: editor, compact: false)
                    .frame(height: 86)
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 6)
            Rectangle().fill(palette.line).frame(width: 1)
            InspectorView(editor: editor, showsTabs: true)
                .frame(width: 340)
                .background(palette.surface)
        }
    }

    private var phone: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    StageBar(editor: editor, zoom: zoom, compact: true)
                    DevelopStageView(editor: editor, zoom: zoom, emptyText: emptyText)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    // Housekeeping wraps to lines a phone pays for in picture:
                    // back as soon as the drawer is down.
                    if !editor.inspectorOpen {
                        ProgressLine(editor: editor, onReopenFolder: { importing = .folder })
                    }
                    FilmstripView(editor: editor, compact: true)
                        .frame(height: 68)
                }
                .padding(.horizontal, 8)
                .padding(.top, 6)
                if editor.inspectorOpen {
                    InspectorDrawer(editor: editor, columnHeight: geo.size.height, fraction: $drawerFraction)
                        .transition(.move(edge: .bottom))
                }
                SectionStrip(editor: editor)
            }
        }
    }

    // MARK: - an empty roll, and a drop

    private var emptyRoll: some View {
        ContentUnavailableView {
            Label("No pictures on this roll yet", systemImage: "photo.on.rectangle")
        } description: {
            Text("Pick photographs in Photos, files or a folder of your own, or drop them here. The roll keeps a reference to each and its own numbers, never a copy of a file you pointed at.")
        } actions: {
            Button("Add a folder…") { importing = .folder }
                .buttonStyle(.borderedProminent)
            Button("From Photos…") { showPhotos = true }
                .buttonStyle(.bordered)
            Button("From Files…") { importing = .files }
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var dropVeil: some View {
        ZStack {
            palette.frame.opacity(0.55)
            Text("Drop photographs or their folder: pictures already on the roll are found again, the others are added.")
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
        guard let p = editor.picture else { return "No picture to develop yet." }
        return availabilityText(p.ref.name, editor.availability(p))
    }

    // MARK: - the bar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            RollTitle(editor: editor, compact: compact)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            ControlGroup {
                Button {
                    editor.undo()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .disabled(!editor.canUndoRoll)
                Button {
                    editor.redo()
                } label: {
                    Label("Redo", systemImage: "arrow.uturn.forward")
                }
                .disabled(!editor.canRedoRoll)
            }
            Menu {
                Button { showPhotos = true } label: { Label("From Photos…", systemImage: "photo.on.rectangle") }
                Button { importing = .files } label: { Label("From Files…", systemImage: "doc") }
                Button { importing = .folder } label: { Label("A folder…", systemImage: "folder") }
                if let open = editor.picture {
                    Divider()
                    Button {
                        editor.makeVariant(.clone)
                    } label: {
                        Label("A variant of \(pictureLabel(open)), as edited", systemImage: "square.on.square")
                    }
                    Button {
                        editor.makeVariant(.fresh)
                    } label: {
                        Label("A variant of \(pictureLabel(open)), as shot", systemImage: "square.dashed")
                    }
                }
            } label: {
                Label("Add", systemImage: "plus")
            }
        }
    }
}

/// The roll's name on the bar, renamed in place — the trip title's rule: an
/// emptied field gives the old name back rather than saving a blank.
struct RollTitle: View {
    @Bindable var editor: RollEditor
    let compact: Bool
    @Environment(\.palette) private var palette
    @State private var draft: String?
    @FocusState private var focused: Bool

    var body: some View {
        let name = editor.roll?.name ?? ""
        if draft != nil {
            TextField("Roll name", text: Binding(get: { draft ?? "" }, set: { draft = $0 }))
                .font(Brand.display(compact ? 18 : 22))
                .textFieldStyle(.plain)
                .multilineTextAlignment(.center)
                .frame(minWidth: 160, maxWidth: 360)
                .focused($focused)
                .onSubmit(commit)
                .onChange(of: focused) { _, isFocused in
                    editor.textEditing = isFocused
                    if !isFocused { commit() }
                }
                #if os(macOS)
                .onExitCommand { cancel() }
                #endif
                .onAppear { focused = true }
        } else {
            Button {
                draft = name
            } label: {
                Text(name.isEmpty ? "Untitled roll" : name)
                    .font(Brand.display(compact ? 18 : 22))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .help("Rename the roll")
        }
    }

    private func commit() {
        guard let value = draft else { return }
        let next = value.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = nil
        editor.textEditing = false
        guard !next.isEmpty, next != editor.roll?.name else { return }
        editor.update { r in
            var out = r
            out.name = next
            out.updatedAt = nowMillis()
            return out
        }
    }

    private func cancel() {
        draft = nil
        editor.textEditing = false
    }
}
