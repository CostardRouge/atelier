// The BUILT-IN looks as the app ships them — the ONE place a built-in `.cube`,
// its pre-baked tile or a reference frame is read from the bundle. Every
// reader goes through it: the look gallery, the grade panel, the stage's
// render of a look, the export, the LUT instrument.
//
// What the bundle carries (`apple/project.yml`, three FOLDER references, the
// coordinator's call): `public/luts/` WHOLE — 37 MB, four families, the very
// files the web deploys —, `public/lut-thumbs/` (the tiles
// `scripts/gen-lut-thumbs.mjs` baked, each look on the reference its family
// asks for) and `public/reference/` (the log + Rec.709 pair a pack look's
// tile is baked on at import).
//
// The manifest is SCANNED at run time, the way the web's `virtual:luts` Vite
// plugin scans the folder at build time, through the kernel's own naming rule
// (`lutManifest(relativePaths:)`): a document stores a built-in as
// `builtin:<id>`, so a look graded in the browser resolves here only because
// both clients derive the same id from the same path. Adding a `.cube` under
// `public/luts/` needs no code change, on either client.
//
// A lattice is parsed ONCE and kept — a 65³ `.cube` is ~7 MB of text — in a
// small most-recently-used cache: a few looks at once is what a roll wears,
// and 29 parsed lattices held for the session would be ~50 MB on a phone.

import Foundation
import AtelierKit

enum BuiltinLutFiles {
    // MARK: - the folders

    /// The bundled `luts/` folder, or nil when this build carries none.
    static var folder: URL? { Bundle.main.url(forResource: "luts", withExtension: nil) }
    /// The pre-baked tiles.
    static var thumbsFolder: URL? { Bundle.main.url(forResource: "lut-thumbs", withExtension: nil) }
    /// The reference pair.
    static var referenceFolder: URL? { Bundle.main.url(forResource: "reference", withExtension: nil) }

    /// True when the build carries built-ins at all — what a picker says when not.
    static var available: Bool { !luts.isEmpty }

    // MARK: - the manifest

    /// Every `.cube` under `luts/`, as the web's plugin lists them: by group,
    /// then by name, hidden files and AppleDouble sidecars left out.
    static let manifest: [LutManifestEntry] = BuiltinLutFiles.scan()

    /// The built-ins, each `url` the file's path inside the bundle.
    static let luts: [BuiltinLut] = {
        guard let root = BuiltinLutFiles.folder else { return [] }
        return builtinLuts(BuiltinLutFiles.manifest, base: root.path + "/")
    }()

    /// Looks at the `luts/` root — listed before the groups.
    static var ungrouped: [BuiltinLut] { ungroupedLuts(luts) }
    /// The folder groups, labelled as the web's pickers label them (`APPLE`, `DJI`…).
    static var groups: [LutGroup] { lutGroups(luts) }

    static func lut(_ id: String) -> BuiltinLut? {
        luts.first { $0.id == id }
    }

    /// A `builtin:<id>` source's id, or the source itself.
    static func id(ofSource source: String) -> String {
        source.hasPrefix("builtin:") ? String(source.dropFirst("builtin:".count)) : source
    }

    private static func scan() -> [LutManifestEntry] {
        guard let root = BuiltinLutFiles.folder else { return [] }
        let base = root.standardizedFileURL.path
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey],
                                                          options: []) else { return [] }
        var paths: [String] = []
        for case let url as URL in walker {
            let path = url.standardizedFileURL.path
            guard path.hasPrefix(base) else { continue }
            var relative = String(path.dropFirst(base.count))
            while relative.hasPrefix("/") { relative.removeFirst() }
            if !relative.isEmpty { paths.append(relative) }
        }
        return lutManifest(relativePaths: paths)
    }

    // MARK: - the lattices

    /// How many parsed lattices are kept.
    static let cacheCapacity = 8

    private static let lock = NSLock()
    private static var cache: [(id: String, lut: CubeLut)] = []

    /// A built-in's parsed lattice, read from the bundle once and kept — nil
    /// when this build has no such look or its file does not parse. Blocking:
    /// call it off the main actor (`loadCube`).
    static func cube(_ id: String) -> CubeLut? {
        lock.lock()
        if let index = cache.firstIndex(where: { $0.id == id }) {
            let hit = cache.remove(at: index)
            cache.insert(hit, at: 0)
            lock.unlock()
            return hit.lut
        }
        lock.unlock()
        guard let entry = BuiltinLutFiles.lut(id), let data = try? Data(contentsOf: URL(fileURLWithPath: entry.url)),
              var parsed = parseCube(BuiltinLutFiles.cubeText(data)) else { return nil }
        if parsed.title == nil || parsed.title?.isEmpty == true { parsed.title = entry.name }
        lock.lock()
        cache.removeAll { $0.id == id }
        cache.insert((id, parsed), at: 0)
        if cache.count > cacheCapacity { cache.removeLast(cache.count - cacheCapacity) }
        lock.unlock()
        return parsed
    }

    /// The same, off the main actor.
    static func loadCube(_ id: String) async -> CubeLut? {
        await Task.detached(priority: .userInitiated) { BuiltinLutFiles.cube(id) }.value
    }

    /// A `.cube`'s text from its bytes — UTF-8, a leading byte-order mark
    /// dropped, as the web's `TextDecoder` reads it.
    static func cubeText(_ data: Data) -> String {
        let bytes = [UInt8](data)
        if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF {
            return String(decoding: bytes.dropFirst(3), as: UTF8.self)
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    // MARK: - the pre-baked tiles

    /// `<gallery item id> → file path` for every tile the generator baked —
    /// empty when the build ships none (every look then bakes live).
    static let thumbs: [String: String] = {
        guard let folder = BuiltinLutFiles.thumbsFolder,
              let data = try? Data(contentsOf: folder.appendingPathComponent("index.json")) else { return [:] }
        return readBuiltinThumbs(JSONValue.parse(data), dir: folder.path + "/")
    }()

    // MARK: - the reference pair

    /// The frame a look of this family is judged on: D-Log M for a log look,
    /// a photograph for the rest — the maintainer's own frames.
    static func referenceURL(_ family: PackFamily) -> URL? {
        let name = family == .log ? "reference-dlogm.jpg" : "reference-rec709.jpg"
        return referenceFolder?.appendingPathComponent(name)
    }
}
