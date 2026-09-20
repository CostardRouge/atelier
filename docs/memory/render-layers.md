# Masks and adjustment layers

Read before touching `src/shared/render/mask.ts`, `layer-pass.ts`,
`src/shared/develop/layer.ts` or `layer-render.ts` — a correction that applies
only somewhere. The graph is `render-core.md`, the warps `render-geometry.md`,
the brief `docs/photo-editor.md` §6.

## Masks and layers, the engine (2026-09-18, P7 first commit)

`render/mask.ts` (pure, 24 specs), `render/layer-pass.ts`,
`develop/layer.ts` (pure, 14 specs), `develop/layer-render.ts`. Nothing on
screen yet; the wiring commit follows.

**A layer's adjustment IS a `DevelopSettings`.** Not a reduced set, not a
parallel type — the very record the global develop uses, baked by the very
`composeLutStack`. So a local exposure is the maths of a global one, local
curves and local white balance arrive for nothing, and the panel that edits one
edits the other. That reuse is the whole reason masking was affordable, and it
is why `layer.ts` sits in `develop/` while the mask sits in `render/`.

    out = mix(under, gradeThroughLut(under), mask × opacity)

**A layer's cube carries NO look and NO output transform** — `composeLutStack([],
'none', …, develop)`. The look is the picture's or the roll's and is applied
once after the whole stack; the transform belongs to the delivery and is last.
A layer carrying either would apply it once PER LAYER, an error that shows only
where two layers overlap.

**Programs are cached by pass id, so every layer needs its own** (`layer:<id>`).
Two layers sharing an id would share a program and, through it, ONE uploaded
cube — the second would grade with the first one's numbers.

What a layer deliberately has NOT got: a blend mode (it was in the plan, is not
in the ask, and an adjustment layer with a multiply mode is a compositing
feature — opacity is the control that was asked for, and adding a mode later is
one field and one `mix`), and a look of its own (a mask choosing between two
conversion LUTs would put two conversions on one picture).

Three mask shapes, all procedural and pure: **linear** (a bearing — 0 covers the
top, 90 the right), **radial** (an ellipse, full INSIDE so what a panel draws is
what is affected, the feather the band outside it), **luma** (a band of
brightness, wherever it is in the frame). `smoothStep01` rather than a linear
ramp, because a linear ramp has a corner at each end and a visible line where a
mask begins is the one thing it must not have. No mask is the WHOLE picture,
never none of it — a new layer is an ordinary global develop until a shape is
picked.

**The mask rows of the gate caught two HARNESS faults before they could be
mistaken for shader ones.** Evaluating `maskAt` at a probe POINT while reading
whichever texel contains it is off by up to half a texel, which on a steep
feather is 0.043 — it looked exactly like a broken shader; the expectation is
now taken at the texel centre the read comes from. And a luma mask over a flat
white frame is one value everywhere, so that row would have passed on a shader
that ignored the pixel entirely; it runs over a ramp, and every shape asserts a
non-zero SPREAD for the same reason. Measured: all three within 0.0021 of the
pure module, canvas and bitmap identical.

## Layers, wired (2026-09-18, P7 second commit)

`RollPicture.layers`, a fourth inspector tab (Develop · **Layers** · Crop ·
Export), the mask editor, and the stack reaching the stage, the crop stage, the
filmstrip cell, the thumbnail and the export. No migration: absent and empty
mean the same.

**Layers run AFTER the one cube, which departs from the brief's §5 ordering, on
purpose.** §5 put them between the global develop and the look. That would mean
splitting today's single cube in two whenever a layer exists, and — the reason
that matters — a local correction would then be set in LOG space on footage
wearing a conversion LUT: "−1 EV" on a D-Log picture would do something quite
different from what the author is looking at. After the cube, a slider does
what the screen shows. The cost is that a layer's correction is applied to
display-referred values, which is what `develop.ts` is designed for anyway. If
this ever proves wrong, the fix is two cube passes — develop, layers, look —
and the fast path for a picture with no layers is unchanged either way.

**Order in the grader is `[cube, …geometry, …layers]`**, and the geometry
coming first is what makes a mask's coordinates the WARPED frame's — the frame
the author is looking at and placing the mask on.

**The list is drawn TOP FIRST and stored bottom-first.** Every layer UI since
Photoshop shows the top of the stack at the top, so `LayersPanel` renders
reversed; every helper in `layer.ts` speaks the real order and is addressed by
id, so the reversal cannot leak into an index.

**Show-the-mask is `makeLayerPass` again with a one-colour cube**, not a second
shader — so what is painted is the mask the render really uses, feather and
invert included. A separate overlay shader would be a second implementation of
`maskAt` to keep in step, exactly what `glsl.ts` exists to prevent. It is a way
of LOOKING, like the wipe: it never reaches `delivered()`, the histogram or the
thumbnail.

**A caption that keys on the cube alone lies once a layer exists.** The line
under the picture said "nothing changes the picture yet" over a picture a layer
was visibly darkening, because it was written when a cube was the only thing
that could change one. `DevelopCaption` takes `also` now. The general rule: a
status sentence must be keyed on everything that can make it false, and the
render gained two new such things this week.

Measured in the pane on a flat grey frame (154 everywhere): adding a layer
changed nothing; exposure −3 under a default linear mask gave 57 at the top,
148 at the middle, 154 at the bottom; the overlay painted [145,48,40] where the
mask is full and nothing where it is empty. **Preview = export**, to the code:
the same 57 / 148 / 154 out of `renderRollPicture`.

## The painted mask: vector strokes, rasterised on the CPU (2026-09-18, P8 engine)

`mask.ts` gained a `brush` kind and the coverage maths; `brush-raster.ts` turns
strokes into an alpha map; `layer-pass.ts` samples it on unit 2.

**Strokes are VECTORS, never pixels.** The document stays small and
resolution-free, a crop re-rasterises correctly, and a mask painted on a 2048 px
preview is the same mask when the 48-megapixel original is delivered. Storing
the raster would tie a roll to the screen it was painted on.

**The CPU rasterises, and it is the SAME function, not an approximation.** A
fragment shader walking every segment of every stroke per pixel costs
`pixels × points` — hundreds of millions for an ordinary mask — so the map is
built once and sampled. Every texel is `brushCoverageAt` at that texel's centre,
so the raster and the pure module agree by construction and the gate holds the
GPU to the same tolerance as the procedural shapes (measured 0.0008, TIGHTER
than them, because the only error left is 8-bit quantisation). The obvious
alternative, Canvas2D round-capped strokes under `ctx.filter` blur, would have
been quicker to write and would have been a second, different falloff that
nothing could check.

**Cost is the area PAINTED, not the frame**: each stroke is walked only inside
its own bounding box. That is what makes a live drag possible at all, and a spec
asserts it.

**Points are stored in [0,1] and distance is measured CENTRED.** They are not
the same space — `framePoint` scales the axes differently, so a circle in one is
an ellipse in the other — and comparing a radius across them means nothing. The
first version did exactly that and every coverage came back 0; `strokePoints`
converts once per stroke rather than per texel.

**Strokes composite in the order they were painted**, and an eraser only removes
what is already down — so a stroke painted after it comes back. Painting, not
set arithmetic. It is also why this cannot be one pass over a merged shape.

**An empty painted mask covers NOTHING**, unlike every other kind: only the
ABSENCE of a mask means the whole picture. The placeholder texel bound when
there are no strokes is therefore 0, not 255 — 255 there would make a fresh
brush layer apply to the whole frame.

## Painting, the gesture (2026-09-18, P8 second commit)

A drag on the picture lays a stroke when Paint is on. What it cost, and what it
taught:

- **It needed the grader to stop rebuilding its context per change** — a stroke
  adds a point per `pointermove`, and a new WebGL2 context per point is not a
  slow gesture, it is no gesture at all. `render-core.md`, «Passes are SWAPPED».
- **`unframePoint` (`media/framing.ts`) is the inverse of `drawFramed`**, and a
  painted mask is the first thing that needed it. The eyedropper dodges the
  question by re-drawing the picture through the same branch and reading a
  pixel, which answers "what colour" without ever answering "where"; a stroke
  has to know where. A spec round-trips the forward map rather than trusting the
  derivation.
- **A point outside the picture starts nothing**, and a pointer that LEAVES it
  mid-stroke does not end the stroke — a hand that strays over the edge and
  comes back carries on, which is what every editor does. A cancelled pointer
  does end it, or the next press would continue a stroke the author thought was
  finished.
- **The live stroke rides a ref as well as the draft.** A state read inside a
  `pointermove` closure is one frame behind and would drop points, the same trap
  the curve editor's drag wore. Each move REWRITES the last stroke rather than
  adding one.
- **Points closer than a fraction of the radius are dropped**: they add nothing
  the brush does not already cover, and each one is rasterised again.
- **The brush lives beside the layer, not on it.** A brush is a tool; each
  stroke keeps the size and softness it was painted with, which is what lets a
  soft edge and a hard one live in one mask.
- **The kind is "Painted" and the verb is "Paint".** They were both "Paint" for
  one run and the pane showed two identical buttons doing different things.
- A caption that offers the wipe while a drag paints is offering a gesture the
  picture has already given away, so `DevelopPicture.painting` exists and the
  caption reads it.

Measured in the pane: switching a layer to Painted left the picture untouched
(the empty rule), one diagonal drag darkened exactly where the pointer went and
nowhere else, and the roll stored one stroke of 13 points at radius 0.12.
**Preview = export**, to the code: 57 / 154 / 154 both ways.

## The subject mask: a model, from our own origin (2026-09-19, P9 engine)

`shared/segment/segmenter.ts` + a `subject` mask kind. The recipe is the
maintainer's own, taken from `CostardRouge/p5-templates` when he pointed at it:
`public/assets/libraries/mediapipe/` there, `public/models/mediapipe/` here.

**Everything is served from our own origin and nothing loads at boot.**
MediaPipe's `vision_bundle.js`, the wasm and the model all sit under `public/`,
dynamically imported the first time a subject mask is asked for. So the README's
network callout is unchanged and a page that never opens one pays nothing — a
file under `public/` is fetched only when something asks for it.

**The real cost is the WASM, not the model.** The brief said "a ~5 MB
MediaPipe-class model"; the model is 6.2 MB and `vision_wasm_internal.wasm` is
another 9.6 MB, with `vision_bundle.js` at 877 KB — **16.9 MB**. The `nosimd`
twin (another 9.1 MB) is deliberately NOT shipped: every browser that can run
this suite at all (WebGL2, WebCodecs, File System Access) has wasm SIMD, and a
`FilesetResolver` only reaches for the nosimd build on one that does not.

**`InteractiveSegmenter` + `magic_touch`, not `deeplabv3`.** The brief recorded
"subject/background, never click-anywhere"; his own photo tooling is exactly
click-anywhere, and it is the better answer — semantic segmentation answers
about CATEGORIES ("this region is a person"), and a photographer pointing at the
second of three people is asking about THIS ONE. Several points are segmented
and unioned, which is how one taps a person, then their bag. "Background" is not
a second model: it is this mask under the layer's existing `invert`.

**The selected object is category 0, and everything else is 255** — backwards
from the obvious reading. Measured: a bright disc pointed at dead centre came
back 0 at the disc and 255 in the corners, and `p5-templates` defaults its own
`inverse` flag to true over the same model. Reading it the other way selects the
BACKGROUND, which looks like a working feature until somebody notices the
adjustment landed everywhere except the subject.

**One inference at a time.** The task has a single result slot, so two in flight
can have their answers swapped and a mask attributed to the wrong point is a
subject that jumps. Points are segmented in sequence — the same shape
`p5-templates` settled on.

**What is stored is the REQUEST, never the pixels**: the points and the model
id. The raster is derived, reproducible from the picture and the model, so it
would break `.roll.json`'s portability for no gain; the model id on the mask is
what refuses a raster cached by an older build. `maskAt` therefore cannot answer
for this kind and returns 0 — the renderer never asks it, because the raster
reaches the GPU through the very path a painted mask already uses (unit 2, the
same branch, the same orientation).

**Nothing in `npm test` can see any of this** — it needs a browser, a GPU and
16.9 MB of model. Verified by a probe in headless Chromium: the GPU delegate
initialised, `segmentSubject` answered in ~4 s cold (that includes the download)
and returned a mask covering 19 % of the frame against the ~21 % actually drawn.

## The subject, wired (2026-09-19, P9 second commit)

A `Subject` mask kind in both panels, tap-to-pick on the stage, and the rasters
reaching every renderer.

**The two hooks need each other**, so the rasters come back through state: the
stage decodes the picture the model segments, and the model produces the map the
stage draws. One extra commit per answer — which is once per tap, not once per
frame — and it is why `useSubjectMasks` is called after `useDevelopPicture` and
fed back rather than composed.

**A tap ADDS a point; a tap on one REMOVES it** (`SUBJECT_HIT_RADIUS`), the
click-a-marker-to-unpick gesture `p5-templates` settled on. It is how a subject
is narrowed after the model took in too much. A subject is never DRAGGED — the
model answers a point — so `paint.onMove` returns early for it, and the whole
painting seam is reused rather than a second gesture written.

**A layer whose raster has not arrived draws NOTHING, not everything.** The
alternative is a fresh subject applying to the whole picture for the four
seconds the model thinks, which reads as a bug and is one.

**The last good raster stays up while a new one is computed**, and the cache is
keyed by picture + model + points rather than by layer — so two layers on one
subject segment once, an undo that brings a subject back is free, and moving a
slider never re-runs a four-second inference.

Two things the pane showed that no test would have. The mask kind control went
to six options and ran them together as "Radial BrightnessPainted" — `Segmented`
already has `columns` for a choice bigger than a row. And the caption offered
"drag across the picture to paint the mask" for something you TAP, so `paint`
declares its `gesture` now; offering the wrong gesture is the same fault as the
caption that went on offering the wipe.

Measured in the pane on a figure over a flat ground: before any point the
picture is untouched; one tap on the body darkened the whole figure INCLUDING
the head (one tap, the connected subject) at −3 EV and left both far corners of
the ground exactly as shot; the roll stored `points: [[0.5, 0.62]]` with the
model id and **no pixels**; tapping the same marker again took it back to zero
points.

## The model is shown a bounded picture, waited for, and cached per point (2026-09-20, the audit)

Three things the first P9 got wrong, none visible on a small test picture:

- **It was shown the stage source whole.** `magic_touch` resamples its input to
  a few hundred pixels inside, so a 4K bitmap bought nothing and cost an upload
  and a downscale per tap — and the category mask comes back at the INPUT's
  size, 12 MB per point at 4K, copied, unioned and cached without bound.
  `prepareSegmentSource` now makes ONE copy at `SEGMENT_INPUT_LONG_EDGE`
  (1024, the painted mask's own density, so the two rasters sample alike),
  kept per source in the hook and released with it. Measured on a 3000×2000
  disc: the mask is 1024×683 and covers 13.19 % against the 13.09 % drawn.
- **A point that never answered hung the panel for good** — the promise never
  settled, "working" stayed up and every later point queued behind it.
  `segmentPoint` gives up after `SEGMENT_TIMEOUT_MS` (20 s) with a warning and
  frees a late answer's buffers rather than reading them.
- **Every tap re-ran every point.** The cache was keyed on the whole request,
  so a third tap cost three inferences. `useSubjectMasks` caches per POINT
  (an LRU of `POINT_CACHE_SIZE` = 64, ~50 MB at most) and composes a layer with
  the pure `unionMasks`, so a tap costs one inference, un-picking costs none,
  and a layer whose points are all cached is composed without the model.

Still true and still open: `segment()` answers SYNCHRONOUSLY on the GPU
delegate, so the main thread is blocked for the inference (1.5 s warm on
SwiftShader, 4.8 s cold with the download). The brief's "in a worker" is not
built; it needs an `OffscreenCanvas` and the model loaded there.

## What a layer costs per change is now kept, not paid again (2026-09-20, the audit)

The stage's `graderFor` rebuilt EVERY layer's pass on ANY change to the list —
a new opacity on layer 3 re-baked layer 1's cube (a 33³ `composeLutStack`
walk), re-walked its painted strokes and re-uploaded both. Every slider step
paid for the whole stack. `makeLayerPassCache` (`develop/layer-render.ts`)
keeps, per layer id, the cube (reused while `sameDevelop` and the interpolation
hold), the brush raster (reused while the strokes ARRAY and the aspect are the
same objects — a stroke rewrites the array, so identity is the honest key) and
the pass itself (reused while cube, raster, mask, invert, opacity and aspect all
hold); a layer that leaves the list is forgotten, and Show-the-mask's overlay
pass is cached the same way, so toggling it no longer bakes. `layerPasses`
survives for the export, which builds once and disposes. **Rule**: anything
derived from a layer is keyed on the layer's VALUE (`sameDevelop`, `sameMask`),
never on the object a React render hands down, which is new every time.

**The raster's hot loop allocates nothing.** `framePoint` returned a tuple per
texel — a million short-lived objects per `pointermove` on a 1024-wide map —
so it is written out inline, the row's y once per row. `brushAt` still goes
through `framePoint`; the loop must keep saying the same thing, which the
gate's brush row holds it to (0.0008).
