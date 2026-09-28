// The shell's LIBRARY — ONE pool of files every tool reads from, the native
// twin of the web's `AssetLibraryContext.tsx` (`architecture.md`, «One asset
// library, capability-matched per tool»).
//
// Files are grouped by the kernel's `buildAssets` into captures keyed by base
// name (`DJI_0001.MP4` + `DJI_0001.SRT` one `video+telemetry` asset, a RAW +
// its JPEG one photo whose RAW is KEPT as a sibling and SAID), and a tool
// takes what it accepts through `usableAssets`. The pool holds HANDLES —
// `LibraryLocation`s — never bytes: a cover is read lazily when its row asks,
// three at a time and newest first (the kernel's `DecodeQueue`), at the
// cover's size.
//
// Where it departs from the web, and why:
// - The web's pool is a tab's memory and a reload empties it. An app is
//   LAUNCHED, and iOS ends it in the background whenever it likes, so a
//   pool that forgot every folder at each launch would be the worst of both:
//   what the person POINTED AT (a file, a folder) is kept by security-scoped
//   bookmark under `Application Support/Atelier/library/library.v1.json`.
//   What was COPIED (a Photos pick) or FETCHED (an instance's proxy) is the
//   session's alone, in a temporary folder emptied at the next launch — the
//   web declined a byte cache of fetched media, and so does this.
// - Each file's partial hash (`partialHash`, Winnow's `content_hash`) is
//   computed off the main actor as it lands, so a picture carried onto a
//   roll or a piece names its media by CONTENT; a fetched file is vouched for
//   with the ORIGINAL's hash and never hashed on its own bytes.
//
// Rules kept from the web: a duplicate drop (same name, size and date) is
// ignored; what lands is SELECTED; the active asset is the one a tool works
// on, cleared when it leaves; a capture leaves with ALL its files
// (`assetFiles`), or its RAW half would come back as a photo of its own.

import CoreGraphics
import Foundation
import Observation
import PhotosUI
import SwiftUI
import AtelierKit

/// One file of the pool, and how this device reaches it.
struct LibraryEntry: Equatable {
    var ref: SavedMediaRef
    var location: LibraryLocation
    /// Where a fetched file came from — on the MAIN file of a fetch only.
    var origin: MediaOrigin?
    /// What the source parsed at ingest, for a still whose proxy dropped it.
    var exif: ExifData?
    /// Where the capture's own bytes are, when this file is its proxy.
    var originalUrl: String?

    init(ref: SavedMediaRef, location: LibraryLocation, origin: MediaOrigin? = nil, exif: ExifData? = nil,
         originalUrl: String? = nil) {
        self.ref = ref
        self.location = location
        self.origin = origin
        self.exif = exif
        self.originalUrl = originalUrl
    }
}

/// What the Library file keeps of an entry: a handle the person gave.
private struct StoredLibraryEntry: Codable {
    var ref: SavedMediaRef
    var location: LibraryLocation
}

@MainActor
@Observable
final class LibraryStore {
    static let shared = LibraryStore()

    /// The files, in the order they arrived.
    private(set) var entries: [LibraryEntry] = []
    /// The files grouped into captures, sorted by base name.
    private(set) var assets: [Asset] = []
    /// Ids of the selected assets — what a tool acting on "the selection" reads.
    private(set) var selection: Set<String> = []
    /// The asset the person last put to work — the one a tool makes active.
    private(set) var activeId: String?
    /// Covers read so far, by asset id.
    private(set) var covers: [String: LibraryCover] = [:]
    /// The last thing an add could not do, said once.
    var notice: String?
    /// A pick is being read in.
    private(set) var busy = false

    @ObservationIgnored private let file: URL?
    /// Where session copies live — emptied at the next launch.
    @ObservationIgnored let sessionDirectory: URL
    @ObservationIgnored private let coverQueue: DecodeQueue
    @ObservationIgnored private var hashing: Set<String> = []

