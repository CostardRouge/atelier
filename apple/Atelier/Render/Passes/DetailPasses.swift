// The NEIGHBOURHOOD family's builder — what a picture's repair patches and
// detail record contribute to the graph, and WHERE: the web's
// `detailPasses` (`detail-pass.ts`) plus the repair pass `graderFrom` puts
// ahead of it (`use-develop-picture.ts`), in the order the Develop workbench
// and the roll export assemble them:
//
//     before (on the SOURCE, ahead of the cube):
//         repair → chroma-x → chroma-y → denoise → defringe
//     after (behind every warp and adjustment layer):
//         dehaze → clarity → texture → sharpen
//
// Repair FIRST: a copied pixel then takes the same develop, look, warp and
// layer as its neighbours, and a denoise sees a repaired picture. Noise and
// fringe before the cube: noise is a property of the sensor's pixels, and a
// later lift would amplify what was left. Presence, then the sharpen LAST of
// the picture's own passes, so nothing resamples it (`render-detail.md`,
// «ORDER»). What the Develop integration still places around these — the
// camera's gain map ahead of the repair, the warps and layers ahead of the
// presence, the post-crop vignette and the film node behind the sharpen — is
// not this family's, and `FrameGrader`'s slots keep the cube between the two
// lists.
//
// Which detail passes run is the twin's own plan (`detailPassPlan`), never a
// second reading of the sliders: the builder walks it and maps each id to its
// node — one to one, except the plan's `presenceBlur` + `presenceApply` pair,
// which is ONE `PresencePass` here (`PresencePass.swift` says why).

import AtelierKit
import CoreImage
import Foundation

struct DetailPasses {
    /// On the source, before the cube: repair, then colour noise (X, Y),
    /// luminance noise, defringe.
    var before: [RenderPass]
    /// After every warp and layer: dehaze, clarity, texture, then the sharpen.
    var after: [RenderPass]

    var isEmpty: Bool { before.isEmpty && after.isEmpty }

    /// The passes for a detail record and a patch list. `aspectRatio` is the
    /// SOURCE's width over its height for the repair (nil reads it from the
    /// picture the pass is drawn on); `decodeScale` is the source's pixels
    /// per FILE pixel — 1 unless it was decoded smaller, a half-size RAW —
    /// which the detail kernels multiply into the render's own scale;
    /// `showSharpenMask` is the stage's view of the Masking weight, drawn
    /// whatever the rest of the record says, and never asked for by anything
    /// that leaves.
    static func make(detail: DetailSettings?, repair: [Patch], aspectRatio: Double? = nil,
                     decodeScale: Double = 1, showSharpenMask: Bool = false) -> DetailPasses {
        var before: [RenderPass] = []
        if !repair.isEmpty {
            before.append(RepairPass(patches: repair, aspectRatio: aspectRatio))
        }

        let plan = detailPassPlan(detail, pixelScale: decodeScale, showSharpenMask: showSharpenMask)
        let record = detail ?? .default
        for id in plan.pre {
            switch id {
            case .chromaX: before.append(ChromaBlurPass(axis: .x, detail: record, decodeScale: decodeScale))
            case .chromaY: before.append(ChromaBlurPass(axis: .y, detail: record, decodeScale: decodeScale))
            case .denoise: before.append(DenoisePass(detail: record, decodeScale: decodeScale))
            case .defringe: before.append(DefringePass(detail: record, decodeScale: decodeScale))
            case .presenceBlur, .presenceApply, .sharpen:
                // Never in `pre` (`detailPassPlan`); named so a new id is a compile error.
                continue
            }
        }

        var after: [RenderPass] = []
        // The plan lists a blur + apply pair per slider that is not 0, in
        // `PresenceOp`'s order; the slider each pair stands for is read the
        // same way the plan reads it, so the two walks cannot fall out of step.
        let amounts = PresenceAmounts(dehaze: record.dehaze / 100, clarity: record.clarity / 100, texture: record.texture / 100)
        var ops = PresenceOp.allCases.filter { amounts[$0] != 0 }.makeIterator()
        for id in plan.post {
            switch id {
            case .presenceBlur:
                if let op = ops.next() { after.append(PresencePass(op: op, amount: amounts[op])) }
            case .presenceApply:
                // The second half of the pair: drawn by the same node.
                continue
            case .sharpen:
                after.append(SharpenPass(detail: record, decodeScale: decodeScale, showMask: showSharpenMask))
            case .chromaX, .chromaY, .denoise, .defringe:
                continue
            }
        }
        return DetailPasses(before: before, after: after)
    }

    /// The passes for a picture of a roll, read from what the web app stored
    /// on it — `detail` through `detailOrNull`, `repair` through `readPatches`
    /// (junk dropped, the list capped, a repeated id dropped) — exactly as the
    /// web reads them, so a record the web wrote renders the same here.
    static func make(for picture: RollPicture, aspectRatio: Double? = nil, decodeScale: Double = 1,
                     showSharpenMask: Bool = false) -> DetailPasses {
        make(detail: detailOrNull(picture.carried["detail"]),
             repair: readPatches(picture.carried["repair"]),
             aspectRatio: aspectRatio,
             decodeScale: decodeScale,
             showSharpenMask: showSharpenMask)
    }
}
