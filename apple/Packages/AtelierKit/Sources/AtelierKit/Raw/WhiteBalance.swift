// WHITE BALANCE IN KELVIN on a RAW (audit item 17, `docs/lightroom-gaps.md`).
// Port of `src/shared/raw/white-balance.ts`.
//
// Kelvin was cut from the 8-bit develop as a fabrication: a finished JPEG has
// no as-shot white balance to move from. A RAW has one — the decoder knows the
// camera's own multipliers (`cam_mul`) and matrices (`cam_xyz`, `rgb_cam`) — so
// here a temperature MEANS something:
//
// - The as-shot white is read back to a chromaticity through the camera's
//   matrix, and named as a temperature and a tint (`asShotTempTint`).
// - A temperature and tint the author picks are turned into the multipliers
//   the camera WOULD have used under that light (`multipliersFor`).
// - The decoded picture, already balanced as shot and in linear sRGB, is
//   re-balanced by ONE 3×3 matrix: `rgb_cam · diag(new / as shot) · rgb_cam⁻¹`
//   — what the decoder would have produced with those multipliers, without a
//   second decode (`wbMatrix`).
//
// Temperature and tint follow Lightroom's reading: the Planckian locus in CIE
// 1960 uv, and a tint the LIGHT's offset along its normal, 3000 per unit of
// Duv — so the slider moves the picture the way Lightroom's does: + toward
// magenta, − toward green; lower Kelvin, bluer.
//
// The numbers are LibRaw's (`cam_mul`, `cam_xyz`, `rgb_cam`, `pre_mul`), read
// as the web reads them (`rawWhiteOrNull` takes their JSON shapes). The app's
// decoder is `CIRAWFilter`, which does not hand these out: until the app has a
// source for them (the DNG's own ColorMatrix/AsShotNeutral tags are one), the
// stored `rawWb.matrix` is what it applies — preview = export either way.

import Foundation

/// What the decoder knows about a RAW's white: row-major 3×3 matrices, multipliers normalised on green.
public struct RawWhite: Equatable, Sendable {
    /// The camera's as-shot multipliers, R G B, G = 1.
    public var asShot: [Double]
    /// XYZ → camera, 3×3 row-major (LibRaw's `cam_xyz`, the colour rows).
    public var camXyz: [Double]
    /// Camera → linear sRGB, 3×3 row-major (LibRaw's `rgb_cam`, the colour columns).
    public var rgbCam: [Double]

    public init(asShot: [Double], camXyz: [Double], rgbCam: [Double]) {
        self.asShot = asShot; self.camXyz = camXyz; self.rgbCam = rgbCam
    }
}

/// A white balance stored on a develop: what was asked, and the matrix it came to for THIS picture.
public struct RawWhiteBalance: Equatable, Sendable {
    public var kelvin: Double
    public var tint: Double
    /// Linear sRGB → linear sRGB, 3×3 row-major — stored so the export applies exactly what the stage did.
    public var matrix: [Double]

    public init(kelvin: Double, tint: Double, matrix: [Double]) {
        self.kelvin = kelvin; self.tint = tint; self.matrix = matrix
    }

    /// The record as a develop holds it.
    public var json: JSONValue {
        .object(["kelvin": .number(kelvin), "tint": .number(tint), "matrix": .array(matrix.map { .number($0) })])
    }
}

/// A temperature and a tint — what the locus names a chromaticity.
public struct TempTint: Equatable, Sendable {
    public var kelvin: Double
    public var tint: Double
    public init(kelvin: Double, tint: Double) { self.kelvin = kelvin; self.tint = tint }
}

public let kelvinRange = (min: 2000.0, max: 50000.0)
public let tintRange = (min: -150.0, max: 150.0)

public struct WbPreset: Equatable, Sendable {
    public var id: String
    public var label: String
    public var kelvin: Double
    public var tint: Double
}

/// Lightroom's presets, in its order.
public let wbPresets: [WbPreset] = [
    WbPreset(id: "daylight", label: "Daylight", kelvin: 5500, tint: 10),
    WbPreset(id: "cloudy", label: "Cloudy", kelvin: 6500, tint: 10),
    WbPreset(id: "shade", label: "Shade", kelvin: 7500, tint: 10),
    WbPreset(id: "tungsten", label: "Tungsten", kelvin: 2850, tint: 0),
    WbPreset(id: "fluorescent", label: "Fluorescent", kelvin: 3800, tint: 21),
    WbPreset(id: "flash", label: "Flash", kelvin: 5500, tint: 0),
]

