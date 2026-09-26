// The BUILT-IN looks: the manifest's shape and reader, how a `.cube`'s path
// becomes its id, name and group, the picker's grouping, and the pre-baked
// tiles' naming rule. Port of `src/shared/lut/builtin-luts.ts`,
// `src/shared/lut/builtin-thumbs.ts`, the `luts-manifest` Vite plugin's scan
// (`vite.config.ts`) and `scripts/gen-lut-thumbs.mjs`'s `tileFile`.
//
// On the web the manifest is a Vite virtual module scanning `public/luts/` at
// build time; the app supplies the same entries from its bundle, either as the
// JSON the plugin writes or by handing `lutManifest(relativePaths:)` the paths
// it finds. THE ID RULE IS LOAD-BEARING: a document stores a built-in as
// `builtin:<id>`, so a look graded in the browser resolves on the phone only if
// both clients derive the same id from the same file.

import Foundation

/// One entry as the scan writes it (`src/luts-manifest.d.ts`).
public struct LutManifestEntry: Equatable, Sendable {
    /// Stable id from the path, e.g. `apple/AppleLog.cube` → `apple-applelog`.
    public var id: String
    /// Display label derived from the filename.
    public var name: String
    /// Posix folder path relative to `luts/` (`""` for files at the root).
    public var group: String
    /// Posix path relative to `luts/`.
    public var file: String

    public init(id: String, name: String, group: String, file: String) {
        self.id = id; self.name = name; self.group = group; self.file = file
    }
}

/// A built-in look as the picker and the resolver see it.
public struct BuiltinLut: Equatable, Sendable {
    /// Stable id — what `builtin:<id>` names in a document.
    public var id: String
    /// Human label shown in the picker.
    public var name: String
    /// Folder the LUT lives in (`""` for the `luts/` root), e.g. `apple`.
    public var group: String
    /// Where the `.cube` is read from — on the web a URL under the deployed
    /// base, in the app a path inside the bundle.
    public var url: String

    public init(id: String, name: String, group: String, url: String) {
        self.id = id; self.name = name; self.group = group; self.url = url
    }
}

/// A folder of built-ins, as the picker groups them.
public struct LutGroup: Equatable, Sendable {
    /// `APPLE`, or `APPLE / LOG` for nested folders.
    public var label: String
    public var luts: [BuiltinLut]

    public init(label: String, luts: [BuiltinLut]) {
        self.label = label; self.luts = luts
    }
}

// MARK: - the scan's naming rule

/// True for an ASCII letter or digit — what `[a-z0-9]` with the `i` flag keeps.
private func isAsciiAlnum(_ s: Unicode.Scalar) -> Bool {
    (s >= "a" && s <= "z") || (s >= "A" && s <= "Z") || (s >= "0" && s <= "9")
}

/// `text` with every run of scalars `keep` refuses replaced by one dash.
private func dashRuns(_ text: String, keep: (Unicode.Scalar) -> Bool) -> String {
    var out = ""
    var inRun = false
    for scalar in text.unicodeScalars {
        if keep(scalar) {
            out.unicodeScalars.append(scalar)
            inRun = false
        } else if !inRun {
            out += "-"
            inRun = true
        }
    }
    return out
}

/// A name with a trailing `.cube` (any case) dropped.
private func withoutCubeExtension(_ name: String) -> String {
    name.lowercased().hasSuffix(".cube") ? String(name.dropLast(5)) : name
}

/// The plugin's `prettify`: split on whitespace, `_` and `-`, capitalise only
/// the first letter of each word so deliberate casing (Rec709, DLog) survives.
private func prettifyLutStem(_ stem: String) -> String {
    let words = stem.split(whereSeparator: { $0.isWhitespace || $0 == "_" || $0 == "-" })
    let pretty = words.map { w -> String in
        guard let first = w.first else { return "" }
        return first.uppercased() + w.dropFirst()
    }.joined(separator: " ")
    return pretty.isEmpty ? stem : pretty
}

/// The manifest entry a `.cube` under `luts/` gets, from its posix path
/// relative to that folder — or nil when the scan would skip it (not a
/// `.cube`, or hidden: a dot file, an AppleDouble sidecar, a dot folder).
public func lutManifestEntry(relativePath: String) -> LutManifestEntry? {
    let parts = relativePath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    guard let fileName = parts.last, fileName.lowercased().hasSuffix(".cube") else { return nil }
    if parts.contains(where: { $0.hasPrefix(".") }) { return nil }
    let rel = parts.joined(separator: "/")
    let group = parts.dropLast().joined(separator: "/")
    return LutManifestEntry(
        id: dashRuns(withoutCubeExtension(rel), keep: isAsciiAlnum).lowercased(),
        name: prettifyLutStem(withoutCubeExtension(fileName)),
        group: group,
        file: rel
    )
}

