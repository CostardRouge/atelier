// The pointwise half of the texture — what a pixel does with the noise and
// the halo it is handed — as the CPU TWINS the web's render node's shader is
// held to (`render-film.md`: every formula in the shader is a TRANSCRIPTION of
// these, never a re-derivation). Port of `src/shared/film/film-grain.ts`.
// Also the blur kernel: the web's shader takes its weights as a uniform array
// computed HERE, so there is one kernel implementation and it is the tested
// one — the Core Image side takes its weights from `gaussianKernel` the same
// way, and is held to `blurSeparable` on the CPU.
//
// Pure. Values are linear-light-agnostic: the node applies them on the graded
// colour, in the space the graph runs in.

import Foundation

/// How much of a full-strength noise sample (±0.5) reaches the picture at amount 1 and full weight.
public let grainGain = 0.3

/// How strongly grain shows at a luminance `l` in [0,1]: zero at crushed
/// black and blown white — the tell that separates film grain from sensor
/// noise, since there are no half-developed crystals at either end — a broad
/// midtone plateau, and a peak skewed toward the lower midtones (~0.42), the
/// negative-film asymmetry. A tuning surface: specs pin the SHAPE, never the
/// exact values.
public func grainWeight(_ l: Double) -> Double {
    let x = min(1, max(0, l))
    return pow(4 * x * (1 - x), 0.75) * (1 - 0.35 * x)
}

/// A noise sample: the luma field and the three per-channel fields, each in [−0.5, 0.5].
public typealias GrainSample = (luma: Double, r: Double, g: Double, b: Double)

/// The second octave's frequency, and how much of the field it carries.
///
/// ONE tile of 256 cells repeats: at the default cell size a frame's height is
/// about two and a half tiles, which reads as structure rather than as grain.
/// A second read of the same tile at an IRRATIONAL multiple of the first
/// frequency never lines up with it, so the visible period becomes the product
/// and the repeat is gone. A tuning surface, like `grainWeight`'s shape.
public let octaveScale = 2.17
public let octaveWeight = 0.5

/// The two octaves as one sample. Normalised by `√(1 + w²)` — the two reads are
/// independent, so their VARIANCES add, and without the divide a second octave
/// would be a grain slider that also turns itself up.
public func combineOctaves(_ base: GrainSample, _ octave: GrainSample, _ weight: Double = octaveWeight) -> GrainSample {
    let norm = 1 / (1 + weight * weight).squareRoot()
    return (
        (base.luma + weight * octave.luma) * norm,
        (base.r + weight * octave.r) * norm,
        (base.g + weight * octave.g) * norm,
        (base.b + weight * octave.b) * norm
    )
}

/// Bytes of one texel of `makeGrainNoise` as a sample.
public func grainSampleFrom(_ bytes: [UInt8], _ texelIndex: Int) -> GrainSample {
    let o = texelIndex * 4
    // The alpha channel is the luma field, rgb the per-channel ones.
    return (
        Double(bytes[o + 3]) / 255 - 0.5,
        Double(bytes[o]) / 255 - 0.5,
        Double(bytes[o + 1]) / 255 - 0.5,
        Double(bytes[o + 2]) / 255 - 0.5
    )
}

/// Grain on one graded pixel. `chroma` 0 adds the same luma noise to every
/// channel; 1 adds each channel its own field. `fade` is the render's
/// `grainUniforms().fade`. Clamped to [0,1] like the framebuffer.
public func applyGrain(_ rgb: (Double, Double, Double), _ noise: GrainSample, _ amount: Double,
                       _ chroma: Double, _ fade: Double = 1) -> (Double, Double, Double) {
    let l = lumR * rgb.0 + lumG * rgb.1 + lumB * rgb.2
    let k = amount * fade * grainWeight(l) * grainGain
    if k == 0 { return rgb }
    func mix(_ channel: Double) -> Double { noise.luma + (channel - noise.luma) * chroma }
    return (
        clamp01(rgb.0 + k * mix(noise.r)),
        clamp01(rgb.1 + k * mix(noise.g)),
        clamp01(rgb.2 + k * mix(noise.b))
    )
}

