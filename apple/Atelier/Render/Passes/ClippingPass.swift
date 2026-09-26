// The CLIPPING VIEW as a pass — the web's `clip-pass.ts`: `clipOf` painted over
// the picture (J), Lightroom's red for highlights gone to white and blue for
// shadows crushed to black. The kernel is `Kernels/Clipping.metal`, a colour
// kernel; its twins are `clipOf` (`Histogram.swift`) and `clipMarks` /
// `readoutOf` (AtelierKit's `Render/Clipping.swift`) — the RGB strip's
// percentages count the same pixels (`luminanceHistogram`), and the readout
// under the pointer reads a painted pixel as the clip it marks.
//
// A way of LOOKING, like a mask's wash: the stage puts it after every pass that
// shapes the picture and under the mask's wash, and nothing that leaves — a
// snapshot, the histogram, an export — ever asks for it. It holds no
// parameter, so one pass serves every graph (`shared`).

import AtelierKit
import CoreImage
import Foundation

struct ClippingPass: RenderPass {
    let id = "clipping"
    static let kernelName = "clippingView"

    /// The one pass every graph shares, as the web's `clipPass` is.
    static let shared = ClippingPass()

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
        let kernel = try Kernels.colorKernel(Self.kernelName)
        let white = ClippingPass.mark(.white)
        let black = ClippingPass.mark(.black)
        let arguments: [Any] = [
            image,
            white,
            black,
            // The value the 8-bit output WILL hold: rounded to 254 is at or
            // past 253.5; rounded to 1 is under 1.5.
            NSNumber(value: Float(Double(clipWhite) - 0.5)),
            NSNumber(value: Float(Double(clipBlack) + 0.5)),
        ]
        guard let out = kernel.apply(extent: image.extent, arguments: arguments) else {
            throw KernelError.applyFailed(pass: id)
        }
        return out
    }

    /// A mark's colour as the kernel takes it, in [0,1].
    static func mark(_ clip: Clip) -> CIVector {
        let m = clipMarks[clip] ?? (r: 0, g: 0, b: 0)
        return CIVector(x: CGFloat(m.r) / 255, y: CGFloat(m.g) / 255, z: CGFloat(m.b) / 255)
    }
}
