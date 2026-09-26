// The LOOKS this app can put on a picture — ONE store, held once and handed to
// every screen through the environment (`AtelierApp`): the built-ins in the
// bundle, the VAULT of purchased and uploaded looks (`PackVault`, the
// kernel's actor, over `FilePackStore` on disk), the film stocks, the ★
// shortlist and the interpolation preference. The web's `pack-vault.ts`
// (module state + subscribers), `use-lut-packs.ts`, `use-lut-favourites.ts`
// and `use-lut-interpolation.ts`, as one observable object — a look picker in
// Develop, Trips or the Studio reads the same packs and the same stars by
// construction.
//
// Rules kept (`docs/lut-packs.md`, `media-pipeline.md`):
// - a document holds a REFERENCE to a pack look, never its lattice; an upload
//   goes into the vault as a look of the personal pack (`uploadLookIntoVault`)
//   and a refused store REFUSES the upload — never an inlined fallback;
// - a look this device cannot resolve STAYS in its stack and SAYS why, in the
//   vault's own sentence ("this device", not "this browser");
// - the ★ list and the interpolation are PREFERENCES of this device, under the
//   web's own keys, never on a document;
// - resolving is lazy: a picker resolves only what it shows, and a lattice is
//   decoded once per hash by the vault.

import CoreImage
import Foundation
import Observation
import SwiftUI
import AtelierKit

/// What resolving one look answered: its lattice, or why this device cannot draw it.
enum LookResolution {
    case cube(CubeLut)
    case missing(String)

    var cube: CubeLut? {
        if case .cube(let lut) = self { return lut }
        return nil
    }

    var reason: String? {
        if case .missing(let why) = self { return why }
        return nil
    }
}

/// A stored look, resolved and ready to draw.
struct ResolvedLook: Sendable {
    /// The layers the bake takes, parsed, in order — a pack look this device
    /// lacks is IN it with its `missing` reason and an identity cube.
    let restored: RestoredLayers
    let output: OutputTransform
    /// Grain and halation, drawn by the graph's film node after the cube.
    let film: FilmTexture?
    /// Why each layer that will not grade here does not, by layer id — a pack
    /// look this device lacks, a built-in this build does not carry, a film
    /// layer whose settings cannot be read.
    let missing: [String: String]

    /// The look baked into ONE cube, the develop first — the web's
    /// `composeLutStack(layers, output, interpolation, develop)`; nil when
    /// nothing would change a pixel.
    func cube(develop: DevelopSettings? = nil, interpolation: Interpolation) -> CubeLut? {
        composeLutStack(restored.layers, output: output, interpolation: interpolation, develop: develop)
    }
}

/// The picture a look is judged on in the gallery's SCENE: the source as the
/// host decoded it, before its correction — the scene shows the look alone,
/// and says so.
struct LookPicture {
    let image: CIImage
    /// What it is called, for the line under the scene.
    let label: String?
    /// True only for LOG footage; a photograph is display-referred.
    var isLog = false
    /// Changes when the picture does — what the scene re-renders on.
    let key: String
}

/// The instances that can keep a pack, as the vault reads them from its own
/// actor — a snapshot the main actor refreshes, read under a lock.
final class PackHostBox: @unchecked Sendable {
    private let lock = NSLock()
    private var current: [PackHost] = []

    func set(_ hosts: [PackHost]) {
        lock.lock()
        current = hosts
        lock.unlock()
    }

    func get() -> [PackHost] {
        lock.lock()
        defer { lock.unlock() }
        return current
    }
}

@MainActor
@Observable
final class LookLibrary {
    static let shared = LookLibrary()

    @ObservationIgnored let vault: PackVault
    @ObservationIgnored private let hostBox: PackHostBox
    @ObservationIgnored private var listener: Int?
    @ObservationIgnored private let defaults: UserDefaults

    /// The packs this device holds, sorted as every list shows them.
    private(set) var packs: [LutPackIndex] = []
    /// True once the vault answered its first read.
    private(set) var loaded = false
    /// ★ — gallery pick ids, in the order they were starred.
    private(set) var favourites: [String]
    /// How a lattice is read between its points — tetrahedral unless asked.
    private(set) var interpolation: Interpolation
    /// The instances that can keep a pack, as the connections stand.
    private(set) var hosts: [PackHost] = []

    init(store: any PackStore = FilePackStore(), defaults: UserDefaults = .standard) {
        let box = PackHostBox()
        hostBox = box
        vault = PackVault(store: store, hosts: { box.get() })
        self.defaults = defaults
        let stored = defaults.string(forKey: lutFavouritesKey).flatMap { JSONValue.parse($0) }
        favourites = readLutFavourites(stored)
        interpolation = defaults.string(forKey: LookLibrary.interpolationKey) == Interpolation.trilinear.rawValue
            ? .trilinear : .tetrahedral
        Task { await self.start() }
    }

    private func start() async {
        refreshHosts()
        let id = await vault.subscribePacks { [weak self] in
            let owner = self
            Task { @MainActor in await owner?.reloadPacks() }
        }
        listener = id
        await reloadPacks()
    }

