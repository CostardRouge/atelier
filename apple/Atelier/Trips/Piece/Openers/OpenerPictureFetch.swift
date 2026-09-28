// An opener's picture from an INSTANCE — the half of the web's
// `use-hook-pictures.ts` that is `fetchPreviewStill`
// (`shared/sources/winnow/resolve-media.ts`), and the pictures an opener
// keeps decoded between two passes.
//
// Rules kept (`roadtrip.md`, «A hook's flashed pictures are SOURCE
// pictures»; `architecture.md`, «A remote picture lost to a reload»):
// - Only a CONNECTED instance is asked, only the host the ref names, and only
//   when a piece is opened — never at launch: a ref naming `local`, or a host
//   this device was never given, is not resolvable here.
// - ONE request for the still's editing rendition (the proxy, a WebP), and
//   nothing else: no row lookup, no `.srt`, no identity registered. The bytes
//   are NOT added to the Library — a sweep of forty pictures must not leave
//   forty assets in the pool. They are kept for the session in a temporary
//   folder of their own, emptied at the next launch (the Library's own rule
//   for what it fetched), so a pass that decodes again asks nobody twice.
// - A clip is never fetched: its frame would mean downloading the clip, so a
//   clip not in the Library is said as such (`HookPictureLoader`).
// - The fetch is a TASK (`TaskCenter.tracked`) scoped to the piece, so the
//   stage's edge carries its bar and the task pill its Cancel; a cancel and
//   "not signed in" are said in the panel's words.

import Foundation
import AtelierKit

@MainActor
enum OpenerPictureFetch {
    /// Fetched stills, by picture key, in the order last used.
    private static var stills: [String: URL] = [:]
    private static var recent: [String] = []
    /// How many fetched stills the session keeps on disk.
    private static let ceiling = 120
    /// This session's folder; the last session's is emptied on first use.
    private static let folder: URL = {
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("Atelier-Opener", isDirectory: true)
        try? FileManager.default.removeItem(at: parent)
        return parent.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }()

    /// The editing rendition of a still, straight from the connected instance
    /// `ref` names, or nil when no connected instance does (or `ref` is a clip).
    static func previewStill(_ ref: SavedMediaRef, scope: String?) async throws -> URL? {
        guard !BadgeSources.isClip(ref.name) else { return nil }
        guard let split = splitAssetId(ref.assetId), split.host != defaultSourceId,
              let connection = ConnectionStore.shared.connection(split.host) else { return nil }
        let key = hookPictureKey(ref)
        if let kept = stills[key], FileManager.default.fileExists(atPath: kept.path) {
            touch(key)
            return kept
        }
        let client = ConnectionStore.shared.client(for: connection)
        let label = "Fetching \(ref.name)"
        let file: WinnowFile
        do {
            file = try await TaskCenter.tracked(label, scope: scope) {
                try await client.fetchFile(client.proxyUrl(split.id), name: "\(ref.name).webp", type: "image/webp",
                                           lastModified: ref.lastModified)
            }
        } catch is CancellationError {
            throw HookPictureLoader.HookPictureProblem(message: "\(TaskCenter.cancelledSentence(label)).")
        } catch let error as WinnowError where error.kind == .unauthenticated {
            throw HookPictureLoader.HookPictureProblem(message: "Not signed in to \(split.host).")
        }
        let target = folder.appendingPathComponent(RollStore.safeFileName("\(split.id)-\(ref.name).webp"))
        let data = file.data
        try await Task.detached(priority: .utility) {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
        }.value
        stills[key] = target
        touch(key)
        evict()
        return target
    }

    private static func touch(_ key: String) {
        recent.removeAll { $0 == key }
        recent.append(key)
    }

    /// The least recently used stills leave the disk past the ceiling.
    private static func evict() {
        while recent.count > ceiling {
            let key = recent.removeFirst()
            if let url = stills.removeValue(forKey: key) { try? FileManager.default.removeItem(at: url) }
        }
    }

    // MARK: - decoded pictures kept between passes

    /// Each open piece's decoded opener pictures — the two most recent pieces
    /// only, so a piece left behind lets its pictures go.
    private static var heldByPiece: [(postId: String, pictures: HookPictureHeld)] = []

    static func held(for postId: String) -> HookPictureHeld {
        if let index = heldByPiece.firstIndex(where: { $0.postId == postId }) {
            let entry = heldByPiece.remove(at: index)
            heldByPiece.append(entry)
            return entry.pictures
        }
        let fresh = HookPictureHeld()
        heldByPiece.append((postId, fresh))
        if heldByPiece.count > 2 { heldByPiece.removeFirst(heldByPiece.count - 2) }
        return fresh
    }
}
