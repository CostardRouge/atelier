// The VAULT — the packs this device holds, read by every picker, and the one
// place a pack look's lattice is resolved. Port of `src/shared/lut/pack-vault.ts`
// over the pure half of `pack-store.ts`; the storage itself (the web's
// IndexedDB database `atelier-lut-packs`) is the app's, handed in as a
// `PackStore`, and the instances as `PackHost`s (`PackRemote.swift`).
//
// The web keeps this as MODULE state with a subscriber set, because a pack is
// a library the whole suite reads rather than a document one screen opens.
// Here it is an ACTOR the app holds one of: the same verbs, the same
// interleaving at each `await` that the web's promises have.
//
// Rules kept (`docs/lut-packs.md`, `media-pipeline.md`):
// - Resolution is cached by HASH and caches the pending work, not the result,
//   so five pictures wearing one purchased look decode it once. A MISS is
//   never remembered: the pack may be imported a moment later.
// - A lattice this device lacks is asked of the instance its pack is kept on
//   — under the look's `blob`, never its `hash` — and stored on the way
//   through: fetched on first use, then graded with offline (§4.2 — the
//   instance is the truth, this vault its cache).
// - A pack kept on an instance is forgotten THERE or not at all: an
//   unreachable instance refuses the gesture and changes nothing, and the
//   remote half runs BEFORE the local write, so a failure leaves both whole.
//   Only the lattices NO surviving look names are freed (`freedHashes`).
// - Every gesture that writes to an instance is the author's (`keepPackOn`,
//   `adoptRemotePack`); nothing here writes there on its own.

import Foundation

/// Why a vault gesture was refused — the web's thrown message, verbatim.
public struct PackVaultError: Error, Equatable, Sendable, CustomStringConvertible {
    public let message: String
    public var description: String { message }

    public init(_ message: String) { self.message = message }
}

/// The vault's storage on this device — what the web's `pack-store.ts` does
/// over IndexedDB. Two stores: one INDEX per pack (by pack id) and one ENCODED
/// lattice per look (`PackCodec.swift` bytes, never `.cube` text), keyed by the
/// SHA-256 of the SOURCE `.cube`, so two packs shipping one file store it once.
///
/// Every call DEGRADES rather than throws, as the web's do: a device may deny
/// or evict storage, and a missing lattice has a defined meaning here (the
/// look says it is not in this vault). A write answers false when it failed;
/// an empty hash is never stored nor found.
public protocol PackStore: Sendable {
    /// Every pack held, read through `readStoredPacks`; `[]` when unusable.
    func listStoredPacks() async -> [LutPackIndex]
    func putStoredPack(_ index: LutPackIndex) async -> Bool
    /// Forget an INDEX. Its lattices are `deleteStoredLattices`' — which ones
    /// are free is a question about every index at once, asked by the vault.
    func deleteStoredPack(_ packId: String) async
    func deleteStoredLattices(_ hashes: [String]) async
    func getStoredLattice(_ hash: String) async -> [UInt8]?
    func putStoredLattice(_ hash: String, packId: String, bytes: [UInt8]) async -> Bool
    /// Which hashes this device holds — what a re-import skips.
    func storedLatticeHashes() async -> Set<String>
    /// What each stored lattice weighs, by hash — the MEASURED half of
    /// `PackWeight.swift`; empty when it cannot say, never zeros.
    func storedLatticeSizes() async -> LatticeSizes
}

/// Packs in the order every list shows them: by name (the author's, for a
/// pack with none), as the web's `localeCompare` sorts, stable on a tie.
public func sortPacks(_ packs: [LutPackIndex]) -> [LutPackIndex] {
    packs.enumerated().sorted { a, b in
        let ka = a.element.name.isEmpty ? a.element.author : a.element.name
        let kb = b.element.name.isEmpty ? b.element.author : b.element.name
        let order = packLocaleCompare(ka, kb)
        return order != 0 ? order < 0 : a.offset < b.offset
    }.map(\.element)
}

/// The stored rows read back — `pack-store.ts`'s `listStoredPacks` less the
/// IndexedDB: each migrated, a row that is not an index left behind, sorted.
public func readStoredPacks(_ rows: [JSONValue]) -> [LutPackIndex] {
    sortPacks(rows.compactMap(migratePackIndex))
}