    /// `root` is `Application Support/Atelier` by default; `persists: false`
    /// keeps nothing (previews).
    init(root: URL? = nil, persists: Bool = true) {
        let base = root ?? RollStore.defaultRoot()
        file = persists
            ? base.appendingPathComponent("library", isDirectory: true).appendingPathComponent("library.v1.json")
            : nil
        let sessions = FileManager.default.temporaryDirectory.appendingPathComponent("Atelier-Library", isDirectory: true)
        // What the last session copied or fetched is gone with it.
        if persists { try? FileManager.default.removeItem(at: sessions) }
        sessionDirectory = sessions.appendingPathComponent(UUID().uuidString, isDirectory: true)
        coverQueue = (try? DecodeQueue(slots: 3)) ?? (try! DecodeQueue(slots: 1))
        load()
    }

    // MARK: - reading the pool

    func asset(_ id: String) -> Asset? {
        assets.first { $0.id == id }
    }

    /// The asset a tool should work on, or nil.
    var activeAsset: Asset? {
        activeId.flatMap { asset($0) }
    }

    /// What a tool accepting `accepts` can use, in the pool's order.
    func usable(_ accepts: [AssetKind]) -> [Asset] {
        usableAssets(accepts, assets)
    }

    /// The entry behind a file of an asset.
    func entry(for ref: SavedMediaRef) -> LibraryEntry? {
        let key = fileIdentity(ref)
        return entries.first { fileIdentity($0.ref) == key }
    }

    /// Where a file's bytes are.
    func location(of ref: SavedMediaRef) -> LibraryLocation? {
        entry(for: ref)?.location
    }

    /// Where the asset came from, when a source handed it over.
    func origin(of asset: Asset) -> MediaOrigin? {
        assetMainFile(asset).flatMap { entry(for: $0)?.origin }
    }

    /// The pool split by provenance — Local, then each instance (`splitAssetsBySource`).
    var bySource: AssetsBySource {
        splitAssetsBySource(assets)
    }

    /// `"<host>/<id>"` → the asset it became, for one instance's tiles.
    func inLibrary(_ host: String) -> [String: String] {
        var out: [String: String] = [:]
        for asset in bySource.assets(of: host) {
            if let rid = assetRemoteId(asset) { out[rid] = asset.id }
        }
        return out
    }

    /// The picture an asset hands to whatever it is dropped on or used in —
    /// its image, else its clip.
    func dropped(_ asset: Asset) -> DroppedAsset? {
        guard let ref = asset.parts.image ?? asset.parts.video, let entry = entry(for: ref) else { return nil }
        return DroppedAsset(assetId: asset.id, ref: entry.ref, location: entry.location, origin: entry.origin)
    }

    // MARK: - adding