// MARK: - 3×3 algebra

public func mul3(_ a: [Double], _ b: [Double]) -> [Double] {
    var o = [Double](repeating: 0, count: 9)
    for r in 0..<3 {
        for c in 0..<3 {
            for k in 0..<3 { o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c] }
        }
    }
    return o
}

public func apply3(_ m: [Double], _ v: (Double, Double, Double)) -> (Double, Double, Double) {
    let r = m[0] * v.0 + m[1] * v.1 + m[2] * v.2
    let g = m[3] * v.0 + m[4] * v.1 + m[5] * v.2
    let b = m[6] * v.0 + m[7] * v.1 + m[8] * v.2
    return (r, g, b)
}

public func inverse3(_ m: [Double]) -> [Double]? {
    if m.count < 9 { return nil }
    let a = m[0], b = m[1], c = m[2]
    let d = m[3], e = m[4], f = m[5]
    let g = m[6], h = m[7], i = m[8]
    let A = e * i - f * h
    let B = -(d * i - f * g)
    let C = d * h - e * g
    let det = a * A + b * B + c * C
    if !det.isFinite || abs(det) < 1e-12 { return nil }
    let row0 = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det]
    let row1 = [B / det, (a * i - c * g) / det, -(a * f - c * d) / det]
    let row2 = [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
    return row0 + row1 + row2
}

// MARK: - the Planckian locus

private func xyToUv(_ x: Double, _ y: Double) -> (Double, Double) {
    let d = -2 * x + 12 * y + 3
    return ((4 * x) / d, (6 * y) / d)
}

private func uvToXy(_ u: Double, _ v: Double) -> (Double, Double) {
    let d = 2 * u - 8 * v + 4
    return ((3 * u) / d, (2 * v) / d)
}

/// CIE 1960 uv of a black body at `kelvin` — Krystek's rational fit (1985),
/// within 1e-4 of the true locus from 1000 to 15000 K and SMOOTH everywhere,
/// which a nearest-point search needs: the piecewise cubic of Kim et al. has a
/// kink at 4000 K that threw a round trip 8 K off there.
public func planckianUv(_ kelvin: Double) -> (u: Double, v: Double) {
    let T = max(1000, min(kelvinRange.max, kelvin))
    // Written in the web's order of operations (`c · T · T`), so the bits agree.
    let uTop = 0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T
    let uBottom = 1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T
    let vTop = 0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T
    let vBottom = 1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T
    return (uTop / uBottom, vTop / vBottom)
}

/// CIE 1931 xy of a black body at `kelvin`.
public func planckianXy(_ kelvin: Double) -> (x: Double, y: Double) {
    let uv = planckianUv(kelvin)
    let xy = uvToXy(uv.u, uv.v)
    return (xy.0, xy.1)
}

/// The locus in uv at `kelvin`, and its unit normal (toward positive Duv, green).
private func locusFrame(_ kelvin: Double) -> (uv: (Double, Double), normal: (Double, Double)) {
    let uv = planckianUv(kelvin)
    let next = planckianUv(kelvin * 1.001)
    let tx = next.u - uv.u
    let ty = next.v - uv.v
    let length = (tx * tx + ty * ty).squareRoot()
    let len = length == 0 || length.isNaN ? 1 : length
    // Rotate the tangent (toward cooler) a quarter-turn so the normal points up in v — toward green.
    var nx = -ty / len
    var ny = tx / len
    if ny < 0 {
        nx = -nx
        ny = -ny
    }
    return ((uv.u, uv.v), (nx, ny))
}

/// 3000 tint per unit of Duv, positive toward green — Lightroom's scale.
private let tintScale = 3000.0

/// A temperature and tint as a CIE 1931 chromaticity.
public func tempTintToXy(_ kelvin: Double, _ tint: Double) -> (x: Double, y: Double) {
    let frame = locusFrame(kelvin)
    let duv = tint / tintScale
    let xy = uvToXy(frame.uv.0 + frame.normal.0 * duv, frame.uv.1 + frame.normal.1 * duv)
    return (xy.0, xy.1)
}

