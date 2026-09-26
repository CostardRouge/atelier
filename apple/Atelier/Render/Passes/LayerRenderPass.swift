// ONE adjustment layer as a pass of the graph — the web's
// `src/shared/render/layer-pass.ts` (`makeLayerPass`) on Core Image, over the
// kernels in `Kernels/Layers.metal`.
//
// The pass's parameters ARE the kernel's resolved record: AtelierKit's
// `LayerPass` (`Develop/LayerRender.swift`) — the layer's develop already
// baked into a cube by `composeLutStack` with no look and no transform, its
// mask, invert, opacity, the source's aspect, its parts, the painted maps and
// the finish. Nothing here re-decides any of that; it turns the record into
// kernel arguments.
//
// How it draws, lazily:
//
//     mask  = own component → each PART combined in order   (layerMask* kernels)
//     looked = the CUBE pass over the picture                (Cube.metal, reused)
//     out   = layerMix(picture, looked, mask, except, opacity)
//
// so a local exposure is the very lookup the look uses — the one tested
// kernel, never a second copy — and the order of the mask is `layerWeight`'s.
// `finish: .outline` draws the line where that same mask crosses one half
// instead (`layerOutline`), so show-the-mask shows what the render really cuts.
//
// A RASTER reaches the kernel as an image: a painted mask's `BrushRaster`
// (rasterised from its strokes when the record holds none, the kernel's own
// `rasteriseBrush`), or a SUBJECT's map as the Vision side hands it over
// (`SubjectMasks`) — a single-channel image read in its red channel. A raster
// kind with no map covers NOTHING (an empty painting, a subject the model has
// not answered); a subtraction with no map subtracts nothing.

import AtelierKit
import CoreImage
import Foundation

struct LayerRenderPass: RenderPass {
    /// `layer:<id>` — the kernel record's own id, so two layers never read as one.
    let id: String
    /// The resolved record the pass draws.
    let layer: LayerPass
    /// The layer's own mask as a map, for the two raster kinds; nil otherwise
    /// — and nil for a raster kind with nothing to draw, which covers nothing.
    let raster: CIImage?
    /// The map of the subject SUBTRACTED from this layer, or nil for none.
    let except: CIImage?
    /// Each part's map, by index — nil for a shape, or an empty painting.
    let partRasters: [CIImage?]

    /// `subject` is the map of a SUBJECT layer's own mask, and `except` the
    /// map of the subject it subtracts — both as `SubjectMasks` hands them
    /// over, and both winning over a `BrushRaster` the record may carry.
    init(_ layer: LayerPass, subject: CIImage? = nil, except: CIImage? = nil) {
        self.id = layer.id
        self.layer = layer
        switch layer.mask {
        case .subject?:
            raster = subject.map(MaskRasterImage.normalised) ?? layer.raster.map(MaskRasterImage.image)
        case .brush(let brush)?:
            raster = MaskRasterImage.painted(brush, given: layer.raster, aspectRatio: layer.aspectRatio)
        default:
            raster = nil
        }
        self.except = except.map(MaskRasterImage.normalised) ?? layer.except.map(MaskRasterImage.image)
        partRasters = layer.parts.indices.map { i -> CIImage? in
            guard case .brush(let brush) = layer.parts[i].mask else { return nil }
            let given = i < layer.partRasters.count ? layer.partRasters[i] : nil
            return MaskRasterImage.painted(brush, given: given, aspectRatio: layer.aspectRatio)
        }
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
        guard !image.extent.isInfinite, !image.extent.isEmpty else { return image }
        let frame = image.extent
        let shape = try mask(over: image, frame: frame)
        switch layer.finish {
        case .grade:
            return try graded(image, shape: shape, frame: frame, ctx)
        case .outline:
            return try outlined(image, shape: shape, frame: frame)
        }
    }

    /// The mask alone, as an image the size of the picture — the value in
    /// every channel, before the `except` hole and the opacity. What the gate
    /// reads to hold the mask chain to `layerWeight` without a cube between.
    func mask(over image: CIImage, frame: CGRect) throws -> CIImage {
        // Nothing to carry into the first component: a constant it ignores.
        var m = try component(layer.mask, raster: raster, op: -1, invert: layer.invert,
                              prev: MaskRasterImage.constant(0, over: frame), source: image, frame: frame)
        for (i, part) in layer.parts.enumerated() {
            let map = i < partRasters.count ? partRasters[i] : nil
            m = try component(part.mask, raster: map, op: LayerRenderPass.code(part.op), invert: part.invert,
                              prev: m, source: image, frame: frame)
        }
        return m
    }

    /// `combineMask`'s ops as the kernel reads them: −1 is the layer's OWN
    /// mask, whose value replaces what is there.
    static func code(_ op: MaskOp) -> Float {
        switch op {
        case .add: return 0
        case .subtract: return 1
        case .intersect: return 2
        }
    }

