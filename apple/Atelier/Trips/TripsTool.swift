// The Trips tool as the shell draws it: ONE navigation stack whose path is
// where you are (`TripsRoute`) — the gallery at its root, a trip's overview
// pushed on it, a piece pushed on the overview — so Back lands on the day
// you were on, as the web's hash route does. The shell gives every other tool
// a stack of its own (`Tool.stack`); Trips keeps this one because its path is
// its state, and the path lives in `TripsShell.shared`, so leaving the tool
// and coming back finds you where you were.
//
// Also here, as on the web's `RoadTripTool.tsx`:
// - the one `TripsStore` (and the shell) put in the environment for every
//   screen of the tool;
// - the window's `UndoManager` handed to the store, so ⌘Z walks the trip's
//   steps natively;
// - the push on the way out (`documentSyncLifecycle`): leaving the tool or
//   the foreground pushes a trip kept on an instance;
// - the two banners over every screen: a refused local write (the edits
//   stay on screen), and the note a timeline or deduce sheet leaves when a
//   trip's dates grew to hold a leg, with its dismiss;
// - a link's place (`App/AppLinks.swift`, `TripsShell.follow`): the path is
//   set, and this stack follows it;
// - the task pill on the gallery's bar and on each pushed screen's own bar.
//   The pushed screens (`PendingScreens.swift`'s contract) must not add it a
//   second time.

import SwiftUI
import AtelierKit

struct TripsTool: View {
    @State private var shell = TripsShell.shared
    @Environment(\.undoManager) private var undoManager

    var body: some View {
        NavigationStack(path: $shell.path) {
            TripGallery()
                .tripsBanners()
                .taskPill()
                .navigationDestination(for: TripsRoute.self) { route in
                    destination(route)
                }
        }
        .environment(shell)
        .environment(shell.store)
        .documentSyncLifecycle(shell.store.sync)
        // A Winnow link's timeline import (`App/AppLinks.swift`), asleep while
        // `timelineSyncEnabled` is off.
        .timelineLinkSheet()
        .onAppear { shell.store.undoManager = undoManager }
        .onChange(of: undoManager) { _, manager in shell.store.undoManager = manager }
    }

    @ViewBuilder
    private func destination(_ route: TripsRoute) -> some View {
        switch route {
        case .trip(let id, let day):
            TripOverviewView(
                store: shell.store,
                tripId: id,
                day: shell.dayBinding(tripId: id, initial: day),
                openPiece: { postId, day in shell.openPiece(tripId: id, postId: postId, day: day) }
            )
            .tripsBanners()
            .taskPill()
        case .piece(let tripId, _, let postId):
            PieceEditorView(store: shell.store, tripId: tripId, postId: postId)
                .tripsBanners()
                .taskPill()
        }
    }
}

// MARK: - the banners over every screen

private struct TripsBanners: ViewModifier {
    @Environment(TripsShell.self) private var shell
    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 8) {
                if shell.store.storageFailed {
                    Text("This trip could not be saved — this device refused to write it (the disk is full, or the app’s storage is not writable). Your edits are still on screen.")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.accentInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.accent, lineWidth: 1))
                        .accessibilityAddTraits(.isStaticText)
                }
                if let note = shell.spanNote, !shell.path.isEmpty {
                    HStack(spacing: 12) {
                        Text(note)
                            .font(Brand.sans(12))
                            .foregroundStyle(palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button {
                            shell.spanNote = nil
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(palette.faint)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Dismiss")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                    .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
                }
            }
            .padding(.horizontal, showsAny ? 12 : 0)
        }
    }

    private var showsAny: Bool {
        if shell.store.storageFailed { return true }
        return shell.spanNote != nil && !shell.path.isEmpty
    }
}

extension View {
    /// The tool's banners — a refused write, a trip whose dates grew — over this screen.
    func tripsBanners() -> some View {
        modifier(TripsBanners())
    }
}

#Preview("Trips") {
    TripsTool()
}
