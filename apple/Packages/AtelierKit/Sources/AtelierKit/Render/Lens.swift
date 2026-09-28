// LENS CORRECTION — the barrel a wide lens bends into straight walls, the
// colour fringes it leaves at the corners, and the light it loses there.
// Port of `src/shared/render/lens.ts`.
//
// All three are RADIAL, so one record and one pass carry the lot. The model
// is Brown–Conrady's, written CORRECTED-to-SOURCE (a warp walks the output):
//
//     r_source = r · (1 + k1·r² + k2·r⁴)
//
// The rules it keeps:
// - the radius is normalised to HALF THE DIAGONAL (r = 1 at the corner);
// - the reaches are bounded by MONOTONICITY, not taste — both sliders at −100
//   must leave `f'(r) = 1 + 3k1r² + 5k2r⁴` positive at the corner, or the
//   map folds the picture over (0.18 / 0.06 give +0.16; a spec walks it);
// - GREEN never moves: a fringe is red and blue landing at the wrong size;
// - the vignette gain is applied to LIGHT (decode, multiply, encode), never
//   to the code, and its reach is handed to the kernel through
//   `vignetteTerms` rather than written twice;
// - NO coefficient is invented: a profile is MEASURED data (`LensProfileTerms`,
//   from Lensfun), applied under the sliders in the same pass.

import Foundation

public struct LensCorrection: Equatable, Sendable {
    /// −100..100. The k1 term: below 0 undoes BARREL, above 0 undoes PINCUSHION.
    public var distortion: Double
    /// −100..100. The k2 term, which is what a moustache curve needs.
    public var distortion2: Double
    /// −100..100 each. Lateral chromatic aberration: red and blue scaled against green.
    public var chromaRed: Double
    public var chromaBlue: Double
    /// −100..100. Above 0 lifts the corners, which is how vignetting is removed.
    public var vignette: Double
    /// 0..100. How far out the lift starts to bite; higher keeps the centre clear.
    public var vignetteMidpoint: Double

    public init(distortion: Double = 0, distortion2: Double = 0, chromaRed: Double = 0, chromaBlue: Double = 0,
                vignette: Double = 0, vignetteMidpoint: Double = 50) {
        self.distortion = distortion; self.distortion2 = distortion2
        self.chromaRed = chromaRed; self.chromaBlue = chromaBlue
        self.vignette = vignette; self.vignetteMidpoint = vignetteMidpoint
    }

    /// The web's `DEFAULT_LENS`.
    public static let `default` = LensCorrection()
}

/// ±100 moves a corner by this fraction of the half-diagonal — the pair chosen
/// so the radius map CANNOT FOLD inside the frame (see the header).
private let distortionReach = 0.18
private let distortion2Reach = 0.06
/// ±100 scales a channel by this much against green.
private let chromaReach = 0.01
/// ±100 changes a corner's brightness by this much.
private let vignetteReach = 0.8

/// Whether a correction does nothing — a midpoint alone is not one. (`Roll.swift`
/// keeps a twin over the carried `JSONValue`; this is the typed record's.)
public func isDefaultLens(_ l: LensCorrection?) -> Bool {
    guard let l else { return true }
    return l.distortion == 0 && l.distortion2 == 0 && l.chromaRed == 0 && l.chromaBlue == 0 && l.vignette == 0
}

private func number(_ v: JSONValue?, _ fallback: Double) -> Double {
    v?.finiteNumber ?? fallback
}

public func normaliseLens(_ raw: JSONValue?) -> LensCorrection {
    let src = raw?.objectValue ?? [:]
    return LensCorrection(
        distortion: clamp(number(src["distortion"], 0), -100, 100),
        distortion2: clamp(number(src["distortion2"], 0), -100, 100),
        chromaRed: clamp(number(src["chromaRed"], 0), -100, 100),
        chromaBlue: clamp(number(src["chromaBlue"], 0), -100, 100),
        vignette: clamp(number(src["vignette"], 0), -100, 100),
        vignetteMidpoint: clamp(number(src["vignetteMidpoint"], 50), 0, 100)
    )
}

public func lensOrNull(_ raw: JSONValue?) -> LensCorrection? {
    guard let raw, !raw.isNull else { return nil }
    let l = normaliseLens(raw)
    return isDefaultLens(l) ? nil : l
}

public func sameLens(_ a: LensCorrection?, _ b: LensCorrection?) -> Bool {
    (a ?? .default) == (b ?? .default)
}

/// The two polynomial coefficients as the kernel wants them.
public func distortionTerms(_ l: LensCorrection) -> (k1: Double, k2: Double) {
    ((l.distortion / 100) * distortionReach, (l.distortion2 / 100) * distortion2Reach)
}

/// Where a corrected point at radius `r` came from, in the same units. The
/// centre is a fixed point by construction — `r = 0` gives 0 whatever the
/// coefficients — which is what makes the correction pivot on the middle.
@inline(__always) public func lensSampleRadius(_ r: Double, _ k1: Double, _ k2: Double) -> Double {
    let r2 = r * r
    return r * (1 + k1 * r2 + k2 * r2 * r2)
}

/// The per-channel scale for lateral chromatic aberration. Green is the
/// reference and never moves.
public func chromaScales(_ l: LensCorrection) -> (red: Double, blue: Double) {
    (1 + (l.chromaRed / 100) * chromaReach, 1 + (l.chromaBlue / 100) * chromaReach)
}

