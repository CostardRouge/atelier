// A pack's INDEX, built from a folder and read back from storage — the half of
// `src/shared/lut/lut-pack.ts` that `LutPack.swift` does not hold (that file
// keeps the shapes, the reference a layer stores and the picker's questions).
// Here: reading a folder listing into an index (`buildPackIndex`), the names
// it reads a tree into (`prettyName`, `stripNodePrefix`, `packSlug` — the
// web's `slug` —, `familyFor`, the D-Log caution), a stored index read back
// (`migratePackIndex`) and written (`json`), and the manager's questions
// (`lookLabel`, `nodeLabelPath`, `withoutLooks`, `flattenPack`).
//
// Rules kept (`docs/lut-packs.md`, `media-pipeline.md`):
// - Labels are PRESENTATION of the author's own folder names; a look's FILE is
//   kept verbatim, never renamed (§3, rule 2). At most ONE leading camera word
//   is dropped, and never when what is left says nothing: `APPLE_APPLE LOG`
//   under `Apple` is the format Apple Log, not `Log`.
// - Ids are path-shaped and derived from the tree, so re-importing the same
//   folder lands on the references documents already hold.
// - Depth past a category and a camera is FLATTENED into the camera's label
//   (`A/B/C/look.cube` → the camera `B · C`): three levels is what a picker
//   can draw, and the tree's depth varies — nothing assumes a camera level.
// - A stored index is untrusted input: a look without an id and a file is left
//   behind, and a thumbnail that is not an image data URL never survives.

import Foundation

/// The web's `PACK_VERSION` — bumped when a stored index needs reading
/// differently; `migratePackIndex` is where that happens.
public let packIndexVersion = 1

// MARK: - stored

/// An index read back out of storage — or off a Winnow — onto the current
/// shape, or nil when it is not an index at all. Defensive for the reason
/// `gradeOrNull` is: a half-read pack would offer looks whose bytes are not
/// there.
///
/// One difference the type forces: a grid size or a byte count that is not a
/// whole number is dropped here (the web would keep `33.5`), since neither can
/// be one in an index the suite wrote.
public func migratePackIndex(_ raw: JSONValue?) -> LutPackIndex? {
    guard let p = raw?.objectValue else { return nil }
    guard let id = p["id"]?.stringValue, !id.isEmpty else { return nil }
    guard let rawLooks = p["looks"]?.arrayValue else { return nil }
    let looks = rawLooks.compactMap(readStoredLook)
    let tree = p["tree"]?.arrayValue.map { $0.compactMap(readStoredNode) } ?? []
    let hidden = p["hidden"]?.arrayValue.map { $0.compactMap(\.stringValue) } ?? []
    return LutPackIndex(
        id: id,
        name: p["name"]?.stringValue ?? "",
        author: p["author"]?.stringValue ?? "",
        url: storedText(p["url"]),
        tree: tree,
        looks: looks,
        hidden: hidden,
        sourceId: storedText(p["sourceId"])
    )
}

/// A string that is present and not empty — JavaScript's truthy string.
private func storedText(_ value: JSONValue?) -> String? {
    guard let s = value?.stringValue, !s.isEmpty else { return nil }
    return s
}

/// A finite, whole, non-zero number — what `lattice ? { lattice } : {}` keeps.
private func storedCount(_ value: JSONValue?) -> Int? {
    guard let n = value?.finiteNumber, let whole = Int(exactly: n), whole != 0 else { return nil }
    return whole
}

private func readStoredLook(_ raw: JSONValue) -> PackLook? {
    guard let o = raw.objectValue, let id = o["id"]?.stringValue, !id.isEmpty,
          let file = o["file"]?.stringValue else { return nil }
    // A data URL and nothing else: an arbitrary string here would go straight
    // into an image source.
    let thumb = o["thumb"]?.stringValue.flatMap { $0.hasPrefix("data:image/") ? $0 : nil }
    return PackLook(
        id: id,
        label: storedText(o["label"]) ?? id,
        node: o["node"]?.stringValue ?? "",
        file: file,
        family: o["family"]?.stringValue == PackFamily.log.rawValue ? .log : .rec709,
        lattice: storedCount(o["lattice"]),
        bytes: storedCount(o["bytes"]),
        hash: storedText(o["hash"]),
        blob: storedText(o["blob"]),
        thumb: thumb
    )
}

