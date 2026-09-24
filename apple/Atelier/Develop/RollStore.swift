// The rolls this device keeps, and where each picture's BYTES are.
//
// A roll is the web app's document (`AtelierKit.RollDoc`, v5), written as the
// same JSON under Application Support — so a roll made here is one the web
// app reads, and the reverse. What the document never holds is the picture:
// like the web (a folder handle in IndexedDB, a Winnow asset id), this store
// keeps a SIDE TABLE per roll saying how THIS device reaches each file — a
// copy in the app's own container when the bytes arrived as a one-shot
// transfer (a Photos pick), a security-scoped bookmark when the person pointed
// at a file. Neither travels with the roll.

import Foundation
import Observation
import AtelierKit

/// How this device reaches a picture's bytes. Beside the roll, never in it.
enum PictureLocator: Codable, Equatable {
    /// A copy in the app's container, relative to its media folder.
    case container(String)
    /// A file the person pointed at, remembered through a security-scoped bookmark.
    case bookmark(Data)
}

enum PictureError: LocalizedError {
    case noLocator
    case undecodable

    var errorDescription: String? {
        switch self {
        case .noLocator: return "This device does not know where the picture's file is."
        case .undecodable: return "This picture is in a format the device cannot decode."
        }
    }
}

@MainActor
@Observable
final class RollStore {
    private(set) var rolls: [RollDoc] = []
    /// roll id → picture id → locator.
    private var locators: [String: [String: PictureLocator]] = [:]
    private let root: URL
    private var pendingSaves: [String: Task<Void, Never>] = [:]

    init(root: URL? = nil) {
        self.root = root ?? RollStore.defaultRoot()
        load()
    }

