# The render core — the float16 multi-pass graph

Read before touching `src/shared/render/`, `lut-gl.ts`, `frame-grader.ts` or
`held-grader.ts`, or before adding any adjustment that needs to know WHERE a
pixel is. The brief and its phases are `docs/photo-editor.md`; the engine it
grows from is `media-pipeline.md`.

## Built so far (2026-09-17, P4 first commit)

`shared/render/`: `glsl.ts` (the shared chunks), `pass-plan.ts` (pure, 8 specs),
`graph.ts` (the core), `cube-pass.ts` (the look as a pass), `graph-grader.ts`
(the core wearing `FrameGrader`). **Nothing in the app uses it yet** — the
engine change is separated from the switch-over so it could be proved a null
result first, and `scripts/check-render.mjs` is that proof.

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
