# Mosaic — a picture made of all the others

**Status: decided (2026-10-31); M1–M3 built the same day, M4–M6 on
2026-11-01, then his frame ask the same day, then the rules of his second
review (lab 2 <https://claude.ai/artifact/Aoe4TKy6uSFKwbawpXE7i8>, seven
commits F1–F7: the card, the shape as the crop's, the matching in lots with
`perf.ts` / `match-pool.ts`, the Performance panel, the chain's queue in
the document and its band `ChainBand.tsx`, the zoom as a crop
`stage-view.ts` / `use-stage-zoom.ts` and the document's undo …)** (the target chosen
in an image field, the mosaic's shape and the part of the target rebuilt —
`frame.ts`, `TargetFrame.tsx`, `TargetChooser.tsx`; M6 `mosaic-player.ts`, `scene-builder.ts`,
`MosaicTransport.tsx`, the reveal and drift clocks in `chain.ts`; M5
`use-mosaic-scene.ts`, `mosaic-paint.ts`,
`match-client.ts`, `tile-bitmaps.ts`, `MosaicStage.tsx`,
`MosaicSettings.tsx`, `use-mosaic-cover.ts`; M4 `MosaicPicker.tsx`,
`mosaic-rows.ts`, `MosaicDoc.instance` and `withPictures`, the editor's
band with the run; M1
`src/shared/mosaic/`: `measure.ts`, `match.ts`, `chain.ts`, `mosaic-doc.ts`,
each with its spec; M2 `measure-worker.ts`, `tools/mosaic/measure-pool.ts`
and `mosaic-store.ts`, the legal notice's line — Q2 answered yes, the tiles
are kept; M3 the document's store, `mosaic-file.ts`, `MosaicGallery.tsx`,
`MosaicEditor.tsx`'s frame, `MosaicTool.tsx`, the registry entry as an
`editor` under `wip` — Q1 by recommendation —, the README and `llms.txt`),
M7–M9 next. §2 is what he chose; §3–§7 are the design that follows from it;
§8 the questions still his. Lab (French,
synthetic pictures, six modes playable):
<https://claude.ai/artifact/6CZzJywDu19CsJWZR6eSMi>. §1 is fact, read in
this repository on branch `claude/awesome-babbage-q2mvg3` off `main`.

Written from his ask: *«répliquer le screensaver … de macOS … chacune des
cellules représentant la photo était en fait une autre photo … la couleur
dominante de chacune des photos … un système de worker … conserver … en
cache, peut-être même la conserver dans le projet … un mode single … un mode
animé … un mode qui va reproduire à peu près ce que l'on avait dans le
screensaver»*, then his four picks on the lab's questions: *«Grille 6×6,
cellule en pixels, Winnow seul, .mosaic.json»*.

The reference is macOS's « Mosaic » screen saver (10.5 → 10.14, since
removed): one photo on screen, the camera pulls back, the photo turns out to
be one tile of a larger photo made of hundreds of them, which the saver then
shows plainly before pulling back again. An instrument of the suite, not
highlighted («pas forcément mis en avant»), and maybe never on the deployed
site («peut-être pas forcément sur la version en ligne»).

## 1. What exists (fact)

- **Winnow's thumbnails are already measured for colour, on the main thread.**
  `shared/media/thumb-metrics.ts` (pure) reads sharpness, exposure, a colour
  reading (hue families, one mean `hex`, warmth) and a dHash off a raster;
  `shared/sources/winnow/thumb-analysis.ts` fetches `client.thumbUrl(id)`
  (`/api/assets/:id/thumb`, ~400 px JPEG), shrinks it to 128 px through
  `shared/media/blob-raster.ts` (a DOCUMENT canvas — it cannot run in a
  worker as written), six at a time, and keeps up to 5 000 readings in a
  session `Map`. Nothing is kept across reloads, and the colour reading is
  one mean colour per picture, not a grid.
