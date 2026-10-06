# Develop on a phone — the work a slider step costs, and the plan to cut it

*2026-10-06. From the maintainer's ask beside the tone engine: professional
results, «qu'on sépare peut-être les units of work … créer du cache, créer des
tailles, des miniatures, y aller petit à petit, utiliser l'index DB s'il le
faut … je suis très ambitieux pour que ce projet fonctionne sur mobile».
§1 is fact, measured headless on the render core's own counters; §2 is the
first unit, built; §3 the plan in commits; §4 what is his to decide. Sized in
commits, never in days.*

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

## 2. The first unit: the kept upstream (built)

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

## 3. The plan, in commits

- **P1 — the kept upstream.** Built (§2).
- **P2 — the band's cells on demand** (audit PERF-03). The roll band renders
  every cell and fetches every stored thumbnail at once; on a phone a roll of
  hundreds of pictures pays for all of them before the first appears. Cells
  observed (`IntersectionObserver`), `<img loading="lazy">`, thumbnails read
  for the cells on screen first, the memo kept while thumbnails arrive.
  Verified by counting `getAll`/decodes per roll open in the bench.
- **P3 — the stage under the hand.** While a pointer is down on a slider, a
  pinch or a wheel, render at half the stage's size and draw it up; the full
  render on rest. Lightroom's way. To be MEASURED first on his phone with P1
  in place: a tone step is now six cheap passes, and a half-size render may
  buy nothing visible. Never for the export, the histogram or a snapshot.
- **P4 — the picture switch.** ←/→ decodes the next picture at the stage
  budget every time. Keep the last decoded stage sources in a session LRU
  under a byte ceiling (`decoded-cache.ts` does it for a RAW; a still's
  `ImageBitmap` is the same shape), pre-decode the two neighbours in the
  roll's one background slot, release the far ones. Verified by the decode
  count per switch.
- **P5 — the shell's start on a phone** (audit PERF-04, PERF-05, PERF-06):
  the entry chunk no longer importing the document stores, the Home doors
  reading one document instead of migrating every one, the gazetteer parsed
  in a worker.
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
