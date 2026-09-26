// A FILM RESPONSE: the colour and tone of a photographic emulsion, as numbers,
// applied as a LOOK — one layer of the LUT stack, generated from its
// parameters instead of read from a `.cube`. Port of `src/shared/film/emulsion.ts`.
//
// It is a different thing from a DEVELOP (`Develop.swift`, the correction of
// one picture, first stage of the bake) and it deliberately does NOT share the
// develop's central guarantee: a develop keeps a grey grey, a film stock is
// allowed — required — to tint one. Per-channel crossover (cool shadows under
// warm highlights) is the whole point of an emulsion, so the "grey stays grey"
// spec of `DevelopTests` is not carried across. The design and the reasons are
// in `docs/film-simulation.md` §5.
//
// The chain, per pixel, in STOPS from mid grey (the photographer's axis):
//
//   sRGB code → linear → stops (18 % grey = 0)
//     → monochrome collapse (a spectral sensitivity × a contrast filter)
//     → coupling (the sensitisers' overlap between spectral neighbours)
//     → the characteristic curve, PER CHANNEL: toe → straight line → shoulder
//     → inhibition (DIR couplers: an unequal exposure pulls toward neutral)
//     → the print stage (a negative inverted onto paper; a reversal skips it)
//     → dye saturation
//   → linear → sRGB code, clamped
//
// Every curve is re-speeded so that mid grey maps to mid grey EXACTLY: a
// stock's crossover comes from the shape of its three curves, never from a
// hidden exposure change. `speed` is then an explicit, visible push or pull.
//
// `filmStage` mirrors `developStage`: resolved ONCE and called per lattice
// point — it runs 36 000 times inside a 33³ bake.
//
// The layer text (`writeFilmSettings`) is written BY HAND in the web's
// canonical key order — `JSONValue.serialized` sorts keys, which the web never
// does for this string — so a film layer dialled here is the same `customText`
// the web would write, and `filmSettingsKey` IS that text on both clients.

import Foundation

// MARK: - the record

public enum FilmCurveKey: String, CaseIterable, Sendable {
    case speed, gamma, toe, shoulder, black, white
}

/// One channel's characteristic curve, in stops about mid grey.
public struct FilmCurve: Equatable, Sendable {
    /// Push (+) or pull (−) beyond neutrality, in stops. 0 keeps mid grey exact.
    public var speed: Double
    /// Straight-line slope. 1 reproduces the scene's contrast.
    public var gamma: Double
    /// How softly the curve bottoms out, in stops: 0.05 is a knee, 2 is a long toe.
    public var toe: Double
    /// How softly it tops out, in stops.
    public var shoulder: Double
    /// How many stops BELOW mid grey the curve bottoms out.
    public var black: Double
    /// How many stops ABOVE mid grey it tops out. Past ~2.47 the white clips.
    public var white: Double

    public init(speed: Double, gamma: Double, toe: Double, shoulder: Double, black: Double, white: Double) {
        self.speed = speed; self.gamma = gamma; self.toe = toe
        self.shoulder = shoulder; self.black = black; self.white = white
    }

    public subscript(key: FilmCurveKey) -> Double {
        get {
            switch key {
            case .speed: return speed
            case .gamma: return gamma
            case .toe: return toe
            case .shoulder: return shoulder
            case .black: return black
            case .white: return white
            }
        }
        set {
            switch key {
            case .speed: speed = newValue
            case .gamma: gamma = newValue
            case .toe: toe = newValue
            case .shoulder: shoulder = newValue
            case .black: black = newValue
            case .white: white = newValue
            }
        }
    }
}

/// A single-layer emulsion: what it sees, through what filter.
public struct FilmMono: Equatable, Sendable {
    /// Spectral sensitivity of the one layer, r/g/b weights.
    public var sensitivity: (Double, Double, Double)
    /// The contrast filter over the lens, r/g/b transmittance.
    public var filter: (Double, Double, Double)

    public init(sensitivity: (Double, Double, Double), filter: (Double, Double, Double)) {
        self.sensitivity = sensitivity; self.filter = filter
    }

    public static func == (a: FilmMono, b: FilmMono) -> Bool {
        a.sensitivity == b.sensitivity && a.filter == b.filter
    }
}

