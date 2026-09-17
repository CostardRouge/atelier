# Film simulation — a parametric emulsion as a look

**Status (2026-09-17): the colour half is DECIDED and BUILT (F1–F4); the
texture half — grain and halation — is DECIDED and DEFERRED to the photo
editor's render core (`docs/photo-editor.md` P4), where it becomes one node.**
Written from the maintainer's brief of 2026-09-16 (*"time for the next level, i
would like something like the film simulation, like fujifilm … nice quality,
pixel piping etc"*) and his four calls of the same night (§4), then adjusted
on 2026-09-17 against the photo editor's brief so that nothing here is built
twice (§4.5). §1–§3 are traced to files and are fact; §4 records the
decisions; §5–§6 are the model; §9 is what was weighed and declined; §10 is
open. Read `docs/memory/media-pipeline.md` before acting on any of it.

The words stay apart, as everywhere in the suite: a **develop** corrects one
picture (`docs/photo-develop.md`); a **grade** is a look; a **film stock** is a
grade — one layer of the look stack, generated from numbers instead of read
from a `.cube`. Its **texture** (grain, halation) is the one thing about a
stock that is not a colour, and it lives apart (§6).

---

## 1. The ask, and what it turns out to need

A Fujifilm body applies a *film simulation* in camera: a whole capture medium
— its colour crossover, its tone shoulder, the way its saturated colours roll
off, and its grain. Four things wearing one name. Three of them are colour and
one is not, and that split decides the whole design:

| Demand | Nature | Where it can live |
| --- | --- | --- |
| tone (toe, straight line, shoulder) | pointwise | the cube |
| colour response (sensitiser overlap, crossover, dye) | pointwise | the cube |
| saturation rolloff (DIR couplers) | pointwise | the cube |
| **grain, halation** | **spatial** | **a shader pass — nowhere in today's pipeline** |

## 2. What exists today (facts)

- **A 3D LUT is exact for any pointwise colour transform.** `composeLutStack`
  (`shared/lut/lut-stack.ts`) bakes develop → every active layer in the
  author's order → output transform into one `CubeLut`, and every renderer
  takes that cube and nothing else (`media-pipeline.md`, «Grading happens in
  exactly one place»). A film's colour needs no engine change at all.
- **A layer is restored from its `source`** (`shared/lut/restore-grade.ts`):
  `custom` parses the stored `.cube` text, anything else fetches a built-in. A
  layer whose look no longer exists is DROPPED, never graded as identity.
- **`gradeKey` deliberately ignores `customText`** (`shared/lut/saved-grade.ts`),
  because an uploaded cube's text never changes after its id is minted.
- **The whole pixel path is pointwise.** `lut-gl.ts` is one fragment pass:
  `graded = mix(src, LUT(src), u_intensity)` plus the split wipe. No neighbour
  is ever read (grep for `blur|grain|noise|halation|texelSize|dFdx` over
  `src/`: only the readout glow's Canvas 2D grain, `studio.md`, which was a
  measured performance disaster and is not a precedent to follow).
- **`scripts/check-shader.mjs` is the only thing that compiles the GLSL**, and
  a compile failure degrades silently to un-graded exports.
- **The stage works to a pixel budget** while exports compose at source
  density (`media-pipeline.md`): the same picture has two canvas sizes.
- **The photo editor is briefed** (`docs/photo-editor.md`, 2026-09-17): a
  float16 multi-pass render graph in which the cube survives as nodes 2 (the
  develop) and 6 (the look); P4 builds `shared/render/` — a `RenderNode`
  contract, ping-pong framebuffers, `frame-grader.ts` and `held-grader.ts`
  graph-backed at the one seam, and `scripts/check-render.mjs`. Nothing of it
  is built.

## 3. Findings

**F1 — the colour half is free, structurally.** The only question was *what
generates the numbers*, never where they plug in.

