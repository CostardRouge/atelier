// A trip on this device — the native twin of the web's IndexedDB database
// `atelier-roadtrip` (`src/shared/roadtrip/trip-store.ts`): one document per
// trip, beside it and never on it one SYNC RECORD per trip kept on an
// instance, and one small JPEG per POST (the hook as it was last composed).
//
// The document and its record ride the suite's one store
// (`Sources/DocumentStore.swift`) through `TripDoc: StoredDocument`, under
// `Application Support/Atelier/trips/` — `<id>.json`, `<id>.sync.json` —
// written as the web writes them, so a trip made here opens in the browser
// and on a Winnow unchanged. The wire is the kernel's (`TripRemote.swift`):
// `toWireDoc(_: TripDoc)` drops `sourceId`, `fromWireDoc(trip:…)` stamps id
// and source from the REQUEST and migrates like a stored trip.
//
// The hook thumbnails are keyed by POST id, in `trips/thumbs/<post id>.jpg`,
// not by trip: a day opened months later shows what is sitting there, and a
// thumbnail survives its trip moving between sources. They are the only heavy
// values here and nobody else prunes them, so every delete names the posts it
// takes (`TripThumbs.delete`) and `prune(keeping:)` sweeps the orphans a
// gallery delete left.
//
// `TripDiskStore` is the kernel's `TripStore` over the same files, for the
// drivers the kernel owns (`pushTrip`, `mirrorTrip`, `moveTrip`).

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import AtelierKit

// MARK: - the document

extension TripDoc: StoredDocument {
    static var bucketKind: String { tripDocKind }
    static var folderName: String { "trips" }
    static var noun: String { "trip" }

    static func readStored(_ raw: JSONValue?) -> TripDoc? { readTripDoc(raw) }

    var wireDoc: JSONValue { toWireDoc(self) }

    static func fromWire(_ raw: JSONValue?, id: String, sourceId: String, local: TripDoc?) throws -> TripDoc {
        try fromWireDoc(trip: raw, id, sourceId)
    }

    /// The web's move: through the portable half (`toTripFile` →
    /// `tripDocFromFile`), which nulls every `projectId` since projects do not
    /// cross, keeping the trip's own id — every `tripRef` link survives — and
    /// its birth.
    func moved(to sourceId: String, now: Double) -> TripDoc {
        var doc = tripDocFromFile(toTripFile(self, exportedAt: now), now: now, sourceId: sourceId, id: id)
        doc.createdAt = createdAt
        return doc
    }
}

// MARK: - the hook thumbnails

/// One small JPEG per post: the hook as it was last composed. A cache —
/// losing one costs a row its picture, never the row.
struct TripThumbs: Sendable {
    /// `Application Support/Atelier/trips/thumbs`.
    let directory: URL

    init(root: URL = DocumentStore<TripDoc>.defaultRoot) {
        directory = root.appendingPathComponent(TripDoc.folderName, isDirectory: true)
            .appendingPathComponent("thumbs", isDirectory: true)
    }

    func url(_ postId: String) -> URL {
        directory.appendingPathComponent("\(DocumentStore<TripDoc>.fileStem(postId)).jpg")
    }

    /// Save one post's hook. Silent on failure, like every write here.
    @discardableResult
    func put(_ postId: String, _ jpeg: Data) -> Bool {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return (try? jpeg.write(to: url(postId), options: .atomic)) != nil
    }

    func get(_ postId: String) -> Data? {
        try? Data(contentsOf: url(postId))
    }

    /// The thumbnails that exist among `ids`; a missing id is absent.
    func get(_ ids: [String]) -> [String: Data] {
        var out: [String: Data] = [:]
        for id in ids {
            if let data = get(id) { out[id] = data }
        }
        return out
    }

    /// Forget the thumbnails of posts that are gone.
    func delete(_ ids: [String]) {
        for id in ids { try? FileManager.default.removeItem(at: url(id)) }
    }

    /// Every thumbnail whose post no document holds any more — what a delete
    /// made elsewhere (the gallery's, the pill's) left behind.
    func prune(keeping postIds: Set<String>) {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let kept = Set(postIds.map { DocumentStore<TripDoc>.fileStem($0) })
        for url in urls where url.pathExtension == "jpg" {
            let stem = url.deletingPathExtension().lastPathComponent
            if !kept.contains(stem) { try? FileManager.default.removeItem(at: url) }
        }
    }

    /// The hook as a small JPEG: `thumbSize` of the drawn frame, never
    /// upscaled, at `thumbQuality`. A picture of the BADGE — what the author
    /// already made of the day — so it is taken from the rendered frame, never
    /// from the raw media. Nil for a frame with no area.
    static func jpeg(from frame: CGImage, longEdge: Double = thumbLongEdge, quality: Double = thumbQuality) -> Data? {
        let size = thumbSize(Double(frame.width), Double(frame.height), longEdge)
        guard size.w > 0, size.h > 0 else { return nil }
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: size.w, height: size.h, bitsPerComponent: 8, bytesPerRow: size.w * 4,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(frame, in: CGRect(x: 0, y: 0, width: size.w, height: size.h))
        guard let small = ctx.makeImage() else { return nil }
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
        CGImageDestinationAddImage(destination, small, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }
}

// MARK: - the kernel's store, over the same files

/// The kernel's `TripStore` over this device's disk: the documents and their
/// records through `DocumentStore<TripDoc>`, the hooks through `TripThumbs`.
/// Every call is small and synchronous underneath, and degrades rather than
/// throws, as the web's does.
final class TripDiskStore: TripStore, @unchecked Sendable {
    let documents: DocumentStore<TripDoc>
    let thumbs: TripThumbs

    init(root: URL = DocumentStore<TripDoc>.defaultRoot) {
        documents = DocumentStore(root: root)
        thumbs = TripThumbs(root: root)
    }

    func listTrips() async -> [TripDoc] { documents.list() }
    func putTrip(_ doc: TripDoc) async -> Bool { documents.put(doc) }
    func deleteTrip(_ id: String) async {
        // The hooks go with the trip: nothing else will ever prune them.
        let posts = documents.get(id)?.posts.map(\.id) ?? []
        documents.delete(id)
        thumbs.delete(posts)
    }
    func getSyncRecord(_ id: String) async -> SyncRecord? { documents.getSyncRecord(id) }
    func listSyncRecords() async -> [SyncRecord] {
        documents.list().compactMap { documents.getSyncRecord($0.id) }
    }
    func putSyncRecord(_ record: SyncRecord) async -> Bool { documents.putSyncRecord(record) }
    func deleteSyncRecord(_ id: String) async { documents.deleteSyncRecord(id) }
    func putThumb(_ id: String, _ jpeg: Data) async { thumbs.put(id, jpeg) }
    func getThumbs(_ ids: [String]) async -> [String: Data] { thumbs.get(ids) }
    func deleteThumbs(_ ids: [String]) async { thumbs.delete(ids) }
}
