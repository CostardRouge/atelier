# Develop on a phone — the work a slider step costs, and the plan to cut it

*2026-10-06. From the maintainer's ask beside the tone engine: professional
results, «qu'on sépare peut-être les units of work … créer du cache, créer des
tailles, des miniatures, y aller petit à petit, utiliser l'index DB s'il le
faut … je suis très ambitieux pour que ce projet fonctionne sur mobile».
§1 is fact, measured headless on the render core's own counters; §2 the
units built, one per commit, each with its counts; §3 the plan in commits;
§4 what is his to decide. Sized in commits, never in days.*

## 1. What a slider step cost (fact, measured 2026-10-06)

Counted in headless Chromium against the dev server, SwiftShader, on a
1200 × 800 JPEG seeded with a denoise (luminance 30, colour 20, defringe
20), a sharpen (40), a lens (distortion 12), a keystone (vertical 12), a
post-crop vignette (−30), one radial layer at +0.5 EV and exposure +0.3 — a
developed photograph, not a bare one. `drawArrays` calls per interaction
(each is one pass over the whole stage), the stage's grader and the
histogram's 160 px slot both counted:

| Interaction | Passes drawn before | After the kept upstream (§2) |
| --- | --- | --- |
| Exposure, a step of a drag (the cube) | 20 | **12** (the second step on; the first after a change elsewhere pays 20 once) |
| Highlights (the cube) | 20 | **12** |
| Luminance denoise (the third pass) | 20 | 20 on the first step, 16 from the second |
| Sharpen (the ninth pass) | 20 | 16 on the first step after the denoise moved the checkpoint, **4** from the second |
| A tab opened, nothing changed | 0 | 0 |

The chain the stage draws, in order (`use-develop-picture.ts`,
`graderFrom`): gain map · repair · chroma blur ×2 · bilateral denoise ·
defringe · **the cube** (develop head + look) · lens · keystone · the layers
· presence · sharpen · post-crop vignette · the looking passes (clip, mask
overlay, blink) · the film node. Every step of every slider redrew ALL of it,
on the stage and again on the histogram's slot: the bilateral and the chroma
blurs are neighbourhood filters, the dearest passes of the chain, and a tone
slider never touches what they read.

What was already in place, and stays: the grader keeps its WebGL2 context
across steps (`develop.md`, «The stage's grader LIVES with the source»), the
source is uploaded once per identity, `holdGrades` draws a raster copy on
repaints, the histogram has its own small slot, the layer cache keeps each
layer's cube, raster and pass while its values stand still, the stage works
to a pixel budget (3.7 MP on a phone), a RAW decodes in bands and tiles
(`device-memory.md`), and the band's cells are memoised.

## 2. The units built

### 2.1 The kept upstream (P1)

`RenderPass.key` names everything a pass draws with (`pass-key.ts`: plain
parameters as JSON, an immutable object — a composed cube, a gain field — by
identity, a pass rebuilt whenever its inputs change by a fresh serial). The
graph keeps the OUTPUT of one pass between renders in a third target: on the
next render it compares the keys with the last render's, skips the prefix
that matches up to the checkpoint, and draws from there — then moves the
checkpoint to the input of the first pass that changed, so the next step of
the same drag draws that pass and what follows (`pass-plan.ts`,
`planResume`, pure and specced; `graph.ts`, the three-texture pool). Nothing
changed draws nothing: the canvas holds the picture
(`preserveDrawingBuffer`).

Rules it fixes:

- **A resumed render is the whole render to the bit** — a target holds
  exactly what the pass before it wrote, so every pass reads what it always
  read. The gate holds it (`check-render.mjs`, «the kept upstream»: worst 0
  codes resumed against whole, 3 of 6 passes drawn after a cube change, 0
  when nothing changed, 6 again when the first pass changes).
- **A pass with no key is never skipped, nor anything after it**: the film
  node's grain re-rolls per source instant and has none; the blink's pass is
  a fresh object per phase, so a blink frame draws itself alone.
- **A one-shot render never pays for the texture**: the checkpoint is placed
  from the second render of the same source at the same size on — an export
  or a thumbnail draws once and keeps nothing — and only under 4.2 MP on a
  phone, 9 MP on a computer (one more RGBA16F target at the stage size:
  29 MB at 2560 × 1440, 66 MB at 4K). Bands (a frame ≥ 12 MP) and the
  half-float read-back invalidate it.
- **The histogram's slot benefits for free**: it is a graph like the stage's.

### 2.2 The band's cells on demand (P2, audit PERF-03)

The roll band put every cell in the DOM at open, decoded every stored
thumbnail to measure its shape, and re-rendered every cell for each
thumbnail that landed. Counted headless on a seeded roll of 300 pictures
with their thumbnails stored (`li[data-picture]` cells, `createImageBitmap`
calls, `<img src>` sets, IndexedDB `get`s), the stage at 1400 × 900 and at a
phone's 390 × 844:

| At | Cells before | Cells after | Decodes before | Decodes after | JS heap |
| --- | --- | --- | --- | --- | --- |
| The roll opened, desktop | 300 | **15** | 300 | **0** | 69 → **43 MB** |
| The roll opened, phone | 300 | **8** | 300 | **0** | 43 MB |
| → one picture | 300 | 15 | 0 | 0 | |
| The last picture, by its route | 300 | 15, its own in view | 0 | 0 | |
| The contact sheet (G) | 600 | **60** (76 on a phone) | 0 | 0 | |
| Reopened | 300 | 15 | 0 | 0 | |
| A roll whose thumbnails predate the aspect | — | 15 | 300, once | 0 from then on | |

What it is (`roll-strip.ts`, `RollBand.tsx`, `roll-store.ts`,
`roll-thumb.ts`, `use-thumb-aspects.ts`; the rules in
`docs/memory/develop-roll.md`, «The band draws the cells near the view»):

- **Cells within one box of the scroll view** on the scroll axis, and the
  open one always (`cellsInView`, pure, specced). The scroller publishes its
  position and its box (`useScrollView`: read once per frame, published past
  a quarter of the box), the layout stays whole so the scrollbar keeps its
  length. No `IntersectionObserver` after all: the layout already answers
  every rectangle, and a filter over them is one pass with no observer to
  attach per cell.
- **A cell's rectangle as plain numbers**, so the memo holds while the
  layout is rebuilt; **`<img loading="lazy">`** in the margin.
- **The thumbnail's aspect kept beside its bytes** (`ThumbRecord.aspect`,
  known from the canvas the bake drew on), so a reopened roll lays its band
  out from the store and decodes nothing; a thumbnail stored before is
  measured once at the next open and written back.
