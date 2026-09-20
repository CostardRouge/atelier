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
