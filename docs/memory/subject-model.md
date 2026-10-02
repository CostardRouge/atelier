# What the subject model answers, and what is made of it

Read before touching `segment/segmenter.ts`, `segment/subject-refine.ts`,
`SubjectMask.minus` / `tolerance` / `islands` / `grow`, or the subject's
Remove switch and Refine knobs. How a tap reaches the model, the blink and the
export path are `subject-picking.md`; the plan these steps come from is
`docs/mask-ui-redesign.md` §5.

## The model runs in a WORKER (2026-10-02)

`segment-worker.ts` + `segment-worker-client.ts`, behind the same
`loadSegmenter` / `segmentPoint`; `segmenterPlace()` says where it landed.
**Why**: `segment()` answers synchronously on the thread that calls it, so
on the main thread every tap and every re-ask of a point (a lens or
keystone change, a RAW rung switch — the view's key) stood the whole
interface still for the inference, which his *"ui / app freeze"* was in
part. **Rules**: the worker is a CLASSIC worker (MediaPipe loads its wasm
glue with `importScripts`, which a module worker has not got — it then asks
`document` for a `<script>` and fails), so `segment-worker.ts` has no static
import of its own; the model is handed an `OffscreenCanvas` (`canvas:`),
since a worker cannot make a `<canvas>` and WebKit's path asks the document
for one; the picture is shown ONCE per source identity (an `ImageBitmap`
copy, transferred) and a point is then a message of four numbers; the
answer's bytes are transferred back. One worker, one inference at a time —
the single result slot the main-thread path serialised by hand is now the
worker's message queue. Where no worker can run it (no `Worker`, no
`OffscreenCanvas`, the model failing to load there), the model loads on the
main thread exactly as before; `localStorage['atelier.segment'] = 'page'`
forces that path for diagnosis. Still synchronous INSIDE the worker: a
second tap waits for the first, which is the model's own rule.

## Taking a subject BACK — Remove, built (2026-10-02)

His report: the model only adds, and sometimes adds too much. `magic_touch`
takes a `keypoint` or a `scribble` and never a negative point, so a removal is
ARITHMETIC on its answers: `SubjectMask.minus` (optional, absent when empty —
no roll migrated) holds the points tapped out, each segmented by the same
model, and `composeSubject` (`segmenter.ts`, pure, tested) is the union of the
added points' rasters less the union of the removed ones (`a × (1 − b)`, the
suite's one subtraction). **ONE function for the stage and the export**
(`useSubjectMasks`, `segmentSubject` ← `subject-rasters.ts`), or the file
would carry the bench the stage left out. A removal alone makes no subject.

