// The camera's own SHADING as a pass — the web's `gain-map-pass.ts`: a DNG's
// GainMap grid, applied to LIGHT, FIRST of all on the source (ahead of the
// repair: a copied pixel is then copied from data the lens has been taken out
// of, and a develop is measured on a picture that is not 2.5 stops down in the
// corners — `render-gain-map.md`). The kernel is `Kernels/GainMap.metal`; its
// twins are `gainAt` and `gainEncoded` (AtelierKit's `Render/GainMapGrid.swift`).
//
// The pass's parameter IS the record: the `GainField`, packed ONCE into a small
// float image the kernel fetches four nodes of — never filtered, so the kernel
// is the literal twin of `gainAt`.

import AtelierKit
import CoreImage
import Foundation

struct GainMapPass: RenderPass {
    let id = "gain-map"
    static let kernelName = "gainMapGrid"

    let field: GainField
    /// The grid as the kernel reads it (`pack`), made once per pass.
    let grid: CIImage

    init(field: GainField) {
        self.field = field
        grid = GainMapPass.pack(field)
    }

    /// The web's `makeGainMapPass`: nil when the field would multiply nothing —
    /// no pass is worth a round trip through the transfer function.
    static func make(_ field: GainField?) -> GainMapPass? {
        guard let field, !isFlatField(field), field.cols > 0, field.rows > 0,
              field.gains.count >= field.cols * field.rows * 4 else { return nil }
        return GainMapPass(field: field)
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
        let gridExtent = grid.extent
        // NEAREST and clamped: four exact node fetches, the bilinear written
        // out in the kernel as `gainAt` writes it — a filtered read could only
        // blur a neighbour in.
        let nodes = CISampler(image: grid, options: [
            kCISamplerFilterMode: kCISamplerFilterNearest,
            kCISamplerWrapMode: kCISamplerWrapClamp,
        ])
        let arguments: [Any] = [
            image,
            nodes,
            GeometryPassSupport.extentVector(image.extent),
            CIVector(x: CGFloat(field.cols), y: CGFloat(field.rows)),
            CIVector(x: CGFloat(field.originU), y: CGFloat(field.originV)),
            CIVector(x: CGFloat(field.stepU), y: CGFloat(field.stepV)),
        ]
        // The ROI: the source pointwise (the destination rect), the grid whole —
        // it is a few kilobytes.
        let out = kernel.apply(extent: image.extent, roiCallback: { index, rect in
            index == 1 ? gridExtent : rect
        }, arguments: arguments)
        guard let out else { throw KernelError.applyFailed(pass: id) }
        return out
    }

    /// The field as the kernel reads it: a `cols × rows` 32-bit float image,
    /// node (j, i) — column j, row i counted DOWN from the top of the picture —
    /// at the pixel centre (j + 0.5, i + 0.5) in Core Image's coordinates.
    ///
    /// A bitmap's FIRST row is the TOP of the image and Core Image's y runs up
    /// (the cube's rule, `CubePass.pack`): so row i is written to memory row
    /// `rows − 1 − i`, which puts it at y = i. On the web the same grid landed
    /// upside down until `UNPACK_FLIP_Y_WEBGL` was turned off for its upload —
    /// 100 codes against the twin, the one trap of that pass
    /// (`render-gain-map.md`); here the gate reads the packed image back by
    /// coordinate and pins the convention on its own.
    static func pack(_ field: GainField) -> CIImage {
        let cols = field.cols
        let rows = field.rows
        var floats = [Float](repeating: 1, count: cols * rows * 4)
        for i in 0..<rows {
            let row = rows - 1 - i
            for j in 0..<cols {
                let source = (i * cols + j) * 4
                let dest = (row * cols + j) * 4
                floats[dest] = field.gains[source]
                floats[dest + 1] = field.gains[source + 1]
                floats[dest + 2] = field.gains[source + 2]
                floats[dest + 3] = 1
            }
        }
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        // No colour space: the numbers are gains, and nothing may convert them.
        return CIImage(bitmapData: data, bytesPerRow: cols * 16,
                       size: CGSize(width: cols, height: rows), format: .RGBAf, colorSpace: nil)
    }
}