**F2 — a film response is a LAYER, not a stage.** The first design put it as a
fifth argument to `composeLutStack`, beside the develop. That is wrong for a
reason the stage shape cannot fix: **a conversion LUT must run before the film
response** — an emulsion applied to D-Log data is nonsense — and conversion LUTs
live in the layer list, which the author orders. A fixed stage before the
layers would apply film to log on every drone clip, silently. As a layer, the
author orders it (`dji_… → film → output transform`), and the strength slider,
enable/bypass, the three Trips rungs, `ProjectDoc.lutStack`, `RollDoc.grade`,
the house style, `composeWith`, `useGradeCubes` and both file formats work
with **no document migration**: `TripDoc` stays v25, `ProjectDoc` v15,
`RollDoc` v1.

**F3 — what makes a look read as film is two pointwise things most "film LUTs"
skip.** Per-channel characteristic curves with *different* shapes (the
crossover: cool shadows under warm highlights), and DIR-coupler inhibition (a
saturated primary desaturates gracefully instead of clipping to a flat patch —
what a saturation slider cannot do). Both are in §5.

**F4 — grain and halation are the photo editor's P4, and would be built twice.**
Halation needs framebuffers, a blur pass, two more programs and a restructured
harness — exactly P4's render core, written a second time in `lut-gl.ts`, in
8-bit, with its own `check-shader` extension. Grain alone is a single-pass
block, but reaching it means threading a texture record through seventeen call
sites (`makeFrameGrader` is called from 14 modules, `createLutRenderer` from 4 —
"six renderers" in memory is stale prose) and re-keying `holdGrades`, which is
what P4 rewrites at the one seam.

