// The COLOUR MIXER — Lightroom's HSL panel — and BLACK AND WHITE with its
// channel mixer. Port of `src/shared/develop/mixer.ts`.
//
// A stage of the develop, LAST, after saturation and vibrance (Lightroom's
// order): `developLinear` ends on it through `applyColourStages`
// (`DevelopColour.swift`), so it bakes into the one cube with every other number.
//
// Three rules shape it:
//
// - The bands are a PARTITION OF UNITY: a pixel's weights over the eight bands
//   sum to 1 — a raised cosine between two neighbouring centres — so moving
//   every band by the same amount moves every colour by that amount, and no
//   hue falls between two bands into a hole.
// - A GREY STAYS GREY. Each move is weighted by how coloured the pixel is
//   (`chromaWeight`), zero at no colour: a hue has no meaning on a grey.
// - A HUE SHIFT KEEPS THE LIGHT: the shifted pixel is scaled back to the
//   luminance it had, so the hue slider does not double as a luminance one.
//
// Hue and colourfulness are read on the ENCODED values, the moves are made in
// linear light, and a value above white is read on its colour, scaled into
// range, and scaled back.
//
// `DevelopSettings` reads the two records as typed fields through the
// extension at the end of this file, decoding from / encoding into
// `carried["mixer"]` / `carried["mono"]`, so the JSON round trip through
// `Develop.swift` is untouched.
//
// The web's `bandWeights` is `mixerBandWeights` here: `Develop.swift` keeps a
// private `bandWeights` for the tone bands, and one more at module scope would
// make its own call ambiguous.

import Foundation

/// The eight bands, in their order — where each peaks, in degrees of sRGB hue:
/// Lightroom's eight, unevenly spaced as the eye is.
public enum MixerBand: String, Codable, CaseIterable, Sendable {
    case red, orange, yellow, green, aqua, blue, purple, magenta

    /// The web's `BAND_CENTRES`.
    public var centre: Double {
        switch self {
        case .red: return 0
        case .orange: return 30
        case .yellow: return 60
        case .green: return 120
        case .aqua: return 180
        case .blue: return 225
        case .purple: return 270
        case .magenta: return 315
        }
    }

    /// The web's `bandLabel`.
    public var label: String {
        switch self {
        case .red: return "Red"
        case .orange: return "Orange"
        case .yellow: return "Yellow"
        case .green: return "Green"
        case .aqua: return "Aqua"
        case .blue: return "Blue"
        case .purple: return "Purple"
        case .magenta: return "Magenta"
        }
    }

    /// Position in `MIXER_BANDS` order.
    public var index: Int { MixerBand.allCases.firstIndex(of: self) ?? 0 }
}

public enum MixerChannel: String, Codable, CaseIterable, Sendable {
    case hue, saturation, luminance
}

/// Each channel: one value per band, −100..100, in `MixerBand.allCases` order.
public struct ColourMixer: Equatable, Sendable {
    public var hue: [Double]
    public var saturation: [Double]
    public var luminance: [Double]

    public init(hue: [Double], saturation: [Double], luminance: [Double]) {
        self.hue = hue; self.saturation = saturation; self.luminance = luminance
    }

    public subscript(_ channel: MixerChannel) -> [Double] {
        get {
            switch channel {
            case .hue: return hue
            case .saturation: return saturation
            case .luminance: return luminance
            }
        }
        set {
            switch channel {
            case .hue: hue = newValue
            case .saturation: saturation = newValue
            case .luminance: luminance = newValue
            }
        }
    }
}

/// Hue ±100 → a shift of ±30°, half-way to the next band — never past it.
public let hueReach = 30.0
/// Luminance ±100 → ±1.5 stops on a fully coloured pixel: a blue sky at −100 goes to a deep one, not to black.
public let luminanceReach = 1.5

private let zeros8 = [Double](repeating: 0, count: 8)

/// A band's value read safely: a hand-built mixer may hold fewer than eight.
@inline(__always) private func at(_ list: [Double], _ i: Int) -> Double {
    i < list.count ? list[i] : 0
}

/// Every band at 0.
public func emptyMixer() -> ColourMixer {
    ColourMixer(hue: zeros8, saturation: zeros8, luminance: zeros8)
}

