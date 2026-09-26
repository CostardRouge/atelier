// What the LUT vault WEIGHS — per look, per pack, in total, here and on the
// instance a pack is kept on. Port of `src/shared/lut/pack-weight.ts`.
//
// TWO figures from two sources, never mixed and never guessed:
// - HERE is MEASURED, off the stored buffers (the app's vault reads their
//   sizes; the index is not asked — it records what the `.cube` TEXT weighed,
//   four times the lattice).
// - ON THE INSTANCE is DERIVED exactly from the index's own grid size: an
//   encoded lattice is `encodedBytes(size)` = `40 + size³ × 6` and nothing else.
// A look whose index records no grid size and whose bytes are not here is
// UNWEIGHED, said out loud — never a zero.
//
// Both stores are content-addressed (the vault by the source `.cube`'s hash,
// the file store by the encoded lattice's `blob`), so every total is summed
// over DISTINCT keys: the vault total is not the sum of the pack rows, and a
// forget frees only the keys no surviving look still names.

import Foundation

/// Measured sizes by lattice hash, as the vault reads them off its store.
public typealias LatticeSizes = [String: Int]

/// Where a look's bytes are, as far as this device can tell.
public enum LookWhere: String, Sendable, CaseIterable {
    /// In this device's vault.
    case here
    /// Not here, but the instance the pack is kept on holds them.
    case instance
    /// Nowhere this device knows of: an interrupted import, or a pack never pushed.
    case nowhere
}

/// One look's weight, and which of the two sources answered.
public struct LookWeight: Equatable, Sendable {
    /// The encoded lattice's size in bytes, or nil when nothing can say.
    public var bytes: Int?
    /// True when the number came off the stored buffer rather than off the index.
    public var measured: Bool
    public var `where`: LookWhere

    public init(bytes: Int?, measured: Bool, where: LookWhere) {
        self.bytes = bytes; self.measured = measured; self.where = `where`
    }
}

/// What a pack, or the whole vault, weighs.
public struct Weight: Equatable, Sendable {
    /// Bytes on this device, measured, distinct lattices counted once.
    public var here: Int
    /// Lattices this device holds.
    public var hereLooks: Int
    /// Bytes on the instance, derived from the grid sizes, distinct blobs once.
    public var instance: Int
    /// Looks the instance holds the bytes of — those that carry a `blob`.
    public var instanceLooks: Int
    /// Looks counted.
    public var looks: Int
    /// Looks nothing can weigh: no grid size recorded and no bytes here.
    public var unweighed: Int

    public init(here: Int = 0, hereLooks: Int = 0, instance: Int = 0, instanceLooks: Int = 0,
                looks: Int = 0, unweighed: Int = 0) {
        self.here = here; self.hereLooks = hereLooks; self.instance = instance
        self.instanceLooks = instanceLooks; self.looks = looks; self.unweighed = unweighed
    }
}

/// The measured size under a look's non-empty hash, if this device holds it.
private func measuredSize(_ look: PackLook, _ sizes: LatticeSizes) -> Int? {
    guard let hash = look.hash, !hash.isEmpty else { return nil }
    return sizes[hash]
}

/// The size its recorded grid implies, or nil when none is recorded.
private func derivedSize(_ look: PackLook) -> Int? {
    guard let lattice = look.lattice, lattice != 0 else { return nil }
    return encodedBytes(lattice)
}