private func readStoredNode(_ raw: JSONValue) -> PackNode? {
    guard let o = raw.objectValue, let id = o["id"]?.stringValue, !id.isEmpty else { return nil }
    let children = o["children"]?.arrayValue.map { $0.compactMap(readStoredNode) } ?? []
    return PackNode(
        id: id,
        label: storedText(o["label"]) ?? id,
        hint: storedText(o["hint"]),
        children: children.isEmpty ? nil : children
    )
}

// The index as JSON — what the vault stores and what a `lutpack` document
// carries. An absent optional is left out, as `JSON.stringify` leaves out an
// `undefined`, so the text reads back as the value it was.

extension PackNode {
    public var json: JSONValue {
        var o: [String: JSONValue] = ["id": .string(id), "label": .string(label)]
        if let hint { o["hint"] = .string(hint) }
        if let children { o["children"] = .array(children.map(\.json)) }
        return .object(o)
    }
}

extension PackLook {
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "id": .string(id), "label": .string(label), "node": .string(node),
            "file": .string(file), "family": .string(family.rawValue),
        ]
        if let lattice { o["lattice"] = .number(Double(lattice)) }
        if let bytes { o["bytes"] = .number(Double(bytes)) }
        if let hash { o["hash"] = .string(hash) }
        if let blob { o["blob"] = .string(blob) }
        if let thumb { o["thumb"] = .string(thumb) }
        return .object(o)
    }
}

extension LutPackIndex {
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "id": .string(id), "name": .string(name), "author": .string(author),
            "tree": .array(tree.map(\.json)), "looks": .array(looks.map(\.json)),
            "hidden": .array(hidden.map { .string($0) }),
        ]
        if let url { o["url"] = .string(url) }
        if let sourceId { o["sourceId"] = .string(sourceId) }
        return .object(o)
    }
}

// MARK: - names

/// The brands a pack names its folders after. One pack writes `Apple` and
/// `APPLE` for the same camera in two categories: without one vocabulary the
/// tree would show a brand twice (`docs/lut-packs.md` §5.3).
private let packBrands: [String: String] = [
    "apple": "Apple",
    "blackmagic": "Blackmagic",
    "canon": "Canon",
    "dji": "DJI",
    "fujifilm": "Fujifilm",
    "gopro": "GoPro",
    "insta360": "Insta360",
    "leica": "Leica",
    "nikon": "Nikon",
    "olympus": "Olympus",
    "panasonic": "Panasonic",
    "red": "RED",
    "samsung": "Samsung",
    "sigma": "Sigma",
    "sony": "Sony",
]