public func isDefaultMixer(_ m: ColourMixer?) -> Bool {
    guard let m else { return true }
    return MixerChannel.allCases.allSatisfy { m[$0].allSatisfy { $0 == 0 } }
}

/// A copy — value semantics make it one already; kept as the web's name.
public func cloneMixer(_ m: ColourMixer?) -> ColourMixer? {
    m
}

public func sameMixer(_ a: ColourMixer?, _ b: ColourMixer?) -> Bool {
    if isDefaultMixer(a) || isDefaultMixer(b) { return isDefaultMixer(a) && isDefaultMixer(b) }
    guard let a, let b else { return false }
    return MixerChannel.allCases.allSatisfy { c in
        let x = a[c]
        let y = b[c]
        return x.indices.allSatisfy { at(x, $0) == at(y, $0) }
    }
}

/// A stored mixer, read back safely — eight finite numbers per channel,
/// clamped, a missing one taken as 0 — or nil for none. What a document and a
/// stranger's file both go through.
public func mixerOrNull(_ raw: JSONValue?) -> ColourMixer? {
    guard let src = raw?.objectValue else { return nil }
    var out = emptyMixer()
    for c in MixerChannel.allCases {
        guard let list = src[c.rawValue]?.arrayValue else { continue }
        var values = zeros8
        for i in 0..<8 {
            guard i < list.count, let v = list[i].finiteNumber else { continue }
            values[i] = clamp(v, -100, 100)
        }
        out[c] = values
    }
    return isDefaultMixer(out) ? nil : out
}

/// `mixer` with one value set; nil when that leaves nothing.
public func withMixerValue(_ m: ColourMixer?, _ channel: MixerChannel, _ band: MixerBand, _ value: Double) -> ColourMixer? {
    var next = m ?? emptyMixer()
    var values = next[channel]
    while values.count < 8 { values.append(0) }
    values[band.index] = value
    next[channel] = values
    return isDefaultMixer(next) ? nil : next
}

/// `mixer` with one channel's eight values back at 0; nil when that leaves nothing.
public func withoutMixerChannel(_ m: ColourMixer?, _ channel: MixerChannel) -> ColourMixer? {
    var next = m ?? emptyMixer()
    next[channel] = zeros8
    return isDefaultMixer(next) ? nil : next
}

