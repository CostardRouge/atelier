# Mosaic — a picture made of all the others

Read before touching `src/shared/mosaic/` (the pure core) or
`src/tools/mosaic/` (the instrument). The brief, his decisions and the plan
M1–M9 are `docs/mosaic.md`; this file holds the rules the code fixed for
the core — the measure, the shell, the stage, the player. The rest is
split by area (2026-11-01, the file had passed 500 lines):
`mosaic-frame.md` (the target's frame and shape, the zoom as a crop,
previous/next, the phone layout), `mosaic-matching.md` (the matching in
lots, the Performance panel, the loading) and `mosaic-motion.md` (the
chain's queue and band, the step grammar of lab 3, steering).

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

## The shell is the atlas's (2026-10-31, M3; rev. 2026-11-01, M8)

`tools/mosaic/MosaicTool.tsx` copies `AtlasTool.tsx`'s shape — `/mosaic/home`
the gallery, `/mosaic/<slug>-<id8>` the editor (`mosaic-route.ts` over the
trips' `tripRef`), a 600 ms debounced local save, ONE tab editing under the
Web Lock (`LockedKind` gained `mosaic`), and since M8 the shared
`useDocumentSync` (`mosaic-remote.md`); `deleteMosaic` prunes `tiles` and
`measures` to what the remaining mosaics reference.
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

## The stage: one painted canvas, a scene rebuilt by its inputs (2026-11-01, M5)

`use-mosaic-scene.ts` rebuilds the mosaic when the target, the measured
library, a matching setting (`cellPx`, `level`, `space`, `tint`,
`distinctNeighbours`) or the stage's size changes: the target's PROXY
fetched (a clip's thumbnail; the last four targets held as bitmaps), its
cells read off a cover crop at the stage's shape (`targetCellsOf`), matched
on this thread or — past 20 M multiply-adds, `match-client.ts` — in a
one-off `measure-worker.ts` (its second message kind), the tiles' bitmaps
read from the device (`tile-bitmaps.ts`, an LRU of 2 000 / 600 on a phone,
a missing tile fetched from the thumbnail and kept again), the mosaic
painted ONCE (`paintMosaic`); the previous scene stays on screen until the
new one lands. The cell count follows the stage's CSS width (D2), the paint
is at `dpr`. **Traps**: the room is measured on the WORKBENCH mounted with
the pictures (`MosaicWorkbench`) — a size hook on the editor measured a box
that did not exist yet and the canvas stayed 1 × 1; `SliderBar`'s range
input is named by its `name` prop in lower case (`getByRole('slider', {
name: /^cell$/i })`). The ghost and the grid are the screen's (`StageView`),
never the document's; the gallery's poster is the scene's own canvas scaled
to 640 × 360 after 2 s still (`use-mosaic-cover.ts`); a click on a cell
makes its picture the target; *Draw a target* picks one from the seed. The
gallery's «winnow.example does not keep mosaics» line is `AbsentSourceNotes`
being honest until M8. Driven headless: 400 synthetic pictures, 18 × 18
cells matched in 6 ms here, a click retargeting (one proxy fetched each),
Zones + 12 px → 58 × 58 cells matched in 65 ms in the background, the ghost
changing the pixels, the poster written, no overflow at 390 px.

## The player prepares a step ahead, and a Stop keeps what is seen (2026-11-01, M6)

`mosaic-player.ts` plays the animated modes over `scene-builder.ts` (the
Single stage's pipeline extracted so the player shares its caches: targets,
tiles, memoised descriptors, the library in OKLab). **Rules**: the moment a
step starts, the NEXT step is prepared (its picture picked from the seed,
its proxy fetched, its scene built — a pull-back's scene is the next
picture's with the current one FORCED into a cell) while the current one
plays, and a step that ends first waits on its last frame («waiting for the
next picture»); every frame is `cameraAt` of the time since the step began
(nothing accumulates); the player draws into the stage's canvas and the
stage keeps its hands off while `playing`; a mode or a dial changed under a
run stops it. **The picture on screen is the target when a run ends**
(Stop, Escape, Space, a pull-back once done): the editor writes
`player.current` to the document on the playing → stopped edge, and a
pull-back says `current = next` from its resolve on, so a Stop during the
hold keeps the picture seen. Space plays and stops (the transport's key),
Escape stops; the Screen button is the browser's fullscreen on the stage's
box (`[&:fullscreen]:` arbitrary variants — Tailwind has no `fullscreen:`).
**Trap**: React's development double-mount disposes a memoised builder once
before using it — the tile cache is made lazily (`tileCache()`), never in
the constructor. Driven headless: Chain dive (frames change, step 2 after
~8 s, Escape writes the target), Chain pull out (Space, the target is the
picture seen), Pull back once (ends by itself, the target written), Reveal
and Drift (frames change), fullscreen granted.

## A bitmap a scene may draw is never `close()`d (2026-11-01)

His report: «The image source is detached». Three evictions CLOSED bitmaps
a scene still drew: the tiles' LRU (a mosaic of more than 2 000 distinct
pictures closed the first ones before the paint), the builder's last-four
targets (a chain closed the playing step's target) and `dispose` (React's
development double-mount). **Rule**: caches DROP their references and let
the collector free them; only a bitmap made and used inside one function
(`cropToTile`, the measure worker) is closed. Checked headless: 2 600
pictures, 58 × 58 cells (3 364, matched in the background), a chain of six
steps, no page error.

## The chain is a clock, the picks are seeded (2026-10-31, M1; rev. 2026-11-01)

A step's frame is a FUNCTION of the time since the step began — the atlas
rule, so the stage and an MP4 draw the same frames. Since lab 3 the clock
is `motion.ts`'s `stepFrameAt` (`mosaic-motion.md`); `chain.ts` keeps the
pieces every part uses (`ease`, `cellRect`, `logZoom` — zoom in log space —,
`focusAlpha`, `revealOrder`, `driftCamera`). The picks (`pickCell`,
`pickNextTarget`, `pickDive`) take the document's seeded generator
(`lib/prng.ts`) and a HISTORY, and `forceInto` returns a new `ids` rather
than mutating the matching. **How to apply**: never read `Math.random()` or
accumulate a camera in the frame loop; a replay must only depend on the seed
and the same sequence of picks.