/// The LIGHT a pixel at radius `r` is multiplied by — a gain on the decoded
/// value, never on the code (`vignetteEncoded`). 1 at the centre always.
public func vignetteGain(_ r: Double, _ amount: Double, _ midpoint: Double) -> Double {
    if amount == 0 || amount.isNaN { return 1 }
    let terms = vignetteTerms(LensCorrection(vignette: amount, vignetteMidpoint: midpoint))
    let start = terms.start
    if r <= start { return 1 }
    let span = 1 - start
    // Squared, so the lift comes on gently rather than with a visible ring at
    // the point it starts.
    let t: Double
    if span > 0 {
        let x = (r - start) / span
        t = x * x
    } else {
        t = 0
    }
    return 1 + terms.amount * t
}

/// What an sRGB-ENCODED value becomes once the gain at radius `r` is applied
/// to its LIGHT — the only place a vignette correction is right. Clamped at
/// white, as the web's 8-bit gate compares it.
public func vignetteEncoded(_ encoded: Double, _ r: Double, _ amount: Double, _ midpoint: Double) -> Double {
    let gain = vignetteGain(r, amount, midpoint)
    if gain == 1 { return encoded }
    return fromLinear(toLinear(encoded, .srgb) * gain, .srgb)
}

/// The same two numbers the kernel wants, so `vignetteReach` is stated ONCE
/// and the GPU cannot drift from `vignetteGain`.
public func vignetteTerms(_ l: LensCorrection) -> (amount: Double, start: Double) {
    ((clamp(l.vignette, -100, 100) / 100) * vignetteReach, clamp(l.vignetteMidpoint, 0, 100) / 100)
}

// MARK: - a MEASURED profile (Lensfun, the web's `shared/lens/lensfun.ts`)

/// A lens profile in THIS module's units — r = 1 at the corner of the
/// picture — composed after the manual sliders:
///
///     m   = lensSampleRadius(r)                          the manual map
///     r_s = m · (1 + d1·m + d2·m² + d3·m³ + d4·m⁴)       distortion
///     r_c = r_s · (v + c·r_s + b·r_s²)                   red and blue, TCA
///     light = observed / (1 + k1·r_s² + k2·r_s⁴ + k3·r_s⁶)   vignetting, at r_s
///
/// Odd distortion terms on purpose (Lensfun's `ptlens` has them); vignetting
/// read at the SOURCE radius, before any geometry.
public struct LensProfileTerms: Equatable, Sendable {
    /// Four terms, `d1…d4`.
    public var distortion: [Double]
    /// Three terms each, `[v, c, b]`.
    public var tcaRed: [Double]
    public var tcaBlue: [Double]
    /// Three terms, `k1…k3`.
    public var vignette: [Double]

    public init(distortion: [Double], tcaRed: [Double], tcaBlue: [Double], vignette: [Double]) {
        self.distortion = distortion; self.tcaRed = tcaRed; self.tcaBlue = tcaBlue; self.vignette = vignette
    }
}

/// The web's `NO_PROFILE_TERMS`.
public let noProfileTerms = LensProfileTerms(distortion: [0, 0, 0, 0], tcaRed: [1, 0, 0], tcaBlue: [1, 0, 0], vignette: [0, 0, 0])

public func isIdentityProfile(_ p: LensProfileTerms?) -> Bool {
    guard let p else { return true }
    let noDistortion = p.distortion.allSatisfy { $0 == 0 }
    let redStill = p.tcaRed.count >= 3 && p.tcaRed[0] == 1 && p.tcaRed[1] == 0 && p.tcaRed[2] == 0
    let blueStill = p.tcaBlue.count >= 3 && p.tcaBlue[0] == 1 && p.tcaBlue[1] == 0 && p.tcaBlue[2] == 0
    let noVignette = p.vignette.allSatisfy { $0 == 0 }
    return noDistortion && redStill && blueStill && noVignette
}

public func sameProfileTerms(_ a: LensProfileTerms?, _ b: LensProfileTerms?) -> Bool {
    if isIdentityProfile(a) || isIdentityProfile(b) { return isIdentityProfile(a) && isIdentityProfile(b) }
    return a == b
}

/// The profile's source radius for a manual-mapped radius `m` — Horner's form, the kernel's own.
@inline(__always) public func profileSourceRadius(_ m: Double, _ d: [Double]) -> Double {
    m * (1 + m * (d[0] + m * (d[1] + m * (d[2] + m * d[3]))))
}

/// One channel's radius against green's source radius `rs` — `[v, c, b]`.
@inline(__always) public func profileChannelRadius(_ rs: Double, _ t: [Double]) -> Double {
    rs * (t[0] + rs * (t[1] + rs * t[2]))
}

/// The gain on LIGHT that undoes the measured vignetting at source radius `rs`.
@inline(__always) public func profileVignetteGain(_ rs: Double, _ k: [Double]) -> Double {
    let r2 = rs * rs
    return 1 / (1 + r2 * (k[0] + r2 * (k[1] + r2 * k[2])))
}

/// A number as JavaScript prints it: no `.0` on a whole one.
private func plain(_ n: Double) -> String {
    if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
    return "\(n)"
}

/// `barrel −40 · CA red +12 · vignette +30`, or an empty string when it does nothing.
public func describeLens(_ l: LensCorrection?) -> String {
    guard let l, !isDefaultLens(l) else { return "" }
    func signed(_ n: Double) -> String { "\(n > 0 ? "+" : "−")\(plain(abs(n)))" }
    var parts: [String] = []
    if l.distortion != 0 { parts.append("\(l.distortion < 0 ? "barrel" : "pincushion") \(signed(l.distortion))") }
    if l.distortion2 != 0 { parts.append("k2 \(signed(l.distortion2))") }
    if l.chromaRed != 0 { parts.append("CA red \(signed(l.chromaRed))") }
    if l.chromaBlue != 0 { parts.append("CA blue \(signed(l.chromaBlue))") }
    if l.vignette != 0 { parts.append("vignette \(signed(l.vignette))") }
    return parts.joined(separator: " · ")
}