/// Log formats as their makers write them — `S-Log3 · S-Gamut3.Cine` reads as
/// the thing you shot, `Slog3` as a typo. The web's `TERMS`, pattern for
/// pattern; each is anchored on the whole word and case-insensitive.
private let packTermSources: [(String, String)] = [
    (#"^s-?log-?3$"#, "S-Log3"),
    (#"^s-?log-?2$"#, "S-Log2"),
    (#"^s-?gam(m)?ut-?3?\.?cine$"#, "S-Gamut3.Cine"),
    (#"^s-?gam(m)?ut-?3$"#, "S-Gamut3"),
    (#"^s-?gam(m)?ut$"#, "S-Gamut"),
    (#"^d-?log-?m$"#, "D-Log M"),
    (#"^d-?log$"#, "D-Log"),
    (#"^c-?log-?([23])$"#, "C-Log$1"),
    (#"^c-?log$"#, "C-Log"),
    (#"^n-?log$"#, "N-Log"),
    (#"^v-?log$"#, "V-Log"),
    (#"^f-?log-?2$"#, "F-Log2"),
    (#"^f-?log$"#, "F-Log"),
    (#"^i-?log$"#, "I-Log"),
    (#"^h-?log$"#, "H-Log"),
    (#"^b-?log$"#, "B-Log"),
    (#"^log$"#, "Log"),
    (#"^rec-?709$"#, "Rec.709"),
    (#"^lc-?709(type)?-?(a)?$"#, "LC-709"),
    (#"^gen-?([0-9])$"#, "Gen $1"),
    (#"^chaud$"#, "warm"),
    (#"^froid$"#, "cold"),
    (#"^hdr$"#, "HDR"),
    (#"^sdr$"#, "SDR"),
]

private let packTerms: [(NSRegularExpression, String)] = packTermSources.map { source, out in
    (try! NSRegularExpression(pattern: source, options: [.caseInsensitive]), out)
}

/// Words a pack repeats on every folder and file and that say nothing in a
/// picker — the web's `NOISE`: `luts?|pack|preset|presets|cube|v[0-9]+`.
private func isNoiseWord(_ word: String) -> Bool {
    let w = word.lowercased()
    if ["lut", "luts", "pack", "preset", "presets", "cube"].contains(w) { return true }
    guard w.hasPrefix("v") else { return false }
    let rest = w.dropFirst()
    return !rest.isEmpty && rest.unicodeScalars.allSatisfy { $0 >= "0" && $0 <= "9" }
}

/// Words that say nothing on their own — the web's `GENERIC`.
private let genericWords: Set<String> = ["log", "hdr", "sdr", "rec.709", "warm", "cold", "clean", "neutral"]

/// JavaScript's `\s`, scalar for scalar — not Unicode's White_Space, which
/// adds U+0085 and leaves out U+FEFF.
private func isScriptSpace(_ s: Unicode.Scalar) -> Bool {
    switch s.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
        return true
    default:
        return false
    }
}

/// JavaScript's `trim()`: the same set, at both ends.
func packTrimmed(_ s: String) -> String {
    let scalars = s.unicodeScalars
    guard let first = scalars.firstIndex(where: { !isScriptSpace($0) }),
          let last = scalars.lastIndex(where: { !isScriptSpace($0) }) else { return "" }
    return String(scalars[first...last])
}

/// A name with a trailing `.cube` (any case) dropped — `/\.cube$/i`.
func packStem(_ raw: String) -> String {
    let scalars = raw.unicodeScalars
    guard scalars.count >= 5 else { return raw }
    let tail = String(String.UnicodeScalarView(scalars.suffix(5)))
    guard tail.lowercased() == ".cube" else { return raw }
    return String(String.UnicodeScalarView(scalars.dropLast(5)))
}

/// Split a folder or file name into the words a label is built from: the
/// extension dropped, underscores and every run of whitespace one space.
private func packWords(_ raw: String) -> [String] {
    var out = ""
    var inRun = false
    for s in packStem(raw).unicodeScalars {
        if s == "_" || isScriptSpace(s) {
            if !inRun { out += " " }
            inRun = true
        } else {
            out.unicodeScalars.append(s)
            inRun = false
        }
    }
    return out.split(separator: " ").map(String.init)
}

/// One word, as a person writes it: a brand, a log format, or Title Case.
private func prettyWord(_ word: String) -> String {
    if let brand = packBrands[word.lowercased()] { return brand }
    let range = NSRange(word.startIndex..., in: word)
    for (re, out) in packTerms where re.firstMatch(in: word, options: [], range: range) != nil {
        return re.stringByReplacingMatches(in: word, options: [], range: range, withTemplate: out)
    }
    let scalars = word.unicodeScalars
    if !scalars.isEmpty && scalars.allSatisfy({ $0 >= "0" && $0 <= "9" }) { return word }
    // A word already written with inner capitals or punctuation is left alone:
    // an acronym or the author's own styling (`A7SIII`).
    let upper = scalars.filter { $0 >= "A" && $0 <= "Z" }.count
    let allUpper = !scalars.isEmpty && upper == scalars.count
    if upper >= 2 && !allUpper { return word }
    guard let first = word.first else { return word }
    return String(first).uppercased() + String(word.dropFirst()).lowercased()
}

/// A folder or file name as the picker shows it: the pack's own name dropped
/// (every file in AUTHENTIC starts with `AUTHENTIC_LUT_`), the filler words
/// dropped, a parenthesised remark kept as a suffix, brands and log formats
/// spelled the way their makers do. Never answers with nothing.
public func prettyName(_ raw: String, _ drop: [String] = []) -> String {
    let dropped = Set(drop.map { $0.lowercased() }.filter { !$0.isEmpty })
    let stem = packStem(raw)
    // `/^([^(]*)\(([^)]*)\)\s*$/`: everything up to the FIRST `(`, then up to
    // the first `)` after it, then nothing but whitespace.
    var head = raw
    var note = ""
    if let open = stem.firstIndex(of: "("),
       let close = stem[stem.index(after: open)...].firstIndex(of: ")"),
       stem[stem.index(after: close)...].unicodeScalars.allSatisfy(isScriptSpace) {
        head = String(stem[..<open])
        note = String(stem[stem.index(after: open)..<close])
    }
    let base = packWords(head).filter { !isNoiseWord($0) }
    let kept = base.filter { !dropped.contains($0.lowercased()) }
    let suffix = note.isEmpty ? "" : packWords(note).map(prettyWord).joined(separator: " ")
    // A look named after the pack itself (`AUTHENTIC_LUT.cube`) would drop to
    // nothing: it keeps the author's own words, as the author wrote them.
    let label = kept.isEmpty ? base.joined(separator: " ") : kept.map(prettyWord).joined(separator: " ")
    if !label.isEmpty && !suffix.isEmpty { return "\(label) · \(suffix)" }
    if !label.isEmpty { return label }
    if !suffix.isEmpty { return suffix }
    return stem
}

/// Drop the camera a file repeats from its own folder — `Sony_SLOG3…` under
/// `Sony` is `S-Log3` — but only ONE leading word, and never when what is left
/// says nothing.
public func stripNodePrefix(_ label: String, _ nodeLabel: String?) -> String {
    guard let nodeLabel, !nodeLabel.isEmpty else { return label }
    let nodeWords = Set(packWords(nodeLabel).map { $0.lowercased() })
    let parts = label.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
    guard parts.count >= 2, nodeWords.contains(parts[0].lowercased()) else { return label }
    let rest = parts.dropFirst()
    if rest.allSatisfy({ genericWords.contains($0.lowercased()) }) { return label }
    return rest.joined(separator: " ")
}

/// A path-shaped id: lowercase, accents folded, punctuation folded to single
/// dashes, never empty. The web's `slug`, named for its module here because a
/// bare `slug` is too generic a name for the kernel's one namespace.
public func packSlug(_ raw: String) -> String {
    let folded = packStem(raw).decomposedStringWithCompatibilityMapping.unicodeScalars
        .filter { !(0x300...0x36F).contains($0.value) }
    let lower = String(String.UnicodeScalarView(folded)).lowercased()
    var out = ""
    var inRun = false
    for s in lower.unicodeScalars {
        if (s >= "a" && s <= "z") || (s >= "0" && s <= "9") {
            out.unicodeScalars.append(s)
            inRun = false
        } else if !inRun {
            out += "-"
            inRun = true
        }
    }
    while out.hasPrefix("-") { out.removeFirst() }
    while out.hasSuffix("-") { out.removeLast() }
    return out.isEmpty ? "x" : out
}

private let logCategory = try! NSRegularExpression(pattern: "conversion|one.?click|log|convert", options: [.caseInsensitive])

/// Which reference a CATEGORY's looks preview on — a conversion or one-click
/// look expects LOG input and reads wrong on anything else (§7). Read from the
/// category, the only thing a `.cube` says about its input.
public func familyFor(_ categoryName: String) -> PackFamily {
    let range = NSRange(categoryName.startIndex..., in: categoryName)
    return logCategory.firstMatch(in: categoryName, options: [], range: range) != nil ? .log : .rec709
}

private let plainDLog = try! NSRegularExpression(pattern: "d-log(?! m)", options: [.caseInsensitive])

/// The caution a node shows: the pack ships DJI looks for D-Log while the
/// maintainer's drones record D-Log M — said on the node rather than a reason
/// to hide the looks (§2). The web's private `hintFor`.
private func packNodeHint(_ nodeLabel: String, _ lookLabels: [String]) -> String? {
    guard nodeLabel.lowercased() == "dji" else { return nil }
    let mentionsDLog = lookLabels.contains { l in
        plainDLog.firstMatch(in: l, options: [], range: NSRange(l.startIndex..., in: l)) != nil
    }
    let mentionsDLogM = lookLabels.contains { $0.lowercased().contains("d-log m") }
    if mentionsDLog && !mentionsDLogM { return "D-Log, not D-Log M — check your camera’s profile." }
    return nil
}

// MARK: - the index

/// One file of the folder the author picked.
public struct PackFileEntry: Equatable, Sendable {
    /// Posix path relative to the pack's root folder.
    public var path: String
    public var bytes: Int?
    /// Grid size, when the file has already been parsed.
    public var lattice: Int?
    public var hash: String?

    public init(path: String, bytes: Int? = nil, lattice: Int? = nil, hash: String? = nil) {
        self.path = path; self.bytes = bytes; self.lattice = lattice; self.hash = hash
    }
}

public struct BuildPackOptions: Equatable, Sendable {
    public var id: String
    /// Defaults to empty.
    public var name: String?
    public var author: String?
    public var url: String?
    public var hidden: [String]

    public init(id: String, name: String? = nil, author: String? = nil, url: String? = nil, hidden: [String] = []) {
        self.id = id; self.name = name; self.author = author; self.url = url; self.hidden = hidden
    }
}

/// A node while the tree is being built — a reference, as the web's objects
/// are, so a camera found twice and a hint set late land on the one node.
private final class PackNodeBox {
    let id: String
    let label: String
    var hint: String?
    var children: [PackNodeBox]?

    init(id: String, label: String) { self.id = id; self.label = label }

    var node: PackNode { PackNode(id: id, label: label, hint: hint, children: children?.map(\.node)) }
}

/// Read a folder listing into an index: the tree the picker draws, and one
/// look per `.cube`. Everything that is not a `.cube` is left out — the pack
/// the maintainer bought also ships 140 MB grain clips and a tutorial — and a
/// hidden file or a `.`-named one never becomes a look.
public func buildPackIndex(_ files: [PackFileEntry], _ options: BuildPackOptions) -> LutPackIndex {
    let name = packTrimmed(options.name ?? "")
    let author = packTrimmed(options.author ?? "")
    // Words to drop from every label: the pack's own name, however a file
    // name writes it.
    let drop = packWords(name) + packWords(name.replacingOccurrences(of: "-", with: " "))

    var tree: [PackNodeBox] = []
    var byId: [String: PackNodeBox] = [:]
    var byIdOrder: [PackNodeBox] = []
    var looks: [PackLook] = []
    var usedLookIds = Set<String>()

    func ensureNode(_ id: String, _ label: String, under parent: PackNodeBox?) -> PackNodeBox {
        if let known = byId[id] { return known }
        let box = PackNodeBox(id: id, label: label)
        byId[id] = box
        byIdOrder.append(box)
        if let parent { parent.children?.append(box) } else { tree.append(box) }
        return box
    }

    for entry in files {
        var parts = entry.path.split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init).filter { $0 != "." }
        guard let fileName = parts.popLast(), fileName.lowercased().hasSuffix(".cube") else { continue }
        if fileName.hasPrefix(".") { continue }

        let categoryRaw = parts.first
        let rest = Array(parts.dropFirst())
        let categoryLabel = categoryRaw.map { prettyName($0, drop) } ?? ""
        let family = familyFor(categoryRaw ?? "")

        var node: PackNodeBox?
        if let categoryRaw {
            var category = ensureNode(packSlug(categoryLabel.isEmpty ? categoryRaw : categoryLabel), categoryLabel,
                                      under: nil)
            if !rest.isEmpty {
                // Everything below the category is ONE level.
                let childLabel = rest.map { prettyName($0, drop) }.joined(separator: " · ")
                if category.children == nil { category.children = [] }
                category = ensureNode("\(category.id)/\(packSlug(childLabel))", childLabel, under: category)
            }
            node = category
        }

        let label = stripNodePrefix(prettyName(fileName, drop), node?.label)
        let base = node.map { "\($0.id)/\(packSlug(label))" } ?? packSlug(label)
        var id = base
        // Two files can clean up to the same label in one node.
        var n = 2
        while usedLookIds.contains(id) {
            id = "\(base)-\(n)"
            n += 1
        }
        usedLookIds.insert(id)

        looks.append(PackLook(
            id: id,
            label: label,
            node: node?.id ?? "",
            file: entry.path,
            family: family,
            lattice: entry.lattice.flatMap { $0 != 0 ? $0 : nil },
            bytes: entry.bytes.flatMap { $0 != 0 ? $0 : nil },
            hash: entry.hash.flatMap { $0.isEmpty ? nil : $0 }
        ))
    }

    for box in byIdOrder {
        let labels = looks.filter { $0.node == box.id }.map(\.label)
        if let hint = packNodeHint(box.label, labels) { box.hint = hint }
    }

    return LutPackIndex(
        id: options.id,
        name: name,
        author: author,
        url: options.url.flatMap { $0.isEmpty ? nil : $0 },
        tree: tree.map(\.node),
        looks: looks,
        hidden: options.hidden
    )
}

// MARK: - asking

/// How a look is named where it must say which pack it came from:
/// pack · category · camera · look.
public func lookLabel(_ index: LutPackIndex, _ look: PackLook) -> String {
    let pack = index.name.isEmpty ? index.author : index.name
    return ([pack] + nodeLabelPath(index.tree, look.node) + [look.label])
        .filter { !$0.isEmpty }
        .joined(separator: " · ")
}

/// The labels of a node's ancestors, outermost first — the node's own last.
public func nodeLabelPath(_ tree: [PackNode], _ nodeId: String) -> [String] {
    if nodeId.isEmpty { return [] }
    var out: [String] = []
    var level = tree
    for step in nodeId.split(separator: "/", omittingEmptySubsequences: false) {
        let found = level.first { n in
            let last = n.id.split(separator: "/", omittingEmptySubsequences: false).last ?? ""
            return last == step
        }
        guard let found else { break }
        out.append(found.label)
        level = found.children ?? []
    }
    return out
}

/// The pack without those looks — what forgetting one writes back. A category
/// left holding nothing goes (an empty folder in the rail reads as looks that
/// vanished), a node kept only because a CHILD still has looks stays, and a
/// `hidden` entry that names nothing any more goes. Freeing the BYTES is a
/// separate question (`freedHashes`), since they may be another look's too.
public func withoutLooks(_ index: LutPackIndex, _ lookIds: [String]) -> LutPackIndex {
    let doomed = Set(lookIds)
    let looks = index.looks.filter { !doomed.contains($0.id) }
    func holds(_ nodeId: String) -> Bool {
        looks.contains { $0.node == nodeId || $0.node.hasPrefix("\(nodeId)/") }
    }
    func prune(_ nodes: [PackNode]) -> [PackNode] {
        nodes.filter { holds($0.id) }.map { n in
            let children = prune(n.children ?? [])
            return PackNode(id: n.id, label: n.label, hint: n.hint.flatMap { $0.isEmpty ? nil : $0 },
                            children: children.isEmpty ? nil : children)
        }
    }
    let tree = prune(index.tree)
    let nodeIds = Set(flattenNodes(tree).map(\.node.id))
    let lookIdSet = Set(looks.map(\.id))
    var next = index
    next.tree = tree
    next.looks = looks
    next.hidden = index.hidden.filter { nodeIds.contains($0) || lookIdSet.contains($0) }
    return next
}

/// A row of a pack listed in full: one of its nodes, or one of its looks.
public enum PackEntry: Equatable, Sendable {
    case node(PackNode, depth: Int)
    case look(PackLook, depth: Int)

    public var depth: Int {
        switch self {
        case let .node(_, depth), let .look(_, depth): return depth
        }
    }
}

/// Every node AND every look of a pack, in the order a manager lists them: the
/// looks at the root first, then each node followed by its own looks one level
/// in. Hidden looks are INCLUDED (putting away and reclaiming are different
/// gestures, §6), and a look whose node names nothing in the tree is listed at
/// the root rather than dropped — the screen that can delete it must reach it.
public func flattenPack(_ index: LutPackIndex) -> [PackEntry] {
    var out: [PackEntry] = []
    var listed = Set<String>()
    func take(_ look: PackLook, _ depth: Int) {
        listed.insert(look.id)
        out.append(.look(look, depth: depth))
    }
    for look in index.looks where look.node.isEmpty { take(look, 0) }
    for entry in flattenNodes(index.tree) {
        out.append(.node(entry.node, depth: entry.depth))
        for look in index.looks where look.node == entry.node.id { take(look, entry.depth + 1) }
    }
    for look in index.looks where !listed.contains(look.id) { take(look, 0) }
    return out
}

// MARK: - ordering

/// ASCII in the order ICU's root collation puts it — what the web's
/// `localeCompare` sorts by: whitespace, then punctuation and symbols in this
/// order, then digits, then letters.
private let collatedAscii = Array(" _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789".unicodeScalars)

/// The web's `a.localeCompare(b)`, as far as a pack's paths and names need it
/// (a folder's `.cube` files, the vault's list of packs): letters compared
/// without their case or accents first, punctuation BEFORE digits before
/// letters and never ignored, then accents, then case — lowercase first.
/// Pinned against Node's ICU in the spec. Negative, zero or positive.
func packLocaleCompare(_ a: String, _ b: String) -> Int {
    let ka = packCollationKey(a)
    let kb = packCollationKey(b)
    for level in 0..<3 {
        let x = level == 0 ? ka.primary : (level == 1 ? ka.secondary : ka.tertiary)
        let y = level == 0 ? kb.primary : (level == 1 ? kb.secondary : kb.tertiary)
        for (p, q) in zip(x, y) where p != q { return p < q ? -1 : 1 }
        if x.count != y.count { return x.count < y.count ? -1 : 1 }
    }
    return 0
}

private func packCollationKey(_ s: String) -> (primary: [Int], secondary: [Int], tertiary: [Int]) {
    var primary: [Int] = []
    var secondary: [Int] = []
    var tertiary: [Int] = []
    for scalar in s.decomposedStringWithCanonicalMapping.unicodeScalars {
        let v = scalar.value
        if (0x300...0x36F).contains(v) {
            // A combining accent weighs on the letter before it, one level down.
            if let last = secondary.indices.last { secondary[last] = secondary[last] &* 128 &+ Int(v - 0x2FF) }
            continue
        }
        if v < 0x20 || v == 0x7F { continue }
        if let rank = collatedAscii.firstIndex(of: scalar) {
            primary.append(rank)
        } else if v < 0x80, let lower = Character(scalar).lowercased().unicodeScalars.first {
            primary.append(100 + Int(lower.value))
        } else {
            let lower = Character(scalar).lowercased().unicodeScalars.first ?? scalar
            primary.append(1000 + Int(lower.value))
        }
        secondary.append(0)
        tertiary.append(scalar.properties.isUppercase ? 1 : 0)
    }
    return (primary, secondary, tertiary)
}
