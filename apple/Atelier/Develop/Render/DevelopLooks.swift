// The LOOKS this device can grade with — the app's two answers to the
// questions the kernel's `restoreLayers` asks (`Lut/SavedGrade.swift`, the
// arithmetic of the web's `restore-grade.ts`):
//
// - a BUILT-IN, `builtin:<id>`, is read from the app bundle's `luts/` folder
//   — ONE folder reference to the web's own `public/luts/` (`project.yml`),
//   scanned once through the kernel's `lutManifest(relativePaths:)`, so a look
//   graded in the browser resolves here only because both clients derive the
//   same id from the same file (`BuiltinLuts.swift`, «THE ID RULE IS
//   LOAD-BEARING»). A `.cube` is parsed once and kept;
// - a PACK look is a reference into the VAULT (`Lut/PackVault.swift`), over a
//   store on this device's disk (`DiskPackStore`, the web's IndexedDB
//   `atelier-lut-packs`). The vault is an actor and resolving is async, while
//   a render is synchronous: `prepare` resolves a grade's pack looks ahead of
//   the render and keeps the lattices, and the render asks only what is kept.
//   A look the vault does not hold comes back in its place CARRYING `missing`
//   (the kernel's rule: a missing look is visible, never silently neutral),
//   and the stage says which. The remote half (fetching an evicted lattice
//   from the instance the pack is kept on) is the vault's own and waits for
//   the app to hand it its hosts; nothing here fetches anything.
//
// A film stock is a layer generated from its settings (`Film/FilmLayer.swift`)
// — `restoreLayers` builds it, nothing is read. An inlined `.cube` from before
// uploads went into the vault (`custom`) is parsed from the layer itself.

import AtelierKit
import Foundation

/// A picture's look, resolved and ready to bake.
struct ResolvedLook {
    /// The layers `composeLutStack` takes, in the stack's order; a pack look
    /// this device does not hold is among them with `missing` set, and the
    /// bake skips it.
    var layers: [LutLayer]
    var output: OutputTransform
    /// What does not grade here, in words — `AUTHENTIC · Kodak (not in this vault)`.
    var missing: [String]

    static let none = ResolvedLook(layers: [], output: .none, missing: [])
}

final class DevelopLooks: @unchecked Sendable {
    /// The app's one library: every picture of every roll reads it.
    static let shared = DevelopLooks()

    /// The purchased looks on this device.
    let vault: PackVault
    /// The bundle's `luts/` folder, or nil where the build carries none.
    let folder: URL?

    private let lock = NSLock()
    private var entries: [String: LutManifestEntry]?
    private var ordered: [LutManifestEntry] = []
    private var builtins: [String: (lut: CubeLut, name: String)] = [:]
    private var unreadable: Set<String> = []
    /// Pack lattices kept, by `packKey`, with the name the vault knows the look by.
    private var packs: [String: (lut: CubeLut, name: String?)] = [:]
    /// A pack look the vault did not hold, why, and when it was last asked —
    /// a miss is asked again after `missRetry` (the pack may be imported a
    /// moment later), never on every slider step.
    private var misses: [String: (reason: String, name: String?, at: Date)] = [:]
    private var loadedPacks = false

    /// How long a pack look the vault did not have is taken as missing before it is asked again.
    static let missRetry: TimeInterval = 5

    init(folder: URL? = DevelopLooks.bundledFolder(), store: any PackStore = DiskPackStore.appDefault()) {
        self.folder = folder
        vault = PackVault(store: store)
    }

    /// Where the bundle keeps the built-ins — the folder reference `project.yml` adds.
    static func bundledFolder() -> URL? {
        Bundle(for: DevelopLooks.self).url(forResource: "luts", withExtension: nil)
    }

    // MARK: - the built-ins

    /// Every built-in the bundle carries, as the picker lists them.
    var builtinLooks: [BuiltinLut] {
        _ = manifest()
        lock.lock()
        let list = ordered
        lock.unlock()
        let base = folder.map { $0.path + "/" } ?? "luts/"
        return builtinLuts(list, base: base)
    }

    /// The manifest, scanned once — the web's Vite plugin, run on the bundle.
    private func manifest() -> [String: LutManifestEntry] {
        lock.lock()
        defer { lock.unlock() }
        if let entries { return entries }
        // Posix paths relative to the folder, recursively — what the plugin
        // hands its naming rule; the rule itself skips what is not a `.cube`.
        let paths: [String] = folder.flatMap { FileManager.default.subpaths(atPath: $0.path) } ?? []
        var byId: [String: LutManifestEntry] = [:]
        // The kernel's own naming rule and order, so `builtin:<id>` means the
        // same file here as on the site; a duplicate id keeps the first.
        let scanned = lutManifest(relativePaths: paths)
        for entry in scanned where byId[entry.id] == nil {
            byId[entry.id] = entry
        }
        entries = byId
        ordered = scanned
        return byId
    }

