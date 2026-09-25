// A DEVELOP: the correction of one picture, as numbers. Port of
// `src/shared/develop/develop.ts`.
//
// - `developLinear` is the maths, in linear light, unclamped above 1 so a RAW
//   developer can hand it headroom and get its highlights back.
// - `developStage` wraps it for the LUT bake: sRGB code in, sRGB code out,
//   clamped — the FIRST stage of `composeLutStack`.
//
// Every luminance move is applied as ONE ratio on the pixel's luminance, so hue
// never rotates and a grey stays grey under every slider but the two
// white-balance ones. An untouched pixel comes back bit-identical.

import Foundation

/// The rungs of the material ladder, lowest first. `proxy` is never stored — it
/// is the absence of a base.
public enum DevelopBase: String, Codable, CaseIterable, Sendable {
    case proxy, gain, gainMap, gainMapWarp

    /// How far up the ladder this rung sits; 0 for the proxy.
    public var rung: Int { DevelopBase.allCases.firstIndex(of: self) ?? 0 }

    /// What a rung is called on screen, and what it ADDS to the one below.
    public var label: String {
        switch self {
        case .proxy: return "Proxy"
        case .gain: return "Gain"
        case .gainMap: return "Gain map"
        case .gainMapWarp: return "Gain map + warp"
        }
    }
}

/// The NUMERIC fields — a key a panel can draw as a slider, in the order every
/// panel draws them.
public enum DevelopKey: String, Codable, CaseIterable, Sendable {
    case exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance

    public var label: String {
        switch self {
        case .exposure: return "Exposure"
        case .brightness: return "Brightness"
        case .contrast: return "Contrast"
        case .highlights: return "Highlights"
        case .shadows: return "Shadows"
        case .whites: return "Whites"
        case .blacks: return "Blacks"
        case .temperature: return "Temperature"
        case .tint: return "Tint"
        case .saturation: return "Saturation"
        case .vibrance: return "Vibrance"
        }
    }
}

/// A slider's bounds and step, as a panel draws them.
public struct DevelopRange: Sendable {
    public let min: Double
    public let max: Double
    public let step: Double
    /// Printed beside the number: "EV" for exposure, nothing for the rest.
    public let unit: String

    public static let stops = DevelopRange(min: -3, max: 3, step: 0.05, unit: "EV")
    public static let hundred = DevelopRange(min: -100, max: 100, step: 1, unit: "")

    public static func of(_ key: DevelopKey) -> DevelopRange {
        key == .exposure ? .stops : .hundred
    }
}

/// The gain a RAW develop may carry: 4 stops either way is every exposure a camera meters.
public let rawGainLimits = (min: 1.0 / 16, max: 16.0)

public struct DevelopSettings: Codable, Equatable, Sendable {
    public var exposure: Double = 0
    public var brightness: Double = 0
    public var contrast: Double = 0
    public var highlights: Double = 0
    public var shadows: Double = 0
    public var whites: Double = 0
    public var blacks: Double = 0
    public var temperature: Double = 0
    public var tint: Double = 0
    public var saturation: Double = 0
    public var vibrance: Double = 0
    /// The five tone curves, or nil for none. Not a slider.
    public var curves: ToneCurves? = nil
    /// Levels per channel, or nil for none.
    public var levels: Levels? = nil
    /// The MATERIAL the numbers act on; nil is the proxy. Never copied by a
    /// preset, a paste or a batch verb (`withoutBase`).
    public var base: DevelopBase? = nil
    /// With a RAW base, the picture's own exposure as MEASURED at decode. Stored
    /// rather than re-measured, because preview = export is a promise.
    public var rawGain: Double? = nil
    /// The records the web writes beside the sliders, kept as the JSON it
    /// writes — `mixer` (Lightroom's HSL), `mono` (black and white), `grading`
    /// (the wheels) and `rawWb` (a RAW's white balance in Kelvin). The first
    /// three are read and written through their typed fields (`mixer`, `mono`,
    /// `grading`, `Develop/Mixer.swift` and `Develop/Grading.swift`) and
    /// rendered by `developLinear`; `rawWb` is carried through verbatim, never
    /// dropped, and travels with the base and nowhere else (`withoutBase`).
    public var carried: [String: JSONValue] = [:]

