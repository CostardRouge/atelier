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

## One decode, two products; the device first; a miss is skipped (2026-10-31, M2)

**Decision.** `shared/mosaic/measure-worker.ts` (a module worker, Vite's ES
format like `jxl-worker.ts`) decodes a Winnow thumbnail ONCE and makes the
160 × 90 JPEG tile a cell draws AND the 6 × 6 grid, the grid read off the
tile's own cover crop (`coverSource`) so a portrait or a panorama is
measured as it will be drawn. `tools/mosaic/measure-pool.ts` fetches on the
MAIN thread (the client holds the auth and the retry; six in flight) and
hands blobs to the idlest worker (`measurePoolSize`: cores − 1, two to six,
one or two on a constrained device); without `Worker`/`OffscreenCanvas` the
same measure runs here in batches of eight with a yield. **Rules**: before
any request, the document's grids and the device's `measures` are copied in
and only a picture with no grid OR no kept tile is fetched — a run
cancelled keeps what landed (grids and tiles are flushed to
`atelier-mosaic` every 48 pictures and at the end), the next run starts
there; a thumbnail that 404s or will not decode is `failed` and SKIPPED,
never the end of the run; the fetches in flight at a cancel are the only
ones repeated. `runMeasure` wraps it as one masthead task with a Cancel.
Driven headless against a stub (300 pictures, cancelled at 150: 148 kept,
the resumed run fetched the other 152 and the two failures; the fallback on
100 more; the tiles 160 × 90 JPEG ~850 B each).

## The shell is the atlas's, minus the sync until M8 (2026-10-31, M3)

`tools/mosaic/MosaicTool.tsx` copies `AtlasTool.tsx`'s shape — `/mosaic/home`
the gallery, `/mosaic/<slug>-<id8>` the editor (`mosaic-route.ts` over the
trips' `tripRef`), a 600 ms debounced local save, ONE tab editing under the
Web Lock (`LockedKind` gained `mosaic`) — without `useDocumentSync`: no
instance lists the kind `mosaic` in its bucket yet, so `MosaicGallery`'s
`useDocumentGallery` driver carries remote stubs that are never called
(`documentSourcesFor('mosaic')` yields the device alone) and `deleteMosaic`
prunes `tiles` and `measures` to what the remaining mosaics reference.
**Registry**: an `editor` under `wip` (Q1 answered by the brief's
recommendation — it has documents and a gallery; the badge is what keeps it
discreet), `accepts: []` since the picker, not the Library, is its door.
**Trap**: `src/app/llms.test.ts` holds `public/llms.txt` to the registry —
a new tool fails CI until that file lists it under its group. The
`.mosaic.json` (`mosaic-file.ts`, kind `atelier/mosaic`) carries the grids
and never a tile; an import makes new ids. Driven headless: new → rename →
export → import (a second mosaic) → delete → reload → reopen by route; no
horizontal scroll at 390 px.

## The instance is a field of its own, and an add is references then a run (2026-11-01, M4)

`MosaicDoc.sourceId` is where the DOCUMENT is kept (the galleries' meaning:
this device, an instance for M8); `MosaicDoc.instance` is the Winnow its
PICTURES come from — the connection's id, set by the first add
(`withPictures`), never changed, and the key the tiles and measures are
filed under. **Why**: a tile's id means nothing on another instance, and a
mosaic kept on instance A may draw instance B's pictures. **How to apply**:
`MosaicPicker.tsx` (the shared picker in SPAN scope on `doc.span`, `all`
ticks, photos and clips — a clip is the still of its poster, `tileOfRow`)
adds REFERENCES only and the editor starts `runMeasure` right after (and
on open when grids are missing: a cancelled run or an import resumes by
itself); a mosaic whose `instance` is not the connected one shows
«pictures from <host>» in place of the door. The band's one verb is
*Measure N* / *Measure again* (the skipped ones), its status the count or
«measuring d / t…»; the Library sidebar is NOT its door (`accepts: []`,
«0 usable by Mosaic» is expected). Driven headless against the stub: 44
rows → *Add 44 to the mosaic* → 44 grids on the document, 9 clips, the
tiles held, a reload refetching nothing, the same span reopened with every
row «in this mosaic».

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