    // MARK: - the mask, one component at a time

    /// The frame in the shared centred space: `framePoint`'s scale on each axis.
    private var span: CIVector {
        let ar = layer.aspectRatio.isFinite && layer.aspectRatio > 0 ? layer.aspectRatio : 1
        let d = hypot(ar, 1)
        return CIVector(x: CGFloat(ar / d * 2), y: CGFloat(1 / d * 2))
    }

    private func component(_ mask: Mask?, raster: CIImage?, op: Float, invert: Bool, prev: CIImage,
                           source: CIImage, frame: CGRect) throws -> CIImage {
        let frameVector = CIVector(cgRect: frame)
        let flip: CGFloat = invert ? 1 : 0
        let rule = { (third: Double, fourth: Double) in
            CIVector(x: CGFloat(op), y: flip, z: CGFloat(third), w: CGFloat(fourth))
        }
        guard let mask else {
            // No mask is the WHOLE picture — a layer starts global.
            return try run("layerMaskFlat", [prev, NSNumber(value: Float(1)), rule(0, 0)], extent: frame)
        }
        switch mask {
        case .linear(let m):
            let (cx, cy) = framePoint(m.x, m.y, layer.aspectRatio)
            let a = m.angle * Double.pi / 180
            // At angle 0 the direction points UP the frame — the covered side
            // is the top — and turning it is a compass bearing from there.
            let shape = CIVector(x: CGFloat(cx), y: CGFloat(cy), z: CGFloat(sin(a)), w: CGFloat(-cos(a)))
            return try run("layerMaskLinear", [prev, frameVector, span, shape, rule(max(m.feather, 0), 0)],
                           extent: frame)
        case .radial(let m):
            let (cx, cy) = framePoint(m.x, m.y, layer.aspectRatio)
            let a = m.angle * Double.pi / 180
            let shape = CIVector(x: CGFloat(cx), y: CGFloat(cy), z: CGFloat(m.radiusX), w: CGFloat(m.radiusY))
            let turn = CIVector(x: CGFloat(cos(a)), y: CGFloat(sin(a)))
            return try run("layerMaskRadial", [prev, frameVector, span, shape, turn, rule(max(m.feather, 0), 0)],
                           extent: frame)
        case .luma(let m):
            let band = CIVector(x: CGFloat(m.from), y: CGFloat(m.to))
            return try run("layerMaskLuma", [source, prev, band, rule(max(m.feather, 0), 0)], extent: frame)
        case .colour(let m):
            // The samples go in already in the OPPONENT space the kernel
            // compares in, so the per-pixel work is the pixel's own conversion.
            var packed = [Float](repeating: 0, count: 16)
            let samples = Array(m.samples.prefix(maxColourSamples))
            for (k, s) in samples.enumerated() {
                packed[k * 3] = Float(s.r - s.g)
                packed[k * 3 + 1] = Float((s.r + s.g) * 0.5 - s.b)
                packed[k * 3 + 2] = Float(lumaOf(s.r, s.g, s.b))
            }
            // Four float4s, built one statement at a time: a closure over
            // four CGFloat conversions and an [Any] target is more than
            // Xcode's type checker will solve in reasonable time.
            var args: [Any] = [source, prev, rule(Double(samples.count), colourReach(m.range))]
            for i in 0..<4 {
                let x = CGFloat(packed[i * 4])
                let y = CGFloat(packed[i * 4 + 1])
                let z = CGFloat(packed[i * 4 + 2])
                let w = CGFloat(packed[i * 4 + 3])
                args.append(CIVector(x: x, y: y, z: z, w: w))
            }
            return try run("layerMaskColour", args, extent: frame)
        case .brush, .subject:
            guard let raster else {
                // A raster kind with no map covers NOTHING — an empty shape is
                // empty, and treating it as the whole picture would make a
                // fresh brush layer apply everywhere.
                return try run("layerMaskFlat", [prev, NSNumber(value: Float(0)), rule(0, 0)], extent: frame)
            }
            let size = CIVector(x: raster.extent.width, y: raster.extent.height)
            return try run("layerMaskRaster", [prev, MaskRasterImage.sampler(raster), frameVector, size, rule(0, 0)],
                           extent: frame, fixed: [1: raster.extent])
        }
    }

    // MARK: - the finishes

