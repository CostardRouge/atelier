# The Layers tab's face — palette, list, Mask | Adjust, recipe, mask view

Read before touching `LayersPanel.tsx`, `MaskPanel.tsx`, `KindPalette.tsx`,
`kind-palette.ts` or `KindGlyph.tsx`. What the subject model answers is
`subject-model.md`; the mask maths is `render-layers.md` and `mask-parts.md`.
The plan is `docs/mask-ui-redesign.md` §5, built on his *«vas-y avec tes
recommandations»* (2026-10-02) — the lab's face, drawn at
https://claude.ai/artifact/5jy9NnEg1SoRdUNjDcAMas.

## ONE palette of kinds (2026-10-02)

**Decision**: a single `+ Layer` opens a grouped palette — *Point at it*
(Subject, Colour, Brightness), *Draw it* (Linear, Radial, Shade, Painted),
*Everywhere* (Whole picture) — each a glyph and one line of use. The SAME
component changes a layer's kind (the chip beside *Mask*, `type`; a term's,
`part-type`) and combines a term (`part`, Add / Subtract / Intersect at its
head). **Why**: the tab had 22 kind buttons on one screen asking one question
three ways (eight `+ Kind`, an eight-way switch, six `± Kind` under Combine),
his *«les boutons peut-être qu'ils peuvent être mieux faits»* — Hick's law.
**How to apply**: a new kind is ONE entry in `PALETTE_GROUPS`, never a button
somewhere; a term's kinds are `PART_KINDS`, filtered in `paletteGroups`, never
listed twice. It is a popover portalled at fixed coordinates (`menuAnchor`,
the menu rule of `frontend.md`) and a `BottomSheet` on a compact shell. A
kind made with the pointer (`takesPointer`: subject, colour, painted) turns
Pick / Paint on — a fresh painted layer now does too, where only a subject and
a colour did. Switching kind still STARTS the shape fresh (`defaultMask`).
Driven headless at 1440 and 390 px: add, change (the current kind marked),
combine with Subtract, Escape and a press outside close it.

## The list READS — a row per layer (2026-10-02)

**Decision**: a row is grip · eye · thumbnail of the REAL combined mask ·
name beside its kind word · ⋯, then chips of what it changes (`developLines`,
three and "+N", or "no change yet") and its opacity as a slim bar. The ⋯ holds
Rename, Duplicate, Move up / down, Invert, Change type… (the palette, hung
from the row) and Delete — the three icon buttons a row had are gone. **Why**:
a row was one truncated line («radial · 40 % · 40 %») the eye had to parse,
and a layer's NAME (`AdjustLayer.name`) existed with no way to set it.
**How to apply**:
- The thumbnail is `layer-thumb.ts` (pure, tested) — `layerWeight` over the
  same evaluators the renderer reads, opacity LEFT OUT (the bar says it), a
  painted mask through `rasteriseBrush`, a subject from its raster. A
  brightness or colour mask is measured on `layerInput` — the picture AS THE
  LAYER SEES IT, factored out of `sampleColour` —, never on the picture as
  shot, which is not what those masks read. Redrawn 180 ms after the stack
  moves (`use-layer-thumbs.ts`), so the stage repaints first.
- **`layerInput` and `sampleColour` draw through a grader of their OWN**
  (`drawBelow`'s `belowSlot`, 512 px on the long edge, 2026-10-02), never the
  stage's. The first version called `graderFor` on the stage slot with the
  layers BELOW: every pass above, the overlay and the film were released and
  re-uploaded on the next paint, and where nothing below needed the GPU the
  stage's whole context was disposed (`develop.md`, «The stage's grader LIVES
  with the source»). The small slot borrows the stage cache's CUBES
  (`LayerPassCache.cubeOf`, the `lender` of `makeLayerPassCache`) so a layer
  is baked once; its passes are its own, a pass holding textures on one
  context. It renders without detail, film or vignette — none is what a
  layer reads — and keeps the repair, the camera's shading and the geometry.
