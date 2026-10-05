# The render core — the float16 multi-pass graph

Read before touching `src/shared/render/`, `lut-gl.ts`, `frame-grader.ts` or
`held-grader.ts`, or before adding any adjustment that needs to know WHERE a
pixel is. The brief and its phases are `docs/photo-editor.md`; the engine it
grows from is `media-pipeline.md`.

## Built so far (2026-09-17, P4 both commits)

`shared/render/`: `glsl.ts` (the shared chunks), `pass-plan.ts` (pure, 8 specs),
`graph.ts` (the core), `cube-pass.ts` (the look as a pass), `graph-grader.ts`
(the core wearing `FrameGrader`). The engine change was committed SEPARATELY
from the switch-over so it could be proved a null result first;
`scripts/check-render.mjs` is that proof.

**`makeFrameGrader` now builds the core**, so the stage, every export, every
thumbnail and both hook videos run on it — sixteen call sites, none of which
changed a line. That is what a one-method seam buys, and it is why a later
phase adds a pass rather than a second switch-over.

**`createLutRenderer` is NOT retired**, and should not be: the LUT tool's live
preview and the Studio stage drive its uniforms frame by frame (a split, a
strength, a mode) rather than rebuilding a grader, which is a different job
from grading one frame and handing it back.

**The checker must build the old engine from `createLutRenderer` DIRECTLY.**
Once `makeFrameGrader` returned the core, comparing against it compared the
core with itself and passed no matter what — a gate that cannot fail. It
constructs the old path by hand for that reason; do not "simplify" it back.

`makeFrameGrader` passes `getDefaultLutInterpolation()` rather than a literal:
the mode is a render preference somebody may have set to trilinear, and a
hardcoded 'tetrahedral' would quietly ignore them in every export.

## At one pass it IS the old renderer

`planPasses(1)` is `source → canvas` with no framebuffer bound, which is
exactly what `lut-gl.ts` has always done. The common case is therefore the
general algorithm at n = 1 rather than a fast path bolted beside it — which is
what makes a pixel-identical result possible at all. **Measured, on a real GPU:
worst 0 codes against `makeFrameGrader`, for a canvas source AND an
ImageBitmap; a cube + passthrough round trip through float16 costs at most 1
code.** Re-run `node scripts/check-render.mjs` (dev server up) after touching
any of it.

The plan is pure and tested apart because both ways of getting it wrong are
SILENT: a pass that reads and writes one target samples what it is drawing, and
an off-by-one leaves the result in a buffer nobody shows.

## The buffers are float16; the VALUES are unchanged

`RGBA16F` is for precision and for headroom above white. The numbers passing
through stay in the same sRGB-ENCODED domain the cube already speaks, so no
existing maths moved and the gate could be a null result. A pass wanting linear
light decodes and encodes inside itself. **Working space is a decision for the
phase that needs one, not a side effect of changing buffer format** — do not
"fix" this by linearising the chain without a reason and a measurement.

Rendering *into* half-float is an extension even in WebGL2
(`EXT_color_buffer_half_float`); absent it, the chain runs at 8 bits and
`graph.precision` says `'byte'`. What is lost is the headroom, and a caller
that promises it must ask.

## The canvas is DITHERED where more than 8 bits reach it (2026-10-05)