    public init() {}

    /// The keys the web writes beside the sliders, the two shapes and the material.
    public static let carriedKeys = ["mixer", "mono", "grading", "rawWb"]
    /// The carried stages that hold PIXELS to a different answer than this port
    /// renders: a RAW's white balance in Kelvin, whose matrix `developLinear`
    /// does not apply yet. The mixer, black and white and the grading are rendered.
    public var unrenderedStages: [String] {
        carried["rawWb"] != nil ? ["rawWb"] : []
    }

    /// Every field at 0 — "as shot". The identity on every pixel.
    public static let `default` = DevelopSettings()

    public subscript(_ key: DevelopKey) -> Double {
        get {
            switch key {
            case .exposure: return exposure
            case .brightness: return brightness
            case .contrast: return contrast
            case .highlights: return highlights
            case .shadows: return shadows
            case .whites: return whites
            case .blacks: return blacks
            case .temperature: return temperature
            case .tint: return tint
            case .saturation: return saturation
            case .vibrance: return vibrance
            }
        }
        set {
            switch key {
            case .exposure: exposure = newValue
            case .brightness: brightness = newValue
            case .contrast: contrast = newValue
            case .highlights: highlights = newValue
            case .shadows: shadows = newValue
            case .whites: whites = newValue
            case .blacks: blacks = newValue
            case .temperature: temperature = newValue
            case .tint: tint = newValue
            case .saturation: saturation = newValue
            case .vibrance: vibrance = newValue
            }
        }
    }

    public init(from decoder: Decoder) throws {
        // Reading is the JSONValue path: a develop is never decoded strictly.
        let value = try JSONValue(from: decoder)
        self = normaliseDevelop(value)
    }

    public func encode(to encoder: Encoder) throws {
        try json.encode(to: encoder)
    }

    /// The record as the web's `normaliseDevelop` writes it — the sliders, the
    /// five shapes, the material — with nulls where the web writes nulls, so a
    /// document written here diffs cleanly against one the web app wrote.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        for k in DevelopKey.allCases { o[k.rawValue] = .number(self[k]) }
        o["curves"] = curves.flatMap { try? JSONEncoder().encode($0) }.flatMap { JSONValue.parse($0) } ?? .null
        o["levels"] = levels.flatMap { try? JSONEncoder().encode($0) }.flatMap { JSONValue.parse($0) } ?? .null
        o["base"] = base.map { .string($0.rawValue) } ?? .null
        o["rawGain"] = rawGain.map { .number($0) } ?? .null
        for key in DevelopSettings.carriedKeys { o[key] = carried[key] ?? .null }
        return .object(o)
    }
}

/// Yesterday's two values, read as today's four: `render` was the proxy and
/// `raw` was the sensor with its measured gain — which is `gain`.
public func normaliseBase(_ raw: JSONValue?) -> DevelopBase? {
    guard let s = raw?.stringValue else { return nil }
    if s == "raw" { return .gain }
    if s == "render" { return nil }
    guard let base = DevelopBase(rawValue: s), base != .proxy else { return nil }
    return base
}

/// This develop acts on the sensor's own data — any rung above the proxy.
public func isRawDevelop(_ d: DevelopSettings?) -> Bool {
    (d?.base?.rung ?? 0) > 0
}

/// Which rung this develop stands on.
public func developBase(_ d: DevelopSettings?) -> DevelopBase {
    if let base = d?.base, base.rung > 0 { return base }
    return .proxy
}

/// The linear gain a RAW develop applies before its sliders; 1 for a render.
public func rawGainOf(_ d: DevelopSettings?) -> Double {
    guard isRawDevelop(d), let g = d?.rawGain, g.isFinite, g > 0 else { return 1 }
    return g
}

