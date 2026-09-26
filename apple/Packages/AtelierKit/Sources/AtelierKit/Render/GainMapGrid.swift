// THE GAIN MAP — the shading correction a DNG states as a GRID, not a curve.
// Port of `src/shared/render/gain-map.ts` (the file is named `GainMapGrid`
// because `HDR/GainMap.swift` — the Ultra HDR one — holds the basename).
//
// `Lens.swift` corrects vignetting radially: one number at one radius, the
// right model for a slider a person turns. A camera's own calibration is not
// that. DJI's `OpcodeList3` writes a 32 × 32 grid PER COLOUR PLANE — corner
// gains of 5.93 / 5.06 / 4.97 against 1.00 in the middle — so it corrects
// colour shading as well as brightness, and it is not circular.
//
// The rules it keeps (`docs/memory/render-gain-map.md`):
// - **It multiplies LIGHT, never code** (`gainEncoded`, the twin of
//   `vignetteEncoded`): a gain on an encoded value lifts a dark corner three
//   times as much as a bright one. The pass decodes, multiplies, re-encodes —
//   and runs FIRST, on the decoded sensor data, before the develop reads a
//   single value.
// - Nothing is invented: every number comes from `DngOpcodes.swift`. A file
//   with no GainMap yields no field, and the rung that would apply one is not
//   offered.
// - Outside the map's rectangle a gain is HELD at the edge node — never
//   extrapolated.
//
// The GPU twin (`gain-map-pass.ts` on the web) is the app's: Core Image or
// Metal samples `gains` bilinearly exactly as `gainAt` does.

import Foundation

/// The gains of a whole picture as ONE grid the GPU can hold: an RGB gain at
/// every node, the nodes evenly spaced in the image's own [0,1] coordinates.
public struct GainField: Equatable, Sendable {
    public var cols: Int
    public var rows: Int
    /// Row-major, `rows × cols × 4` — RGB and a padding alpha, so the upload is 4-aligned.
    public var gains: [Float]
    /// Where node (0,0) sits, in [0,1] of the image.
    public var originU: Double
    public var originV: Double
    /// The distance between neighbouring nodes, in the same units.
    public var stepU: Double
    public var stepV: Double

    public init(cols: Int, rows: Int, gains: [Float], originU: Double, originV: Double, stepU: Double, stepV: Double) {
        self.cols = cols; self.rows = rows; self.gains = gains
        self.originU = originU; self.originV = originV; self.stepU = stepU; self.stepV = stepV
    }
}

/// `x || 1` — a zero (or NaN) spacing read as 1, as the web reads it.
private func orOne(_ x: Double) -> Double {
    x == 0 || x.isNaN ? 1 : x
}

/// Sample ONE parsed map at an image point, for one of its own planes.
private func sampleMap(_ m: DngGainMap, _ u: Double, _ v: Double, _ mapPlane: Int, _ width: Double, _ height: Double) -> Double {
    let rectW = Double(m.rect.right - m.rect.left)
    let rectH = Double(m.rect.bottom - m.rect.top)
    if rectW <= 0 || rectH <= 0 { return 1 }
    // Into the rectangle's own [0,1], then onto the grid the origin and the
    // spacing describe. Outside the rectangle a gain is held at the edge node:
    // a correction has to do SOMETHING at a pixel the map does not cover, and
    // holding is the only choice that cannot invent a number.
    let x = ((u * width - Double(m.rect.left)) / rectW - m.originH) / orOne(m.spacingH)
    let y = ((v * height - Double(m.rect.top)) / rectH - m.originV) / orOne(m.spacingV)
    let gx = min(Double(m.cols - 1), max(0, x))
    let gy = min(Double(m.rows - 1), max(0, y))
    let j0 = Int(gx.rounded(.down))
    let i0 = Int(gy.rounded(.down))
    let j1 = min(m.cols - 1, j0 + 1)
    let i1 = min(m.rows - 1, i0 + 1)
    let fx = gx - Double(j0)
    let fy = gy - Double(i0)
    func at(_ i: Int, _ j: Int) -> Double {
        let k = (i * m.cols + j) * m.mapPlanes + mapPlane
        return k >= 0 && k < m.gains.count ? Double(m.gains[k]) : 1
    }
    let top = at(i0, j0) * (1 - fx) + at(i0, j1) * fx
    let bottom = at(i1, j0) * (1 - fx) + at(i1, j1) * fx
    return top * (1 - fy) + bottom * fy
}

/// Which map covers output plane `p`, and which of ITS planes answers for it.
private func mapFor(_ maps: [DngGainMap], _ p: Int) -> (map: DngGainMap, plane: Int)? {
    for m in maps where p >= m.plane && p < m.plane + m.planes {
        return (m, m.mapPlanes == 1 ? 0 : min(m.mapPlanes - 1, p - m.plane))
    }
    return nil
}