/// The three characteristic curves — the web's `curve: { r, g, b }`.
public struct FilmCurveSet: Equatable, Sendable {
    public var r: FilmCurve
    public var g: FilmCurve
    public var b: FilmCurve

    public init(r: FilmCurve, g: FilmCurve, b: FilmCurve) { self.r = r; self.g = g; self.b = b }
}

public struct FilmResponse: Equatable, Sendable {
    /// 0..100. How much each sensitiser also responds to its neighbours' light.
    public var coupling: Double
    /// 0..100. DIR-coupler strength: how fast an unequal exposure is pulled toward neutral.
    public var inhibition: Double
    public var curve: FilmCurveSet
    /// True for a negative printed onto paper; false for a reversal (slide) film.
    public var print: Bool
    /// 0..5, the paper's contrast grade. Read only when `print` is true.
    public var paperGrade: Double
    /// −100..100. The dye set's saturation as a whole.
    public var dye: Double
    public var mono: FilmMono?

    public init(coupling: Double, inhibition: Double, curve: FilmCurveSet, print: Bool,
                paperGrade: Double, dye: Double, mono: FilmMono?) {
        self.coupling = coupling; self.inhibition = inhibition; self.curve = curve
        self.print = print; self.paperGrade = paperGrade; self.dye = dye; self.mono = mono
    }
}

/// What a film layer stores in its `customText`: which stock it started from, and the numbers.
public struct FilmSettings: Equatable, Sendable {
    /// The stock id this response was seeded from — `Stocks.swift` says which name that is.
    public var stock: String
    public var response: FilmResponse

    public init(stock: String, response: FilmResponse) { self.stock = stock; self.response = response }
}

/// A dial's reach — shared by the emulsion's and the texture's ranges (the
/// web's `FilmRange` and `film-texture.ts`'s private `Range` are one shape).
public struct FilmRange: Equatable, Sendable {
    public var min: Double
    public var max: Double
    public var step: Double

    public init(min: Double, max: Double, step: Double) { self.min = min; self.max = max; self.step = step }
}

public let curveRanges: [FilmCurveKey: FilmRange] = [
    .speed: FilmRange(min: -3, max: 3, step: 0.05),
    .gamma: FilmRange(min: 0.3, max: 3, step: 0.05),
    .toe: FilmRange(min: 0.05, max: 3, step: 0.05),
    .shoulder: FilmRange(min: 0.05, max: 3, step: 0.05),
    .black: FilmRange(min: 1, max: 10, step: 0.1),
    .white: FilmRange(min: 0.5, max: 6, step: 0.1),
]

public struct ResponseRanges: Sendable {
    public let coupling = FilmRange(min: 0, max: 100, step: 1)
    public let inhibition = FilmRange(min: 0, max: 100, step: 1)
    public let paperGrade = FilmRange(min: 0, max: 5, step: 0.5)
    public let dye = FilmRange(min: -100, max: 100, step: 1)
}

public let responseRanges = ResponseRanges()

/// A straight, honest curve: scene contrast, a normal toe and shoulder, 6 stops
/// down, 4 up — the top knee sits far enough past display white (2.47 stops)
/// that a clean white comes back within a code or two. Not the identity: every
/// curve here has knees, and a stock that wants a crisp white takes the print
/// stage or a hard shoulder.
public let neutralCurve = FilmCurve(speed: 0, gamma: 1, toe: 0.5, shoulder: 0.5, black: 6, white: 4)

// MARK: - the maths

/// Linear reflectance of mid grey, and the stop on which every curve pivots.
public let midGrey = 0.18
private let ln2 = log(2.0)
/// Exposure floor: black is 12 stops down, never −∞.
private let blackStops = -12.0
/// Sensitiser overlap at coupling 100: onto the spectral neighbour, and across the gap.
private let couplingNear = 0.2
private let couplingFar = 0.06
/// At inhibition 100 a one-stop spread is pulled halfway to the mean.
private let inhibitionReach = 0.5