    /// Take the vault's list as it stands.
    func reloadPacks() async {
        _ = await vault.loadPacks()
        packs = await vault.packsSnapshot()
        loaded = true
    }

    /// Read the connections again — a pack is kept on an instance only while
    /// it is connected with both buckets (`canKeepPack`).
    func refreshHosts() {
        let next = ConnectionStore.shared.packHostsNow
        hosts = next
        hostBox.set(next)
    }

    // MARK: - preferences

    static let interpolationKey = "atelier.lut.interpolation"

    func setInterpolation(_ mode: Interpolation) {
        interpolation = mode
        defaults.set(mode.rawValue, forKey: LookLibrary.interpolationKey)
    }

    func isFavourite(_ id: String) -> Bool { favourites.contains(id) }

    func toggleFavourite(_ id: String) {
        favourites = toggledLutFavourite(favourites, id)
        defaults.set(lutFavouritesJSON(favourites).serialized(), forKey: lutFavouritesKey)
    }

    // MARK: - the picker's rows

    /// Every node of the rail — ★ Favourites, the film stocks where the host
    /// offers them, the built-ins and their folders, one branch per pack.
    /// `live` drops every shipped tile: the looks are baked on a picture.
    func nodes(includeFilm: Bool, live: Bool) -> [GalleryNode] {
        galleryNodes(packs, includeFilm: includeFilm, builtins: BuiltinLutFiles.luts,
                     thumbs: live ? nil : BuiltinLutFiles.thumbs, favourites: favourites)
    }

    /// The starred looks, named as the rail names them — the shortlist the
    /// grade panel's "Add a look" menu opens with.
    var favouriteItems: [GalleryItem] {
        nodes(includeFilm: true, live: false).first { $0.id == favouritesNode }?.items ?? []
    }

    // MARK: - resolving

    /// One look's lattice — a built-in from the bundle, a film stock
    /// generated from its numbers, a pack look from the vault (fetched from
    /// the instance it is kept on, when this device does not hold it).
    func resolve(_ source: GalleryLookSource) async -> LookResolution {
        switch source {
        case .builtin(let id):
            guard let entry = BuiltinLutFiles.lut(id) else { return .missing("That look is no longer available.") }
            if let lut = await BuiltinLutFiles.loadCube(id) { return .cube(lut) }
            return .missing("Could not parse \(entry.name).")
        case .film(let stock):
            let lut = await Task.detached(priority: .userInitiated) { filmCubeFor(filmSettingsFor(stock)) }.value
            return .cube(lut)
        case .pack(let pack, let look, let hash):
            let ref = PackRef(pack: pack, look: look, hash: hash)
            if let lut = await vault.resolvePackLattice(ref) { return .cube(lut) }
            let why = await vault.missingLookReason(ref)
            return .missing(deviceWords(why))
        }
    }

    /// A stored look resolved for drawing — ONE resolver for the grade panel,
    /// the stage and the export (`restoreLayers`, the kernel's arithmetic,
    /// with a built-in read from the bundle and a pack look from the vault).
    func resolve(_ grade: RollGrade) async -> ResolvedLook {
        var answers: [String: PackLookAnswer] = [:]
        for layer in grade.layers where isPackLayer(layer) {
            guard let ref = readPackRef(layer.customText) else { continue }
            let key = writePackRef(ref)
            if answers[key] != nil { continue }
            let name = await vault.packLookName(ref)
            if let lut = await vault.resolvePackLattice(ref) {
                answers[key] = .lattice(lut, lookName: name)
            } else {
                let why = await vault.missingLookReason(ref)
                answers[key] = .missing(reason: deviceWords(why), lookName: name)
            }
        }
        let known = answers
        let layers = grade.layers
        let restored = await Task.detached(priority: .userInitiated) { () -> RestoredLayers in
            restoreLayers(
                layers,
                builtin: { id in
                    guard let lut = BuiltinLutFiles.cube(id) else { return nil }
                    return (lut, BuiltinLutFiles.lut(id)?.name ?? id)
                },
                pack: { ref in
                    known[writePackRef(ref)] ?? .missing(reason: "This look comes from a pack this device does not hold.",
                                                        lookName: nil)
                }
            )
        }.value
        var missing: [String: String] = [:]
        let present = Set(restored.layers.map(\.id))
        for layer in restored.layers {
            if let why = layer.missing { missing[layer.id] = why }
        }
        for layer in grade.layers where !present.contains(layer.id) {
            missing[layer.id] = LookLibrary.absentReason(layer)
        }
        return ResolvedLook(restored: restored, output: grade.output, film: filmTextureOrNull(grade.film),
                            missing: missing)
    }