**Decision** (his «go 1 et 2» after the 8-bit audit of the same day): the
last pass, when it writes the CANVAS, adds a noise strictly inside ±0.5 code
(`DITHER_LSB` = 7/16, `dither.ts`) before the 8-bit rounding — only where
the chain carried more: a `HalfImage` source, or ≥ 2 passes over float16
targets (`wantsDither`). **Why**: float16 everywhere upstream bought nothing
at the last rounding — a pushed sky still came out in flat one-code steps.
**How**: every program is linked through `ditherFragment` (renames `main`,
wraps it; `u_dither` 0 = untouched to the bit), `u_dither` set on EVERY draw
(a program keeps uniforms between frames), `RenderPass.exact` opts a pass out
(the clipping view, whose test IS the canvas's rounding), `setDitherForTest`
for the gate. Rules the numbers fixed: (1) **one 1-pass 8-bit chain stays
the old renderer pixel for pixel** — its steps are the source's, no output
dither fills them, and the gate's 0-code rows hold; (2) **an exact code
stays exact** — 7/16 + float16's 1/16 storage error < 0.5 (gate: an 8-bit
picture through two float16 passes, worst 0); (3) **one value for the three
channels, per 2 × 2 block** — measured on an 8-code ramp through
`canvas.toBlob` at 0.92, the column-average error is 0.50 undithered,
0.42 with per-pixel-per-channel noise (JPEG erases chroma and the finest
frequencies), 0.22 with this pattern (0.14 on the canvas); bytes ±0.2 % on a
photograph; (4) **`gl_FragCoord` is right HERE** and nowhere else: a canvas
write has the frame's viewport at y = 0, so the coordinate is the frame's
pixel whole or banded (`check-bands.mjs` unchanged). **Limits, measured,
not fixed**: at JPEG 0.85 any dither does worse than none on the ramp's
8 × 8 means (0.69 vs 0.44) — only a full-size target at 0.85 meets it, the
Web preset is resized first; and a RESIZED target (`deliverOne` draws the
render into a smaller 2D canvas) is rounded again by the resize, so the
dither reaches the stage, the full-size file and the Ultra HDR base only.
Dithering a resized target needs the graph to render AT the target size, not
a dither after it. The gate: three rows at the end of `check-render.mjs` (the
GPU's noise against the `ditherNoise` twin, exact codes, the ramp before and
after a JPEG); the half-source row now measures with the dither off, since
its 8-bit twin is never dithered.

## Three GL traps, all measured, none of which any test could see

- **A `sampler3D` must be bound even with NO look.** Left unset it defaults to
  unit 0, where the source's `sampler2D` already is, and two sampler types on
  one unit is `INVALID_OPERATION` at draw time: the pass is dropped, the canvas
  stays black, no exception is thrown. The cube pass binds a 1-texel placeholder.
- **`RGBA32F` + `LINEAR` is an INCOMPLETE texture without
  `OES_texture_float_linear`, and an incomplete texture samples BLACK.**
  `lut-gl.ts` had always branched to `RGBA8` for it; copying its GLSL without
  copying that branch is what made the core's first run black on SwiftShader.
  **Since 2026-09-20 the branch falls to `RGBA16F`, never to 8-bit**, and it
  is ONE function for both shaders (`uploadCube`, `cube-pass.ts`): the 8-bit
  branch clamped the cube's output to [0,1] and quantised it, which threw away
  a conversion LUT's highlight rolloff above white on every GPU that took it,
  silently. Half-float is filterable in core WebGL2 and takes the same `FLOAT`
  upload; measured against the float path: worst 1 code. The gate has a row
  that takes the extension away by hand (on BOTH canvas prototypes — the
  grader draws on an `OffscreenCanvas`), because this GPU has it and the
  fallback would otherwise run nowhere a gate could see.
- **`bindAttribLocation` before linking.** The graph sets its quad up once, on
  one VAO, against attribute location 0 — but GLSL may put `a_pos` anywhere
  unless told, and then the quad draws nothing.

All three produce a black picture with every gate green. **A render change is
not done until `check-render.mjs` has run.**

## One lookup, two shaders

The LUT lookup moved to `shared/render/glsl.ts` and is included by BOTH
`lut-gl.ts` and `cube-pass.ts`: two copies of it is precisely how a preview and
an export come to disagree, which `media-pipeline.md` already warns about for
the GLSL against `interpolate.ts`. `scripts/check-shader.mjs` now ASSEMBLES the
shader from those chunks instead of regexing it out of `lut-gl.ts` — the regex
broke the moment the shader was built from pieces, and importing cannot go
stale that way.

## The passes themselves live elsewhere

This file is the GRAPH. What rides on it has its own pages, because both
outgrew the ~150-line budget together:

- `render-geometry.md` — the lens and the keystone, and the `imageUv` rule
  every pass that asks WHERE a pixel is must follow.
- `render-layers.md` — masks and adjustment layers.
- `render-film.md` — the FilmNode: grain, halation, and `RenderPass.prepare`,
  which exists because the halo is blurred in a buffer of the node's OWN size
  and so cannot be passes of this graph.

## Passes are SWAPPED, not rebuilt (2026-09-18)

A look is baked into a cube, so a new look is rightly a new grader. A warp, a
mask or a layer is a PASS, and those move on every step of a drag — and the
grader was being rebuilt for each one, which meant **a new WebGL2 context per
slider step**. That is both the slowest thing here and the one resource a page
has a hard cap on; it is why painting a mask was not possible at all.

`makeFrameGrader` now returns a `PassGrader` with `setPasses`, `holdGrades`
forwards it (dropping the held copy, which was graded through the passes that
just left), and `graderFor` takes that path whenever the cube and the size are
unchanged. The context and its programs survive — and since 2026-09-20 so
does the uploaded source, for a BITMAP: this entry claimed that from the
start, and it was false. `render()` called `texImage2D` on every call, so a
pass swap re-uploaded the whole stage-budget picture (tens of MB) per slider
step. An `ImageBitmap` is immutable, so the graph now keys the upload on its
identity and skips it; a canvas or a video can change under one identity and
is uploaded every time, as before. **A claim about what the GPU does is not
true until a gate row draws it** — the swap row now runs from a bitmap too,
drawn three times, and would read a stale or empty texture as a failure.