/// Softplus with sharpness `k`: ≈ max(0, v) with a rounded corner `k` stops
/// wide. Stable for any `v` — the naive form overflows past v/k ≈ 700.
private func softplus(_ v: Double, _ k: Double) -> Double {
    let t = v / k
    if t > 30 { return v }
    if t < -30 { return 0 }
    return k * log1p(exp(t))
}

/// Resolve one channel's curve into a function stops → stops, re-speeded so
/// that 0 → 0 exactly, then offset by the author's `speed`.
///
/// Shape: `y = −black + softplus(γ·x + black, toe)` bottoms out at −black;
/// `y = white − softplus(white − y, shoulder)` tops out at +white. Both are
/// monotone and C∞, so the composition never posterises. Because a soft knee
/// reaches into the midtones, the raw curve rarely passes through the origin;
/// the input shift `x0` that makes it do so is solved once, by bisection —
/// that is the film's real speed, and `speed` is the push beyond it.
public func makeCurve(_ c: FilmCurve) -> (Double) -> Double {
    let gamma = max(1e-3, c.gamma)
    let toe = max(1e-3, c.toe)
    let shoulder = max(1e-3, c.shoulder)
    let black = max(1e-3, c.black)
    let white = max(1e-3, c.white)
    let raw: (Double) -> Double = { x in
        let y1 = -black + softplus(gamma * x + black, toe)
        let y2 = white - softplus(white - y1, shoulder)
        // The shoulder's residual (k·e^(−d/k), microstops) would carry the
        // bottomed-out toe a hair below −black; the asymptotes are a promise.
        return y2 < -black ? -black : (y2 > white ? white : y2)
    }
    // raw is monotone from −black to +white; find where it crosses 0.
    var lo = -(black + 40) / gamma
    var hi = (white + 40) / gamma
    for _ in 0..<60 {
        let mid = (lo + hi) / 2
        if raw(mid) < 0 { lo = mid } else { hi = mid }
    }
    let x0 = (lo + hi) / 2 + c.speed
    return { x in raw(x + x0) }
}

/// The paper a negative is printed on: contrast from its grade (never below
/// 1.1 — a softer paper would need more exposure to reach white, which a
/// printer gives it and a look cannot), a long black, and a hard white a
/// little PAST display white (2.47 stops over mid grey) so a print's whites
/// clip cleanly — which is what restores the white a negative's own shoulder
/// rolled off.
private func paperCurve(_ grade: Double) -> (Double) -> Double {
    let gamma = 1.1 + max(0, min(5, grade)) * 0.18
    return makeCurve(FilmCurve(speed: 0, gamma: gamma, toe: 0.6, shoulder: 0.2, black: 5.5, white: 2.65))
}

/// Row-stochastic: a grey stays grey, however much the layers leak into each other.
private func couplingMatrix(_ coupling: Double) -> [[Double]] {
    let k = max(0, min(100, coupling)) / 100
    let near = k * couplingNear
    let far = k * couplingFar
    return [
        [1 - near - far, near, far],
        [near, 1 - 2 * near, near],
        [far, near, 1 - near - far],
    ]
}

/// The response with its curves resolved: build once per bake.
public struct ResolvedResponse {
    public let curveR: (Double) -> Double
    public let curveG: (Double) -> Double
    public let curveB: (Double) -> Double
    public let paper: ((Double) -> Double)?
    public let coupled: Bool
    public let matrix: [[Double]]
    public let inhibit: Double
    public let dye: Double
    /// Monochrome weights, normalised to sum to 1, or nil for a colour stock.
    public let mono: (Double, Double, Double)?
}

public func resolveResponse(_ r: FilmResponse) -> ResolvedResponse {
    var mono: (Double, Double, Double)? = nil
    if let m = r.mono {
        let w0 = max(0, m.sensitivity.0) * max(0, m.filter.0)
        let w1 = max(0, m.sensitivity.1) * max(0, m.filter.1)
        let w2 = max(0, m.sensitivity.2) * max(0, m.filter.2)
        let sum = w0 + w1 + w2
        mono = sum > 0 ? (w0 / sum, w1 / sum, w2 / sum) : (lumR, lumG, lumB)
    }
    let inhibit = (max(0, min(100, r.inhibition)) / 100) * inhibitionReach
    return ResolvedResponse(
        curveR: makeCurve(r.curve.r),
        curveG: makeCurve(r.curve.g),
        curveB: makeCurve(r.curve.b),
        paper: r.print ? paperCurve(r.paperGrade) : nil,
        coupled: r.coupling > 0,
        matrix: couplingMatrix(r.coupling),
        inhibit: inhibit,
        dye: max(-100, min(100, r.dye)) / 100,
        mono: mono
    )
}