/// The same numbers on NO particular material — what a preset, the clipboard
/// and a batch verb carry.
public func withoutBase(_ d: DevelopSettings) -> DevelopSettings {
    var out = d
    out.base = nil
    out.rawGain = nil
    out.carried["rawWb"] = nil
    return out
}

/// Nothing changes the picture. A RAW base is NOT default even with every
/// slider at 0, and neither is black and white, even as a straight mix.
public func isDefaultDevelop(_ d: DevelopSettings?) -> Bool {
    guard let d else { return true }
    return !isRawDevelop(d)
        && DevelopKey.allCases.allSatisfy { d[$0] == 0 }
        && isDefaultCurves(d.curves)
        && isDefaultLevels(d.levels)
        && isDefaultMixer(d.mixer)
        && d.mono == nil
        && isDefaultGrading(d.grading)
}

/// A copy — value semantics make it deep already; kept as the one name every
/// keeper calls, so the intent reads the same as on the web.
public func cloneDevelop(_ d: DevelopSettings?) -> DevelopSettings {
    d ?? .default
}

/// Two stored develops say the same thing — nil and an untouched set are both
/// "as shot". Shapes compare by VALUE.
public func sameDevelop(_ a: DevelopSettings?, _ b: DevelopSettings?) -> Bool {
    let x = a ?? .default
    let y = b ?? .default
    return DevelopKey.allCases.allSatisfy { x[$0] == y[$0] }
        && sameCurves(x.curves, y.curves)
        && sameLevels(x.levels, y.levels)
        && sameMixer(x.mixer, y.mixer)
        && sameMono(x.mono, y.mono)
        && sameGrading(x.grading, y.grading)
        && isRawDevelop(x) == isRawDevelop(y)
        && rawGainOf(x) == rawGainOf(y)
        && x.carried["rawWb"] == y.carried["rawWb"]
}

/// A stored develop, read back safely: every field clamped to its range, a
/// missing or non-finite one taken as 0.
public func normaliseDevelop(_ raw: JSONValue?) -> DevelopSettings {
    let src = raw?.objectValue ?? [:]
    var out = DevelopSettings.default
    for k in DevelopKey.allCases {
        guard let v = src[k.rawValue]?.finiteNumber else { continue }
        let r = DevelopRange.of(k)
        out[k] = v < r.min ? r.min : (v > r.max ? r.max : v)
    }
    out.curves = curvesOrNull(normaliseCurvesValue(src["curves"]))
    out.levels = levelsOrNull(normaliseLevelsValue(src["levels"]))
    // The colour stages, read as the web reads them: clamped, and an all-zero
    // mixer or grading as none (the setters keep them in `carried` as JSON).
    out.mixer = mixerOrNull(src["mixer"])
    out.mono = monoOrNull(src["mono"])
    out.grading = gradingOrNull(src["grading"])
    if let base = normaliseBase(src["base"]) {
        out.base = base
        if let g = src["rawGain"]?.finiteNumber, g > 0 {
            out.rawGain = min(rawGainLimits.max, max(rawGainLimits.min, g))
        } else {
            out.rawGain = nil
        }
        // Only with a base: a white balance in Kelvin is the RAW's, never a render's.
        if let wb = src["rawWb"], wb.objectValue != nil { out.carried["rawWb"] = wb }
    }
    return out
}

// `curvesOrNull` / `levelsOrNull` read a JSONValue; `normaliseDevelop` reads
// through them exactly as the web does (`curvesOrNull(normaliseCurves(src))`),
// and a normalised shape re-read is the same shape, so the two helpers below
// keep the call shape without a second encode.
private func normaliseCurvesValue(_ raw: JSONValue?) -> JSONValue? {
    guard let raw, raw != .null else { return nil }
    return raw
}

