// PRESENCE — texture, clarity and dehaze: Lightroom's three sliders that
// change how a picture READS without changing its tones one by one. Port of
// the pure half of `src/shared/render/presence.ts` (the parameter model and
// the maths); its GLSL is the app's, as Core Image kernels held to these
// functions.
//
// All three are the same machine at three scales: a wide, smooth estimate of
// something (a luma, or a haze) and the pixel moved against it.
// - Dehaze reads the haze as the DARK CHANNEL — the smallest of R, G and B in
//   LINEAR light, blurred wide — and inverts the veil `I = J·t + A·(1 − t)` in
//   linear light, with a white airlight and a floor on `t`. Negative ADDS a
//   veil. Measured on the encoded values instead, a clear dark field read as
//   a veil and went from 80 to 43 at +80.
// - Clarity is local contrast at a LARGE scale, weighted to the midtones.
// - Texture is the same at a SMALL scale, unweighted. Negative smooths.
// Clarity and texture move the LUMA and carry RGB as one ratio, soft-limited
// so a strong edge cannot wear a halo.
//
// Rules kept: scales are FRACTIONS of the picture's short side, never pixels
// (a preview is the export shrunk, not a different filter); a wide Gaussian
// is walked in at most `presenceTaps` steps a side, spaced past one pixel and
// read BILINEARLY — the GPU's own filtering, mirrored by `sampleBilinear`.
// Order: after every warp and layer, before the sharpen — dehaze, clarity,
// texture (`detailPassPlan`).

import Foundation

/// The furthest tap a side a presence blur walks — a GPU loop needs a constant bound.
public let presenceTaps = 24

/// How much a full slider does.
public let dehazeStrength = 0.8
/// The transmission never falls under this, or a white sky would go black.
public let dehazeFloor = 0.2
/// A veil added at −100.
public let hazeAdded = 0.6
/// Clarity and texture at +100 add 1.5× the local detail; at −100 take 1× of it away.
public let contrastGain = (up: 1.5, down: 1.0)
/// How hard a large difference is limited: texture lives in small differences
/// (a few hundredths), a halo in the large ones at a hard edge. At 4 a block
/// against a sky wore a visible glow at clarity +100; at 10 a 0.02 detail
/// keeps 83 % of itself and a 0.1 edge half.
public let softLimit = 10.0

/// The three operations, in the order they run.
public enum PresenceOp: String, CaseIterable, Sendable {
    case dehaze, clarity, texture

    /// Each blur's sigma as a share of the picture's short side — the web's `PRESENCE_SCALE`.
    public var scale: Double {
        switch self {
        case .dehaze: return 0.03
        case .clarity: return 0.012
        case .texture: return 0.002
        }
    }
}

/// What a blur estimates: the luma (clarity, texture) or the dark channel (dehaze).
public enum PresenceSignal: Sendable {
    case luma, dark
}

/// The blur a scale asks for on a picture of this size: its sigma, the spacing
/// of its taps, and how many a side.
public struct BlurGeometry: Equatable, Sendable {
    public var sigma: Double
    public var step: Double
    public var taps: Int

    public init(sigma: Double, step: Double, taps: Int) {
        self.sigma = sigma
        self.step = step
        self.taps = taps
    }
}

public func blurGeometry(_ frac: Double, _ width: Int, _ height: Int) -> BlurGeometry {
    let sigma = max(0.8, frac * Double(min(width, height)))
    let step = max(1, (3 * sigma) / Double(presenceTaps))
    let taps = min(presenceTaps, Int(((3 * sigma) / step).rounded(.up)))
    return BlurGeometry(sigma: sigma, step: step, taps: taps)
}

