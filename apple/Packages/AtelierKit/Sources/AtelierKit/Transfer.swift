// Transfer functions — the curve between a stored code value and actual light.
//
// Port of `src/shared/lut/transfer.ts`. Rec.709's reference display is BT.1886
// (gamma 2.4, a dark suite); a phone or a browser behaves like sRGB (~2.2).
// Every conversion LUT the suite ships emits 2.4-encoded values, and the
// optional output transform is what closes that gap — a per-channel 1-D curve
// change, no matrix, because Rec.709 and sRGB share primaries and white.

import Foundation

/// A named curve between code values and linear light.
public enum TransferFn: String, Codable, Sendable, CaseIterable {
    case gamma22 = "gamma-2.2"
    case gamma24 = "gamma-2.4"
    case srgb = "srgb"
}

/// A conversion the user can pick, as a (from, to) pair of curves.
public enum OutputTransform: String, Codable, Sendable, CaseIterable {
    case none = "none"
    case rec709ToSrgb = "rec709-to-srgb"
    case rec709_24To22 = "rec709-24-to-22"
    case srgbToRec709 = "srgb-to-rec709"

    /// Short label, also used to name the transform in a composed LUT's title.
    public var label: String {
        switch self {
        case .none: return "None"
        case .rec709ToSrgb: return "Rec.709 2.4 → sRGB"
        case .rec709_24To22: return "Rec.709 2.4 → 2.2"
        case .srgbToRec709: return "sRGB → Rec.709 2.4"
        }
    }

    /// One line of "why would I pick this", in the user's terms.
    public var hint: String {
        switch self {
        case .none: return "The look exactly as the LUT authored it."
        case .rec709ToSrgb: return "Web, phones, laptops — restores the contrast a browser eats."
        case .rec709_24To22: return "Same idea, pure power curve, without the sRGB toe."
        case .srgbToRec709: return "The inverse — for a calibrated TV or a dark room."
        }
    }

    /// The (from, to) curves this transform stands for; nil for `none`.
    public var pair: (from: TransferFn, to: TransferFn)? {
        switch self {
        case .rec709ToSrgb: return (.gamma24, .srgb)
        case .rec709_24To22: return (.gamma24, .gamma22)
        case .srgbToRec709: return (.srgb, .gamma24)
        case .none: return nil
        }
    }
}

/// sRGB's toe/power join, as the standard writes it on the encoded side. The
/// linear knee is DERIVED from the encoded one (`0.04045 / 12.92`) rather than
/// hard-coded to the published `0.0031308`, so the pair is exactly invertible —
/// which matters because a LUT bake composes them thousands of times.
private let srgbKneeEncoded = 0.04045
private let srgbSlope = 12.92
private let srgbKneeLinear = srgbKneeEncoded / srgbSlope

@inline(__always) private func decode(_ x: Double, _ fn: TransferFn) -> Double {
    switch fn {
    case .gamma22: return pow(x, 2.2)
    case .gamma24: return pow(x, 2.4)
    case .srgb: return x <= srgbKneeEncoded ? x / srgbSlope : pow((x + 0.055) / 1.055, 2.4)
    }
}

@inline(__always) private func encode(_ x: Double, _ fn: TransferFn) -> Double {
    switch fn {
    case .gamma22: return pow(x, 1 / 2.2)
    case .gamma24: return pow(x, 1 / 2.4)
    case .srgb: return x <= srgbKneeLinear ? x * srgbSlope : 1.055 * pow(x, 1 / 2.4) - 0.055
    }
}

/// Code value → linear light, per channel. Clamps its input: a value outside
/// [0,1] must never reach `pow` and come back NaN.
public func toLinear(_ v: Double, _ fn: TransferFn) -> Double {
    decode(clamp01(v), fn)
}

/// Linear light → code value, per channel. The inverse of `toLinear`.
public func fromLinear(_ v: Double, _ fn: TransferFn) -> Double {
    encode(clamp01(v), fn)
}

/// Resolve a transform ONCE into a per-channel function — the thing to hold
/// inside a loop. Every endpoint is a fixed point (0 → 0, 1 → 1).
public func makeTransfer(_ t: OutputTransform) -> (Double) -> Double {
    guard let pair = t.pair else { return { $0 } }
    let from = pair.from
    let to = pair.to
    return { v in clamp01(encode(decode(clamp01(v), from), to)) }
}

/// Re-encode one channel from its source curve to its destination curve; the
/// identity for `none`. For a single value only — in a loop use `makeTransfer`.
public func applyTransfer(_ v: Double, _ t: OutputTransform) -> Double {
    guard let pair = t.pair else { return v }
    return clamp01(fromLinear(toLinear(v, pair.from), pair.to))
}
