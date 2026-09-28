// The hook pictures a Trips surface draws, decoded — the native twin of the
// web's `use-cover-thumbs.ts` (the gallery's covers) and of `CoverPanel`'s
// own read of a whole trip's thumbnails.
//
// What the web spent its care on evaporates here: a thumbnail is a small file
// beside the trip (`TripThumbs`, `trips/thumbs/<post>.jpg`), not a blob behind
// an object URL, so there is nothing to create or revoke. What survives:
// - only the ids asked for are read — the gallery asks for the CANDIDATES
//   (`coverCandidateIds`), never a trip's 250 pieces, the panel for the one
//   trip it is choosing among;
// - the new set REPLACES the old in one assignment once decoded, so a refresh
//   never paints an empty frame between two sets;
// - the store's `thumbsVersion` is part of the key, so a hook re-baked by the
//   editor is read again.
// Decoding runs off the main actor; a small JPEG decodes whole (the files are
// `thumbLongEdge` at most).

import CoreGraphics
import Foundation
import ImageIO
import Observation
import AtelierKit

@MainActor
@Observable
final class TripCoverThumbs {
    /// The pictures this surface holds, by post id.
    private(set) var images: [String: CGImage] = [:]
    @ObservationIgnored private var loadedKey: String?

    init() {}

    /// Whether `postId` has a picture on this device — the kernel's `hasThumb`.
    func has(_ postId: String) -> Bool { images[postId] != nil }

    func image(_ postId: String) -> CGImage? { images[postId] }

    /// Read `ids`' thumbnails, decode them off the main actor, and swap the
    /// whole set at once. `version` is the store's `thumbsVersion`. The same
    /// ids at the same version are not read twice.
    func load(_ ids: [String], from thumbs: TripThumbs, version: Int) async {
        let wanted = Array(Set(ids)).sorted()
        let key = "\(version)|" + wanted.joined(separator: ",")
        if key == loadedKey { return }
        if wanted.isEmpty {
            images = [:]
            loadedKey = key
            return
        }
        let decoded = await Task.detached(priority: .utility) { () -> [String: CGImage] in
            var out: [String: CGImage] = [:]
            for (id, data) in thumbs.get(wanted) {
                if let image = TripCoverThumbs.decode(data) { out[id] = image }
            }
            return out
        }.value
        // A newer set was asked for while this one decoded: it wins.
        if Task.isCancelled { return }
        images = decoded
        loadedKey = key
    }

    /// One JPEG, whole.
    nonisolated static func decode(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}