/// One pixel through the response, STOPS in and stops out, per channel. The
/// input is the scene in stops from mid grey (already collapsed to one value
/// on every channel when the stock is monochrome). Exposed for the specs; the
/// bake goes through `filmStage`. Pass the `resolved` response to skip
/// resolving it again per pixel.
public func respondStops(_ stops: (Double, Double, Double), _ r: FilmResponse,
                         _ resolved: ResolvedResponse? = nil) -> (Double, Double, Double) {
    let resolved = resolved ?? resolveResponse(r)
    // Coupling acts on LIGHT, so it composes in linear before the log.
    var er = pow(2, stops.0)
    var eg = pow(2, stops.1)
    var eb = pow(2, stops.2)
    if resolved.coupled {
        let m = resolved.matrix
        let cr = m[0][0] * er + m[0][1] * eg + m[0][2] * eb
        let cg = m[1][0] * er + m[1][1] * eg + m[1][2] * eb
        let cb = m[2][0] * er + m[2][1] * eg + m[2][2] * eb
        er = cr
        eg = cg
        eb = cb
    }
    let xr = max(blackStops, log(er) / ln2)
    let xg = max(blackStops, log(eg) / ln2)
    let xb = max(blackStops, log(eb) / ln2)

    var yr = resolved.curveR(xr)
    var yg = resolved.curveG(xg)
    var yb = resolved.curveB(xb)

    if resolved.inhibit > 0 {
        // The more unequal the three exposures, the more inhibitor is released:
        // a neutral is untouched, a saturated primary is pulled toward the mean,
        // and the pull saturates rather than growing without bound — which is
        // the graceful rolloff a saturation slider cannot give.
        let mean = (yr + yg + yb) / 3
        let spread = max(yr, yg, yb) - min(yr, yg, yb)
        let k = resolved.inhibit * (spread / (spread + 1))
        yr += (mean - yr) * k
        yg += (mean - yg) * k
        yb += (mean - yb) * k
    }

    if let paper = resolved.paper {
        // The negative's density is the paper's exposure, inverted twice: once
        // by the negative, once by the print. Two inversions cancel, so the
        // paper reads the negative's stops directly and hands back a positive.
        yr = paper(yr)
        yg = paper(yg)
        yb = paper(yb)
    }
    return (yr, yg, yb)
}

/// The response in LINEAR light: linear in, linear out, clamped at 0 and NOT
/// above 1 — a shoulder past 2.47 stops is allowed to clip, and the caller's
/// encode does the clipping.
public func filmLinear(_ rgb: (Double, Double, Double), _ r: FilmResponse,
                       _ resolved: ResolvedResponse? = nil) -> (Double, Double, Double) {
    let resolved = resolved ?? resolveResponse(r)
    var lr = max(0, rgb.0) / midGrey
    var lg = max(0, rgb.1) / midGrey
    var lb = max(0, rgb.2) / midGrey
    if let w = resolved.mono {
        let e = w.0 * lr + w.1 * lg + w.2 * lb
        lr = e
        lg = e
        lb = e
    }
    let exposureFloor = pow(2, blackStops)
    let sr = log(max(exposureFloor, lr)) / ln2
    let sg = log(max(exposureFloor, lg)) / ln2
    let sb = log(max(exposureFloor, lb)) / ln2
    let y = respondStops((sr, sg, sb), r, resolved)
    var orr = midGrey * pow(2, y.0)
    var og = midGrey * pow(2, y.1)
    var ob = midGrey * pow(2, y.2)
    if resolved.dye != 0 {
        let Y = lumR * orr + lumG * og + lumB * ob
        let k = 1 + resolved.dye
        orr = max(0, Y + (orr - Y) * k)
        og = max(0, Y + (og - Y) * k)
        ob = max(0, Y + (ob - Y) * k)
    }
    return (orr, og, ob)
}

