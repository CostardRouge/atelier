// The KEYSTONE as a pass — the web's `keystone-pass.ts`: a homography, built
// and inverted by the twin (`keystoneMatrix` / `keystoneSampleMatrix`,
// AtelierKit's `Render/Keystone.swift`), applied by `Kernels/Keystone.metal`.
// Last of the three warps (`PictureGeometry.swift`): only a rectilinear picture
// has straight verticals for a perspective correction to make parallel.
//
// The kernel carries the SAMPLE matrix — destination to source, in IMAGE space
// (centred, y DOWN) — as three row vectors, so no transpose can go wrong; it
// converts from Core Image's y-up working space itself (`Keystone.metal`).
//
// Unlike the other two warps, this one's inverse IS cheap and exact, so its
// region of interest is not the whole picture: a homography maps a rectangle
// to a convex quadrilateral whose corners are the images of the rectangle's
// corners — as long as w keeps one sign over it — so a tile asks for the
// bounding box of four points and no more. Where w changes sign (the
// horizon crosses the tile) the pass asks for the whole input.

import AtelierKit
import CoreImage
import Foundation

struct KeystonePass: RenderPass {
    let id = "keystone"
    static let kernelName = "keystoneWarp"

    /// DESTINATION to SOURCE, in centred image coordinates, y down.
    let sample: Matrix3

    /// The warp for a keystone — the web's `makeKeystonePass`. Nil when the
    /// numbers fold the plane: the caller then draws unwarped rather than blank.
    static func make(_ keystone: Keystone, aspectRatio: Double = 1) -> KeystonePass? {
        guard let sample = keystoneSampleMatrix(keystone, aspectRatio) else { return nil }
        return KeystonePass(sample: sample)
    }

    /// The raw form, for a checker that states the matrix itself — the web's
    /// `keystonePassFromMatrix`.
    init(sample: Matrix3) {
        self.sample = sample
    }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try drawn(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    /// The pass with its failures THROWN — the gate's door.
    func drawn(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        guard GeometryPassSupport.drawable(image) else { return image }
        let kernel = try Kernels.kernel(Self.kernelName)
        let extent = image.extent
        let m = sample
        let arguments: [Any] = [
            image.clampedToExtent(),
            GeometryPassSupport.extentVector(extent),
            CIVector(x: CGFloat(m.a), y: CGFloat(m.b), z: CGFloat(m.c)),
            CIVector(x: CGFloat(m.d), y: CGFloat(m.e), z: CGFloat(m.f)),
            CIVector(x: CGFloat(m.g), y: CGFloat(m.h), z: CGFloat(m.i)),
        ]
        let out = kernel.apply(extent: extent, roiCallback: { _, rect in
            KeystonePass.sourceRegion(of: rect, sample: m, extent: extent)
        }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }

    /// The source region the output rect `rect` reads, in working space: the
    /// bounding box of its four corners mapped through `sample`, two pixels
    /// wider for the bilinear read, inside what the clamped input can give.
    /// The whole input where the map cannot promise that (w changing sign, or
    /// coming too close to 0 — a point bent past the horizon).
    static func sourceRegion(of rect: CGRect, sample m: Matrix3, extent: CGRect) -> CGRect {
        let whole = GeometryPassSupport.warpRegion(extent)
        guard !rect.isNull, !rect.isInfinite, !rect.isEmpty else { return whole }
        let corners = [
            CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
            CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.maxX, y: rect.maxY),
        ]
        var minX = Double.infinity, minY = Double.infinity
        var maxX = -Double.infinity, maxY = -Double.infinity
        var sign = 0.0
        for corner in corners {
            let (u, v) = GeometryPassSupport.imagePoint(corner, in: extent)
            let x = u - 0.5
            let y = v - 0.5
            let w = m.g * x + m.h * y + m.i
            guard w.isFinite, abs(w) >= 1e-6 else { return whole }
            if sign == 0 {
                sign = w > 0 ? 1 : -1
            } else if (w > 0 ? 1.0 : -1.0) != sign {
                return whole
            }
            let sx = (m.a * x + m.b * y + m.c) / w + 0.5
            let sy = (m.d * x + m.e * y + m.f) / w + 0.5
            let p = GeometryPassSupport.workingPoint(u: sx, v: sy, in: extent)
            minX = min(minX, Double(p.x)); maxX = max(maxX, Double(p.x))
            minY = min(minY, Double(p.y)); maxY = max(maxY, Double(p.y))
        }
        guard minX.isFinite, minY.isFinite, maxX.isFinite, maxY.isFinite else { return whole }
        let box = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY).insetBy(dx: -2, dy: -2)
        let hit = box.intersection(whole)
        // A tile wholly outside the picture reads nothing (it is empty); a
        // one-pixel corner keeps the region well formed.
        if hit.isNull || hit.isEmpty {
            return CGRect(x: whole.minX, y: whole.minY, width: 1, height: 1)
        }
        return hit
    }
}
