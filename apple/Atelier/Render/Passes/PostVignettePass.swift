// The POST-CROP VIGNETTE as a pass — the web's `post-vignette-pass.ts` plus
// `develop/vignette-frame.ts`'s `postVignettePass`: shaped in the DELIVERED
// frame through the affine the crop is drawn with (`frameAffine`, AtelierKit's
// `Render/PostVignette.swift`), so a crop that pans or turns carries it along.
// The kernel is `Kernels/PostVignette.metal`; its twin is `postVignetteAt`.
//
// After the sharpen and presence — an effect on the finished picture — and
// PART of the picture: the histogram, a snapshot and the export all carry it.
// The map depends on the ASPECTS alone, so a second render at another size
// builds the same pass.

import AtelierKit
import CoreImage
import Foundation

struct PostVignettePass: RenderPass {
    let id = "post-vignette"
    static let kernelName = "postCropVignette"

    let vignette: PostCropVignette
    /// Image [0,1]² → the delivered frame's [0,1]², both y down.
    let affine: FrameAffine
    /// The delivered frame's width / height.
    let frameAspect: Double

    /// The web's `makePostVignettePass`: nil when there is nothing to draw —
    /// only Amount does anything.
    static func make(_ vignette: PostCropVignette?, affine: FrameAffine, frameAspect: Double) -> PostVignettePass? {
        guard let vignette, vignette.amount != 0 else { return nil }
        return PostVignettePass(vignette: vignette, affine: affine, frameAspect: frameAspect)
    }

    /// The web's `postVignettePass` (`vignette-frame.ts`): the pass for a
    /// picture's vignette in the frame its crop cuts, or nil when it has none.
    static func make(_ vignette: PostCropVignette?, sourceWidth: Double, sourceHeight: Double,
                     frameRatio: Double, framing: Framing?) -> PostVignettePass? {
        guard let vignette, vignette.amount != 0, sourceWidth > 0, sourceHeight > 0, frameRatio > 0 else { return nil }
        return make(vignette, affine: frameAffine(sourceWidth, sourceHeight, frameRatio, framing), frameAspect: frameRatio)
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
        let t = postVignetteTerms(vignette)
        let a = affine
        let arguments: [Any] = [
            image,
            GeometryPassSupport.extentVector(image.extent),
            CIVector(x: CGFloat(a.a), y: CGFloat(a.b), z: CGFloat(a.c)),
            CIVector(x: CGFloat(a.d), y: CGFloat(a.e), z: CGFloat(a.f)),
            NSNumber(value: Float(frameAspect)),
            NSNumber(value: Float(t.amount)),
            NSNumber(value: Float(t.start)),
            NSNumber(value: Float(t.width)),
            NSNumber(value: Float(t.roundness)),
            NSNumber(value: Float(t.highlights)),
        ]
        // Pointwise: each output pixel reads the one under it.
        let out = kernel.apply(extent: image.extent, roiCallback: { _, rect in rect }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }
}
