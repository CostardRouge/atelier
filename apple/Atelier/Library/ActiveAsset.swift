// The active-asset protocol every editor-style tool repeats — the native twin
// of the web's `use-active-asset.ts`: project the Library's SELECTION down to
// the kinds the tool accepts, resolve the active asset (the Library's focused
// one when this tool can use it, else the first), echo it back so the
// Library's row wears the ring and a removed asset repoints to the first, ask
// for its cover, and step ‹ › through the rest.
//
// A tool reads `library.activeState(kinds)` in its body and puts
// `.followsActiveAsset(kinds)` on its screen; the echo is a side effect, so it
// runs in a task keyed on what it reads, never while the body is drawn. Pass
// `kinds` as a constant (`Tool.accepts`).

import SwiftUI
import AtelierKit

/// What a tool works on, out of the Library.
struct ActiveAssetState: Equatable {
    /// The usable selected assets, in the Library's order.
    let assets: [Asset]
    /// The one it works on: the Library's active one when usable, else the first.
    let activeId: String?

    var active: Asset? { activeId.flatMap { id in assets.first { $0.id == id } } }
    var activeIndex: Int { activeId.flatMap { id in assets.firstIndex { $0.id == id } } ?? -1 }
}

extension LibraryStore {
    /// The tool's view of the pool (`useActiveAsset`'s projection).
    func activeState(_ kinds: [AssetKind]) -> ActiveAssetState {
        let usable = selectedUsableAssets(kinds, assets, selection)
        let focused = activeId.flatMap { id in usable.contains { $0.id == id } ? id : nil }
        return ActiveAssetState(assets: usable, activeId: focused ?? usable.first?.id)
    }

    /// Echo the effective active asset back to the Library and ask for its cover.
    func settleActive(_ kinds: [AssetKind]) {
        let state = activeState(kinds)
        if state.activeId != activeId { setActive(state.activeId) }
        if let id = state.activeId { ensureCover(id) }
    }

    /// ‹ › — the previous or the next usable asset; nothing past either end.
    func stepActive(_ kinds: [AssetKind], by delta: Int) {
        let state = activeState(kinds)
        let next = state.activeIndex + delta
        guard state.activeIndex >= 0, state.assets.indices.contains(next) else { return }
        setActive(state.assets[next].id)
    }
}

extension View {
    /// Keep the Library's active asset one this screen's tool can use, for as
    /// long as the screen is up. Tolerant of a missing Library (a preview).
    func followsActiveAsset(_ kinds: [AssetKind]) -> some View {
        modifier(ActiveAssetFollower(kinds: kinds))
    }
}

private struct ActiveAssetFollower: ViewModifier {
    let kinds: [AssetKind]
    @Environment(LibraryStore.self) private var library: LibraryStore?

    private var key: String {
        guard let library else { return "" }
        // A set's hash does not depend on its order: a swap of one tick for
        // another is a new key, a redraw is not.
        return "\(library.activeId ?? "")|\(library.selection.hashValue)|\(library.assets.count)"
    }

    func body(content: Content) -> some View {
        content.task(id: key) { library?.settleActive(kinds) }
    }
}
