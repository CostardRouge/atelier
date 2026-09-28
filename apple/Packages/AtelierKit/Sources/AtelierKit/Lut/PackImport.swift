// Reading a folder of purchased `.cube` files into the vault. Port of
// `src/shared/lut/pack-import.ts`, plus the path-only preview its screen
// (`LutPackImportModal`) draws before a byte is stored. Picking the folder,
// reading a file (or a zip's entry) and baking a thumbnail are the app's,
// handed in as closures; which files become looks, in which order and under
// which ids, is decided here.
//
// Rules kept (`media-pipeline.md`, «A pack's thumbnails are baked at IMPORT»):
// - One pass per file: read the bytes ONCE and decode the text from them
//   (reading a 6 MB look twice doubles the peak), hash, parse, encode, store,
//   bake — then yield before the next, never two files in flight.
// - The INDEX is built from the paths and written LAST, so a pack only ever
//   exists with the lattices it names; an interrupted import leaves stored
//   bytes nobody points at, which the next import recognises by hash and
//   skips (`reused`).
// - A file that cannot be read, parsed or stored is REPORTED with its reason
//   and left out of the index: a pack that silently lost three looks is worse
//   than one that says which three.

import Foundation

/// Where an import has got to — one call per file, before it is read.
public struct ImportProgress: Equatable, Sendable {
    public var done: Int
    public var total: Int
    /// The file being read, as the author named it (empty on the last call).
    public var file: String

    public init(done: Int, total: Int, file: String) {
        self.done = done; self.total = total; self.file = file
    }
}

/// A file the import could not take, and why — said, never swallowed.
public struct ImportFailure: Equatable, Sendable {
    public var file: String
    public var reason: String

    public init(file: String, reason: String) {
        self.file = file; self.reason = reason
    }
}

public struct PackImportResult: Equatable, Sendable {
    public var index: LutPackIndex
    public var failed: [ImportFailure]
    /// Looks whose bytes this device already held, by hash — nothing re-stored.
    public var reused: Int
    /// What the import wrote, in bytes (encoded lattices, not `.cube` text).
    public var stored: Int

    public init(index: LutPackIndex, failed: [ImportFailure], reused: Int, stored: Int) {
        self.index = index; self.failed = failed; self.reused = reused; self.stored = stored
    }
}

public struct PackImportOptions: Equatable, Sendable {
    public var id: String
    public var name: String
    public var author: String
    public var url: String?
    public var hidden: [String]
    /// False skips baking thumbnails — the tests, and a re-import that only
    /// re-reads names.
    public var thumbs: Bool

    public init(id: String, name: String, author: String, url: String? = nil, hidden: [String] = [],
                thumbs: Bool = true) {
        self.id = id; self.name = name; self.author = author; self.url = url; self.hidden = hidden
        self.thumbs = thumbs
    }
}

/// The `.cube` files of a picked folder, in a stable order: a `.cube` whose
/// path holds no hidden segment (a dot file, an AppleDouble sidecar, a dot
/// folder), sorted by path as the web's `localeCompare` sorts.
public func cubeEntries<F>(_ files: [(path: String, file: F)]) -> [(path: String, file: F)] {
    let kept = files.filter { entry in
        entry.path.lowercased().hasSuffix(".cube")
            && !entry.path.split(separator: "/").contains { $0.hasPrefix(".") }
    }
    return kept.enumerated().sorted { a, b in
        let order = packLocaleCompare(a.element.path, b.element.path)
        return order != 0 ? order < 0 : a.offset < b.offset
    }.map(\.element)
}

/// The family a file's own category names, for its thumbnail — baked as the
/// file is read, before any index exists. `familyFor` reads the top folder; a
/// file at the pack's root has none.
public func familyOfPath(_ path: String) -> PackFamily {
    guard let slash = path.firstIndex(of: "/") else { return familyFor("") }
    return familyFor(String(path[..<slash]))
}

