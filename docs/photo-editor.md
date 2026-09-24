# The photo editor — a render core, and what it unlocks

**Status (2026-09-17): the direction and four decisions are DECIDED by the
maintainer (§4); nothing is built.** Written from his brief of the same day
(*"time for the next level, i would like to replace capture one … beauty
retouch, denoise … white balance, keystone, masking? auto background or subject
segmentation, lens correction, layers with opacity controls, good hdr support,
auto adjust … my ambition is to create my own photo edit software"*).

§1–§3 are traced to files and are fact; §4 records the decisions; §5 onwards is
the plan; §11 lists what is still open. Read `docs/memory/develop.md`,
`docs/memory/develop-roll.md` and `docs/memory/media-pipeline.md` before acting
on any of it — the constraints quoted here come from there and are not repeated
in full. This brief does not replace `docs/photo-develop.md` (the develop
record and the modal) or `docs/develop-tool.md` (the roll and the tool): it is
what comes after both, and it **reverses one ruling**, §4.4.

The words stay apart, as they have since `photo-develop.md`: a **develop** is a
correction of one picture; a **grade** is a look; an **edit** is what the Studio
does. This brief adds a fourth — an **edit stack**: the whole treatment of one
photograph, of which a develop is the first and simplest part.

---

## 1. The ask, and what it turns out to need

Fourteen things were asked for. They are not fourteen features; they are three
demands wearing fourteen hats.

| Demand | What needs it |
| --- | --- |
| **Spatial** — where a pixel is matters | masking, subject/background segmentation, layers with opacity, linear and radial gradients, keystone, lens correction, dust removal, cloning, healing, magic eraser, creative vignetting |
| **Neighbourhood** — what is next to a pixel matters | denoise, noise reduction, purple fringing, sharpening |
| **Float** — values above white matter | HDR, real white balance, highlight recovery |

Three of the fourteen need none of that and fit the engine as it stands:
**curves, levels, auto adjust**. They are the cheap half and they should not
wait for the expensive one.

## 2. What exists today (facts)

### 2.1 One cube, global, 8-bit

- `composeLutStack` (`shared/lut/lut-stack.ts`) bakes develop → N layers →
  output transform into ONE `CubeLut`, on a lattice of 33³–64³. Pure, DOM-free,
  tested.
- `developLinear` / `developStage` (`shared/develop/develop.ts`, 379 lines, 28
  specs) is the correction maths: eleven numbers, linear light, unclamped above
  1 so a RAW developer can hand it headroom.
- `lut-gl.ts` (406 lines) is **one fragment pass**. The frame uploads as
  `gl.texImage2D(…, gl.RGBA, gl.UNSIGNED_BYTE, source)` — **8-bit in, 8-bit
  out**. The LUT is an `RGBA32F` `sampler3D` (or `RGBA8` where
  `OES_texture_float_linear` is absent — since 2026-09-20 `RGBA16F` there,
  so the cube's headroom above white survives on every GPU).
- Seven renderers take that one cube and nothing else: the Studio stage, the
  JPEG export, the frame grab, the video export, Road Trip's `renderBadge`, the
  hook clip, and `roll-render.ts`.

### 2.2 A cube cannot express ten of the fourteen

A 3D LUT is a pure function `(r,g,b) → (r,g,b)`. It is handed no coordinate, no
neighbour and no headroom. So it cannot carry a mask, a warp, a kernel or a
value above 1 — by construction, not by omission. This is the single fact the
whole brief turns on.

### 2.3 The seam is already one method

```ts
// shared/lut/frame-grader.ts
export interface FrameGrader {
  render(source: CanvasImageSource): CanvasImageSource;
  dispose(): void;
}
```

`holdGrades` (`shared/lut/held-grader.ts`) wraps it — grading once per picture
and serving a raster copy (`media-pipeline.md`, «A preview grades once»). Every
consumer above reaches the GPU through that one method. **A render core that
honours `render(source) → CanvasImageSource` replaces the engine at one point,
not seven.**

### 2.4 The roll already holds a picture's treatment

`RollPicture` (`shared/develop/roll-types.ts`, `ROLL_DOC_VERSION = 2` since the border of 2026-09-19) carries
`develop`, `framing` and `aspect`; `RollDoc` carries the roll's `grade` and
`export`. The document shape to grow is here, and it has a migration reader
(`readRollDoc`) already.

### 2.5 What the suite will not do for us

- **No CI gate can see a shader** (`media-pipeline.md`): GLSL is a template
  literal, vitest runs in node, and a compile failure degrades *silently* to
  un-graded output with all four gates green. `scripts/check-shader.mjs` is the
  only remedy and it covers one file.
- **The stage works to a pixel budget** (one 4K frame) because a 48 MP still at
  its own density killed an iPhone tab. Deliverables still compose from the
  source.
- **HDR was ruled out on 2026-08-21** — see §4.4, which reverses it for stills.

## 3. Findings

**F1 — the correction engine is right and the render engine is not.** Nothing in
`develop.ts` needs replacing; it is eleven numbers of good maths with specs. What
cannot survive is *one global pass over 8-bit pixels*.

**F2 — the cube is the right representation for a global colour map, and only
that.** It stays. It is cheap, node-testable, and it is what six other consumers
already speak. The mistake would be to throw it out with the pass that runs it.

**F3 — a layer's adjustment is a develop.** A local exposure is the same maths,
the same ranges and the same sliders as a global exposure. Recognising this is
what makes masking affordable: the layer panel is `DevelopSliders.tsx` again,
and `developLinear` runs per-pixel under a weight instead of per-lattice-point.

**F4 — a lens profile applied to a render is applied twice.** DJI JPEGs are
already dewarped, and Winnow builds a RAW's proxy from the file's **embedded
JPEG** (`extractSourceJpeg`, `develop-originals.md` §1) — so the proxy of a
drone DNG is the camera's own corrected render. Correcting it again bends it the
wrong way. The correction belongs to the RAW.

**F5 — denoise cannot be judged on a downscaled preview.** Its look is a
function of pixel scale. A stage-budget preview of noise reduction is a lie in
the same class as a fabricated telemetry value, and the honest answer is a
loupe at one source pixel per device pixel.

**F6 — a segmentation raster is derived data, not a document.** The request
(`'subject'`) is what the author chose; the pixels are what a model produced
from it, reproducible from the picture and the model version. Storing pixels in
`.roll.json` would break the file's portability rule for no gain.

**F7 — HDR for stills and HDR for video are different problems.** The video
refusal rests on WebCodecs having no PQ or HLG, no High 10 encode, and an 8-bit
canvas. A still needs none of those: it needs float textures (have them) and a
gain-map container (writable). §4.4.

## 4. Decisions (maintainer, 2026-09-17)

### 4.1 Build the new render core

A **float16, multi-pass, layered GPU graph**, with the cube kept as one node.
The alternatives offered and declined: *cheap global wins first* (curves, auto,
defringe on today's cube, core later) and *RAW first*. Both are now phases of
this plan rather than substitutes for it — §7 puts the cheap wins before the
core anyway, because they cost almost nothing and the graph inherits them.

### 4.2 The Develop tool grows; the modals keep the simple sheet

`RollPicture.develop` becomes an edit **stack**; the Develop tool becomes the
serious single-picture workbench. Trips and the Studio keep the global sheet
they have. Declined: giving the modals the full stack (it re-opens the "the
Picture tab is full" measurement that made the sheet a modal), and a fourth
editor beside Develop (a second gallery and a second document, which memory says
stopped being cheap at the third copy).

**What that means at render time, and it is not what it sounds like**: Trips and
the Studio call the same entry point, so a picture with layers *displays*
correctly there. They gain rendering, not panels. Their sheet edits `base` only
and says so when there is more.

### 4.3 The segmentation model ships in `dist/`

Committed to the repo, deployed to GitHub Pages, fetched from our own origin on
first use — so the README's network callout is **unchanged** and the feature is
genuinely offline after one load. Declined: the ffmpeg.wasm pattern (a third
network exception, and a CDN learns what you loaded) and serving it from Winnow
(work in the other repo, and it would stop working offline).

**The accepted cost, to state plainly**: repo weight caps the model at the
MediaPipe class (~5 MB). That buys *subject vs background*, not click-anywhere
selection (MobileSAM is ~40 MB, BiRefNet ~170 MB). **It also rules out ML
denoise**, which is the same size class — so denoise is classic, §7.11.

### 4.4 HDR means headroom AND gain-map output — reversing 2026-08-21 for stills

**The reversal, with its reason.** `media-pipeline.md` records: *"HDR is not
handled, and is out of reach in a browser … not doing it"* (maintainer,
2026-08-21), and `docs/roadmap.md` lists "Real HDR (HLG/PQ) export" as off the
list. Every argument in that entry is about **video**: `pickAvcCodec` probes
8-bit H.264 profiles only; WebCodecs' `VideoTransferCharacteristics` enum has no
PQ and no HLG; mp4-muxer's maps have no bt2020; a real fix would need a High 10
encode WebCodecs supports poorly.

**None of that applies to a photograph.** A still needs float textures
(`EXT_color_buffer_half_float`, present) and a gain-map container (JPEG
segments, writable by hand). So:

- **the video ruling stands, untouched** — no HDR video, no PQ/HLG export, and
  the HLG *notice* (`MEMORY.md`'s open item, roadmap #03) is still the only
  thing open there;
- **stills get both halves**: float16 end to end so highlights above white
  survive until delivery, and **Ultra HDR JPEG** out — an SDR base image plus a
  gain map in an MPF container (ISO 21496-1), which glows on an HDR display and
  falls back to the plain base everywhere else.

Declined: headroom alone (it leaves the delivery question unanswered), and
bracketed-exposure merge, which is a different feature and is named separately
so it never rides along silently (§10).

### 4.5 WebGL2, not WebGPU (recommended, not asked)

Every pass in §5 is a fragment job: warps, blends, gradients, bounded-radius
kernels, wavelets. Three reasons to stay:

1. `scripts/check-shader.mjs` already compiles real GLSL on a real WebGL2
   context and compares it against the pure module — it is the **only** remedy
   the repo has for §2.5, and one shading language keeps it working.
2. WebGL2 runs on his iPhone today, with no second path to maintain.
3. ML inference brings its own backend (it will use WebGPU itself where present,
   independently of our core), so the one genuinely compute-shaped job does not
   argue for a compute core.

**Recorded next step**, so it is not re-litigated from taste: a WebGPU compute
path for denoise *only*, if and when a measurement asks for one.

## 5. The graph

```
SOURCE     8-bit picture → linearise → RGBA16F        (RAW → 16-bit linear, §7.10)
  ↓
1 GEOMETRY   ONE inverse warp: lens distortion → keystone homography → rotate/flip → crop
2 BASE       the global develop + curves/levels          ← TODAY'S CUBE, unchanged
3 LAYERS     N × { mask, develop, curves, opacity, blend }
4 REPAIR     healing / clone / dust — a patch list, one composite pass
5 DETAIL     denoise → defringe → sharpen
6 LOOK       the picture's / roll's LUT stack            ← TODAY'S CUBE, unchanged
7 OUTPUT     output transform → SDR 8-bit, or float + gain map
```

**The claim the whole plan rests on: the cube survives as nodes 2 and 6.** Three
consequences, and they are what make this additive rather than a rewrite:

- `develop.ts` and `lut-stack.ts` are untouched; their specs keep passing and the
  maths stays pure and node-testable;
- a picture with no geometry, no layers and no detail passes takes a **one-cube
  fast path** — today's code, byte for byte, at today's cost;
- the graph honours `FrameGrader.render` (§2.3), so the seven consumers change at
  **one seam**.

**Two things the graph is not for.** A **clip** takes the cube path: masks and
geometry are still-only, so Trips' hook videos and the Studio's variants are
untouched. And the graph is **not a node editor** — the order above is fixed,
the way `composeLutStack`'s is, because a fixed order is what lets two documents
never disagree.

## 6. The model

`shared/render/edit.ts`. `RollPicture.develop` becomes `RollPicture.edit`,
`ROLL_DOC_VERSION` 2 → 3 (v2 went to the border, 2026-09-19); an old `develop` reads straight into `edit.base`,
`framing`/`aspect` into `edit.geometry`, layers default to `[]` — so no existing
roll changes appearance, which is the migration's test.

```ts
interface EditStack {
  geometry: Geometry | null;     // lens + keystone + straighten + crop
  base: DevelopSettings;         // TODAY'S record
  curves: Curves | null;
  layers: AdjustLayer[];         // bottom to top
  repair: Patch[];
  detail: Detail | null;
  look: SavedGrade | null;       // null = follow the roll's
}

interface AdjustLayer {
  id: string; name: string;
  mask: Mask;
  develop: DevelopSettings;      // THE SAME RECORD — F3
  curves: Curves | null;
  opacity: number;               // 0..1
  blend: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
  enabled: boolean; invert: boolean;
}

type Mask =
  | { kind: 'linear' | 'radial'; /* centre, angle, feather, … */ }
  | { kind: 'brush'; strokes: Stroke[] }
  | { kind: 'range'; on: 'luma' | 'hue' | 'sat'; from: number; to: number; feather: number }
  | { kind: 'subject' | 'background'; modelId: string }
  | { kind: 'combine'; op: 'add' | 'subtract' | 'intersect'; of: Mask[] };
```

Four rules to carry:

1. **A layer's adjustment IS a `DevelopSettings`** (F3). One maths module, one
   panel component, one set of ranges.
2. **A brush is VECTOR strokes, never pixels** — points, radius, hardness, flow.
   The document stays small and resolution-independent, and a re-crop or a
   full-size export re-rasterises correctly instead of scaling a bitmap.
3. **A segmentation raster is cached, not stored** (F6): kept beside the
   thumbnails in `atelier-develop`, keyed by picture + model + version, pruned
   by whoever removes the picture, regenerated on a version mismatch (and the
   roll says when it is regenerating). The document holds the *request*.
4. **Procedural masks are pure** — `mask.ts` gives `(x, y) → weight` per kind,
   tested in node; the shader evaluates the same formula, checked against it by
   §9's harness.

## 7. Phases — one commit each unless noted

**P0 — this brief.** Recorded before any code, the repo's convention.

**P1 — curves and levels** *(two commits, BOTH BUILT 2026-09-17: the engine —
`curves.ts`, the two fields, the bake — then the editor, `DevelopCurve.tsx`
over a pure `curve-edit.ts`, drawn by both hosts. **Levels deliberately have no
panel**: a curve whose end points drag IS the black/white-point gesture, so the
numeric row waits for the auto-adjust that computes it, P2)*. A spline on the
develop record, baked into the same
cube. `curves.ts` pure + tested. No core needed; the biggest daily-use gain per
line in the whole plan, and the graph inherits it as node 2.

**P2 — auto adjust, the levels row, then the eyedropper** *(two commits, BOTH BUILT 2026-09-17)*. `auto-develop.ts` pure over an AS-SHOT read
(`useDevelopPicture().stats`), as **two** verbs — Auto tone writes levels and
touches no colour, Auto colour is a white balance and is exactly wrong on a
sunset, so they never share a click — plus the Levels row they write into.
Then the eyedropper (*Pick grey*), which runs the SAME solve
(`whiteBalanceFor`) on the pixel the author points at instead of on the mean.
Also no core.
**Kelvin is cut, and the reason is the anti-fabrication rule**: temperature
here is a channel GAIN, and an 8-bit render carries no as-shot white balance to
offset from, so a kelvin number would be invented. It waits for the RAW path,
where `AsShotNeutral` and a colour matrix make it real (P10).

**P3 — the RAW spike** *(PARTLY BUILT 2026-09-17)*. Built, and a gain on its
own: `shared/exif/raw-probe.ts` reads a RAW's IFDs through the EXIF parser's
own TIFF reader and `extractRawPreview` slices out the render the camera wrote
inside the file — so **a DNG or an ARW opens in Develop today**, with no
decoder fetched and no dependency added, wearing a `RAW · camera render` chip
that says it is the camera's JPEG and not the sensor data. `describeRaw`
prints what the rest of the spike must report.

Still the maintainer's files' to answer, and nothing here can stand in for
them: tag 259 and the opcode lists on his own DJI DNG, ProRAW (lossless **and
JPEG XL**) and ARW; `libraw-wasm` decode time and heap at half and full size.
`libraw-wasm` 1.6.0 is reachable from the container, so that is one `npm i`
away once the files are in the scratchpad — never in the repo. A JPEG XL
refusal by the npm build is what turns the decoder choice into "which wasm
build do we maintain" (`photo-develop.md` §6.2), and that comes back to him.

**P4 — the render core** *(two commits, BOTH BUILT 2026-09-17: `shared/render/` proved pixel-identical by `scripts/check-render.mjs`, then `makeFrameGrader` switched onto it so all sixteen consumers run on the core — `docs/memory/render-core.md`)*. `shared/render/`: a `RenderNode`
contract, float16 ping-pong framebuffers, the SOURCE and CUBE nodes, and
`renderPicture(source, edit)` with the one-cube fast path; `held-grader.ts` and
`frame-grader.ts` become graph-backed at the one seam. Second commit:
`scripts/check-render.mjs`, extending §2.5's harness to every node —
**non-negotiable**, since the core is roughly ten times the GLSL surface CI
already cannot see. **Nothing changes on screen**, and the gate is exactly that:
a pixel-for-pixel match against today's path.

**P5 — geometry: keystone arrives** *(two commits, BOTH BUILT 2026-09-17 — `geometry.ts` + `keystone-pass.ts` with
the warp measured against the matrix on a real GPU, then the document field,
the Crop tab's Perspective panel and the warp reaching the stage, the thumbnail
and the export. The crop is deliberately left on `drawFramed` for now: moving seven
renderers off it is its own change, and a keystone corrects BEFORE a crop
frames, so the two are independent.)* Originally: `geometry.ts` pure (a
3×3 homography from four corner offsets or from V/H sliders, round-trip tested);
the crop leaves `drawFramed` for the warp; `CropStage` (the zone editor that
replaced `FramingStage` on 2026-09-19, its arithmetic in `crop-rect.ts`) gains
the keystone handles.

**P6 — lens correction** *(BOTH commits BUILT — `lens.ts` pure with 17 specs
and `lens-pass.ts`, one radial pass carrying distortion, lateral CA and
vignetting together, measured against the pure module on a real GPU; then
`RollPicture.lens`, the Crop tab's Lens section, and the correction reaching
every renderer through `picture-geometry.ts`, which is now the ONE place the
order of the warps is stated.)*

**The profile half is NOT built, deliberately, and is not merely unfinished.**
A lens profile is MEASURED calibration data. There is no real Lensfun data here
for the Mini 4 Pro or the Sony glass, and coefficients invented to fill the gap
would be a fabricated correction — worse than none, because it looks
authoritative. The same refusal as the battery gauge drawing `—`. So what ships
is the engine plus manual sliders, which correct by eye against a straight edge
and work on any lens; a profile, when there is real data for one, is a source of
numbers for those same sliders and changes nothing below them.

When it does come: a small Lensfun-subset parser (pure, tested), profiles
committed under `public/lenses/`, matched on EXIF
`Make`/`Model`/`LensModel`/`FocalLength`/`FNumber` — which `MediaOrigin.exif`
already vouches for on a proxy (`studio.md`, «A source vouches») — interpolated
between focal entries. **F4 is the rule that shapes it**: a profile applies to a
RAW, is OFF by default on a render (a DJI JPEG and its embedded preview are
already dewarped while the DNG is not), and the panel says why.

**P7 — layers and procedural masks** *(BOTH commits BUILT 2026-09-18 —
`render/mask.ts` + `render/layer-pass.ts` + `develop/layer.ts` +
`develop/layer-render.ts`, then `RollPicture.layers`, a fourth inspector tab and
the stack reaching every renderer. `render-layers.md` holds the rules.)* This is
where *layers with opacity*, *gradients* and *creative vignetting* land.

Three departures from the plan above, each for a reason:

- **No `EditStack` migration.** `RollPicture` is already flat — `develop`,
  `framing`, `aspect`, `keystone`, `lens` — so layers arrived as one more
  optional field rather than a rename that would churn every consumer for no
  functional gain. The `EditStack` shape survives as what the RENDERERS take.
- **Layers run after the one cube**, not between the develop and the look: a
  local correction is then set on the picture as displayed rather than in the
  log space a conversion LUT reads. §5's ordering and the cost of changing back
  are recorded in `render-layers.md`.
- **No blend modes.** They were in my plan and are not in the maintainer's
  list; an adjustment layer with a multiply mode is a compositing feature, and
  opacity is the control that was asked for. One field and one `mix` later, if
  it is ever wanted.

Still ahead for masks: hue and saturation ranges, combining two masks, and
DRAGGING the shape on the stage rather than setting it with sliders (a
hit-tested overlay with its own gesture rules — a piece of work, not a control).

**P8 — brush masks** *(THREE commits, all BUILT 2026-09-18 — the stroke model
and the rasteriser, a grader that swaps its passes, then the gesture;
`render-layers.md` and `render-core.md` hold the rules.)*

Strokes are VECTORS, so the document stays small and a mask painted on a preview
delivers at full size. They are rasterised on the **CPU**, not the GPU as
written here: a shader walking every segment of every stroke per pixel costs
`pixels × points`, and the CPU can walk each stroke inside its own bounding box
instead. What matters is that it rasterises the SAME function the pure module
defines rather than an approximation of it, so the gate holds the GPU to the
tolerance the procedural shapes get.

It needed one thing this plan did not foresee: **a grader that swaps its passes
instead of rebuilding its context**. A stroke adds a point per `pointermove`,
and a new WebGL2 context per point is no gesture at all. That landed as its own
commit, and the keystone and lens drags got it for nothing.

Edge-snapping ("auto mask") stays deferred.

**P9 — segmentation** *(BOTH commits BUILT 2026-09-19 — the model and the
segmenter, then the tap gesture and the rasters everywhere; `render-layers.md`.)*
The README's network callout is unchanged: everything is served from our own
origin and dynamically imported on the first ask, so a page that never opens a
subject mask pays nothing.

Three things the maintainer's own `p5-templates` settled that §4.3 had wrong:

- **The cost is the WASM, not the model.** 16.9 MB, not "a ~5 MB
  MediaPipe-class model": the model is 6.2 MB and `vision_wasm_internal.wasm` is
  another 9.6 MB. The `nosimd` twin (9.1 MB more) is not shipped — every browser
  that can run this suite has wasm SIMD.
- **Click-anywhere is the feature**, not the thing to avoid. `InteractiveSegmenter`
  over `magic_touch`, several points unioned. Semantic segmentation
  (`deeplabv3`) answers about CATEGORIES, and a photographer pointing at the
  second of three people is asking about THIS ONE. "Background" is this mask
  under the layer's existing `invert`, not a second model.
- **The selected object is category 0**, everything else 255 — backwards from
  the obvious reading, and reading it the other way selects the background.

Still open: persisting the cached raster (it is a session cache today, so a
reopened picture re-segments), and a faster path than one sequential inference
per point.


**P10 — RAW develop** *(BOTH commits BUILT 2026-09-20 — the engine, then the
tool; the rules are `docs/memory/raw.md`)*. O5: `raw-decoder.ts` behind
`libraw-wasm`, dynamically imported (the MapLibre rule — never in the main
bundle), in its own worker, opt-in per picture, decoded to a budget;
`DevelopSettings.base: 'render' | 'raw'`. This is where white balance stops
being an approximation and highlight recovery starts recovering something.

Four things the build settled against the plan:

- **It works without cross-origin isolation** (measured), so GitHub Pages is
  not the obstacle it is for a multi-threaded ffmpeg.
- **The decoder's `gamm` option is ignored** — the output is always dcraw's
  BT.709 curve — so the wrapper inverts that curve exactly rather than asking
  for linear.
- **The develop is NOT applied at decode** (`developedAtDecode` was the
  plan's word for it): one decode serves every slider, because the cube
  survives as the develop with the sensor's range as its `[0,1]` and a
  MEASURED gain (`rawGain`, stored so preview = export) bringing the picture
  to its own exposure before the sliders. The graph gained a half-float
  source for it (`render/half-image.ts`, `RGB16F`).
- **Kelvin stays cut**: the RAW's `AsShotNeutral` is applied by the decoder
  as the camera's white balance, and temperature/tint remain gains against
  it. A Kelvin readout needs the colour matrices and is a later refinement.

Verified in headless Chromium on a synthetic 12 MP DNG dropped on the
Develop tool: the Base section offers RAW, the switch decodes at half size
in the stage (2000×1500, metered), the chip reads `RAW · 16-bit linear`,
−1.5 EV brings a clipped patch to 160, and *Export this picture* decodes the
whole 4000×3000 and writes pixels equal to the stage's to the code. Still
his to run: a real DJI DNG, ProRAW (lossless and JPEG XL) and ARW through
this path — the JPEG XL answer (§11) is unchanged — and the heap on his
iPhone (decision 5 of `develop-originals.md` §7).

**P11 — detail** *(two commits; the FIRST is BUILT 2026-09-20 — `render/detail.ts`
+ `detail-pass.ts`, `RollPicture.detail`, a fifth *Detail* tab; the rules are
`docs/memory/render-detail.md`)*. Classic, per §4.3 — but not as written here:
a separable Gaussian on the chroma alone and a 7×7 bilateral on the luma
rather than wavelets and a guided filter, because each is one bounded
fragment kernel with a pure twin the render gate holds it to (chroma within
1 code, the rest 0). Defringe gates purple chroma on a steep luma edge; sharpen
is an unsharp mask on the luma applied as one ratio. Noise runs BEFORE the
cube on the source, sharpen LAST after every warp (`makeFrameGrader` gained a
`before` list). Kernels are in SOURCE pixels, scaled by the stage — a fair
preview and not the truth, which is the second commit's reason to exist: the
**loupe at one source pixel per device pixel**, because F5 — *BUILT 2026-09-20
in both Develop hosts*: past the stage's 1:1 the picture is decoded whole
(capped at the GPU) into a second grader with the same chain and its window
drawn in viewport space over the stage, released when the view comes back
(`docs/memory/render-detail.md`, «The loupe»).

**P12 — repair** *(BUILT 2026-09-20 — `render/repair.ts` + `repair-pass.ts`,
`RollPicture.repair`, the Repair section at the top of the Detail tab; the
rules are `docs/memory/render-repair.md`)*. Dust detection and removal,
healing, clone, as one `Patch[]` list and one composite pass — the pass runs
FIRST, on the source, so a copied pixel takes the same develop, look, warp and
denoise as its neighbours. A heal matches the destination's SURROUNDINGS and
never its middle (the mean of a dust spot is the dust); a clone copies the
source exactly. Dust is found on the stage's decode by a pure walk
(`detectDust`: small, dark, roughly round, sourced from the cleanest of four
neighbours) and never stored — only the patches it answers are. A tap heals a
spot from beside it, a drag says where to borrow from; a patch is two rings on
the picture, clicked off while Repair is armed. Held to the pure module by the
render gate from both source kinds within 2 codes (measured 1). Not a
content-aware fill, deliberately.

**P13 — HDR delivery** *(BUILT 2026-09-20 — `shared/hdr/gain-map.ts`,
`ultra-hdr.ts`, `ultra-hdr-export.ts`, `hdr-display.ts`, `RollExport.hdr`, the
Export tab's HDR section; the rules are `docs/memory/hdr.md`)*. The float core
already gives the headroom; this adds the **Ultra HDR JPEG** export — an SDR
base, a gain map MEASURED from a second render of the picture developed the
asked stops darker (where the SDR ran out at white the sensor's own highlights
are what the map carries; where it had room the map is flat), both encoded
through `canvas.toBlob`, wrapped in a hand-written MPF/XMP container. Hand-
written on purpose — the repo's own tradition (`exif-parser.ts`, `qr.ts`, the
`colr` guard) — and read back by the same module. **The claim is only made
after decoding the file back**, exactly as the AAC priming measurement was
(`media-pipeline.md`): the numbers, the map's codes and the lifted peak are
held to what was written, or the plain JPEG leaves and says why. Offered only
to a picture developed on its RAW — a render holds nothing above white. The
HDR-capable preview canvas is DETECTED and said plainly (`(dynamic-range:
high)` for the display, a `rec2100` context echo for the canvas — no browser
grants one without a flag in 2026), so the stage stays the SDR base and no
preview pretends; an HDR stage waits for the day `canvas` turns true.

## 8. Where each ask lands

| Asked for | Node | Phase |
| --- | --- | --- |
| white balance | base (exists) → real on RAW | P2, P10 |
| keystone | geometry | P5 |
| masking, subject/background | layers | P7, P9 |
| lens correction | geometry | P6 |
| layers with opacity | layers | P7 |
| good HDR support | float core + output | P4, P13 |
| auto adjust | pure, over the histogram | **P2** |
| denoise, noise reduction | detail | P11 |
| pixel piping → *pixel peeping* | the loupe | P11 (§11) |
| dust removal | repair | P12 |
| purple fringing | detail (defringe) | P11 |
| levels, curves | base — today's cube | **P1** |
| photo stack | its own thing | §10 |
| vignetting | geometry (correction) · layers (creative) | P6, P7 |
| cloning, healing, magic eraser | repair | P12 |
| linear and radial gradients | masks | P7 |

## 9. Verification

The four gates per commit (`typecheck`, `lint`, `test`, `build`), plus:

- **`node scripts/check-render.mjs`** after any shader change: compile each
  node's real GLSL on a WebGL2 context and compare against its pure module,
  **clamped to [0,1]** — the framebuffer clamps on write and the pure module
  does not, and an unclamped comparison fails for the wrong reason
  (`media-pipeline.md`'s own trap, inherited).
- **P4's gate is a null result**: one picture through the graph and through
  today's path, pixel-identical.
- **preview = export** per phase: the same picture through the stage and through
  `roll-render.ts`, a handful of pixels compared. No encoder needed.
- Browser-pane runs on canvas-made JPEGs (`develop-roll.md`'s recipe); the phone
  layout at 375×812. The RAW decode runs in the container (wasm, no GPU needed);
  **the heap verdict on a 48 MP decode is his iPhone's**, as with the still
  export.
- Memory in the same commit (rule 2): a new `docs/memory/render-core.md` once
  P4 lands, `develop-roll.md` for the document change, and the §4.4 reversal
  written into `media-pipeline.md` beside the entry it amends.

## 10. Weighed and declined, so they are not re-proposed

- **A node editor / free graph.** The order in §5 is fixed for the reason
  `composeLutStack`'s is: two documents must never disagree about what a number
  means.
- **Replacing the cube.** It is the right representation for a global colour
  map, it is node-testable, and six consumers speak it (F2).
- **Masks or geometry on video.** Still-only; a clip takes the cube path.
- **ML denoise.** Same size class as the models §4.3 rules out.
- **Photo stacking** (focus or exposure merge). Not rejected — *separate*. It
  needs frame alignment, which is a project of its own and shares nothing with
  the graph. Named here so it never rides along silently inside "HDR".
- **Matching Capture One's colour.** Its per-body colour science is authored
  data, not an algorithm; matching it is a taste project, not an engineering
  one. Worth saying before someone tries to close the gap with code.

**And four things a browser will not do**, which the ambition should be stated
against: tethered capture; soft-proofing against a printer ICC profile; a
catalogue at a hundred thousand pictures (Winnow is that, and already is); and
100-megapixel files on a phone.

## 11. Open

1. **"pixel piping"** — read as *pixel peeping*, delivered as P11's loupe, since
   denoise cannot honestly be judged otherwise (F5). If it meant the processing
   pipeline itself, it is §5 and it moves.
2. **P3's JPEG XL answer** turns "which decoder" into "which wasm build do we
   maintain" if the npm build refuses those files — his call when it comes.
3. ~~**Whether the develop crosses the Trips/Studio bridge**~~ — **ANSWERED
   2026-09-21: it crosses.** The maintainer settled it by stating the rule
   above it: a tool is an ELEMENT the others can use, so Develop opens as a
   modal inside Trips and the Studio, and what the author did to the
   photograph travels with the photograph. Same reason the look must cross
   whole (P7 of `roadtrip-export.md`). Built: nothing yet —
   `docs/memory/architecture.md`, «A tool is an ELEMENT».
4. **The RAW-on-a-phone verdict** (decision 5 of `develop-originals.md` §7)
   still needs his iPhone.

Three requirements P4 inherited from the film simulation — **all three met on
2026-09-20**, when the `FilmNode` was built; kept as the record of what it was
built to, and maintained from `docs/memory/render-film.md`
(`docs/film-simulation.md` §6 and §10, decided 2026-09-17 — the maintainer
chose to make grain and halation ONE node of this graph rather than build the
multi-pass machinery twice; the pure maths is already in `shared/film/`):

5. **A `FilmNode` runs on the CLIP path too.** "A clip takes the cube path"
   (§5) is about masks and geometry, which are still-only; grain on a hook
   video is the point of film, and the node has no spatial dependency on the
   edit. The fast path is `SOURCE → CUBE → [FILM] → OUTPUT`, and that is what
   clips take. The node sits between LOOK and OUTPUT, a fixed position.
6. **The node needs the OUTPUT resolution and a source frame index.** Grain
   must be band-limited against a downscale that happens AFTER the graph
   (`film-noise.ts`: a tiled noise sampled `LINEAR` at one texel per cell,
   never a per-fragment hash), sized as a fraction of the frame's height
   (`film-texture.ts`, `grainUniforms`), and its field re-rolls per SOURCE
   frame quantised to `grainFps` (`grainFrameIndex`, `grainPhase`) — never
   per rAF. Halation's buffer is a function of the radius alone
   (`halationBuffer`), so it is resolution-independent by construction. The
   shader takes its blur weights from `gaussianKernel` and is compared to
   `blurSeparable` by `readPixels` in `check-render.mjs`.
7. **`gradeKey` and the graph-backed `holdGrades` fold the texture in**
   (`filmTextureKey`): the texture changes nothing about the cube, so a cache
   keyed on the cube alone serves the pre-film picture and the grain slider
   looks dead on a still — the one surface where it is tuned. The texture is
   stored on the grade beside the layers (`SavedGrade.film`, a version bump on
   `TripGrade`, `ProjectDoc` and `RollDoc` when the node lands), because it
   belongs to the stock and cascades with the rung.