private func normaliseLevelsValue(_ raw: JSONValue?) -> JSONValue? {
    guard let raw, raw != .null else { return nil }
    return raw
}

/// A stored develop as a DOCUMENT holds it: nil for "as shot".
public func developOrNull(_ raw: JSONValue?) -> DevelopSettings? {
    guard let raw, raw != .null else { return nil }
    let d = normaliseDevelop(raw)
    return isDefaultDevelop(d) ? nil : d
}

/// A named develop kept on a document, applied by a click — never followed.
public struct DevelopPreset: Equatable, Sendable {
    public var id: String
    public var name: String
    public var settings: DevelopSettings
    /// The LOOK saved with the light, when its author ticked it — a
    /// `SavedGrade` carried as written; nil is a light alone.
    public var look: JSONValue?
    public init(id: String, name: String, settings: DevelopSettings, look: JSONValue? = nil) {
        self.id = id; self.name = name; self.settings = settings; self.look = look
    }
}

/// Presets as a document holds them, read back safely: junk entries dropped.
public func normaliseDevelopPresets(_ raw: JSONValue?) -> [DevelopPreset] {
    guard let entries = raw?.arrayValue else { return [] }
    var out: [DevelopPreset] = []
    for entry in entries {
        guard let e = entry.objectValue, let id = e["id"]?.stringValue, !id.isEmpty,
              let name = e["name"]?.stringValue else { continue }
        var look: JSONValue? = nil
        if let l = e["look"], l.objectValue != nil { look = l }
        out.append(DevelopPreset(id: id, name: name, settings: normaliseDevelop(e["settings"]), look: look))
    }
    return out
}

// MARK: - the maths

/// Rec.709 / sRGB luminance weights, in linear light.
let lumR = 0.2126
let lumG = 0.7152
let lumB = 0.0722

/// 18 % grey, where contrast pivots — in the encoded domain.
private let contrastPivot = fromLinear(0.18, .srgb)

private let highlightsReach = 0.15
private let shadowsReach = 0.15
private let whitesReach = 0.2
private let blacksReach = 0.2
/// Contrast −100..100 → slope 0.4..1.6 around the pivot.
private let contrastReach = 0.6
/// Brightness −100..100 → gamma 2 .. 1/1.5.
private let brightnessReach = 0.5
/// Temperature ±100 → the red and blue gains move ±25 % against each other.
public let temperatureReach = 0.25
/// Tint ±100 → the green gain moves ∓20 %.
public let tintReach = 0.2

/// The four band weights over an encoded luminance L in [0,1].
@inline(__always) private func bandWeights(_ L: Double) -> (hi: Double, sh: Double, wh: Double, bl: Double) {
    if L <= 0.5 {
        let u = L / 0.5
        return (0, 4 * u * (1 - u), 0, (1 - u) * (1 - u))
    }
    let u = (L - 0.5) / 0.5
    return (4 * u * (1 - u), 0, u * u, 0)
}

/// The luminance curve: encoded in, encoded out. Bands, then contrast, then
/// brightness — the order is fixed so two documents never disagree.
private func toneCurve(_ L: Double, _ d: DevelopSettings) -> Double {
    var v = L
    if d.highlights != 0 || d.shadows != 0 || d.whites != 0 || d.blacks != 0 {
        let w = bandWeights(v)
        v += (d.highlights / 100) * highlightsReach * w.hi
            + (d.shadows / 100) * shadowsReach * w.sh
            + (d.whites / 100) * whitesReach * w.wh
            + (d.blacks / 100) * blacksReach * w.bl
        v = clamp01(v)
    }
    if d.contrast != 0 {
        let slope = 1 + (d.contrast / 100) * contrastReach
        v = clamp01(contrastPivot + (v - contrastPivot) * slope)
    }
    if d.brightness != 0 {
        let gamma = 1 / (1 + (d.brightness / 100) * brightnessReach)
        v = pow(v, gamma)
    }
    return v
}

