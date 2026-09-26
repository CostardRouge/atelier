// A PACK of purchased looks — its SHAPE, the reference a document stores
// instead of a lattice, and the read-only questions the picker and the vault's
// weighing ask of it. A PARTIAL port of `src/shared/lut/lut-pack.ts`: what
// `gallery-nodes.ts`, `pack-weight.ts` and the saved-grade resolver read.
// Reading a folder listing into an index (`buildPackIndex`, `prettyName`,
// `stripNodePrefix`, `slug`, `familyFor`, the D-Log hint), migrating a stored
// index (`migratePackIndex`), `withoutLooks`, `flattenPack`, `lookLabel` and
// `nodeLabelPath` are the lut-pack task's, to be added to THIS file.
//
// Three rules of `docs/lut-packs.md` shape it:
// - A document carries a REFERENCE, never a lattice (§3, rule 1): a layer
//   wearing a pack look stores `{pack, look, hash}` — about 120 bytes — in
//   the `customText` a saved layer already has, the way a film stock stores
//   its settings there. No document schema changes in any tool.
// - A purchased look is never altered (§3, rule 2): nothing here resamples a
//   lattice or renames a file; labels are presentation only.
// - The tree's depth varies (§2): `Conversion / DJI / a look` is three
//   levels, `Creative / a look` two. Nothing may assume a camera level.

import Foundation

/// Where a look's preview must be baked — a conversion LUT expects LOG input (§7).
public enum PackFamily: String, Sendable, CaseIterable {
    case log
    case rec709
}

/// A node of the pack's tree: a category, or a camera inside one.
public struct PackNode: Equatable, Sendable {
    /// Path-shaped and stable: `conversion`, `conversion/dji`.
    public var id: String
    public var label: String
    /// A caution the picker shows on the node — "D-Log, not D-Log M".
    public var hint: String?
    public var children: [PackNode]?

    public init(id: String, label: String, hint: String? = nil, children: [PackNode]? = nil) {
        self.id = id; self.label = label; self.hint = hint; self.children = children
    }
}

/// One look of the pack.
public struct PackLook: Equatable, Sendable {
    /// Path-shaped and stable, the node's id plus the look's own slug.
    public var id: String
    public var label: String
    /// The node this look hangs from (`""` for a look at the pack's root).
    public var node: String
    /// The file inside the pack folder, kept verbatim so a re-import matches.
    public var file: String
    /// Which reference its thumbnail is baked on.
    public var family: PackFamily
    /// Grid size, once the file has been parsed.
    public var lattice: Int?
    /// Bytes of the source `.cube`.
    public var bytes: Int?
    /// SHA-256 of the SOURCE `.cube`, lowercase hex — the vault's key and a
    /// reference's identity.
    public var hash: String?
    /// SHA-256 of the ENCODED lattice (`PackCodec.swift`), lowercase hex — the
    /// instance file store's key, a DIFFERENT number from `hash`. The bucket is
    /// content-addressed on the bytes it is given, so an upload keyed on
    /// `hash` is refused (400) — `media-pipeline.md`, «A look has TWO hashes».
    /// Measured from the bytes as they are sent; absent on a look never pushed.
    public var blob: String?
    /// The look baked onto its family's reference at import, as a data URL.
    public var thumb: String?

    public init(id: String, label: String, node: String = "", file: String, family: PackFamily,
                lattice: Int? = nil, bytes: Int? = nil, hash: String? = nil, blob: String? = nil,
                thumb: String? = nil) {
        self.id = id; self.label = label; self.node = node; self.file = file; self.family = family
        self.lattice = lattice; self.bytes = bytes; self.hash = hash; self.blob = blob; self.thumb = thumb
    }
}

/// The pack index — the small JSON half, the one that syncs (§5.1).
public struct LutPackIndex: Equatable, Sendable {
    public var id: String
    /// The pack's own name, e.g. `AUTHENTIC`.
    public var name: String
    public var author: String
    /// Where it was bought, shown in the picker's credits popover.
    public var url: String?
    public var tree: [PackNode]
    public var looks: [PackLook]
    /// Node or look ids the author does not want offered — the looks stay stored.
    public var hidden: [String]
    /// The instance this pack is kept on (a source id); nil is this device only.
    /// Unlike a trip's, it travels IN the document.
    public var sourceId: String?

    public init(id: String, name: String, author: String = "", url: String? = nil, tree: [PackNode] = [],
                looks: [PackLook] = [], hidden: [String] = [], sourceId: String? = nil) {
        self.id = id; self.name = name; self.author = author; self.url = url; self.tree = tree
        self.looks = looks; self.hidden = hidden; self.sourceId = sourceId
    }
}

// MARK: - the reference a layer stores

/// What a saved layer carries in place of a lattice.
public struct PackRef: Equatable, Sendable {
    public var pack: String
    public var look: String
    public var hash: String

    public init(pack: String, look: String, hash: String) {
        self.pack = pack; self.look = look; self.hash = hash
    }
}

