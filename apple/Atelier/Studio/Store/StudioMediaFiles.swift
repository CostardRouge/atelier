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
//   permission: its bytes COPIED into `Application Support/Atelier/studio-media/`,
//   each in a folder of its own so the file keeps its NAME — the name is
//   what the project saves, what groups a clip with its `.srt`, and what the
//   same media is called in the Library and on the web;
// - a file FETCHED from an instance (through the Library): held for the
//   session only, linked into a temporary folder emptied at the next launch,
//   and fetched back from its ref's `assetId` when the project next opens —
//   a byte cache of fetched proxies was declined (`architecture.md`, «A remote
//   ref is re-FETCHED, never cached»).
//
// The pointed-at files and the Photos copies are the project's LOOSE files,
// kept in a side table beside the document (`projects/<id>.locators.json`,
// `StudioStore`), exactly as Develop keeps its pictures' (`RollStore`'s
// `PictureLocator`, reused). A fetched file has no locator: its ref is the
// address.

import Foundation
import AtelierKit

/// One media file of the open project and where its bytes are.
struct StudioMediaEntry {
    let ref: SavedMediaRef
    let url: URL
    /// How to find it again next launch — nil for a file of the project's own
    /// folder, which is listed again rather than remembered one by one, and
    /// for a fetched file, which is fetched again.
    let locator: PictureLocator?
    /// Fetched from an instance and held for this session only.
    var fetched = false
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

    /// Copy a received file (a Photos pick, a Library session copy) into the
    /// container, in a folder no other copy can take, under `name` — its own
    /// name unless told — and dated `modified` (ms) when given, so the copy
    /// reads back as the very ref it was taken as. Returns its locator and
    /// where it now is.
    static func copyIntoContainer(_ source: URL, name: String? = nil,
                                  modified: Double? = nil) -> (locator: PictureLocator, url: URL)? {
        let fm = FileManager.default
        let folder = UUID().uuidString.lowercased()
        let kept = keptName(name ?? source.lastPathComponent)
        let path = "\(folder)/\(kept)"
        let target = containerDirectory.appendingPathComponent(path)
        do {
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.copyItem(at: source, to: target)
        } catch {
            return nil
        }
        if let modified { stamp(target, modified) }
        return (.container(path), target)
    }

    /// A container copy leaves with the folder it was given (a copy made
    /// before copies kept their names sits at the container's top, alone).
    static func removeCopy(_ url: URL) {
        let fm = FileManager.default
        try? fm.removeItem(at: url)
        let parent = url.deletingLastPathComponent().standardizedFileURL
        let roots = [containerDirectory.standardizedFileURL.path, sessionDirectory.standardizedFileURL.path]
        if !roots.contains(parent.path) { try? fm.removeItem(at: parent) }
    }

    // MARK: - a fetched file, for the session

    /// Where this launch holds the files it took from the Library's fetches —
    /// the last launch's emptied the first time it is asked for.
    static let sessionDirectory: URL = {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Atelier-Studio", isDirectory: true)
        try? FileManager.default.removeItem(at: root)
        return root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }()

    /// A file the Library fetched, held for this session under the project's
    /// own name for it: LINKED where the volume allows (no second copy of a
    /// clip), copied otherwise — either way the Library removing its own
    /// copy leaves this one. Nil when it could not be held.
    static func holdForSession(_ source: URL, name: String, modified: Double) -> URL? {
        let fm = FileManager.default
        let target = sessionDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent(keptName(name))
        do {
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            do {
                try fm.linkItem(at: source, to: target)
            } catch {
                try fm.copyItem(at: source, to: target)
            }
        } catch {
            return nil
        }
        stamp(target, modified)
        return target
    }

    /// A file name the file system takes as it is: only a separator is replaced.
    private static func keptName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "_")
        return cleaned.isEmpty ? "media" : cleaned
    }

    /// Date a file at `ms` since the epoch, so its ref reads back unchanged.
    private static func stamp(_ url: URL, _ ms: Double) {
        guard ms.isFinite, ms > 0 else { return }
        let date = Date(timeIntervalSince1970: ms / 1000)
        try? FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
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