/// A chromaticity named as the nearest temperature on the locus and its tint off it.
public func xyToTempTint(_ x: Double, _ y: Double) -> TempTint {
    let (u, v) = xyToUv(x, y)
    // In mireds the locus is walked evenly: a coarse sweep, then a golden refinement.
    func dist(_ mired: Double) -> Double {
        let uv = locusFrame(1e6 / mired).uv
        let du = u - uv.0
        let dv = v - uv.1
        return (du * du + dv * dv).squareRoot()
    }
    var best = 20.0
    var m = 20.0
    while m <= 600 {
        if dist(m) < dist(best) { best = m }
        m += 2
    }
    var lo = max(20, best - 2)
    var hi = min(600, best + 2)
    for _ in 0..<60 {
        let a = lo + (hi - lo) * 0.382
        let b = lo + (hi - lo) * 0.618
        if dist(a) < dist(b) { hi = b } else { lo = a }
    }
    let kelvin = 1e6 / ((lo + hi) / 2)
    let frame = locusFrame(kelvin)
    let duv = (u - frame.uv.0) * frame.normal.0 + (v - frame.uv.1) * frame.normal.1
    return TempTint(kelvin: kelvin, tint: duv * tintScale)
}

// MARK: - the camera

/// XYZ of a chromaticity at Y = 1.
private func xyToXyz(_ x: Double, _ y: Double) -> (Double, Double, Double) {
    (x / y, 1, (1 - x - y) / y)
}

/// The multipliers the camera would use under this light: 1 / its neutral, normalised on green.
public func multipliersFor(_ white: RawWhite, _ kelvin: Double, _ tint: Double) -> [Double]? {
    let xy = tempTintToXy(kelvin, tint)
    let n = apply3(white.camXyz, xyToXyz(xy.x, xy.y))
    if !(n.0 > 0) || !(n.1 > 0) || !(n.2 > 0) { return nil }
    return [n.1 / n.0, 1, n.1 / n.2]
}

/// The temperature and tint the camera shot at, read back through its matrix.
public func asShotTempTint(_ white: RawWhite) -> TempTint? {
    guard let inv = inverse3(white.camXyz) else { return nil }
    let neutral = (1 / white.asShot[0], 1 / white.asShot[1], 1 / white.asShot[2])
    let (X, Y, Z) = apply3(inv, neutral)
    let s = X + Y + Z
    if !(s > 0) || !(Y > 0) { return nil }
    return xyToTempTint(X / s, Y / s)
}

/// The matrix that re-balances the decoded picture (linear sRGB, balanced as
/// shot) to `kelvin` / `tint` — or nil when the camera's data cannot say (a
/// matrix that does not invert, a neutral off the camera's gamut).
public func wbMatrix(_ white: RawWhite, _ kelvin: Double, _ tint: Double) -> [Double]? {
    guard let m = multipliersFor(white, kelvin, tint), let inv = inverse3(white.rgbCam) else { return nil }
    let ratio = [m[0] / white.asShot[0], m[1] / white.asShot[1], m[2] / white.asShot[2]]
    let diag = [ratio[0], 0, 0, 0, ratio[1], 0, 0, 0, ratio[2]]
    return mul3(white.rgbCam, mul3(diag, inv))
}

/// A white balance read back safely — or nil: a matrix of nine finite numbers, the rest clamped.
public func rawWhiteBalanceOrNull(_ raw: JSONValue?) -> RawWhiteBalance? {
    guard let src = raw?.objectValue else { return nil }
    guard let m = src["matrix"]?.arrayValue, m.count == 9 else { return nil }
    let matrix = m.compactMap { $0.finiteNumber }
    if matrix.count != 9 { return nil }
    guard let k = src["kelvin"]?.finiteNumber else { return nil }
    let t = src["tint"]?.finiteNumber ?? 0
    return RawWhiteBalance(
        kelvin: max(kelvinRange.min, min(kelvinRange.max, k)),
        tint: max(tintRange.min, min(tintRange.max, t)),
        matrix: matrix
    )
}

