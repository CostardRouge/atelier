// The files the instruments read — the native stand-in for the web's shared
// Library, which every instrument page reads its selection from.
//
// ONE shelf for all seven, as the web's one library: a clip opened in DJI
// Telemetry is on the Flight Map and in the Composer too, a photo opened in
// Photo EXIF can be compared at once. Files are grouped the web's way, by
// the kernel's `buildAssets` — `DJI_0001.MP4` + `DJI_0001.SRT` are one
// `video+telemetry` asset, a RAW + its JPEG one photo — and each instrument
// takes what it can use through `usableAssets` (the registry's `accepts`).
//
// Where the bytes are: a file picked in Files or the Finder is READ WHERE IT
// IS, under its security scope, held open for as long as it is on the shelf;
// a Photos pick has no path of its own and is copied into a temporary folder
// the shelf empties when the file leaves. Nothing is uploaded, nothing
// persists across launches (the web's library is a session's too).
//
// The active asset is shared the way the web's `lib.activeId` is: stepping
// clips in one instrument moves the others' focus with it.

import CoreTransferable
import Foundation
import Observation
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

@MainActor
@Observable
final class InstrumentShelf {
    static let shared = InstrumentShelf()

    /// One file on the shelf: what the kernel groups by, and where it is.
    struct Entry {
        let ref: SavedMediaRef
        let url: URL
        /// Opened under a security scope that must be closed when it leaves.
        let scoped: Bool
        /// A copy the shelf made (a Photos pick), removed when it leaves.
        let owned: Bool
    }

    private(set) var entries: [Entry] = []
    /// The files grouped into captures — the kernel's `buildAssets`.
    private(set) var assets: [Asset] = []
    /// The focus the instruments share (the web's `lib.activeId`).
    var activeId: String?
    /// The last add that could not be read, said once.
    var problem: String?

    init() {}

    /// Put `entries` on the shelf as they are — previews and fixtures.
    func adopt(fixture entries: [Entry]) {
        self.entries = entries
        regroup()
    }

    // MARK: - reading the shelf

    /// The assets an instrument can use, in the shelf's order.
    func usable(_ accepts: [AssetKind]) -> [Asset] {
        usableAssets(accepts, assets)
    }

    /// The shared focus inside `list`, falling back to the first — the web's
    /// `activeId` rule.
    func active(in list: [Asset]) -> Asset? {
        if let id = activeId, let hit = list.first(where: { $0.id == id }) { return hit }
        return list.first
    }

    /// Where a part's bytes are.
    func url(for ref: SavedMediaRef?) -> URL? {
        guard let ref else { return nil }
        let key = fileIdentity(ref)
        return entries.first { fileIdentity($0.ref) == key }?.url
    }

    // MARK: - adding

    /// Files pointed at in Files or the Finder. A second copy of one already
    /// on the shelf (same name, size and date) is ignored, as the web's
    /// library dedupes a repeated drop.
    func add(urls: [URL]) {
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            guard let size = values?.fileSize else {
                if scoped { url.stopAccessingSecurityScopedResource() }
                problem = "\(url.lastPathComponent) could not be read."
                continue
            }
            let modified = values?.contentModificationDate ?? Date()
            let ref = SavedMediaRef(name: url.lastPathComponent, size: size,
                                    lastModified: (modified.timeIntervalSince1970 * 1000).rounded())
            insert(Entry(ref: ref, url: url, scoped: scoped, owned: false))
        }
        regroup()
    }

    /// A file the shelf already copied into its own temporary folder (a
    /// Photos pick) — removed from disk when it leaves the shelf.
    func add(ownedCopy url: URL) {
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let modified = values?.contentModificationDate ?? Date()
        let ref = SavedMediaRef(name: url.lastPathComponent, size: values?.fileSize ?? 0,
                                lastModified: (modified.timeIntervalSince1970 * 1000).rounded())
        insert(Entry(ref: ref, url: url, scoped: false, owned: true))
        regroup()
    }

    private func insert(_ entry: Entry) {
        let key = fileIdentity(entry.ref)
        if entries.contains(where: { fileIdentity($0.ref) == key }) {
            release(entry)
            return
        }
        entries.append(entry)
    }

    // MARK: - removing

    /// Take an asset off the shelf — every file of the capture.
    func remove(_ asset: Asset) {
        let keys = Set(assetFiles(asset.parts).map(fileIdentity))
        let leaving = entries.filter { keys.contains(fileIdentity($0.ref)) }
        entries.removeAll { keys.contains(fileIdentity($0.ref)) }
        leaving.forEach(release)
        if activeId == asset.id { activeId = nil }
        regroup()
    }

    /// Take ONE part off (the web's "Remove" on a mismatched attachment).
    func remove(part ref: SavedMediaRef) {
        let key = fileIdentity(ref)
        let leaving = entries.filter { fileIdentity($0.ref) == key }
        entries.removeAll { fileIdentity($0.ref) == key }
        leaving.forEach(release)
        regroup()
    }

    private func release(_ entry: Entry) {
        if entry.scoped { entry.url.stopAccessingSecurityScopedResource() }
        if entry.owned { try? FileManager.default.removeItem(at: entry.url.deletingLastPathComponent()) }
    }

    private func regroup() {
        assets = buildAssets(entries.map(\.ref))
    }

    // MARK: - the temporary folder a Photos pick is copied into

    /// A fresh folder per copy, so two picks with one name never collide.
    nonisolated static func copyFolder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("Atelier-Instruments", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}

// MARK: - what can be opened

enum InstrumentFileTypes {
    /// DJI's telemetry sidecar. Declared by extension: the system may know
    /// `.srt` as subtitles, or not at all.
    static var srt: UTType { UTType(filenameExtension: "srt") ?? .plainText }
    /// A 3D LUT.
    static var cube: UTType { UTType(filenameExtension: "cube") ?? .data }

    /// A clip and its flight log.
    static var footage: [UTType] { [.movie, .mpeg4Movie, .quickTimeMovie, srt] }
    /// Pictures, RAW included.
    static var pictures: [UTType] { [.image, .rawImage] }
    /// Both.
    static var media: [UTType] { [.movie, .mpeg4Movie, .quickTimeMovie, .image, .rawImage, srt] }
}

/// A Photos pick carried as a FILE, its own bytes and name kept — the EXIF
/// panel needs the original, never a re-encode (`preferredItemEncoding:
/// .current` at the picker), and a clip is too big for `Data`.
struct PickedMediaFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            try PickedMediaFile(copying: received.file)
        }
        FileRepresentation(importedContentType: .image) { received in
            try PickedMediaFile(copying: received.file)
        }
    }

    /// The received file lives only for the import call: copy it out.
    init(copying file: URL) throws {
        let folder = try InstrumentShelf.copyFolder()
        let target = folder.appendingPathComponent(file.lastPathComponent)
        try FileManager.default.copyItem(at: file, to: target)
        url = target
    }
}