/// What the import sheet shows before anything is stored: how many looks each
/// folder holds, folders joined with ` · `, `—` for the pack's root — in the
/// order the folders are first met. Built from the paths alone.
public func importPreview(_ paths: [String]) -> [(folder: String, looks: Int)] {
    var order: [String] = []
    var counts: [String: Int] = [:]
    for path in paths {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let key = parts.count > 1 ? parts.dropLast().joined(separator: " · ") : "—"
        if counts[key] == nil { order.append(key) }
        counts[key, default: 0] += 1
    }
    return order.map { ($0, counts[$0] ?? 0) }
}

/// A `.cube`'s text, decoded from the bytes already read — UTF-8 with
/// replacement and a leading byte-order mark dropped, as the web's
/// `TextDecoder` does.
func packCubeText(_ bytes: [UInt8]) -> String {
    if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF {
        return String(decoding: bytes.dropFirst(3), as: UTF8.self)
    }
    return String(decoding: bytes, as: UTF8.self)
}

/// An error's own sentence, for a failure row — or nil when it has none. An
/// error that says nothing of itself (`CustomStringConvertible`) answers its
/// own spelling, never a blank.
private func importReason(_ error: Error) -> String? {
    let text = String(describing: error)
    return text.isEmpty ? nil : text
}

/// Read a picked folder into the vault and answer the pack it made.
///
/// - `read` hands over one file's bytes (a file URL, a zip entry…); a throw is
///   a failure row, never the end of the import.
/// - `bakeThumb` bakes a look on the reference its family asks for and answers
///   a data URL, or nil — a missing thumbnail is never a failed import.
public func importPackFromFolder<F>(
    _ picked: [(path: String, file: F)],
    _ options: PackImportOptions,
    vault: PackVault,
    read: (F) async throws -> [UInt8],
    bakeThumb: ((CubeLut, PackFamily) async -> String?)? = nil,
    onProgress: ((ImportProgress) -> Void)? = nil
) async -> PackImportResult {
    let entries = cubeEntries(picked)
    var failed: [ImportFailure] = []
    var measured: [PackFileEntry] = []
    var thumbs: [String: String] = [:]
    let known = await vault.storedLatticeHashes()
    var reused = 0
    var stored = 0

    for (i, entry) in entries.enumerated() {
        onProgress?(ImportProgress(done: i, total: entries.count, file: entry.path))
        do {
            let bytes = try await read(entry.file)
            let hash = sha256Hex(bytes)
            guard let lut = parseCube(packCubeText(bytes)) else {
                failed.append(ImportFailure(file: entry.path, reason: "Not a 3D .cube LUT (1D LUTs are not supported)."))
                continue
            }
            if known.contains(hash) {
                reused += 1
            } else {
                let encoded = try encodeLattice(lut)
                let ok = await vault.saveLookLattice(options.id, hash, encoded)
                if !ok {
                    failed.append(ImportFailure(file: entry.path,
                                                reason: "This browser refused to store it (storage full?)."))
                    continue
                }
                stored += encoded.count
            }
            measured.append(PackFileEntry(path: entry.path, bytes: bytes.count, lattice: lut.size, hash: hash))
            if options.thumbs, let bakeThumb, let thumb = await bakeThumb(lut, familyOfPath(entry.path)),
               !thumb.isEmpty {
                thumbs[entry.path] = thumb
            }
        } catch {
            failed.append(ImportFailure(file: entry.path, reason: importReason(error) ?? "Could not read it."))
        }
        // One file at a time, with a turn given back between them.
        await Task.yield()
    }

    var index = buildPackIndex(measured, BuildPackOptions(
        id: options.id, name: options.name, author: options.author, url: options.url, hidden: options.hidden
    ))
    index.looks = index.looks.map { look in
        guard let thumb = thumbs[look.file] else { return look }
        var next = look
        next.thumb = thumb
        return next
    }
    await vault.savePack(index)
    onProgress?(ImportProgress(done: entries.count, total: entries.count, file: ""))
    return PackImportResult(index: index, failed: failed, reused: reused, stored: stored)
}
