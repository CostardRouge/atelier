// Winnow's CULLING, as Atelier reads it — never writes it. Port of
// `src/shared/sources/winnow/culling.ts`.
//
// Culling is Winnow's job (`docs/develop-tool.md` §8), and the maintainer's
// answer of 2026-09-23 (`docs/lightroom-gaps.md` §8, item 33) is that Develop
// SHOWS it and FILTERS on it, and never sets it. So this is a reader of the
// row Winnow already sends (`GRID_SELECT` joins `ratings` into every row of
// `/api/assets`) and a filter over what it read.
//
// - The verdict is Winnow's vocabulary (its migrations 0001 and 0016):
//   `pick`, `reject`, `skip` and `unrated`; anything else reads as unrated,
//   never as a verdict nobody gave.
// - Stars are 0 to 5; a value off that scale is clamped, not trusted.
// - A colour label is a free string on Winnow's side; it is SHOWN only when
//   it is one of the five names Lightroom and Capture One share.
//
// A picture that did not come from an instance, or whose instance has not
// answered, has NO culling (nil) — which is not unrated, and the filter says
// so rather than hiding it as if it had been rejected.

import Foundation

public enum Verdict: String, Equatable, Sendable, CaseIterable {
    case pick, reject, skip, unrated
}

public struct Culling: Equatable, Sendable {
    public var verdict: Verdict
    /// 0 to 5; 0 is no stars.
    public var star: Int
    /// The label as Winnow holds it, or nil for none.
    public var color: String?

    public init(verdict: Verdict, star: Int, color: String?) {
        self.verdict = verdict; self.star = star; self.color = color
    }
}

/// The culling a row carries — `{ verdict, star, color_label }` — or nil when
/// the row says nothing of it (an older instance). A key that is ABSENT and a
/// key that is `null` differ: a row with `verdict: null` has been answered for.
public func cullingFromRow(_ raw: JSONValue?) -> Culling? {
    let o = raw?.objectValue ?? [:]
    return cullingFrom(verdict: o["verdict"], star: o["star"], colorLabel: o["color_label"])
}

/// The same reading of a row already read (`WinnowAssetRow` keeps the three
/// wire values as they came).
public func cullingFromRow(_ row: WinnowAssetRow) -> Culling? {
    cullingFrom(verdict: row.verdict, star: row.star, colorLabel: row.colorLabel)
}

private func cullingFrom(verdict: JSONValue?, star: JSONValue?, colorLabel: JSONValue?) -> Culling? {
    if verdict == nil && star == nil && colorLabel == nil { return nil }
    let v = verdict?.stringValue.flatMap(Verdict.init(rawValue:)) ?? .unrated
    var stars = 0
    if let n = star?.finiteNumber {
        // `Math.round`: half UP.
        let rounded = (n + 0.5).rounded(.down)
        stars = Int(Swift.max(0, Swift.min(5, rounded)))
    }
    let label = colorLabel?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
    return Culling(verdict: v, star: stars, color: (label?.isEmpty ?? true) ? nil : label)
}

/// True when Winnow has said anything about this picture beyond "not looked at".
public func isCulled(_ c: Culling?) -> Bool {
    guard let c else { return false }
    return c.verdict != .unrated || c.star > 0 || c.color != nil
}

/// The five labels Lightroom and Capture One share, by the name Winnow would store.
public enum LabelColour: String, Equatable, Sendable, CaseIterable {
    case red, yellow, green, blue, purple
}

/// A stored label as one of the five, or nil for none or a free text.
public func labelColour(_ color: String?) -> LabelColour? {
    guard let c = color?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !c.isEmpty else { return nil }
    return LabelColour(rawValue: c)
}

/// `Pick · ★★★ · red` — what Winnow said, in a line; empty for nothing.
public func describeCulling(_ c: Culling?) -> String {
    guard let c else { return "" }
    var parts: [String] = []
    switch c.verdict {
    case .pick: parts.append("Pick")
    case .reject: parts.append("Rejected")
    case .skip: parts.append("Skipped")
    case .unrated: break
    }
    if c.star > 0 { parts.append(String(repeating: "★", count: c.star)) }
    if let color = c.color { parts.append(color) }
    return parts.joined(separator: " · ")
}

// MARK: - the filter

/// What the strip shows, on Winnow's word. `all` is no filter; `picks` is
/// Winnow's picks alone; `unrejected` leaves the rejects out and keeps
/// everything else, a picture Winnow never saw included; `stars` keeps a
/// picture with at least `min` stars.
public enum CullFilter: Equatable, Sendable {
    case all
    case picks
    case unrejected
    case stars(min: Int)
}

/// The web's `NO_CULL_FILTER`.
public let noCullFilter: CullFilter = .all

/// Every filter the menu offers, in its order — the web's `CULL_FILTERS`.
public let cullFilters: [CullFilter] = [.all, .picks, .unrejected] + (1...5).map { CullFilter.stars(min: $0) }

public func cullFilterKey(_ f: CullFilter) -> String {
    switch f {
    case .all: return "all"
    case .picks: return "picks"
    case .unrejected: return "unrejected"
    case .stars(let min): return "stars:\(min)"
    }
}

/// A stored key read back; anything unknown is no filter.
public func readCullFilter(_ key: JSONValue?) -> CullFilter {
    guard let text = key?.stringValue else { return noCullFilter }
    return cullFilters.first { cullFilterKey($0) == text } ?? noCullFilter
}

public func cullFilterLabel(_ f: CullFilter) -> String {
    switch f {
    case .all: return "All"
    case .picks: return "Picks"
    case .unrejected: return "Not rejected"
    case .stars(let min): return String(repeating: "★", count: Swift.max(0, min)) + (min < 5 ? " and up" : "")
    }
}

/// Whether a picture passes. A picture Winnow has said NOTHING about (nil)
/// passes only the filters that do not ask Winnow for a yes — `all` and
/// `unrejected` — because nothing says it was rejected, nor picked.
public func passesCull(_ c: Culling?, _ f: CullFilter) -> Bool {
    switch f {
    case .all: return true
    case .unrejected: return c?.verdict != .reject
    case .picks: return c?.verdict == .pick
    case .stars(let min): return (c?.star ?? 0) >= min
    }
}

/// How a roll's pictures stand against Winnow, for the status line.
public struct CullCounts: Equatable, Sendable {
    /// Pictures Winnow answered for.
    public var known: Int
    public var picks: Int
    public var rejects: Int
    public var starred: Int

    public init(known: Int = 0, picks: Int = 0, rejects: Int = 0, starred: Int = 0) {
        self.known = known; self.picks = picks; self.rejects = rejects; self.starred = starred
    }
}

public func countCulling<S: Sequence>(_ cullings: S) -> CullCounts where S.Element == Culling? {
    var out = CullCounts()
    for case let c? in cullings {
        out.known += 1
        if c.verdict == .pick { out.picks += 1 }
        if c.verdict == .reject { out.rejects += 1 }
        if c.star > 0 { out.starred += 1 }
    }
    return out
}
