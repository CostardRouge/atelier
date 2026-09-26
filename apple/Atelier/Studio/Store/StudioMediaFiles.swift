// Where a Studio project's media BYTES are on this device — the native
// stand-in for the web's folder handle (`media.dirHandle`, re-listed on every
// open through `filesFromDirectoryHandle`) and the files the Library holds for
// the project.
//
// The document keeps REFS (name · size · date · hash), never bytes, never a
// path: a project on the phone and the same project in the browser name the
// same media. How THIS device reaches each one is said here:
//
// - the project's own FOLDER: its security-scoped bookmark IS the document's
//   `media.dirHandle` (a `Data`, opaque to the kernel, dropped from the wire),
//   listed again — recursively, as the web's `collectFromDirHandle` — on
//   every open;
// - a file pointed at in Files or the Finder: a bookmark, never a copy;
// - a Photos pick, which has no persistent handle without library
//   permission: its bytes COPIED into `Application Support/Atelier/studio-media/`.
//
// The last two are the project's LOOSE files, kept in a side table beside the
// document (`projects/<id>.locators.json`, `StudioStore`), exactly as Develop
// keeps its pictures' (`RollStore`'s `PictureLocator`, reused).

import Foundation
import AtelierKit

/// One media file of the open project and where its bytes are.
struct StudioMediaEntry {
    let ref: SavedMediaRef
    let url: URL
    /// How to find it again next launch — nil for a file of the project's own
    /// folder, which is listed again rather than remembered one by one.
    let locator: PictureLocator?
}

/// A file read as the kernel's partial hash reads it: a size and two slices,
/// never the whole file (`Lib/PartialHash.swift`).
struct StudioFileBlob: HashableBlob {
    let url: URL
    let size: Int

    func slice(_ start: Int, _ end: Int) throws -> Data {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(max(0, start)))
        return try handle.read(upToCount: max(0, end - start)) ?? Data()
    }
}

enum StudioMediaFiles {
    /// `Application Support/Atelier/studio-media` — where a Photos pick is copied.
    static var containerDirectory: URL {
        DocumentStore<ProjectDoc>.defaultRoot.appendingPathComponent("studio-media", isDirectory: true)
    }

    /// A file's reference as a project keeps it: its name, size and date.
    static func mediaRef(of url: URL) -> SavedMediaRef {
        RollStore.mediaRef(of: url)
    }

    /// Every media file under `folder`, recursively, hidden files left out and
    /// what the library would not classify left out too. The caller holds the
    /// folder's security scope.
    static func list(folder: URL) -> [StudioMediaEntry] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: keys,
                                                          options: [.skipsHiddenFiles, .skipsPackageDescendants]) else {
            return []
        }
        var out: [StudioMediaEntry] = []
        for case let url as URL in walker {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            guard classifyPart(url.lastPathComponent) != .other else { continue }
            out.append(StudioMediaEntry(ref: mediaRef(of: url), url: url, locator: nil))
        }
        return out
    }

    /// The URL a loose file's locator names — nil when it is gone. The caller
    /// starts and stops its security scope.
    static func resolve(_ locator: PictureLocator) -> URL? {
        switch locator {
        case .container(let path):
            let url = containerDirectory.appendingPathComponent(path)
            return FileManager.default.fileExists(atPath: url.path) ? url : nil
        case .bookmark(let bookmark):
            return try? RollStore.resolveBookmark(bookmark)
        case .folder(let bookmark, let path):
            return (try? RollStore.resolveBookmark(bookmark)).map { $0.appendingPathComponent(path) }
        }
    }

    /// Copy a received file (a Photos pick) into the container, under a name
    /// no other copy can take. Returns its locator and where it now is.
    static func copyIntoContainer(_ source: URL) -> (locator: PictureLocator, url: URL)? {
        let fm = FileManager.default
        try? fm.createDirectory(at: containerDirectory, withIntermediateDirectories: true)
        let path = "\(UUID().uuidString.lowercased())-\(RollStore.safeFileName(source.lastPathComponent))"
        let target = containerDirectory.appendingPathComponent(path)
        do {
            try fm.copyItem(at: source, to: target)
        } catch {
            return nil
        }
        return (.container(path), target)
    }

    /// Refs carrying their partial content hash — the identity Winnow shares —
    /// read at most 128 KiB per file and memoised per file for the session
    /// (`MediaIdentities`). Blocking: call off the main actor.
    static func hashed(_ entries: [StudioMediaEntry]) -> [SavedMediaRef] {
        var urls: [String: URL] = [:]
        for entry in entries { urls[fileIdentity(entry.ref)] = entry.url }
        return hashedMediaRefs(entries.map(\.ref)) { ref in
            guard let url = urls[fileIdentity(ref)] else { throw CocoaError(.fileNoSuchFile) }
            return StudioFileBlob(url: url, size: ref.size)
        }
    }

    /// One file's hash (nil when it cannot be read) — the develop's guard.
    static func hash(_ ref: SavedMediaRef, at url: URL) -> String? {
        mediaHash(ref) { _ in StudioFileBlob(url: url, size: ref.size) }
    }
}