- **The open cell scrolled to by its rectangle**, nearest edge, once per
  open picture — never again on a later layout, which would pull the band
  back under a hand that scrolled away.
- **The bake order** is the open picture first, then outward.

### 2.3 The picture switch (P4)

←/→ decoded the next picture at the stage's budget every time, and a picture
stepped back to again — TWICE, measured: the stage made two stage-size
decodes of the same file per switch. Counted headless (the stage's own
paint into its 2D canvas as the clock, never a pixel readback — §2.3's
first version read `getImageData` and measured its own 200 ms GPU sync),
on rolls dropped as real JPEGs, SwiftShader so the ms are relative:

| Step | Before | After |
| --- | --- | --- |
| → the next picture, 24 MP files (6000 × 4000, decoded at 4K) | 750–1 316 ms, 2 decodes | **53–112 ms, 0 decodes** (one step 204) |
| ← back to a picture seen, 24 MP | ~1 250 ms, 2 decodes | **90–95 ms, 0 decodes** |
| A picture far down the roll by its route, 24 MP (cold) | 1 023 ms, 2 decodes | 636 ms, 1 decode, its two neighbours warmed after |
| → the next picture, 1600 px files | 90–155 ms, 2 decodes | **33–67 ms, 0 decodes** |
| Ten 24 MP pictures held | — | 8 of 10 under the 256 MiB ceiling; the two oldest let go (the second decoded again when opened, measured) |

