// The pieces' hooks as the overview draws them — the web's `use-day-thumbs.ts`
// over the files `TripThumbs` keeps (`trips/thumbs/<post id>.jpg`), read once
// here so the day strip, the day panel and the calendar's Pictures view all
// draw the SAME pictures.
//
// Rules kept:
// - Only what is ASKED is held: the open day's pieces, plus — in the Pictures
//   view — the month on screen and its two neighbours, never a whole year of
//   hooks for cells that are not on screen. A picture no longer asked for is
//   let go on the next request.
// - Decoded SMALL (256 px on the long edge) and off the main actor: a
//   calendar cell is 46 pt and a panel row 48 pt tall, and the file is the
//   640 px hook.
// - A thumbnail rewritten or deleted (`TripsStore.thumbsVersion`) is read
//   again; until it lands the old picture stays, so nothing blinks.
// - The object-URL create/revoke dance of the web evaporates: a file is
//   read, a CGImage is kept, ARC lets it go.

import CoreGraphics
import Foundation
import ImageIO
import Observation
import AtelierKit

@MainActor
@Observable
final class OverviewThumbs {
    /// The decoded hooks, by post id.
    private(set) var images: [String: CGImage] = [:]

    @ObservationIgnored private var version = -1
    @ObservationIgnored private var inFlight: Set<String> = []
    @ObservationIgnored private var generation = 0

    /// The long edge a hook is decoded at.
    nonisolated static let longEdge = 256

    /// Hold exactly `ids` (as of the store's `version`): read what is missing,
    /// drop what is no longer asked for.
    func want(_ ids: Set<String>, version: Int, from files: TripThumbs) {
        let stale = version != self.version
        if stale {
            self.version = version
            inFlight = []
            generation += 1
        }
        // Let go of what nobody asks for any more.
        let kept = images.filter { ids.contains($0.key) }
        if kept.count != images.count { images = kept }

        let missing = stale ? ids : ids.subtracting(images.keys).subtracting(inFlight)
        guard !missing.isEmpty else { return }
        inFlight.formUnion(missing)
        let asked = Array(missing)
        let ticket = generation
        Task { [weak self] in
            let decoded = await OverviewThumbs.decode(asked, from: files)
            guard let self, self.generation == ticket else { return }
            self.inFlight.subtract(asked)
            var next = self.images
            for id in asked {
                if let image = decoded[id] { next[id] = image } else if stale { next[id] = nil }
            }
            self.images = next
        }
    }

    /// Read and decode off the main actor.
    private static func decode(_ ids: [String], from files: TripThumbs) async -> [String: CGImage] {
        await Task.detached(priority: .utility) { () -> [String: CGImage] in
            var out: [String: CGImage] = [:]
            for id in ids {
                guard let data = files.get(id), let image = OverviewThumbs.small(data) else { continue }
                out[id] = image
            }
            return out
        }.value
    }

    /// A JPEG at `longEdge`, turned upright.
    nonisolated static func small(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: longEdge,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