    /// Why a stored layer did not come back from `restoreLayers` — said, never
    /// graded as nothing.
    private static func absentReason(_ layer: SavedLutLayer) -> String {
        if isFilmLayer(layer) { return "This film layer lost its settings — remove it and add the stock again." }
        if isPackLayer(layer) { return "This layer’s reference to its pack cannot be read." }
        if layer.source == "custom" { return "This layer’s inlined .cube cannot be parsed." }
        let id = BuiltinLutFiles.id(ofSource: layer.source)
        guard let entry = BuiltinLutFiles.lut(id) else { return "That look is no longer available." }
        return "Could not parse \(entry.name)."
    }

    // MARK: - picking

    /// What a pick id becomes on a look's stack: a built-in's identity, a film
    /// stock's settings, or a pack look's reference named the way the vault
    /// names it (pack · category · look) — nil for an id that names nothing.
    func layer(forPick id: String, intensity: Double = 1) async -> (layer: SavedLutLayer, stock: FilmStockId?)? {
        let layerId = UUID().uuidString.lowercased()
        if let pick = readPackPick(id) {
            let hash = packs.first { $0.id == pick.pack }?.looks.first { $0.id == pick.look }?.hash ?? ""
            let ref = PackRef(pack: pick.pack, look: pick.look, hash: hash)
            let name = await vault.packLookName(ref) ?? ""
            return (packLookLayer(id: layerId, ref: ref, name: name, intensity: intensity), nil)
        }
        if id.hasPrefix(filmPick) {
            guard let stock = FilmStockId(rawValue: String(id.dropFirst(filmPick.count))) else { return nil }
            return (filmLookLayer(id: layerId, stock: stock, intensity: intensity), stock)
        }
        guard let entry = BuiltinLutFiles.lut(id) else { return nil }
        return (builtinLookLayer(id: layerId, builtinId: entry.id, name: entry.name, intensity: intensity), nil)
    }

    // MARK: - uploading

    /// "Upload .cube": the file goes into the VAULT as a look of the personal
    /// pack ("My looks") and the answer is the reference a layer stores —
    /// never the lattice. The same bytes twice are one look.
    func upload(_ url: URL) async throws -> UploadedLook {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        let bytes = try await Task.detached(priority: .userInitiated) { [UInt8](try Data(contentsOf: url)) }.value
        let mode = interpolation
        let uploaded: UploadedLook
        do {
            uploaded = try await uploadLookIntoVault(bytes, fileName: name, vault: vault, bakeThumb: { lut, family in
                await Task.detached { LookTiles.shared.bakeThumb(lut, family, mode) }.value
            })
        } catch let error as PackVaultError {
            throw PackVaultError(deviceWords(error.message))
        }
        await reloadPacks()
        return uploaded
    }

    // MARK: - the vault's gestures, said in this device's words

    /// What each stored lattice weighs, measured off the files.
    func latticeSizes() async -> LatticeSizes {
        await vault.storedLatticeSizes()
    }

    func setHidden(_ packId: String, _ hidden: [String]) async {
        await vault.setPackHidden(packId, hidden)
        await reloadPacks()
    }

    func forgetPack(_ packId: String) async throws -> ForgetResult {
        refreshHosts()
        do {
            let result = try await vault.removePack(packId)
            await reloadPacks()
            return result
        } catch let error as PackVaultError {
            throw PackVaultError(deviceWords(error.message))
        }
    }

    func forgetLook(_ packId: String, _ lookId: String) async throws -> ForgetResult {
        refreshHosts()
        do {
            let result = try await vault.forgetLook(packId, lookId)
            await reloadPacks()
            return result
        } catch let error as PackVaultError {
            throw PackVaultError(deviceWords(error.message))
        }
    }

    func keep(_ packId: String, on sourceId: String,
              onProgress: @escaping @Sendable (PushProgress) -> Void) async throws -> PushPackResult {
        refreshHosts()
        do {
            let result = try await vault.keepPackOn(packId, sourceId, onProgress: onProgress)
            await reloadPacks()
            return result
        } catch let error as PackVaultError {
            throw PackVaultError(deviceWords(error.message))
        }
    }

    func remotePacksNotHere(_ host: PackHost) async throws -> [LutPackIndex] {
        try await vault.remotePacksNotHere(host)
    }

    func adopt(_ index: LutPackIndex, from sourceId: String) async {
        await vault.adoptRemotePack(index, sourceId)
        await reloadPacks()
    }

    /// Read a picked folder (or a zip's entries) into the vault — one file at
    /// a time, the index written last, every file that could not be taken
    /// REPORTED with its reason.
    func importPack<F>(_ files: [(path: String, file: F)], _ options: PackImportOptions,
                       read: @escaping (F) async throws -> [UInt8],
                       onProgress: @escaping (ImportProgress) -> Void) async -> PackImportResult {
        let mode = interpolation
        let result = await importPackFromFolder(files, options, vault: vault, read: read, bakeThumb: { lut, family in
            await Task.detached { LookTiles.shared.bakeThumb(lut, family, mode) }.value
        }, onProgress: onProgress)
        await reloadPacks()
        return PackImportResult(
            index: result.index,
            failed: result.failed.map { ImportFailure(file: $0.file, reason: deviceWords($0.reason)) },
            reused: result.reused,
            stored: result.stored
        )
    }
}