- **The one Winnow picker** (`shared/sources/winnow/picker/`, `PickerHost`,
  `winnow-picker.md`): a host names what it holds, what is ticked on open,
  `accepts`, `narrow: { mediaType }` sent to the server, and verbs whose
  `run(rows, { signal, progress })` gets the ticked rows. Its SPAN scope asks
  a date range whole, in parts planned from `/api/assets/calendar`, up to
  `SPAN_CAP` 20 000. Develop's *Add a day* adds REFS and fetches nothing
  (`RollPicker.tsx`); Flight Atlas's door opens on a span
  (`AtlasWinnow.tsx`).
- **A worker pattern exists**: `shared/segment/segment-worker-client.ts`
  starts a CLASSIC worker (`new Worker(new URL('./x.ts', import.meta.url))`,
  `vite.config.ts` leaves the worker format at `iife`), guarded by
  `workerPossible()` (Worker + OffscreenCanvas + createImageBitmap), with a
  main-thread fallback. No worker pool exists yet.
- **The document pattern is the atlas's**: its own IndexedDB database
  (`tools/atlas/atlas-store.ts`, `atelier-atlas`: `atlases`, `logs`,
  `thumbs`, `sync`, `kv`), a `read*` that drops what does not fit
  (`local-first.md`, «A document is UNTRUSTED input»), a gallery, a portable
  file (`shared/develop/roll-file.ts`: a `kind` marker, a `version`, a fresh
  id on import, `sourceId` and timestamps left out), and a remote driver
  over `sources/doc-remote.ts` + `doc-sync.ts` filed under a `kind` the
  instance's bucket must list (`atlas-remote.ts`; `client.ts` line 488:
  an instance that lists no kinds accepts `trip` and `project` only).
- **Small pictures of his Winnow ARE kept on the device, once**: the
  Storytelling wall (`tools/storytelling/wall-cache.ts`, `atelier-storytelling`
  → `tiles`, a 192 px JPEG square per asset), his pick, said in
  `LegalNotice.tsx` and in `local-first.md`'s persistence entry as the fifth
  case of media bytes persisted.
- **Progress and cancel** go through `shared/tasks/tasks.ts` (`startTask`
  with a `cancel`, the masthead pill, a `TaskEdge` on a stage); an
  `AbortSignal` is the cancel's shape (`tasks.md`).
- **A video from painted frames** is `shared/media/render-video.ts`'s
  `encodeFrames` (H.264 MP4, no audio, a paint callback per frame, a
  `signal`), used by Trips' decks and the atlas; a PNG still is a canvas
  `toBlob`. The atlas rules apply to any animated painter: one painter for
  preview and export, sized by the short side; a camera that is a FUNCTION
  of time, never an accumulator in the rAF loop (`flight-atlas.md`).
- **The registry** (`src/app/tools.tsx`): `group: 'editor' | 'instrument'`
  (an editor has documents and a gallery and a door on the home page), and
  `wip: { note }` for a tool still being built — Storytelling is the model.
- **Memory budgets on a phone** are `device-memory.md`'s: a constrained
  device decodes to a long edge per purpose, lets decoders go after rest,
  and holds a few tens of MiB of pictures at most.

## 2. His decisions (2026-10-31)

| | Decision | What it fixes |
| --- | --- | --- |
| D1 | **The measure is a 6 × 6 grid of mean colours** per picture (108 bytes), not one dominant colour. | The three matching levels (1×1 mean, 2×2 quarters, 3×3 zones) derive from it without remeasuring; a mosaic's reading of its target comes from the same grid. |
| D2 | **The cell size is in screen pixels** (a 40 px cell at 1080p; a 4K export has more cells, not bigger ones). | `cellPx` is the setting; `cols = round(W / cellPx)`; more pixels, more cells. |
| D3 | **Winnow is the only source.** No local folder, no file hashing. | A tile is `(instance, assetId)`; its bytes are the instance's thumbnail and proxy; the picker is the one door in. |
| D4 | **A `.mosaic.json` document**, exported like a roll. | The library's refs, their grids, the settings and the target travel; reimported anywhere, nothing is remeasured. |

