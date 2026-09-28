# A layer's parts, and the colour range

Read before touching `AdjustLayer.parts`, `combineMask`, the `colour` mask kind,
`sampleColour` in `use-develop-picture.ts` or the Combine block of `MaskPanel`.
The layer engine under it is `render-layers.md`; picking a subject is
`subject-picking.md`.

## Masks combined, and a colour range (2026-09-23, audit item 16)

`AdjustLayer.parts` (`MaskPart {op, mask, invert}`, at most `MAX_MASK_PARTS` =
4, absent = none, so nothing migrated) and a `colour` mask kind.

- **The ops**: `combineMask` — Add is `max` (a union: a shape added to itself
  changes nothing, two gradients never sum past either), Subtract `m·(1−v)`
  and Intersect `m·v` (products, so two feathers crossing make a feather where
  a `min` draws a corner, and the subtraction is the one `except` already
  used). Order: own mask → its invert → each part turned by ITS invert,
  combined in order → the `except` hole → opacity (`layerWeight` takes the
  parts' values; the shader transcribes it).
- **One fragment for every layer.** Programs are cached by pass id, so a
  fragment that varied with the part count would keep running the stale one.
  The shader is generated with `PART_SLOTS` evaluators (`maskValue0..4`, a
  uniform set each, `-1` = an empty slot skipped); every component's raster
  has its OWN unit (own 2, except 3, parts 4–7). WebGL2 guarantees 16.
- **A subject is never a part.** Its raster comes from the model per LAYER;
  the two combinations wanted already exist — a Subject layer carrying parts,
  and anything minus a subject is `except`.
- **A colour range compares in an opponent plane** (r−g, (r+g)/2−b) plus luma
  at half weight, on ENCODED values like the luma band: a sampled blue takes
  the sky's lighter and darker blues, not a grey of its brightness. Full
  inside `colourReach(range)`, gone by twice it; the nearest of ≤5 samples
  decides. The shader gets the samples already converted.
- **A sample is the colour THIS LAYER SEES, stored.** `sampleColour` renders
  the stack BELOW the layer (the cube, warps, layers under it) with the
  finishing passes held back (sharpen, presence, post-vignette, grain all run
  after every layer), 5×5 at 512 px. Read off the stage it would carry the
  layer's own change, the ones above and the mask's wash, and the range would
  move with every slider. Measured: a layer at −2 EV stored 70,130,220 — the
  picture's own blue, not the darkened 33,67,117.
- **The panel opens ONE component** (`componentMask` / `withComponentMask`):
  Paint, Pick and the stage markers act on it, a colour sample reusing the
  subject's tap-to-add / tap-a-marker-to-remove. Two identical
  Add/Subtract/Intersect bars side by side read as one control, so the
  "next part" bar lives in Combine at the panel's foot and the open part's
  is labelled *This part*.

Gate rows `combined` (linear − painted ∩ not radial + band, 0.0054 of
`layerWeight`, canvas = bitmap) and `colour` (two samples taken from probes'
own pixels, 0.0024) — a range sampled away from every probe was flat and
proved nothing. Driven headless: subtract a stroke, intersect a tapped blue,
the export within a JPEG code of the stage, ⌘Z removes the part. A SKY is
not built: it is a second segmentation model to ship.
