// The BORDER on the stage — the canvas a picture is delivered on, drawn round
// the crop the stage shows, as the web's viewport draws it
// (`use-develop-picture.ts`: `drawDelivered` over `borderLayout`, the stage
// canvas BEING the delivered file). Stage = export by construction: the ground
// is made by the render plan's own border code
// (`FullDevelopRenderPlan.bordered` — the colour, or the crop blurred on a
// tiny copy by the kernel's `boxBlurRGBA`, darkened, scaled to cover), from
// the very pixels the stage shows, so a blur fill wears what the stage wears
// (the clipping included, as the web's graded canvas does).
//
// The stage keeps drawing the CROP as it always did — every tool's point, the
// wipe, the readout, the zoom's 1:1 are the crop's — and the ground goes
// UNDER it, the crop centred on it as `bordered` centres it. `StageGeometry`
// fits the whole canvas in the room (`canvas`), so at the fit the file is seen
// whole, border and all.
//
// Not on the Crop tab, whose delivered preview already shows the border and
// whose stage shows the WHOLE picture under the zone.

import CoreGraphics
import CoreImage
import AtelierKit

struct StageGround {
    /// The delivered canvas: the crop on its border.
    let image: CGImage
    /// The canvas in units of the crop — its width and height over the
    /// crop's (≥ 1 each): what `StageGeometry.canvas` fits.
    let canvas: CGSize

    /// The crop the stage rendered, on `border` — nil when there is nothing to draw.
    static func make(_ crop: CGImage, border: RollBorder) -> StageGround? {
        guard crop.width > 0, crop.height > 0 else { return nil }
        let bordered = FullDevelopRenderPlan.bordered(CIImage(cgImage: crop), border, context: RenderContexts.shared)
        guard let image = PictureRenderer.shared.cgImage(bordered) else { return nil }
        let kx = CGFloat(image.width) / CGFloat(crop.width)
        let ky = CGFloat(image.height) / CGFloat(crop.height)
        // Margins of nothing and no file shape: the canvas IS the crop.
        guard kx > 1.0005 || ky > 1.0005 else { return nil }
        return StageGround(image: image, canvas: CGSize(width: max(1, kx), height: max(1, ky)))
    }

    /// The border the stage draws round `picture`, or nil: none on the Crop
    /// tab (its delivered preview shows it) nor while the stage shows the
    /// whole picture, and none from a plan that never draws a border in a
    /// delivery either — the stage shows what the file will hold.
    static func border(of picture: RollPicture, tab: WorkbenchTab, tool: DevelopTool,
                       plan: DevelopRenderPlan) -> RollBorder? {
        guard tab != .crop, !tool.showsWholePicture, let border = picture.border else { return nil }
        guard !(plan is DefaultDevelopRenderPlan) else { return nil }
        return border
    }
}