private func vaultText(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

/// The vault, live. One per app; every picker reads it.
public actor PackVault {
    private let store: any PackStore
    /// The instances that can keep a pack, as they stand now — the web's
    /// `packHosts()`, read on every ask because a connection comes and goes.
    private let hosts: @Sendable () -> [PackHost]

    private var packs: [LutPackIndex] = []
    private var loaded = false
    private var loading: Task<Void, Never>?
    private var listeners: [(id: Int, fn: @Sendable () -> Void)] = []
    private var nextListener = 0
    private var lattices: [String: Task<CubeLut?, Never>] = [:]

    public init(store: any PackStore, hosts: @escaping @Sendable () -> [PackHost] = { [] }) {
        self.store = store
        self.hosts = hosts
    }

    private func emit(_ next: [LutPackIndex]) {
        packs = next
        for listener in listeners { listener.fn() }
    }

    /// The packs as they stand — `[]` until the first load answers.
    public func packsSnapshot() -> [LutPackIndex] { packs }

    /// Be told when the packs change; starts the first load. The id unsubscribes.
    public func subscribePacks(_ fn: @escaping @Sendable () -> Void) -> Int {
        nextListener += 1
        listeners.append((nextListener, fn))
        Task { _ = await self.loadPacks() }
        return nextListener
    }

    public func unsubscribePacks(_ id: Int) {
        listeners.removeAll { $0.id == id }
    }

    /// Read the vault once per session; later calls answer from memory.
    public func loadPacks() async -> [LutPackIndex] {
        if loaded { return packs }
        let pending: Task<Void, Never>
        if let loading {
            pending = loading
        } else {
            pending = Task {
                let stored = await store.listStoredPacks()
                self.loaded = true
                self.loading = nil
                self.emit(sortPacks(stored))
            }
            loading = pending
        }
        await pending.value
        return packs
    }

    /// Tests, and the screen that empties the vault.
    public func resetPackState() {
        packs = []
        loaded = false
        loading = nil
        lattices.removeAll()
    }

    /// Add or replace a pack's index.
    @discardableResult
    public func savePack(_ index: LutPackIndex) async -> Bool {
        let ok = await store.putStoredPack(index)
        emit(sortPacks(packs.filter { $0.id != index.id } + [index]))
        return ok
    }

    /// Store one look's encoded lattice — the import's write, per look.
    public func saveLookLattice(_ packId: String, _ hash: String, _ bytes: [UInt8]) async -> Bool {
        await store.putStoredLattice(hash, packId: packId, bytes: bytes)
    }

    /// Which lattices this device holds, by source hash.
    public func storedLatticeHashes() async -> Set<String> {
        await store.storedLatticeHashes()
    }

    /// What each stored lattice weighs — for `packWeight` / `vaultWeight`.
    public func storedLatticeSizes() async -> LatticeSizes {
        await store.storedLatticeSizes()
    }

    /// Hide or show a node or a look in the pickers; the looks stay stored.
    public func setPackHidden(_ packId: String, _ hidden: [String]) async {
        guard var pack = packs.first(where: { $0.id == packId }) else { return }
        pack.hidden = hidden
        await savePack(pack)
    }

    // MARK: forgetting

    /// Forget a whole pack: its index and its lattices, here and on the
    /// instance it is kept on. A grade that wore one of its looks then says so.
    public func removePack(_ packId: String) async throws -> ForgetResult {
        try await forget(packId, nil)
    }

    /// Forget ONE look — reclaiming its bytes, where hiding only puts it away.
    public func forgetLook(_ packId: String, _ lookId: String) async throws -> ForgetResult {
        try await forget(packId, [lookId])
    }

    /// `lookIds == nil` means the whole pack.
    private func forget(_ packId: String, _ lookIds: [String]?) async throws -> ForgetResult {
        _ = await loadPacks()
        guard let pack = packs.first(where: { $0.id == packId }) else {
            throw PackVaultError("That pack is not in this browser.")
        }
        let whole = lookIds == nil
        let doomed = lookIds ?? pack.looks.map(\.id)
        let keptOn = pack.sourceId
        let host = vaultText(keptOn).flatMap { hostFor($0) }
        if let keptOn = vaultText(keptOn), host == nil {
            throw PackVaultError(
                "This pack is kept on \(keptOn). Connect it, so \(whole ? "the pack" : "the look") "
                    + "is forgotten there too and its bytes come back."
            )
        }

        let sizes = await store.storedLatticeSizes()
        let here = freedHashes(packs, packId, doomed)
        let there = host.map { freedBlobs(packs, packId, doomed, $0.sourceId) } ?? Freed()
        let next = whole ? nil : withoutLooks(pack, doomed)
        // Weighed BEFORE anything is written: the write takes the very looks
        // both figures are read from out of the indexes.
        let result = ForgetResult(
            here: hashBytes(here.free, sizes),
            instance: host != nil ? blobBytes(there.free, packs) : 0,
            keptOn: keptOn,
            shared: here.shared.count
        )

        if let host {
            if let next {
                try await deleteRemoteLooks(host, next, there.free)
            } else {
                try await deleteRemotePack(host, pack, Set(there.shared))
            }
        }

        if let next {
            await savePack(next)
        } else {
            await store.deleteStoredPack(packId)
            emit(packs.filter { $0.id != packId })
        }
        await store.deleteStoredLattices(here.free)
        // The decode cache is keyed on the hash: a look whose bytes are gone
        // must lose its entry or the session keeps grading with it.
        for hash in here.free { lattices[hash] = nil }
        return result
    }

    // MARK: resolution

    private func hostFor(_ sourceId: String) -> PackHost? {
        packHost(sourceId, in: hosts())
    }

    /// The pack a reference names, if this device holds it.
    public func packOf(_ ref: PackRef) -> LutPackIndex? {
        packs.first { $0.id == ref.pack }
    }

    /// The look a reference names, if this device holds its pack.
    public func lookOf(_ ref: PackRef) -> PackLook? {
        packOf(ref).flatMap { lookIn($0, ref.look) }
    }

    /// How a pack look is named in a stack: pack · category · camera · look.
    public func packLookName(_ ref: PackRef) -> String? {
        guard let pack = packOf(ref), let look = lookIn(pack, ref.look) else { return nil }
        return lookLabel(pack, look)
    }

    /// The lattice a reference names, decoded — or nil when this device does
    /// not hold it. **Nil is a state, not a failure**: the layer stays in the
    /// stack and says so (`restoreLayers`' `.missing`). The HASH is what is
    /// asked for, not the look's id: it is what the bytes are keyed on, and
    /// what catches a pack whose author published a new version of a file.
    public func resolvePackLattice(_ ref: PackRef) async -> CubeLut? {
        let hash = vaultText(ref.hash) ?? vaultText(lookOf(ref)?.hash) ?? ""
        if hash.isEmpty { return nil }
        if let known = lattices[hash] { return await known.value }
        let pending = Task { () -> CubeLut? in
            var bytes = await self.store.getStoredLattice(hash)
            if bytes == nil { bytes = await self.fetchAndKeep(ref, hash) }
            guard let bytes else { return nil }
            return decodeLattice(bytes, title: self.packLookName(ref))
        }
        lattices[hash] = pending
        let cube = await pending.value
        // A miss is not remembered: the pack may be imported a moment later.
        if cube == nil, lattices[hash] == pending { lattices[hash] = nil }
        return cube
    }

    /// The vault does not hold it: ask the instance the pack is kept on, under
    /// the look's `blob`, and keep what comes back. Local-only, not connected,
    /// never pushed, offline — all answer nil, "not in this vault".
    private func fetchAndKeep(_ ref: PackRef, _ hash: String) async -> [UInt8]? {
        guard let pack = packOf(ref), let sourceId = vaultText(pack.sourceId), let host = hostFor(sourceId),
              let blob = vaultText(pack.looks.first(where: { $0.hash == hash })?.blob) else { return nil }
        do {
            guard let bytes = try await fetchRemoteLattice(host, blob) else { return nil }
            _ = await saveLookLattice(pack.id, hash, bytes)
            return bytes
        } catch {
            return nil
        }
    }

    // MARK: keeping

    /// The instances that can keep a pack — connected, with both buckets.
    public func packKeepers() -> [PackHost] { hosts() }

    /// Keep a pack on an instance: push its lattices, then its index, then
    /// record WHERE it is kept — the index the push WROTE, carrying each look's
    /// blob, which is what this device reads back to fetch an evicted look.
    public func keepPackOn(_ packId: String, _ sourceId: String,
                           onProgress: ((PushProgress) -> Void)? = nil) async throws -> PushPackResult {
        let pack = packs.first { $0.id == packId }
        let host = hostFor(sourceId)
        guard let pack else { throw PackVaultError("That pack is not in this browser.") }
        guard let host else {
            throw PackVaultError("That instance cannot keep a pack — reconnect it and try again.")
        }
        let store = self.store
        let result = try await pushPack(host, pack, latticeFor: { await store.getStoredLattice($0) },
                                        onProgress: onProgress)
        var kept = result.index
        kept.sourceId = sourceId
        await savePack(kept)
        return result
    }

    /// The packs an instance holds that this device does not.
    public func remotePacksNotHere(_ host: PackHost) async throws -> [LutPackIndex] {
        let here = Set(packs.map(\.id))
        return try await fetchRemotePacks(host).filter { !here.contains($0.id) }
    }

    /// Take a remote pack in: its INDEX only. The lattices follow one at a
    /// time as pictures ask — 40 MB is not downloaded because a list was opened.
    public func adoptRemotePack(_ index: LutPackIndex, _ sourceId: String) async {
        var adopted = index
        adopted.sourceId = sourceId
        await savePack(adopted)
    }

    /// Why a look cannot grade here, in the words the panel shows.
    public func missingLookReason(_ ref: PackRef) -> String {
        guard let pack = packOf(ref) else { return "This look comes from a pack this browser does not hold." }
        // The pack is here and this look is NOT: forgotten, or republished
        // without it — "not here yet" would be a lie about a thing dropped.
        if lookIn(pack, ref.look) == nil {
            let name = !pack.name.isEmpty ? pack.name : (!pack.author.isEmpty ? pack.author : "this pack")
            return "That look is no longer in \(name) — forgotten, or gone from the pack."
        }
        if let sourceId = vaultText(pack.sourceId), hostFor(sourceId) == nil {
            return "Kept on \(sourceId) — connect it to grade with this look."
        }
        return "This look is not in this browser’s vault yet."
    }
}
