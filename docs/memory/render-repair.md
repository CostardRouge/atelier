# Repair — heal, clone, dust

Read before touching `src/shared/render/repair.ts`, `repair-pass.ts`, the
Repair section of the Detail tab (`tools/develop/RepairPanel.tsx`),
`RollPicture.repair`, or before adding anything that COPIES pixels from one
place of a picture to another. The graph is `render-core.md`; the brief is
`docs/photo-editor.md` P12.

## One patch list, one pass, on the source (2026-09-20, P12)

A repair is a `Patch` — a destination disc (`x`, `y` in the SOURCE's own
[0,1]; `radius` in the centred space whose half-diagonal is 1, the masks'
convention, so one number means the same disc on every picture; a `feather`
share of it), where its pixels come from (`dx`, `dy`, an offset in frame
units), and a `kind`. `repair.ts` (pure, 7 specs) holds the record, the
coverage, the ring, the means, `repairAt` and `detectDust`; `repair-pass.ts`
is the GLSL twin, the whole list as ONE fragment pass over two uniform arrays
of `MAX_PATCHES` (64) entries walked up to `u_count`; the render gate holds it
to `repairAt` from a canvas AND an ImageBitmap within 2 codes (measured 1)
and checks the spot really rose.

**Rules that shaped it**:

- **A heal matches the destination's SURROUNDINGS, never its middle.** The
  first version measured the mean over the whole disc, and the mean of a
  dust spot is the dust: the healed disc came out dark. `ringWeightAt` is
  zero in the hard core, rises through the feather and reaches
  `RING_REACH` (1.5) radii out; the 9×9 grid (`MEAN_GRID`) of those weights
  is what both the CPU and the shader average. A heal is then the source's
  texture plus the difference of the two ring means; a clone is the source
  exactly. The spec pins the difference: a heal of a dark spot in a bright
  field sourced from a DARKER field stays bright, a clone goes dark.
- **The pass runs FIRST, before every other pre-pass**, so a copied pixel
  takes the same develop, look, warp, layer and denoise as its neighbours,
  and a denoise sees a repaired picture. It works in image coordinates
  through `imageUv` (`render-geometry.md`): a computed image point goes back
  through `imageUv` before it is sampled, so a canvas and a bitmap source
  put the patch on the same side.
- **`patch` is a RESERVED word in GLSL ES 3.00.** A local named `patch`
  makes the driver refuse the whole pass — silently, as a black canvas,
  because the graph logs to the console and draws nothing. The gate now
  relays the page's `console.error` lines (except the sandbox's refused
  fonts) so a refused shader is named rather than read as "190 codes".
  Locals are `pt`.
- **`sampleAt` is GL's LINEAR sample with CLAMP_TO_EDGE**, texel centres at
  `(i + 0.5) / size` — the pure module samples exactly as the GPU does, which
  is what lets the gate's tolerance be tight rather than "roughly the same".
- **Dust is detected on the stage's decode, never stored.** `detectDust`
  walks a luma copy at `DUST_SCAN_EDGE` (1024) against a box-blurred
  background: a 4-connected blob darker by the threshold, no larger than
  0.2 % of the frame and no longer than 3× its width (a wire, a hair, a
  branch is not dust), becomes a heal patch 1.6× its size sourced from
  whichever of four neighbours 2.5 radii away has the background nearest the
  spot's own. Answered darkest first, `DUST_MAX_SPOTS` (40) at most; a spot
  already under a patch is not answered twice; the workbench says how many
  were healed, or that none was found, for four seconds.
- **The gesture is the paint seam, and a tap is enough.** A press places the
  patch with a DEFAULT source — 2.5 radii to the right, mirrored when that
  would leave the frame — so a dust spot is one tap; a drag that clears the
  patch's own disc moves the source to where the pointer ends, so the author
  says where to borrow from. The live patch rides a ref like a brush stroke
  (`render-layers.md`), because the pointermove closure reads state a frame
  behind. Armed only on the Detail tab: a tool armed on a tab that does not
  show it is a gesture nobody can see the reason for.
- **A patch is drawn as two rings** on the viewport (`DevelopViewport`,
  `rings`): the destination solid, its source dashed, joined by a hair,
  amber for a clone; the radius in screen pixels is MEASURED as the vector
  to a point one radius to the right through `stagePoint`, so a rotated
  framing keeps a circle a circle. They show on every tab (a patch is a fact
  about the picture) and come off by a click only while Repair is armed,
  answering their own `pointerdown` so the paint seam cannot place a new
  patch under the one just removed. Placed in SOURCE coordinates, where the
  pass runs: under a keystone they sit where the pixels were, as the subject
  marks do.

**Where it lives**: `RollPicture.repair` (additive, `readPatches` on read —
junk dropped, the list capped, a repeated id dropped —, no migration), the
top of the Detail tab, written through like the lens
(`use-write-through.ts`, `samePatches`), reaching the stage, the loupe, the
crop stage, the thumbnail and the export (`roll-render.ts` both paths,
`use-roll-export.ts`), and named in the facts corner (`describePatches`).
Not in Trips or the Studio: their sheet edits the develop alone (P12 of the
brief, «Trips and the Studio gain rendering, not panels»).

**Not built, deliberately**: a content-aware fill (a patch takes ONE source
disc; a texture synthesis is a different algorithm and a different cost),
a brush-shaped patch (a disc with a feather covers a spot and a wire alike
through several patches), dust detection on the file's full decode (the
stage's budget finds a 4 px spot on a 1024 walk; a finer spot is invisible on
screen too).