The lab's own recommendations, not overruled and taken as the default until
he says otherwise: a **tint of 25 %** (a veil of the cell's colour over its
picture, a slider from 0); **no two identical neighbours**, on, switchable;
**cells the frame's shape** (16:9 on a 16:9 stage, so a cell zoomed is
exactly the next picture); **matching in OKLab**; **a clip counts as the
still of its Winnow thumbnail** (its poster), so videos cost nothing more.

## 3. The model

```ts
// shared/mosaic/mosaic-doc.ts (pure)
interface MosaicDoc {
  version: 1;
  id: string;              // fresh on import
  sourceId: string;        // the Winnow source this mosaic's tiles come from — ONE instance
  title: string;
  createdAt: number; updatedAt: number;
  span?: { from: string; to: string };   // the picker's last span, to grow the library later
  tiles: MosaicTile[];                   // the library, in the order added
  target?: number;                       // assetId of the picture reconstituted (single · dézoom)
  settings: MosaicSettings;
}
interface MosaicTile {
  id: number;              // Winnow asset id
  hash?: string;           // the row's content hash when it carries one — finds the same bytes on another instance
  kind: 'photo' | 'clip';
  grid: string;            // base64 of 108 bytes: 6 × 6 × RGB, row-major, sRGB
}
interface MosaicSettings {
  cellPx: number;          // 12..160, the cell's WIDTH in stage pixels (D2)
  level: 1 | 2 | 3;        // the descriptor compared: mean, quarters, zones
  space: 'oklab' | 'rgb';
  tint: number;            // 0..0.7
  distinctNeighbours: boolean;
  mode: 'single' | 'dezoom' | 'chain' | 'reveal' | 'drift';
  direction: 'in' | 'out' | 'alternate';   // the chain's
  speed: number;           // ×0.4..2.5 over the base durations
  seed: number;            // the chain's picks and the reveal's origin — preview = export
}
```

- **One instance per mosaic** (`architecture.md`: a document belongs to ONE
  source). Two instances are two mosaics.
- **The grid in the document is the measure of record.** 10 000 tiles ≈
  10 000 × (144 base64 chars + ~40 of JSON) ≈ 1.9 MB — a `.mosaic.json` a
  phone reads in a blink. The 1×1 and 2×2 and 3×3 levels are DERIVED on load
  (`levelOf`), never stored.
- **The device keeps two caches beside the documents**, in a new database
  `atelier-mosaic`: `measures` (the grid per `${sourceId}:${assetId}`, shared
  by every mosaic of the device, so adding the same day to a second mosaic
  measures nothing) and `tiles` (a 160 × 90 JPEG per asset, the picture a
  cell DRAWS, ~6 kB — the wall's precedent, bounded by what the device's
  mosaics reference and deleted with the last mosaic that does). Plus
  `mosaics`, `thumbs` (a poster per mosaic for the gallery) and `sync`
  (created now, used when the instance lists the kind — M8).
- **The target's crisp picture is never kept**: Winnow's proxy (≤ 2048 px),
  fetched through `materialize` at `proxy` fidelity when a picture becomes
  the target, held in memory for the current and next target only.
