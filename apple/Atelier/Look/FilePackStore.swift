// The VAULT's storage on this device — the web's `pack-store.ts` (its own
// IndexedDB database, `atelier-lut-packs`) as two folders under
// `Application Support/Atelier/looks/`:
//
//   packs/<packId>.json       one INDEX per pack, written as the web writes it
//                             (`LutPackIndex.json`), read back through the
//                             kernel's `migratePackIndex`
//   lattices/<hash>.lattice   one ENCODED lattice per look (`PackCodec.swift`
//                             bytes, never `.cube` text), keyed by the SHA-256
//                             of the SOURCE `.cube`, so two packs shipping one
//                             file store it once
//
// Every call DEGRADES rather than throws, as the web's do (`PackStore`): a
// device may refuse a write (a full disk), and a missing lattice has a
// defined meaning — the look says it is not in this vault. An empty or
// malformed hash is never stored nor found: the hash is a FILE NAME here, so
// it is held to lowercase hex before it touches the file system.
//
// Nothing of a pack ever reaches a document, the bundle or a shared file
// (`docs/lut-packs.md` §3): only the vault and an instance the author keeps
// the pack on.

import Foundation
import AtelierKit

actor FilePackStore: PackStore {
    private let root: URL
    private let fm = FileManager.default

    init(root: URL? = nil) {
        self.root = root ?? FilePackStore.defaultRoot()
    }

    nonisolated static func defaultRoot() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Atelier", isDirectory: true)
            .appendingPathComponent("looks", isDirectory: true)
    }

    private var packsDirectory: URL { root.appendingPathComponent("packs", isDirectory: true) }
    private var latticesDirectory: URL { root.appendingPathComponent("lattices", isDirectory: true) }

    private func ensure(_ directory: URL) {
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// A pack id as a file name: the web mints `pk_<uuid>` and the personal
    /// pack is `pk_uploads`, so anything outside `[A-Za-z0-9_.-]` is refused
    /// rather than escaped — an id is never a path.
    private func packURL(_ packId: String) -> URL? {
        guard !packId.isEmpty, !packId.hasPrefix("."),
              packId.unicodeScalars.allSatisfy({ FilePackStore.isNameScalar($0) }) else { return nil }
        return packsDirectory.appendingPathComponent("\(packId).json")
    }

    /// A lattice's file: its hash, lowercase hex only.
    private func latticeURL(_ hash: String) -> URL? {
        guard !hash.isEmpty, hash.unicodeScalars.allSatisfy({ FilePackStore.isHexScalar($0) }) else { return nil }
        return latticesDirectory.appendingPathComponent("\(hash).lattice")
    }

    private static func isNameScalar(_ s: Unicode.Scalar) -> Bool {
        (s >= "a" && s <= "z") || (s >= "A" && s <= "Z") || (s >= "0" && s <= "9") || s == "_" || s == "-" || s == "."
    }

    private static func isHexScalar(_ s: Unicode.Scalar) -> Bool {
        (s >= "0" && s <= "9") || (s >= "a" && s <= "f")
    }

    // MARK: - indexes

    func listStoredPacks() async -> [LutPackIndex] {
        ensure(packsDirectory)
        let urls = (try? fm.contentsOfDirectory(at: packsDirectory, includingPropertiesForKeys: nil)) ?? []
        let rows: [JSONValue] = urls.compactMap { url in
            guard url.pathExtension == "json", let data = try? Data(contentsOf: url) else { return nil }
            return JSONValue.parse(data)
        }
        return readStoredPacks(rows)
    }

    func putStoredPack(_ index: LutPackIndex) async -> Bool {
        guard let url = packURL(index.id) else { return false }
        ensure(packsDirectory)
        let text = index.json.serialized()
        do {
            try Data(text.utf8).write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    func deleteStoredPack(_ packId: String) async {
        guard let url = packURL(packId) else { return }
        try? fm.removeItem(at: url)
    }

    // MARK: - lattices

    func deleteStoredLattices(_ hashes: [String]) async {
        for hash in hashes {
            guard let url = latticeURL(hash) else { continue }
            try? fm.removeItem(at: url)
        }
    }

    func getStoredLattice(_ hash: String) async -> [UInt8]? {
        guard let url = latticeURL(hash), let data = try? Data(contentsOf: url) else { return nil }
        return [UInt8](data)
    }

    /// `packId` is recorded by the web beside the bytes and read by nothing;
    /// which lattices are free is a question about every index at once, asked
    /// by the vault (`freedHashes`), never by the store.
    func putStoredLattice(_ hash: String, packId: String, bytes: [UInt8]) async -> Bool {
        guard let url = latticeURL(hash) else { return false }
        ensure(latticesDirectory)
        do {
            try Data(bytes).write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    func storedLatticeHashes() async -> Set<String> {
        Set(latticeFiles().map(\.hash))
    }

    /// MEASURED off the stored files — never read off an index, which records
    /// what each `.cube` TEXT weighed (`PackWeight.swift`).
    func storedLatticeSizes() async -> LatticeSizes {
        var sizes: LatticeSizes = [:]
        for file in latticeFiles() {
            let values = try? file.url.resourceValues(forKeys: [.fileSizeKey])
            if let size = values?.fileSize { sizes[file.hash] = size }
        }
        return sizes
    }

    private func latticeFiles() -> [(hash: String, url: URL)] {
        ensure(latticesDirectory)
        let urls = (try? fm.contentsOfDirectory(at: latticesDirectory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return urls.compactMap { url in
            guard url.pathExtension == "lattice" else { return nil }
            let hash = url.deletingPathExtension().lastPathComponent
            guard latticeURL(hash) != nil else { return nil }
            return (hash: hash, url: url)
        }
    }
}
