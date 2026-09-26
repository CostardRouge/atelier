// How the Develop stage turns a picture into pixels — ONE seam, so the stage,
// the before/after wipe, the filmstrip's snapshot and (later) the export all
// ask the same question the same way: preview = export by construction.
//
// The default plan is today's pixel path: the crop, the cap on the budget and
// the develop as ONE cube, through `PictureRenderer.compose` and the render
// graph's `FrameGrader` (a tetrahedral cube pass, the web shader's own maths).
// What the plan does NOT draw yet — the look, the border, the geometry
// passes, detail, the post-crop vignette, repair, the layers — it SAYS
// (`unrendered`), so the stage never shows a picture developed on the web as
// something it is not. The integration task adds those passes BEHIND this
// protocol (a plan built over `FrameGrader.setExtraPasses`); the stage and
// its callers do not change.

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
}

/// The picture AS SHOT for the left of the wipe: the same frame, with no
/// correction and no look — the web's split lives in the CUBE (`u_splitX`),
/// so only what the cube carries differs between the halves and the two line
/// up pixel for pixel. Every other pass is the plan's, on both sides.
func asShotForCompare(_ picture: RollPicture) -> RollPicture {
    var out = picture
    // A RAW base is a fact about the bytes, not a correction: it stays.
    if let d = picture.develop, isRawDevelop(d) {
        var base = DevelopSettings.default
        base.base = d.base
        base.rawGain = d.rawGain
        out.develop = base
    } else {
        out.develop = nil
    }
    out.grade = nil
    return out
}

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