- **The legal notice and `local-first.md`'s persistence entry gain the
  sixth case** in the same commit as the store (CLAUDE.md context): what is
  kept (grids, 160 px tiles, posters), of whose pictures (his instance's),
  and what clears it (deleting the mosaic; a *Forget* in the gallery).

## 4. The pipeline

### 4.1 Choose — the picker with a mosaic host

`tools/mosaic/MosaicPicker.tsx` passes a `PickerHost`: title *Add to the
mosaic*, `start.scope: 'span'` (the document's last span, else the month to
today), `accepts` photos and clips, `held` = the tiles already in the
document, opening ticks `all` (everything but the rejects — the point is
volume), one verb *Add N to the mosaic* that adds REFS (id, hash, kind) and
fetches nothing — Develop's rule. The run then starts measuring (4.2) as a
task of its own, cancellable, resumable.

### 4.2 Measure — fetch on main, decode and read in a pool

- `shared/mosaic/measure.ts` (pure): `gridOf(raster: Raster): Uint8Array`
  — the 6 × 6 box means of an RGBA raster, the same arithmetic as
  `thumb-metrics.ts`'s `greyGrid` in colour; `encodeGrid` / `decodeGrid`
  to and from base64; `levelOf(grids, n, k)`; `toOklab`.
- `shared/mosaic/measure-worker.ts` (classic, no static import — the
  segment worker's trap): receives `{ id, blob }`, does
  `createImageBitmap(blob, { resizeWidth: 160, resizeHeight: 90,
  resizeQuality: 'medium' })`, draws it on one reused `OffscreenCanvas`,
  encodes the **160 × 90 tile** (`convertToBlob` JPEG 0.82), draws the same
  bitmap at 24 × 24 and reads the **grid**; posts `{ id, grid, tile }`, the
  grid's buffer transferred. One decode, two products.
- `shared/mosaic/measure-pool.ts`: N workers, N = `hardwareConcurrency − 1`
  clamped to 2..6 (2 on a constrained device, `device-class.ts`); the MAIN
  thread fetches the thumbnails (`client.fetchFile(client.thumbUrl(id))`, the
  auth and the retry live in the client), 6 in flight like `thumb-analysis`,
  and hands each blob to the idlest worker. A thumbnail that will not decode
  is recorded as `failed` on the tile and skipped, never the end of the run
  (`winnow-picker.md`'s rule for a dead log).
- **Resumable by construction**: before fetching, each tile's id is looked up
  in `measures`; what is there is copied into the document; a run cancelled
  at 3 000 of 10 000 keeps the 3 000. One `startTask` for the run, with a
  `cancel`, the pill in the masthead.
- Measured in the lab: ~2 500 synthetic pictures/s on 3 workers in a
  container. Real JPEG thumbnails decode slower; 10 000 should take under a
  minute on four cores, the network being the likelier bound (~15 kB each,
  150 MB for 10 000 — said in the task's detail with a count).
- A main-thread fallback (`workerPossible()` false) uses
  `rasterOfBlob` + `gridOf` in batches with a yield, as today's analysis
  does; it is slower and says so.

### 4.3 Match — pure, in a worker when large

`shared/mosaic/match.ts` (pure, tested):

- `cellGrids(targetRaster, cols, rows)`: the target drawn to
  `cols·6 × rows·6` once, every cell's 6 × 6 read from that one
  `getImageData` (the DOM half, in `mosaic-paint.ts`; the arithmetic pure).
- `matchCells(cellsK, tilesK, dims, cols, rows, distinct)`: brute force with
  early exit on the running sum, the best three kept per cell, the first
  that is neither the left nor the upper neighbour taken when `distinct`.
  Lab: 576 cells × 600 tiles × 12 dims in 41 ms on the main thread.
  Expected: 1 296 × 10 000 × 27 ≈ 350 M multiply-adds — 0.3–0.8 s in JS.
  **Rule**: under 20 M operations the main thread does it (one frame's
  stall is not worth a round trip); above, the same worker file takes a
  second message kind and the stage shows the previous mosaic until the new
  one lands. An index (colour buckets, k-d tree on the mean) only if a real
  library proves the brute force slow — not before.
- `pickCell(mosaic, history, rnd)`: the chain's next dive — a good match,
  near the centre, not the target itself, not among the last 12 pictures
  visited; random among the best 15 %, from the document's seed.
- `pickNextTarget(current, tiles, history, rnd)` (zoom out): 24 candidates,
  the one whose 6 × 6 holds the zone closest to the current picture's mean.
- `forceInto(mosaic, tile)`: the cell whose descriptor is closest to the
  tile takes it (the zoom-out's seam, hidden by the tint).

### 4.4 Paint — once, then transform

`tools/mosaic/mosaic-paint.ts`, one painter for the stage and every export,
sizes given for a 1080 short side × `unit` (the atlas rule):

- `paintMosaic(ctx, mosaic, tiles, settings)` draws every cell ONCE into an
  offscreen canvas at the output size (`drawImage` of the 160 × 90 tile,
  then the tint `fillRect`), ~1 300 draws, 10–20 ms.
- A frame is: the mosaic canvas through one `setTransform` (scale `s` about
  the camera's centre); over the FOCUS cell, the crisp proxy of its picture,
  alpha rising from `s = 1.6` to `3.2`; at the end of a zoom-out, the crisp
  target cross-fading over the mosaic. Zoom in LOG space, eased.
- A 160 px tile covers a cell of 40 px up to `s = 4`; past it only the focus
  cell is crisp and the neighbours blur — accepted, it is what the eye is
  on. A 4K export at 40 px cells draws 160 px tiles at 160 px: exact.
- **Memory**: a mosaic of 1 300 visible tiles is ~5 MB of decoded 160 × 90
  bitmaps (`createImageBitmap` from the `tiles` store, kept in a `Map` per
  mosaic, released when the target changes); the mosaic canvas is one frame
  (1920 × 1080 × 4 = 8 MB; a 4K export's 33 MB lives for the export). A
  phone holds this.

### 4.5 Export and the screen saver

- **PNG** of the mosaic at the stage's size or a chosen width (cells follow
  D2: more cells, not bigger).
- **MP4 of a chain**: `encodeFrames` over the same painter, `seconds` =
  N steps × the step's length, every pick from the document's seed so the
  preview and the file show the same chain; the targets' proxies fetched
  ahead of their step. H.264 is not encodable headless here (the atlas's
  limit); the PNG path is.
- **Play** fills the stage and, on request, the screen (the Fullscreen API,
  tolerated when refused) — a Mac left open on Atelier is the screen saver.
  No OS integration: a `.saver` bundle is not a browser's to make.

## 5. The modes

| Mode | What happens | Ends |
| --- | --- | --- |
| **Single** | The target reconstituted, still. Click a cell: its picture becomes the target. Ghost slider to check the reading, grid switch. | — |
| **Dézoom** | The target's picture is forced into the next target's mosaic; a cell fills the frame, the camera pulls back, the mosaic fades to the real picture. | Hold; *Replay*. |
| **Chain** | Endless. `in`: target → its mosaic → dive into a cell → that picture is the target. `out`: the dézoom, repeated. `alternate`: one in, one out. | Never; Escape. |
| **Reveal** | The mosaic, then its cells flip to the real picture from a seeded origin. | Hold, next target. |
| **Drift** | Ken Burns over the mosaic at mid-zoom. | Never. |

Base lengths (×`speed`): hold 1.1 s, dissolve 0.9 s, zoom 3.8 s, resolve
0.9 s, reveal 3.2 s. Left for a later round, described in the lab's §5:
infinite depth (a cell is itself a mosaic), metamorphosis (A's cells slide
into B's places), a day's own pictures (Trips knows the days), living cells
(a few looping clips), the breathing wall.

## 6. Where it lives

- `src/tools/mosaic/` — `MosaicTool.tsx` (gallery + editor, the atlas's
  shape), `MosaicPicker.tsx`, `MosaicStage.tsx`, `MosaicSettings.tsx`,
  `mosaic-paint.ts`, `mosaic-store.ts`, `mosaic-file.ts`, `mosaic-remote.ts`
  (M8), `measure-pool.ts`.
- `src/shared/mosaic/` — the pure half, tested: `mosaic-doc.ts` (types,
  `readMosaicDoc`, `createMosaicDoc`), `measure.ts`, `match.ts`,
  `chain.ts` (the clock: phase and camera as a function of time and seed),
  `measure-worker.ts`. `shared/` imports nothing from `tools/`.
- The registry: `id: 'mosaic'`, `path: '/mosaic'`, `label: 'Mosaic'`,
  `subtitle: 'A picture · all the others'`, `wip: { note }`, `accepts: []`
  (the sidebar's Library is not its door — the picker is). `group` is his
  (§8 Q1); the recommendation is `editor` with `wip`, Storytelling's exact
  status, because it HAS documents and a gallery; what hides it from the
  home page is the `wip` badge, not the group.
- README: a paragraph under the tools, its browser caveats (WebCodecs for the
  MP4, workers), the network it uses (the connected instance's thumbnails
  and proxies — no new exception).

## 7. The plan, in commits

Each one green on typecheck · lint · test · build, driven headless against
the Winnow stub where it touches the instance.

| | Commit | Delivers | Verified by |
| --- | --- | --- | --- |
| M1 | **The pure core** | `shared/mosaic/measure.ts`, `match.ts`, `chain.ts`, `mosaic-doc.ts` with `readMosaicDoc`; the grid's base64; levels; OKLab; best-three matching with the neighbour rule; `pickCell`, `pickNextTarget`, `forceInto`; the clock. | `.test.ts` beside each: a known raster's grid, a level's means, a seeded chain replaying identically, a document with a bad tile dropped. |
| M2 | **Measuring in a pool** | `measure-worker.ts`, `measure-pool.ts`, the `atelier-mosaic` database with `measures` and `tiles`, the task with its cancel, resume from the store, the main-thread fallback; `LegalNotice.tsx` and `local-first.md` say the store. | Headless: 300 stub thumbnails measured, cancelled at half, resumed with no refetch; the fallback path forced. |
| M3 | **The document and the gallery** | `mosaic-store.ts` (`mosaics`, `thumbs`, `sync`, `kv`), `mosaic-file.ts` (`.mosaic.json`, `atelier/mosaic`), `MosaicTool.tsx`'s gallery (new, open, delete, import, export), the registry entry with `wip`, the README paragraph. | A round trip export → import gives a second mosaic with the same tiles and a fresh id; a newer version refused. |
| M4 | **The door** | `MosaicPicker.tsx` over `WinnowPicker` (span by default, `all` ticks, *Add N to the mosaic* adds refs and starts M2's run); the editor's library band (count, measured, failed, *Measure again*). | Headless against the stub: a span of 44 → 44 tiles, 44 grids, 44 tiles kept. |
| M5 | **Single** | `MosaicStage.tsx` + `mosaic-paint.ts`: the target's proxy fetched, cells read, matched, painted once; the settings panel (cell px, level, space, tint, distinct, grid, ghost); click a cell to retarget; the matching moved to the worker past 20 M operations. | Headless: a target reconstituted from the stub's 44 and from 3 000 synthetic grids; the match time read in the status line. |
| M6 | **The animated modes** | Dézoom, Chain (in · out · alternate), Reveal, Drift; the camera from `chain.ts`'s clock; the next proxy fetched during the hold; Play / Escape; fullscreen. | Headless frames at fixed times compared with the clock's state; 60 fps on the synthetic library. |
| M7 | **Exports** | PNG at a chosen width; MP4 of N steps through `encodeFrames` with the seed; the task and its cancel. | The PNG headless; the MP4 on his Mac (no H.264 here). |
| M8 | **Kept on a Winnow** | `mosaic-remote.ts` under `kind: 'mosaic'`, the atlas's driver; sync pill. | Against the stub listing the kind; the instance's side is his (Q6). |
| M9 | **Agent commands** | `mosaic.add`, `mosaic.measure`, `mosaic.target`, `mosaic.mode`, `mosaic.export` through `useRegisterCommands`. | The MCP script driving a mosaic end to end. |

M1–M5 make the instrument; M6 makes it the screen saver he described; M7–M9
are the suite's standards.

## 8. Still his

1. ~~**Group and door.**~~ **Taken by recommendation (2026-10-31, M3)**:
   an `editor` with `wip`, Storytelling's status; his to overrule.
2. ~~**Tiles kept on the device.**~~ **Answered yes (2026-10-31)**: the
   160 × 90 JPEG per asset (~1–6 kB), deleted with the last mosaic that
   references it (M2).
3. **Clips.** Their poster as a still (recommended, free), or excluded?
4. **Library ceiling.** `SPAN_CAP` 20 000 per add is the picker's; is a
   mosaic of more than 20 000 tiles wanted (two adds), and should the
   document refuse past some size?
5. **The name.** *Mosaic* (the suite speaks English). Else *Tessera*.
6. **Winnow's side** for M8: adding `mosaic` to the bucket's kinds is a
   change in Winnow, his to make there.
7. **The screen saver's home.** Fullscreen in the browser only (recommended
   for now); a native saver is a later shell's.