**The LOOK is swapped too (2026-09-28).** "A new look is rightly a new grader" was the one exception above, and it cost a new WebGL2 context per step of every develop slider — each step bakes a new cube. `GraphGrader.setLut` replaces the cube pass in place (the old one's texture freed through `dispose`, which the cube pass gained), `PassGrader` and `holdGrades` forward it (dropping the held copy), and the Develop stage (`graderFrom`) and the Trips stage (lead and collage cells) call it whenever only the cube moved on the same picture. The gate row: grade through one cube, swap to another, compare with a grader built fresh around the second — identical, and the swap moves the picture.

## Three rules the graph now enforces itself (2026-09-20, the audit)

- **A lost context is said once and drawn around.** `render()` checks
  `isContextLost()` and returns the canvas untouched: iOS takes contexts back
  under memory pressure, and a lost one accepts every call and draws nothing,
  which is a black stage with no error anywhere.
- **The first draw of each program is checked with `gl.getError()`, in dev
  only.** Every trap above (two sampler types on one unit, an incomplete
  texture) is an `INVALID_OPERATION` the driver reports there and nowhere
  else, and each was found by hand. Never per frame — `getError` stalls the
  pipeline — but once per program id is exactly when a new pass could have
  got it wrong, and the render gate runs on the dev server so it sees it too.
- The GL error class is now `console.error`'d with the pass id; a silent
  fallback to an unprocessed picture is the failure this whole file exists to
  prevent.

**The GPU has an EDGE CAP, and past it the picture is black, not slow
(2026-09-20, the audit).** A texture and a framebuffer stop at
`MAX_TEXTURE_SIZE` on one edge — 8192 on SwiftShader and older mobile GPUs,
16384 on most desktops — and an upload past it is refused with an
INVALID_VALUE nobody reads: the texture stays incomplete and samples black,
so a 61-megapixel still (9504 px) delivered on an 8192 GPU was a black JPEG
with every gate green. The graph now reads the smallest of its texture,
renderbuffer and viewport limits (`RenderGraph.maxSize`) and says ONCE, in
the console, when a source or a target is past it; `maxRenderSize()`
(`graph-grader.ts`) asks it of a 1×1 graph once per page; `render-size.ts`
is the pure fit (long edge to the cap, never up); and `fitPhotoForRender`
(`photo-frame.ts`) is what the three full-density still exports — the roll,
the Studio still, the badge PNG — call before building their grader, drawing
with the size it hands back. "Grade at source density" therefore means "at
the source's density or the GPU's cap, whichever is smaller", and the roll
export SAYS when it was the cap (`RollRendered.gradedAt`, a note in the run's
summary), because a delivery must never claim pixels it resampled away. The
gate has a row for it: a picture a thousand pixels past this GPU's cap,
fitted and graded to a picture. The stage never meets the cap — it works to a
pixel budget — and a video frame is never past it.

**A graph now OUTLIVES its pass list, and that made a leak possible that could
not exist before.** A pass's own textures — a layer's cube, a painted mask's
alpha map — used to be freed by the context dying with every change. So
`RenderPass` gained `dispose(gl)`, `setExtraPasses` releases the passes it
replaces, and `makeLayerPass` implements it. One layer's cube is about a
megabyte at 33 lattice points; a drag leaking one per step would fill a GPU in
seconds.

**The gate has a row for it**, because both failure modes are silent: a stale
held copy served after the swap, and a swap that quietly did nothing. It renders
through one grader, swaps its passes, renders again, and compares against a
grader built fresh with the second set — plus an assertion that the two sets
draw *different* pictures, or the row would pass on a no-op. Measured identical.

## Bands (2026-09-28)

**Decision.** A frame of at least 12 MP (`BAND_MIN_PIXELS`, above the 4K stage so an interactive render never bands) is drawn in full-width bands of ~4 MP when EVERY pass after the first says which rows of its input it reads to write a span of rows — `RenderPass.rows`, a `RowNeed` from `band-plan.ts` (pure, tested): `OWN_ROWS` for a colour pass, `nearRows(r)` (or a function of the frame, the presence blurs) for a neighbourhood, `warpRows(map)` for the lens, the keystone and the camera warp — their shader's arithmetic in JavaScript, sampled over the band on a grid (a column every 16 px, a row every 8, 4 rows or 2 % of slack) — and an exact span for the repair (only the patches covering the band, their offset, and a heal's rings). `planBands` walks each band BACKWARDS through the chain; the first pass reads the source, which stays whole; the targets are allocated at the tallest region. **Why**: two full-size float16 targets were 16 B/px — 744 MB at 48 MP — the open item of 2026-09-20. **Measured** (planner at 8064 × 6048): 63 MB for a look + sharpen, 133 MB with a lens and clarity, 291 MB with a lens, dehaze, clarity, texture and noise reduction.