/// Each band's weight at `hue` (degrees, any turn): a raised cosine between
/// the two centres the hue sits between, so the eight sum to exactly 1.
public func mixerBandWeights(_ hue: Double) -> [Double] {
    let h = (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    let centres = MixerBand.allCases.map(\.centre)
    var out = zeros8
    for i in 0..<8 {
        let from = centres[i]
        let to = i == 7 ? 360 : centres[i + 1]
        if h >= from && h < to {
            let t = (h - from) / (to - from)
            let w = 0.5 + 0.5 * cos(Double.pi * t)
            out[i] = w
            out[(i + 1) % 8] = 1 - w
            return out
        }
    }
    out[0] = 1
    return out
}

/// How much of a move a pixel takes, from its HSV saturation on the encoded
/// values: 0 for a grey, rising to 1 by half saturation — skin and a hazy sky
/// are well coloured without being pure, and a mixer that barely reached them
/// would be a mixer for primaries only.
public func chromaWeight(_ s: Double) -> Double {
    s <= 0 ? 0 : (s >= 0.5 ? 1 : s / 0.5)
}

/// Hue in degrees and HSV saturation of an ENCODED pixel in [0,1].
public func hueSat(_ r: Double, _ g: Double, _ b: Double) -> (hue: Double, sat: Double) {
    let mx = max(r, g, b)
    let mn = min(r, g, b)
    let d = mx - mn
    if mx <= 0 || d <= 0 { return (0, 0) }
    let h: Double
    if mx == r {
        h = ((g - b) / d).truncatingRemainder(dividingBy: 6)
    } else if mx == g {
        h = (b - r) / d + 2
    } else {
        h = (r - g) / d + 4
    }
    return ((h * 60 + 360).truncatingRemainder(dividingBy: 360), d / mx)
}

/// An encoded pixel with its hue turned by `degrees`, value and saturation kept (HSV).
private func rotateHue(_ r: Double, _ g: Double, _ b: Double, _ degrees: Double) -> (Double, Double, Double) {
    let mx = max(r, g, b)
    let mn = min(r, g, b)
    let hue = hueSat(r, g, b).hue
    let h = ((hue + degrees).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    let c = mx - mn
    let x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
    let seg = Int(floor(h / 60)) % 6
    let r1: Double, g1: Double, b1: Double
    switch seg {
    case 0: (r1, g1, b1) = (c, x, 0)
    case 1: (r1, g1, b1) = (x, c, 0)
    case 2: (r1, g1, b1) = (0, c, x)
    case 3: (r1, g1, b1) = (0, x, c)
    case 4: (r1, g1, b1) = (x, 0, c)
    default: (r1, g1, b1) = (c, 0, x)
    }
    return (r1 + mn, g1 + mn, b1 + mn)
}

/// One pixel in LINEAR light through the mixer; the very same values when the
/// pixel is grey or the bands it sits in are at 0.
public func mixLinear(_ rgb: (Double, Double, Double), _ m: ColourMixer) -> (Double, Double, Double) {
    var r = rgb.0
    var g = rgb.1
    var b = rgb.2
    // A value above white is read on its COLOUR: scaled into range, mixed, and
    // scaled back, so a RAW's headroom keeps its hue and its brightness.
    let top = max(r, g, b)
    let scale = top > 1 ? top : 1
    let er = fromLinear(r / scale, .srgb)
    let eg = fromLinear(g / scale, .srgb)
    let eb = fromLinear(b / scale, .srgb)
    let hs = hueSat(er, eg, eb)
    let reach = chromaWeight(hs.sat)
    if reach <= 0 { return (r, g, b) }
    let w = mixerBandWeights(hs.hue)
    var dh = 0.0
    var ds = 0.0
    var dl = 0.0
    for i in 0..<8 where w[i] != 0 {
        dh += w[i] * at(m.hue, i)
        ds += w[i] * at(m.saturation, i)
        dl += w[i] * at(m.luminance, i)
    }
    if dh == 0 && ds == 0 && dl == 0 { return (r, g, b) }

    let Y0 = lumR * r + lumG * g + lumB * b
    if dh != 0 {
        let turned = rotateHue(er, eg, eb, (dh / 100) * hueReach * reach)
        r = toLinear(turned.0, .srgb) * scale
        g = toLinear(turned.1, .srgb) * scale
        b = toLinear(turned.2, .srgb) * scale
        // The light it had: rotating toward yellow brightens, toward blue darkens.
        let Y1 = lumR * r + lumG * g + lumB * b
        if Y1 > 0 {
            let k = Y0 / Y1
            r *= k
            g *= k
            b *= k
        }
    }
    if ds != 0 {
        let k = 1 + (ds / 100) * reach
        r = Y0 + (r - Y0) * k
        g = Y0 + (g - Y0) * k
        b = Y0 + (b - Y0) * k
        if r < 0 { r = 0 }
        if g < 0 { g = 0 }
        if b < 0 { b = 0 }
    }
    if dl != 0 {
        let gain = pow(2, (dl / 100) * luminanceReach * reach)
        r *= gain
        g *= gain
        b *= gain
    }
    return (r, g, b)
}

public func bandLabel(_ band: MixerBand) -> String {
    band.label
}

/// "mixer hue+lum" — the channels it touches, as `describeCurves` names a shape.
public func describeMixer(_ m: ColourMixer?) -> String? {
    if isDefaultMixer(m) { return nil }
    guard let m else { return nil }
    let short: [MixerChannel: String] = [.hue: "hue", .saturation: "sat", .luminance: "lum"]
    let used = MixerChannel.allCases.filter { c in m[c].contains { $0 != 0 } }.map { short[$0]! }
    return "mixer \(used.joined(separator: "+"))"
}

// MARK: - black and white

/// BLACK AND WHITE with a channel mixer — Lightroom's B&W treatment, whose
/// mixer is the colour mixer's eight bands turned into eight LIGHTS: how bright
/// each colour becomes in grey.
///
/// `mono` on a develop IS the treatment: nil is colour, a `MonoMix` is black
/// and white, even with every band at 0 (a straight luminance conversion).
/// While it is on, the colour mixer is kept but not applied — Lightroom's own
/// behaviour, so switching back finds the colour work where it was.
public struct MonoMix: Equatable, Sendable {
    /// One per band in `MixerBand.allCases` order, −100..100: that colour's light in grey.
    public var mix: [Double]
    public init(mix: [Double]) { self.mix = mix }
}

/// A band at ±100 moves its colour ±1.5 stops in grey — a red filter's worth.
public let monoReach = 1.5

public func straightMono() -> MonoMix {
    MonoMix(mix: zeros8)
}

/// A stored treatment, read back safely: nil for colour, a mix of eight
/// clamped numbers otherwise. As on the web, ANY object — a list included,
/// which JavaScript calls an object — reads as a treatment: junk in `mix` is
/// a straight conversion, never colour.
public func monoOrNull(_ raw: JSONValue?) -> MonoMix? {
    guard let raw, raw.objectValue != nil || raw.arrayValue != nil else { return nil }
    var out = straightMono()
    if let list = raw.objectValue?["mix"]?.arrayValue {
        for i in 0..<8 {
            guard i < list.count, let v = list[i].finiteNumber else { continue }
            out.mix[i] = clamp(v, -100, 100)
        }
    }
    return out
}

public func cloneMono(_ m: MonoMix?) -> MonoMix? {
    m
}

public func sameMono(_ a: MonoMix?, _ b: MonoMix?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    return a.mix.indices.allSatisfy { at(a.mix, $0) == at(b.mix, $0) }
}

/// `mono` with one band's light set.
public func withMonoValue(_ m: MonoMix?, _ band: MixerBand, _ value: Double) -> MonoMix {
    var next = m ?? straightMono()
    while next.mix.count < 8 { next.mix.append(0) }
    next.mix[band.index] = value
    return next
}

/// One pixel in LINEAR light to grey: its luminance, times the light of the
/// bands its hue sits in — weighted by how coloured it is, so a grey is its
/// own luminance whatever the mix says, and a value above white is read on
/// its colour like the mixer's.
public func monoLinear(_ rgb: (Double, Double, Double), _ m: MonoMix) -> (Double, Double, Double) {
    let r = rgb.0
    let g = rgb.1
    let b = rgb.2
    let Y = lumR * r + lumG * g + lumB * b
    let top = max(r, g, b)
    let scale = top > 1 ? top : 1
    let hs = hueSat(fromLinear(r / scale, .srgb), fromLinear(g / scale, .srgb), fromLinear(b / scale, .srgb))
    let reach = chromaWeight(hs.sat)
    var stops = 0.0
    if reach > 0 {
        let w = mixerBandWeights(hs.hue)
        for i in 0..<8 where w[i] != 0 { stops += w[i] * at(m.mix, i) }
    }
    let out = stops != 0 ? Y * pow(2, (stops / 100) * monoReach * reach) : Y
    return (out, out, out)
}

/// "B&W" or "B&W mix" — the treatment, and whether its mixer was touched.
public func describeMono(_ m: MonoMix?) -> String? {
    guard let m else { return nil }
    return m.mix.contains { $0 != 0 } ? "B&W mix" : "B&W"
}

// MARK: - as a document holds them

extension ColourMixer {
    /// The record as the web writes it: three lists of eight.
    public var json: JSONValue {
        .object([
            "hue": .array(hue.map { .number($0) }),
            "saturation": .array(saturation.map { .number($0) }),
            "luminance": .array(luminance.map { .number($0) }),
        ])
    }
}

extension MonoMix {
    public var json: JSONValue {
        .object(["mix": .array(mix.map { .number($0) })])
    }
}

extension DevelopSettings {
    /// The colour mixer, read from the carried record the way the web's
    /// `normaliseDevelop` reads it (`mixerOrNull`) and written back as the
    /// web writes it — nil, and so a null in the JSON, when every band is 0.
    public var mixer: ColourMixer? {
        get { mixerOrNull(carried["mixer"]) }
        set { carried["mixer"] = newValue.flatMap { isDefaultMixer($0) ? nil : $0.json } }
    }

    /// The black-and-white treatment: nil is colour, a straight mix is NOT
    /// as shot and is kept as such.
    public var mono: MonoMix? {
        get { monoOrNull(carried["mono"]) }
        set { carried["mono"] = newValue?.json }
    }
}
