// What the Repair section DRAWS and MEASURES off the main thread — the web's
// `use-develop-picture.ts` for the repair (`repair`, `veil`) and the dust
// scan's read-back in `PictureWorkbench.tsx`:
//
// - `RepairLooking.frame`: the picture with its patches, while the stage's
//   plan does not draw them yet (`RollEditor.planDrawsRepair`). The patches
//   run FIRST, on the source, as the graph runs them (`RepairPass` in the
//   `before` slot, `render-repair.md`), and the picture then goes through the
//   stage's OWN plan — the develop, the crop, whatever the plan draws — so
//   the repaired picture is the stage's picture plus the repair and nothing
//   else. The source is brought down to the stage's budget FIRST, so no
//   patch is drawn at the file's own density on every drag; a patch is
//   resolution-free (a centre in shares, a radius in the centred space), so
//   it lands where it does on the file.
// - `RepairLooking.veil`: the dust MAP — how far each pixel falls below its
//   background, as a share of the threshold (`dustVeil`), white on black at
//   the scan's size. A way of LOOKING: nothing delivered ever sees it.
// - `PicturePool.dustField(of:)`: the stage's decode read back ONCE at
//   `dustScanEdge` into the field (`dustField`) the sensitivity then reads —
//   the web draws `source.image` into a 1024 px canvas and reads its 8-bit
//   codes; the same codes here, through the graph's own resampler and
//   context, the TOP row first as the twin reads it.

import AtelierKit
import CoreGraphics
import CoreImage
import Foundation

enum RepairLooking {
    /// `picture` drawn through `plan` from `decoded` with `patches` repaired
    /// first on the source, at the stage's budget on the delivered frame.
    static func frame(picture: RollPicture, patches: [Patch], decoded: DecodedPicture, plan: DevelopRenderPlan,
                      longEdge: Int = PictureRenderer.stageLongEdge) -> CGImage? {
        guard decoded.width > 0, decoded.height > 0 else { return nil }
        let aspectRatio = Double(decoded.width) / Double(decoded.height)
        // The budget is the DELIVERED frame's long edge, as the plan counts it.
        let delivered = PictureRenderer.deliveredSize(width: decoded.width, height: decoded.height, aspect: picture.aspect)
        let longest = Double(max(delivered.width, delivered.height))
        let scale = longest > 0 ? min(1, Double(longEdge) / longest) : 1
        let fitted = FrameGrader.resampled(decoded.image, scale: scale)
        let extent = fitted.image.extent
        let grader = FrameGrader(before: [RepairPass(patches: patches, aspectRatio: aspectRatio)])
        let repaired = grader.render(source: fitted.image, sourceScale: fitted.scale).cropped(to: extent)
        let source = DecodedPicture(image: repaired, properties: decoded.properties, isRaw: decoded.isRaw)
        // The plan is handed the picture WITHOUT its patches: they are in the
        // pixels already, and a plan that one day draws them must not draw them twice.
        var forPlan = picture
        forPlan.repairPatches = []
        let composed = plan.render(picture: forPlan, decoded: source, budget: .stage)
        return FrameGrader.cgImage(composed)
    }

    /// The dust map at the field's size: 0 black on quiet ground, white at a
    /// spot the threshold finds and past it — the web's `Math.round(v × 255)`.
    static func veil(_ field: DustField, threshold: Double) -> CGImage? {
        let values = dustVeil(field, threshold)
        let count = field.width * field.height
        guard count > 0, values.count == count else { return nil }
        var bytes = [UInt8](repeating: 0, count: count)
        for i in 0..<count {
            let code = (Double(values[i]) * 255 + 0.5).rounded(.down)
            bytes[i] = UInt8(max(0, min(255, code)))
        }
        guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
        return CGImage(width: field.width, height: field.height, bitsPerComponent: 8, bitsPerPixel: 8,
                       bytesPerRow: field.width, space: CGColorSpaceCreateDeviceGray(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
}

extension PicturePool {
    /// The stage's decode read back ONCE at the scan's edge (`dustScanEdge`,
    /// never enlarged) as 8-bit codes over 255, the top row first, and
    /// measured into a dust field. Nil for a picture too small to walk.
    nonisolated static func dustField(of decoded: DecodedPicture, context: CIContext = RenderContexts.shared) -> DustField? {
        let small = FrameGrader.fit(decoded.image, longEdge: dustScanEdge).image
        let width = Int(small.extent.width.rounded())
        let height = Int(small.extent.height.rounded())
        guard width >= 8, height >= 8 else { return nil }
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let bounds = CGRect(x: 0, y: 0, width: width, height: height)
        bytes.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            context.render(small, toBitmap: base, rowBytes: width * 4, bounds: bounds,
                           format: .RGBA8, colorSpace: RenderContexts.srgb)
        }
        var data = [Float](repeating: 0, count: width * height * 3)
        for i in 0..<(width * height) {
            data[i * 3] = Float(bytes[i * 4]) / 255
            data[i * 3 + 1] = Float(bytes[i * 4 + 1]) / 255
            data[i * 3 + 2] = Float(bytes[i * 4 + 2]) / 255
        }
        return AtelierKit.dustField(DetailImage(width: width, height: height, data: data))
    }
}