- The drag carries its OWN type (`application/x-atelier-layer`), so a layer
  dragged in the list can never be read as a picture dropped on a cell
  (`asset-drag.ts`); dropped ON a row, it goes just ABOVE that row
  (`moveLayerTo`). Touch has no HTML drag: ⋯ Move up / down is its way, and
  ⌥↑ / ⌥↓ the keyboard's, on the grip or the name.
- A name stays OPTIONAL: empty reads as the kind's name, renamed in place
  (double-click, or ⋯ Rename; Enter or a click away keeps it, Escape does
  not). A duplicate lands just above its original, every field cloned, named
  `<name> copy`.
- A click anywhere on a row opens its layer, except on a control.
Driven headless: four kinds, the thumbnails' ink measured per row, +1 EV
showing as a chip, the bar writing 0.4, a rename, a duplicate, Change type,
a drag to the top and ⌥↓, the roll read back after its debounced save.

## Mask · where | Adjust · what, and the recipe (2026-10-02)

**Decision**: the open layer is a HEAD (its name, edited where it is read,
beside the chip of its kind) over a switch, *Mask · where* | *Adjust · what*
(`LayerDetail.tsx`); the mask half opens on the RECIPE — the layer's own term,
then each part as an operator and a term, each tile its own small map
(`maskCoverage`, before its invert, which the label's red "not" says) — and
the old components list, the per-part op switch and the Combine block are
gone. **Why**: the layer's sliders began 857 px down a Subject's panel
(measured in the brief), under every mask control; Combine was a footer where
it is the structure of the mask. **How to apply**:
- A click on a term OPENS it (its controls below, what Pick / Paint act on);
  a click on an operator CYCLES it + → − → ∩; the recipe's `+` opens the
  palette in `part` mode; an open part carries its own kind chip
  (`part-type`) and *Remove this term*. The own kind's chip lives in the head.
- Switching to Adjust turns Pick / Paint OFF — that half has nothing to point
  at; a new layer and a changed kind open on Mask (`changeLayerKind`, one
  function for the row's ⋯ and the head's chip). The tab is kept across
  layers, like any tab.
- The term maps are computed only for the OPEN layer, in the same debounced
  pass as the rows (`useLayerThumbs(…, openId)`).
Driven headless: the head's placeholder is the kind, Adjust hides the mask
controls and drops Pick, `Subject − Radial` combined from the `+`, the
operator cycled to ∩, the term maps inked, a rename in the head reaching the
row, *Remove this term*, the roll read back.

## The mask view is ONE glyph in the picture's bar (2026-10-02)

**Decision**: Hidden · Outline · Fill is one glyph of fixed width in the
stage bar's well, beside A/B — a dotted ring, a dashed one, a disc —, stepped
by a click or `M`; the inspector's segmented switch, its "keep it shown"
checkbox and its Done link are gone (`mask-view.ts`, pure, tested). Hidden is
the default and shows the OUTLINE by itself while Pick / Paint makes the mask
— today's behaviour, unchanged —; Outline or Fill keep it shown, which is what
the checkbox did. **Why**: the brief's §3.6 — the view is a way of LOOKING,
whose home is over the picture, and three controls in the inspector said one
thing. **How to apply**:
- The glyph is drawn on EVERY tab and DISABLED off the Layers tab or with no
  layer open, never inserted: a control that appears by state slides the
  verbs after it under a hand aimed at them (`frontend.md`, «A toolbar never
  INSERTS a control»).
- The mask is drawn on the Layers tab only (`showMaskOf` checks the tab): a
  Fill chosen there is never carried onto Adjust as a red wash.
- The shortcuts sheet names the glyph with `M`, the ⌥-tap, the pin's × and
  ⌥↑ / ⌥↓.
Driven headless, counting the stage's dash and wash pixels: 0 / 0 on Adjust
(glyph disabled), 3 199 dash pixels while picking at Hidden, 0 once Pick is
off, 3 199 at Outline with Pick off, 102 698 washed at Fill, 0 on Adjust with
Fill chosen, back on returning to Layers.
