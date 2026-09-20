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

## The switch-over: one seam, a fixed position, a source instant (2026-09-20)

`makeFrameGrader` grew a **seventh argument**, the texture, and
`makeGraphGrader` puts the node LAST of all — after the look and after every
extra pass. No caller places it: grain that a sharpen then amplified, or a
keystone resampled, would be neither grain nor sharp, and on the clip's fast
path (no extras) last IS `SOURCE → CUBE → [FILM] → OUTPUT`. A gate row proves
the order by comparing a grader with a sharpen + texture against the same
texture drawn over a separately sharpened picture.

`FrameGrader.render` grew a **second argument**: which SOURCE instant the frame
is. Every still passes nothing and stays on field 0 — so the seam is what it
always was for them — and a clip passes its own timestamp, which is why a
24 fps stock over 60 fps footage re-rolls every other frame instead of boiling,
and why a DUPLICATED frame (`frame-rate.ts`) carries the grain of the frame it
really is.

`PassGrader.setFilm` / `HeldGrader.setFilm` swap the texture in place, for the
reason `setExtraPasses` exists: the grain and halation sliders move on every
step of a drag, and a rebuilt grader is a new WebGL2 context per step.

**"No look" stopped meaning "nothing to render"** — again. Geometry made that
true first; a texture with nothing but grain in it makes it true once more, so
every `needsGpu` test in the suite now asks `isSilentTexture` too
(`use-develop-picture.ts`, `roll-render.ts`, `photo-frame.ts`,
`export-variant.ts`, `badge-render.ts`, `BadgeStage.tsx`).

**The bitrate.** Film grain is a new, uncorrelated field every frame by
construction, so there is nothing for a P-frame to predict: at the default
~0.12 bpp the grain the stock asked for comes back as blocking. `deriveBitrate`
takes `grained` and spends ~0.18. Keyed on `film.grain`, not on the texture —
halation is a blur and costs nothing.

**A trap the gate caught and nothing else could have.**
`UNPACK_FLIP_Y_WEBGL` is context-global, the graph leaves it TRUE after a
source upload, and `createCubeTexture` turns it off (a `texImage3D` errors with
it on) and leaves it off. So the noise tile was uploaded flipped or not
depending on whether the LOOK happened to be re-uploaded in the same render —
a grader BUILT with a texture and the same grader SWAPPED onto one drew two
different fields, both plausible. **Rule: an upload SAYS its unpack state,
never inherits it.** The node's samplers also moved off unit 1, which the cube
pass owns with a `sampler3D`.

## What the node does NOT reach, and why

- **The Studio's STAGE.** It drives `createLutRenderer` frame by frame for its
  split and its strength rather than building a grader (`render-core.md`, «not
  retired»), so it previews no grain. Its EXPORTS carry it, both still and
  clip. Putting the node there means building the multi-pass machinery in
  `lut-gl.ts` — the very thing `docs/film-simulation.md` §4.5 declined.
- **Thumbnails**: rail thumbs and roll thumbs pass no texture at all, by
  design (§6) — a grain cell is invisible at that size and costs a node.
- **A PAINTED clip** (a hook over a photograph) grades ONCE into a bitmap the
  painter draws every frame, so its grain is FROZEN. Grading per frame would be
  one WebGL2 render per frame for a picture that cannot change; a photograph's
  grain does not move anyway, which is what `grainFps: 0` asks for.
- **The legacy overlay and composer tools** hold no `SavedGrade`, so there is
  no texture to give them.

## The panel, and the badge that has to be honest (2026-09-20)

`FilmTextureDials` sits in `GradePanel` BETWEEN the stack and the output
transform, which is where the node draws: after the cube, before the delivery.
It edits the grade's texture, never a layer's.

**Sizes are shown as fractions of the HEIGHT (`h/667`), never in pixels** — a
pixel would be a different grain at every export size, which is the one thing
the design exists to prevent.

**Adding a film stock brings its texture**, but only where the grade carries
none: half of what a stock IS lives there, and a texture the author already
dialled is theirs (`textureOf`, a COPY — the stock's record must not be edited
in place through a document that happens to hold it).

**Two badges, both visible states and never tooltips**, because the panel
would otherwise read as a broken slider:
- the cell's size in THIS preview's pixels, and *"finer than this preview can
  show — it will be there in the export"* below `MIN_CELL_PX`, where the node
  fades the grain out rather than aliasing it. Measured in the browser: at a
  600 px stage the default cell is **0.9 px** and nothing is drawn; coarsened
  to `h/100` it is **6.0 px** and the picture moves by 6 codes.
- `previewDraws={false}`, which the Studio passes, says outright that ITS
  stage does not draw the texture at all.

**The trap this cost, found by driving it and not by a test.** The workbench's
paint effect reads the texture only through `graderFor`, a `useCallback` with
no deps — so the stage never repainted when the texture changed and the whole
feature looked dead. The same trap `render-geometry.md` records for the
keystone's callback: **a value a stable callback reads is still a dependency of
the effect that calls it.** Both the stage's effect and the loupe's now list
it. Lint cannot see this; a browser can.
