// OUTPUT SHARPENING — the last touch on a delivered file, after it has been
// resized for its target: Lightroom's *Sharpen for Screen*. Port of
// `src/shared/develop/output-sharpen.ts` (audit item 28,
// `docs/memory/develop-output.md`).
//
// A downscale is a low-pass filter; the edges a 36-megapixel picture had at
// its own size come out soft at 2048 px. The picture's own sharpen is judged
// at the picture's density and cannot know the size a target will ask, so
// this is a separate, small step applied to the file alone: a 3×3 binomial
// unsharp mask on LUMA — the difference added to the three channels alike, so
// an edge gains contrast and no colour fringe — with a soft threshold that
// leaves a flat sky's last code of noise alone. Three strengths; none has a
// radius to set, because the radius that suits a screen is one output pixel
// whatever the target.
//
// The renderer reads the picture in BANDS of rows (`sharpenRows`, one row
// either side of what it writes), so a large file never needs a second
// full-size buffer — and a band gives the same bytes as the whole picture at
// once, which the spec holds. `OutputSharpen` itself lives in `Roll.swift`.

import Foundation

/// How much of the difference is added back, per level — the web's `OUTPUT_SHARPEN_AMOUNT`.
public let outputSharpenAmount: [OutputSharpen: Double] = [
    .off: 0,
    .low: 0.4,
    .standard: 0.8,
    .high: 1.3,
]

extension OutputSharpen {
    /// How much of the difference this level adds back.
    public var amount: Double { outputSharpenAmount[self] ?? 0 }
}

/// Below this difference, in 8-bit codes, the gain fades out: noise is not detail.
public let outputSharpenThreshold = 2.0

/// The rows a band is processed in: small enough that a 60 MP file never holds a second copy of itself.
public let sharpenBandRows = 256

private func luma(_ d: [UInt8], _ i: Int) -> Double {
    let r = Double(d[i])
    let g = Double(d[i + 1])
    let b = Double(d[i + 2])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// A `Uint8ClampedArray` store: clamped to 0…255, a half rounded to EVEN, NaN to 0.
private func clampedByte(_ v: Double) -> UInt8 {
    if v.isNaN || v <= 0 { return 0 }
    if v >= 255 { return 255 }
    return UInt8(v.rounded(.toNearestOrEven))
}

/// Rows `[from, to)` of an RGBA buffer `w` wide and `h` tall, sharpened, as a
/// new buffer of `(to − from) × w × 4` bytes. Neighbours outside the buffer are
/// its edge repeated, so a band read with one row either side of what it
/// writes gives the same pixels as the whole picture done at once. Alpha is
/// copied. `src` must hold at least `w × h × 4` bytes.
public func sharpenRows(_ src: [UInt8], width w: Int, height h: Int, from: Int, to: Int, amount: Double) -> [UInt8] {
    precondition(src.count >= w * h * 4, "sharpenRows: the buffer is smaller than w × h × 4")
    precondition(from >= 0 && to <= h, "sharpenRows: the band is outside the picture")
    if to <= from { return [] }
    let rowBytes = w * 4
    if amount <= 0 {
        return Array(src[(from * rowBytes)..<(to * rowBytes)])
    }
    var out = [UInt8](repeating: 0, count: (to - from) * rowBytes)
    // Luma of the three rows the kernel reads, reused as the band walks down —
    // a `Float32Array` on the web, so a stored luma rounds the same here.
    func rowLuma(_ y: Int) -> [Float] {
        let yy = y < 0 ? 0 : (y >= h ? h - 1 : y)
        var row = [Float](repeating: 0, count: w)
        for x in 0..<w { row[x] = Float(luma(src, (yy * w + x) * 4)) }
        return row
    }
    var above = rowLuma(from - 1)
    var here = rowLuma(from)
    for y in from..<to {
        let below = rowLuma(y + 1)
        for x in 0..<w {
            let l = x > 0 ? x - 1 : 0
            let r = x < w - 1 ? x + 1 : w - 1
            // The binomial [1 2 1] ⊗ [1 2 1] / 16 — sigma ≈ 0.85 px.
            let top = Double(above[l]) + 2 * Double(above[x]) + Double(above[r])
            let mid = Double(here[l]) + 2 * Double(here[x]) + Double(here[r])
            let bottom = Double(below[l]) + 2 * Double(below[x]) + Double(below[r])
            let blur = (top + 2 * mid + bottom) / 16
            let diff = Double(here[x]) - blur
            let mag = abs(diff)
            let gain = (amount * mag) / (mag + outputSharpenThreshold)
            let add = diff * gain
            let i = (y * w + x) * 4
            let o = ((y - from) * w + x) * 4
            out[o] = clampedByte(Double(src[i]) + add)
            out[o + 1] = clampedByte(Double(src[i + 1]) + add)
            out[o + 2] = clampedByte(Double(src[i + 2]) + add)
            out[o + 3] = src[i + 3]
        }
        above = here
        here = below
    }
    return out
}
