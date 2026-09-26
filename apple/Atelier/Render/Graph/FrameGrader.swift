// The graph, assembled — the web's `graph-grader.ts` + `lut/frame-grader.ts`:
// the ONE seam every renderer reaches the GPU through.
//
// The order is the product, and no caller chooses it:
//
//     SOURCE → [before…] → CUBE → [after…] → [FILM] → OUTPUT
//
// `before` runs on the SOURCE — the camera's gain map, the repair patches,
// the denoise and the defringe (`detail.ts`, «Order»); the CUBE is the
// develop and the look, with headroom; `after` is what shapes and finishes
// the picture — the camera warp, the lens, the keystone, the adjustment
// layers, presence and sharpen last of every warp, the post-crop vignette;
// the FILM slot is last of all, in a position no caller chooses: grain that
// a sharpen then amplified, or a keystone resampled, would be neither grain
// nor sharp (`render-film.md`). It is empty until the film task fills it.
//
// A grader is kept and its passes SWAPPED, not rebuilt: on the web a rebuild
// was a new WebGL2 context per slider step (`render-core.md`). Here a swap is
// free by construction — a pass is a value and a render is a recipe — and the
// one thing worth keeping across renders, the packed lattices, lives in the
// grader's `CubeCache`, handed to every pass through its context.
//
// A render returns a RECIPE (`CIImage`) built from the passes held at that
// moment: swapping them afterwards never changes a recipe already handed out,
// so a stage render in flight and the next slider step cannot interfere.

import AtelierKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

final class FrameGrader {
    /// The packed lattices this grader's renders share.
    let cubes: CubeCache

    private let lock = NSLock()
    private var pre: [RenderPass]
    private var look: CubePass?
    private var extra: [RenderPass]
    private var filmPass: RenderPass?

    init(lut: CubeLut? = nil, intensity: Double = 1, interpolation: Interpolation = .tetrahedral,
         before: [RenderPass] = [], after: [RenderPass] = [], film: RenderPass? = nil,
         cubes: CubeCache = CubeCache()) {
        self.cubes = cubes
        pre = before
        look = lut.map { CubePass(lut: $0, intensity: intensity, interpolation: interpolation) }
        extra = after
        filmPass = film
    }

    /// A new look — nil for none, and then the cube costs no node at all,
    /// exactly as the web's `u_hasLut = false` returns the source.
    func setCube(_ lut: CubeLut?, intensity: Double = 1, interpolation: Interpolation = .tetrahedral) {
        let next = lut.map { CubePass(lut: $0, intensity: intensity, interpolation: interpolation) }
        lock.lock()
        look = next
        lock.unlock()
    }

    /// The passes after the look and — second — those BEFORE it, on the
    /// source, replaced in place: the web's `setExtraPasses(passes, before)`.
    func setExtraPasses(_ after: [RenderPass], before: [RenderPass] = []) {
        lock.lock()
        extra = after
        pre = before
        lock.unlock()
    }

    /// The film node, replaced in place: the web's `setFilm`.
    func setFilm(_ film: RenderPass?) {
        lock.lock()
        filmPass = film
        lock.unlock()
    }

    /// The look held, if any.
    var cube: CubePass? {
        lock.lock()
        defer { lock.unlock() }
        return look
    }

    /// Every node in the order it draws — the cube only while it holds a
    /// lattice, the film only while its slot is filled.
    var passes: [RenderPass] {
        lock.lock()
        defer { lock.unlock() }
        var list: [RenderPass] = pre
        if let look { list.append(look) }
        list.append(contentsOf: extra)
        if let filmPass { list.append(filmPass) }
        return list
    }

    /// The recipe for `source` through every pass. `sourceSeconds` is which
    /// instant of the SOURCE this frame is (the film node's clock; a still
    /// passes nothing); `sourceScale` is this render's pixels per source
    /// pixel, for a kernel sized in source pixels. Nothing to draw hands the
    /// source itself back.
    func render(source: CIImage, sourceSeconds: Double? = nil, sourceScale: Double = 1) -> CIImage {
        let ctx = PassContext(renderSize: source.extent.size, sourceScale: sourceScale,
                              sourceSeconds: sourceSeconds, cubes: cubes)
        var image = source
        for pass in passes {
            image = pass.apply(image, ctx)
        }
        return image
    }

    /// `source` graded and rendered: fitted inside `size` first (never up —
    /// the develop is per pixel and commutes with a resample to within the
    /// resample's own rounding; a kernel sized in source pixels is told the
    /// scale), or at its own size when `size` is nil.
    func image(_ source: CIImage, size: CGSize? = nil, sourceSeconds: Double? = nil,
               context: CIContext = RenderContexts.shared) -> CGImage? {
        let fitted = size.map { FrameGrader.fit(source, within: $0) } ?? (image: source, scale: 1)
        let recipe = render(source: fitted.image, sourceSeconds: sourceSeconds, sourceScale: fitted.scale)
        return FrameGrader.cgImage(recipe, context: context)
    }

    // MARK: - out

    /// A recipe rendered to 8-bit pixels through the graph's context, tagged
    /// sRGB — the codes are sRGB codes throughout, and the tag says so.
    static func cgImage(_ recipe: CIImage, context: CIContext = RenderContexts.shared) -> CGImage? {
        let extent = recipe.extent
        guard !extent.isInfinite, !extent.isEmpty else { return nil }
        return context.createCGImage(recipe, from: extent, format: .RGBA8, colorSpace: RenderContexts.srgb)
    }

    // MARK: - resampling

    /// `image` fitted inside `size`, never enlarged, and the scale it took.
    static func fit(_ image: CIImage, within size: CGSize) -> (image: CIImage, scale: Double) {
        let w = image.extent.width
        let h = image.extent.height
        guard w > 0, h > 0 else { return (image, 1) }
        let scale = min(size.width / w, size.height / h)
        return resampled(image, scale: Double(scale))
    }

    /// `image` with its long edge brought down to `longEdge`, never up, and the scale it took.
    static func fit(_ image: CIImage, longEdge: Int) -> (image: CIImage, scale: Double) {
        let edge = max(image.extent.width, image.extent.height)
        guard edge > 0 else { return (image, 1) }
        return resampled(image, scale: Double(CGFloat(longEdge) / edge))
    }

    /// Lanczos-resampled by `scale` (< 1), the extent kept integral and at
    /// the origin; unchanged at 1 or above. The edge is CLAMPED before the
    /// filter reads past it, or the outermost pixels average in the clear
    /// outside the picture and come back part-transparent.
    static func resampled(_ image: CIImage, scale: Double) -> (image: CIImage, scale: Double) {
        guard scale < 1 else { return (image, 1) }
        let s = CGFloat(scale)
        let w = image.extent.width
        let h = image.extent.height
        let filter = CIFilter.lanczosScaleTransform()
        filter.inputImage = image.clampedToExtent()
        filter.scale = Float(scale)
        filter.aspectRatio = 1
        let out = filter.outputImage ?? image.transformed(by: CGAffineTransform(scaleX: s, y: s))
        let cropped = out.cropped(to: CGRect(x: 0, y: 0, width: (w * s).rounded(), height: (h * s).rounded()))
        return (cropped, scale)
    }
}
