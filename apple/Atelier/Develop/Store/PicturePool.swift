// What a roll's pictures ARE on this device, once looked at: the decoded
// picture (three at most — a RAW is the one source decoded in the app's own
// memory, and it is where a phone runs out of it, `device-memory.md`), the
// camera's own EXIF read from the head of the file, the as-shot statistics
// the Auto verbs measure against, and the filmstrip's thumbnails.
//
// Thumbnails follow the web's `roll-thumb.ts` rules: a cell with no stored
// thumbnail is baked AS SHOT from the file, one decode at a time, once per
// picture per visit; the OPEN picture's cell is redrawn AS DELIVERED from the
// stage once it rests (`snapshot`), so a cell is the picture as last SEEN in
// the editor. They are kept on disk beside the rolls (`RollStore.thumbURL`)
// so the gallery's cover mosaic reads them without a decode.
//
// The stage may read ANOTHER file of the picture's capture than its own —
// the file set above the photograph, or the RAW its sensor is developed from
// (`ShownFile`, `RollEditor+Renditions.swift`): that decode is kept under its
// own key beside the picture's, and `held` answers with whichever the stage
// read last, so everything that asks "what is on screen" (the RAW ladder, the
// camera's line under `I`, the as-shot statistics) reads the file shown.

import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Observation
import UniformTypeIdentifiers
import AtelierKit

/// One picture decoded, with what the file says about itself.
struct PictureRead {
    let decoded: DecodedPicture
    /// The camera's own record, from the head of the file; nil when it says nothing.
    let exif: ExifData?
    /// The picture AS SHOT, measured once on a small sample.
    let stats: SourceStats?
}

@MainActor
@Observable
final class PicturePool {
    /// Thumbnails in memory, by picture id.
    private(set) var thumbnails: [String: CGImage] = [:]
    /// The camera's record, by picture id — what `captureLine` reads.
    private(set) var exif: [String: ExifData] = [:]
    /// As-shot statistics, by picture id.
    private(set) var stats: [String: SourceStats] = [:]

    private let store: RollStore
    @ObservationIgnored private var reads: [String: PictureRead] = [:]
    /// The key the STAGE last read each picture under — its own id, or the
    /// id and the capture file it showed instead.
    @ObservationIgnored private var current: [String: String] = [:]
    @ObservationIgnored private var order: [String] = []
    @ObservationIgnored private var inFlight: [String: Task<PictureRead, Error>] = [:]
    /// Tried once per picture per visit, so a file that cannot be decoded is
    /// not retried on every render of its cell.
    @ObservationIgnored private var tried = Set<String>()
    @ObservationIgnored private var thumbChain: Task<Void, Never>?

    /// Decoded pictures held at once.
    static let keep = 3

    init(store: RollStore) {
        self.store = store
    }

    // MARK: - decoding