/// The response as a stage for the LUT bake: sRGB codes in [0,1] in, sRGB
/// codes in [0,1] out. Resolve it ONCE and call it per lattice point.
public func filmStage(_ r: FilmResponse) -> (Double, Double, Double) -> (Double, Double, Double) {
    let resolved = resolveResponse(r)
    return { cr, cg, cb in
        let linear = (toLinear(cr, .srgb), toLinear(cg, .srgb), toLinear(cb, .srgb))
        let out = filmLinear(linear, r, resolved)
        return (fromLinear(out.0, .srgb), fromLinear(out.1, .srgb), fromLinear(out.2, .srgb))
    }
}

/// The lattice a generated stock is baked on. `composeLutStack` takes the
/// largest layer's size as the composed lattice, so this is also the floor a
/// film layer imposes on the whole bake — `docs/film-simulation.md` §8 has the
/// measurement behind the number (2.16 codes worst at 33³; 49³ buys one code
/// for a 3× slower dial).
public let filmCubeSize = 33

/// The whole response as a cube, for the layer path.
public func filmCube(_ settings: FilmSettings, size: Int = filmCubeSize, title: String? = nil) -> CubeLut {
    let stage = filmStage(settings.response)
    let last = Double(size - 1)
    var data = [Float](repeating: 0, count: size * size * size * 3)
    for bi in 0..<size {
        for gi in 0..<size {
            for ri in 0..<size {
                let (r, g, b) = stage(Double(ri) / last, Double(gi) / last, Double(bi) / last)
                let o = (ri + gi * size + bi * size * size) * 3
                data[o] = Float(r)
                data[o + 1] = Float(g)
                data[o + 2] = Float(b)
            }
        }
    }
    return CubeLut(size: size, data: data, title: title ?? settings.stock)
}

// MARK: - reading

private func clampTo(_ v: JSONValue?, _ range: FilmRange, _ fallback: Double) -> Double {
    let n = v?.finiteNumber ?? fallback
    return min(range.max, max(range.min, n))
}

private func readCurve(_ raw: JSONValue?) -> FilmCurve {
    let r = raw?.objectValue ?? [:]
    var out = neutralCurve
    for k in FilmCurveKey.allCases {
        out[k] = clampTo(r[k.rawValue], curveRanges[k]!, neutralCurve[k])
    }
    return out
}

private func readTriple(_ raw: JSONValue?, _ fallback: (Double, Double, Double)) -> (Double, Double, Double) {
    guard let a = raw?.arrayValue, a.count == 3 else { return fallback }
    func channel(_ v: JSONValue, _ fb: Double) -> Double {
        guard let n = v.finiteNumber else { return fb }
        return max(0, min(4, n))
    }
    return (channel(a[0], fallback.0), channel(a[1], fallback.1), channel(a[2], fallback.2))
}

/// A response read defensively: every number clamped, junk → the neutral value.
public func normaliseResponse(_ raw: JSONValue?) -> FilmResponse {
    let r = raw?.objectValue ?? [:]
    let curve = r["curve"]?.objectValue ?? [:]
    var mono: FilmMono? = nil
    if let m = r["mono"]?.objectValue {
        mono = FilmMono(
            sensitivity: readTriple(m["sensitivity"], (lumR, lumG, lumB)),
            filter: readTriple(m["filter"], (1, 1, 1))
        )
    }
    return FilmResponse(
        coupling: clampTo(r["coupling"], responseRanges.coupling, 0),
        inhibition: clampTo(r["inhibition"], responseRanges.inhibition, 0),
        curve: FilmCurveSet(r: readCurve(curve["r"]), g: readCurve(curve["g"]), b: readCurve(curve["b"])),
        print: r["print"]?.boolValue == true,
        paperGrade: clampTo(r["paperGrade"], responseRanges.paperGrade, 2),
        dye: clampTo(r["dye"], responseRanges.dye, 0),
        mono: mono
    )
}