/// The bleed over one pixel: `halo` is the blurred highlight energy at this
/// point (0..1), tinted and scaled, then SCREENED onto the picture — monotone,
/// never darkening, never clipping past white, and a halo of zero is the
/// identity.
///
/// The halo is three numbers, since `extractHighlight` keeps the highlight's
/// colour so a warm one bleeds warm *before* the tint; the scalar overload is
/// the same arithmetic with the three equal, for a caller holding only an energy.
public func screenHalation(_ rgb: (Double, Double, Double), _ halo: (Double, Double, Double),
                           _ tint: (Double, Double, Double), _ amount: Double) -> (Double, Double, Double) {
    let gain = min(1, max(0, amount))
    let e0 = min(1, max(0, halo.0)) * gain
    let e1 = min(1, max(0, halo.1)) * gain
    let e2 = min(1, max(0, halo.2)) * gain
    // No bleed is the identity to the last ulp: `1 − (1 − c)` is not `c`, and
    // an untouched pixel must come back untouched (`media-pipeline.md`).
    if e0 == 0 && e1 == 0 && e2 == 0 { return rgb }
    func screen(_ c: Double, _ t: Double, _ e: Double) -> Double {
        let h = min(1, max(0, e * t))
        return 1 - (1 - min(1, max(0, c))) * (1 - h)
    }
    return (screen(rgb.0, tint.0, e0), screen(rgb.1, tint.1, e1), screen(rgb.2, tint.2, e2))
}

public func screenHalation(_ rgb: (Double, Double, Double), _ halo: Double,
                           _ tint: (Double, Double, Double), _ amount: Double) -> (Double, Double, Double) {
    screenHalation(rgb, (halo, halo, halo), tint, amount)
}

/// What the extract pass keeps of a graded pixel: its luminance above the
/// threshold, renormalised to 0..1, times its colour — so a warm highlight
/// bleeds warm before the tint is applied.
public func extractHighlight(_ rgb: (Double, Double, Double), _ threshold: Double) -> (Double, Double, Double) {
    let l = lumR * rgb.0 + lumG * rgb.1 + lumB * rgb.2
    let span = max(1e-6, 1 - threshold)
    let e = min(1, max(0, (l - threshold) / span))
    return (rgb.0 * e, rgb.1 * e, rgb.2 * e)
}

/// The widest kernel the blur runs: GLSL ES needs a CONSTANT loop bound and a
/// constant array size, so the web's shader is built for this many taps and
/// skips past the ones it was not given.
///
/// It is not a guess. `halationBuffer` fixes the sigma from the radius alone,
/// and over the whole of `textureRanges[.halationRadius]` that sigma tops out
/// at 12.8 texels (radius 0.2, a 64-texel buffer) — ±3σ of which is exactly 79
/// taps. A spec pins that, so a widened radius range cannot silently truncate
/// the blur.
public let maxHalationTaps = 79

/// Taps for a sigma: ±3σ, always odd, never past the cap.
public func halationTaps(_ sigma: Double) -> Int {
    let taps = 2 * Int((3 * max(1e-6, sigma)).rounded(.up)) + 1
    return min(maxHalationTaps, taps | 1)
}

/// A normalised, symmetric Gaussian over an odd number of taps. Sums to 1, so
/// a flat field blurs to itself; the node runs it once per axis.
public func gaussianKernel(_ sigma: Double, _ taps: Int) -> [Double] {
    let n = max(1, taps | 1)
    let half = Double(n - 1) / 2
    let s = max(1e-6, sigma)
    var weights: [Double] = []
    weights.reserveCapacity(n)
    var sum = 0.0
    for i in 0..<n {
        let x = Double(i) - half
        let w = exp(-(x * x) / (2 * s * s))
        weights.append(w)
        sum += w
    }
    return weights.map { $0 / sum }
}

/// The separable blur on the CPU, over one channel of a `w × h` buffer with
/// CLAMP_TO_EDGE — the reference the web's shader is compared against, and
/// what a Core Image blur of the halo is held to. `Float` in and out, the
/// accumulation in `Double`, as the web's `Float32Array` + number arithmetic.
public func blurSeparable(_ src: [Float], _ w: Int, _ h: Int, _ kernel: [Double]) -> [Float] {
    let half = (kernel.count - 1) / 2
    var tmp = [Float](repeating: 0, count: w * h)
    var out = [Float](repeating: 0, count: w * h)
    for y in 0..<h {
        for x in 0..<w {
            var acc = 0.0
            for k in 0..<kernel.count {
                let sx = min(w - 1, max(0, x + k - half))
                acc += Double(src[y * w + sx]) * kernel[k]
            }
            tmp[y * w + x] = Float(acc)
        }
    }
    for y in 0..<h {
        for x in 0..<w {
            var acc = 0.0
            for k in 0..<kernel.count {
                let sy = min(h - 1, max(0, y + k - half))
                acc += Double(tmp[sy * w + x]) * kernel[k]
            }
            out[y * w + x] = Float(acc)
        }
    }
    return out
}
