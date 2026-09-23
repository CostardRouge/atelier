// TONE SHAPING — levels and curves, the two controls a develop's eleven sliders
// cannot express. Port of `src/shared/develop/curves.ts`.
//
// Both work on ENCODED values in [0,1]. Five curves: `luma` is applied as ONE
// RATIO on luminance (a grey stays grey), `rgb` runs all three channels through
// the same map directly (it moves saturation, on purpose), `red` / `green` /
// `blue` tint on purpose. Levels are the coarse version: black point, white
// point, a midtone gamma. Order, fixed: levels (master, then the channel) →
// curves (master, then the channel). Interpolation is monotone cubic
// (Fritsch–Carlson); the tangent clamp is what keeps a tone curve from turning
// back on itself, and it is not an optimisation to remove.

import Foundation

// MARK: - curves

/// A control point, both coordinates ENCODED and in [0,1].
public struct CurvePoint: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

/// A curve: at least two points, sorted by x, no two sharing an x.
public typealias Curve = [CurvePoint]

public enum CurveChannel: String, Codable, CaseIterable, Sendable {
    case luma, rgb, red, green, blue
}

/// Every channel nil — "does nothing". One spelling, so the test is simple.
public struct ToneCurves: Codable, Equatable, Sendable {
    public var luma: Curve?
    public var rgb: Curve?
    public var red: Curve?
    public var green: Curve?
    public var blue: Curve?

    public init(luma: Curve? = nil, rgb: Curve? = nil, red: Curve? = nil, green: Curve? = nil, blue: Curve? = nil) {
        self.luma = luma; self.rgb = rgb; self.red = red; self.green = green; self.blue = blue
    }

    public static let `default` = ToneCurves()

    public subscript(_ channel: CurveChannel) -> Curve? {
        get {
            switch channel {
            case .luma: return luma
            case .rgb: return rgb
            case .red: return red
            case .green: return green
            case .blue: return blue
            }
        }
        set {
            switch channel {
            case .luma: luma = newValue
            case .rgb: rgb = newValue
            case .red: red = newValue
            case .green: green = newValue
            case .blue: blue = newValue
            }
        }
    }
}

/// The straight line, for a panel that wants two draggable ends to start from.
public func identityCurve() -> Curve {
    [CurvePoint(x: 0, y: 0), CurvePoint(x: 1, y: 1)]
}

/// A curve that does nothing: every point on y = x, which the monotone cubic
/// reproduces as the line — so it is SKIPPED, and an untouched pixel comes
/// back bit-identical.
public func isIdentityCurve(_ c: Curve?) -> Bool {
    guard let c, c.count >= 2 else { return true }
    return c.allSatisfy { $0.x == $0.y }
}

public func isDefaultCurves(_ c: ToneCurves?) -> Bool {
    guard let c else { return true }
    return CurveChannel.allCases.allSatisfy { isIdentityCurve(c[$0]) }
}

/// More than this and a junk file could make every bake crawl.
public let curveMaxPoints = 32

/// A stored curve read back safely: non-finite coordinates dropped, the rest
/// clamped and sorted; a second point at the same x goes; fewer than two
/// points, or the identity, reads as nil.
public func normaliseCurve(_ raw: JSONValue?) -> Curve? {
    guard case .array(let entries)? = raw else { return nil }
    var pts: Curve = []
    for entry in entries {
        guard case .object(let e) = entry,
              let x = e["x"]?.finiteNumber, let y = e["y"]?.finiteNumber else { continue }
        pts.append(CurvePoint(x: clamp01(x), y: clamp01(y)))
        if pts.count >= curveMaxPoints { break }
    }
    // A stable sort: the web's `Array.prototype.sort` is stable too, so two
    // points at one x keep the order the file wrote them in and the LATER one
    // is the one dropped.
    pts = pts.enumerated().sorted { a, b in
        a.element.x != b.element.x ? a.element.x < b.element.x : a.offset < b.offset
    }.map(\.element)
    var out: Curve = []
    for p in pts {
        if let last = out.last, last.x == p.x { continue }
        out.append(p)
    }
    if out.count < 2 { return nil }
    return isIdentityCurve(out) ? nil : out
}

public func normaliseCurves(_ raw: JSONValue?) -> ToneCurves {
    let src = raw?.objectValue ?? [:]
    return ToneCurves(
        luma: normaliseCurve(src["luma"]),
        rgb: normaliseCurve(src["rgb"]),
        red: normaliseCurve(src["red"]),
        green: normaliseCurve(src["green"]),
        blue: normaliseCurve(src["blue"])
    )
}

/// As a document holds it: nil when nothing shapes, the "empty means computed" rule.
public func curvesOrNull(_ raw: JSONValue?) -> ToneCurves? {
    guard let raw, raw != .null else { return nil }
    let c = normaliseCurves(raw)
    return isDefaultCurves(c) ? nil : c
}

