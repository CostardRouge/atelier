// Pure helpers for the Compare A/B wipe — port of `src/tools/compare/compare.ts`.
//
// The compare stage layers two media (A underneath, B on top); B is clipped
// so it shows only to the RIGHT of the divider, revealing A on the left —
// before on the left, after on the right, the suite's rule. `reconcilePair`
// keeps the two chosen sides valid as the set of open media changes.
//
// Names: the web's `clamp01` is `clampWipe` here, because the kernel's own
// `clamp01` (`Geometry.swift`) lets a NaN through while this one — a divider
// position read off a pointer — answers 0 for anything not finite.

import Foundation

/// Clamp to the 0...1 range a normalised divider position lives in; 0 for a
/// value that is not finite.
public func clampWipe(_ n: Double) -> Double {
    guard n.isFinite else { return 0 }
    return min(1, max(0, n))
}

/// The web's CSS `clip-path` for the top (B) layer — inset from the left by
/// `split` — kept byte for byte (`toFixed(4)`, trailing zeros trimmed). The
/// native stage masks by the fraction itself; the string is the same fact in
/// the browser's words.
public func insetForSplit(_ split: Double) -> String {
    var pct = ExifText.toFixed(clampWipe(split) * 100, 4)
    // `.replace(/\.?0+$/, '')` on a `toFixed(4)` text, which always holds a point.
    if pct.contains(".") {
        while pct.hasSuffix("0") { pct.removeLast() }
        if pct.hasSuffix(".") { pct.removeLast() }
    }
    return "inset(0 0 0 \(pct)%)"
}

/// The two sides of a compare.
public struct ComparePair: Equatable, Sendable {
    public var a: String?
    public var b: String?

    public init(a: String?, b: String?) {
        self.a = a
        self.b = b
    }
}

/// Choose the A and B ids given the previous choice and the ids available now.
/// Keeps a still-valid choice stable, fills empty slots from the pool, dedupes
/// (A and B cannot be the same), and collapses a lone item into A so B is only
/// set once a real pair exists.
public func reconcilePair(_ a: String?, _ b: String?, _ available: [String]) -> ComparePair {
    let set = Set(available)
    var na: String? = nil
    if let a, set.contains(a) { na = a }
    var nb: String? = nil
    if let b, set.contains(b) { nb = b }
    if let current = nb, current == na { nb = nil }

    var used = Set<String>()
    if let na { used.insert(na) }
    if let nb { used.insert(nb) }
    let pool = available.filter { !used.contains($0) }

    var i = 0
    if na == nil, i < pool.count {
        na = pool[i]
        i += 1
    }
    if nb == nil, i < pool.count {
        nb = pool[i]
        i += 1
    }
    // A lone item belongs in A, never B.
    if na == nil, let lone = nb {
        na = lone
        nb = nil
    }
    return ComparePair(a: na, b: nb)
}