    /// A built-in's cube and name by its id (the source without `builtin:`),
    /// parsed once — or nil when this build has no such look, or its file
    /// will not read. Synchronous: the files are in the bundle.
    func builtin(_ id: String) -> (lut: CubeLut, name: String)? {
        let byId = manifest()
        lock.lock()
        if let hit = builtins[id] {
            lock.unlock()
            return hit
        }
        let refused = unreadable.contains(id)
        lock.unlock()
        guard !refused, let entry = byId[id], let folder else { return nil }
        let url = folder.appendingPathComponent(entry.file)
        guard let text = try? String(contentsOf: url, encoding: .utf8), let cube = parseCube(text) else {
            lock.lock()
            unreadable.insert(id)
            lock.unlock()
            return nil
        }
        let made = (lut: cube, name: entry.name)
        lock.lock()
        builtins[id] = made
        lock.unlock()
        return made
    }

    // MARK: - pack looks

    /// The key a pack look is kept under: its hash where the reference has one.
    static func packKey(_ ref: PackRef) -> String {
        ref.hash.isEmpty ? "\(ref.pack)\u{1}\(ref.look)" : ref.hash
    }

    /// Resolve every pack look `grade` names that is not kept yet — the vault
    /// read from this device's disk. Nothing to do costs one scan of the layers.
    func prepare(_ grade: RollGrade?) async {
        guard let grade else { return }
        let refs = grade.layers.filter { isPackLayer($0) }.compactMap { readPackRef($0.customText) }
        guard !refs.isEmpty else { return }
        if !loadedFlag() {
            _ = await vault.loadPacks()
            setLoaded()
        }
        for ref in refs where needsAsking(ref) {
            let name = await vault.packLookName(ref)
            if let cube = await vault.resolvePackLattice(ref) {
                keep(ref, cube, name)
            } else {
                let reason = await vault.missingLookReason(ref)
                miss(ref, reason, name)
            }
        }
    }

    /// Forget every miss, so the next render asks the vault again — a pack
    /// imported or adopted since.
    func packsChanged() {
        lock.lock()
        misses.removeAll()
        lock.unlock()
    }

    /// What the vault answered for a reference, as `restoreLayers` takes it —
    /// never a wait: a look not asked yet is missing until `prepare` has run.
    func packAnswer(_ ref: PackRef) -> PackLookAnswer {
        let key = DevelopLooks.packKey(ref)
        lock.lock()
        defer { lock.unlock() }
        if let kept = packs[key] { return .lattice(kept.lut, lookName: kept.name) }
        if let missed = misses[key] { return .missing(reason: missed.reason, lookName: missed.name) }
        return .missing(reason: "This look is still being read from the vault.", lookName: nil)
    }

    private func loadedFlag() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return loadedPacks
    }

    private func setLoaded() {
        lock.lock()
        loadedPacks = true
        lock.unlock()
    }

    private func needsAsking(_ ref: PackRef) -> Bool {
        let key = DevelopLooks.packKey(ref)
        lock.lock()
        defer { lock.unlock() }
        if packs[key] != nil { return false }
        if let missed = misses[key], Date().timeIntervalSince(missed.at) < DevelopLooks.missRetry { return false }
        return true
    }

    private func keep(_ ref: PackRef, _ cube: CubeLut, _ name: String?) {
        let key = DevelopLooks.packKey(ref)
        lock.lock()
        packs[key] = (cube, name)
        misses[key] = nil
        // A purchased look is 65³: a handful kept is tens of megabytes.
        if packs.count > 12, let drop = packs.keys.first(where: { $0 != key }) { packs[drop] = nil }
        lock.unlock()
    }

    private func miss(_ ref: PackRef, _ reason: String, _ name: String?) {
        let key = DevelopLooks.packKey(ref)
        lock.lock()
        misses[key] = (reason, name, Date())
        lock.unlock()
    }

    // MARK: - a picture's look

    /// What of a stored look does not grade here, in words — and without
    /// parsing a single `.cube`, since the stage asks on every redraw: a
    /// built-in this build lacks, a film layer whose settings will not read,
    /// a pack look the vault answered it does not hold. A pack look not asked
    /// yet says nothing until the vault has answered.
    func missingWords(_ grade: RollGrade?) -> [String] {
        guard let grade else { return [] }
        let byId = manifest()
        var out: [String] = []
        for s in grade.layers where s.enabled {
            let name = s.name.isEmpty ? s.source : s.name
            if isFilmLayer(s) {
                if readFilmSettings(s.customText) == nil { out.append("\(name) (its settings will not read)") }
            } else if isPackLayer(s) {
                guard let ref = readPackRef(s.customText) else {
                    out.append("\(name) (its reference will not read)")
                    continue
                }
                let key = DevelopLooks.packKey(ref)
                lock.lock()
                let kept = packs[key] != nil
                let missed = misses[key]
                lock.unlock()
                if !kept, let missed { out.append("\(missed.name ?? name) (not in this vault)") }
            } else if s.source != "custom" {
                let id = s.source.hasPrefix("builtin:") ? String(s.source.dropFirst("builtin:".count)) : s.source
                lock.lock()
                let refused = unreadable.contains(id)
                lock.unlock()
                if byId[id] == nil || refused { out.append("\(name) (not in this build)") }
            }
        }
        return out
    }

    /// A picture's stored look as the layers a bake takes — the kernel's
    /// `restoreLayers` over the two answers above. A stored layer that does
    /// not come back at all (a built-in this build lacks, a film layer whose
    /// settings will not read) is SAID in `missing`, never dropped in silence.
    func resolve(_ grade: RollGrade?) -> ResolvedLook {
        guard let grade else { return .none }
        let restored = restoreLayers(grade.layers, builtin: { self.builtin($0) }, pack: { self.packAnswer($0) })
        var missing: [String] = []
        let back = Set(restored.layers.map(\.id))
        for saved in grade.layers where !back.contains(saved.id) && saved.enabled {
            let name = saved.name.isEmpty ? saved.source : saved.name
            missing.append("\(name) (not in this build)")
        }
        for layer in restored.layers where layer.missing != nil && layer.enabled {
            missing.append("\(layer.name) (not in this vault)")
        }
        return ResolvedLook(layers: restored.layers, output: grade.output, missing: missing)
    }
}

