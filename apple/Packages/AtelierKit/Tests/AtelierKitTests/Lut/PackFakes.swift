// The two halves of the vault that are the app's — the device's storage and
// an instance's HTTP client — stood in for, as the web's specs stand in for
// IndexedDB and `WinnowClient`. Shared by the pack specs.

import Foundation
@testable import AtelierKit

/// The vault's storage, in memory — what IndexedDB is to the web. Every index
/// goes through the JSON writer and `readStoredPacks` on the way back, so a
/// field the writer forgot is a failing spec, not a silent loss.
final class MemoryPackStore: PackStore, @unchecked Sendable {
    var packs: [String: JSONValue] = [:]
    var lattices: [String: [UInt8]] = [:]
    /// Every write, in order: `pack:<id>`, `lattice:<hash>`.
    var events: [String] = []
    var packWrites = 0
    var lists = 0
    var latticeReads: [String] = []
    var refuseLattices = false

    func listStoredPacks() async -> [LutPackIndex] {
        lists += 1
        return readStoredPacks(Array(packs.values))
    }

    func putStoredPack(_ index: LutPackIndex) async -> Bool {
        packs[index.id] = index.json
        packWrites += 1
        events.append("pack:\(index.id)")
        return true
    }

    func deleteStoredPack(_ packId: String) async {
        packs[packId] = nil
    }

    func deleteStoredLattices(_ hashes: [String]) async {
        for hash in hashes where !hash.isEmpty { lattices[hash] = nil }
    }

    func getStoredLattice(_ hash: String) async -> [UInt8]? {
        if hash.isEmpty { return nil }
        latticeReads.append(hash)
        return lattices[hash]
    }

    func putStoredLattice(_ hash: String, packId: String, bytes: [UInt8]) async -> Bool {
        if hash.isEmpty || refuseLattices { return false }
        lattices[hash] = bytes
        events.append("lattice:\(hash)")
        return true
    }

    func storedLatticeHashes() async -> Set<String> { Set(lattices.keys) }

    func storedLatticeSizes() async -> LatticeSizes { lattices.mapValues(\.count) }

    /// The index stored under this id, read back.
    func stored(_ id: String) -> LutPackIndex? { migratePackIndex(packs[id]) }
}

/// What the instance answers when it refuses — the route's own sentence.
struct InstanceRefusal: Error, CustomStringConvertible {
    let description: String
}

/// A stand-in for the instance: it records the ORDER of what it was asked to
/// do, the property that matters — bytes before the index that names them.
/// Its file store refuses a body that does not hash to its path, exactly as
/// the real route does, so the one rule that route has is held here too.
final class FakePackClient: PackRemoteClient, @unchecked Sendable {
    var calls: [String] = []
    var files: [String: [UInt8]] = [:]
    private(set) var docs: [String: JSONValue] = [:]
    private var docOrder: [String] = []
    /// The `If-Match` each document write carried, in order.
    var ifMatches: [String?] = []
    var offline = false

    init(has: [String] = []) {
        for hash in has { files[hash] = [1] }
    }

    func setDoc(_ id: String, _ doc: JSONValue) {
        if docs[id] == nil { docOrder.append(id) }
        docs[id] = doc
    }

    func listAppFiles(_ app: String) async throws -> [String] {
        calls.append("list-files")
        return Array(files.keys)
    }

    func putAppFile(_ app: String, _ id: String, _ bytes: [UInt8], mediaType: String, maxBytes: Int?) async throws {
        calls.append("put-file:\(id)")
        if sha256Hex(bytes) != id { throw InstanceRefusal(description: "the body does not hash to that id") }
        files[id] = bytes
    }

    func getAppFile(_ app: String, _ id: String) async throws -> [UInt8]? {
        calls.append("get-file:\(id)")
        if offline { throw InstanceRefusal(description: "unreachable") }
        return files[id]
    }

    func deleteAppFile(_ app: String, _ id: String) async throws {
        calls.append("del-file:\(id)")
        files[id] = nil
    }

    func docEtag(_ app: String, _ id: String) async throws -> String? {
        calls.append("get-doc:\(id)")
        return docs[id] == nil ? nil : "e1"
    }

    func putDoc(_ app: String, _ id: String, _ body: JSONValue, ifMatch: String?, maxBytes: Int?) async throws {
        calls.append("put-doc:\(id)")
        ifMatches.append(ifMatch)
        setDoc(id, body.objectValue?["doc"] ?? .null)
    }

    func deleteDoc(_ app: String, _ id: String, ifMatch: String?) async throws {
        calls.append("del-doc:\(id)")
        docs[id] = nil
        docOrder.removeAll { $0 == id }
    }

    func listDocs(_ app: String, kind: String) async throws -> [JSONValue] {
        calls.append("list-docs:\(kind)")
        return docOrder.compactMap { docs[$0] }
    }
}

/// An instance that can keep a pack, over a fresh fake client.
func fakePackHost(has: [String] = []) -> (host: PackHost, client: FakePackClient) {
    let client = FakePackClient(has: has)
    let host = PackHost(sourceId: "winnow.example", client: client, maxDocBytes: 1024 * 1024,
                        maxFileBytes: 16 * 1024 * 1024)
    return (host, client)
}

/// A counter a `@Sendable` listener can bump.
final class PackCounter: @unchecked Sendable {
    var count = 0
}
