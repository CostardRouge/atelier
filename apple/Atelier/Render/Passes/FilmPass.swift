// The FILM node — a stock's TEXTURE, grain and halation, as ONE node of the
// graph: the web's `src/shared/render/film-pass.ts` (`makeFilmPass`) on Core
// Image, over the kernels in `Kernels/Film.metal`.
//
// Its parameters ARE the kernel's record, `FilmTexture` — every number the
// kernels take comes out of AtelierKit's own functions (`grainUniforms`,
// `grainPhase`, `grainFrameIndex`, `halationBuffer`, `gaussianKernel`,
// `makeGrainNoise`), so there is one implementation of each and it is the
// tested one (`render-film.md`).
//
// Its POSITION is fixed and no caller chooses it: it is `FrameGrader`'s film
// slot (`setFilm`), last of all — grain that a sharpen then amplified, or a
// warp resampled, would be neither grain nor sharp. A silent texture is no
// pass at all (`init?` is nil), so an unfilmed picture costs not one kernel.
//
// Two things make it the same picture at every size, both the kernel's:
// - the grain cell is a fraction of the frame's HEIGHT (`grainUniforms`), read
//   bilinearly from a 256-texel tile, so the export's grain IS the preview's,
//   resampled; the field re-rolls per SOURCE frame quantised to `grainFps`
//   (`PassContext.sourceSeconds`; a still is frame 0), never per repaint;
// - the halo is extracted and blurred in a SMALL buffer whose size and sigma
//   depend on the radius alone (`halationBuffer`), never at the render size.
//
// On the halo's way down, one deliberate departure: the web's extract samples
// the picture with ONE bilinear tap per buffer texel. Here the highlights are
// extracted at the render's own size (pointwise — Core Image tiles it) and
// brought down to the buffer by Core Image's Lanczos, which reads the whole
// picture band-limited instead of one pixel in fifty, and stays tile-friendly
// on a 48-megapixel export where a one-tap gather would need the whole graded
// picture resident at once. Where the render IS the buffer's size (the gate's
// case, and any render of that height) there is no resampling at all and the
// two are the same arithmetic. The blurred halo is kept as a cached
// intermediate, so a tiled render does not recompute it per tile.

import AtelierKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

struct FilmPass: RenderPass {
    /// ONE id for every film node, as on the web.
    let id = "film"
    /// Grain and halation — never silent here.
    let texture: FilmTexture

    /// The node for a texture, or nil when there is nothing to draw
    /// (`isSilentTexture`) — so the slot stays empty and costs nothing.
    init?(_ texture: FilmTexture?) {
        guard let texture, !isSilentTexture(texture) else { return nil }
        self.texture = texture
    }

