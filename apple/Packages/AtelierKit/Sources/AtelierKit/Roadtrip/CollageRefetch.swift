// Which of a collage's pictures to fetch back from their instance — the port
// of `src/tools/roadtrip/collage-refetch.ts`, the arithmetic behind the web's
// `use-collage-refetch.ts`.
//
// A relaunch empties the Library pool. The Library sync only ever re-finds
// the SELECTED cell's picture, so every other cell of a collage whose picture
// lives on a Winnow stayed an empty slot until it was tapped. Opening the
// slide asks for all of them at once; this decides which: named by a
// CONNECTED instance (a stored id is never a reason to call a server nobody
// named), absent from the pool by name, not already tried — each picture
// once, in cell order.

import Foundation

public struct RefetchTarget: Equatable, Sendable {
    /// The ref's `assetId` — one fetch per picture, however many cells hold it.
    public var key: String
    public var ref: SavedMediaRef
    /// The connected instance that holds it.
    public var sourceId: String

    public init(key: String, ref: SavedMediaRef, sourceId: String) {
        self.key = key; self.ref = ref; self.sourceId = sourceId
    }
}

/// The key a ref is fetched and reported under, or nil for one with no
/// instance id.
public func refetchKey(_ ref: SavedMediaRef?) -> String? {
    guard let id = ref?.assetId, !id.isEmpty else { return nil }
    return id
}

/// The refs, among `refs`, that must be fetched. `sourceOf` answers nil for a
/// ref no connected instance holds.
public func refsToFetch(_ refs: [SavedMediaRef?], poolNames: Set<String>,
                        sourceOf: (SavedMediaRef) -> String?,
                        attempted: Set<String> = []) -> [RefetchTarget] {
    var out: [RefetchTarget] = []
    var seen: Set<String> = []
    for ref in refs {
        guard let ref, let key = refetchKey(ref), !seen.contains(key), !attempted.contains(key) else { continue }
        seen.insert(key)
        if poolNames.contains(ref.name.lowercased()) { continue }
        guard let sourceId = sourceOf(ref) else { continue }
        out.append(RefetchTarget(key: key, ref: ref, sourceId: sourceId))
    }
    return out
}

/// The pool's file names, lower-cased — what `refsToFetch` checks against.
public func poolNameSet(_ names: [String?]) -> Set<String> {
    var set: Set<String> = []
    for name in names {
        if let name { set.insert(name.lowercased()) }
    }
    return set
}

/// Where one refetch stands.
public enum RefetchPhase: String, Sendable {
    case fetching, failed
}

public struct RefetchState: Equatable, Sendable {
    public var state: RefetchPhase
    public var sourceId: String
    public init(state: RefetchPhase, sourceId: String) {
        self.state = state; self.sourceId = sourceId
    }
}

/// One line summing up the fetches still running and the ones that failed,
/// for the Layout section — nil when there is nothing to say. `states` is in
/// insertion order (the web's `Map`), so the source named is the first one.
public func refetchSummary(_ states: [(key: String, value: RefetchState)]) -> String? {
    var fetching = 0
    var failed = 0
    var source = ""
    for (_, s) in states {
        if s.state == .fetching { fetching += 1 } else { failed += 1 }
        if source.isEmpty { source = s.sourceId }
    }
    if fetching > 0 { return "Fetching \(fetching) picture\(fetching == 1 ? "" : "s") back from \(source)…" }
    if failed > 0 {
        return "\(failed) picture\(failed == 1 ? "" : "s") could not be fetched back — select the cell to see why."
    }
    return nil
}
