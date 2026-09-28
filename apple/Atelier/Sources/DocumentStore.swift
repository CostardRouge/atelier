// ONE on-disk store for the suite's three documents — a roll, a trip, a Studio
// project — the native twin of the web's three IndexedDB stores (`roll-store`,
// `trip-store`, `project-store`), each of which keeps a document per id and,
// beside it and never on it, a SYNC RECORD per document kept on an instance.
//
// Layout, under `Application Support/Atelier/<folder>/`:
//
//     <id>.json         the document, the web's own JSON (the kernel's writer)
//     <id>.sync.json    its sync record (`SyncRecord.json` / `readSyncRecord`)
//     <id>.thumb.jpg    its gallery thumbnail, when the tool bakes one
//
// The record is a SIDECAR because put on the document it would leak into the
// file and onto the wire (`DocSync.swift`); `dirtyAt` persisting there is the
// whole crash story — an app killed mid-edit leaves the record dirty and the
// next open pushes it. A thumbnail is this device's and never travels either.
//
// The document files are written exactly as `RollStore` writes a roll (the
// same folder, the same pretty JSON), so the Develop tool's store can sit on
// this one without moving a byte. Every call is synchronous and small, and
// degrades rather than throws — as the web's stores do: a failed write
// answers false and the caller keeps what it has in memory.

import Foundation
import AtelierKit

// MARK: - what a stored document is

/// A document the suite keeps per id, on this device and optionally on an
/// instance's bucket. The kernel's readers and writers, named once per kind.
protocol StoredDocument: Equatable, Sendable {
    /// The bucket's `kind`: `roll`, `trip`, `project`.
    static var bucketKind: String { get }
    /// The folder under `Application Support/Atelier`.
    static var folderName: String { get }
    /// The word a sentence uses: "roll", "trip", "project".
    static var noun: String { get }

    var id: String { get }
    var sourceId: String { get set }
    var updatedAt: Double { get set }
    var version: Int { get }
    /// The document as this device keeps it.
    var json: JSONValue { get }
    /// A stored document read and migrated, or nil when it is not one.
    static func readStored(_ raw: JSONValue?) -> Self?

    /// The document as an instance's bucket keeps it (no `sourceId`, nothing
    /// bound to this machine).
    var wireDoc: JSONValue { get }
    /// A stored body back into a document: id and source from the REQUEST,
    /// what is this device's kept from `local`. Throws a `WinnowError` of kind
    /// `protocol` when the body is not one.
    static func fromWire(_ raw: JSONValue?, id: String, sourceId: String, local: Self?) throws -> Self

    /// The same document kept on another source, as a MOVE writes it.
    func moved(to sourceId: String, now: Double) -> Self
}

extension RollDoc: StoredDocument {
    static var bucketKind: String { "roll" }
    static var folderName: String { "rolls" }
    static var noun: String { "roll" }

    static func readStored(_ raw: JSONValue?) -> RollDoc? { readRollDoc(raw) }

    var wireDoc: JSONValue { toWireDoc(self) }

    static func fromWire(_ raw: JSONValue?, id: String, sourceId: String, local: RollDoc?) throws -> RollDoc {
        do {
            return try fromWireDoc(raw, id, sourceId)
        } catch let error as WireDocError {
            throw WinnowError(.protocol, error.message)
        }
    }

    /// The web's `moveRoll`: through the portable file (fresh picture ids),
    /// keeping the roll's own id and birth.
    func moved(to sourceId: String, now: Double) -> RollDoc {
        var doc = rollDocFromFile(toRollFile(self, exportedAt: now), now: now, sourceId: sourceId)
        doc.id = id
        doc.createdAt = createdAt
        return doc
    }
}

extension ProjectDoc: StoredDocument {
    static var bucketKind: String { projectDocKind }
    static var folderName: String { "projects" }
    static var noun: String { "project" }

    static func readStored(_ raw: JSONValue?) -> ProjectDoc? { readProjectDoc(raw) }

    var wireDoc: JSONValue { toWireDoc(self) }

    static func fromWire(_ raw: JSONValue?, id: String, sourceId: String, local: ProjectDoc?) throws -> ProjectDoc {
        try fromWireDoc(raw, id, sourceId, local: local)
    }

    /// The kernel's `moveProject`: the same document, another source, stamped now.
    func moved(to sourceId: String, now: Double) -> ProjectDoc {
        var doc = self
        doc.sourceId = sourceId
        doc.updatedAt = now
        return doc
    }
}

// MARK: - the store

struct DocumentStore<D: StoredDocument>: Sendable {
    /// `Application Support/Atelier/<folder>`.
    let directory: URL