- **The tap's tone is read off the PRESS** (`paint.onStart(at, { alt })`):
  the mode is a switch (`+ Add | − Remove`, in the panel AND over the picture's
  top-left corner while picking — `DevelopViewport`'s `tool` slot), ⌥ flips it
  for one tap; a held ⌥ only DISPLAYS the flip (switch, cursor), never decides
  it, so no key state can lag. Back to Add whenever another layer opens.
- **Pins**: `tapSubject` (pure) takes the NEAREST pin of either kind off, else
  places one of the tap's tone; added = paper disc `+`, removed = ink disc `−`
  (`bg-frame` / `on-media`, fixed tokens on a picture), `×` under the pointer
  for both — `−` stopped meaning "click to remove" the day it became a kind.
  A minus cursor (`SUBTRACT_CURSOR`) replaces `copy` in Remove.
- **The record keys taps SIGNED** (`+`/`-` + `pointKey`), the cache UNSIGNED:
  the model's answer to a point is the same either way, the tap is not.
- **The blink has a tone** (`MaskFlash`): a removed region blinks in ink
  through its own cube and pass id — a red blink would say "added".

Driven headless (a yellow disc inside a blue square): the + on the square
took the disc in (washed 223,112,32), the ⌥-tap took it out (230,200,40,
unwashed), the disc blinked dark (G 200 → 72), dropping the − pin put it back.

## Refining what the model found — built (2026-10-02)

His answer to the brief's question 4: the knobs are shown at once under the
points, never folded. **The model is asked for its CONFIDENCE map, not its
category mask**, and the category mask is that map cut at one half —
measured on the real model: 0 pixels of 240 000 differ, before and after the
map is quantised to a byte (`v > 127.5`). So a subject at the defaults draws
exactly what it drew before; any change to the cut must keep that identity,
and `subject-refine.test.ts` holds it.

- **What is cached is the confidence**, and the cut is made at compose time:
  Tolerance, islands and Grow / Shrink re-compose from the cache and never ask
  the model (0 "finding it" states over five knob changes, ~0.7 s to the
  stage). The signature the hook re-runs on carries the settings (`refineKey`).
- **One order, in `composeSubject`**: the added answers united and CUT → only
  the regions an added point lands in → grown or shrunk → the removed answers
  united, cut at the SAME tolerance, and subtracted LAST, so growing never
  creeps back into a part the author took out. Islands run before the
  subtraction: they answer "the model returned a second thing", not "a removal
  split the subject".
- **Grow / Shrink counts pixels at the model's 1024 view** (`growPixels`), so
  a value is the same share of any picture; ±24; an exact Euclidean distance
  (Felzenszwalb), so it grows by a disc. The frame's border is not an edge: a
  subject cut by the frame does not shrink away from it.
- **Every setting is off the record at its default** (`withSubjectRefine`),
  so no roll migrated and a knob turned back leaves the roll as it was; the
  pin edits (`tapSubject`, `dropSubjectPin`) keep them — they are the
  subject's, not one pin's. The blink is the tapped answer CUT at the layer's
  tolerance, never the soft map.
- **The model is decisive on flat synthetic shapes** (a tolerance from 5 to
  95 % moves a hard disc's area by ~2 %, and two identical discs never come
  back together), so an island needs an OCCLUDER to show: a dark pole across a
  yellow disc, tapped on the disc, returns the pole inside the disc AND a
  disjoint 1 828-px piece of it below — the exact "adds too much" of his
  report. Driven headless on that scene: the switch drops the island on the
  stage and in the export rasters (`resolveSubjectRasters`), Tolerance moved
  the covered area 155 521 → 161 377 px, Grow / Shrink 114 318 → 208 205.

## The edge — As found · Soft · Snap, built (2026-10-02)

- **CPU, in the composer, never a shader** — so no `check-render.mjs` row,
  the brief's §5.3 notwithstanding: the subject is composed at the model's
  1024 px view for the stage and the export alike, and an edge made there is
  one function both reach; the unit tests are its gate. LAST in the order,
  after the removal, so a removal's edge is refined like the rest.
- **Snap is the colour guided filter run "fast"** (coefficients at a fraction
  of the density, spread back bilinearly), the step from the raster's size
  (long edge ÷ 256 → 4 at 1024). Measured on a disc drawn 3 px too wide:
  3 772 px of edge error as found, 1 029 at full density, 727 at half, 343 at
  a quarter — the coarse window is both cheaper (41 against 76 ms in node) and
  the better fit. Then a CONTRAST on the matte (smoothstep 0.2–0.8): the
  filter alone leaves, where the model overshot, the share of the window that
  was wrongly in — a 0.3 haze —, which this clears while a half-covered pixel
  stays at half.
- **It refines an edge; it cannot restore what the model answered 0 for**:
  thin branches off a tapped trunk come back at confidence 0, measured, so
  the hint sends that to a tap or a painted mask. On flat synthetic shapes the
  model's edge is already exact and Snap barely moves it (20 338 → 20 266 px);
  on a blurred disc it moves the stage's edge sample 100 → 79 and leaves
  10 854 export pixels partial. Its value on hair is unmeasured here.
- **The guide is the model's view, read once per VIEW** (`readGuide`, one
  entry in module state, ~2.8 MB) — a snapped subject waiting on it goes the
  hook's async path, which says "finding it" only where the model is really
  asked. Browser timings: Soft ~30 ms, Snap ~45 ms per compose.