/// A key that is present and not empty — what JavaScript's truthiness reads.
private func present(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

/// One look's size: measured where this device holds the bytes, else derived
/// from the grid the index recorded. The two agree by construction, so a
/// disagreement would mean a truncated record.
public func lookBytes(_ look: PackLook, _ sizes: LatticeSizes) -> Int? {
    if let measured = measuredSize(look, sizes) { return measured }
    return derivedSize(look)
}

/// One look's weight and where its bytes are.
public func lookWeight(_ pack: LutPackIndex, _ look: PackLook, _ sizes: LatticeSizes) -> LookWeight {
    if let measured = measuredSize(look, sizes) {
        return LookWeight(bytes: measured, measured: true, where: .here)
    }
    // A `blob` is written into the index by the push that sent the bytes, so it
    // is the one honest sign an instance holds them — and it means nothing
    // without a pack kept somewhere to ask.
    let onInstance = present(pack.sourceId) != nil && present(look.blob) != nil
    return LookWeight(bytes: derivedSize(look), measured: false, where: onInstance ? .instance : .nowhere)
}

/// What a set of looks' lattices weigh, distinct lattices counted once — one
/// branch of a pack's tree, say. ONE number: `lookBytes` answers the same
/// size wherever the bytes are. A look nothing can weigh adds nothing.
public func looksBytes(_ looks: [PackLook], _ sizes: LatticeSizes) -> Int {
    var seen = Set<String>()
    var bytes = 0
    for look in looks {
        let key = present(look.hash) ?? look.id
        if seen.contains(key) { continue }
        seen.insert(key)
        bytes += lookBytes(look, sizes) ?? 0
    }
    return bytes
}

/// What one pack weighs, here and there.
public func packWeight(_ pack: LutPackIndex, _ sizes: LatticeSizes) -> Weight {
    weigh([pack], sizes)
}

/// What the whole vault weighs — every pack at once, so a lattice two packs
/// share is counted once. NOT the sum of `packWeight` over the packs.
public func vaultWeight(_ packs: [LutPackIndex], _ sizes: LatticeSizes) -> Weight {
    weigh(packs, sizes)
}

/// What each instance holds, by source id, in the order the packs first name
/// it (the web's `Map` order) — for a vault kept in two places.
public func instanceWeights(_ packs: [LutPackIndex], _ sizes: LatticeSizes) -> [(sourceId: String, bytes: Int)] {
    var hosts: [String] = []
    var byHost: [String: [LutPackIndex]] = [:]
    for pack in packs {
        guard let host = present(pack.sourceId) else { continue }
        if byHost[host] == nil { hosts.append(host) }
        byHost[host, default: []].append(pack)
    }
    return hosts.map { host in (host, weigh(byHost[host] ?? [], sizes).instance) }
}

private func weigh(_ packs: [LutPackIndex], _ sizes: LatticeSizes) -> Weight {
    var hashes = Set<String>()
    var blobs = Set<String>()
    var out = Weight()
    for pack in packs {
        for look in pack.looks {
            out.looks += 1
            let w = lookWeight(pack, look, sizes)
            if w.bytes == nil { out.unweighed += 1 }
            // Distinct keys only: the two stores are content-addressed.
            if w.where == .here, let hash = present(look.hash), !hashes.contains(hash) {
                hashes.insert(hash)
                out.here += w.bytes ?? 0
                out.hereLooks += 1
            }
            if present(pack.sourceId) != nil, let blob = present(look.blob), !blobs.contains(blob) {
                blobs.insert(blob)
                out.instance += lookBytes(look, sizes) ?? 0
                out.instanceLooks += 1
            }
        }
    }
    return out
}

// MARK: - what a forget frees

/// What dropping some looks gives back, and what it must leave alone.
public struct Freed: Equatable, Sendable {
    /// Keys no surviving look names: these bytes can go.
    public var free: [String]
    /// Keys another look still names: kept, and worth saying so.
    public var shared: [String]

    public init(free: [String] = [], shared: [String] = []) {
        self.free = free; self.shared = shared
    }
}

/// The lattice hashes forgetting these looks would free in THIS DEVICE'S vault
/// — the ones no surviving look of any pack still names. Asked of the
/// INDEXES, where every pack can be seen at once: two packs shipping one
/// `.cube` share one stored copy.
public func freedHashes(_ packs: [LutPackIndex], _ packId: String, _ lookIds: [String]) -> Freed {
    freed(packs, packId, lookIds, key: { $0.hash }, counts: { _ in true })
}

/// The same in the FILE STORE's vocabulary: the blobs forgetting these looks
/// would free on one instance. Keyed on `blob` (a `hash` names nothing
/// there), and only the packs kept on THAT instance have a say.
public func freedBlobs(_ packs: [LutPackIndex], _ packId: String, _ lookIds: [String], _ sourceId: String) -> Freed {
    freed(packs, packId, lookIds, key: { $0.blob }, counts: { $0.sourceId == sourceId })
}

private func freed(_ packs: [LutPackIndex], _ packId: String, _ lookIds: [String],
                   key: (PackLook) -> String?, counts: (LutPackIndex) -> Bool) -> Freed {
    let doomed = Set(lookIds)
    var survivors = Set<String>()
    // Insertion order kept, as the web's `Set` iterates.
    var wanted: [String] = []
    var wantedSet = Set<String>()
    for pack in packs {
        if !counts(pack) { continue }
        for look in pack.looks {
            guard let k = present(key(look)) else { continue }
            if pack.id == packId && doomed.contains(look.id) {
                if !wantedSet.contains(k) {
                    wantedSet.insert(k)
                    wanted.append(k)
                }
            } else {
                survivors.insert(k)
            }
        }
    }
    var out = Freed()
    for k in wanted {
        if survivors.contains(k) { out.shared.append(k) } else { out.free.append(k) }
    }
    return out
}

/// What a forget gave back, in the words the sheet prints.
public struct ForgetResult: Equatable, Sendable {
    /// Bytes reclaimed in this device's vault.
    public var here: Int
    /// Bytes reclaimed on the instance, and which one it was.
    public var instance: Int
    public var keptOn: String?
    /// Lattices a surviving look still names, so they stayed.
    public var shared: Int

    public init(here: Int, instance: Int, keptOn: String?, shared: Int) {
        self.here = here; self.instance = instance; self.keptOn = keptOn; self.shared = shared
    }
}

/// That result as one sentence — a look whose lattice another look holds
/// frees NOTHING, and a sentence says so better than a zero.
public func forgotten(_ result: ForgetResult) -> String {
    if result.here <= 0 {
        return result.shared > 0
            ? "no bytes came back: another look holds the same lattice."
            : "it held no bytes here."
    }
    var there = ""
    if result.instance > 0, let keptOn = present(result.keptOn) {
        there = " and \(formatPackBytes(Double(result.instance))) on \(keptOn)"
    }
    return "\(formatPackBytes(Double(result.here))) back here\(there)."
}

/// What a set of lattice hashes weighs here — the bytes a forget gives back.
public func hashBytes(_ hashes: [String], _ sizes: LatticeSizes) -> Int {
    hashes.reduce(0) { $0 + (sizes[$1] ?? 0) }
}

/// What a set of blobs weighs on an instance, derived from the grid sizes the
/// indexes record — the instance is never asked how big its own files are.
public func blobBytes(_ blobs: [String], _ packs: [LutPackIndex]) -> Int {
    var size: [String: Int] = [:]
    for pack in packs {
        for look in pack.looks {
            if let blob = present(look.blob), let derived = derivedSize(look), size[blob] == nil {
                size[blob] = derived
            }
        }
    }
    return blobs.reduce(0) { $0 + (size[$1] ?? 0) }
}

/// What a look's weight cell SAYS — the size, and a WORD when the bytes are not
/// on this device (a colour alone is unreadable in a screenshot). A dash when
/// the index records no grid size to derive one from.
public func lookWeightLabel(_ weight: LookWeight) -> String {
    guard let bytes = weight.bytes else { return "—" }
    let size = formatPackBytes(Double(bytes))
    if weight.where == .here { return size }
    return weight.where == .instance ? "\(size) there" : "\(size) missing"
}

/// The same, as the sentence its `title` carries.
public func lookWeightNote(_ weight: LookWeight, _ keptOn: String?) -> String {
    if weight.bytes == nil { return "This pack’s index does not record this look’s size." }
    if weight.where == .here { return "In this browser’s vault." }
    if weight.where == .instance {
        return "Not in this browser — kept on \(keptOn ?? "the instance"), and it downloads when a picture asks for it."
    }
    return "Neither in this browser nor on an instance: nothing here holds its bytes."
}

/// JavaScript's `toFixed` for a finite, non-negative value: a half goes UP.
private func toFixedUp(_ x: Double, _ digits: Int) -> String {
    let scale = pow(10.0, Double(digits))
    let n = (x * scale).rounded(.toNearestOrAwayFromZero)
    return String(format: "%.\(digits)f", n / scale)
}

/// Bytes as a person reads them — the web's `formatBytes` of this module,
/// renamed because the kernel's `formatBytes` (`Lib/Format.swift`, the port of
/// `shared/lib/format.ts`) is a different function: DECIMAL units and a dash
/// for junk. This one is BINARY units under decimal names, exactly as the
/// import sheet has always printed them, and `0 KB` for junk.
public func formatPackBytes(_ bytes: Double) -> String {
    if !bytes.isFinite || bytes <= 0 { return "0 KB" }
    if bytes < 1024 { return "\(Int((bytes + 0.5).rounded(.down))) B" }
    if bytes < 1_048_576 { return "\(Int((bytes / 1024 + 0.5).rounded(.down))) KB" }
    if bytes < 1_073_741_824 { return "\(toFixedUp(bytes / 1_048_576, 1)) MB" }
    return "\(toFixedUp(bytes / 1_073_741_824, 2)) GB"
}

public func formatPackBytes(_ bytes: Int) -> String {
    formatPackBytes(Double(bytes))
}
