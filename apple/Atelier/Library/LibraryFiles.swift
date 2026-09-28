// Where a Library file's BYTES are on this device, and what is read from
// them — off the main actor, a head or a thumbnail at a time, never a whole
// file to list it (`architecture.md`, «The library layer stores handles, never
// bytes»).
//
// Three kinds of place (`LibraryLocation`): a file the person POINTED AT in
// Files or the Finder, remembered by a security-scoped bookmark and never
// copied; a file inside a FOLDER they pointed at, remembered as the folder's
// bookmark and the path inside it (the web's remembered directory handle); and
// a SESSION copy — a Photos pick (a transfer, with no path of its own) or a
// picture fetched from an instance — kept in a temporary folder for as long as
// the app runs, never persisted: the web declined a byte cache of fetched
// proxies, and a reload there empties the pool too.

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import AtelierKit

/// How this device reaches one Library file.
enum LibraryLocation: Codable, Hashable {
    /// A file pointed at, remembered by bookmark.
    case bookmark(Data)
    /// A file inside a folder pointed at: the folder's bookmark, the path inside it.
    case folder(Data, String)
    /// A copy this session holds — an absolute path under the session folder.
    case session(String)

    /// Whether it outlives the session.
    var persists: Bool {
        switch self {
        case .session: return false
        case .bookmark, .folder: return true
        }
    }
}

/// A file open for reading, its security scope held until `close`.
struct OpenedFile {
    let url: URL
    let close: () -> Void
}

/// A file as the partial hash reads it: a size and two slices, never the whole.
private struct FileBlob: HashableBlob {
    let handle: FileHandle
    let size: Int

    func slice(_ start: Int, _ end: Int) throws -> Data {
        let from = max(0, min(start, size))
        let to = max(from, min(end, size))
        try handle.seek(toOffset: UInt64(from))
        return try handle.read(upToCount: to - from) ?? Data()
    }
}

enum LibraryFiles {
    /// Open a location: its URL, its scope started, and what ends it.
    static func open(_ location: LibraryLocation) throws -> OpenedFile {
        switch location {
        case .session(let path):
            return OpenedFile(url: URL(fileURLWithPath: path), close: {})
        case .bookmark(let bookmark):
            let url = try RollStore.resolveBookmark(bookmark)
            let scoped = url.startAccessingSecurityScopedResource()
            return OpenedFile(url: url, close: { if scoped { url.stopAccessingSecurityScopedResource() } })
        case .folder(let bookmark, let path):
            let folder = try RollStore.resolveBookmark(bookmark)
            let scoped = folder.startAccessingSecurityScopedResource()
            return OpenedFile(url: folder.appendingPathComponent(path),
                              close: { if scoped { folder.stopAccessingSecurityScopedResource() } })
        }
    }

    /// The whole file — only for a picture being PUT somewhere (a roll's copy).
    static func data(_ location: LibraryLocation) throws -> Data {
        let opened = try open(location)
        defer { opened.close() }
        return try Data(contentsOf: opened.url)
    }

    /// The first `count` bytes.
    static func head(_ location: LibraryLocation, count: Int) -> [UInt8]? {
        guard let opened = try? open(location) else { return nil }
        defer { opened.close() }
        return InstrumentImages.head(opened.url, count: count)
    }

    /// Winnow's `content_hash` of the file, read through two slices.
    static func hash(_ location: LibraryLocation) throws -> String {
        let opened = try open(location)
        defer { opened.close() }
        let handle = try FileHandle(forReadingFrom: opened.url)
        defer { try? handle.close() }
        let size = Int(try handle.seekToEnd())
        return try partialHash(FileBlob(handle: handle, size: size))
    }

    /// The files of a folder pointed at, every depth down, as refs and paths —
    /// what the Library can group; hidden files and packages left out.
    static func listFolder(_ folder: URL) -> [(ref: SavedMediaRef, path: String)] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys,
                                                          options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        let base = folder.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        var out: [(ref: SavedMediaRef, path: String)] = []
        for case let url as URL in walker {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            guard classifyPart(url.lastPathComponent) != .other else { continue }
            let parts = url.resolvingSymlinksInPath().standardizedFileURL.pathComponents
            let inside = parts.count > base.count && Array(parts.prefix(base.count)) == base
            let path = inside ? parts.dropFirst(base.count).joined(separator: "/") : url.lastPathComponent
            out.append((RollStore.mediaRef(of: url), path))
        }
        return out
    }
}

// MARK: - a cover

/// What a row's cover has read: the kernel's facts, and the thumbnail.
struct LibraryCover {
    var facts: CoverFacts
    var thumbnail: CGImage?
}

enum LibraryCovers {
    /// A cover's long edge, in pixels.
    static let edge = 320

    /// Read one asset's cover: a clip's first frame, length and size (and the
    /// cadence its `.srt` measures), or a picture's thumbnail at the cover's
    /// size and its upright pixels. A RAW draws through the render inside it.
    static func read(image: (location: LibraryLocation, name: String)?, video: LibraryLocation?,
                     srt: LibraryLocation?) async -> LibraryCover {
        if let video {
            guard let opened = try? LibraryFiles.open(video) else {
                return LibraryCover(facts: CoverFacts(status: .error, isVideo: true), thumbnail: nil)
            }
            let poster = await InstrumentClips.poster(opened.url, maxSize: CGSize(width: edge, height: edge))
            let duration = await InstrumentClips.duration(opened.url)
            let size = await clipSize(opened.url)
            opened.close()
            var facts = CoverFacts(status: poster == nil && duration == nil ? .error : .ready, isVideo: true,
                                   width: size?.width, height: size?.height, duration: duration)
            if let srt, let text = srtText(srt) { facts.timing = TelemetryTrack(text: text).reading }
            return LibraryCover(facts: facts, thumbnail: poster)
        }
        guard let image else { return LibraryCover(facts: CoverFacts(status: .error, isVideo: false), thumbnail: nil) }
        let type = imageTypeLabel(image.name)
        guard let opened = try? LibraryFiles.open(image.location) else {
            return LibraryCover(facts: CoverFacts(status: .error, isVideo: false, imageType: type), thumbnail: nil)
        }
        defer { opened.close() }
        let thumb = InstrumentImages.thumbnail(opened.url, maxPixel: edge)
        let shown = InstrumentImages.shownSize(opened.url)
        let facts = CoverFacts(status: thumb == nil ? .error : .ready, isVideo: false,
                               width: shown?.width, height: shown?.height, imageType: type)
        return LibraryCover(facts: facts, thumbnail: thumb)
    }

    /// The clip's frame as it PLAYS — a quarter turn swaps the axes.
    private static func clipSize(_ url: URL) async -> (width: Int, height: Int)? {
        guard let track = try? await AVURLAsset(url: url).loadTracks(withMediaType: .video).first,
              let loaded = try? await track.load(.naturalSize, .preferredTransform) else { return nil }
        let turned = loaded.0.applying(loaded.1)
        let width = Int(abs(turned.width).rounded())
        let height = Int(abs(turned.height).rounded())
        return width > 0 && height > 0 ? (width, height) : nil
    }

    private static func srtText(_ location: LibraryLocation) -> String? {
        guard let opened = try? LibraryFiles.open(location) else { return nil }
        defer { opened.close() }
        return TelemetryTracks.text(opened.url)
    }
}