/// The curve and level maps a develop needs, resolved ONCE.
public struct DevelopShapers {
    public let luma: ((Double) -> Double)?
    public let channels: ChannelShaper?
    /// Nothing shapes — the develop pays nothing for its curves and levels.
    public static let unshaped = DevelopShapers(luma: nil, channels: nil)
}

public func makeDevelopShapers(_ d: DevelopSettings) -> DevelopShapers {
    if isDefaultCurves(d.curves) && isDefaultLevels(d.levels) { return .unshaped }
    return DevelopShapers(luma: makeLumaShaper(d.curves), channels: makeChannelShaper(d.curves, d.levels))
}

/// One channel through the per-channel map. Where the map leaves the value
/// alone the linear value is handed back UNTOUCHED, so headroom survives and an
/// unshaped pixel is bit-identical.
@inline(__always) private func shapeChannel(_ lin: Double, _ channel: Int, _ shape: ChannelShaper) -> Double {
    let encoded = fromLinear(lin > 1 ? 1 : lin, .srgb)
    let out = shape(encoded, channel)
    return out == encoded ? lin : toLinear(out, .srgb)
}

/// Develop one pixel in LINEAR light. Input ≥ 0, may exceed 1; output ≥ 0 and
/// NOT clamped. The identity when every field is 0.
///
/// Order: white balance → exposure → the luminance curve as one ratio → the
/// luma curve → levels and the per-channel curves → saturation and vibrance →
/// black and white, else the colour mixer → colour grading
/// (`applyColourStages`, `Develop/DevelopColour.swift`).
///
/// `shapers` and `stages` are resolved ONCE by a loop (`developStage` does);
/// omitting them resolves them per pixel, which is only right for a one-off call.
public func developLinear(_ rgb: (Double, Double, Double), _ d: DevelopSettings, _ shapers: DevelopShapers? = nil,
                          _ stages: ColourStages? = nil) -> (Double, Double, Double) {
    let shapers = shapers ?? makeDevelopShapers(d)
    var r = rgb.0 < 0 ? 0 : rgb.0
    var g = rgb.1 < 0 ? 0 : rgb.1
    var b = rgb.2 < 0 ? 0 : rgb.2

    if d.temperature != 0 {
        let t = (d.temperature / 100) * temperatureReach
        r *= 1 + t
        b *= 1 - t
    }
    if d.tint != 0 {
        g *= 1 - (d.tint / 100) * tintReach
    }
    if d.exposure != 0 {
        let gain = pow(2, d.exposure)
        r *= gain
        g *= gain
        b *= gain
    }

    let Y = lumR * r + lumG * g + lumB * b
    if Y > 0 && (d.highlights != 0 || d.shadows != 0 || d.whites != 0 || d.blacks != 0 || d.contrast != 0 || d.brightness != 0) {
        let Yc = Y > 1 ? 1 : Y
        let L = fromLinear(Yc, .srgb)
        let Lout = toneCurve(L, d)
        if Lout != L {
            let ratio = toLinear(Lout, .srgb) / Yc
            r *= ratio
            g *= ratio
            b *= ratio
        }
    }

    if let luma = shapers.luma {
        let Yl = lumR * r + lumG * g + lumB * b
        if Yl > 0 {
            let Yc = Yl > 1 ? 1 : Yl
            let L = fromLinear(Yc, .srgb)
            let Lout = luma(L)
            if Lout != L {
                let ratio = toLinear(Lout, .srgb) / Yc
                r *= ratio
                g *= ratio
                b *= ratio
            }
        }
    }

    if let channels = shapers.channels {
        r = shapeChannel(r, 0, channels)
        g = shapeChannel(g, 1, channels)
        b = shapeChannel(b, 2, channels)
    }

    if d.saturation != 0 || d.vibrance != 0 {
        let Y2 = lumR * r + lumG * g + lumB * b
        var amount = d.saturation / 100
        if d.vibrance != 0 {
            let mx = max(r, g, b)
            let mn = min(r, g, b)
            let sat = mx > 0 ? (mx - mn) / mx : 0
            amount += (d.vibrance / 100) * (1 - sat)
        }
        if amount != 0 {
            let k = 1 + amount
            r = Y2 + (r - Y2) * k
            g = Y2 + (g - Y2) * k
            b = Y2 + (b - Y2) * k
            if r < 0 { r = 0 }
            if g < 0 { g = 0 }
            if b < 0 { b = 0 }
        }
    }

    // The colour stages last, as in Lightroom: a band is picked on the colour
    // the pixel HAS once every global move is made.
    return applyColourStages((r, g, b), stages ?? makeColourStages(d))
}

