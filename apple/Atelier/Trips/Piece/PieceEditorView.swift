// The Trips PIECE EDITOR — the view half of the web's `PostEditor.tsx`, in
// the darkroom (a grading screen sits on neutral grey, so the eye does not
// adapt to warm paper and misjudge the frame):
//
// - a wide screen (a Mac, an iPad in regular width): the stage and the band
//   under it on the left, taking the column's whole height — nothing sits
//   above the picture, whose height is what decides a portrait preview's
//   size; the piece's name and its facts atop the inspector on the right, the
//   four tabs a segmented strip, the tab's body scrolling on its own;
// - a phone: the name and `date · kind` on ONE line, the stage flexing, the
//   band under it, and the four tabs the editor's own bottom strip — Content,
//   Look and Export raise a SHEET (a panel you pick FROM), Picture a DOCKED
//   DRAWER that leaves the picture unwashed, since what it sets is judged on
//   it (`frontend.md`, «A phone gets a SHEET or a DRAWER»).
//
// The header bar says ONE word at most (`frontend.md`): the system's way back
// (to the overview, on the piece's day — the path), ⚙ Trip, the history as
// one joined control, the sync pill, and Export — which folds to its glyph
// while the pill speaks and becomes its own progress fill while it runs. The
// task pill is the tool's (`TripsTool`), never added here.
//
// Keys: Space, I/O, L, M — `+Keys`; ← → (Shift ±0.5 s) and Home/End are the
// band's, answered while the keyboard is on it (`Band/`); ⌘Z / ⇧⌘Z are the
// window's UndoManager, handed to the store by the tool.

import SwiftUI
import AtelierKit

struct PieceEditorView: View {
    let store: TripsStore
    let tripId: String
    let postId: String
    @Environment(LibraryStore.self) private var library: LibraryStore?
    @State private var model: PieceEditorModel?

    var body: some View {
        content
            .onAppear(perform: appear)
            .onDisappear { model?.close() }
            .onChange(of: library.map { ObjectIdentifier($0) }) { _, _ in model?.attach(library) }
            .darkroom()
    }

    @ViewBuilder
    private var content: some View {
        if let model, model.post != nil {
            PieceWorkbench(model: model)
        } else if model != nil {
            ContentUnavailableView {
                Label("This piece is gone", systemImage: "rectangle.stack")
            } description: {
                Text("It was deleted, or the trip was replaced by a copy that does not hold it. Go back to the trip to see what it holds now.")
            }
        } else {
            Color.clear
        }
    }

    private func appear() {
        if model == nil {
            model = PieceEditorModel(store: store, tripId: tripId, postId: postId, library: library)
        } else {
            model?.attach(library)
        }
        model?.appeared()
    }
}

// MARK: - the workbench

struct PieceWorkbench: View {
    @Bindable var model: PieceEditorModel
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @Environment(LibraryStore.self) private var library: LibraryStore?
    @State private var drawerFraction = 0.4
    @State private var moving: [URL] = []
    @FocusState private var focused: Bool

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    #else
    private var compact: Bool { false }
    #endif

    var body: some View {
        lifecycle(keyed(presented(layout)))
    }

    @ViewBuilder
    private var layout: some View {
        if compact { phone } else { wide }
    }

    // MARK: - the two layouts

    private var stageColumn: some View {
        VStack(spacing: 10) {
            BadgeStageView(model: model, compact: compact)
                .aspectRatio(model.aspect, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .layoutPriority(1)
            if let error = model.stageError {
                Text(error)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 420)
                    .fixedSize(horizontal: false, vertical: true)
            }
            PieceDeckBand(model: model, compact: compact)
                .frame(maxWidth: compact ? .infinity : 832)
        }
    }

    private var wide: some View {
        HStack(spacing: 0) {
            stageColumn
                .padding(14)
            Rectangle().fill(palette.line).frame(width: 1)
            VStack(alignment: .leading, spacing: 10) {
                PieceNameField(model: model, compact: false)
                PieceInspector(model: model, showsTabs: true)
                    .padding(12)
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
                    .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
            }
            .padding(12)
            .frame(width: 352)
        }
    }

