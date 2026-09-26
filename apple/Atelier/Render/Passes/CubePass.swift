// The LOOK as a pass of the graph — the web's `cube-pass.ts` (node 6 of
// `docs/photo-editor.md` §5, and node 2 when it carries a develop).
//
// The cube SURVIVES the graph rather than being replaced by it: a picture
// with nothing but a look takes ONE kernel, and everything that already
// composes one `CubeLut` (`composeLutStack`) keeps working. The kernel is
// `Kernels/Cube.metal`, sampling TETRAHEDRALLY by default — which is what
// retired `CIColorCubeWithColorSpace` (trilinear, the one measured gap in
// "preview = the web", `native-app.md`). Trilinear stays on request, as on
// the web, where the mode is a render preference the bake must share.
//
// The pass's parameters ARE the pure record — the lattice, its strength, its
// interpolation — and the pass is a value: a new look is a new pass. The
// lattice is packed once per lattice by the context's `CubeCache`, never per
// render.

import AtelierKit
import CoreImage
import Foundation

struct CubePass: RenderPass {
    let id = "cube"

    /// The look — and the develop with it — as one lattice.
    let lut: CubeLut
    /// 0 = original, 1 = the look as authored, above 1 extrapolates past it.
    let intensity: Double
    /// How the lattice is read between its points; tetrahedral keeps a grey grey.
    let interpolation: Interpolation

    init(lut: CubeLut, intensity: Double = 1, interpolation: Interpolation = .tetrahedral) {
        self.lut = lut
        self.intensity = intensity
        self.interpolation = interpolation
    }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try graded(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    /// The pass with its failures THROWN rather than said — the gate's door,
    /// so a kernel that will not load fails a test instead of passing one on
    /// an unprocessed picture.
    func graded(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        // A kernel needs a finite extent to draw; an infinite image (a solid
        // colour) has nothing a look could change per pixel that a caller
        // could not crop first.
        guard !image.extent.isInfinite, !image.extent.isEmpty else { return image }
        let kernel = try Kernels.kernel("cubeLookup")
        let table = ctx.cubes.packed(lut)
        let tableExtent = table.extent
        // NEAREST: the kernel fetches lattice points at their pixel centres and
        // interpolates them itself, as the web's `texelFetch` does — a filtered
        // read there could only blur a neighbour in.
        let lattice = CISampler(image: table, options: [
            kCISamplerFilterMode: kCISamplerFilterNearest,
            kCISamplerWrapMode: kCISamplerWrapClamp,
        ])
        let arguments: [Any] = [
            image,
            lattice,
            NSNumber(value: Float(lut.size)),
            NSNumber(value: Float(intensity)),
            NSNumber(value: Float(interpolation == .tetrahedral ? 1 : 0)),
            CIVector(x: CGFloat(lut.domainMin.0), y: CGFloat(lut.domainMin.1), z: CGFloat(lut.domainMin.2)),
            CIVector(x: CGFloat(lut.domainMax.0), y: CGFloat(lut.domainMax.1), z: CGFloat(lut.domainMax.2)),
        ]
        // The ROI: the source is read pointwise (the destination rect), the
        // lattice wherever the colour lands (the whole table — it is small).
        let out = kernel.apply(extent: image.extent, roiCallback: { index, rect in
            index == 1 ? tableExtent : rect
        }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }

    /// The lattice as the kernel reads it: a 2D half-float image, N tiles of
    /// N×N along x — tile = blue index, x within the tile = red, y = green —
    /// alpha 1, the memory order the web's `uploadCube` expands to.
    ///
    /// A `CIImage` made from bitmap data takes its FIRST row as the TOP of
    /// the picture, and Core Image's y runs up: memory row 0 is y = N − 1. So
    /// green index g is written to memory row N − 1 − g, and the kernel reads
    /// it at y = g + 0.5 (`Cube.metal`). The gate reads the packed image back
    /// by Core Image coordinate, which pins that convention on its own.
    ///
    /// Half floats, not 8-bit: a conversion LUT's rolloff above white lives in
    /// the lattice, and an 8-bit table would clamp it (`render-core.md`, «The
    /// cube TEXTURE is float»). About 11 bits in [0,1] is a fraction of a code.
    static func pack(_ lut: CubeLut) -> CIImage {
        let n = lut.size
        let width = n * n
        let height = n
        let one = HalfFloat.bits(1)
        var halves = [UInt16](repeating: one, count: width * height * 4)
        for b in 0..<n {
            for g in 0..<n {
                let row = n - 1 - g
                for r in 0..<n {
                    // `.cube` order: red varies fastest, then green, then blue.
                    let source = (r + g * n + b * n * n) * 3
                    let dest = (row * width + b * n + r) * 4
                    halves[dest] = HalfFloat.bits(lut.data[source])
                    halves[dest + 1] = HalfFloat.bits(lut.data[source + 1])
                    halves[dest + 2] = HalfFloat.bits(lut.data[source + 2])
                }
            }
        }
        let data = halves.withUnsafeBufferPointer { Data(buffer: $0) }
        // No colour space: the numbers are the lattice's own, and nothing may
        // convert them on the way in.
        return CIImage(bitmapData: data, bytesPerRow: width * 8,
                       size: CGSize(width: width, height: height), format: .RGBAh, colorSpace: nil)
    }
}
