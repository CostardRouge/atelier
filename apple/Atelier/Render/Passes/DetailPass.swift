// DETAIL as passes of the graph — the web's `detail-pass.ts`: colour noise
// (two passes, X then Y), luminance noise, defringe, sharpen. The kernels are
// `Kernels/Detail.metal`; the pure twins the gate holds them to are
// AtelierKit's `chromaBlurAt`, `bilateralAt`, `defringeAt`, `sharpenAt`
// (`Render/Detail.swift`).
//
// A pass's parameters ARE the pure record — the picture's `DetailSettings` —
// and the numbers the kernel takes are the twin's own `detailTerms`, computed
// at draw time from the render's scale: kernels are sized in SOURCE pixels,
// so a stage working to a pixel budget blurs and sharpens the same part of
// the scene as the export (`render-detail.md`, «Kernels are in SOURCE
// pixels»). The scale is `PassContext.sourceScale` (the render's own fit)
// times `decodeScale` (a source decoded smaller than its file — a half-size
// RAW); `detailTerms` holds it to ≤ 1.
//
// WHERE they run is not theirs to choose (`DetailPasses.swift`): noise and
// fringe BEFORE the cube, on the source; the sharpen LAST, after every warp
// and layer, so nothing resamples it.
//
// Every kernel reads a neighbourhood, so every one declares its ROI: the
// destination rect grown by the farthest tap it reads, in THIS render's
// pixels (the terms are already scaled). Core Image renders in tiles; a tile
// whose ROI fell short would read the clear outside its intermediate and
// seam — the gate renders tile by tile to prove it does not. The input is
// clamped to its extent first, so a tap past the picture's edge reads the
// edge, as the twin's `pixelAt` and the web's CLAMP_TO_EDGE do.

import AtelierKit
import CoreImage
import Foundation

/// The kernel scale for a pass: the render's pixels per source pixel, times
/// the source's pixels per file pixel.
private func detailScale(_ ctx: PassContext, _ decodeScale: Double) -> Double {
    ctx.sourceScale * decodeScale
}

/// `kernel` over `image` clamped to its extent, drawn over `image`'s own
/// extent, every input's ROI the rect grown by `reach` along x and y.
private func neighbourhood(_ kernel: CIKernel, _ image: CIImage, reachX: CGFloat, reachY: CGFloat,
                           _ arguments: [Any], pass: String) throws -> CIImage {
    var all: [Any] = [image.clampedToExtent()]
    all.append(contentsOf: arguments)
    let out = kernel.apply(extent: image.extent, roiCallback: { _, rect in
        rect.insetBy(dx: -reachX, dy: -reachY)
    }, arguments: all)
    guard let out else { throw KernelError.applyFailed(pass: pass) }
    return out
}

/// Whether a picture can be drawn on at all: a kernel needs a finite extent.
private func drawable(_ image: CIImage) -> Bool {
    !image.extent.isInfinite && !image.extent.isEmpty
}

/// ONE step of the colour-noise blur: Cb and Cr under a Gaussian along one
/// axis, the luma untouched to the bit. Two of these, X then Y, are the
/// separable blur — the web's `chroma-x` and `chroma-y`.
struct ChromaBlurPass: RenderPass {
    let axis: BlurAxis
    let detail: DetailSettings
    /// The source's pixels per FILE pixel: 1 unless it was decoded smaller.
    var decodeScale: Double = 1

    var id: String { (axis == .x ? DetailPassId.chromaX : DetailPassId.chromaY).rawValue }

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
        guard drawable(image) else { return image }
        let terms = detailTerms(detail, pixelScale: detailScale(ctx, decodeScale))
        guard terms.chromaSigma > 0 else { return image }
        let kernel = try Kernels.kernel("detailChromaBlur")
        let reach = CGFloat(terms.chromaRadius + 1)
        let along = axis == .x ? CIVector(x: 1, y: 0) : CIVector(x: 0, y: 1)
        return try neighbourhood(kernel, image,
                                 reachX: axis == .x ? reach : 0, reachY: axis == .x ? 0 : reach,
                                 [along, NSNumber(value: Float(terms.chromaSigma)), NSNumber(value: Float(terms.chromaRadius))],
                                 pass: id)
    }
}

