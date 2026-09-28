// Spreading several entrances over time from WHERE the things are — a
// collage's cells, a badge's pieces, an intro scene's titles. Port of
// `src/shared/overlay/stagger.ts`, pure.
//
// The engine's one stagger primitive is `AnimStep.delay`. This derives those
// delays from boxes instead, so a cascade re-reads itself when a layout
// changes and no stale delay is ever STORED on an element: ranks come from an
// order, delays from ranks × `each`, the settled instant from the last rank
// plus the step's own length.
//
// Ties share a rank: two boxes whose keys sit within 2% of the short side of
// each other land together, which is what makes `rows` land a whole row at
// once. `random` is seeded by the ONE PRNG (`Lib/PRNG.swift`) and the seed is
// stored, so the export shuffles exactly as the approved preview did — the
// same seed draws the same order here as in every browser.
//
// The web's `Rect` (`{ x, y, w, h }`) and `Size` (`{ w, h }`) are the kernel's
// `Rect` and `Size` (`Geometry.swift`).

import Foundation

public enum StaggerOrder: String, CaseIterable, Sendable {
    case sequence
    case reverse
    case centerOut = "center-out"
    case edgesIn = "edges-in"
    case rows
    case columns
    case size
    case random
}

public struct StaggerOrderOption: Equatable, Sendable {
    public let id: StaggerOrder
    public let label: String
    public let hint: String
}

/// The orders the picker offers. The web's `STAGGER_ORDERS`.
public let staggerOrders: [StaggerOrderOption] = [
    StaggerOrderOption(id: .sequence, label: "Sequence", hint: "In their own order"),
    StaggerOrderOption(id: .reverse, label: "Reverse", hint: "The last one first"),
    StaggerOrderOption(id: .centerOut, label: "Centre out", hint: "From the middle of the frame outwards"),
    StaggerOrderOption(id: .edgesIn, label: "Edges in", hint: "From the edges towards the middle"),
    StaggerOrderOption(id: .rows, label: "Rows", hint: "Top row first, a row at a time"),
    StaggerOrderOption(id: .columns, label: "Columns", hint: "Left column first, a column at a time"),
    StaggerOrderOption(id: .size, label: "Big first", hint: "The largest lands first"),
    StaggerOrderOption(id: .random, label: "Random", hint: "Shuffled once, the same way every time"),
]

public struct Stagger: Equatable, Sendable {
    /// Seconds between two ranks.
    public var each: Double
    public var order: StaggerOrder
    /// `random` only — stored so the export shuffles exactly as the preview did.
    public var seed: Double?

    public init(each: Double, order: StaggerOrder, seed: Double? = nil) {
        self.each = each; self.order = order; self.seed = seed
    }

    /// The web's `DEFAULT_STAGGER`.
    public static let `default` = Stagger(each: 0.1, order: .sequence)
}

/// The web's `MAX_STAGGER_EACH`.
public let maxStaggerEach = 1.0

/// How close two keys may be, as a share of the short side, and still share a rank.
private let tieShare = 0.02

/// The rank of every box, 0 first. Ranks are dense (0, 1, 2…) and ties share
/// one; a `random` order is a permutation with no ties.
public func staggerRanks(_ boxes: [Rect], _ frame: Size, _ order: StaggerOrder, seed: Double = 0) -> [Int] {
    let n = boxes.count
    if n == 0 { return [] }
    switch order {
    case .sequence: return Array(0..<n)
    case .reverse: return (0..<n).map { n - 1 - $0 }
    case .random:
        let next = mulberry32(seed)
        var idx = Array(0..<n)
        var i = n - 1
        while i > 0 {
            let j = Int((next() * Double(i + 1)).rounded(.down))
            idx.swapAt(i, j)
            i -= 1
        }
        var ranks = [Int](repeating: 0, count: n)
        for (rank, box) in idx.enumerated() { ranks[box] = rank }
        return ranks
    default:
        break
    }

    let shortSide = min(frame.width, frame.height)
    let short = shortSide > 0 ? shortSide : 1 // `|| 1`: zero and NaN
    let halfW = frame.width / 2
    let halfH = frame.height / 2
    func cx(_ b: Rect) -> Double { b.x + b.width / 2 }
    func cy(_ b: Rect) -> Double { b.y + b.height / 2 }
    func dist(_ b: Rect) -> Double { hypot(cx(b) - halfW, cy(b) - halfH) }
    let key: (Rect) -> Double
    var tie = tieShare * short
    switch order {
    case .centerOut: key = dist
    case .edgesIn: key = { -dist($0) }
    case .rows: key = cy
    case .columns: key = cx
    default:
        // `size`: the largest first; a tie is 2% of the short side squared.
        key = { -($0.width * $0.height) }
        tie = tieShare * short * short
    }
    let keyed = boxes.enumerated().map { (i: $0.offset, k: key($0.element)) }
    let sorted = keyed.sorted { a, b in a.k != b.k ? a.k < b.k : a.i < b.i }
    var ranks = [Int](repeating: 0, count: n)
    var rank = -1
    var anchor = -Double.infinity
    for s in sorted {
        if s.k - anchor > tie {
            rank += 1
            anchor = s.k
        }
        ranks[s.i] = rank
    }
    return ranks
}

/// Seconds each box waits before its entrance starts.
public func staggerDelays(_ boxes: [Rect], _ frame: Size, _ stagger: Stagger) -> [Double] {
    let each = max(0, stagger.each)
    return staggerRanks(boxes, frame, stagger.order, seed: stagger.seed ?? 0).map { Double($0) * each }
}

/// When the whole cascade is at rest — the last entrance's start plus its own
/// length. What a still is drawn at; 0 with nothing to wait for.
public func staggerSettle(_ delays: [Double], _ step: AnimStep?) -> Double {
    guard let last = delays.max() else { return 0 }
    guard let step, step.preset != .none else { return last }
    return last + max(0, step.duration)
}

/// Read a stagger out of anything — a stored document, an imported file.
public func normaliseStagger(_ v: JSONValue?) -> Stagger {
    let o = v?.objectValue ?? [:]
    let each = OverlayJSON.number(o, "each").map { min(maxStaggerEach, max(0, $0)) } ?? Stagger.default.each
    let order = OverlayJSON.value(o, "order", StaggerOrder.self) ?? .sequence
    var out = Stagger(each: each, order: order)
    if let seed = OverlayJSON.number(o, "seed") { out.seed = ExifText.jsRound(seed) }
    return out
}

/// A fresh seed for `random` — stored on the document the moment it is drawn.
public func newStaggerSeed() -> Double {
    Double(Int.random(in: 0..<1_000_000))
}

extension Stagger {
    public var json: JSONValue {
        var o: [String: JSONValue] = ["each": .number(each), "order": .string(order.rawValue)]
        OverlayJSON.put(&o, "seed", seed)
        return .object(o)
    }
}
