// COLOUR GRADING — Lightroom's wheels: a colour and a luminance for the
// shadows, the midtones and the highlights, one more for the whole picture,
// and the two numbers that say where the three ranges meet (Balance) and how
// much they overlap (Blending). Port of `src/shared/develop/grading.ts`.
//
// A stage of the develop, after the colour mixer (Lightroom's order): the
// last of `developLinear`, through `applyColourStages` (`DevelopColour.swift`).
//
// Rules:
//
// - The three ranges are a PARTITION OF UNITY over the pixel's encoded luma:
//   shadows fall from black to a pivot, highlights rise from the pivot to
//   white, the midtones are what is left, peaking AT the pivot. Balance moves
//   the pivot (positive gives the highlights more of the range), Blending
//   bends the two ramps (0 keeps each range near its end, 100 lets it reach
//   far into its neighbour).
// - A TINT IS A GAIN WHOSE LUMINANCE IS 1, pulled toward the wheel's hue by
//   its saturation, and the pixel is then brought back to the luminance it
//   had — so a wheel colours and never brightens, and only the luminance
//   slider under it moves the light. Black stays black.
// - HUE IS DEGREES of the colour wheel — 0 red, 120 green, 240 blue — stored
//   even when the saturation is 0, so turning the saturation back up finds
//   the colour where it was left.
//
// `wheelPoint` / `pointOnWheel` are the geometry the wheels draw and read.
// The web's `TINT_REACH` is `gradeTintReach` here: `Develop.swift` already
// owns `tintReach`, the tint SLIDER's, a different number.

import Foundation

public enum GradeZone: String, Codable, CaseIterable, Sendable {
    case shadows, midtones, highlights, global

    /// The web's `zoneLabel`.
    public var label: String {
        rawValue.prefix(1).uppercased() + rawValue.dropFirst()
    }
}

public struct GradeWheel: Equatable, Sendable {
    /// 0..360 degrees.
    public var hue: Double
    /// 0..100.
    public var saturation: Double
    /// −100..100.
    public var luminance: Double

    public init(hue: Double = 0, saturation: Double = 0, luminance: Double = 0) {
        self.hue = hue; self.saturation = saturation; self.luminance = luminance
    }

    public static let neutral = GradeWheel()

    /// Without colour and without light. The hue alone shapes nothing.
    public var isNeutral: Bool { saturation == 0 && luminance == 0 }
}

public struct ColourGrading: Equatable, Sendable {
    public var shadows: GradeWheel
    public var midtones: GradeWheel
    public var highlights: GradeWheel
    public var global: GradeWheel
    /// 0..100, 50 by default: how far each range reaches into its neighbour.
    public var blending: Double
    /// −100..100: where shadows end and highlights begin. Positive favours the highlights.
    public var balance: Double

    public init(shadows: GradeWheel = .neutral, midtones: GradeWheel = .neutral, highlights: GradeWheel = .neutral,
                global: GradeWheel = .neutral, blending: Double = 50, balance: Double = 0) {
        self.shadows = shadows; self.midtones = midtones; self.highlights = highlights; self.global = global
        self.blending = blending; self.balance = balance
    }

    public subscript(_ zone: GradeZone) -> GradeWheel {
        get {
            switch zone {
            case .shadows: return shadows
            case .midtones: return midtones
            case .highlights: return highlights
            case .global: return global
            }
        }
        set {
            switch zone {
            case .shadows: shadows = newValue
            case .midtones: midtones = newValue
            case .highlights: highlights = newValue
            case .global: global = newValue
            }
        }
    }
}

/// The two numbers that shape the ranges without colouring anything.
public enum GradeShape: String, Sendable {
    case blending, balance
}

/// How far a full saturation pulls a channel's gain toward the hue — a strong tint, not a colour fill.
public let gradeTintReach = 0.25
/// A luminance slider at ±100 is ±1 stop, on a pixel wholly inside its range.
public let zoneStops = 1.0
/// The pivot moves at most this far from 0.5 at a full Balance.
public let balanceReach = 0.25

public func neutralGrading() -> ColourGrading {
    ColourGrading()
}

