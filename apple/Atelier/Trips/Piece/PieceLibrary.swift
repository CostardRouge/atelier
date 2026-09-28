// What the piece editor needs from the shell's LIBRARY — the native half of
// the web's `useAssetLibrary` + `useActiveAsset(MEDIA_KINDS)` +
// `resolve-media.ts` as `PostEditor.tsx` reads them — and the ONE place it is
// adapted to the landed Library (`Library/LibraryStore.swift`,
// `ActiveAsset.swift`, `AssetDragging.swift`). How the two talk is the
// kernel's (`Roadtrip/LibrarySync.swift`, `CollageRefetch.swift`,
// `DropZones.swift`); the passes that drive those rules are
// `PieceEditorModel+Library.swift`.
//
// `PieceLibrary` is kept THIN on purpose — eight answers — so the model reads
// the Library through it and a spec or a preview can hand it a stand-in;
// `LibraryStore` conforms below, and nothing else in `Trips/Piece/` names the
// Library's own types but the drop (which reads the Library's drag registry,
// `AssetDragRegistry`, because the stage must know WHICH cell a picture is
// over — `libraryDropDestination` reports only that one is).
//
// Rules kept (`roadtrip.md`, «A picture is DRAGGED…», «Every drawn cell is
// fetched back on opening»; `architecture.md`, «A remote picture lost to a
// reload»):
// - The Library's pool is every asset's file to compose over (its image,
//   else its clip: the web's `pickable`); the TICK is the active asset among
//   those a piece can use (photos and clips).
// - Only a CONNECTED instance is ever asked for a picture again, and only
//   when a piece is opened — never at launch: `sourceOf` answers nil for a
//   ref naming `local` or a host this device was never given.
// - A picture fetched back lands in the POOL (the proxy, the original's
//   identity vouched), and is never cached beyond the session.

import Foundation
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

/// What a piece composes over: photographs and clips, with or without their log.
let pieceMediaKinds: [AssetKind] = [.photo, .videoTelemetry, .video]

/// The Library, for the piece editor.
@MainActor
protocol PieceLibrary: AnyObject {
    /// Every asset's file to compose over (its image, else its clip).
    var pool: [SavedMediaRef] { get }
    /// The picture the Library has TICKED, among what a piece can use, or nil.
    var active: SavedMediaRef? { get }
    /// Tick the pool file `ref` — select it and make it the active one.
    func activate(_ ref: SavedMediaRef)
    /// A pool file's bytes, opened — its security scope held until `close`.
    func open(_ ref: SavedMediaRef) -> OpenedFile?
    /// The CONNECTED instance `ref` names, or nil.
    func sourceOf(_ ref: SavedMediaRef) -> String?
    /// Fetch `ref` back from its instance INTO THE POOL. False when the
    /// instance answered that it no longer has it; throws a `WinnowError` for
    /// an instance that answered badly.
    func refetch(_ ref: SavedMediaRef) async throws -> Bool
    /// What the source that handed the file over vouched for about its capture.
    func vouchedExif(for ref: SavedMediaRef) -> VouchedExif?
    /// Something the tick depends on moved — what a view keys a pass on.
    var tickKey: String { get }
}

extension PieceLibrary {
    /// The pool file named like `ref` — the match the stage draws with.
    func poolFile(named ref: SavedMediaRef?) -> SavedMediaRef? {
        guard let ref else { return nil }
        let want = ref.name.lowercased()
        return pool.first { $0.name.lowercased() == want }
    }

    /// The pool's file names, lower-cased — what a refetch checks against.
    var poolNames: Set<String> { poolNameSet(pool.map { $0.name }) }
}

// MARK: - the Library, adapted in one place

extension LibraryStore: PieceLibrary {
    /// The file an asset composes over — the web's `pickable`.
    private static func pickable(_ asset: Asset) -> SavedMediaRef? {
        asset.parts.image ?? asset.parts.video
    }

    var pool: [SavedMediaRef] { assets.compactMap(LibraryStore.pickable) }

    var active: SavedMediaRef? {
        activeState(pieceMediaKinds).active.flatMap(LibraryStore.pickable)
    }

