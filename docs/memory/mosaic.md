# Mosaic — a picture made of all the others

Read before touching `src/shared/mosaic/` (the pure core) or
`src/tools/mosaic/` (the instrument, not yet built). The brief, his four
decisions and the plan M1–M9 are `docs/mosaic.md`; this file holds the rules
the code fixed.

## The measure is bytes, the comparison is derived (2026-10-31, M1)

**Decision.** A picture's measure is its 6 × 6 grid of mean sRGB colours as
108 BYTES (`measure.ts`, `gridOf`), base64 in the document (144 characters,
`encodeGrid` / `decodeGrid`, refused unless it decodes to exactly 108 bytes);
everything a matching compares — the level (1 × 1, 2 × 2, 3 × 3) and the
space (OKLab × 100 or RGB) — is derived from the bytes on load
(`descriptorsOf`), never stored. **Why**: his pick («Grille 6×6»), and a
stored derivative would rot the moment a level or a space is added. **How to
apply**: a new way to compare pictures is a new derivation over the same
bytes; the bytes never change shape without a document version.

## A cell has the FRAME's shape, so the grid is square in count (2026-10-31, M1)

`gridShape(width, height, cellPx)` cuts `cols = round(width / cellPx)` and a
cell `cw × cw·(H/W)`, so `rows = cols` on any frame (24 × 24 at 960 × 540 and
40 px). **Why**: a cell zoomed is then exactly the frame, which is what lets a
chain step end on the whole next picture; the cell SIZE is in stage pixels
(his pick), so a 4K export has more cells, not bigger ones. The target's
cells are read with the same arithmetic as a picture (`cellGridsOf` over
`gridOfRect`), so like is compared with like.

## The chain is a clock, the picks are seeded (2026-10-31, M1)

`chain.ts` gives a step's phase and camera as a FUNCTION of the time since
the step began (`stepStateAt`, `cameraAt`: zoom in log space, the centre
gliding to the cell, the focus cell's crisp picture fading in from ×1.6 to
×3.2, the target fading over the mosaic in the hold, dissolve and resolve) —
the atlas rule, so the stage and an MP4 draw the same frames. The picks
(`pickCell`, `pickNextTarget`) take the document's seeded generator
(`lib/prng.ts`) and a HISTORY, and `forceInto` returns a new `ids` rather
than mutating the matching. **How to apply**: never read `Math.random()` or
accumulate a camera in the frame loop; a replay must only depend on the seed
and the same sequence of picks.