/// Linear sRGB (D65) → XYZ — dcraw's `xyz_rgb`, inverted; what LibRaw's `rgb_cam` was built against.
private let xyzToSrgb = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252]

/// JavaScript's `Number(x)` over a JSON value — what `.map(Number)` does to a
/// decoder's list: a number as is, a boolean 0/1, null 0, a string parsed, a
/// one-element list its element, anything else NaN.
private func numberOf(_ v: JSONValue) -> Double {
    switch v {
    case .number(let n): return n
    case .bool(let b): return b ? 1 : 0
    case .null: return 0
    case .string(let s):
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return 0 }
        // A decimal literal only: `strtod` would also take `inf`, `nan` and hex.
        guard t.allSatisfy({ "0123456789+-.eE".contains($0) }) else { return .nan }
        return Double(t) ?? .nan
    case .array(let a):
        if a.isEmpty { return 0 }
        return a.count == 1 ? numberOf(a[0]) : .nan
    case .object: return .nan
    }
}

/// `r` rows of at least `c` finite NUMBERS each (a string does not count), flattened.
private func rows(_ v: JSONValue?, _ r: Int, _ c: Int) -> [Double]? {
    guard let list = v?.arrayValue, list.count >= r else { return nil }
    var out: [Double] = []
    for i in 0..<r {
        guard let row = list[i].arrayValue, row.count >= c else { return nil }
        for j in 0..<c {
            guard let n = row[j].finiteNumber else { return nil }
            out.append(n)
        }
    }
    return out
}

/// Is the decoder's read usable: finite, a camera matrix that inverts,
/// positive multipliers. `raw` is the decoder's metadata, `camMul` / `camXyz`
/// / `rgbCam` / `preMul` in LibRaw's own shapes (4 multipliers, 4×3, 3×4).
///
/// `cam_xyz` is LibRaw's XYZ → camera matrix for the bodies it knows — and all
/// ZEROS for a DNG, whose matrix LibRaw keeps elsewhere. It is then recovered
/// from what LibRaw built out of it: `rgb_cam` is the inverse of
/// `cam_xyz · xyz_rgb` with its rows normalised by `pre_mul`, so
/// `cam_xyz = diag(1 / pre_mul) · rgb_cam⁻¹ · XYZ→sRGB` — the same matrix up to
/// a common scale, which a chromaticity does not see.
public func rawWhiteOrNull(_ raw: [String: JSONValue]) -> RawWhite? {
    let mul = raw["camMul"]?.arrayValue?.map(numberOf)
    let rgbCam = rows(raw["rgbCam"], 3, 3)
    var camXyz = rows(raw["camXyz"], 3, 3)
    if let xyz = camXyz, xyz.allSatisfy({ $0 == 0 }) { camXyz = nil }
    if camXyz == nil, let rgbCam {
        let pre = raw["preMul"]?.arrayValue?.map(numberOf)
        if let pre, pre.count >= 3, pre[0] > 0, pre[1] > 0, pre[2] > 0, let camRgbNorm = inverse3(rgbCam) {
            let unscale = [1 / pre[0], 0, 0, 0, 1 / pre[1], 0, 0, 0, 1 / pre[2]]
            camXyz = mul3(mul3(unscale, camRgbNorm), xyzToSrgb)
        }
    }
    guard let mul, mul.count >= 3, let camXyz, let rgbCam else { return nil }
    let g = mul.count > 3 && mul[3] > 0 ? (mul[1] + mul[3]) / 2 : mul[1]
    if !(mul[0] > 0) || !(g > 0) || !(mul[2] > 0) { return nil }
    if inverse3(camXyz) == nil || inverse3(rgbCam) == nil { return nil }
    return RawWhite(asShot: [mul[0] / g, 1, mul[2] / g], camXyz: camXyz, rgbCam: rgbCam)
}

/// `5600 K, tint +8`.
public func describeWhiteBalance(_ wb: RawWhiteBalance) -> String {
    let t = ExifText.jsRound(wb.tint)
    let kelvin = ExifText.jsString(ExifText.jsRound(wb.kelvin))
    let tintPart = t != 0 ? ", tint \(t > 0 ? "+" : "−")\(ExifText.jsString(abs(t)))" : ""
    return "\(kelvin) K\(tintPart)"
}