    func activate(_ ref: SavedMediaRef) {
        let key = fileIdentity(ref)
        guard let asset = assets.first(where: { LibraryStore.pickable($0).map(fileIdentity) == key }) else { return }
        activate(asset.id)
    }

    func open(_ ref: SavedMediaRef) -> OpenedFile? {
        location(of: ref).flatMap { try? LibraryFiles.open($0) }
    }

    func sourceOf(_ ref: SavedMediaRef) -> String? {
        guard let split = splitAssetId(ref.assetId), split.host != defaultSourceId,
              ConnectionStore.shared.connection(split.host) != nil else { return nil }
        return split.host
    }

    func refetch(_ ref: SavedMediaRef) async throws -> Bool {
        guard let split = splitAssetId(ref.assetId), let connection = ConnectionStore.shared.connection(split.host)
        else { return false }
        let client = ConnectionStore.shared.client(for: connection)
        guard let row = try await client.asset(split.id) else { return false }
        let host = split.host
        let files = try await TaskCenter.tracked(materializeTaskLabel(row, .proxy), scope: "\(host)/\(split.id)") {
            try await materialize(client, host, row, fidelity: .proxy, now: nowMillis())
        }
        return !files.isEmpty && addFetched(files) != nil
    }

    func vouchedExif(for ref: SavedMediaRef) -> VouchedExif? {
        guard let entry = entry(for: ref) else { return nil }
        return AtelierKit.vouchedExif(entry.origin, entry.exif)
    }

    var tickKey: String {
        "\(activeId ?? "")|\(selection.hashValue)|\(assets.count)|\(entries.count)"
    }
}

// MARK: - what became of a picture the pool lost

/// A slide's picture the Library did not hold: being fetched from the
/// instance that has it, or what that instance had to say — the web's
/// `SlideRecovery`.
struct PieceRecovery: Equatable {
    enum State: Equatable {
        case fetching, failed
    }

    var state: State
    /// The instance the picture lives on.
    var sourceId: String
    /// One line a person can act on — only when it failed.
    var problem: String?
    /// Where to sign in, when that is what went wrong.
    var loginUrl: String?

    /// What a failed fetch from `sourceId` tells the author.
    static func from(_ error: Error, sourceId: String) -> PieceRecovery {
        if let winnow = error as? WinnowError, winnow.kind == .unauthenticated {
            return PieceRecovery(state: .failed, sourceId: sourceId, problem: "Not signed in to \(sourceId).",
                                 loginUrl: "https://\(sourceId)/login")
        }
        return PieceRecovery(state: .failed, sourceId: sourceId, problem: error.localizedDescription, loginUrl: nil)
    }

    /// What an instance that answered "no such asset" tells the author.
    static func gone(_ ref: SavedMediaRef, sourceId: String) -> PieceRecovery {
        PieceRecovery(state: .failed, sourceId: sourceId, problem: "\(sourceId) no longer has “\(ref.name)”.",
                      loginUrl: nil)
    }

    /// The kernel's account of a fetch, for the Layout section's summary.
    var refetch: RefetchState {
        RefetchState(state: state == .fetching ? .fetching : .failed, sourceId: sourceId)
    }
}

// MARK: - a picture dropped on the stage

/// The Library's drag item a drop's providers carry: our text, read through
/// the Library's own registry — the item, never the transfer.
enum PieceDropReader {
    /// The types a Library drag carries.
    static let types: [UTType] = [.utf8PlainText, .plainText]

    /// The item behind a drop's first text provider, on the main actor.
    static func item(_ providers: [NSItemProvider]) async -> AssetDragItem? {
        let texts = providers.filter { p in types.contains { p.hasItemConformingToTypeIdentifier($0.identifier) } }
        for provider in texts {
            let said: String? = await withCheckedContinuation { done in
                _ = provider.loadObject(ofClass: NSString.self) { reading, _ in
                    done.resume(returning: (reading as? NSString).map { $0 as String })
                }
            }
            if let said, let item = AssetDragRegistry.shared.item(forText: said) { return item }
        }
        return nil
    }
}
