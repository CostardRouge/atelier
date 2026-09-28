// The Studio editor's side of the shell's LIBRARY, as one modifier on the
// workbench (`StudioEditor+Library.swift` holds what it does):
//
// - `.followsActiveAsset(Tool.studio.accepts)`: the Library's active asset is
//   kept one the Studio can edit, its cover asked for — `use-active-asset.ts`;
// - an asset PUT TO WORK in the Library while the editor is on screen joins
//   the project and opens (the Library's `activations`, so a second tap on
//   the active row counts, and an echo does not). Only while ON SCREEN: on a
//   phone every tab's stack stays alive, and a tap made for Develop must not
//   add a picture to a project nobody is looking at — nor does opening a
//   project take whatever the Library last had active;
// - the other way, the media the editor opens becomes the Library's active
//   one whenever the Library's selection holds it (the ring on its row);
// - the open media's capture day is published as the Library's span.

import SwiftUI
import AtelierKit

extension View {
    /// Link this editor to the shell's Library for as long as it is on screen.
    func studioLibraryLink(_ editor: StudioEditor) -> some View {
        modifier(StudioLibraryLink(editor: editor))
    }
}

private struct StudioLibraryLink: ViewModifier {
    let editor: StudioEditor
    @Environment(LibraryStore.self) private var pool: LibraryStore?
    @State private var onScreen = false

    func body(content: Content) -> some View {
        content
            .followsActiveAsset(Tool.studio.accepts)
            .publishMediaScope(editor.mediaScope)
            .onAppear { onScreen = true }
            .onDisappear { onScreen = false }
            .onChange(of: pool?.activations) { _, _ in follow() }
            .onChange(of: editor.activeId) { _, id in echo(id) }
    }

    /// The asset the person just put to work, taken into the project.
    private func follow() {
        // The asset ACTIVATED — never the first usable one the Library would
        // fall back on for an asset the Studio cannot edit.
        guard onScreen, let pool, let id = pool.activeId, let asset = pool.asset(id) else { return }
        editor.take(asset, from: pool)
    }

    /// The media on the stage is the Library's active one, where the
    /// Library's selection holds it — never a pick of the Library's own.
    private func echo(_ id: String?) {
        guard onScreen, let pool, let id, pool.activeId != id else { return }
        let state = pool.activeState(Tool.studio.accepts)
        guard state.assets.contains(where: { $0.id == id }) else { return }
        pool.setActive(id)
    }
}