/// Luminance noise: the bilateral on luma over the 7×7 window — a wall
/// smooths, a step edge stays where it is. The web's `denoise`.
struct DenoisePass: RenderPass {
    let detail: DetailSettings
    var decodeScale: Double = 1

    var id: String { DetailPassId.denoise.rawValue }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try drawn(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    func drawn(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        guard drawable(image) else { return image }
        let terms = detailTerms(detail, pixelScale: detailScale(ctx, decodeScale))
        guard terms.rangeSigma > 0 else { return image }
        let kernel = try Kernels.kernel("detailBilateral")
        // The window is fixed (`bilateralRadius`); only its weights scale.
        let reach = CGFloat(bilateralRadius + 1)
        return try neighbourhood(kernel, image, reachX: reach, reachY: reach, [
            NSNumber(value: Float(terms.rangeSigma)),
            NSNumber(value: Float(terms.spatialSigma)),
            NSNumber(value: Float(bilateralRadius)),
        ], pass: id)
    }
}

/// Purple chroma at a steep luma edge, pulled toward neutral; a purple wall
/// away from any edge is left alone. The web's `defringe`.
struct DefringePass: RenderPass {
    let detail: DetailSettings
    var decodeScale: Double = 1

    var id: String { DetailPassId.defringe.rawValue }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try drawn(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    func drawn(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        guard drawable(image) else { return image }
        let terms = detailTerms(detail, pixelScale: detailScale(ctx, decodeScale))
        guard terms.defringe > 0 else { return image }
        let kernel = try Kernels.kernel("detailDefringe")
        // The twin's gates, handed to the kernel so they live in one place.
        let gates = CIVector(x: CGFloat(defringePurple.from), y: CGFloat(defringePurple.to),
                             z: CGFloat(defringeEdge.from), w: CGFloat(defringeEdge.to))
        return try neighbourhood(kernel, image, reachX: 2, reachY: 2,
                                 [NSNumber(value: Float(terms.defringe)), gates], pass: id)
    }
}

/// The unsharp mask on luma, damped by Detail, weighted by Masking, applied
/// to RGB as ONE ratio — the web's `sharpen`. `showMask` paints the Masking
/// weight instead (white where it sharpens, black where it leaves the
/// picture alone): Lightroom's Alt-drag view, asked for only by the stage
/// and the loupe, never by anything that leaves.
struct SharpenPass: RenderPass {
    let detail: DetailSettings
    var decodeScale: Double = 1
    var showMask: Bool = false

    var id: String { DetailPassId.sharpen.rawValue }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try drawn(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    func drawn(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        guard drawable(image) else { return image }
        let terms = detailTerms(detail, pixelScale: detailScale(ctx, decodeScale))
        // The mask view draws whatever the record says — white everywhere
        // when nothing is masked — as the web's does.
        guard showMask || terms.sharpenGain > 0 else { return image }
        let kernel = try Kernels.kernel("detailSharpen")
        // The Gaussian's half-window, and the Sobel's one pixel beside it.
        let reach = CGFloat(max(terms.sharpenRadius, 1) + 1)
        return try neighbourhood(kernel, image, reachX: reach, reachY: reach, [
            NSNumber(value: Float(terms.sharpenGain)),
            NSNumber(value: Float(terms.sharpenSigma)),
            NSNumber(value: Float(terms.sharpenRadius)),
            NSNumber(value: Float(terms.sharpenDamp)),
            NSNumber(value: Float(terms.sharpenMask)),
            NSNumber(value: Float(showMask ? 1 : 0)),
        ], pass: id)
    }
}
