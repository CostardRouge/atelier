// Baking a LUT onto a small sample image for a picker tile — the maths only.
// Port of `src/shared/lut/lut-preview.ts`.
//
// Baking is CPU, never GPU: a plain per-pixel `sampleWith` loop over a 96×96
// RGBA8 buffer, blended by strength exactly as the renderer blends
// (`mix(original, graded, intensity)`), so a tile reads the way the real grade
// would. The app supplies the sample (a decoded reference or photo, or this
// module's synthetic chart) and draws the result; nothing here touches a view.
// The bytes behave like the web's `Uint8ClampedArray`: each channel is
// `Math.round`ed, then clamped to 0…255 (NaN → 0).

import Foundation

/// A small RGBA8 bitmap, laid out like `ImageData.data`.
public struct RgbBitmap: Equatable, Sendable {
    public var width: Int
    public var height: Int
    public var data: [UInt8]

    public init(width: Int, height: Int, data: [UInt8]) {
        self.width = width; self.height = height; self.data = data
    }
}

/// Tile sample resolution — plenty to judge a look, cheap to bake ~30 of.
public let previewSampleSize = 96

private let previewBars: [(Double, Double, Double)] = [
    (0.82, 0.11, 0.13), // red
    (0.91, 0.52, 0.09), // orange
    (0.86, 0.78, 0.12), // yellow
    (0.16, 0.6, 0.24), // green
    (0.12, 0.55, 0.62), // cyan
    (0.14, 0.24, 0.72), // blue
    (0.55, 0.16, 0.58), // magenta
]
private let previewSkin = (0.82, 0.63, 0.52)
private let previewFoliage = (0.27, 0.42, 0.18)

/// `Math.round` then a `Uint8ClampedArray` store.
@inline(__always) private func clampedByte(_ v: Double) -> UInt8 {
    if v.isNaN { return 0 }
    let r = (v + 0.5).rounded(.down)
    if r <= 0 { return 0 }
    if r >= 255 { return 255 }
    return UInt8(r)
}

/// A procedural test chart, used when no real picture is offered: a sky
/// gradient, a neutral grey ramp (tetrahedral keeps it neutral), saturated
/// primaries, a skin patch and a foliage patch — the things a look changes.
public func syntheticPreviewSample(_ size: Int = previewSampleSize) -> RgbBitmap {
    var data = [UInt8](repeating: 0, count: size * size * 4)
    let last = Double(max(1, size - 1))

    for y in 0..<size {
        let v = Double(y) / last
        for x in 0..<size {
            let u = Double(x) / last
            var c: (Double, Double, Double)
            if v < 0.38 {
                // Sky: light blue at the top fading to a warm horizon.
                let t = v / 0.38
                c = (lerp(0.56, 0.95, t), lerp(0.78, 0.85, t), lerp(0.92, 0.72, t))
            } else if v < 0.52 {
                // Neutral grey ramp, black (left) to white (right).
                c = (u, u, u)
            } else if v < 0.76 {
                let i = min(previewBars.count - 1, Int((u * Double(previewBars.count)).rounded(.down)))
                c = previewBars[i]
            } else {
                c = u < 0.5 ? previewSkin : previewFoliage
            }

            let o = (y * size + x) * 4
            data[o] = clampedByte(c.0 * 255)
            data[o + 1] = clampedByte(c.1 * 255)
            data[o + 2] = clampedByte(c.2 * 255)
            data[o + 3] = 255
        }
    }
    return RgbBitmap(width: size, height: size, data: data)
}

/// Bake `lut` onto `sample`, blended by `intensity` as the renderer does. A nil
/// `lut` returns an unchanged copy: the "original" tile. Alpha is kept.
public func bakeLutPreview(_ sample: RgbBitmap, _ lut: CubeLut?, _ intensity: Double,
                           _ mode: Interpolation) -> RgbBitmap {
    guard let lut else { return sample }
    let src = sample.data
    var out = [UInt8](repeating: 0, count: src.count)
    var i = 0
    while i + 3 < src.count {
        let r = Double(src[i]) / 255
        let g = Double(src[i + 1]) / 255
        let b = Double(src[i + 2]) / 255
        let (lr, lg, lb) = sampleWith(lut, r, g, b, mode)
        out[i] = clampedByte((r + (lr - r) * intensity) * 255)
        out[i + 1] = clampedByte((g + (lg - g) * intensity) * 255)
        out[i + 2] = clampedByte((b + (lb - b) * intensity) * 255)
        out[i + 3] = src[i + 3]
        i += 4
    }
    return RgbBitmap(width: sample.width, height: sample.height, data: out)
}