public func sameCurve(_ a: Curve?, _ b: Curve?) -> Bool {
    if isIdentityCurve(a) && isIdentityCurve(b) { return true }
    let x = a ?? []
    let y = b ?? []
    return x == y
}

public func sameCurves(_ a: ToneCurves?, _ b: ToneCurves?) -> Bool {
    CurveChannel.allCases.allSatisfy { sameCurve(a?[$0], b?[$0]) }
}

/// The curve as one function, RESOLVED ONCE. Fritsch–Carlson monotone cubic
/// Hermite; outside the first and last x the value is held at that end's y.
public func makeCurve(_ points: Curve) -> (Double) -> Double {
    let n = points.count
    // Fewer than two points draw no shape: the line, so a caller is never handed NaN.
    if n < 2 { return { clamp01($0) } }
    let xs = points.map(\.x)
    let ys = points.map(\.y)
    var d = [Double](repeating: 0, count: n - 1)
    for i in 0..<(n - 1) {
        let h = xs[i + 1] - xs[i]
        d[i] = h > 0 ? (ys[i + 1] - ys[i]) / h : 0
    }
    var m = [Double](repeating: 0, count: n)
    m[0] = d[0]
    m[n - 1] = d[n - 2]
    if n > 2 { for i in 1..<(n - 1) { m[i] = (d[i - 1] + d[i]) / 2 } }
    // The clamp that makes it monotone.
    for i in 0..<(n - 1) {
        if d[i] == 0 {
            m[i] = 0
            m[i + 1] = 0
            continue
        }
        let a = m[i] / d[i]
        let b = m[i + 1] / d[i]
        let s = a * a + b * b
        if s > 9 {
            let t = 3 / s.squareRoot()
            m[i] = t * a * d[i]
            m[i + 1] = t * b * d[i]
        }
    }
    return { v in
        if v <= xs[0] { return ys[0] }
        if v >= xs[n - 1] { return ys[n - 1] }
        var lo = 0
        var hi = n - 1
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1
            if v < xs[mid] { hi = mid } else { lo = mid }
        }
        let h = xs[lo + 1] - xs[lo]
        let t = (v - xs[lo]) / h
        let t2 = t * t
        let t3 = t2 * t
        let y = (2 * t3 - 3 * t2 + 1) * ys[lo]
            + (t3 - 2 * t2 + t) * h * m[lo]
            + (-2 * t3 + 3 * t2) * ys[lo + 1]
            + (t3 - t2) * h * m[lo + 1]
        return clamp01(y)
    }
}

// MARK: - levels

/// One channel of levels. `gamma` above 1 lifts (Photoshop's convention).
public struct LevelChannel: Codable, Equatable, Sendable {
    public var inBlack: Double
    public var inWhite: Double
    public var gamma: Double
    public var outBlack: Double
    public var outWhite: Double

    public init(inBlack: Double = 0, inWhite: Double = 1, gamma: Double = 1, outBlack: Double = 0, outWhite: Double = 1) {
        self.inBlack = inBlack; self.inWhite = inWhite; self.gamma = gamma; self.outBlack = outBlack; self.outWhite = outWhite
    }

    public static let neutral = LevelChannel()
}

public enum LevelsChannel: String, Codable, CaseIterable, Sendable {
    case rgb, red, green, blue
}

public struct Levels: Codable, Equatable, Sendable {
    public var rgb: LevelChannel?
    public var red: LevelChannel?
    public var green: LevelChannel?
    public var blue: LevelChannel?

    public init(rgb: LevelChannel? = nil, red: LevelChannel? = nil, green: LevelChannel? = nil, blue: LevelChannel? = nil) {
        self.rgb = rgb; self.red = red; self.green = green; self.blue = blue
    }

    public static let `default` = Levels()

    public subscript(_ channel: LevelsChannel) -> LevelChannel? {
        get {
            switch channel {
            case .rgb: return rgb
            case .red: return red
            case .green: return green
            case .blue: return blue
            }
        }
        set {
            switch channel {
            case .rgb: rgb = newValue
            case .red: red = newValue
            case .green: green = newValue
            case .blue: blue = newValue
            }
        }
    }
}

public let minLevelGamma = 0.1
public let maxLevelGamma = 10.0

public func isNeutralLevel(_ l: LevelChannel?) -> Bool {
    guard let l else { return true }
    return l.inBlack == 0 && l.inWhite == 1 && l.gamma == 1 && l.outBlack == 0 && l.outWhite == 1
}

public func isDefaultLevels(_ l: Levels?) -> Bool {
    guard let l else { return true }
    return LevelsChannel.allCases.allSatisfy { isNeutralLevel(l[$0]) }
}