What it is (`shared/media/borrowed-cache.ts`, `shared/develop/stage-sources.ts`,
`still-fit.ts`'s `stageHoldFor`, the roll editor's `warmNeighbours`; the rules in
`docs/memory/develop.md`, «The stage's stills are HELD across a switch»):

- **A borrowed cache**: a still decoded for the stage is held under a byte
  ceiling (48 MiB on a phone — three at its budget —, 256 MiB on a
  computer), the open picture BORROWED and never disposed under the stage,
  the rest least recently used first, the newest never; a `clear()` (a
  phone's tab hidden) dooms the borrowed one to its last release. One decode
  per key at a time: the stage and a warm asking for the same picture share
  it, which is also what folded the second decode per switch.
- **The roll warms the two neighbours** once the open picture has rendered
  (its snapshot is the signal), in the one background slot the thumbnails
  and the previews use, the next before the previous; a clip, a sensor
  develop, a picture that opens on a chosen file and a roll that opens on a
  role are left alone — the stage would not decode the file in hand.
- The hook's `release` hands a still back instead of closing it; the loupe,
  the exports and the thumbnails keep their own decodes and the RAW cache
  its own.

### 2.4 The shell's start, first half: the entry chunk and the doors (P5a)

The shell's first-paint chunk had grown back to **650 kB**: the Home doors
and the Sources screen imported the three document stores statically
(audit PERF-04), and the Library sidebar imported the project document's
types for one eight-line record (`SavedMediaRef`), which dragged the
overlay, the shades, the film texture, the export variants and the develop
model with it — found with a static-import walk from `main.tsx`
(`testing.md`, «What the entry chunk reaches»). Measured on `vite build`:

| | Before | After |
| --- | --- | --- |
| Entry chunk, minified | 650 505 B | **424 883 B** (−35 %) |
| Entry chunk, gzip | — | 139 139 B |
| Modules reached statically from `main.tsx` | 149 | 136 |
| `migrateRollDoc` / `halation` / `hookSeconds` in the entry | 0 / 36 / 8 | 0 / 0 / 0 |

What it is: `src/app/documents-read.ts` — one document per door
(`studioDoor`, `tripsDoor`, `developDoor`) and every document for Sources'
count — imported with `import()` by Home and Sources, the types alone
crossing statically; `shared/projects/media-ref.ts` holding the record and
`project-types.ts` re-exporting it, so no reader changed.

**PERF-05, measured and NOT cured by this**: each door read every document
and migrated all to show one. `lastRoll` / `lastTrip` / `lastProject` now
compare the raw records' `updatedAt` and migrate one — but on a 300-picture
roll with 60 journal steps each (5.7 MB of JSON), `listRolls()` is 73–78 ms
warm and `lastRoll()` 65–118: the cost is IndexedDB's structured clone of
every record in `getAll()`, not the migration. The cure is an `updatedAt`
index walked with a KEY cursor (no body read), which is a schema bump and
so waits on DATA-09's version-change handling (`docs/audit-2026-10-02.md`).
The one-document reads stay because they are the right shape, not because
they measured.

### 2.5 The shell's start, second half: the gazetteer off the main thread (P5b)

The city index (135 233 rows, 6.5 MB) was fetched, parsed and its towns
sorted on the main thread the first time a map opened (audit PERF-06).
Measured headless with a 5 ms timer chain as the stall detector (the Long
Tasks API reports nothing in the headless shell), the index and the sorted
towns asked for back to back, then one `nearestCity`:

| | Before (in thread) | After (`gazetteer-worker.ts`) |
| --- | --- | --- |
| Main thread blocked | **364 ms** (one stall of 324) | **127–169 ms** (one of ~130: the parsed list's structured clone on receipt) |
| Wall to the sorted towns | 217 + 156 ms | 517–537 ms, off the thread (the worker's start, its fetch, the clone) |
| The sort on the main thread | 156 ms | **0** (the order crosses as a transferred `Uint32Array`) |
| One `nearestCity` after | 11 ms | 8–10 ms |

What it is: the worker fetches, parses (`parseGazetteer`) and orders the
towns (`townOrder`, pure, specced: indices into the list, suburbs left
out), posts the list and the order, and is ended at once — the JSON text
and its rows never touch the main heap. `loadGazetteer()` keeps its
signature; `loadTowns()` is the maps' shared read (`TripMapView`,
`StopsMapSheet` had each sorted on their own); no `Worker` falls back to
this thread. **What remains is the clone**: a columnar index (names as
one array, numbers as typed arrays, transferred) would bring the main
thread to ~0 ms and needs `nearestCity` and the maps to read columns —
the step to take if 130 ms still shows on his phone.

## 3. The plan, in commits

- **P1 — the kept upstream.** Built (§2.1).
- **P2 — the band's cells on demand** (audit PERF-03). Built (§2.2).
- **P3 — the stage under the hand.** While a pointer is down on a slider, a
  pinch or a wheel, render at half the stage's size and draw it up; the full
  render on rest. Lightroom's way. To be MEASURED first on his phone with P1
  in place: a tone step is now six cheap passes, and a half-size render may
  buy nothing visible. Never for the export, the histogram or a snapshot.
- **P4 — the picture switch.** Built (§2.3).
- **P5 — the shell's start on a phone** (audit PERF-04, PERF-05, PERF-06).
  Built (§2.4, §2.5); PERF-05's index and the columnar gazetteer are the
  recorded next steps, each on a measurement.
- **P6 — a render off the main thread**, if P1–P3 leave a drag that still
  stutters on his phone: the stage's graph in a worker over an
  `OffscreenCanvas` (`transferControlToOffscreen`), the main thread free for
  the hand. A real change of seam (sixteen consumers of `makeFrameGrader`);
  measured before, never assumed.

Each commit: one unit, its counts before and after in the bench, the gate
green, the README saying what the code does.

## 4. His to decide

- **IndexedDB for a Winnow picture's bytes.** He declined a byte cache for
  remote pictures (`architecture.md`, «re-fetched from the ref's own
  assetId, never cached»); «utiliser l'index DB s'il le faut» reopens it
  only on his word. The working previews (2048 px, local pictures, opt-in,
  `develop-media.md`) are the shape it would take: a per-roll, opt-in,
  weighed cache of the instance's proxies.
- **Thumbnail sizes.** The band's cells are baked at one size
  (`roll-thumb.ts`); a second, smaller size for the contact sheet and the
  gallery covers is cheap to add and worth it only if P2's counts say the
  decode is what hurts.
- **P3 before or after P4**: which of a drag and a switch he feels first on
  his phone.
