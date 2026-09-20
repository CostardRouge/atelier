# The FilmNode — grain and halation as one node of the graph

Read before touching `src/shared/render/film-pass.ts`, `shared/film/film-texture.ts`
/ `film-noise.ts` / `film-grain.ts`, or anything that would add a second spatial
effect to a look. The graph it rides on is `render-core.md`; the colour half of
the simulation is `media-pipeline.md` («A film stock is a LAYER…»); the design
is `docs/film-simulation.md` §6 and the three requirements it handed P4 are
`docs/photo-editor.md` §11 items 5–7.

## Built so far (2026-09-20, the engine)

`makeFilmPass(texture, width, height)` → a `RenderPass` with `setSourceSeconds`,
or **null when the texture is silent** — a stock with no grain and no halation
must cost not one pass, so an unfilmed picture stays bit-identical to what it
was before the node existed. Nothing calls it yet; the engine was committed
apart from the switch-over so it could be proved against its twins first, the
way P4's own core was.

## Every formula is a TRANSCRIPTION, never a re-derivation

The shader carries no maths of its own: `grainWeight`, `applyGrain`,
`screenHalation`, `extractHighlight` and `combineOctaves` are copied out of
`film-grain.ts` term for term, and the blur's weights are a uniform array
computed by `gaussianKernel` — so there is ONE kernel in the repo and it is the
tested one. That is what lets `scripts/check-render.mjs` hold the GPU to the
pure module by `readPixels`; a re-derivation would be a second implementation
nothing could check (the `layer-pass.ts` rule).

**Measured, on a real GPU**: grain worst **1 code** against `applyGrain` over
the bilinear tile read, halation worst **1 code** against `extractHighlight` →
`blurSeparable` → `screenHalation` over a 25-tap blur.

## `RenderPass.prepare` exists for the halo, and only for it

Every pass of the graph draws at the render size into one of two ping-pong
targets, by construction. The halo is extracted and blurred in a **small buffer
whose size and sigma depend on the RADIUS alone** (`halationBuffer`) — which is
what makes halation resolution-independent and what keeps a 48 MP export from
allocating a 192 MB intermediate — so it cannot be passes of the graph.

`prepare(gl, input)` runs before anything is bound for the pass's own draw, and
the contract is the graph's, not the pass's: the quad VAO is bound and
attribute 0 IS the quad, nothing has to be restored (the graph re-binds its
program, framebuffer, viewport, unit 0 and its own uniforms after), and the
graph's targets are not the pass's to delete. A pass building programs there
uses `linkPassProgram`, the graph's own compile path — the
`bindAttribLocation` trap is silent and would have to be re-learnt otherwise.

**The halo buffer is half-float where the GPU renders to it**, and that is the
point of the graph rather than a nicety: a highlight ABOVE white is exactly
what bleeds, and an 8-bit halo would clip it away before the blur saw it.

## The three coordinates that are each a silent bug

- **`quadUv`, not `v_uv`.** The halo is WRITTEN in screen order — a framebuffer
  write is by `gl_Position`, which no flip touches — so it must be READ in
  screen order, and the grain field must be sampled there too. Reading it
  through `v_uv` mirrors the halo and the grain together, which looks like
  nothing at all. The node is never the first pass (the cube always precedes
  it) so `u_flipY` is 0 in practice, and it is written out anyway because "in
  practice" is exactly how the keystone shipped upside down.
- **`u_flipY` is 0 on BOTH axes of the blur.** A separable blur flipped on one
  axis and not the other is a shear, not a blur.
- **A readback row `y` is at quad `1 − (y + 0.5) / h`.** The gate's own
  arithmetic; get it wrong and every film row measures a mirrored picture
  against itself and passes.

## `MAX_HALATION_TAPS = 79` is measured, not chosen

GLSL ES needs a constant loop bound and a constant array size, so the blur is
built for the widest kernel it can ever need. `halationBuffer` fixes the sigma
from the radius alone, and over the whole of `TEXTURE_RANGES.halationRadius`
that sigma tops out at **12.8 texels** (radius 0.2, a 64-texel buffer) — ±3σ of
which is exactly 79 taps. A spec walks the whole slider and pins it, so
widening the radius range cannot silently truncate the blur.

## The second octave, and why it is normalised

One 256-cell tile repeats about two and a half times down a frame at the
default cell size, which reads as structure rather than as grain. A second read
at `OCTAVE_SCALE = 2.17` — irrational against the first — never lines up with
it, so the visible period becomes the product. `combineOctaves` divides by
`√(1 + w²)` because the two reads are INDEPENDENT and their variances add:
without it, a second octave would be a grain slider that also turns itself up.
A spec measures that variance rather than asserting it.

## The field is the SOURCE frame's, and it is the same field at every size

Both are gate rows, because both fail as a plausible picture:

- **`grainUniforms` puts `1 / grainSize` cells down the frame's height at every
  render size**, so the export's grain IS the preview's, resampled — not merely
  the same statistics. Measured by rendering at 512 and at 1536, where the
  centre pixel of each 3×3 block has exactly the smaller render's frame
  coordinate and so samples the very same point: **worst 0 codes**. A
  per-fragment hash could never keep that claim.
- **`grainFrameIndex` quantises the SOURCE instant to `grainFps`**: a repaint
  and a second time inside the same 1/24 bucket are bit-identical, the next
  bucket differs, and `grainFps = 0` freezes the field for a still. Never per
  rAF — that is the "boiling", and it would also make a re-export a different
  file.

**`fade` is the one resolution-dependent term, deliberately.** A cell finer
than about 1.5 preview pixels fades out rather than aliasing, so a row that
forgets to size its render large enough compares four pictures with no grain in
them and passes on nothing: the gate asserts `fade === 1` where it means to
measure grain.

## The texture belongs to the GRADE, not to the film layer (2026-09-20)

`SavedGrade.film` — `TripGrade.film` (trip v26), `ProjectDoc.lutFilm` (project
v16), `RollGrade.film` (roll v3) — and `LutStack.film` / `setTexture` on the
live stack. **Not on the film layer whose stock it belongs to**, although that
is where the settings for its COLOUR live: the texture is not a lattice, it is
drawn by the node after the cube, and it has to cascade with the rung exactly
as a look does — a trip's texture dressing every piece, a piece departing from
it, one picture departing again (`post-grade.ts`). A texture on a layer could
do none of that.

**`gradeKey` folds `filmTextureKey` in, and it changes nothing about the cube
— which is exactly why it must.** Grain and halation are drawn after the bake,
so a key that reads the cube alone calls two pictures the same, every held
grade in the suite serves the pre-film one, and on a still — the one surface
where grain is tuned — the slider looks dead.

**`setTexture` is named apart from `setFilm`** (which re-dials a film layer's
emulsion): one writes a lattice, the other writes what the node draws over it,
and confusing them would bake grain into a cube.

Two "empty" rules that had to change with it: a grade with no layers and no
transform is still a real look when it carries a TEXTURE (`readRollGrade`,
`useRollGrade`) — grain over an ungraded picture is precisely what a stock's
texture half is for — and `restore` writes the texture BEFORE its early return,
or a document with no layers would leave the last one's grain on.

`filmTextureOrNull` is the ONE reader every document goes through. Junk that is
an object still goes through `normaliseFilmTexture`, which clamps every number:
a hand edit or a newer build's value lands sound where it can, the way a layer
does.

## What is NOT here yet

The graders (the node reaching the stage, the exports and the clip path), the
panel's texture section, the badge and the bitrate bump for grained exports —
`docs/film-simulation.md` §7's last entry.
