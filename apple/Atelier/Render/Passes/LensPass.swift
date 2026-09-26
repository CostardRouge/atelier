// The LENS correction as a pass — the web's `lens-pass.ts`: distortion, lateral
// CA and vignetting as ONE radial pass, with a MEASURED profile (Lensfun, the
// picture's own resolved `LensProfileTerms`) composed under the sliders in the
// same pass. The kernel is `Kernels/Lens.metal`; its twins are
// `lensSampleRadius`, `chromaScales`, `vignetteTerms` / `vignetteEncoded`,
// `profileSourceRadius`, `profileChannelRadius` and `profileVignetteGain`
// (AtelierKit's `Render/Lens.swift`).
//
// Second of the three warps (`PictureGeometry.swift`). The reaches the sliders
// can ask for are bounded by MONOTONICITY in the twin, so the corners cannot
// fold; `vignetteTerms` is what hands the kernel the vignette's reach, so the
// number is stated once.

import AtelierKit
import CoreImage
import Foundation

struct LensPass: RenderPass {
    let id = "lens"
    static let kernelName = "lensCorrection"

    /// The sliders — `LensCorrection.default` when only a profile is applied.
    let lens: LensCorrection
    /// The SOURCE's width / height: the pass runs at source density, before
    /// any crop, so the radius is normalised to the whole frame's half-diagonal.
    let aspectRatio: Double
    /// A measured profile in this pass's units — `noProfileTerms` for none.
    let profile: LensProfileTerms

    /// The web's `makeLensPass`: nil when the correction does nothing — a
    /// caller then runs one fewer pass rather than a no-op resample.
    static func make(_ lens: LensCorrection?, aspectRatio: Double = 1, profile: LensProfileTerms? = nil) -> LensPass? {
        let noProfile = isIdentityProfile(profile)
        if isDefaultLens(lens) && noProfile { return nil }
        let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
        let terms = noProfile ? noProfileTerms : (profile ?? noProfileTerms)
        return LensPass(lens: lens ?? .default, aspectRatio: ar, profile: terms)
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
        let (k1, k2) = distortionTerms(lens)
        let (red, blue) = chromaScales(lens)
        let vignette = vignetteTerms(lens)
        // The frame in a space whose half-DIAGONAL is 1: the corner is then at
        // radius 1 whatever the shape — the unit `Lens.swift` normalises to,
        // and the one `Lensfun.swift` converts a profile into.
        let diagonal = (aspectRatio * aspectRatio + 1).squareRoot()
        let p = profile
        func term(_ list: [Double], _ i: Int, _ fallback: Double) -> CGFloat {
            CGFloat(i < list.count ? list[i] : fallback)
        }
        let arguments: [Any] = [
            image.clampedToExtent(),
            GeometryPassSupport.extentVector(extent),
            CIVector(x: CGFloat(aspectRatio / diagonal * 2), y: CGFloat(1 / diagonal * 2)),
            CIVector(x: CGFloat(k1), y: CGFloat(k2)),
            CIVector(x: CGFloat(red), y: CGFloat(blue)),
            CIVector(x: CGFloat(vignette.amount), y: CGFloat(vignette.start)),
            CIVector(x: term(p.distortion, 0, 0), y: term(p.distortion, 1, 0),
                     z: term(p.distortion, 2, 0), w: term(p.distortion, 3, 0)),
            CIVector(x: term(p.tcaRed, 0, 1), y: term(p.tcaRed, 1, 0), z: term(p.tcaRed, 2, 0)),
            CIVector(x: term(p.tcaBlue, 0, 1), y: term(p.tcaBlue, 1, 0), z: term(p.tcaBlue, 2, 0)),
            CIVector(x: term(p.vignette, 0, 0), y: term(p.vignette, 1, 0), z: term(p.vignette, 2, 0)),
        ]
        let region = GeometryPassSupport.warpRegion(extent)
        let out = kernel.apply(extent: extent, roiCallback: { _, _ in region }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }
}