    private var phone: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                PieceNameField(model: model, compact: true)
                    .padding(.horizontal, 12)
                    .padding(.top, 6)
                    .padding(.bottom, 8)
                stageColumn
                    .padding(.horizontal, 8)
                    .padding(.bottom, 12)
                if model.inspectorOpen && model.tab == .picture {
                    PieceInspectorDrawer(model: model, columnHeight: geo.size.height, fraction: $drawerFraction)
                        .transition(.move(edge: .bottom))
                }
                PieceTabStrip(model: model)
            }
        }
    }

    // MARK: - sheets, the bar, the delivery

    private func presented(_ content: some View) -> some View {
        content
            .background(palette.paper)
            .navigationTitle(model.displayTitle)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(palette.paper2, for: .navigationBar)
            .toolbar(compact ? .hidden : .automatic, for: .tabBar)
            #endif
            .toolbar { PieceHeaderBar(model: model) }
            .sheet(isPresented: phoneSheet) {
                PieceInspectorSheet(model: model).darkroom()
            }
            .sheet(isPresented: tripSheet) {
                TripSettingsSheet(store: model.store, tripId: model.tripId, section: model.tripSheet,
                                  postId: model.postId)
            }
            .sheet(isPresented: $model.garageOpen) {
                CarGarageSheet(store: model.store, tripId: model.tripId)
            }
            .sheet(isPresented: $model.developOpen) {
                PieceDevelopSheet(model: model).darkroom()
            }
            .fileMover(isPresented: movingFiles, files: moving) { _ in
                moving = []
                model.exports.discard()
            }
    }

    /// Content, Look and Export on a phone: a sheet over the stage.
    private var phoneSheet: Binding<Bool> {
        Binding(
            get: { compact && model.inspectorOpen && model.tab != .picture },
            set: { if !$0 { model.inspectorOpen = false } }
        )
    }

    private var tripSheet: Binding<Bool> {
        Binding(get: { model.tripSheet != nil }, set: { if !$0 { model.tripSheet = nil } })
    }

    private var movingFiles: Binding<Bool> {
        Binding(get: { !moving.isEmpty }, set: { if !$0 { moving = [] } })
    }

    /// The editor's own keys, read while no field of it types.
    private func keyed(_ content: some View) -> some View {
        content
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onKeyPress(phases: [.down, .repeat]) { press in
                guard let key = EditorKeyPress(press) else { return .ignored }
                return model.handleKey(key) ? .handled : .ignored
            }
    }

    /// What follows the app, the Library, the looks and the export.
    private func lifecycle(_ content: some View) -> some View {
        content
            .publishMediaScope(model.mediaScope)
            .followsActiveAsset(pieceMediaKinds)
            .onAppear { focused = true }
            .onChange(of: library?.tickKey) { _, _ in model.libraryChanged() }
            .onChange(of: model.tab) { _, _ in model.tabChanged() }
            .onChange(of: model.textEditing) { _, typing in if !typing { focused = true } }
            .onChange(of: model.tripSheet) { _, sheet in if sheet == nil { focused = true } }
            .onChange(of: LookLibrary.shared.interpolation) { _, _ in model.lookPreferencesChanged() }
            .onChange(of: LookLibrary.shared.packs.map(\.id)) { _, _ in model.lookPreferencesChanged() }
            .onChange(of: model.exports.exporting == nil) { _, idle in if idle { handOn() } }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active {
                    model.deck.setPlaying(false)
                    model.setClipPlaying(false)
                }
            }
    }

    /// An export finished: its files are handed on — moved where the person
    /// says — and the run's folder let go.
    private func handOn() {
        // A folder picked at the click, or the share sheet (`PieceDelivery`).
        if model.handOnDelivered() { return }
        let files = model.exports.delivered.map(\.url)
        if !files.isEmpty { moving = files }
    }
}

// MARK: - the header bar

/// ⚙ Trip, the joined history, the sync pill and Export — the web's piece bar.
struct PieceHeaderBar: ToolbarContent {
    let model: PieceEditorModel

    var body: some ToolbarContent {
        ToolbarItem(placement: PieceHeaderBar.leading) {
            Button {
                model.tripSheet = "words"
            } label: {
                Label("Trip settings", systemImage: "gearshape")
            }
            .help("Trip settings — the words, the closing card, what a new piece starts from")
        }
        ToolbarItem(placement: .primaryAction) {
            PieceHistoryControl(store: model.store)
        }
        ToolbarItem(placement: .primaryAction) {
            DocumentSyncPill(sync: model.store.sync)
        }
        ToolbarItem(placement: .primaryAction) {
            PieceExportButton(model: model)
        }
    }

    private static var leading: ToolbarItemPlacement {
        #if os(iOS)
        return .topBarLeading
        #else
        return .navigation
        #endif
    }
}