/// Film settings out of a layer's stored `customText`, or nil when the text
/// is not film settings at all — a layer whose numbers are gone must be
/// visibly missing, never silently neutral (`restore-grade.ts`'s rule).
public func readFilmSettings(_ text: String?) -> FilmSettings? {
    guard let text, !text.isEmpty, let raw = JSONValue.parse(text) else { return nil }
    guard let o = raw.objectValue, let stock = o["stock"]?.stringValue,
          let response = o["response"], response.objectValue != nil else { return nil }
    return FilmSettings(stock: stock, response: normaliseResponse(response))
}

// MARK: - writing

/// One number as `JSON.stringify` writes it — a whole number without `.0`,
/// NaN as `null`; the one formatter every key in this file goes through.
private func numberText(_ v: Double) -> String {
    JSONValue.number(v).serialized()
}

private func tripleText(_ t: (Double, Double, Double)) -> String {
    "[\(numberText(t.0)),\(numberText(t.1)),\(numberText(t.2))]"
}

private func curveText(_ c: FilmCurve) -> String {
    let head = "{\"speed\":\(numberText(c.speed)),\"gamma\":\(numberText(c.gamma)),\"toe\":\(numberText(c.toe))"
    let tail = ",\"shoulder\":\(numberText(c.shoulder)),\"black\":\(numberText(c.black)),\"white\":\(numberText(c.white))}"
    return head + tail
}

/// The web's `canonical()` as text: the same keys in the same order as
/// `JSON.stringify` writes them there, so two equal settings serialise equal
/// on either client.
private func canonicalText(_ s: FilmSettings) -> String {
    let r = s.response
    let mono: String
    if let m = r.mono {
        mono = "{\"sensitivity\":\(tripleText(m.sensitivity)),\"filter\":\(tripleText(m.filter))}"
    } else {
        mono = "null"
    }
    let curves = "{\"r\":\(curveText(r.curve.r)),\"g\":\(curveText(r.curve.g)),\"b\":\(curveText(r.curve.b))}"
    let head = "{\"coupling\":\(numberText(r.coupling)),\"inhibition\":\(numberText(r.inhibition)),\"curve\":\(curves)"
    let tail = ",\"print\":\(r.print ? "true" : "false"),\"paperGrade\":\(numberText(r.paperGrade)),\"dye\":\(numberText(r.dye)),\"mono\":\(mono)}"
    return "{\"stock\":\(JSONValue.string(s.stock).serialized()),\"response\":\(head + tail)}"
}

/// The settings as the layer stores them. Canonical key order, so two equal settings serialise equal.
public func writeFilmSettings(_ s: FilmSettings) -> String {
    canonicalText(s)
}

/// A stable identity for a film layer's numbers — what `gradeKey` folds in for
/// a `film` layer, because its text changes on every dial move where an
/// uploaded cube's never does.
public func filmSettingsKey(_ s: FilmSettings) -> String {
    writeFilmSettings(s)
}

/// True when two responses would bake the same cube.
public func sameResponse(_ a: FilmResponse, _ b: FilmResponse) -> Bool {
    writeFilmSettings(FilmSettings(stock: "", response: a)) == writeFilmSettings(FilmSettings(stock: "", response: b))
}

// MARK: - as JSON, for a document that carries a response as an object

extension FilmCurve {
    public var json: JSONValue {
        .object(["speed": .number(speed), "gamma": .number(gamma), "toe": .number(toe),
                 "shoulder": .number(shoulder), "black": .number(black), "white": .number(white)])
    }
}

extension FilmMono {
    public var json: JSONValue {
        .object([
            "sensitivity": .array([.number(sensitivity.0), .number(sensitivity.1), .number(sensitivity.2)]),
            "filter": .array([.number(filter.0), .number(filter.1), .number(filter.2)]),
        ])
    }
}

extension FilmResponse {
    public var json: JSONValue {
        .object([
            "coupling": .number(coupling), "inhibition": .number(inhibition),
            "curve": .object(["r": curve.r.json, "g": curve.g.json, "b": curve.b.json]),
            "print": .bool(print), "paperGrade": .number(paperGrade), "dye": .number(dye),
            "mono": mono?.json ?? .null,
        ])
    }
}

extension FilmSettings {
    public var json: JSONValue {
        .object(["stock": .string(stock), "response": response.json])
    }
}
