# Develop — a photo editor inside the suite

**Status (2026-09-13, night): P1 to P4 are BUILT; the decoder is
DECIDED.** The maintainer chose `libraw-wasm` (§6.2 option (a)) and started
the phases: the engine (P1), Trips' side (P2 — v15, the `DevelopSheet`, the
Picture tab's settled row, one cube per slide through `LutStack.composeWith`),
the Studio's (P3 — `ProjectMedia.develops` v15, hash-guarded, the Grade
tab's settled row, the same sheet over a photo or a clip) and the
time-savers of §8 (P4 — the session clipboard, the trip's presets, the
apply-to verbs) are in; the decisions they fixed are in `media-pipeline.md`,
`roadtrip.md` and `studio.md`. P5 onwards is still the plan, and choices 5–7
of §11 are still open. Written from the
maintainer's brief of the same day (*"un mini éditeur de photos… luminosité,
contraste, exposition, saturation, brillance… highlights, whites, darks,
shadows… des DNG… ça doit marcher aussi avec la source Winnow… des LUTs sur les
photos… un overlay ou une modale, l'interface Content/Style est déjà trop
chargée… ponctuellement sur l'image… qui renvoie les réglages ET l'image
finale… plus transparent que le pont Trips → Studio"*). §2 and §3 are traced
to files and are fact; §4 onwards is the plan; §11 lists the seven choices to
make before the first commit. Read `docs/memory/studio.md`,
`docs/memory/roadtrip.md` and `docs/memory/media-pipeline.md` before acting on
any of it — the constraints quoted below come from there and are not repeated
in full.

