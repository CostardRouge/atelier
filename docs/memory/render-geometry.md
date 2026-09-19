# The geometry passes — lens, keystone, and the y convention

Read before touching `src/shared/render/geometry.ts`, `lens.ts`,
`keystone-pass.ts`, `lens-pass.ts` or `picture-geometry.ts` — anything that
MOVES a pixel rather than recolouring one. The graph they ride is
`render-core.md`; the brief is `docs/photo-editor.md`.

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

## The lens: one radial pass, and no profiles (2026-09-17, P6 engine)

`lens.ts` (pure, 17 specs) + `lens-pass.ts`. Barrel/pincushion (Brown–Conrady,
`r_source = r(1 + k1·r² + k2·r⁴)`), lateral CA and vignetting are ONE pass:
all three are functions of the radius alone, so the shader computes it once,
samples each channel at its own scale of it and multiplies by the gain there.
Three passes would resample three times, and every resample after the first is
blur paid for nothing.

- **No profile database ships, and that is a decision, not a gap.** A lens
  profile is MEASURED calibration data; inventing k1/k2 for a camera nobody
  measured is a fabricated correction that looks authoritative — the battery
  gauge's `—` again. The manual sliders correct by eye against a straight edge
  and work on any lens. A profile, when there is real data, sets those same
  numbers; it is not a second code path.
- **The reaches are bounded by MONOTONICITY, not by taste.** `f'(r) = 1 + 3k1r²
  + 5k2r⁴`, so the worst case is both sliders at −100 at the corner. At the
  0.25/0.12 this started with that is −0.35 and the map turns back on itself
  past r ≈ 0.90 — the corners FOLD. 0.18/0.06 gives +0.16. A spec walks the
  frame at every extreme; that is how it was found, and it is why the pair
  cannot be raised casually. 18 % at the corner is already far more than a real
  lens asks.
- **The radius is normalised to half the DIAGONAL** (Lensfun's convention), so
  one number means the same on a 3:2 frame and on a 4:5 crop of it.
- **Green never moves.** A fringe is red and blue landing at the wrong size, so
  those are what get rescaled; a channel whose scale took it off the picture
  keeps green's value rather than going black and painting a coloured edge of
  its own.
- **No y mirror, unlike the keystone** — every term is a function of DISTANCE
  from the centre, which a flip leaves alone. `check-render.mjs` measures the
  radius a marker really lands at, so a mirror creeping in would fail.
- `VIGNETTE_REACH` is handed to the shader (`vignetteTerms`) rather than
  written twice: the one duplication that would let the GPU drift from
  `vignetteGain`.

**The gate has two new rows.** A marker at a known radius, warped at full
barrel, must land where `lensSampleRadius` solves for (bisection, which the
monotonicity guarantees has one answer) — measured 0.5745 against 0.5759 — and
a flat grey frame's corner must match `vignetteGain` to the code (it matches
exactly). Both carry an anti-tautology assertion, like the keystone's
unmirrored row: if the marker did NOT move, the check would pass on an empty
shader for ever after. **It fired on the first run** — at 0.75 of the way out a
CUBIC term shifts a point by 0.007, too little to tell a working warp from a
broken one, so the marker sits at 0.88 where it moves 0.037.

**The intermediate targets became LINEAR** in the same commit. While every pass
was 1:1 (the cube, a passthrough) each fragment read its own texel centre and
NEAREST was indistinguishable; a lens warp followed by a keystone reads BETWEEN
texels, and NEAREST there is stair-stepping on every edge. `RGBA16F` is
texture-filterable in core WebGL2 — it is `RGBA32F` that needs
`OES_texture_float_linear`, the distinction the cube upload already turns on.
The null result is unchanged by it (the 1:1 rows still read 0 codes).

## The lens, wired — and the repaint bug it uncovered (2026-09-18, P6 second commit)