/// The develop as a stage for the LUT bake: sRGB codes in [0,1] in, sRGB codes
/// in [0,1] out. Resolve ONCE and call per lattice point. The identity when the
/// develop is default.
public func developStage(_ d: DevelopSettings) -> (Double, Double, Double) -> (Double, Double, Double) {
    if isDefaultDevelop(d) { return { r, g, b in (r, g, b) } }
    let shapers = makeDevelopShapers(d)
    let stages = makeColourStages(d)
    let gain = rawGainOf(d)
    return { r, g, b in
        let out = developLinear((toLinear(r, .srgb) * gain, toLinear(g, .srgb) * gain, toLinear(b, .srgb) * gain), d, shapers, stages)
        return (fromLinear(out.0, .srgb), fromLinear(out.1, .srgb), fromLinear(out.2, .srgb))
    }
}

// MARK: - words

private func label(_ k: DevelopKey) -> String {
    switch k {
    case .exposure: return ""
    default: return k.rawValue
    }
}

/// `+0.7`, `−40` — a typographic minus, the way the suite prints numbers.
public func signed(_ n: Double, digits: Int = 0) -> String {
    let abs = String(format: "%.\(digits)f", Swift.abs(n))
    if Double(abs) == 0 { return "0" }
    return n < 0 ? "−\(abs)" : "+\(abs)"
}

/// What this develop says, ONE FACT PER ENTRY: `As shot` alone, or the non-zero
/// fields in slider order.
public func developLines(_ d: DevelopSettings?) -> [String] {
    guard let d, !isDefaultDevelop(d) else { return ["As shot"] }
    var parts: [String] = []
    if isRawDevelop(d) {
        let ev = log2(rawGainOf(d))
        let rung = developBase(d)
        let adds = rung == .gainMapWarp ? " + gain map + warp" : (rung == .gainMap ? " + gain map" : "")
        parts.append("RAW\(adds)\(ev != 0 ? " \(signed(ev, digits: 1)) EV metered" : "")")
        if let wb = d.carried["rawWb"]?.objectValue, let kelvin = wb["kelvin"]?.finiteNumber {
            let tint = Int((wb["tint"]?.finiteNumber ?? 0).rounded())
            parts.append("\(Int(kelvin.rounded())) K\(tint != 0 ? ", tint \(signed(Double(tint)))" : "")")
        }
    }
    for k in DevelopKey.allCases {
        let v = d[k]
        if v == 0 { continue }
        if k == .exposure {
            var s = signed(v, digits: 2)
            // Trailing zeros go, and a trailing dot with them: `+0.70` → `+0.7`.
            if s.contains(".") {
                while s.hasSuffix("0") { s.removeLast() }
                if s.hasSuffix(".") { s.removeLast() }
            }
            parts.append("\(s) EV")
        } else {
            parts.append("\(label(k)) \(signed(v))")
        }
    }
    let levels = describeLevels(d.levels)
    if !levels.isEmpty { parts.append(levels) }
    let curves = describeCurves(d.curves)
    if !curves.isEmpty { parts.append(curves) }
    parts += colourStageLines(d)
    return parts
}

/// The same facts as ONE line, for a settled row.
public func describeDevelop(_ d: DevelopSettings?) -> String {
    developLines(d).joined(separator: " · ")
}