/// A pixel read between pixel centres, clamped at the edges — `texture()` with
/// LINEAR and CLAMP_TO_EDGE.
public func sampleBilinear(_ img: DetailImage, _ x: Double, _ y: Double) -> (Double, Double, Double) {
    let w = img.width
    let h = img.height
    let cx = x < 0 ? 0 : (x > Double(w - 1) ? Double(w - 1) : x)
    let cy = y < 0 ? 0 : (y > Double(h - 1) ? Double(h - 1) : y)
    let x0 = Int(cx.rounded(.down))
    let y0 = Int(cy.rounded(.down))
    let x1 = min(w - 1, x0 + 1)
    let y1 = min(h - 1, y0 + 1)
    let fx = cx - Double(x0)
    let fy = cy - Double(y0)
    let i00 = (y0 * w + x0) * 3
    let i10 = (y0 * w + x1) * 3
    let i01 = (y1 * w + x0) * 3
    let i11 = (y1 * w + x1) * 3
    func channel(_ c: Int) -> Double {
        let top = Double(img.data[i00 + c]) * (1 - fx) + Double(img.data[i10 + c]) * fx
        let bottom = Double(img.data[i01 + c]) * (1 - fx) + Double(img.data[i11 + c]) * fx
        return top * (1 - fy) + bottom * fy
    }
    return (channel(0), channel(1), channel(2))
}

/// The same read on a one-channel plane.
@inline(__always)
private func planeBilinear(_ plane: UnsafeBufferPointer<Float>, _ width: Int, _ height: Int, _ x: Double, _ y: Double) -> Double {
    let cx = x < 0 ? 0 : (x > Double(width - 1) ? Double(width - 1) : x)
    let cy = y < 0 ? 0 : (y > Double(height - 1) ? Double(height - 1) : y)
    let x0 = Int(cx.rounded(.down))
    let y0 = Int(cy.rounded(.down))
    let x1 = min(width - 1, x0 + 1)
    let y1 = min(height - 1, y0 + 1)
    let fx = cx - Double(x0)
    let fy = cy - Double(y0)
    let top = Double(plane[y0 * width + x0]) * (1 - fx) + Double(plane[y0 * width + x1]) * fx
    let bottom = Double(plane[y1 * width + x0]) * (1 - fx) + Double(plane[y1 * width + x1]) * fx
    return top * (1 - fy) + bottom * fy
}

@inline(__always)
private func signalOf(_ signal: PresenceSignal, _ r: Double, _ g: Double, _ b: Double) -> Double {
    if signal == .luma { return lumaOf(r, g, b) }
    // The dark channel in LINEAR light: haze is light ADDED, and in the encoded
    // values a clear midtone's darkest channel already reads as a veil.
    return min(toLinear(r, .srgb), toLinear(g, .srgb), toLinear(b, .srgb))
}

/// The wide estimate, whole — the H pass over the picture (reading the signal
/// of each bilinear sample), then the V pass over that. What the pair of GPU
/// passes computes, the H pass carrying its result in the alpha channel.
public func presenceBlur(_ img: DetailImage, _ frac: Double, _ signal: PresenceSignal) -> [Float] {
    let width = img.width
    let height = img.height
    let geometry = blurGeometry(frac, width, height)
    let sigma = geometry.sigma
    let step = geometry.step
    let taps = geometry.taps
    var weights: [Double] = []
    weights.reserveCapacity(2 * taps + 1)
    for k in -taps...taps {
        let d = Double(k) * step
        weights.append(exp(-(d * d) / (2 * sigma * sigma)))
    }
    let sum = weights.reduce(0, +)
    var h = [Float](repeating: 0, count: width * height)
    h.withUnsafeMutableBufferPointer { hb in
        for y in 0..<height {
            for x in 0..<width {
                var acc = 0.0
                for k in -taps...taps {
                    let (r, g, b) = sampleBilinear(img, Double(x) + Double(k) * step, Double(y))
                    acc += weights[k + taps] * signalOf(signal, r, g, b)
                }
                hb[y * width + x] = Float(acc / sum)
            }
        }
    }
    var v = [Float](repeating: 0, count: width * height)
    h.withUnsafeBufferPointer { hb in
        v.withUnsafeMutableBufferPointer { vb in
            for y in 0..<height {
                for x in 0..<width {
                    var acc = 0.0
                    for k in -taps...taps {
                        acc += weights[k + taps] * planeBilinear(hb, width, height, Double(x), Double(y) + Double(k) * step)
                    }
                    vb[y * width + x] = Float(acc / sum)
                }
            }
        }
    }
    return v
}