**F5 — grain is dither.** The pipeline is 8-bit and a film toe is steep; a film
curve on a clean sky banded in 8-bit is a fault of the OUTPUT depth, not of the
lattice (§8's measurement). Grain is what hides it, which is one more reason
it belongs in the float core rather than being retrofitted here.

**F6 — the naming rule bites the names, not the transform.** `photo-develop.md`
§8 rules out a factory preset set because a fabricated "Punchy" is an invented
example. A documented physical transform is the opposite of that — it is what
the generated `classic/` looks already are. The exposed part is the *names*:
"Velvia", "Portra", "Classic Chrome" are trademarks and claims no measurement
here backs. Naming by emulsion class is honest and says what the transform does.

## 4. Decisions (maintainer, 2026-09-16 / 2026-09-17)

### 4.1 Full scope: colour + grain + halation

Not colour alone, not colour + grain. All three — with the split of §4.5.

### 4.2 Live parametric, not frozen cubes

Dials, not `.cube` files: a stock seeds the numbers, touching one departs from
it. Delivered as F2's layer, whose cube is **generated** from `FilmSettings`
carried in the layer's `customText` as JSON. **No `.cube` ships** — zero bytes
added to the 37 MB `public/` baseline.

### 4.3 Named by emulsion class

`reversal-vivid`, `reversal-neutral`, `negative-portrait`,
`negative-consumer`, `cross-process`, `mono-panchromatic` — a real technical
taxonomy, no trademark, and each name says what its parameters model. Shown
under a **FILM** group in the picker, beside APPLE / DJI / SONY.

### 4.4 Tuned in the Develop tool, on both kinds of picture

Drone D-Log M stills behind a DJI conversion LUT, and ordinary sRGB
photographs straight into the stock, side by side on a roll's filmstrip.

### 4.5 The texture half waits for the render core (2026-09-17)

Checked against `docs/photo-editor.md` the morning it landed: F4 is exact. The
maintainer chose **colour now, texture after P4**: the six stocks as LOOK
layers today (they grade a Trips hook video and a Studio variant the day they
land, because a clip takes the cube path); the pure grain and halation maths
built and tested now so P4 inherits it; grain and halation as **ONE `FilmNode`**
in the render graph once `shared/render/` exists — between LOOK and OUTPUT, a
fixed position, verified by `check-render.mjs`, and **running on the clip path
too** (§10). Declined: colour + grain now (moderate waste, grain sooner), and
all of it now as first approved (the most waste).

## 5. The emulsion model — `shared/film/emulsion.ts`

Everything in **stops from mid grey**, the axis a photographer thinks in: sRGB
code → linear → `log2(linear / 0.18)`, and back at the end. Per pixel:

1. **Monochrome collapse** (mono stocks only, before anything else): one
   value `Σ sensitivity·filter·E / Σ sensitivity·filter` — physically what a
   contrast filter over a panchromatic or orthochromatic layer does, and
   better than a luma matrix because a red filter really does render a red sky
   dark. Normalised, so a grey is untouched.
2. **Coupling** — a row-stochastic 3×3 on linear light: each sensitiser also
   responds to its spectral neighbours' light (near 0.2, far 0.06 at 100).
   Rows sum to 1, so a grey stays grey; a primary loses a little purity and
   shifts hue the way a real dye set does.
3. **The characteristic curve, per channel** — the load-bearing stage.
   `y = −black + softplus(γ·x + black, toe)` bottoms out at −black stops;
   `y = white − softplus(white − y, shoulder)` tops out at +white. Softplus
   corners are monotone and C∞, so the composition never posterises. **Every
   curve is re-speeded so 0 → 0 exactly** (an input shift solved once by
   bisection — the film's real speed); the author's `speed` is then a visible
   push beyond it. Crossover comes from per-channel `gamma`, `toe`,
   `shoulder`, `black`, `white` — never from a hidden exposure change, and mid
   grey stays mid grey on every stock.
4. **Inhibition (DIR couplers)** — the more unequal the three exposures, the
   more inhibitor: `k = inhibition · spread / (spread + 1)` pulls each channel
   toward their mean. A neutral is untouched, a saturated primary is pulled
   progressively, and the pull saturates — the graceful rolloff.
5. **The print stage** (negative stocks only): the negative's stops are the
   paper's exposure; two inversions cancel, so the paper curve reads them
   directly and hands back a positive. Paper: contrast 1.1 + 0.18·grade, a
   long black, and a **hard white a little past display white** (2.65 stops,
   shoulder 0.2) — a print's whites clip cleanly, which is what restores the
   white the negative's own shoulder rolled off. A reversal skips the stage and
   keeps its shoulder: that is the real structural difference between the two
   classes, not a preset name.
6. **Dye saturation** — one trim around Rec.709 luminance.

`filmStage(response)` resolves the curves once and is called per lattice
point (the `developStage` / `makeTransfer` rule); `filmCube(settings)` walks a
lattice through it. `readFilmSettings` / `writeFilmSettings` are the layer's
storage, canonical key order, every number clamped; `filmSettingsKey` is what
`gradeKey` folds in for a film layer (§7, F3).

**The spec the develop has and this must NOT**: `developLinear` keeps a grey
grey under every slider but white balance. A film stock is allowed — required —
to tint one. The file says so; do not "fix" it.

## 6. The texture — `FilmTexture`, and the `FilmNode` it becomes

Built now as pure, tested maths (`shared/film/film-texture.ts`,
`film-noise.ts`, `film-grain.ts`); consumed later by one `RenderNode`. The
design, so P4 builds to it:

- **Units are fractions of the frame's HEIGHT**, never pixels: every resample
  in this repo is height-anchored or close (`stageFrameSize` scales
  uniformly, a height-preserving cover crop scales by `out.h/src.h`,
  `drawFramed`'s zoom magnifies grain with the picture, as enlarging a
  negative does). The residual is an aspect-changing crop (3:2 → 16:9, 19 %),
  under the just-noticeable threshold for grain and with no correct answer.
- **Grain cannot be a per-fragment hash.** Every consumer resamples the
  grader's output (`fitRect`, `drawFramed`, `drawImage` into the stage): a
  48 MP still delivered at 1080 px is box-filtered 5.5×, and white noise at
  one source pixel arrives as grey haze. It must be **band-limited value
  noise**: a 256² tile of four independent seeded white-noise channels,
  sampled `LINEAR` at one texel per grain cell — the bilinear read IS the
  band-limiting filter — plus a second octave at 2.17× to kill the repeat.
- **Density weight**: `pow(4l(1−l), 0.75)·(1 − 0.35l)` — zero at crushed black
  and blown white (the tell that separates film grain from sensor noise), a
  broad midtone plateau, peak near 0.42. A tuning surface: pin the shape, not
  the values.
- **Chroma**: `mix(luma field, rgb fields, chroma)`, default ~0.2. Independent
  per-channel noise is the digital-chroma look; none at all is a grey screen
  door.
- **Animation**: an offset of more than two cells into white noise
  decorrelates completely — a new field per frame, not a translated one, so no
  crawling. The index is the SOURCE frame quantised to `grainFps` (re-rolling
  at 60 Hz on 24 fps material is the "boiling"); `grainFps = 0` freezes it —
  a still, a Ken-Burns move. `grainPhase(frameIndex, seed)` is pure, `seed` is
  stored, **no `Math.random()` in the render path**: a re-export a year later
  is byte-identical.
- **Halation**: extract highlights above a threshold **re-grading at the small
  buffer's size** (no full-resolution intermediate: a 192 MB FBO on a 48 MP
  export, avoided), a separable Gaussian whose buffer height is
  `clamp(round(4 / radius), 64, 512)` and sigma `radius · height` — a function
  of the radius alone, never of the render size, so preview and export blur
  the same texels over the same buffer and halation is resolution-independent
  *by construction*; then a screen composite in a warm tint, **before grain**
  (light scatters at exposure, silver develops after).
- **What a preview cannot show**: a grain cell under ~1.5 preview pixels.
  `grainShowable()` drives a visible badge — not a tooltip — *"finer than this
  preview can show — it will be there in the export"* — and the loupe at one
  source pixel per device pixel (`photo-editor.md` P11) is where it is judged.
  Rail thumbs and roll thumbs pass no texture at all.
- **Where it is stored**: on the GRADE, beside the layers (`SavedGrade.film`),
  because it belongs to the stock and cascades with the rung — a version bump
  on all three holders when the node lands, and `gradeKey` must fold it in or
  every held grade in the suite serves the pre-film picture.

## 7. Phases

**F0 — this brief.**

**F1 — the emulsion model** (`shared/film/emulsion.ts`, 28 specs): §5 as
code, and the lattice measurement of §8. *Built 2026-09-17.*

**F2 — the six stocks** (`shared/film/stocks.ts`): §4.3's names over §5's
numbers, each with a one-line note on what it models, an exposure-neutrality
spec per stock, `describeFilm` for the settled row.

**F3 — the film layer**: `restoreLayers` gains a `film` branch before the
built-in `else`; `gradeKey` folds `filmSettingsKey` in for `source === 'film'`
(its stated rationale — an uploaded cube's text never changes — survives, a
film layer's text changes on every dial move); `useLutStack` gains
`addFilm(stockId)` and `setFilm(layerId, settings)`, with the generated cube
**cached by its settings** so the strength drag never re-runs the emulsion
(§8); `GradePanel` renders a FILM optgroup from `FILM_STOCKS` — not through
`builtin-luts.ts`, whose entries carry a `url` and which imports `virtual:luts`,
absent in a node test run — and, for a selected film layer, the dials, saying
whether the layer is on its stock or departed from it. Also fixes
`roll-types.ts`'s `readLayer`, which clamps `intensity` to 1 where the rest of
the suite allows 3.

**F4′ — the texture maths** (`film-texture.ts`, `film-noise.ts`,
`film-grain.ts` + specs): §6 as pure modules, each stock declaring its
`FilmTexture`, the resolution-independence one-liners as specs, the CPU twins
`check-render.mjs` will compare the node against. No GL, no document field, no
call site.

**After P4 of `photo-editor.md` — the `FilmNode`**: grain + halation as one
node, `SavedGrade.film` with its three version bumps, the panel's texture
section, the badge, the bitrate bump for grained exports (`deriveBitrate`'s
~0.12 bpp is close to worst-case for an inter-frame codec; ~0.18, measured).

## 8. Verification, and the measurement that fixed the lattice

The four gates per commit. In node: the whole emulsion model, each stock's
exposure neutrality, `gradeKey` distinguishing two film layers under one id,
the round trip through the layer text. In a browser, by eye: a Develop roll
with both kinds of picture, the two stack orders (`film → transform` on an sRGB
photograph; `dji_… → film → transform` on a D-Log M still), the same picture in
Trips and the Studio, a hook clip exported through the film layer.

**Lattice size, measured 2026-09-17** (a negative-class response with
crossover, coupling 25, inhibition 40, printed at grade 2.5; worst error over
a 513-step grey ramp and a 9³ colour sweep, sampled tetrahedral against the
exact stage; times in node through Vite's SSR loader, un-JIT-warmed):

| size | worst error | generate | compose at 70 % | + output transform |
| --- | --- | --- | --- | --- |
| 17³ | 3.45 codes | 23 ms | 3 ms | 33 ms |
| 25³ | 2.41 codes | 49 ms | 3 ms | 31 ms |
| 33³ | 2.16 codes | 106 ms | 4 ms | 30 ms |
| 49³ | 1.24 codes | 344 ms | 14 ms | 99 ms |
| 64³ | 0.91 codes | 772 ms | 29 ms | 219 ms |

Three consequences. **`FILM_CUBE_SIZE = 33`**: the error is a smooth 2-code
shape deviation in the toe — tetrahedral interpolation is continuous and cannot
band; only 8-bit output can, which is grain's job (F5), and 49³ buys one code
for a 3× slower dial. **Generation, not composition, is the cost** (the
emulsion runs three curves, a paper and six softplus per point): F3 caches the
generated cube by `filmSettingsKey`, so the strength slider re-walks the
composition (4 ms) and never the emulsion (106 ms); a dial move pays the
106 ms once, under the existing `useDeferredValue`. **Non-monotonic** at 25³ vs
33³ on grey, the same lattice-alignment luck `media-pipeline.md` records for the
output transform — the rule stays "a floor, not a target".

## 9. Weighed and declined, so they are not re-proposed

- **A fifth argument to `composeLutStack`** (a film stage beside the develop).
  F2: it cannot be ordered against a conversion LUT.
- **Generated `.cube` files under `public/luts/film/`** via a script like
  `gen-luts.mjs`. Free and zero-code, but frozen: the maintainer chose dials.
- **Storing the parameters in a new document field.** `customText` already
  exists for "this layer carries its own data"; reusing it is what makes the
  feature migration-free.
- **A shader stage for the response.** `photo-develop.md` §4 declined it for
  the develop and every reason applies here unchanged.
- **Building grain and halation in `lut-gl.ts` now.** F4 and §4.5.
- **Trademark names.** F6.
- **A "grey stays grey" spec.** §5's last paragraph.

## 10. Open, and three requirements handed to `photo-editor.md` P4

1. **The `FilmNode` must run on the CLIP path.** The brief's "a clip takes the
   cube path" is about masks and geometry, which are still-only; grain on a
   hook video is the point of film, and the node has no spatial dependency on
   the edit. The fast path is `SOURCE → CUBE → [FILM] → OUTPUT`, and that is
   what clips take.
2. **The node needs the OUTPUT resolution and a source frame index** (§6):
   grain is the one node whose result must be band-limited against a
   downscale that happens after the graph, and whose field re-rolls per source
   frame, never per rAF.
3. **`gradeKey` must fold `film` in** whatever record carries it, and P4's
   graph-backed `holdGrades` must key on the whole edit, not the cube alone —
   or the grain slider is inert on a still, the one surface where it is tuned.
4. Whether the stocks' numbers get a second pass against reference
   photographs once the maintainer has lived with them — a taste pass, his.