**How it reads a band**: every pass fragment is linked through `bandFragment`, which routes each `texture(u_src, …)` through `_bandUv` (frame coordinate → the band target's, `u_srcBand`) and clamps y to the FRAME's edge rows (a band target is taller than its region, so CLAMP_TO_EDGE would land on stale rows). All four uniforms at zero are the identity to the bit, so a whole render is unchanged — `check-render.mjs` still passes, 48 rows. A shader that does not declare `uniform sampler2D u_src;` exactly is simply never banded.

**Two traps, both measured**: (1) a band drawn through a viewport of its own interpolated `v_uv` a few ulps off the whole render — invisible except at a warp's EMPTY edge, where a pixel flipped from inside to outside and a later texture pass amplified it to 217 codes. Every band is now drawn through the WHOLE frame's viewport, offset (`y = −region.y0` into a target) and cut by a scissor: `v_uv` is identical to the bit. (2) A 33-column grid missed a stack of three warps' extreme by a few rows: a seam at a band edge. The denser grid and the slack closed it. **The gate is `scripts/check-bands.mjs`** (dev server up): one chain of 18 passes of every kind, whole against bands of 37 rows, from a canvas and a bitmap — worst 1 code, and it FAILS if fewer than ten bands were drawn, because a plan that quietly declines compares whole with whole. Run it after adding or touching a pass. A dev server that hot-reloaded `graph.ts` serves it under a second URL, so the gate reaches the banding hooks through `graph-grader.ts`.

**How to apply**: a NEW pass must declare `rows`, or every chain it joins is drawn whole again (correct, just the old memory). What stays whole regardless: the source texture and the canvas, 4 B/px each, and any chain holding the film node's halation, whose `prepare` reads its whole input.

**Bands are a PHONE's, and a preference everywhere (2026-10-02).** The probe below said yes on his Mac and the loupe STILL drew the 7008 px ARW striped (his screenshot: one band exact, a strip of one row smeared down, then the band below's rows drawn again in the band above's place — the stale-target signature, a band's intermediate write not landing where the next band reads). Nothing here reproduces it, and his ruling cut the knot: *"sur desktop, ce n'est pas vraiment utile"*. So `bandRowsFor` now asks `band-policy.ts` (pure, tested) — `auto` bands a CONSTRAINED device only (where the memory is the point, and where the loupe is `capped` anyway, so on a phone bands reach exports alone), `whole` and `bands` say so on any device — read from `localStorage['atelier.render.bands']` once per page (`getBandPreference`), set by `useBandPreference` (a `useSyncExternalStore` over the graph's module state, so the switch in the Look panel reaches the loupe's hook at once) and drawn as the row *Big pictures* under *Interpolation* in `GradePanel` — the one home of a render preference, in all three tools. The loupe's effect takes the preference as a dependency AND calls `HeldGrader.invalidate()` when it moved: `holdGrades` serves the held copy otherwise, and the drive showed exactly that — "In bands" chosen, 1 band drawn — before the invalidation. **The gate's override (`setBandingForTest`) bands regardless of device and preference**, or it would compare whole with whole on a roomy machine. Driven headless (SwiftShader, a 4000 × 3200 JPEG under the loupe with a sharpen so the chain has two passes): roomy `auto` → 1 band, `bands` → 4, `whole` → 1; constrained → the loupe capped, the row reading `Auto · bands`. **What is still unmeasured is the cause**, and `scripts/check-bands.mjs` now reaches his GPU for it: `ANGLE=metal HEADED=1 SIZE=4672x7008 ROWS=856 CHROMIUM_PATH=<his Chromium>` draws the loupe's own frame in the graph's own bands on the machine's GPU and names the worst row — the next session on his Mac should run that before touching `drawPass`; the suspects, in order: the band target's write through a viewport of the WHOLE frame's height offset to a negative y (`gl.viewport(0, −region.y0, W, H)` — legal in GL, documented legal in Metal, never measured on it at a 7008-row offset), then ANGLE-Metal's render-pass load/store around the canvas write between two target passes.

**A band is trusted only after THIS GPU has drawn one right (2026-09-30).** His Mac drew the loupe's 7008 px frame in stripes — a band's rows replaced by another band's, the rest one row smeared down — and a halation (whole chain) made them vanish; the same chains at the loupe's size and at a mid size with ~190-row bands were exact on SwiftShader, so the cause was never reproduced here. Two changes, neither proven on his GPU yet: (1) the graph's context is `antialias: false, depth: false, stencil: false` — a quad covering its target gains nothing from four samples, which cost half a gigabyte at the loupe's size, and a banded frame writes the canvas once per BAND between target passes, exactly where a multisampled drawing buffer must be stored and reloaded behind our back (Metal documents a negative/oversized viewport as legal and ANGLE passes it through, so the viewport trick is the weaker suspect); (2) `bandsDrawRightHere()` (graph.ts): once per page, the first time a plan exists, a 96×480 chain of three passes (colour, ±3 rows, 23 rows away) is drawn whole and in 40-row bands on the same kind of canvas and compared; unequal → every frame drawn whole and a console warning. Proven able to fail (a 7-row fault injected in `u_srcBand` → false). `check-bands.mjs` requires it to say yes, because a probe that said no would silently spend the memory banding saves. **Rule**: a frame never depends on a GPU behaviour no gate ran on real hardware without a runtime check behind it; and a pass's own pixel count comes from `v_uv / u_texel`, never `gl_FragCoord` (a band's target counts from the band — the outline's dashes broke at every band edge).