/// One RGB field over the whole image, from the maps a file states.
///
/// The GEOMETRY is the first map's — its rectangle, its origin, its spacing —
/// and each colour plane is filled by sampling ITS OWN map at those node
/// positions. Where every plane shares one grid, which is what the measured
/// file writes, that sampling is the identity and the numbers are the file's
/// exactly.
///
/// `width`/`height` are the pixels the OPCODE was written against — the
/// sensor's own, since its rectangle is in those — not a half-size decode's.
public func gainFieldFrom(_ maps: [DngGainMap], _ width: Double, _ height: Double) -> GainField? {
    guard let base = maps.first, width > 0, height > 0 else { return nil }
    let rectW = Double(base.rect.right - base.rect.left)
    let rectH = Double(base.rect.bottom - base.rect.top)
    if !(rectW > 0) || !(rectH > 0) || !(base.cols > 0) || !(base.rows > 0) { return nil }
    let originU = (Double(base.rect.left) + base.originH * rectW) / width
    let originV = (Double(base.rect.top) + base.originV * rectH) / height
    let stepU = (base.spacingH * rectW) / width
    let stepV = (base.spacingV * rectH) / height
    if !originU.isFinite || !stepU.isFinite || !(stepU > 0) || !(stepV > 0) { return nil }

    var gains = [Float](repeating: 0, count: base.rows * base.cols * 4)
    let planes = [mapFor(maps, 0), mapFor(maps, 1), mapFor(maps, 2)]
    for i in 0..<base.rows {
        for j in 0..<base.cols {
            let u = originU + Double(j) * stepU
            let v = originV + Double(i) * stepV
            let at = (i * base.cols + j) * 4
            for c in 0..<3 {
                if let found = planes[c] {
                    gains[at + c] = Float(sampleMap(found.map, u, v, found.plane, width, height))
                } else {
                    gains[at + c] = 1
                }
            }
            gains[at + 3] = 1
        }
    }
    return GainField(cols: base.cols, rows: base.rows, gains: gains, originU: originU, originV: originV,
                     stepU: stepU, stepV: stepV)
}

/// The RGB gain at an image point — bilinear between the nodes, held at the
/// edge outside them. The function the GPU mirrors.
public func gainAt(_ f: GainField, _ u: Double, _ v: Double) -> (Double, Double, Double) {
    let gx = min(Double(f.cols - 1), max(0, (u - f.originU) / f.stepU))
    let gy = min(Double(f.rows - 1), max(0, (v - f.originV) / f.stepV))
    let j0 = Int(gx.rounded(.down))
    let i0 = Int(gy.rounded(.down))
    let j1 = min(f.cols - 1, j0 + 1)
    let i1 = min(f.rows - 1, i0 + 1)
    let fx = gx - Double(j0)
    let fy = gy - Double(i0)
    var out = [1.0, 1.0, 1.0]
    for c in 0..<3 {
        let a = Double(f.gains[(i0 * f.cols + j0) * 4 + c])
        let b = Double(f.gains[(i0 * f.cols + j1) * 4 + c])
        let d = Double(f.gains[(i1 * f.cols + j0) * 4 + c])
        let e = Double(f.gains[(i1 * f.cols + j1) * 4 + c])
        let top = a * (1 - fx) + b * fx
        let bottom = d * (1 - fx) + e * fx
        out[c] = top * (1 - fy) + bottom * fy
    }
    return (out[0], out[1], out[2])
}

/// What an sRGB-ENCODED value becomes once a gain is applied to its LIGHT —
/// the only place a shading correction is right (`vignetteEncoded`, for the
/// same reason). Clamped at white by the encode, as an 8-bit readback is what
/// the web's gate compares; the GPU keeps the headroom itself.
public func gainEncoded(_ encoded: Double, _ gain: Double) -> Double {
    if gain == 1 { return encoded }
    return fromLinear(toLinear(encoded, .srgb) * gain, .srgb)
}

/// The strongest gain anywhere in the field — what a panel says the file asks for.
public func maxGain(_ f: GainField?) -> Double {
    guard let f else { return 1 }
    var most = 1.0
    var i = 0
    while i + 2 < f.gains.count {
        for c in 0..<3 where Double(f.gains[i + c]) > most { most = Double(f.gains[i + c]) }
        i += 4
    }
    return most
}

/// True when the field would multiply nothing — no pass is worth a resample.
public func isFlatField(_ f: GainField?) -> Bool {
    guard let f else { return true }
    var i = 0
    while i + 2 < f.gains.count {
        for c in 0..<3 where abs(Double(f.gains[i + c]) - 1) > 1e-6 { return false }
        i += 4
    }
    return true
}
