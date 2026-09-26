// PRESENCE as a pass of the graph — the web's `presence-pass.ts`: dehaze,
// clarity or texture, ONE slider per node. The kernels are
// `Kernels/Presence.metal`; the pure twin the gate holds them to is
// AtelierKit's `applyPresence` (`presenceBlur` + `dehazeAt` /
// `localContrastAt`, `Render/Presence.swift`).
//
// The web draws a slider as TWO passes, `presence-blur` then
// `presence-apply`, the X estimate carried in alpha because a WebGL pass sees
// only its input. A Core Image pass is a recipe and may hand a second image
// to its kernel, so here the pair is ONE node: the blur kernel makes the
// estimate as an image of its own, the apply kernel reads the picture AND
// that. Nothing then carries a number in alpha between two nodes, and a
// kernel that will not run leaves the picture whole — never an estimate
// standing in for coverage across the rest of the graph. The builder maps
// the plan's `presenceBlur`/`presenceApply` pair onto one of these
// (`DetailPasses.swift`).
//
// Scales are FRACTIONS of the picture's short side, never source pixels
// (`render-detail.md`, «Presence»): the geometry is the twin's own
// `blurGeometry` on THIS render's size, the web's `u_texel`, so a stage, a
// loupe and an export blur the same part of the scene with no scale handed
// in at all.
//
// Order: after every warp and layer, before the sharpen — dehaze, clarity,
// texture (`detailPassPlan`).

import AtelierKit
import CoreImage
import Foundation

struct PresencePass: RenderPass {
    /// Which slider this node draws.
    let op: PresenceOp
    /// −1..1; 0 draws nothing.
    let amount: Double

    /// The web's two pass ids this one node stands for, in the plan's terms.
    static let planIds: [DetailPassId] = [.presenceBlur, .presenceApply]

    var id: String { "presence-\(op.rawValue)" }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try drawn(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    /// The node with its failures THROWN — the gate's door.
    func drawn(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        guard !image.extent.isInfinite, !image.extent.isEmpty, amount != 0, amount.isFinite else { return image }
        // The render's own size, as the web's `u_texel` is the canvas's; the
        // picture's extent where a caller handed no size.
        let size = ctx.renderSize.width > 0 && ctx.renderSize.height > 0 ? ctx.renderSize : image.extent.size
        let geometry = blurGeometry(op.scale, Int(size.width.rounded()), Int(size.height.rounded()))
        let blur = CIVector(x: CGFloat(geometry.sigma), y: CGFloat(geometry.step), z: CGFloat(geometry.taps))
        // The farthest tap, and a pixel for the bilinear read beside it.
        let reach = CGFloat(Double(geometry.taps) * geometry.step + 2)

        let blurKernel = try Kernels.kernel("presenceBlur")
        let applyKernel = try Kernels.kernel("presenceApply")
        let extent = image.extent

        // 1. The signal — the luma, or the dark channel in LINEAR light —
        //    blurred along X, as its own image.
        let dark = op == .dehaze ? 1 : 0
        guard let estimate = blurKernel.apply(extent: extent, roiCallback: { _, rect in
            rect.insetBy(dx: -reach, dy: 0)
        }, arguments: [image.clampedToExtent(), NSNumber(value: Float(dark)), blur]) else {
            throw KernelError.applyFailed(pass: "presence-blur")
        }

        // 2. That blurred along Y, and the pixel moved against it. The
        //    picture is read where it is drawn; the estimate over the tap
        //    reach, clamped at its edge as the twin's `planeBilinear` is.
        let opIndex: Int
        switch op {
        case .dehaze: opIndex = 0
        case .clarity: opIndex = 1
        case .texture: opIndex = 2
        }
        let haze = CIVector(x: CGFloat(dehazeFloor), y: CGFloat(dehazeStrength), z: CGFloat(hazeAdded), w: CGFloat(softLimit))
        let gains = CIVector(x: CGFloat(contrastGain.up), y: CGFloat(contrastGain.down))
        let arguments: [Any] = [
            image,
            estimate.clampedToExtent(),
            NSNumber(value: Float(opIndex)),
            NSNumber(value: Float(amount)),
            blur,
            haze,
            gains,
        ]
        guard let out = applyKernel.apply(extent: extent, roiCallback: { index, rect in
            index == 1 ? rect.insetBy(dx: 0, dy: -reach) : rect
        }, arguments: arguments) else {
            throw KernelError.applyFailed(pass: "presence-apply")
        }
        return out
    }
}