    nonisolated static func defaultRoot() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Atelier", isDirectory: true)
    }

    private var rollsDirectory: URL { root.appendingPathComponent("rolls", isDirectory: true) }
    /// Where a container copy lives. Read off the main actor by `bytes(of:mediaDirectory:)`.
    var mediaDirectory: URL { root.appendingPathComponent("media", isDirectory: true) }

    private func rollURL(_ id: String) -> URL { rollsDirectory.appendingPathComponent("\(id).json") }
    private func locatorsURL(_ id: String) -> URL { rollsDirectory.appendingPathComponent("\(id).locators.json") }

    private func load() {
        let fm = FileManager.default
        try? fm.createDirectory(at: rollsDirectory, withIntermediateDirectories: true)
        try? fm.createDirectory(at: mediaDirectory, withIntermediateDirectories: true)
        var found: [RollDoc] = []
        let urls = (try? fm.contentsOfDirectory(at: rollsDirectory, includingPropertiesForKeys: nil)) ?? []
        for url in urls {
            let name = url.lastPathComponent
            guard name.hasSuffix(".json"), !name.hasSuffix(".locators.json") else { continue }
            guard let data = try? Data(contentsOf: url), let doc = readRollDoc(JSONValue.parse(data)) else { continue }
            found.append(doc)
            if let table = try? Data(contentsOf: locatorsURL(doc.id)),
               let decoded = try? JSONDecoder().decode([String: PictureLocator].self, from: table) {
                locators[doc.id] = decoded
            }
        }
        rolls = found.sorted { $0.updatedAt > $1.updatedAt }
    }

    // MARK: - rolls

    func roll(_ id: String) -> RollDoc? {
        rolls.first { $0.id == id }
    }

    @discardableResult
    func create(name: String) -> RollDoc {
        let doc = createRollDoc(name: name)
        rolls.insert(doc, at: 0)
        persist(doc)
        return doc
    }

    /// One change to one roll, written through — debounced to disk.
    func update(_ id: String, _ change: (inout RollDoc) -> Void) {
        guard let i = rolls.firstIndex(where: { $0.id == id }) else { return }
        change(&rolls[i])
        rolls[i].updatedAt = nowMillis()
        persist(rolls[i])
    }

    func rename(_ id: String, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        update(id) { $0.name = trimmed }
    }

    func delete(_ id: String) {
        pendingSaves[id]?.cancel()
        pendingSaves[id] = nil
        rolls.removeAll { $0.id == id }
        let table = locators[id] ?? [:]
        locators[id] = nil
        let fm = FileManager.default
        try? fm.removeItem(at: rollURL(id))
        try? fm.removeItem(at: locatorsURL(id))
        for case .container(let path) in table.values where !containerCopyInUse(path) {
            try? fm.removeItem(at: mediaDirectory.appendingPathComponent(path))
        }
    }

    private func containerCopyInUse(_ path: String) -> Bool {
        locators.values.contains { table in
            table.values.contains { if case .container(let p) = $0 { return p == path } else { return false } }
        }
    }

    private func persist(_ doc: RollDoc) {
        pendingSaves[doc.id]?.cancel()
        let url = rollURL(doc.id)
        let text = doc.json.serialized(pretty: true)
        pendingSaves[doc.id] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            try? text.write(to: url, atomically: true, encoding: .utf8)
            self?.pendingSaves[doc.id] = nil
        }
    }

    /// Write everything still pending, now — the app is going to the background.
    func flush() {
        for (id, task) in pendingSaves {
            task.cancel()
            if let doc = roll(id) {
                try? doc.json.serialized(pretty: true).write(to: rollURL(id), atomically: true, encoding: .utf8)
            }
        }
        pendingSaves = [:]
    }

    private func persistLocators(_ rollId: String) {
        guard let table = locators[rollId], let data = try? JSONEncoder().encode(table) else { return }
        try? data.write(to: locatorsURL(rollId), options: .atomic)
    }

    // MARK: - pictures

    func locator(_ rollId: String, _ pictureId: String) -> PictureLocator? {
        locators[rollId]?[pictureId]
    }

    /// A picture whose bytes ARRIVED (a Photos pick, a drop): copied into the
    /// container, because nothing else lets the roll reach it again tomorrow.
    @discardableResult
    func addPicture(to rollId: String, data: Data, name: String, modified: Date = Date()) -> String? {
        guard let doc = roll(rollId) else { return nil }
        let ref = SavedMediaRef(name: name, size: data.count, lastModified: modified.timeIntervalSince1970 * 1000)
        if let existing = doc.pictures.first(where: { sameMediaRef($0.ref, ref) }) { return existing.id }
        let path = "\(UUID().uuidString.lowercased())-\(RollStore.safeFileName(name))"
        do {
            try data.write(to: mediaDirectory.appendingPathComponent(path), options: .atomic)
        } catch {
            return nil
        }
        let id = newRollId()
        locators[rollId, default: [:]][id] = .container(path)
        update(rollId) { $0 = addPictures($0, [ref]) { id } }
        persistLocators(rollId)
        return id
    }

    /// A picture the person POINTED AT, in Files or the Finder: remembered by
    /// bookmark, never copied — the file stays theirs, where it is.
    @discardableResult
    func addPicture(to rollId: String, url: URL) -> String? {
        guard let doc = roll(rollId) else { return nil }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let modified = values?.contentModificationDate ?? Date()
        let ref = SavedMediaRef(name: url.lastPathComponent, size: values?.fileSize ?? 0, lastModified: modified.timeIntervalSince1970 * 1000)
        if let existing = doc.pictures.first(where: { sameMediaRef($0.ref, ref) }) { return existing.id }
        #if os(macOS)
        let bookmark = try? url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        let bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
        guard let bookmark else { return nil }
        let id = newRollId()
        locators[rollId, default: [:]][id] = .bookmark(bookmark)
        update(rollId) { $0 = addPictures($0, [ref]) { id } }
        persistLocators(rollId)
        return id
    }

    func removePicture(_ rollId: String, _ pictureId: String) {
        let locator = locators[rollId]?[pictureId]
        locators[rollId]?[pictureId] = nil
        update(rollId) { $0 = removePictures($0, [pictureId]) }
        persistLocators(rollId)
        if case .container(let path)? = locator, !containerCopyInUse(path) {
            try? FileManager.default.removeItem(at: mediaDirectory.appendingPathComponent(path))
        }
    }

    /// The bytes behind a locator. Blocking: call it off the main actor.
    nonisolated static func bytes(of locator: PictureLocator, mediaDirectory: URL) throws -> Data {
        switch locator {
        case .container(let path):
            return try Data(contentsOf: mediaDirectory.appendingPathComponent(path))
        case .bookmark(let bookmark):
            var stale = false
            #if os(macOS)
            let url = try URL(resolvingBookmarkData: bookmark, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale)
            #else
            let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            #endif
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try Data(contentsOf: url)
        }
    }

    nonisolated static func safeFileName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        let cleaned = name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }
        return String(cleaned)
    }
}