    private func graded(_ image: CIImage, shape: CIImage, frame: CGRect, _ ctx: PassContext) throws -> CIImage {
        // The layer's develop through the graph's own cube kernel, its lattice
        // packed once by the context's cache.
        let looked = try CubePass(lut: layer.lut, intensity: 1, interpolation: layer.interpolation).graded(image, ctx)
        let cut = except ?? MaskRasterImage.constant(0, over: CGRect(x: 0, y: 0, width: 1, height: 1))
        let args: [Any] = [
            image, looked, shape, MaskRasterImage.sampler(cut),
            CIVector(cgRect: frame),
            CIVector(x: cut.extent.width, y: cut.extent.height),
            CIVector(x: CGFloat(min(1, max(0, layer.opacity))), y: except == nil ? 0 : 1),
        ]
        return try run("layerMix", args, extent: frame, fixed: [3: cut.extent])
    }

    private func outlined(_ image: CIImage, shape: CIImage, frame: CGRect) throws -> CIImage {
        let cut = except ?? MaskRasterImage.constant(0, over: CGRect(x: 0, y: 0, width: 1, height: 1))
        // The mask is read 1.5 pixels either side, bilinearly, clamped at the
        // frame's edge rather than faded into the clear outside it.
        let clamped = CISampler(image: shape, options: [
            kCISamplerFilterMode: kCISamplerFilterLinear,
            kCISamplerWrapMode: kCISamplerWrapClamp,
        ])
        let args: [Any] = [
            image, clamped, MaskRasterImage.sampler(cut),
            CIVector(cgRect: frame),
            CIVector(x: cut.extent.width, y: cut.extent.height),
            NSNumber(value: Float(except == nil ? 0 : 1)),
        ]
        return try run("layerOutline", args, extent: frame,
                       grown: [1: 3], fixed: [2: cut.extent])
    }

    // MARK: - one kernel

    /// A general kernel over `extent`. Every input is read pointwise (the ROI
    /// is the destination rect) unless it is `grown` by some pixels (a read
    /// either side of the point) or `fixed` to an extent of its own (a map
    /// sampled wherever its coordinates land). Sampler arguments come FIRST
    /// in every kernel here, so an argument's index is its sampler's index.
    private func run(_ name: String, _ arguments: [Any], extent: CGRect,
                     grown: [Int: CGFloat] = [:], fixed: [Int: CGRect] = [:]) throws -> CIImage {
        let kernel = try Kernels.kernel(name)
        let out = kernel.apply(extent: extent, roiCallback: { index, rect in
            let i = Int(index)
            if let held = fixed[i] { return held }
            if let by = grown[i] { return rect.insetBy(dx: -by, dy: -by) }
            return rect
        }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }
}

/// A mask's alpha map as the layer kernels read it: an image at the origin,
/// the value in its red channel, first memory row at the TOP of the picture,
/// read LINEAR and clamped at its edge.
enum MaskRasterImage {
    /// A `BrushRaster` — one byte per texel, row-major from the top — as an
    /// 8-bit image with the byte in every colour channel and alpha 255, so no
    /// premultiplication can touch it. No colour space: the numbers are the
    /// map's own.
    static func image(_ raster: BrushRaster) -> CIImage {
        let count = raster.width * raster.height
        var bytes = [UInt8](repeating: 255, count: count * 4)
        for i in 0..<min(count, raster.data.count) {
            let v = raster.data[i]
            bytes[i * 4] = v
            bytes[i * 4 + 1] = v
            bytes[i * 4 + 2] = v
        }
        let data = bytes.withUnsafeBufferPointer { Data(buffer: $0) }
        return CIImage(bitmapData: data, bytesPerRow: raster.width * 4,
                       size: CGSize(width: raster.width, height: raster.height), format: .RGBA8, colorSpace: nil)
    }

    /// A painted mask's map: the one the record holds, else its strokes
    /// rasterised — the kernel's own `rasteriseBrush`, the same function the
    /// web's pass calls when handed nothing; nil for no strokes (covers nothing).
    static func painted(_ brush: BrushMask, given: BrushRaster?, aspectRatio: Double) -> CIImage? {
        if let given { return image(given) }
        return brush.strokes.isEmpty ? nil : image(rasteriseBrush(brush.strokes, aspectRatio))
    }

    /// A map handed over as an image (a subject's), moved to the origin so
    /// its extent IS its size in texels.
    static func normalised(_ map: CIImage) -> CIImage {
        let origin = map.extent.origin
        return origin == .zero ? map : map.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
    }

    /// A map as the kernels sample it: LINEAR between texels and CLAMPED at
    /// the edge — the web's texture parameters for an alpha map.
    static func sampler(_ map: CIImage) -> CISampler {
        CISampler(image: map, options: [
            kCISamplerFilterMode: kCISamplerFilterLinear,
            kCISamplerWrapMode: kCISamplerWrapClamp,
        ])
    }

    /// One value everywhere over `rect` — 0 or 1, which no colour handling
    /// can move.
    static func constant(_ value: CGFloat, over rect: CGRect) -> CIImage {
        CIImage(color: CIColor(red: value, green: value, blue: value, alpha: 1)).cropped(to: rect)
    }
}