/// Nothing moves: every wheel without colour and without light. Blending and balance alone shape nothing.
public func isDefaultGrading(_ g: ColourGrading?) -> Bool {
    guard let g else { return true }
    return GradeZone.allCases.allSatisfy { g[$0].isNeutral }
}

public func cloneGrading(_ g: ColourGrading?) -> ColourGrading? {
    g
}

public func sameGrading(_ a: ColourGrading?, _ b: ColourGrading?) -> Bool {
    if isDefaultGrading(a) || isDefaultGrading(b) { return isDefaultGrading(a) && isDefaultGrading(b) }
    guard let a, let b else { return false }
    return a == b
}

private func clampNum(_ v: JSONValue?, _ lo: Double, _ hi: Double, _ fallback: Double) -> Double {
    guard let n = v?.finiteNumber else { return fallback }
    return clamp(n, lo, hi)
}

/// A stored grading, read back safely, or nil for none — what a document and a stranger's file both go through.
public func gradingOrNull(_ raw: JSONValue?) -> ColourGrading? {
    guard let src = raw?.objectValue else { return nil }
    var out = neutralGrading()
    for z in GradeZone.allCases {
        let w = src[z.rawValue]?.objectValue ?? [:]
        let hue = w["hue"]?.finiteNumber ?? 0
        out[z] = GradeWheel(
            hue: (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360),
            saturation: clampNum(w["saturation"], 0, 100, 0),
            luminance: clampNum(w["luminance"], -100, 100, 0)
        )
    }
    out.blending = clampNum(src["blending"], 0, 100, 50)
    out.balance = clampNum(src["balance"], -100, 100, 0)
    return isDefaultGrading(out) ? nil : out
}

/// `g` with one wheel replaced; nil when that leaves nothing — the "empty means none" rule.
public func withWheel(_ g: ColourGrading?, _ zone: GradeZone, _ wheel: GradeWheel) -> ColourGrading? {
    var next = g ?? neutralGrading()
    next[zone] = wheel
    return isDefaultGrading(next) ? nil : next
}

/// `g` with Blending or Balance set — kept even while no wheel moves, so the panel does not jump back.
public func withShape(_ g: ColourGrading?, _ key: GradeShape, _ value: Double) -> ColourGrading {
    var next = g ?? neutralGrading()
    switch key {
    case .blending: next.blending = value
    case .balance: next.balance = value
    }
    return next
}

/// The weights of shadows, midtones and highlights at an encoded luma — they
/// sum to 1. The pivot is where the midtones peak.
public func zoneWeights(_ L: Double, blending: Double = 50, balance: Double = 0) -> (shadows: Double, midtones: Double, highlights: Double) {
    let l = clamp01(L)
    let pivot = 0.5 - (balance / 100) * balanceReach
    // Blending 50 → straight ramps; 100 → the square root, reaching far; 0 → the square, staying near the end.
    let gamma = pow(2, (50 - blending) / 50)
    let shadows = l < pivot ? pow((pivot - l) / pivot, gamma) : 0
    let highlights = l > pivot ? pow((l - pivot) / (1 - pivot), gamma) : 0
    return (shadows, 1 - shadows - highlights, highlights)
}

/// The wheel's hue as a per-channel gain in LINEAR light whose luminance is exactly 1.
public func hueGain(_ hue: Double) -> (Double, Double, Double) {
    let h = ((hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)) / 60
    let x = 1 - abs(h.truncatingRemainder(dividingBy: 2) - 1)
    let seg = Int(floor(h)) % 6
    let r: Double, g: Double, b: Double
    switch seg {
    case 0: (r, g, b) = (1, x, 0)
    case 1: (r, g, b) = (x, 1, 0)
    case 2: (r, g, b) = (0, 1, x)
    case 3: (r, g, b) = (0, x, 1)
    case 4: (r, g, b) = (x, 0, 1)
    default: (r, g, b) = (1, 0, x)
    }
    let lr = toLinear(r, .srgb)
    let lg = toLinear(g, .srgb)
    let lb = toLinear(b, .srgb)
    let y = lumR * lr + lumG * lg + lumB * lb
    return (lr / y, lg / y, lb / y)
}

