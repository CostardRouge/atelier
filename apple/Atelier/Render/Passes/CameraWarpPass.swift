// The CAMERA's own warp as a pass — the web's `camera-warp-pass.ts`: a DNG's
// `WarpRectilinear`, per colour plane, about the optical centre the FILE
// states. The kernel is `Kernels/CameraWarp.metal`; its twin is
// `warpSourceUv` (AtelierKit's `Render/CameraWarp.swift`).
//
// Never stored on a document and never edited: a fact about the body, read out
// of the file by whichever rung of the RAW ladder is open (`calibrationAt`,
// `Raw/Calibration.swift`). First of the three warps (`PictureGeometry.swift`).
//
// The pass's parameters ARE the record: the warp and the pixels (or merely the
// aspect — the normalising radius is a distance in the very units it then
// divides out) it was written against.

import AtelierKit
import CoreImage
import Foundation

struct CameraWarpPass: RenderPass {
    let id = "camera-warp"
    static let kernelName = "cameraWarp"

    let warp: CameraWarp
    let width: Double
    let height: Double

    /// The web's `makeCameraWarpPass`: nil when the file's own numbers move no
    /// pixel — a caller then runs one fewer pass rather than a no-op resample.
    static func make(_ warp: CameraWarp?, _ width: Double, _ height: Double) -> CameraWarpPass? {
        guard let warp, !isIdentityWarp(warp), width > 0, height > 0 else { return nil }
        return CameraWarpPass(warp: warp, width: width, height: height)
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
        let radius = warpNormRadius(warp, width, height)
        // Three planes, red first; a missing term is 0, as the web's
        // Float32Array leaves it.
        var arguments: [Any] = [
            image.clampedToExtent(),
            GeometryPassSupport.extentVector(extent),
            CIVector(x: CGFloat(warp.centerH), y: CGFloat(warp.centerV)),
            CIVector(x: CGFloat(width / radius), y: CGFloat(height / radius)),
        ]
        for p in 0..<3 {
            let k = planeOf(warp, p).radial
            func at(_ i: Int) -> CGFloat { i < k.count ? CGFloat(k[i]) : 0 }
            arguments.append(CIVector(x: at(0), y: at(1), z: at(2), w: at(3)))
        }
        for p in 0..<3 {
            let t = planeOf(warp, p).tangential
            func at(_ i: Int) -> CGFloat { i < t.count ? CGFloat(t[i]) : 0 }
            arguments.append(CIVector(x: at(0), y: at(1)))
        }
        let region = GeometryPassSupport.warpRegion(extent)
        let out = kernel.apply(extent: extent, roiCallback: { _, _ in region }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }
}