/// One ENCODED pixel with the haze taken out (amount > 0) or put in (< 0);
/// `veil` is the blurred dark channel, in linear light. The veil model is
/// inverted in LINEAR light, where it is true — the pixel is decoded, moved
/// and encoded again, so a clear dark field is left nearly alone.
public func dehazeAt(_ r: Double, _ g: Double, _ b: Double, veil: Double, amount: Double) -> (Double, Double, Double) {
    let t = amount > 0 ? max(dehazeFloor, 1 - dehazeStrength * amount * veil) : 1 + hazeAdded * amount
    func f(_ c: Double) -> Double {
        if amount > 0 {
            return fromLinear(max(0, (toLinear(c, .srgb) - 1) / t + 1), .srgb)
        }
        return fromLinear(toLinear(c, .srgb) * t + (1 - t), .srgb)
    }
    return (f(r), f(g), f(b))
}

/// The detail a local-contrast move is made of, soft-limited so a hard edge cannot ring.
@inline(__always)
public func softDetail(_ d: Double) -> Double {
    d / (1 + softLimit * abs(d))
}

/// One pixel's luma moved against its blurred surroundings — clarity (the
/// midtones only, `midtones`) or texture — and RGB carried as one ratio.
public func localContrastAt(_ r: Double, _ g: Double, _ b: Double, blurred: Double, amount: Double, midtones: Bool) -> (Double, Double, Double) {
    let Y = lumaOf(r, g, b)
    let gain = amount * (amount > 0 ? contrastGain.up : contrastGain.down)
    let bell = midtones ? max(0, min(1, 4 * Y * (1 - Y))) : 1
    let out = max(0, Y + gain * softDetail(Y - blurred) * bell)
    return scaleToLuma(r, g, b, Y, out)
}

/// The three sliders as amounts −1..1; 0 means no pass.
public struct PresenceAmounts: Equatable, Sendable {
    public var dehaze: Double
    public var clarity: Double
    public var texture: Double

    public init(dehaze: Double = 0, clarity: Double = 0, texture: Double = 0) {
        self.dehaze = dehaze
        self.clarity = clarity
        self.texture = texture
    }

    public subscript(_ op: PresenceOp) -> Double {
        switch op {
        case .dehaze: return dehaze
        case .clarity: return clarity
        case .texture: return texture
        }
    }
}

/// The whole chain on a picture — dehaze, clarity, texture — for a spec and a gate.
public func applyPresence(_ img: DetailImage, _ amounts: PresenceAmounts) -> DetailImage {
    var cur = img
    func step(_ op: PresenceOp, _ signal: PresenceSignal, _ pixel: ((Double, Double, Double), Double) -> (Double, Double, Double)) {
        let blurred = presenceBlur(cur, op.scale, signal)
        let count = cur.width * cur.height
        var out = [Float](repeating: 0, count: cur.data.count)
        cur.data.withUnsafeBufferPointer { src in
            out.withUnsafeMutableBufferPointer { dst in
                for i in 0..<count {
                    let rgb = (Double(src[i * 3]), Double(src[i * 3 + 1]), Double(src[i * 3 + 2]))
                    let px = pixel(rgb, Double(blurred[i]))
                    dst[i * 3] = Float(px.0)
                    dst[i * 3 + 1] = Float(px.1)
                    dst[i * 3 + 2] = Float(px.2)
                }
            }
        }
        cur = DetailImage(width: cur.width, height: cur.height, data: out)
    }
    if amounts.dehaze != 0 {
        step(.dehaze, .dark) { rgb, v in dehazeAt(rgb.0, rgb.1, rgb.2, veil: v, amount: amounts.dehaze) }
    }
    if amounts.clarity != 0 {
        step(.clarity, .luma) { rgb, v in localContrastAt(rgb.0, rgb.1, rgb.2, blurred: v, amount: amounts.clarity, midtones: true) }
    }
    if amounts.texture != 0 {
        step(.texture, .luma) { rgb, v in localContrastAt(rgb.0, rgb.1, rgb.2, blurred: v, amount: amounts.texture, midtones: false) }
    }
    return cur
}