/// One pixel in LINEAR light through the grading; the very same values when
/// nothing is set. Every wheel's weight is taken at the pixel's luma as it
/// ENTERS the stage, so a wheel's own luminance cannot move a pixel into
/// another range half-way.
public func gradeLinear(_ rgb: (Double, Double, Double), _ g: ColourGrading) -> (Double, Double, Double) {
    var r = rgb.0
    var gg = rgb.1
    var b = rgb.2
    let Y0 = lumR * r + lumG * gg + lumB * b
    if Y0 <= 0 { return (r, gg, b) }
    let L = fromLinear(Y0 > 1 ? 1 : Y0, .srgb)
    let w = zoneWeights(L, blending: g.blending, balance: g.balance)
    var stops = 0.0
    var moved = false
    for zone in GradeZone.allCases {
        let wheel = g[zone]
        let k: Double
        switch zone {
        case .shadows: k = w.shadows
        case .midtones: k = w.midtones
        case .highlights: k = w.highlights
        case .global: k = 1
        }
        if k == 0 || wheel.isNeutral { continue }
        moved = true
        stops += (wheel.luminance / 100) * zoneStops * k
        if wheel.saturation != 0 {
            let t = (wheel.saturation / 100) * gradeTintReach * k
            let gain = hueGain(wheel.hue)
            r *= 1 + t * (gain.0 - 1)
            gg *= 1 + t * (gain.1 - 1)
            b *= 1 + t * (gain.2 - 1)
        }
    }
    if !moved { return (r, gg, b) }
    // Back to the light it had, then the light the sliders ask for.
    let Y1 = lumR * r + lumG * gg + lumB * b
    let k = Y1 > 0 ? (Y0 / Y1) * pow(2, stops) : 1
    return (r * k, gg * k, b * k)
}

// MARK: - the wheel's geometry

/// A point on a wheel of radius 1 (x right, y DOWN — screen space) as a hue
/// and a saturation: 0° at the right, turning clockwise on screen, the
/// saturation the distance from the centre, clamped to the rim. Both are
/// whole numbers, as the wheel stores them.
public func wheelPoint(_ x: Double, _ y: Double) -> (hue: Double, saturation: Double) {
    let d = hypot(x, y)
    let hue = d > 0 ? ((atan2(y, x) * 180) / Double.pi + 360).truncatingRemainder(dividingBy: 360) : 0
    return (hue.rounded(.toNearestOrAwayFromZero), (min(1, d) * 100).rounded(.toNearestOrAwayFromZero))
}

/// Where a hue and saturation sit on that wheel — the inverse of `wheelPoint`.
public func pointOnWheel(_ hue: Double, _ saturation: Double) -> Point {
    let a = (hue * Double.pi) / 180
    let d = clamp(saturation, 0, 100) / 100
    return Point(cos(a) * d, sin(a) * d)
}

public func zoneLabel(_ zone: GradeZone) -> String {
    zone.label
}

/// "grading shadows+highlights" — the ranges it touches, as `describeMixer` names its channels.
public func describeGrading(_ g: ColourGrading?) -> String? {
    if isDefaultGrading(g) { return nil }
    guard let g else { return nil }
    let used = GradeZone.allCases.filter { !g[$0].isNeutral }.map(\.rawValue)
    return "grading \(used.joined(separator: "+"))"
}

// MARK: - as a document holds it

extension GradeWheel {
    public var json: JSONValue {
        .object(["hue": .number(hue), "saturation": .number(saturation), "luminance": .number(luminance)])
    }
}

extension ColourGrading {
    public var json: JSONValue {
        .object([
            "shadows": shadows.json, "midtones": midtones.json, "highlights": highlights.json, "global": global.json,
            "blending": .number(blending), "balance": .number(balance),
        ])
    }
}

extension DevelopSettings {
    /// The grading, read from the carried record the way the web's
    /// `normaliseDevelop` reads it (`gradingOrNull`) and written back as the
    /// web writes it — nil, and so a null in the JSON, while no wheel moves:
    /// a Blending or Balance with no colour does not survive the record, as it
    /// does not survive a reload on the web; a panel holds such a draft itself.
    public var grading: ColourGrading? {
        get { gradingOrNull(carried["grading"]) }
        set { carried["grading"] = newValue.flatMap { isDefaultGrading($0) ? nil : $0.json } }
    }
}
