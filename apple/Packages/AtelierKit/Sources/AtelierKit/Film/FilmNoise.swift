// The grain's noise field: a tile of independent white noise, and where in
// it a frame looks. Port of the pure half of `src/shared/film/film-noise.ts`
// — the GLSL that file also holds stays with the web's shader; on Apple the
// tile below is what a Core Image kernel samples.
//
// WHY WHITE NOISE IN A TILE, sampled LINEAR at one texel per grain cell: the
// bilinear read IS the band-limiting filter, so the grain has a controllable
// period and survives the downscale every consumer performs after the grader
// (a 48 MP still delivered at 1080 px is box-filtered 5.5×; a per-fragment
// hash at one source pixel loses its variance in that filter and arrives as
// grey haze). Four channels: a luma field and three per-channel fields the
// shader mixes by `grainChroma`.
//
// WHY A PHASE AND NOT A TRANSLATION: an offset of more than a couple of cells
// into white noise decorrelates completely, so each frame gets a genuinely
// new field rather than the last one slid along — which is what makes grain
// live instead of crawl. The phase is pure in (frameIndex, seed), so a
// re-export is byte-identical, and it steps on the SOURCE frame quantised to
// `grainFps`: real film re-rolls its grain once per photographed frame, and
// re-rolling at 60 Hz on 24 fps material is the "boiling".
//
// The tile and the phase are drawn from `mulberry32`, so a seed stored by the
// web rolls the SAME field here — the spec pins bytes measured in node.

import Foundation

/// RGBA bytes of a tiling noise tile, `size × size × 4`, every channel an
/// independent uniform draw. Deterministic per seed.
public func makeGrainNoise(_ seed: Double, _ size: Int = noiseSize) -> [UInt8] {
    let count = size * size * 4
    var out = [UInt8](repeating: 0, count: count)
    let r = mulberry32(seed)
    for i in 0..<count {
        out[i] = UInt8((r() * 256).rounded(.down))
    }
    return out
}

// Two irrational strides, one per axis: consecutive frames land far apart in
// the tile and the sequence never closes on itself within a clip's length.
private let strideX = 0.6180339887498949 // φ − 1
private let strideY = 0.41421356237309503 // √2 − 1

/// The tile offset a frame samples at, in texture units [0, 1)².
public func grainPhase(_ frameIndex: Double, _ seed: Double) -> (Double, Double) {
    let r = mulberry32(seed)
    let ox = r()
    let oy = r()
    let i = max(0, frameIndex.rounded(.down))
    func frac(_ v: Double) -> Double { v - v.rounded(.down) }
    return (frac(ox + strideX * i), frac(oy + strideY * i))
}

/// Which grain field a source instant sees: `floor(t · fps)`, and always 0 when the grain is frozen.
public func grainFrameIndex(_ sourceSeconds: Double, _ grainFps: Double) -> Double {
    if grainFps <= 0 || !sourceSeconds.isFinite { return 0 }
    return max(0, (sourceSeconds * grainFps).rounded(.down))
}

/// One bilinear, REPEAT-wrapped read of the tile — the CPU TWIN of the web
/// node's `texture(u_noise, uv)`, and the definition of what any sampler of
/// the tile is held to.
///
/// The bilinear read is not an implementation detail here, it IS the
/// band-limiting filter (see the header): a nearest read would put white noise
/// back at one texel and lose it in the first downscale. Texel centres sit at
/// `(i + 0.5) / size`, which is why the half-texel comes off before the floor.
public func sampleGrainTile(_ bytes: [UInt8], _ u: Double, _ v: Double, _ size: Int = noiseSize) -> GrainSample {
    let x = u * Double(size) - 0.5
    let y = v * Double(size) - 0.5
    let x0 = Int(x.rounded(.down))
    let y0 = Int(y.rounded(.down))
    let fx = x - Double(x0)
    let fy = y - Double(y0)
    func wrap(_ i: Int) -> Int { ((i % size) + size) % size }
    let xa = wrap(x0), xb = wrap(x0 + 1)
    let ya = wrap(y0), yb = wrap(y0 + 1)
    var out = [0.0, 0.0, 0.0, 0.0]
    for c in 0..<4 {
        func at(_ ix: Int, _ iy: Int) -> Double { Double(bytes[(iy * size + ix) * 4 + c]) / 255 }
        let top = at(xa, ya) * (1 - fx) + at(xb, ya) * fx
        let bottom = at(xa, yb) * (1 - fx) + at(xb, yb) * fx
        out[c] = top * (1 - fy) + bottom * fy
    }
    // The same channel order `grainSampleFrom` reads: alpha is the luma field.
    return (out[3] - 0.5, out[0] - 0.5, out[1] - 0.5, out[2] - 0.5)
}
