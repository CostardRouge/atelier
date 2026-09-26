// How the Develop stage turns a picture into pixels — ONE seam, so the stage,
// the before/after wipe, the filmstrip's snapshot and the export all ask the
// same question the same way: preview = export by construction.
//
// The editor draws through `FullDevelopRenderPlan` (`Develop/Render/`): every
// pass a picture carries, in the web's order, the look and the RAW ladder
// included. The default plan here is the v0 path it replaced — the crop, the
// cap and the develop as ONE cube through `PictureRenderer.compose` — kept
// for a host with no plan installed; what it does not draw it SAYS
// (`unrendered`), so no stage shows a picture developed on the web as
// something it is not.

import CoreImage
import AtelierKit

/// How many pixels a render may spend.
struct RenderBudget: Equatable {
    /// A cap on the delivered frame's long edge; nil renders it whole.
    var longEdge: Int?

    /// One 4K frame, never the media's own density (`device-memory.md`).
    static let stage = RenderBudget(longEdge: PictureRenderer.stageLongEdge)
    /// A filmstrip cell.
    static let thumbnail = RenderBudget(longEdge: PictureRenderer.thumbnailLongEdge)
    /// The picture at its own density — what a delivered file is made from.
    static let whole = RenderBudget(longEdge: nil)
}

protocol DevelopRenderPlan {
    /// `picture` (its drafts already applied by the caller) drawn from
    /// `decoded` as it will be delivered, within `budget`.
    func render(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CIImage

    /// The sections of `picture` this plan does not draw — named in the
    /// inspector's words, for the stage to say.
    func unrendered(picture: RollPicture) -> [String]

    /// What a render of `picture` needs that is had ASYNCHRONOUSLY — a pack
    /// look's lattice from the vault — fetched before `render` asks for it.
    /// A caller that renders awaits it first; nothing to fetch costs nothing.
    func prepare(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) async

    /// The picture AS SHOT, for the left of the wipe and the held before.
    func renderBefore(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CIImage

    /// A way of LOOKING drawn over the delivered frame — the clipping (J) —
    /// on what the stage SHOWS only: the histogram, a snapshot and an export
    /// take `render`'s picture and never this.
    func looking(_ image: CIImage, clipping: Bool) -> CIImage

    /// The pixels `render` draws FROM, before any budget — what a delivery's
    /// arithmetic (its frame, its cap, its border) is read against. Not
    /// always `decoded`'s own: a RAW on a sensor rung is drawn from its
    /// sensor, not the render the pool decoded.
    func sourceSize(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CGSize
}

extension DevelopRenderPlan {
    func prepare(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) async {}

    func sourceSize(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CGSize {
        CGSize(width: decoded.width, height: decoded.height)
    }

    func renderBefore(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CIImage {
        render(picture: asShotForCompare(picture), decoded: decoded, budget: budget)
    }

    /// The clipping painted after everything that shapes the picture, on the
    /// delivered frame's own pixels — so the readout under the pointer reads a
    /// mark as the clip it marks (`readoutOf`), exactly.
    func looking(_ image: CIImage, clipping: Bool) -> CIImage {
        guard clipping else { return image }
        return ClippingPass.shared.apply(image, PassContext(renderSize: image.extent.size))
    }
}

/// The picture AS SHOT for the left of the wipe: the same file at the same
/// rung, framed the same, with nothing the author did — no develop, no look,
/// no perspective, lens, detail, repair, vignette or layer (the web's wipe
/// draws the decoded source itself under the same crop). A RAW base is a fact
/// about the bytes, not a correction, so it stays, with its gain and the
/// camera's own calibration at its rung.
func asShotForCompare(_ picture: RollPicture) -> RollPicture {
    var out = picture
    if let d = picture.develop, isRawDevelop(d) {
        var base = DevelopSettings.default
        base.base = d.base
        base.rawGain = d.rawGain
        out.develop = base
    } else {
        out.develop = nil
    }
    out.grade = nil
    for key in asShotStripped { out.carried[key] = nil }
    return out
}

/// The stages a picture carries that are the author's corrections, never the capture's.
private let asShotStripped = ["keystone", "lens", "lensProfile", "detail", "vignette", "repair", "layers"]

struct DefaultDevelopRenderPlan: DevelopRenderPlan {
    func render(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CIImage {
        let recipe = PictureRenderer.Recipe(
            develop: picture.develop,
            framing: picture.framing,
            aspect: picture.aspect,
            longEdge: budget.longEdge
        )
        return PictureRenderer.shared.compose(decoded, recipe: recipe)
    }

    func unrendered(picture: RollPicture) -> [String] {
        var out: [String] = []
        if picture.grade != nil { out.append("look") }
        let edits = Set(pictureEdits(picture))
        let named: [(PictureEdit, String)] = [
            (.border, "border"), (.perspective, "perspective"), (.lens, "lens"), (.detail, "detail"),
            (.vignette, "vignette"), (.repair, "repair"), (.layers, "layers"),
        ]
        for (edit, word) in named where edits.contains(edit) { out.append(word) }
        if let d = picture.develop { out.append(contentsOf: d.unrenderedStages) }
        return out
    }
}
