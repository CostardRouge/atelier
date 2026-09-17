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

## The keystone: the first pass that MOVES a pixel (2026-09-17, P5 engine)

`geometry.ts` (pure, 16 specs) + `keystone-pass.ts`. A homography carries the
whole correction — converging verticals, converging horizontals, a rotation and
the zoom that hides the corners a warp empties — in ONE 3×3 matrix, so one
resample serves all of it. It is the first thing here a cube could never do: a
3D LUT is handed a colour and no coordinate.

- **The matrix is built and inverted in TypeScript, never in GLSL.** A warp is
  drawn by walking the OUTPUT and asking where each pixel came from, so the
  shader carries the INVERSE; everything about it is decided where a spec can
  hold it, and the pass only applies what it is given.
- **Conjugated by the aspect ratio** (`A · M · A⁻¹`, built in a square space),
  or a rotation shears instead of turning and the same numbers mean different
  things on a 4:5 crop. A spec measures the angle between two perpendicular
  edges at 16:9 and asserts it survives.
- **The order is fixed**: perspective → aspect stretch → rotation → zoom.
- **Where the picture ran out it is EMPTY**, never the edge pixel smeared
  outward: a warp genuinely has no data there, and the zoom is what hides it.
- **A point bent past the horizon is null, not a huge number** — `applyMatrix3`
  says so, and `keystoneSampleMatrix` answers null for numbers that fold the
  plane so a caller draws unwarped rather than blank.

**The y axis was MEASURED, not reasoned.** A texture's v axis and a screen's y
axis disagree, and the vertex shader flips UVs for an `ImageBitmap` and not for
a canvas — so `makeKeystonePass` mirrors y (`mirrorYMatrix`) and owns that
itself rather than leaving a caller to get it right. A marker in a known corner
turned 90° lands at exactly the matrix's prediction WITH the mirror and 0.5 away
without it; `check-render.mjs` asserts both, the second so the check cannot
quietly become a tautology.

**The trap this file already knew and I walked into anyway**: a BACKTICK inside
a GLSL comment ends the template literal and the file stops parsing
(`media-pipeline.md`). Do not put one in shader source, not even in prose.

## The keystone, wired (2026-09-17, P5 second commit)

`RollPicture.keystone`, `KeystonePanel` on the Crop tab, and the warp reaching
the stage, the thumbnail and the export. Rules a later phase must keep:

- **`makeFrameGrader` gained an optional `passes` list** — the seam grew rather
  than being bypassed, so a warp, and in time a mask or a denoise, reaches all
  sixteen consumers the same way the look does. Empty for every caller that
  only grades, which is most of them.
- **"No look" stopped meaning "nothing to render".** A keystone with no cube
  still needs the GPU, because the warp is a PASS and not a cube — `graderFor`
  and `roll-render` both build a grader for either.
- **The grader is keyed on the keystone BY VALUE** (`sameKeystone`). The panel
  hands down a new object per slider step, and keying on identity would rebuild
  the grader — and its WebGL context — on every frame of a drag.
- **The warp runs at SOURCE density, before `drawFramed` cuts the frame.**
  Correcting after the crop would resample a resample, and the crop is what
  decides which of the corrected picture survives. The stage, the snapshot and
  the export all keep that order.
- **No migration**: the field is absent on every roll written before it, and
  absent already means null.
- Unlike the crop, a keystone is **not a way of LOOKING**: it is part of the
  picture, so the histogram and `delivered()` see it. (The crop is deliberately
  the other way — `develop-roll.md` D8.)

Measured in the pane on a grid: the slider wrote `vertical: 70` through to the
document, the stage tapered 400 → 394 → 374 → 362 → 350 px of covered width down
the frame and went empty where the source ran out — a trapezoid, the right way
up for a positive vertical.