    /// Files or folders pointed at in Files or the Finder, or dropped. A
    /// folder is read every depth down; what cannot be grouped is left out.
    func add(urls: [URL]) {
        var fresh: [LibraryEntry] = []
        var refused = 0
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let isFolder = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            if isFolder {
                guard let bookmark = RollStore.makeBookmark(url) else {
                    refused += 1
                    continue
                }
                for item in LibraryFiles.listFolder(url) {
                    fresh.append(LibraryEntry(ref: item.ref, location: .folder(bookmark, item.path)))
                }
            } else if classifyPart(url.lastPathComponent) == .other {
                refused += 1
            } else if let bookmark = RollStore.makeBookmark(url) {
                fresh.append(LibraryEntry(ref: RollStore.mediaRef(of: url), location: .bookmark(bookmark)))
            } else {
                refused += 1
            }
        }
        let added = insert(fresh)
        if refused > 0 {
            notice = "\(refused) item\(refused == 1 ? "" : "s") could not be read — nothing of it was added."
        } else if added == 0 && !urls.isEmpty {
            notice = fresh.isEmpty ? "Nothing there the Library can use." : "Already in the Library."
        } else {
            notice = nil
        }
    }

    /// Pictures and clips picked in Photos — COPIED for the session, the one
    /// way a Photos pick has bytes without library permission.
    func add(photos items: [PhotosPickerItem]) async {
        busy = true
        defer { busy = false }
        var fresh: [LibraryEntry] = []
        var refused = 0
        for item in items {
            guard let picked = try? await item.loadTransferable(type: PickedMediaFile.self) else {
                refused += 1
                continue
            }
            guard let kept = keepForSession(picked.url) else {
                refused += 1
                continue
            }
            fresh.append(LibraryEntry(ref: RollStore.mediaRef(of: kept), location: .session(kept.path)))
        }
        insert(fresh)
        notice = refused > 0 ? "\(refused) item\(refused == 1 ? "" : "s") from Photos could not be read." : nil
    }

    /// A file a pick copied somewhere temporary, moved into this session's folder.
    private func keepForSession(_ url: URL) -> URL? {
        let folder = sessionDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let target = folder.appendingPathComponent(url.lastPathComponent)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: url, to: target)
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            return target
        } catch {
            return nil
        }
    }

    /// Files fetched from an instance (`materialize`), kept for the session,
    /// each vouched for with the ORIGINAL's identity and dated at the capture.
    /// Returns the asset they became.
    @discardableResult
    func addFetched(_ files: [MaterializedFile]) -> String? {
        guard let first = files.first else { return nil }
        let folder = sessionDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var fresh: [LibraryEntry] = []
        for fetched in files {
            let target = folder.appendingPathComponent(RollStore.safeFileName(fetched.file.name))
            guard (try? fetched.file.data.write(to: target, options: .atomic)) != nil else { continue }
            let ref = SavedMediaRef(name: fetched.file.name, size: fetched.file.size, lastModified: fetched.file.lastModified,
                                    assetId: fetched.identity.assetId, hash: fetched.identity.hash)
            fresh.append(LibraryEntry(ref: ref, location: .session(target.path), origin: fetched.identity.origin,
                                      exif: fetched.identity.exif, originalUrl: fetched.identity.originalUrl))
        }
        insert(fresh)
        return fileBaseName(first.file.name).lowercased()
    }

    /// Entries not already in the pool join it; the assets they touch are
    /// selected and their covers read again. Returns how many joined.
    @discardableResult
    private func insert(_ incoming: [LibraryEntry]) -> Int {
        var seen = Set(entries.map { fileIdentity($0.ref) })
        var fresh: [LibraryEntry] = []
        for entry in incoming {
            let key = fileIdentity(entry.ref)
            if seen.contains(key) { continue }
            seen.insert(key)
            fresh.append(entry)
        }
        guard !fresh.isEmpty else { return 0 }
        // An asset that gained a file (an SRT-only asset its clip) has a stale cover.
        let touched = buildAssets(fresh.map(\.ref)).map(\.id)
        for id in touched { covers[id] = nil }
        selection.formUnion(touched)
        entries += fresh
        regroup()
        save()
        hashMissing()
        return fresh.count
    }

    // MARK: - selection and focus

    /// Put an asset to work: select it and make it the active one.
    func activate(_ id: String) {
        selection.insert(id)
        activeId = id
    }

    func setActive(_ id: String?) {
        activeId = id
    }

    func toggle(_ id: String) {
        if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    }

    /// Select or deselect a set of assets in one go, leaving the rest — a
    /// tab's "all / none" acts on its own assets only.
    func select(_ ids: [String], on: Bool) {
        if on { selection.formUnion(ids) } else { selection.subtract(ids) }
    }

    // MARK: - removing

    /// An asset leaves with every file of its capture.
    func remove(_ id: String) {
        guard let asset = asset(id) else { return }
        let leaving = Set(assetFiles(asset.parts).map(fileIdentity))
        drop { leaving.contains(fileIdentity($0.ref)) }
        covers[id] = nil
        selection.remove(id)
        if activeId == id { activeId = nil }
    }

    /// One file leaves — a pair's sidecar detached; the asset regroups.
    func removeFile(_ ref: SavedMediaRef) {
        let key = fileIdentity(ref)
        if let owner = assets.first(where: { assetFiles($0.parts).contains { fileIdentity($0) == key } }) {
            covers[owner.id] = nil
        }
        drop { fileIdentity($0.ref) == key }
    }

    /// Empty the Library — handles only: no file anywhere is touched but the
    /// session's own copies.
    func clear() {
        drop { _ in true }
        covers = [:]
        selection = []
        activeId = nil
    }

    private func drop(_ leaving: (LibraryEntry) -> Bool) {
        let gone = entries.filter(leaving)
        entries.removeAll(where: leaving)
        for entry in gone {
            if case .session(let path) = entry.location {
                try? FileManager.default.removeItem(at: URL(fileURLWithPath: path))
            }
        }
        regroup()
        save()
    }

    private func regroup() {
        assets = buildAssets(entries.map(\.ref))
        let ids = Set(assets.map(\.id))
        selection = selection.intersection(ids)
        if let active = activeId, !ids.contains(active) { activeId = nil }
        covers = covers.filter { ids.contains($0.key) }
    }

    // MARK: - covers

    /// Read an asset's cover once, when its row asks — three at a time, the
    /// newest request first, so the rows on screen are drawn before the ones
    /// already scrolled past.
    func ensureCover(_ id: String) {
        guard covers[id] == nil, let asset = asset(id) else { return }
        let isVideo = asset.parts.video != nil
        covers[id] = LibraryCover(facts: CoverFacts(status: .pending, isVideo: isVideo), thumbnail: nil)
        let image: (location: LibraryLocation, name: String)? = asset.parts.image.flatMap { ref in
            location(of: ref).map { ($0, ref.name) }
        }
        let video = asset.parts.video.flatMap { location(of: $0) }
        let srt = asset.parts.srt.flatMap { location(of: $0) }
        coverQueue.enqueue({ (settle: @escaping (Result<LibraryCover, Error>) -> Void) in
            Task.detached(priority: .utility) {
                let cover = await LibraryCovers.read(image: image, video: video, srt: srt)
                settle(.success(cover))
            }
        }, completion: { [weak self] (result: Result<LibraryCover, Error>) in
            Task { @MainActor in self?.land(id, result) }
        })
    }

    private func land(_ id: String, _ result: Result<LibraryCover, Error>) {
        // Removed, or re-asked since: this answer is about something else.
        guard covers[id]?.facts.status == .pending, case .success(let cover) = result else { return }
        covers[id] = cover
    }

    // MARK: - identity

    /// Hash every file a person gave that has no hash yet, off the main actor.
    private func hashMissing() {
        for entry in entries where entry.ref.hash == nil && entry.ref.assetId == nil {
            let key = fileIdentity(entry.ref)
            if hashing.contains(key) { continue }
            hashing.insert(key)
            let location = entry.location
            Task { [weak self] in
                let hash = await Task.detached(priority: .utility) { try? LibraryFiles.hash(location) }.value
                self?.setHash(key, hash)
            }
        }
    }

    private func setHash(_ key: String, _ hash: String?) {
        hashing.remove(key)
        guard let hash, let i = entries.firstIndex(where: { fileIdentity($0.ref) == key }) else { return }
        entries[i].ref.hash = hash
        regroup()
        save()
    }

    // MARK: - the file

    private func load() {
        guard let file, let data = try? Data(contentsOf: file),
              let stored = try? JSONDecoder().decode([StoredLibraryEntry].self, from: data) else { return }
        entries = stored.map { LibraryEntry(ref: $0.ref, location: $0.location) }
        regroup()
        hashMissing()
    }

    private func save() {
        guard let file else { return }
        let stored = entries.filter { $0.location.persists }.map { StoredLibraryEntry(ref: $0.ref, location: $0.location) }
        guard let data = try? JSONEncoder().encode(stored) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }
}

// MARK: - previews

extension LibraryStore {
    /// A Library holding `entries` as they are, persisting nothing — for `#Preview`.
    static func preview(_ entries: [LibraryEntry] = [], covers: [String: LibraryCover] = [:]) -> LibraryStore {
        let store = LibraryStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("atelier-library-preview"),
                                 persists: false)
        store.entries = entries
        store.regroup()
        store.covers = covers
        return store
    }
}