    /// `Application Support/Atelier` — the root every store of the app shares.
    static var defaultRoot: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Atelier", isDirectory: true)
    }

    init(root: URL = DocumentStore.defaultRoot) {
        directory = root.appendingPathComponent(D.folderName, isDirectory: true)
    }

    /// A file name for an id. A UUID stays as it is (the files `RollStore`
    /// already wrote); anything else — an id listed by an instance is not
    /// ours to trust — is percent-encoded, so no id can name a path outside
    /// this folder or collide with a sidecar's suffix.
    static func fileStem(_ id: String) -> String {
        var out = ""
        for byte in id.utf8 {
            switch byte {
            case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2D, 0x5F:
                out.append(Character(UnicodeScalar(byte)))
            default:
                out += String(format: "%%%02X", byte)
            }
        }
        return out.isEmpty ? "%00" : out
    }

    func documentURL(_ id: String) -> URL { directory.appendingPathComponent("\(Self.fileStem(id)).json") }
    func syncURL(_ id: String) -> URL { directory.appendingPathComponent("\(Self.fileStem(id)).sync.json") }
    func thumbnailURL(_ id: String) -> URL { directory.appendingPathComponent("\(Self.fileStem(id)).thumb.jpg") }

    private func ensureDirectory() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Whether a file in the folder is a document (not a sidecar of one).
    static func isDocumentFile(_ name: String) -> Bool {
        name.hasSuffix(".json") && !name.hasSuffix(".sync.json") && !name.hasSuffix(".locators.json")
    }

    // MARK: documents

    /// Every stored document, read and migrated, most recently updated first;
    /// empty when the folder cannot be read. A file that is not one is skipped.
    func list() -> [D] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        var found: [D] = []
        for url in urls where Self.isDocumentFile(url.lastPathComponent) {
            guard let data = try? Data(contentsOf: url), let doc = D.readStored(JSONValue.parse(data)) else { continue }
            found.append(doc)
        }
        return found.enumerated().sorted { a, b in
            if a.element.updatedAt != b.element.updatedAt { return a.element.updatedAt > b.element.updatedAt }
            return a.element.id < b.element.id
        }.map(\.element)
    }

    func get(_ id: String) -> D? {
        guard let data = try? Data(contentsOf: documentURL(id)) else { return nil }
        return D.readStored(JSONValue.parse(data))
    }

    /// False when the write failed (a full disk, a revoked container).
    @discardableResult
    func put(_ doc: D) -> Bool {
        ensureDirectory()
        do {
            try doc.json.serialized(pretty: true).write(to: documentURL(doc.id), atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    /// The document and everything that belongs to it here: its record and
    /// its thumbnail.
    func delete(_ id: String) {
        let fm = FileManager.default
        try? fm.removeItem(at: documentURL(id))
        try? fm.removeItem(at: syncURL(id))
        try? fm.removeItem(at: thumbnailURL(id))
    }

    // MARK: the sync record

    /// The record for a document, or nil when it has none (a local document,
    /// or one never pushed from here).
    func getSyncRecord(_ id: String) -> SyncRecord? {
        guard let data = try? Data(contentsOf: syncURL(id)) else { return nil }
        return readSyncRecord(JSONValue.parse(data))
    }

    @discardableResult
    func putSyncRecord(_ record: SyncRecord) -> Bool {
        ensureDirectory()
        do {
            try record.json.serialized(pretty: true).write(to: syncURL(record.id), atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    func deleteSyncRecord(_ id: String) {
        try? FileManager.default.removeItem(at: syncURL(id))
    }

    // MARK: the thumbnail

    func thumbnail(_ id: String) -> Data? {
        try? Data(contentsOf: thumbnailURL(id))
    }

    /// Write a thumbnail, or remove it with nil.
    @discardableResult
    func putThumbnail(_ data: Data?, for id: String) -> Bool {
        guard let data else {
            try? FileManager.default.removeItem(at: thumbnailURL(id))
            return true
        }
        ensureDirectory()
        return (try? data.write(to: thumbnailURL(id), options: .atomic)) != nil
    }
}

// MARK: - the ledger

/// How many documents each source holds on this device, read off the disk for
/// every kind — including the kinds whose tool is not ported yet, since a
/// document's `sourceId` is read without its type. What the sources screen
/// counts BEFORE a forget asks.
enum DocumentLedger {
    /// Each document's `sourceId` in a folder — nil for one written before the
    /// field existed, which `countBySource` files under this device.
    static func sourceIds(in folder: URL) -> [String?] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        var ids: [String?] = []
        for url in urls where DocumentStore<RollDoc>.isDocumentFile(url.lastPathComponent) {
            guard let data = try? Data(contentsOf: url), let o = JSONValue.parse(data)?.objectValue,
                  let id = o["id"]?.stringValue, !id.isEmpty else { continue }
            let source = o["sourceId"]?.stringValue
            ids.append(source.flatMap { $0.isEmpty ? nil : $0 })
        }
        return ids
    }

    /// The three kinds, counted per source.
    static func counts(root: URL = DocumentStore<RollDoc>.defaultRoot) -> [String: DocCount] {
        countBySource(
            projects: sourceIds(in: root.appendingPathComponent("projects", isDirectory: true)),
            trips: sourceIds(in: root.appendingPathComponent("trips", isDirectory: true)),
            rolls: sourceIds(in: root.appendingPathComponent("rolls", isDirectory: true))
        )
    }
}