/// A stored level read back safely. An empty or inverted input range is not a
/// level, so the channel comes back neutral; any POSITIVE span is kept.
public func normaliseLevel(_ raw: JSONValue?) -> LevelChannel? {
    guard let r = raw?.objectValue else { return nil }
    func num(_ v: JSONValue?, _ fallback: Double) -> Double { v?.finiteNumber ?? fallback }
    let inBlack = clamp01(num(r["inBlack"], 0))
    let inWhite = clamp01(num(r["inWhite"], 1))
    if !(inWhite - inBlack > 0) { return nil }
    let g = num(r["gamma"], 1)
    let level = LevelChannel(
        inBlack: inBlack,
        inWhite: inWhite,
        gamma: g < minLevelGamma ? minLevelGamma : (g > maxLevelGamma ? maxLevelGamma : g),
        outBlack: clamp01(num(r["outBlack"], 0)),
        outWhite: clamp01(num(r["outWhite"], 1))
    )
    return isNeutralLevel(level) ? nil : level
}

public func normaliseLevels(_ raw: JSONValue?) -> Levels {
    let src = raw?.objectValue ?? [:]
    return Levels(
        rgb: normaliseLevel(src["rgb"]),
        red: normaliseLevel(src["red"]),
        green: normaliseLevel(src["green"]),
        blue: normaliseLevel(src["blue"])
    )
}

public func levelsOrNull(_ raw: JSONValue?) -> Levels? {
    guard let raw, raw != .null else { return nil }
    let l = normaliseLevels(raw)
    return isDefaultLevels(l) ? nil : l
}

public func sameLevel(_ a: LevelChannel?, _ b: LevelChannel?) -> Bool {
    if isNeutralLevel(a) && isNeutralLevel(b) { return true }
    guard let a, let b else { return false }
    return a == b
}

public func sameLevels(_ a: Levels?, _ b: Levels?) -> Bool {
    LevelsChannel.allCases.allSatisfy { sameLevel(a?[$0], b?[$0]) }
}

/// One channel of levels as a function, resolved once.
public func makeLevel(_ l: LevelChannel) -> (Double) -> Double {
    let span = l.inWhite - l.inBlack
    let outSpan = l.outWhite - l.outBlack
    let invGamma = 1 / l.gamma
    return { v in
        var t = (v - l.inBlack) / span
        t = t < 0 ? 0 : (t > 1 ? 1 : t)
        if invGamma != 1 { t = pow(t, invGamma) }
        return clamp01(l.outBlack + outSpan * t)
    }
}

// MARK: - the stage

/// A per-channel map of ENCODED values; `channel` is 0 = red, 1 = green, 2 = blue.
public typealias ChannelShaper = (Double, Int) -> Double

/// The luma curve as one map of encoded LUMINANCE, or nil when it does not shape.
public func makeLumaShaper(_ curves: ToneCurves?) -> ((Double) -> Double)? {
    guard let c = curves?.luma, !isIdentityCurve(c) else { return nil }
    return makeCurve(c)
}

/// Levels and the rgb / red / green / blue curves as ONE per-channel map, or nil
/// when none of them shapes. Order inside a channel: levels master → levels
/// channel → curve master → curve channel.
public func makeChannelShaper(_ curves: ToneCurves?, _ levels: Levels?) -> ChannelShaper? {
    let c = curves ?? .default
    let l = levels ?? .default
    let masterLevel: ((Double) -> Double)? = isNeutralLevel(l.rgb) ? nil : makeLevel(l.rgb!)
    let masterCurve: ((Double) -> Double)? = isIdentityCurve(c.rgb) ? nil : makeCurve(c.rgb!)
    let chLevels = [l.red, l.green, l.blue]
    let chCurves = [c.red, c.green, c.blue]
    var chains: [[(Double) -> Double]] = []
    var shapes = false
    for i in 0..<3 {
        var chain: [(Double) -> Double] = []
        if let masterLevel { chain.append(masterLevel) }
        if !isNeutralLevel(chLevels[i]) { chain.append(makeLevel(chLevels[i]!)) }
        if let masterCurve { chain.append(masterCurve) }
        if !isIdentityCurve(chCurves[i]) { chain.append(makeCurve(chCurves[i]!)) }
        if !chain.isEmpty { shapes = true }
        chains.append(chain)
    }
    if !shapes { return nil }
    return { value, channel in
        var v = value
        for f in chains[channel] { v = f(v) }
        return v
    }
}

// MARK: - words

/// `curve luma+red`, or an empty string when nothing shapes.
public func describeCurves(_ c: ToneCurves?) -> String {
    if isDefaultCurves(c) { return "" }
    let on = CurveChannel.allCases.filter { !isIdentityCurve(c?[$0]) }.map(\.rawValue)
    return "curve \(on.joined(separator: "+"))"
}

/// `levels rgb+blue`, or an empty string when nothing shapes.
public func describeLevels(_ l: Levels?) -> String {
    if isDefaultLevels(l) { return "" }
    let on = LevelsChannel.allCases.filter { !isNeutralLevel(l?[$0]) }.map(\.rawValue)
    return "levels \(on.joined(separator: "+"))"
}