/// Undo and redo as ONE control, always both drawn.
struct PieceHistoryControl: View {
    let store: TripsStore

    var body: some View {
        ControlGroup {
            Button {
                store.undo()
            } label: {
                Label("Undo", systemImage: "arrow.uturn.backward")
            }
            .disabled(!store.canUndo)
            .help("Undo (⌘Z)")
            Button {
                store.redo()
            } label: {
                Label("Redo", systemImage: "arrow.uturn.forward")
            }
            .disabled(!store.canRedo)
            .help("Redo (⇧⌘Z)")
        }
        .fixedSize()
    }
}

/// The piece's ONE primary action. While it runs the button IS the progress:
/// a fill sweeping left to right over a number of fixed width, the sentence
/// in its help — as a label it changed length every percent. It stays
/// pressable while running (a second press is ignored): disabled, the
/// progress would fade. It folds to its glyph while the sync pill speaks.
struct PieceExportButton: View {
    @Bindable var model: PieceEditorModel
    @Environment(\.palette) private var palette

    var body: some View {
        // `exporting` is what the export observes; its `running` is not.
        let running = model.exports.exporting != nil
        let fraction = min(1, max(0, model.exports.progress ?? 0))
        Button {
            if !running { model.requestExport(.piece(imagesOnly: false)) }
        } label: {
            face(running ? palette.ink : palette.onMedia)
                .frame(minWidth: folds ? 34 : 97, minHeight: 34)
                .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(running ? palette.paper : palette.accent))
                .overlay { if running { fill(fraction) } }
                .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.lineStrong, lineWidth: running ? 1 : 0))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
        .accessibilityAddTraits(running ? .updatesFrequently : [])
    }

    /// The pill speaking — a conflict, a sign-in — takes the bar's one word.
    private var folds: Bool {
        guard model.store.sync.showsPill, let record = model.store.sync.record else { return false }
        return pillNeedsAction(record.status)
    }

    private var title: String {
        if let line = model.exports.exporting { return "\(line) — every slide of this piece" }
        return "Export every slide of this piece, in the format it is"
    }

    private var word: String {
        guard model.exports.exporting != nil else { return "Export" }
        guard let p = model.exports.progress else { return "…" }
        return "\(Int((p * 100).rounded())) %"
    }

    private func face(_ ink: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 13, weight: .semibold))
            if !folds {
                Text(word)
                    .font(Brand.sans(13, weight: .semibold))
                    .monospacedDigit()
            }
        }
        .foregroundStyle(ink)
        .padding(.horizontal, folds ? 0 : 12)
    }

    private func fill(_ fraction: Double) -> some View {
        GeometryReader { geo in
            face(palette.paper)
                .frame(width: geo.size.width, height: geo.size.height)
                .background(palette.ink)
                .mask(alignment: .leading) {
                    Rectangle().frame(width: geo.size.width * CGFloat(fraction))
                }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - the name

/// The piece's name, edited in place — a piece is found again by what it is
/// called — with `date · kind` under it, or beside it on a phone, where every
/// point it takes is one the picture does not get.
struct PieceNameField: View {
    @Bindable var model: PieceEditorModel
    let compact: Bool
    @Environment(\.palette) private var palette
    @FocusState private var focused: Bool

    var body: some View {
        if compact {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                field
                facts.fixedSize()
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                field
                facts
            }
        }
    }

    private var field: some View {
        TextField("Untitled piece", text: title)
            .font(Brand.display(compact ? 16 : 22))
            .foregroundStyle(palette.ink)
            .textFieldStyle(.plain)
            .focused($focused)
            .onChange(of: focused) { _, on in model.textEditing = on }
            .onSubmit { focused = false }
            .accessibilityLabel("What this piece shows")
    }

    private var facts: some View {
        Text(model.facts)
            .font(Brand.mono(10))
            .foregroundStyle(palette.muted)
            .lineLimit(1)
    }

    /// Every keystroke writes the piece — merged into one undo step under the piece's label.
    private var title: Binding<String> {
        Binding(
            get: { model.post?.title ?? "" },
            set: { next in model.updatePost { $0.title = next } }
        )
    }
}

#Preview("Piece editor") {
    NavigationStack {
        PieceEditorView(store: PieceEditorFixtures.store(), tripId: PieceEditorFixtures.tripId,
                        postId: PieceEditorFixtures.postId)
    }
}
