// Dragging a picture OUT of the Library onto something that wants one — a
// roll's filmstrip, one day a collage's cell. The native half of the web's
// `asset-drag.ts` + `use-asset-drag.ts`; the key's text is the kernel's
// (`Library/AssetDrag.swift`).
//
// Two channels, as on the web: the drag carries TEXT — our prefix and a key —
// which is all SwiftUI's `.draggable` can carry and what a drop outside the
// app pastes (something inert rather than nothing); the drag ITEM lives in
// memory here for the length of the drag, keyed by that text, so it can carry
// what text cannot: the picture's name for the target to say, and a `resolve`
// that hands the file over — at once for a picture in the Library, after a
// fetch for a tile an instance still holds.
//
// One departure: SwiftUI tells a `.draggable` source nothing when its drag
// ends, so a target cannot light up before the pointer reaches it (the web's
// `subscribeAssetDrag`) — a target says it is targeted while it is under the
// pointer, and says the picture is ARRIVING once it is dropped.

import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

/// The picture a drop hands over.
struct DroppedAsset {
    /// The Library asset it is (or just became).
    let assetId: String
    /// The file to work over — its name, weight, date and identity.
    let ref: SavedMediaRef
    /// Where its bytes are on this device.
    let location: LibraryLocation
    /// Where a source said it came from, for a fetched proxy.
    let origin: MediaOrigin?
}

/// What is being dragged.
struct AssetDragItem {
    /// The source's own key (`asset:<id>`, `remote:<host>/<id>`).
    let key: String
    /// The picture's name, as a drop target says it.
    let label: String
    /// `library` lands at once, `instance` is fetched on drop.
    let origin: AssetDragOrigin
    /// The instance it is fetched from, for what a target says while it waits.
    var sourceLabel: String? = nil
    /// The picture itself — nil when it could not be had (the source shows why).
    let resolve: @MainActor () async -> DroppedAsset?
}

/// The drags in memory, by key. Not an actor: the payload a `.draggable` is
/// handed may be built wherever SwiftUI builds it.
final class AssetDragRegistry: @unchecked Sendable {
    static let shared = AssetDragRegistry()

    private let lock = NSLock()
    private var items: [String: AssetDragItem] = [:]

    /// Remember `item` for the drag it starts, and hand back what the drag carries.
    func begin(_ item: AssetDragItem) -> AssetDragToken {
        lock.lock()
        items[item.key] = item
        lock.unlock()
        return AssetDragToken(text: assetDragText(item.key))
    }

    /// The item a dropped text names, or nil when it is not ours.
    func item(forText text: String) -> AssetDragItem? {
        guard let key = draggedAssetKey(text) else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return items[key]
    }

    /// A source that leaves (its row removed) takes its drag with it.
    func forget(_ key: String) {
        lock.lock()
        items[key] = nil
        lock.unlock()
    }
}

/// What a drag carries: our text, and nothing a file browser would open.
struct AssetDragToken: Transferable {
    let text: String

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: \.text)
    }
}

// MARK: - the source's side

extension View {
    /// Make this view the handle of a drag carrying `item` — nothing when nil
    /// (an asset this tool cannot use drags nowhere).
    @ViewBuilder
    func assetDragSource(_ item: AssetDragItem?) -> some View {
        if let item {
            draggable(AssetDragRegistry.shared.begin(item))
        } else {
            self
        }
    }
}

// MARK: - the target's side

extension View {
    /// Take a picture dragged out of the Library — and, when `onFiles` is
    /// given, files dragged in from Files or the Finder, so a surface that
    /// already took them keeps doing so.
    func libraryDropDestination(isTargeted: Binding<Bool>,
                                onAsset: @escaping @MainActor (AssetDragItem) -> Void,
                                onFiles: (@MainActor ([URL]) -> Void)? = nil) -> some View {
        onDrop(of: [.fileURL, .utf8PlainText, .plainText], isTargeted: isTargeted) { providers in
            LibraryDropReader.read(providers, onAsset: onAsset, onFiles: onFiles)
        }
    }
}

/// The URLs a drop's providers hand over, gathered across their callbacks.
private final class DroppedURLs: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []

    func add(_ url: URL) {
        lock.lock()
        urls.append(url)
        lock.unlock()
    }

    var all: [URL] {
        lock.lock()
        defer { lock.unlock() }
        return urls
    }
}

private enum LibraryDropReader {
    /// Whether any provider carries something this target takes; the reading
    /// itself lands on the main actor.
    static func read(_ providers: [NSItemProvider], onAsset: @escaping @MainActor (AssetDragItem) -> Void,
                     onFiles: (@MainActor ([URL]) -> Void)?) -> Bool {
        var accepted = false
        let fileType = UTType.fileURL.identifier
        let files = providers.filter { $0.hasItemConformingToTypeIdentifier(fileType) }
        if let onFiles, !files.isEmpty {
            accepted = true
            let group = DispatchGroup()
            let gathered = DroppedURLs()
            for provider in files {
                group.enter()
                _ = provider.loadObject(ofClass: NSURL.self) { reading, _ in
                    if let url = reading as? NSURL { gathered.add(url as URL) }
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                let got = gathered.all
                Task { @MainActor in if !got.isEmpty { onFiles(got) } }
            }
        }
        let texts = providers.filter {
            !$0.hasItemConformingToTypeIdentifier(fileType) && $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
        }
        for provider in texts {
            accepted = true
            _ = provider.loadObject(ofClass: NSString.self) { reading, _ in
                guard let text = reading as? NSString else { return }
                let said = text as String
                Task { @MainActor in
                    if let item = AssetDragRegistry.shared.item(forText: said) { onAsset(item) }
                }
            }
        }
        return accepted
    }
}