The word used throughout is **develop** (the darkroom's own): a *develop* is a
correction of ONE picture — exposure, tone, colour — and it is a different
thing from a *grade* (a look, `.cube` LUTs, per trip or per project) and from
an *edit* (what the Studio does: overlays, framing, export). Keeping the three
words apart is what keeps the three features from merging into one panel.

---

## 1. The request, and what it turns out to need

Five things were asked for, and a sixth is implied:

1. **Corrections by number** — brightness, contrast, exposure, saturation,
   vibrance (*"brillance"*), and the four tone controls of every RAW developer:
   highlights, whites, shadows, blacks (*"darks"*).
2. **On a DNG.** The maintainer's stills are often camera RAW; today the suite
   keeps the file and says it cannot open it (§2.2).
3. **On a Winnow picture** — where the file in hand is a WebP proxy and the
   capture sits on the instance.
4. **LUTs on photos too** (*"appliquer des lots… ok de les appliquer aussi pour
   les photos"*, read as LUTs — and see §8 for the other reading of *lot*, a
   batch, which is the time-saver he is actually after).
5. **A sheet, not more inspector**: opened from the piece being composed,
   returning the numbers AND the picture, so the Trips editor shows the result
   without leaving and coming back. A standalone tool *may* exist too.
6. **No round trip to a desktop developer** — the stated reason for all of it.

What it needs, and does not have: a correction engine (there is only a look
engine), a RAW decoder (there is none), and one place to open both from.

## 2. What exists today (facts)

### 2.1 One grading primitive, and every renderer takes exactly one cube

- `shared/lut/lut-gl.ts` is the whole of the pixel maths on the GPU: one
  fragment shader, `graded = mix(src, LUT(src), u_intensity)`, plus the
  before/after wipe (`u_split`). Nothing in it knows exposure, contrast or
  saturation — a grep for those words over `shared/lut/` finds only the output
  transform's comments.
- `composeLutStack` (`lut-stack.ts`) bakes the stack — N layers × intensity,
  then the output transform as a final non-reorderable stage — into ONE
  `CubeLut`, walking a lattice (largest input, floor 33 with a transform, cap
  64). The reason recorded for baking rather than adding shader stages: every
  consumer already takes exactly one `CubeLut`, the maths stays testable in
  node, and a stage placed after the shader's `mix` would transform ungraded
  footage at intensity 0.
- The consumers, all of which take that one cube and nothing else:
  `use-overlay-stage.ts` (the Studio stage), `photo-frame.ts` (the JPEG
  export), `frame-grab.ts`, `export-variant.ts` (the video export),
  `badge-render.ts` (Road Trip's preview and PNG deck),
  `hook-video-export.ts` (the hook clip and the painted still-video). Six
  renderers, one insertion point — the same fact that made the output
  transform thirty lines instead of a subsystem.
- The bake runs on every slider step and is kept usable by
  `useDeferredValue` (`use-lut-stack.ts`); measured ~28 ms per bake at 33³
  with a transform. A develop stage lands in the same loop and pays the same
  price.

### 2.2 A RAW is a file the suite keeps and cannot open

- `decodePhoto` (`photo-frame.ts`) is `createImageBitmap`; a RAW throws
  `PhotoDecodeError` — *"export a JPEG or TIFF from your RAW developer and use
  that"*. `loadBadgeSource` (`badge-render.ts`) says the same for Road Trip,
  and the Library's lightbox draws *"no browser decodes this; add its JPEG
  twin"* (`AssetSidebar.tsx`). Three surfaces, one honest sentence, no decoder.
- `buildAssets` lets a RAW yield its image slot to a same-named JPEG
  (`isRawImage`, `assets.ts`) — the only RAW handling in the suite, and it is
  the *avoidance* of the RAW.
- `exif-parser.ts` already walks a TIFF (*"DNG and most camera RAW begin with
  a TIFF header, so the same IFD walk works directly on them"*) — so a DNG's
  metadata is readable today; only its pixels are not.
- `package.json` carries no image decoder of any kind; ffmpeg.wasm
  (`transcode.ts`) is the one heavy, opt-in, fetched-on-first-use codec in the
  suite, and it sets the pattern (§6.3).

### 2.3 What a Winnow picture is here

- The proxy is a **WebP re-encode, 2048 px long edge, no EXIF**
  (`materialize.ts`), and `MediaOrigin.exif` carries what the instance parsed
  so the exposure elements still read (`studio.md`, «A source vouches»).
- `MediaOrigin.fetchOriginal` exists for every proxy and the Studio's export
  uses it for CLIPS — *"edit on the proxy, deliver from the capture"*
  (`StudioEditor.tsx:1094`). Its comment records that **photos never take this
  path: "a photo's original is often a RAW no browser decodes."** That reason
  is the one this brief removes.
- The finals write-back (`finals.ts`, `SendFinalsPanel.tsx`) already sends a
  render HOME with `original_asset_id`, and Winnow models lineage
  (`has_edit` / `is_edit`). A developed JPEG going back as an edit of its
  capture is a path that exists, not one to build.

### 2.4 Where a per-picture value lives in each tool

- **Trips**: a slide carries `framing` (v12) — *"about THIS photograph… never
  inherited"* (`trip-types.ts:237`) — and a post carries `grade: TripGrade |
  null`, null meaning *follow the trip* (v10). The Picture tab
  (`panels/PictureTab.tsx`) holds five sections already: the picture and its
  frame strip, the day's pictures from the instance, framing, format, grade.
  The maintainer's *"trop chargée"* is measurable there.
- **Studio**: `ProjectDoc.lutStack` + `outputTransform` in the portable half;
  per-media state (`trims`) in the BOUND half, keyed by base name, guarded by
  the value it was set against, and re-keyed by `adoptRenames`
  (`reconcile.ts:109`) when a file is renamed. The inspector has five tabs
  (Overlay · Style · Grade · Info · Export), and the bottom bar's arithmetic on
  a 360 px phone was checked for exactly that many (`frontend.md`).
- The stage works to a **pixel budget** (`stage-size.ts`, one 4K frame),
  because a 48-megapixel still at its own density killed an iPhone's tab; the
  deliverables still compose from the source bitmap (`media-pipeline.md`).

### 2.5 The bridge

`hook-scene.ts` sends the badge into a project as a scene; it carries
**elements only**. The framing does not cross (said in the Picture tab), the
theme does not cross (`docs/roadtrip-export.md` §8, the maintainer's *"second
temps"*), and the grade is two grades that never double-apply and may
disagree, stated in `StudioLink`.

## 3. Findings

**F1 — the suite has a look engine and no correction engine.** Every
correction available today is a `.cube` somebody authored elsewhere. There is
no control that moves a picture's exposure by a stop, and `.cube` cannot carry
that as a slider.

**F2 — a DNG is unreadable in three places, by design and with the same
sentence.** Not a bug; the decoder was never chosen. The choice is the one
real dependency decision in this brief (§6).

**F3 — the Winnow path answers half of the RAW question already, and skips
the other half on purpose.** The proxy is developed on the server — a WebP a
browser draws, at a size that already exceeds a 1080×1920 post — which is why
a Winnow DNG *composes* today when a local DNG does not. But the proxy is 8-bit
and its highlights are gone; the capture is one `fetchOriginal` away and the
Studio deliberately does not take it for a photo (§2.3).

**F4 — the Picture tab is full.** Five sections in a 22 rem column; the tone
and colour sliders are nine more controls, plus the wipe, plus presets. Inline
they would be the sixteen-section accordion `docs/roadtrip-editor.md` retired.
The maintainer's instinct (a sheet) is the right one, and the measure agrees.

**F5 — a correction the stage paints has to reach six renderers, or the
preview stops being a preview.** Any adjustment that is not in the one cube
is one the PNG deck, the hook clip, the Studio JPEG or the video export will
silently lack. That is the same argument that put the output transform into
the bake rather than the shader, and it decides §4.

**F6 — an 8-bit picture has no headroom, and the panel must say so.** A JPEG
or a WebP clips at 255: "highlights −100" on it can only darken what
survived; only a RAW recovers what the sensor kept above white. A slider that
looks the same on both and does a different thing must state which it is
doing (the anti-fabrication rule the battery gauge and the palette hold).

**F7 — nothing about a picture's treatment crosses the bridge.** A develop
would be the third thing (after the framing and the theme) that a reel from
the linked project silently lacks. Diagnosed, not phased in with the rest —
the same standing as §8 of `docs/roadtrip-export.md`.

## 4. The decision the plan rests on

**A develop is a per-picture correction expressed as numbers, applied as the
FIRST stage of the one baked cube — and a RAW is developed into the picture
the cube then takes.** One record (`DevelopSettings`), two appliers, never a
second renderer:

- for any picture the browser decodes (JPEG, WebP proxy, the JPEG a DNG
  embeds), the numbers become a **lattice stage** in `composeLutStack`, before
  the LUT layers and before the output transform — so all six renderers get
  the correction for free, the preview IS the export, and the maths is pure and
  tested in node with no shader change at all (nothing for `check-shader.mjs`
  to miss);
- for a RAW, the **same numbers** are consumed by the RAW developer on the
  linear 16-bit buffer, where exposure and highlight recovery have the
  headroom to mean something; what comes out is an ordinary 8-bit
  `ImageBitmap`, and the lattice stage is then **skipped for that source** so
  the correction is never applied twice.

Three rules follow, and they are the ones to carry:

1. **Correction → look → delivery, in that order, always.** A develop is
   scene-referred and belongs to one picture; a grade is a look and belongs to
   the trip or the project; the output transform is delivery. The node order of
   every grading suite, and the reason the develop stage bakes *before* the
   layers.
2. **A correction is never inherited.** The crop rule (`PostBadge.framing`):
   one picture's exposure is not the next one's. Time is saved by
   **presets** and by **apply-to** verbs (§8), never by a default that
   silently lifts every new slide by a stop.
3. **One video pipeline, several entry points; never a second exporter** —
   the rule `docs/roadtrip-export.md` §4 fixed, unchanged. A develop adds no
   renderer; the sheet is a panel over the engine.

**Weighed and declined, with the reason, so they are not re-proposed:**

- *A shader stage for the sliders.* Live and cheap — and it would put every
  slider into `lut-gl.ts`, the one file no CI gate can see, and behind the
  shader's `mix` (the very placement `lut-stack.ts` explains is wrong at
  intensity 0). The bake costs ~28 ms per step at 33³, which the deferred
  bake already makes usable; if a heavier stack ever trails the thumb, the
  recorded next step is moving the bake off the render path, not a shader.
- *A hash-keyed sidecar store* (a develop that follows the picture across
  tools, Lightroom's XMP): a fourth IndexedDB database, and a develop that
  changes under a document from another tool is the framing-inheritance fault
  in a new coat. Storage stays document-owned (§5.3), and crossing the bridge
  is explicit (§7.7).
- *Writing `.xmp` sidecars beside the RAW.* The suite writes into the user's
  folders only on the export gesture (`write-files.ts`); a silent file beside
  every photograph is not local-first, it is untidy.

## 5. The model

### 5.1 The record

```ts
/** shared/develop/develop.ts — pure, DOM-free, tested. */
export interface DevelopSettings {
  /** Stops, −3..+3. A linear gain in scene light. */
  exposure: number;
  /** −100..100. A midtone lift (a gamma), not a gain — the maintainer's "luminosité",
      kept apart from exposure the way Capture One keeps them apart. */
  brightness: number;
  /** −100..100. An S-curve pivoting on 18 % grey. */
  contrast: number;
  /** −100..100 each. Four bands of the tone curve, weighted by luminance:
      whites/blacks move the end points, highlights/shadows the shoulders. */
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  /** −100..100. Warm/cool and green/magenta, as channel gains in linear light. On a
      RAW the developer maps them onto its own white balance; on an 8-bit picture
      they are what they are, and the panel says so. */
  temperature: number;
  tint: number;
  /** −100..100. */
  saturation: number;
  /** −100..100. Weighted by how UNsaturated a pixel already is — the maintainer's
      "brillance"; it is what protects skin. */
  vibrance: number;
}

export const DEFAULT_DEVELOP: DevelopSettings; // every field 0 — "as shot"
export function isDefaultDevelop(d: DevelopSettings): boolean;
/** Linear light in, linear light out, [0,∞) — the one function both appliers call. */
export function developLinear(rgb: [number, number, number], d: DevelopSettings): [number, number, number];
/** sRGB-encoded [0,1] in and out: decode → developLinear → clamp → encode. The lattice stage. */
export function developStage(d: DevelopSettings): (r: number, g: number, b: number) => [number, number, number];
/** One line for a panel: "+0.7 EV · highlights −40 · vibrance +15", or "As shot". */
export function describeDevelop(d: DevelopSettings): string;
```

Ranges are the ones every developer prints (a stop is a stop; the rest is
−100..100), so a number carried in the sentence means what the maintainer
expects it to. `sRGB ⇄ linear` is `transfer.ts`'s own pair — the exactly
invertible one — not a second copy.

**Tests that pin the maths** (beside the module): all-zero is the identity on
every lattice point; exposure +1 doubles linear light; every slider but
temperature and tint keeps a grey grey (the tetrahedral guarantee carried one
stage earlier); highlights leaves a mid-grey untouched and shadows leaves a
near-white untouched; contrast is monotone; the stage clamps to [0,1] and
never NaNs on 0 or 1.

### 5.2 The stage in the cube

`composeLutStack(layers, output, interpolation, develop?)` gains a fourth,
optional argument. A non-default develop **bypasses both shortcuts** exactly
as the output transform does — a single full-strength layer is no longer
returned as-is, and an empty stack still bakes a cube — and imposes the same
**floor of 33**: a tone curve is steepest near black, where a coarse lattice
bands. The develop is applied to the lattice point FIRST, then each layer's
mix, then the transfer. `title` gains a leading `Develop` so a composed cube
says what is in it.

`LutStack` (`use-lut-stack.ts`) gains `develop` / `setDevelop`, deferred like
its three other inputs; `composed` therefore already contains it and no
consumer changes. That sentence is the whole payoff of §4.

**The one trap, to record in memory the day it is built**: a source developed
at decode (a RAW, §6) must be graded through a cube composed WITHOUT the
develop, or the correction applies twice. `LutStack` therefore also exposes
`composedForDeveloped` (the same stack, develop omitted), and a renderer picks
by the source's `developedAtDecode` flag. Two cubes, one stack, one flag —
never a second stack.

### 5.3 Where it is stored

- **Trips** — `PostBadge.develop: DevelopSettings | null` and
  `PostSlide.develop: DevelopSettings | null`, **v15**, beside `framing` and
  for the same reason (about ONE photograph). `null` is *as shot* — the
  "empty means computed" rule, where computed is the identity, so a document
  that never opened the sheet stores nothing. **The migration block goes at
  the END of `migrateTripDoc`** (its blocks run in source order; a v15 block
  placed high writes onto a badge the v2 block has not built). `hookDefaultsFrom`
  leaves it out. The trip file: the field travels inside the posts, so
  `toTripFile` / `parseTripFile` / `tripDocFromFile` need nothing new — but
  `tripDocFromFile` spreads `createTripDoc`, so the spec that round-trips a
  develop through the file is what proves it (the trap that once dropped
  intros and once dropped pins).
- **Studio** — `ProjectMedia.develops: Record<baseName, SavedDevelop>` in the
  BOUND half, keyed like `trims` and, like a trim, carrying what it was set
  against — here the media `hash` when known, so a develop set on one file is
  not restored onto a same-named other. **`adoptRenames` re-keys it** with
  `activeId` and `trims` (the memory rule: *"anything else keyed by base name
  must join that function"*). Not in `.atelier.json` — a template is from no
  picture; the four-places rule does not apply and a spec asserts the file
  stays free of it. v15 there too.
- **Presets** — `TripDoc.developPresets: DevelopPreset[]` (`{ id, name,
  settings }`), **portable**: a preset is the trip's habit like its words, so
  it travels in `.roadtrip.json` and the four `trip-file.ts` places gain a
  field. The Studio keeps no presets in v1; copy/paste (§8) crosses tools with
  no storage.

### 5.4 What is NOT stored

The interpolation mode (a render preference, as today); the wipe position;
the sheet's open state; which preset was last applied (a preset is applied,
not followed — following would be inheritance).

## 6. The RAW path (DNG)

### 6.1 What the files are — assumptions to verify on the maintainer's own

Stated as assumptions because no DNG was read in writing this; the first task
of P5 is to drop one of each on the dev server and read its IFDs with the
parser the suite already has.

- A **DJI drone DNG** (Mini 4 Pro, 48 MP, 8064×6048): TIFF container, a CFA
  mosaic (`PhotometricInterpretation` 32803), 16-bit samples, uncompressed or
  lossless-JPEG (compression 7) tiles, a `ColorMatrix` + `AsShotNeutral`, and
  usually an embedded JPEG preview in IFD0 (`NewSubfileType` 1) — often
  full-size, sometimes 1024 px.
- An **iPhone ProRAW DNG**: already demosaiced (`LinearRaw`, 34892), 12-bit,
  and its tiles are either lossless-JPEG (compression 7) or **JPEG XL**
  (compression 52546, DNG 1.7). Apple's documentation puts the JPEG XL
  options (*JPEG-XL Lossless* / *JPEG-XL Lossy*) on the iPhone 16 Pro and
  later, and a 15 Pro's own Camera writes lossless JPEG — but **the
  maintainer says JPEG XL ProRAW files ARE in his library (2026-09-13)**, so
  whether they came from the phone's Camera, a third-party camera app or a
  later export, the format has to be handled and the spike's very first step
  is to read tag 259 on each of his files rather than trust a model number.
  It also carries **opcode lists** (a gain map for lens shading) that a naive
  decoder skips, and the picture then vignettes.

### 6.2 The three ways to decode, and the recommendation

| Option | What it is | For | Against |
| --- | --- | --- | --- |
| **(a) LibRaw in wasm** — `libraw-wasm` on npm (Emscripten build of LibRaw, runs in a Web Worker, 8- or 16-bit RGB out, raw sensor data out, DNG among its formats) | The reference developer every desktop tool wraps | Handles both cameras, the colour matrices, the opcodes; one dependency; nothing to write | Bundle weight (a few MB — **must** be a dynamic import, the MapLibre rule, never in the main bundle); LGPL/CDDL (a wasm module is dynamically linked — fine, but the README's licence line must say it); the wrapper is young and largely machine-written; **JPEG XL tiles need LibRaw 0.22 built WITH Adobe's DNG SDK 1.7** (LibRaw reads them through the SDK, not libjxl), and the npm build's README says only that it rejects "a compression format this build can't decode" — so a JPEG XL ProRAW most likely means a wasm build of our own (LibRaw + DNG SDK under Emscripten), which is a build to maintain, not a dependency to install |
| **(b) A DNG decoder of our own** — TIFF walk (have it) + lossless JPEG (`ljpeg92`, ~300 lines) + bilinear demosaic + `ColorMatrix`/`AsShotNeutral` → sRGB | Nothing fetched, DNG only, pure and hand-testable (the EXIF parser's own tradition: a hand-built binary in the spec); a ProRAW is `LinearRaw`, so it needs no demosaic at all | ~1 000 lines to own; no opcodes (ProRAW vignettes); **JPEG XL tiles need a libjxl wasm that returns 16-bit** — `@jsquash/jxl` exists but hands back 8-bit `ImageData`, so it would be a custom libjxl build, the same class of cost as (a)'s; a wrong colour matrix reads as a broken tool |
| **(c) Winnow develops** — a 16-bit linear rendition served by the instance | The right shape for a phone (a 48 MP RAW is 288 MB of 16-bit RGB; a tab does not have it) | Only for instance media; 150–290 MB through a tunnel per picture; work on the other repo; and a local DNG still needs (a) or (b) |

**Recommendation: (a), gated on one spike** — read tag 259 (compression) and
the opcode lists off one DNG of each kind he really has (DJI, ProRAW lossless
JPEG, ProRAW JPEG XL), decode each with the npm build in the container,
compare the result against the file's own embedded preview, and measure
decode time and heap at half size and full size. **The JPEG XL file is what
decides**: if the npm build refuses it, the choice is between a LibRaw + DNG
SDK wasm build of our own (everything, one toolchain to keep) and (b) with a
16-bit libjxl module (DNG only, ours line by line) — and a JPEG XL ProRAW
keeps its embedded JPEG preview as its picture (P5) until that decoder lands,
said in the chip rather than hidden. Either sits behind **one seam**,
`shared/develop/raw-decoder.ts`:

```ts
export interface RawDecode {
  width: number; height: number;
  /** Linear light, sRGB primaries, camera white balance applied, 0..1 with headroom above 1 kept. */
  data: Float32Array;            // or Uint16Array at 1/65535, decided by the spike's heap numbers
  /** For the panel: what the decoder did, in words. */
  via: 'libraw' | 'dng';
}
export function decodeRaw(file: File, opts: { maxLongEdge: number; signal?: AbortSignal }): Promise<RawDecode>;
```

(c) is not rejected; it is *later*, and the seam is what makes it a second
implementation of `decodeRaw` for a `MediaOrigin` that offers it.

### 6.3 Rules the RAW path must keep

- **Opt-in, per file, off by default**, the transcode's own pattern: a RAW
  shows its embedded JPEG preview (labelled *preview*) until the author asks
  to develop it; the decoder is fetched on that click — from our own
  deployment, since the wasm ships in `dist/` (better than ffmpeg's `unpkg`
  fetch; the network callout in the README gains nothing).
- **Decode to a budget, never to the file's density.** The stage lesson
  (`media-pipeline.md`) one step earlier: a preview decode at the stage budget
  (LibRaw's half-size mode gives 4032×3024 from a 48 MP file, which already
  exceeds every Trips deliverable at 1920), and the delivery decode at the
  **smallest size that still exceeds the variant** — a full 48 MP decode only
  for a Studio variant that asks for the source size, and that one is
  desktop-only until measured on his iPhone.
- **The develop runs on the CPU, in the worker, on the linear buffer** —
  `developLinear` over the pixels, then encode to 8-bit sRGB, then
  `createImageBitmap`. Live sliders run it on the preview decode (a few
  megapixels: measure; the deferred-value pattern applies); the export runs
  it once on the delivery decode. A GPU develop (a float texture through a
  shader) is the recorded next step if the preview trails — and it would touch
  `lut-gl.ts`, so it waits for a measured reason.
- **What comes out is an ordinary `ImageBitmap`** flagged `developedAtDecode`;
  everything after it — grade, framing, badge, export — is untouched.
- **A Winnow DNG takes the original path** — `fetchOriginal` for a photo, the
  proxy for scrubbing — which reverses `StudioEditor.tsx:1094`'s note and its
  memory entry, for the reason it gave. The "render from the proxy" checkbox
  keeps meaning what it means.
- **The bitmap lifetime rule stands** (`studio.md`): release the superseded
  one in an effect keyed on the picture, never where the new one is decoded.

## 7. The screens

### 7.1 The Develop sheet — one component, every host

`shared/develop/DevelopSheet.tsx`, a modal: `position: fixed`, outside any
`@container` wrapper (containment breaks `fixed`), full-screen under 820 px in
`--app-h` (never `dvh`), 16 px controls, Escape and Enter through
`use-dialog-keys`. It takes a source, a `LutStack` and a `DevelopSettings`,
and returns settings on **Done**; Cancel restores what it opened on.

**Wide**: the picture on the left at the stage budget, the column on the
right at 22 rem. **Phone**: the picture as an aspect box at the top (it hugs
its picture and hands the slack back, `frontend.md`), the column scrolling
under it — one pane, no stack in a fixed height.

The picture: the same grader every stage keeps (one WebGL2 context keyed on
cube + source size, caller-owned), painting through `composed` — so what the
sheet shows is develop → grade → output, i.e. exactly what the piece will
deliver, and the A/B wipe the shader already has (`u_split`) is the
before/after: a drag on the divider, and **press-and-hold on the picture shows
"before"** (the gesture every developer has). A RAW shows its preview with a
`preview` chip and a *Develop this RAW* button until decoded, then a `RAW ·
16-bit` chip; an 8-bit picture wears `JPEG` / `proxy · 2048 px` so F6 is
answered where the eye is.

The column, top to bottom — the pipeline's own order:

| Section | Controls | Notes |
| --- | --- | --- |
| header | file name · fidelity chip · `As shot` (reset all) | the chip is where "your highlights are already gone" is said, in a sentence behind ⓘ |
| **Light** | exposure · brightness · contrast | exposure in stops, the others −100..100 |
| **Tone** | highlights · shadows · whites · blacks | |
| **Colour** | temperature · tint · saturation · vibrance | |
| **Look** | the existing `GradePanel`, bound to the same stack (on Trips with its trip/piece scope chips) | so a look and a correction are set in one place — the LUT-on-photos ask, answered by the panel that already exists |
| **Presets** | a row of chips · `Save current as…` · `×` on a chip | §8 |
| **Apply to…** | the batch verbs the host offers | §8; a host that offers none draws nothing |
| footer | `Cancel` · `Done` | Enter is Done |

Every slider: the value in the mono face beside its label, double-click (and
a `↺`) back to 0, arrow keys step, Shift steps ten. A slider commits on every
change — watching the picture while dialling IS the interaction, the reason
commit-on-release was rejected for the LUT strength.

**Instrumentation.** One luminance histogram under the picture, with clipped
highlights and crushed blacks as two thin marks — the one instrument the four
tone sliders cannot be set without. It is not the retired Scopes tool
(waveform, vectorscope, parade over a clip); it is a strip of 256 bars over
the picture in hand. Listed in §11 as a choice, because the retirement was
explicit.

### 7.2 From Trips — the Picture tab gains one settled row

Between *Framing* and *Format*, a **Develop** section: one line, the sentence
`describeDevelop` prints (`As shot`, or `+0.7 EV · highlights −40 · vibrance
+15`), a `Develop…` button and a `↺` when it is not default. It shows for
whichever slide is open and edits THAT slide's field — the medium/duration
rule read again: about the slide, never inside the hook-only branch. The
closing card offers none (no photograph).

On Done, `patchBadge({ develop })` / `patchSlide({ develop })`; the stage
repaints because `use-trip-grade.ts`'s stack now carries the slide's develop
and `composed` changed — **the same path the grade takes**, and the reason no
"here is the final image" hand-back exists: the picture in the editor IS the
render. The rail's cells follow for free (`use-rail-thumbs.ts` keys its
signature on the render options; the develop joins the signature).

The `GradePanel` on the Picture tab stays where it is; the sheet shows the
same panel bound to the same stack, so neither is a copy.

### 7.3 From the Studio — the Grade tab, top row

No sixth tab. The Grade tab gains the same settled row at its TOP (correction
before look, on screen as in the cube), opening the same sheet over the active
media. It works over a **clip too**: the stage and `export-variant.ts` take the
composed cube per frame, so exposure and contrast on footage cost nothing —
the develop of a clip is keyed by its base name like its trim. Stored in
`media.develops` (§5.3).

### 7.4 From the Library's lightbox — not in v1, and why

The sheet that shows a picture large belongs to the shell; a tool publishes
verbs for it (`MediaActions`). Only `TripOverview` publishes, and it has no
document to write a develop to (a post is what holds one); `PostEditor`
deliberately publishes nothing. So a *Develop* verb there would be a
correction with nowhere to land. When a standalone home exists (§7.5) it is
the publisher, and the verb costs one entry.

### 7.5 Standalone — the Studio already is one

The maintainer allowed a ninth tool. Recommended: **do not add one.** The
Studio is a photo editor with a gallery, persistence on local or a Winnow,
the grade, the export matrix and the finals write-back; `studio.md` records
why a separate photo studio was rejected in August — *"it would have
duplicated the gallery, the persistence, the style cascade and the export
panel to change one draw call"*. A `#/develop` route over the Library's active
asset would have no document, so its numbers would evaporate on reload, which
is the wrong shape for a tool whose point is keeping settings. What the Studio
lacks for "develop a whole day" is the batch, and §8 puts it in the sheet,
where both tools reach it.

If he wants a standalone anyway, the cheap honest one is a **Studio project
kind that opens straight on the sheet** — one entry in `NewProjectModal`, no
registry change.

### 7.6 What the sheet returns, and what it can deliver

**Returns**: the settings, written to the host's document; the picture, by
construction, on every renderer. **Delivers, on request** (the Export section
is optional and host-independent): a developed JPEG at the source's size or a
chosen long edge — through `exportPhotoVariant` with an empty deck, so the
Studio's own still export is the code path — to a download or the chosen
folder (`pick-export-path.ts`); and, for a picture that came from a Winnow,
**Send home as an edit** through the finals machinery, `original_asset_id`
alongside so the instance links it (`has_edit`). The second is a write to the
user's own server and follows every rule the finals set: one click, never
automatic, refused up front on a viewer role or over the upload limit, said in
the README.

### 7.7 The bridge

`withHook` gains the hook's develop, written into the project's
`media.develops` under the hook media's base name — so a reel from the linked
project wears the correction the badge was composed over. Phased **with the
theme loss** (`docs/roadtrip-export.md` §8, the maintainer's second step),
because both are "the bridge sends the elements and nothing about the
picture", and one panel sentence should list what crosses and what does not.

## 8. Time: presets and apply-to

*"Le but du jeu pour moi est de gagner du temps"* — and the other reading of
*lot* is a batch. Four moves, cheapest first:

1. **The grade already is the batch for looks.** The trip's LUT stack dresses
   every piece that has none of its own. Nothing to build; say it in the sheet.
2. **Copy / paste settings** — two buttons in the header, a module-level
   clipboard in session state (never stored). Crosses Trips ↔ Studio with
   zero storage, and it is how "the same correction on the next picture"
   costs two clicks.
3. **Presets on the trip** (§5.3): chips in the sheet, `Save current as…`,
   applied by a click — applied, never followed, so a preset edited later
   changes no piece. Recommendation for names: the author's own; no factory
   set (a fabricated "Punchy" preset is an invented example).
4. **Apply to…** — verbs the HOST offers, drawn by the sheet: on Trips, *the
   other slides of this piece* and *the other pieces of this day*; in the
   Studio, *every photo of this project*. Each verb names its count
   (*"Apply to 3 other pieces"*) and writes the same settings into each
   target's own field — a copy, not a reference, the never-inherit rule.
   Batch across a whole trip is deliberately not offered: a correction is
   about a picture, and a day is the largest set one light is likely to hold.

## 9. Phases (one commit each)

Sized in commits and passes, not days — the scarce resource is the
maintainer's instruction and review.

### P1 — the engine, no UI — **BUILT**

`shared/develop/develop.ts` + spec; the fourth argument of
`composeLutStack` + specs (identity when default, floor 33, order develop →
layers → transfer, `title`); `LutStack.develop` / `setDevelop` /
`composedForDeveloped`. Nothing on screen changes. Verified by tests alone —
this is the commit whose maths every later one trusts. Measured at 33³: a
develop bake is 24 ms alone, 39 ms with a transform — the class the deferred
bake already carries. One rule learnt building it, recorded in
`media-pipeline.md`: an untouched pixel must come back bit-identical, so the
luminance ratio is skipped when the curve did not move the value.

### P2 — Trips: v15, the sheet, the Picture tab row — **BUILT**

`PostBadge.develop`, `PostSlide.develop`, `developPresets`, the migration at
the END of `migrateTripDoc`, `trip-file.ts`'s four places, `hookDefaultsFrom`
leaving it out; `DevelopSheet` with Light · Tone · Colour · Look · footer (no
presets, no apply-to yet); the settled row; the develop in the rail's
signature. What the build added to the plan: **`LutStack.composeWith(develop)`**,
a memoised per-slide bake, because one cube for the deck would grade a
corrected hook's neighbours too — the stage, the rail, the PNG deck and both
hook videos each take their slide's own cube, while the sheet's draft rides
`stack.develop`. Verified in headless Chromium on the dev server (a dropped
JPEG, a Single-photo piece): 0 px overflow at 1280 and 390 with the sheet
open, a slider moves the sheet's pixel, Done writes the row and re-grades the
stage and the rail, Escape closes. Not driven by the probe: the wipe gesture,
the hold chip, and the PNG/hook exports (no H.264 here).

### P3 — Studio: `media.develops`, `adoptRenames`, the Grade tab row — **BUILT**

v15 on `ProjectDoc`; `shared/projects/media-develop.ts` (`saveDevelop` /
`restoreDevelop`, the hash guard, pure and tested); the sheet over a photo
AND a clip (a clip opens on the playhead's frame); the `.atelier.json` spec
asserting the field stays out; a rename absorbed with its develop; the wire
carrying it with the trims. Five call sites moved from `lutStack.composed` to
`lutStack.composeWith(activeDevelop)` — the stage, the still export, the
video export, the seek fallback, the frame grab — so `composed` is the
sheet's cube alone. Verified by the specs and the four gates; the JPEG export
and a video variant carrying the correction ride the same `lut` the stage
paints from, and the encode itself is the maintainer's machine's to confirm.

### P4 — presets, copy/paste, apply-to — **BUILT**

The Presets and Apply-to sections; the host verbs on Trips and in the Studio;
the counts in the labels. Built as planned, with three things the build fixed:
the clipboard is module state shaped for `useSyncExternalStore`
(`shared/develop/develop-clipboard.ts`), never persisted; the batch helpers are
pure (`shared/roadtrip/develop-apply.ts`: `applyDevelopToPost` skipping the
open slide, `applyDevelopToDay` over the other posts of the same date,
`savePreset` replacing a taken name in place, `removePreset`); and a verb
writes on its CLICK, not on Done — Done goes through `onChangePost` and a day
batch through `onChangeTrip`, and the two in one tick would clobber each
other in `RoadTripTool.updatePost`. The Studio's one verb is *Apply to N other
media*, each written under its own hash. Verified in headless Chromium (see
`roadtrip.md` and `studio.md`): "Apply to 2 other slides" wrote two copies,
the day batch wrote three onto the other piece and none onto the open one,
removing a preset changed no row, and Paste carried the numbers into a second
piece.

### P5 — the RAW spike, and the preview a DNG already carries

Read the two cameras' DNGs with `exif-parser.ts` (IFDs, compression, preview
size — answering §6.1); show the embedded JPEG as the RAW's picture with a
`preview` chip in all three places that say "no browser decodes this" (a
gain on its own: a DNG composes today); run `libraw-wasm` on both files in the
container and record decode time, heap, and a side-by-side against the
preview. **Decision point for §6.2.** Real DNGs stay in the scratchpad —
never in the repo (his pictures, and 60 MB each); the spec fixture is a
hand-built tiny DNG, the EXIF parser's tradition.

### P6 — the RAW develop

`raw-decoder.ts` behind the chosen decoder, dynamically imported, in a worker,
opt-in per file; decode to the stage budget; `developLinear` on the buffer;
`developedAtDecode` and `composedForDeveloped`; the delivery decode at the
smallest sufficient size; a photo's `fetchOriginal` taken on export (reversing
the `StudioEditor.tsx:1094` note and its memory entry). Verified: a DNG with
`highlights −80` recovers sky the JPEG twin cannot; the same develop applied
to the twin says so in the chip; heap measured at half and full size, and the
phone verdict recorded.

### P7 — deliver: a developed JPEG, and home to Winnow as an edit

The Export section of the sheet; `exportPhotoVariant` with an empty deck;
`finals.ts` reused with the picture's `assetId`; README (Trips, Studio,
Sources, the network callout's write sentence).

### P8 — the bridge carries the develop

With the theme (`roadtrip-export.md` §8): `withHook` writes
`media.develops`, `StudioLink` lists what crosses.

## 10. Verification, and what the container cannot do

- The four gates per commit; `node scripts/check-shader.mjs` only if
  `lut-gl.ts` is touched, which P1–P5 do not (a design merit, worth keeping).
- The preview = export invariant is checked by rendering the same slide
  through the stage and through `badgeToPng` / `exportPhotoVariant` and
  comparing a handful of pixels — no encoder needed.
- Sheet layout at 390 × 844, 834 × 1112 and 1280 × 900 in headless Chromium
  driving the dev server (the recipe in `testing.md`); the RAW decode runs
  there too (wasm, no GPU needed), but **the phone verdict on heap is his
  iPhone's**, as with the 48 MP still.
- H.264 remains unencodable in the container; a hook video with a develop is
  verified through `render-video.test.ts`'s stub and on his machine.

## 11. Decisions for the maintainer

Settled by the brief, to confirm:

1. **A sheet, opened from the Picture tab and from the Grade tab** — his own
   call (*"un overlay ou une modale"*), measured right (F4).
2. **No ninth tool**: the Studio is the standalone; a project kind opening on
   the sheet if a front door is wanted (§7.5).
3. **The parameter set** of §5.1 — in particular that *brillance* is
   vibrance, *darks* is blacks, and that temperature/tint join the list
   (a RAW without white balance is not developed).

Open, and they gate a phase:

4. **The decoder** (§6.2): **decided 2026-09-13 — `libraw-wasm`.** The P5
   spike still runs, on his own files, and must include a JPEG XL ProRAW: a
   refusal by the npm build turns this into "which wasm build do we
   maintain" (§6.2), which comes back to him as a question then.
5. **The histogram** (§7.1) — one strip with two clip marks, or nothing,
   given that Scopes was retired.
6. **Whether a developed picture goes home to Winnow as an edit** (§7.6) — a
   write to his own server, so a product call like the finals were.
7. **When the bridge carries it** (§7.7) — with the theme, or now.