/// The vault's storage on THIS device — the web's `pack-store.ts` over
/// IndexedDB, as files under `Application Support/Atelier/packs/`: one JSON
/// index per pack (`index/<pack>.json`) and one ENCODED lattice per look
/// (`lattices/<hash>.lut`, the `PackCodec` bytes, never `.cube` text), keyed
/// by the SHA-256 of the source `.cube`, so two packs shipping one file store
/// it once. Every call DEGRADES rather than throws, as the protocol asks.
final class DiskPackStore: PackStore, @unchecked Sendable {
    let root: URL
    private let lock = NSLock()

    init(root: URL) {
        self.root = root
    }

    /// Beside the rolls, the presets and the thumbnails.
    static func appDefault() -> DiskPackStore {
        DiskPackStore(root: RollStore.defaultRoot().appendingPathComponent("packs", isDirectory: true))
    }

    private var indexDirectory: URL { root.appendingPathComponent("index", isDirectory: true) }
    private var latticeDirectory: URL { root.appendingPathComponent("lattices", isDirectory: true) }

    /// A pack id as a file name: anything but a letter, a digit, `-`, `_` or `.` escaped.
    private func indexURL(_ packId: String) -> URL {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.")
        let safe = packId.addingPercentEncoding(withAllowedCharacters: allowed) ?? packId
        return indexDirectory.appendingPathComponent("\(safe).json")
    }

    /// A hash is hex; anything else is not a key this store writes.
    private func latticeURL(_ hash: String) -> URL? {
        guard !hash.isEmpty, hash.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) }) else { return nil }
        return latticeDirectory.appendingPathComponent("\(hash).lut")
    }

    private func ensure(_ dir: URL) -> Bool {
        (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil
    }

    func listStoredPacks() async -> [LutPackIndex] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: indexDirectory, includingPropertiesForKeys: nil)) ?? []
        var rows: [JSONValue] = []
        for url in urls where url.pathExtension == "json" {
            guard let text = try? String(contentsOf: url, encoding: .utf8), let row = JSONValue.parse(text) else { continue }
            rows.append(row)
        }
        return readStoredPacks(rows)
    }

    func putStoredPack(_ index: LutPackIndex) async -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard ensure(indexDirectory) else { return false }
        let text = index.json.serialized()
        return (try? text.write(to: indexURL(index.id), atomically: true, encoding: .utf8)) != nil
    }

    func deleteStoredPack(_ packId: String) async {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: indexURL(packId))
    }

    func deleteStoredLattices(_ hashes: [String]) async {
        lock.lock()
        defer { lock.unlock() }
        for hash in hashes {
            if let url = latticeURL(hash) { try? FileManager.default.removeItem(at: url) }
        }
    }

    func getStoredLattice(_ hash: String) async -> [UInt8]? {
        guard let url = latticeURL(hash), let data = try? Data(contentsOf: url) else { return nil }
        return [UInt8](data)
    }

    func putStoredLattice(_ hash: String, packId: String, bytes: [UInt8]) async -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let url = latticeURL(hash), ensure(latticeDirectory) else { return false }
        return (try? Data(bytes).write(to: url, options: .atomic)) != nil
    }

    func storedLatticeHashes() async -> Set<String> {
        let urls = (try? FileManager.default.contentsOfDirectory(at: latticeDirectory, includingPropertiesForKeys: nil)) ?? []
        return Set(urls.filter { $0.pathExtension == "lut" }.map { $0.deletingPathExtension().lastPathComponent })
    }

    func storedLatticeSizes() async -> LatticeSizes {
        let keys: [URLResourceKey] = [.fileSizeKey]
        let urls = (try? FileManager.default.contentsOfDirectory(at: latticeDirectory, includingPropertiesForKeys: keys)) ?? []
        var out: LatticeSizes = [:]
        for url in urls where url.pathExtension == "lut" {
            guard let size = try? url.resourceValues(forKeys: Set(keys)).fileSize else { continue }
            out[url.deletingPathExtension().lastPathComponent] = size
        }
        return out
    }
}
