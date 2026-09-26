// Media reconciliation — port of `src/shared/projects/reconcile.ts`, pure.
//
// When a project reopens, the saved media list is matched against what the
// folder (or the source) holds NOW. Resolution goes **id → hash → name**,
// most stable key first (`studio.md`, «Media identity»):
//
// - `assetId` — exact, while the project stays in the source that issued it;
// - `hash` — the shared partial content hash, which survives a RENAME (the
//   fragility the maintainer actually complained about);
// - `name`, case-insensitively — the last resort (DJI cards mix `.MP4`/`.SRT`).
//
// A match on id or hash is `found` outright: content identity is established,
// so a differing mtime means a copy, not an edit. A match on NAME alone keeps
// the old rule — a different size or mtime is `changed`. That asymmetry is
// the whole payoff; do not "simplify" it away. Missing media never block
// opening: the project stays editable and the caller offers a re-point.
//
// `adoptRenames` then rewrites every structure keyed by BASE NAME together —
// the file list, the active clip, the trims and the develops — so a rename is
// absorbed once, not re-detected forever. Anything else keyed by base name
// must join it.

import Foundation

public enum MediaStatus: String, CaseIterable, Sendable {
    case found
    case changed
    case missing
}

/// Which key resolved the match — absent when nothing matched.
public enum MatchedBy: String, CaseIterable, Sendable {
    case id
    case hash
    case name
}

public struct ReconciledRef: Equatable, Sendable {
    public var ref: SavedMediaRef
    public var status: MediaStatus
    public var matchedBy: MatchedBy?
    /// What it matched — carries the CURRENT name, which a rename has changed.
    public var actual: SavedMediaRef?

    public init(ref: SavedMediaRef, status: MediaStatus, matchedBy: MatchedBy? = nil, actual: SavedMediaRef? = nil) {
        self.ref = ref; self.status = status; self.matchedBy = matchedBy; self.actual = actual
    }
}

public struct Reconciliation: Equatable, Sendable {
    public var items: [ReconciledRef]
    public var found: Int
    public var changed: Int
    public var missing: Int
    /// Matched under a different file name — what `adoptRenames` can absorb.
    public var renamed: Int
}

/// First claim wins, like the library's asset grouping.
private func indexRefs(_ refs: [SavedMediaRef], _ key: (SavedMediaRef) -> String?) -> [String: SavedMediaRef] {
    var map: [String: SavedMediaRef] = [:]
    for ref in refs {
        if let k = key(ref), map[k] == nil { map[k] = ref }
    }
    return map
}

private func isRenamed(_ ref: SavedMediaRef, _ actual: SavedMediaRef) -> Bool {
    ref.name.lowercased() != actual.name.lowercased()
}

public func reconcileMedia(_ saved: [SavedMediaRef], _ actual: [SavedMediaRef]) -> Reconciliation {
    let byId = indexRefs(actual) { $0.assetId }
    let byHash = indexRefs(actual) { $0.hash }
    let byName = indexRefs(actual) { $0.name.lowercased() }

    let items: [ReconciledRef] = saved.map { ref in
        // An empty key is no key, as the web's truthiness test reads it.
        if let id = ref.assetId, !id.isEmpty, let match = byId[id] {
            return ReconciledRef(ref: ref, status: .found, matchedBy: .id, actual: match)
        }
        if let hash = ref.hash, !hash.isEmpty, let match = byHash[hash] {
            return ReconciledRef(ref: ref, status: .found, matchedBy: .hash, actual: match)
        }
        guard let match = byName[ref.name.lowercased()] else { return ReconciledRef(ref: ref, status: .missing) }
        let same = match.size == ref.size && match.lastModified == ref.lastModified
        return ReconciledRef(ref: ref, status: same ? .found : .changed, matchedBy: .name, actual: match)
    }

    return Reconciliation(
        items: items,
        found: items.filter { $0.status == .found }.count,
        changed: items.filter { $0.status == .changed }.count,
        missing: items.filter { $0.status == .missing }.count,
        renamed: items.filter { item in item.actual.map { isRenamed(item.ref, $0) } ?? false }.count
    )
}

/// Rewrite a project's bound half onto the names the media carries NOW — the
/// file list, the active clip, the trim keys and the develop keys, together.
/// Nil when nothing was renamed, so the caller can skip the write.
public func adoptRenames(_ media: ProjectMedia, _ reconciliation: Reconciliation) -> ProjectMedia? {
    if reconciliation.renamed == 0 { return nil }

    // Old name → what it is called now. Keyed on the full name, since that is
    // what `media.files` holds; the last write of a name wins, as in a Map.
    var renames: [String: SavedMediaRef] = [:]
    var order: [String] = []
    for item in reconciliation.items {
        guard let actual = item.actual, isRenamed(item.ref, actual) else { continue }
        if renames[item.ref.name] == nil { order.append(item.ref.name) }
        renames[item.ref.name] = actual
    }
    if renames.isEmpty { return nil }

    // Base name → new base name, for the structures keyed by base name.
    var baseRenames: [String: String] = [:]
    for oldName in order {
        guard let actual = renames[oldName] else { continue }
        baseRenames[fileBaseName(oldName).lowercased()] = fileBaseName(actual.name)
    }
    func rebase(_ id: String) -> String { baseRenames[id.lowercased()] ?? id }

    var next = media
    next.files = media.files.map { ref in
        guard let actual = renames[ref.name] else { return ref }
        // Adopt the file's current identity, but keep the stable keys we
        // already hold: the hash is what found it, and `actual` may carry none.
        var out = ref
        out.name = actual.name
        out.size = actual.size
        out.lastModified = actual.lastModified
        out.assetId = actual.assetId ?? ref.assetId
        out.hash = actual.hash ?? ref.hash
        return out
    }
    // Two keys landing on one name: the later in key order wins — the web's
    // is the object's insertion order, which a dictionary does not keep.
    var trims: [String: SavedTrim] = [:]
    for id in media.trims.keys.sorted() { trims[rebase(id)] = media.trims[id] }
    // The third structure keyed by base name — a develop belongs to the same
    // picture under its new name, and its hash is what found the rename.
    var develops: [String: SavedDevelop] = [:]
    for id in media.develops.keys.sorted() { develops[rebase(id)] = media.develops[id] }
    next.activeId = media.activeId.map(rebase)
    next.trims = trims
    next.develops = develops
    return next
}