    /// The picture's bytes decoded, from the pool or from its file — or,
    /// with `shown`, another file of its capture (read under its own name, so
    /// a RAW beside a JPEG decodes as the RAW it is). `stage` marks the read
    /// the stage draws: what `held` answers from then on. Throws
    /// `PictureError.noLocator` when this device does not know where the file is.
    func read(_ rollId: String, _ picture: RollPicture, shown: ShownFile? = nil,
              stage: Bool = false) async throws -> PictureRead {
        // A variant shares its file: the pool is keyed on the FILE's locator
        // owner, which is the picture's own id (each variant carries a copy).
        let key = shown.map { "\(picture.id)|\($0.key)" } ?? picture.id
        if let hit = reads[key] {
            touch(key)
            if stage { adopt(picture.id, key, hit) }
            return hit
        }
        if let running = inFlight[key] {
            let read = try await running.value
            if stage { adopt(picture.id, key, read) }
            return read
        }
        // Its locator, else a file the roll fetched from its instance this session.
        let source: PictureBytesSource
        let name: String
        if let shown {
            source = shown.source
            name = shown.name
        } else {
            guard let own = store.bytesSource(rollId, picture.id) else { throw PictureError.noLocator }
            source = own
            name = picture.ref.name
        }
        let media = store.mediaDirectory
        let task = Task.detached(priority: .userInitiated) { () throws -> PictureRead in
            let data = try RollStore.bytes(of: source, mediaDirectory: media)
            // A RAW's bytes are read again when its sensor is asked for, never held.
            let reread = { try RollStore.bytes(of: source, mediaDirectory: media) }
            guard let decoded = PictureDecoder.decode(data, name: name, reread: reread) else { throw PictureError.undecodable }
            let head = data.prefix(exifSliceBytes)
            let parsed = parseExif(Data(head))
            let stats = PictureRenderer.shared.rgbaBytes(decoded.image, longEdge: histogramSampleEdge).map { measureSource($0) }
            return PictureRead(decoded: decoded, exif: isEmptyExif(parsed) ? nil : parsed, stats: stats)
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        let read = try await task.value
        reads[key] = read
        touch(key)
        if stage {
            adopt(picture.id, key, read)
        } else if (current[picture.id] ?? picture.id) == key {
            if let e = read.exif { exif[picture.id] = e }
            if let s = read.stats { stats[picture.id] = s }
        }
        while order.count > PicturePool.keep {
            let old = order.removeFirst()
            reads[old] = nil
        }
        return read
    }

    /// What the stage read for a picture is what the picture's facts are read from.
    private func adopt(_ pictureId: String, _ key: String, _ read: PictureRead) {
        current[pictureId] = key
        exif[pictureId] = read.exif
        stats[pictureId] = read.stats
    }

    /// The decoded picture the stage shows, if it is in hand.
    func held(_ pictureId: String) -> PictureRead? {
        reads[current[pictureId] ?? pictureId]
    }

    private func touch(_ id: String) {
        order.removeAll { $0 == id }
        order.append(id)
    }

    /// A picture taken off the roll: its decode, its facts, its thumbnail.
    func forget(_ ids: [String]) {
        for id in ids {
            let mine = { (key: String) in key == id || key.hasPrefix("\(id)|") }
            for key in reads.keys where mine(key) { reads[key] = nil }
            order.removeAll(where: mine)
            current[id] = nil
            thumbnails[id] = nil
            exif[id] = nil
            stats[id] = nil
            tried.remove(id)
        }
    }

    /// The picture's bytes may be in hand now (a folder reopened): try again.
    func retry(_ ids: [String]) {
        for id in ids { tried.remove(id) }
    }

    // MARK: - thumbnails

    /// The stored thumbnail, else one baked AS SHOT from the file — queued, one
    /// decode at a time. `skipBake` leaves the open picture to its snapshot.
    func requestThumbnail(_ rollId: String, _ picture: RollPicture, skipBake: Bool = false) {
        let id = picture.id
        if thumbnails[id] != nil { return }
        let url = store.thumbURL(id)
        if let stored = PicturePool.loadJPEG(url) {
            thumbnails[id] = stored
            return
        }
        if skipBake || tried.contains(id) || store.bytesSource(rollId, id) == nil { return }
        tried.insert(id)
        let previous = thumbChain
        thumbChain = Task { [weak self] in
            await previous?.value
            guard let self, self.thumbnails[id] == nil else { return }
            guard let read = try? await self.read(rollId, picture) else { return }
            let image = await Task.detached(priority: .utility) { () -> CGImage? in
                let renderer = PictureRenderer.shared
                return renderer.cgImage(renderer.scaled(read.decoded.image, longEdge: PictureRenderer.thumbnailLongEdge))
            }.value
            guard let image, self.thumbnails[id] == nil else { return }
            self.thumbnails[id] = image
            PicturePool.writeJPEG(image, to: url)
        }
    }

    /// The open picture's cell redrawn AS DELIVERED, from the stage's render.
    func snapshot(_ pictureId: String, from stage: CGImage) {
        let url = store.thumbURL(pictureId)
        Task { [weak self] in
            let small = await Task.detached(priority: .utility) { () -> CGImage? in
                let renderer = PictureRenderer.shared
                return renderer.cgImage(renderer.scaled(CIImage(cgImage: stage), longEdge: PictureRenderer.thumbnailLongEdge))
            }.value
            guard let self, let small else { return }
            self.thumbnails[pictureId] = small
            PicturePool.writeJPEG(small, to: url)
        }
    }

    /// A variant wears its source's thumbnail until its own is taken.
    func shareThumbnail(from: String, to: String) {
        guard let image = thumbnails[from] else { return }
        thumbnails[to] = image
        PicturePool.writeJPEG(image, to: store.thumbURL(to))
    }

    /// The stored thumbnails of the first pictures, for a gallery card.
    nonisolated static func storedThumbnails(_ ids: [String], in store: URL) -> [CGImage] {
        ids.compactMap { loadJPEG(store.appendingPathComponent("\($0).jpg")) }
    }

    nonisolated static func loadJPEG(_ url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    nonisolated static func writeJPEG(_ image: CGImage, to url: URL) {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        CGImageDestinationFinalize(destination)
    }
}
