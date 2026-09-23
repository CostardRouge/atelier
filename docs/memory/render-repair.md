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
units), and a `kind`. `repair.ts` (pure, 13 specs) holds the record, the
coverage, the ring, the means, `repairAt`, `placeSource` and the dust field;
`repair-pass.ts`
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
- **Dust is detected on the stage's decode, never stored — and PROPOSED,
  never dumped (rev. 2026-09-23).** The first version answered the scan with
  forty heal patches at once, and on a real photograph they were forty grains
  of a texture and none of the sky's marks: the maintainer's *"ça crée un
  paquet d'éléments, ça ne sert à rien du tout"*. Now `dustField` measures
  the picture ONCE at `DUST_SCAN_EDGE` (luma; a box-mean background over
  1.5 % of the long edge; the ground's DEVIATION as the rms of what rises
  ABOVE the background — the bright side only, so a dark spot cannot raise
  its own bar — over a window twice as wide, then DILATED by that window with
  an O(n) running max, so the border of a texture is judged by the texture),
  the sensitivity slider reads the field (`dustSpots`, ~20 ms) and never the
  picture, and the spots are dotted rings the author taps one by one or
  takes with *Heal all*. A spot must: clear the depth threshold
  (`dustThreshold(sensitivity)`, 0.14 gentle → 0.025 keen) AND
  `DUST_PROMINENCE` (4.5) times the ground's deviation, per pixel as a SEED
  and walked at half the bar (hysteresis, or a spot at the threshold's edge
  came out as two fragments); be 5 scan px to 0.2 % of the frame; be no
  longer than 3× its width AND fill a third of its box (a diagonal wire has a
  square box); sit in a FLAT field — the LUMA on a ring a diameter out varies
  less than the blob is deep (this is what refuses the inside corner of a
  dark shape, which every other gate reads as a compact dent); and be
  prominent as a WHOLE blob, not only at its darkest pixel. Ranked by
  prominence, never by depth: on a picture with a texture the darkest blobs
  are the texture's, and the cap of `DUST_MAX_SPOTS` had dropped every real
  spot. Measured on a sky with four marks against a dense texture: the four,
  nothing else, field 110 ms. An oversized blob is walked to its END —
  breaking out early left its remainder to start again as small blobs.
- **The map is a VEIL over the stage** (`dustVeil`, the same measure drawn
  white on black as a share of the threshold; `useDevelopPicture({ veil })`
  draws a source-space canvas through the stage's own crop into a second
  canvas wearing the stage canvas's CSS and transform, so it lands on the
  photograph to the pixel — the loupe's placement trick, without the loupe's
  device-pixel canvas). A way of LOOKING: `delivered()` never sees it. The
  shallow marks a screen hides at the fit read on it as grey discs, which is
  what makes tapping them possible at all.
- **A patch is MOVED, never re-made, and the source turns with the hand
  (2026-09-23).** Two reports: *"une fois qu'on rajoute un élément, c'est
  définitif"* and *"ça se met à bugger dès que je suis dans le cercle"*. The
  second was `onMove` refusing every point inside the destination's own disc,
  so a small drag near a small spot never updated. `placeSource` reads the
  ANGLE whatever the distance and holds the source at
  `max(distance, MIN_SOURCE_RADII = 2)` radii — the discs touching, never
  overlapping (a nearer source holds the very defect) — measured in the
  centred space so the minimum is a circle on the picture; a dead zone of 0.2
  radii keeps a pixel of jitter from swinging it round; the source disc is
  clamped inside the frame. `defaultSource` is the old tap rule (2.5 radii to
  the right, mirrored at the edge). The rings are HANDLES on the Detail tab
  (`DevelopViewport.onRing`): a drag on the solid ring moves the patch with
  its offset (`movePatch`), a drag on the dashed ring moves the source alone
  (through `placeSource`, same rule), a press that travels under 3 px is a
  tap that SELECTS. The viewport captures the pointer on the SVG circle
  (keyed by the patch id, so React keeps the node under the capture), stops
  propagation so the paint seam cannot place a new patch under it, hands back
  source points UNBOUNDED (`pointAt(x, y, true)`) so a hand past the edge
  still moves the patch to the edge, and gives every ring a hit disc of at
  least 11 px. Nothing on the picture REMOVES a patch any more: removal is
  ⌫ on the selected one, or the panel's Remove — a press can never throw away
  what it meant to move. Selection is `selectedPatchId` derived against the
  list each render (a patch that went cannot stay selected), cleared on
  leaving the tab; the panel's Size, Feather and Heal/Clone edit the SELECTED
  patch (`adjustPatch`) or else the next patch's tool; a patch just placed
  is selected (tap, then size it). `editorKeyAction` gained `'remove'`
  (Delete/Backspace) and `'escape'`, both refused from a field, the workbench
  applying them to what is selected and Escape then putting Repair down.
  Driven headless: a 10 px drag inside a 15 px disc put the source UP
  (dy −0.049, dx 0.007); a ring drag moved the patch and kept its offset; a
  source drag moved the source alone; a click selected; two arrow steps on
  the focused slider grew that patch; ⌫ on the focused slider did NOT
  remove; Escape let go; ⌫ removed; the scan proposed 4, gentle 2, keen 4; a
  tap healed one and *Heal all* the rest, the texture's blob untouched.

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
stage's budget finds a 5 px spot on a 1024 walk; a finer spot is invisible on
screen too), a resize handle on the ring (the selected patch's Size slider
is the resize; a wheel over a ring would fight the view's zoom), and
BRIGHT-spot detection (a hot pixel is one pixel and vanishes in the scan; a
bright mark on a dark field is not what a sensor leaves). Open: the field is
measured synchronously in an effect (~110 ms at 1024 on a desktop, a freeze
on a phone worth a worker if it is felt), and none of it has been driven on
the maintainer's own photographs — the numbers (`DUST_PROMINENCE`, the
1.5 % background, the ring test) were set on synthetic skies and will want a
taste pass on real dust.