/// ICU's root collation, as far as a folder or a file label needs it: letters
/// compared without case first, lowercase before uppercase on a tie.
private func localeOrder(_ a: String, _ b: String) -> Int {
    let la = a.lowercased(), lb = b.lowercased()
    if la != lb { return la < lb ? -1 : 1 }
    if a == b { return 0 }
    return a > b ? -1 : 1
}

/// The manifest for a set of paths under `luts/`, sorted as the plugin sorts
/// it: by group, then by name.
public func lutManifest(relativePaths: [String]) -> [LutManifestEntry] {
    relativePaths.compactMap { lutManifestEntry(relativePath: $0) }.sorted { a, b in
        let byGroup = localeOrder(a.group, b.group)
        return byGroup != 0 ? byGroup < 0 : localeOrder(a.name, b.name) < 0
    }
}

/// The manifest read defensively from its JSON (the plugin's output): an entry
/// without a string `id` and `file` is left behind.
public func readLutManifest(_ raw: JSONValue?) -> [LutManifestEntry] {
    (raw?.arrayValue ?? []).compactMap { item in
        guard let o = item.objectValue, let id = o["id"]?.stringValue, !id.isEmpty,
              let file = o["file"]?.stringValue, !file.isEmpty else { return nil }
        return LutManifestEntry(id: id, name: o["name"]?.stringValue ?? id,
                                group: o["group"]?.stringValue ?? "", file: file)
    }
}

// MARK: - the built-ins and their groups

/// The built-ins, each `url` being `base` + its file — the web's
/// `BASE_URL + "luts/" + file`, the app's folder inside its bundle.
public func builtinLuts(_ entries: [LutManifestEntry], base: String = "luts/") -> [BuiltinLut] {
    entries.map { BuiltinLut(id: $0.id, name: $0.name, group: $0.group, url: base + $0.file) }
}

public func builtinLuts(from manifest: JSONValue?, base: String = "luts/") -> [BuiltinLut] {
    builtinLuts(readLutManifest(manifest), base: base)
}

/// Built-ins at the `luts/` root — listed plainly, before the groups.
public func ungroupedLuts(_ luts: [BuiltinLut]) -> [BuiltinLut] {
    luts.filter { $0.group.isEmpty }
}

/// Folder-grouped built-ins, groups sorted by folder, labels uppercased per
/// segment and joined with ` / `.
public func lutGroups(_ luts: [BuiltinLut]) -> [LutGroup] {
    var order: [String] = []
    var byGroup: [String: [BuiltinLut]] = [:]
    for lut in luts where !lut.group.isEmpty {
        if byGroup[lut.group] == nil { order.append(lut.group) }
        byGroup[lut.group, default: []].append(lut)
    }
    return order
        .sorted { localeOrder($0, $1) < 0 }
        .map { group in
            let label = group.split(separator: "/", omittingEmptySubsequences: false)
                .map { $0.uppercased() }
                .joined(separator: " / ")
            return LutGroup(label: label, luts: byGroup[group] ?? [])
        }
}

// MARK: - the pre-baked tiles (`public/lut-thumbs/`)

/// A tile's file name: the gallery item's id made safe (`film:x` → `film-x.webp`).
public func builtinThumbFile(_ id: String) -> String {
    let safe = dashRuns(id) { s in isAsciiAlnum(s) || s == "." || s == "_" || s == "-" }
    return safe.lowercased() + ".webp"
}

/// `<gallery item id> → location`, from the generator's `index.json` and the
/// folder it sits in. A missing or malformed index is a valid state (every
/// look then bakes live), never an error; and only a plain relative file name
/// becomes a location, since the index is still read input.
public func readBuiltinThumbs(_ raw: JSONValue?, dir: String) -> [String: String] {
    guard let thumbs = raw?.objectValue?["thumbs"]?.objectValue else { return [:] }
    var out: [String: String] = [:]
    for (id, value) in thumbs {
        guard let file = value.stringValue, !file.isEmpty,
              file.unicodeScalars.allSatisfy({ isAsciiAlnum($0) || $0 == "." || $0 == "_" || $0 == "-" })
        else { continue }
        out[id] = dir + file
    }
    return out
}