    /// The node a GRADE asks for — its `film`, read through the ONE reader
    /// every document goes through (`filmTextureOrNull`). The texture belongs
    /// to the grade, not to the film layer whose stock it came from.
    static func from(_ grade: RollGrade?) -> FilmPass? {
        FilmPass(filmTextureOrNull(grade?.film))
    }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try filmed(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    /// The pass with its failures THROWN — the gate's door.
    func filmed(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        guard !image.extent.isInfinite, !image.extent.isEmpty else { return image }
        let frame = image.extent
        let width = Double(frame.width)
        let height = Double(frame.height)

        let uniforms = grainUniforms(texture, width, height)
        let frameIndex = grainFrameIndex(ctx.sourceSeconds ?? 0, texture.grainFps)
        let phase = grainPhase(frameIndex, texture.seed)
        let tile = FilmTiles.tile(seed: texture.seed)
        let halo = try self.halo(image, width: width, height: height)
        let haloImage = halo?.image ?? MaskRasterImage.constant(0, over: CGRect(x: 0, y: 0, width: 1, height: 1))
        let haloSize = halo?.size ?? CGSize(width: 1, height: 1)

        let norm = 1 / (1 + octaveWeight * octaveWeight).squareRoot()
        let arguments: [Any] = [
            image,
            FilmTiles.sampler(tile.rgb),
            FilmTiles.sampler(tile.luma),
            MaskRasterImage.sampler(haloImage),
            CIVector(cgRect: frame),
            CIVector(x: CGFloat(uniforms.aspect.0 * uniforms.scale), y: CGFloat(uniforms.aspect.1 * uniforms.scale),
                     z: CGFloat(phase.0), w: CGFloat(phase.1)),
            // The fade is the one resolution-dependent term, and deliberately
            // so: a cell finer than the render can resolve fades out rather
            // than aliasing.
            CIVector(x: CGFloat(uniforms.amount * uniforms.fade), y: CGFloat(uniforms.chroma),
                     z: CGFloat(noiseSize), w: CGFloat(grainGain)),
            CIVector(x: CGFloat(octaveScale), y: CGFloat(octaveWeight), z: CGFloat(norm), w: 0),
            CIVector(x: CGFloat(texture.halation), y: halo == nil ? 0 : 1,
                     z: haloSize.width, w: haloSize.height),
            CIVector(x: CGFloat(texture.halationTint.0), y: CGFloat(texture.halationTint.1),
                     z: CGFloat(texture.halationTint.2)),
        ]
        let kernel = try Kernels.kernel("filmNode")
        let tileExtent = tile.rgb.extent
        let haloExtent = haloImage.extent
        let out = kernel.apply(extent: frame, roiCallback: { index, rect in
            switch index {
            case 1, 2: return tileExtent
            case 3: return haloExtent
            default: return rect
            }
        }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }

    // MARK: - the halo

    /// The blurred highlights, in the small buffer `halationBuffer` sizes, at
    /// the origin — or nil when the texture draws no halation.
    func halo(_ image: CIImage, width: Double, height: Double) throws -> (image: CIImage, size: CGSize)? {
        guard let buffer = halationBuffer(texture, width, height) else { return nil }
        let frame = image.extent
        let box = CGRect(x: 0, y: 0, width: buffer.w, height: buffer.h)

        let extract = try Kernels.kernel("filmExtract")
        guard let lit = extract.apply(extent: frame, roiCallback: { _, rect in rect },
                                      arguments: [image, NSNumber(value: Float(texture.halationThreshold))]) else {
            throw KernelError.applyFailed(pass: id)
        }
        var highlights = frame.origin == .zero
            ? lit
            : lit.transformed(by: CGAffineTransform(translationX: -frame.minX, y: -frame.minY))
        let sameSize = buffer.w == Int(width.rounded()) && buffer.h == Int(height.rounded())
        if !sameSize {
            let lanczos = CIFilter.lanczosScaleTransform()
            lanczos.inputImage = highlights.clampedToExtent()
            let scale = Double(buffer.h) / height
            lanczos.scale = Float(scale)
            lanczos.aspectRatio = Float((Double(buffer.w) / width) / scale)
            guard let resampled = lanczos.outputImage else { throw KernelError.applyFailed(pass: id) }
            highlights = resampled.cropped(to: box)
        }

        let weights = gaussianKernel(buffer.sigma, halationTaps(buffer.sigma))
        let across = try blur(highlights, weights: weights, dx: 1, dy: 0, box: box)
        let down = try blur(across, weights: weights, dx: 0, dy: 1, box: box)
        // Cached whatever the context says: the composite reads the whole
        // buffer from every tile of a large render, and it is small.
        return (down.insertingIntermediate(cache: true), box.size)
    }

    /// One axis of the separable Gaussian over the buffer, clamped at its edge.
    private func blur(_ image: CIImage, weights: [Double], dx: CGFloat, dy: CGFloat, box: CGRect) throws -> CIImage {
        let taps = weights.count
        let reach = (taps - 1) / 2
        // The kernel's weights from the centre out: tap k weighs w[|k|].
        var half = [Float](repeating: 0, count: 40)
        for j in 0...min(reach, 39) {
            half[j] = Float(weights[reach + j])
        }
        var arguments: [Any] = [
            image,
            CIVector(x: dx, y: dy, z: CGFloat(taps), w: 0),
            CIVector(cgRect: box),
        ]
        for i in 0..<10 {
            arguments.append(CIVector(x: CGFloat(half[i * 4]), y: CGFloat(half[i * 4 + 1]),
                                      z: CGFloat(half[i * 4 + 2]), w: CGFloat(half[i * 4 + 3])))
        }
        let kernel = try Kernels.kernel("filmBlur")
        let grow = CGFloat(reach + 1)
        let out = kernel.apply(extent: box, roiCallback: { _, rect in
            rect.insetBy(dx: -grow * dx, dy: -grow * dy).intersection(box)
        }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }
}

/// The grain's noise tile — `makeGrainNoise(seed)`, 256 × 256 texels of four
/// independent fields — as the two images the node reads: the three
/// per-channel fields, and the luma field (the tile's alpha) on its own, each
/// with alpha 255 so nothing premultiplies a field. Made once per seed.
enum FilmTiles {
    private static let lock = NSLock()
    private static var held: [(seed: Double, rgb: CIImage, luma: CIImage)] = []

    static func tile(seed: Double) -> (rgb: CIImage, luma: CIImage) {
        lock.lock()
        defer { lock.unlock() }
        if let hit = held.first(where: { $0.seed == seed }) { return (hit.rgb, hit.luma) }
        let bytes = makeGrainNoise(seed)
        let count = noiseSize * noiseSize
        var rgb = [UInt8](repeating: 255, count: count * 4)
        var luma = [UInt8](repeating: 255, count: count * 4)
        for i in 0..<count {
            rgb[i * 4] = bytes[i * 4]
            rgb[i * 4 + 1] = bytes[i * 4 + 1]
            rgb[i * 4 + 2] = bytes[i * 4 + 2]
            let l = bytes[i * 4 + 3]
            luma[i * 4] = l
            luma[i * 4 + 1] = l
            luma[i * 4 + 2] = l
        }
        let made = (seed: seed, rgb: image(rgb), luma: image(luma))
        held.insert(made, at: 0)
        if held.count > 4 { held.removeLast(held.count - 4) }
        return (made.rgb, made.luma)
    }

    /// NEAREST: the node reads each texel at its centre and blends the four
    /// itself, wrapping the indices as REPEAT would.
    static func sampler(_ tile: CIImage) -> CISampler {
        CISampler(image: tile, options: [
            kCISamplerFilterMode: kCISamplerFilterNearest,
            kCISamplerWrapMode: kCISamplerWrapClamp,
        ])
    }

    /// Memory row 0 is the tile's row 0 — the TOP of the image in Core Image,
    /// which is where the node looks for it.
    private static func image(_ bytes: [UInt8]) -> CIImage {
        let data = bytes.withUnsafeBufferPointer { Data(buffer: $0) }
        return CIImage(bitmapData: data, bytesPerRow: noiseSize * 4,
                       size: CGSize(width: noiseSize, height: noiseSize), format: .RGBA8, colorSpace: nil)
    }
}