`RollPicture.lens`, a Lens section under Perspective on the Crop tab, and the
correction reaching the stage, the crop stage, the filmstrip cell, the
thumbnail and the export. No migration: absent already means null.

**`picture-geometry.ts` is where the ORDER lives, and it is the point of the
module.** A picture now carries two warps and will carry a third; which runs
first is a real decision — a lens un-bends the picture, and only a rectilinear
picture has straight verticals for a perspective correction to make parallel,
while correcting perspective first would hand the lens a picture whose
distortion is no longer radial about the centre, the one assumption the model
rests on. The stage, the snapshot, the filmstrip cell and the export all build
that list, and two of them disagreeing is how a preview stops predicting a
file. `geometryPasses`, `hasGeometry`, `sameGeometry` and `cloneGeometry`
replaced the per-warp calls at every site; the grader is keyed on the whole
record by value.

**The bug this found was already shipped, in the keystone.** `FramingStage`
repaints on `[source, cube, delivered, …]`, but `delivered` was a
`useCallback` over `[graderFor]` alone — a stable identity — so the CROP STAGE
never redrew when the geometry changed. It read the fresh value through the
`latest` ref whenever something else made it repaint, which is exactly why it
looked as though it worked. **A callback that reads through a ref still needs
its identity to track what it would draw**: fresh values through the ref, a new
function when the inputs move — both, not either. `delivered` and `snapshot`
now depend on `[graderFor, source, cube, geometry]`.

Measured in the pane on a 100 px grid, barrel at −100: the lines moved from
`1 · 180 · 360 · 540 · 720 · 900 · 1080 · 1260 · 1438` to
`134 · 347 · 538 · 720 · 901 · 1092 · 1305` — the centre a fixed point, the
displacement symmetric and growing with the radius, the outermost pair pushed
off the frame. Vignetting at −100 sank a corner from 237 to 88 with the centre
untouched. **Preview = export**: the same picture through `renderRollPicture`
put its lines within 0.0006 of the width of the stage's, which is under a
source pixel.

## `v_uv` is a TEXTURE coordinate, and its y is not constant (2026-09-18)

**The bug this cost**: `makeKeystonePass` applied `mirrorYMatrix`
unconditionally, which is right for a canvas source and MIRRORED for an
`ImageBitmap` — so every decoded photograph, which is every real picture in the
Develop tool, took its perspective correction upside down. A positive Vertical
tapered the wrong way and Turn rotated the wrong way. It passed the gate
because the gate drove a canvas.

The helper's own comment named the reason it could not work: the disagreement
"is not even constant", because the vertex shader flips UVs for an
`ImageBitmap` (whose orientation is fixed at creation, so
`UNPACK_FLIP_Y_WEBGL` is ignored for it) and not for a canvas. A constant
mirror cannot express a non-constant flip. `mirrorYMatrix` is gone; a comment
in `geometry.ts` says why, so it is not reinvented.

**The rule now**: a pass that asks WHERE a pixel is converts with `imageUv`
(`glsl.ts`), which reads the vertex shader's own `u_flipY` — one location per
program name, so it is the very value the graph set — and is its own inverse,
so the same call takes a computed image point back to a texture coordinate to
sample at. A matrix in `geometry.ts` is then always in IMAGE space, y down from
the top of the picture, and nothing outside the shader thinks about textures.
An FBO always holds image-bottom at v = 0 whichever source fed it, and the
graph already passes `u_flipY = 0` for those, so the same conversion is right
for pass 2 and up.

A COLOUR pass never notices any of this, and a RADIAL one does not either: a y
mirror leaves every distance from the centre unchanged, which is why the lens
is correct without converting and why its own gate row could be trusted.

**Every geometry row of `check-render.mjs` now runs from BOTH source kinds**,
plus a passthrough row from each — if an untouched marker did not come back
where it was drawn, the harness itself would be upside down and every row above
would be measuring the wrong thing. The two warps are also compared with each
other, because both being wrong the same way would still be one picture, and
that is the failure the pair exists to catch.
