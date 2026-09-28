// THE CAMERA'S OWN WARP — a DNG's `WarpRectilinear`, which is `Lens.swift`'s
// polynomial with two terms the sliders do not offer. Port of
// `src/shared/render/camera-warp.ts`.
//
// `lensSampleRadius(r, k1, k2) = r · (1 + k1·r² + k2·r⁴)` is the
// corrected-to-source radial map a person dials by eye. The DNG writes the same
// shape per COLOUR PLANE with four radial coefficients instead of two:
//
//     ratio = k0 + k1·r² + k2·r⁴ + k3·r⁶
//
// `k0` is a pure magnification the sliders hold at 1 — and on the maintainer's
// DJI it is almost the whole opcode: the green plane's `k1..k3` are exactly
// zero and `k0` is a **4.93 % magnification**, red and blue deviating by at
// most 1.2 px at the corner — lateral CA, what `chromaScales` expresses. Two
// tangential terms come with it; zero on a well-centred lens, applied rather
// than dropped because the file states them.
//
// **The one convention that is an assumption, said out loud.** The radius is
// normalised so the FARTHEST CORNER FROM THE OPTICAL CENTRE sits at 1, in the
// image's own pixels — half the diagonal when the centre is in the middle,
// `Lens.swift`'s own convention. A pure magnification cannot tell; a file with
// real `k1..k3` is what would settle it.
//
// The GPU twin (`camera-warp-pass.ts` on the web) is the app's: it walks the
// output and samples each plane at `warpSourceUv`.

import Foundation

/// The web's `export type { DngWarp as CameraWarp }`.
public typealias CameraWarp = DngWarp

/// How far the farthest corner is from the optical centre, in PIXELS — what
/// the polynomial's `r` is normalised by.
public func warpNormRadius(_ warp: DngWarp, _ width: Double, _ height: Double) -> Double {
    let cx = warp.centerH * width
    let cy = warp.centerV * height
    var most = 0.0
    for (x, y) in [(0.0, 0.0), (width, 0), (0, height), (width, height)] {
        let dx = x - cx
        let dy = y - cy
        most = max(most, (dx * dx + dy * dy).squareRoot())
    }
    return most > 0 ? most : 1
}

/// The radial ratio at a normalised radius. `lensSampleRadius(r, k1, k2)` is
/// `r · warpRatio(r, [1, k1, k2, 0])` — the same polynomial, one term longer
/// and with the magnification the sliders hold at 1 made explicit. A spec
/// pins that identity so the two cannot drift.
public func warpRatio(_ r: Double, _ radial: [Double]) -> Double {
    // A missing term is NaN, as JavaScript's `undefined` makes it — never a trap.
    func k(_ i: Int) -> Double { i < radial.count ? radial[i] : .nan }
    let r2 = r * r
    let a = k(0) + k(1) * r2
    let b = k(2) * r2 * r2
    let c = k(3) * r2 * r2 * r2
    return a + b + c
}

/// Where a corrected point came from, for ONE plane. `n` is the point relative
/// to the optical centre, already normalised so the farthest corner is at 1.
/// The radial ratio, then the two tangential terms — Brown–Conrady's own
/// arrangement, and dng_sdk's.
public func warpSourcePoint(_ nx: Double, _ ny: Double, _ plane: DngWarpPlane) -> (Double, Double) {
    let r2 = nx * nx + ny * ny
    let ratio = warpRatio(r2.squareRoot(), plane.radial)
    let t0 = plane.tangential.count > 0 ? plane.tangential[0] : 0
    let t1 = plane.tangential.count > 1 ? plane.tangential[1] : 0
    let x = ratio * nx + t0 * (r2 + 2 * nx * nx) + 2 * t1 * nx * ny
    let y = ratio * ny + t1 * (r2 + 2 * ny * ny) + 2 * t0 * nx * ny
    return (x, y)
}

private let identityWarpPlane = DngWarpPlane(radial: [1, 0, 0, 0], tangential: [0, 0])

/// One plane's terms; a one-plane warp answers for all three. (A warp holding
/// no plane, which no file yields, answers with the identity rather than the
/// web's `undefined`.)
public func planeOf(_ warp: DngWarp, _ plane: Int) -> DngWarpPlane {
    warpPlane(warp, plane) ?? identityWarpPlane
}

/// Where a corrected IMAGE point (in [0,1], y down from the top) came from, for
/// one plane — the whole map, in the coordinates every caller here speaks.
public func warpSourceUv(_ warp: DngWarp, _ plane: Int, _ u: Double, _ v: Double,
                         _ width: Double, _ height: Double) -> (Double, Double) {
    let radius = warpNormRadius(warp, width, height)
    let nx = ((u - warp.centerH) * width) / radius
    let ny = ((v - warp.centerV) * height) / radius
    let (sx, sy) = warpSourcePoint(nx, ny, planeOf(warp, plane))
    return (warp.centerH + (sx * radius) / width, warp.centerV + (sy * radius) / height)
}

/// Compare by VALUE. A calibration is re-read per picture, and a renderer
/// keyed on identity would rebuild its pipeline for an identical warp.
public func sameWarp(_ a: DngWarp?, _ b: DngWarp?) -> Bool {
    guard let a, let b else { return isIdentityWarp(a) && isIdentityWarp(b) }
    if a.centerH != b.centerH || a.centerV != b.centerV { return false }
    if a.planes.count != b.planes.count { return false }
    for (p, q) in zip(a.planes, b.planes) {
        for (j, k) in p.radial.enumerated() where !(j < q.radial.count && k == q.radial[j]) { return false }
        for (j, t) in p.tangential.enumerated() where !(j < q.tangential.count && t == q.tangential[j]) { return false }
    }
    return true
}

/// `×1.049 · CA 1.2 px at the corner`, for a panel that says what a file asks.
public func describeWarp(_ warp: DngWarp?, _ width: Double = 1, _ height: Double = 1) -> String {
    guard let warp, !warp.planes.isEmpty else { return "" }
    let green = planeOf(warp, 1)
    var parts = ["×\(ExifText.toFixed(green.radial[0], 3))"]
    if warp.planes.count > 1 {
        let radius = warpNormRadius(warp, width, height)
        var worst = 0.0
        for p in [0, 2] {
            let (gx, gy) = warpSourcePoint(0.7071, 0.7071, green)
            let (cx, cy) = warpSourcePoint(0.7071, 0.7071, planeOf(warp, p))
            let dx = cx - gx
            let dy = cy - gy
            worst = max(worst, (dx * dx + dy * dy).squareRoot() * radius)
        }
        if worst >= 0.05 { parts.append("CA \(ExifText.toFixed(worst, 1)) px at the corner") }
    }
    return parts.joined(separator: " · ")
}