/// The `source` a pack layer carries, beside `custom`, `film` and the built-ins.
public let packSource = "pack"

public func isPackLayer(_ layer: LutLayer) -> Bool {
    layer.source == packSource
}

public func isPackLayer(_ layer: SavedLutLayer) -> Bool {
    layer.source == packSource
}

/// A reference as a layer stores it — JSON in `customText`, written in the
/// web's key order (`pack`, `look`, `hash`), so the text a phone writes is the
/// text the browser writes and a grade's key does not change with the client.
public func writePackRef(_ ref: PackRef) -> String {
    let pack = JSONValue.string(ref.pack).serialized()
    let look = JSONValue.string(ref.look).serialized()
    let hash = JSONValue.string(ref.hash).serialized()
    return "{\"pack\":\(pack),\"look\":\(look),\"hash\":\(hash)}"
}

/// A reference read back out of a document, or nil if it says nothing usable.
/// A reference written before hashes existed still names its look.
public func readPackRef(_ text: String?) -> PackRef? {
    guard let text, !text.isEmpty, let raw = JSONValue.parse(text)?.objectValue else { return nil }
    guard let pack = raw["pack"]?.stringValue, !pack.isEmpty else { return nil }
    guard let look = raw["look"]?.stringValue, !look.isEmpty else { return nil }
    return PackRef(pack: pack, look: look, hash: raw["hash"]?.stringValue ?? "")
}

// MARK: - which reference a look is previewed on

/// Log formats and conversion words as they appear INSIDE a look's own name,
/// once every separator is gone (`Apple-Log-2-Rec709` → `applelog2rec709`).
/// No word boundaries, deliberately: `SGamut3CineSLog3_To_Cine+709` has none
/// in front of `slog` to anchor to.
private let logInName: [String] = [
    "dlog", "slog", "nlog", "vlog", "clog", "flog", "ilog", "hlog", "blog", "logc",
    "applelog", "sgamut", "sgammut", "conversion", "convert",
    "torec709", "2rec709", "tocine709", "tolc709",
]

/// A name with its `.cube` extension dropped, lowercased, every run of
/// non-`[a-z0-9]` replaced by `fill`.
private func foldName(_ name: String, fill: String) -> String {
    var stem = name
    if stem.lowercased().hasSuffix(".cube") { stem = String(stem.dropLast(5)) }
    var out = ""
    var inRun = false
    for scalar in stem.lowercased().unicodeScalars {
        let ascii = scalar.value < 128
        let keep = ascii && ((scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9"))
        if keep {
            out.unicodeScalars.append(scalar)
            inRun = false
        } else if !inRun {
            out += fill
            inRun = true
        }
    }
    return out
}

/// Which reference a look previews on when nothing but its NAME says what it
/// expects — an uploaded `.cube` (no category above it) and a built-in (its
/// folder is a brand, not a category). A HEURISTIC over a file name: the cost
/// of a wrong guess is one thumbnail on the wrong picture, never a wrong render.
public func familyForLookName(_ name: String) -> PackFamily {
    let tight = foldName(name, fill: "")
    if logInName.contains(where: { tight.contains($0) }) { return .log }
    // A standalone word, for a name that spells it out: `APPLE_APPLE LOG.cube`.
    let spaced = foldName(name, fill: " ")
    return " \(spaced) ".contains(" log ") ? .log : .rec709
}

// MARK: - asking

/// The look of this id, or nil.
public func lookIn(_ index: LutPackIndex, _ lookId: String) -> PackLook? {
    index.looks.first { $0.id == lookId }
}

/// True when the author put this look out of the way — its node is hidden, or
/// the look itself is. Presentation only: a grade already wearing a hidden look
/// still renders (§6).
public func isHidden(_ index: LutPackIndex, _ look: PackLook) -> Bool {
    if index.hidden.isEmpty { return false }
    if index.hidden.contains(look.id) { return true }
    return index.hidden.contains { look.node == $0 || look.node.hasPrefix("\($0)/") }
}

/// The looks the picker offers, in file order, hidden ones left out.
public func visibleLooks(_ index: LutPackIndex) -> [PackLook] {
    index.looks.filter { !isHidden(index, $0) }
}

/// Every node of the tree, flattened depth-first — what a rail draws.
public func flattenNodes(_ tree: [PackNode], depth: Int = 0) -> [(node: PackNode, depth: Int)] {
    var out: [(node: PackNode, depth: Int)] = []
    for node in tree {
        out.append((node, depth))
        if let children = node.children, !children.isEmpty {
            out.append(contentsOf: flattenNodes(children, depth: depth + 1))
        }
    }
    return out
}

/// The looks hanging from this node, its descendants included.
public func looksUnder(_ index: LutPackIndex, _ nodeId: String) -> [PackLook] {
    visibleLooks(index).filter { $0.node == nodeId || $0.node.hasPrefix("\(nodeId)/") }
}
