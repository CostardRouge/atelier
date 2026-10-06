# Develop — what an export writes: targets, sizes, output sharpening

Read before touching `shared/develop/export-targets.ts`, `output-sharpen.ts`,
the `targets` of `RollExport`, `deliverOne` in `roll-render.ts`, the
sub-folders of `deliver-files.ts` or `ExportTargets.tsx`. Which PICTURES leave
and what their METADATA says are `develop-roll.md`; which PIXELS a picture
leaves from is `renditions-build.md`. Pass 4 of `docs/lightroom-gaps.md`.

## An export writes to TARGETS (2026-09-23, audit item 28)

`RollExport.targets` (roll **v6**): one to `MAX_TARGETS` = 4, each a size, a
quality and a screen sharpening. v5's `longEdge` + `quality` ARE the first
target (`readTargets(raw.targets, legacy)`), so an old roll exports as it did.

- **The file's name never changes.** He pairs a source folder and a Gallery
  folder by name, so a second target cannot suffix the file: the FIRST target
  writes into the folder chosen at the click, each other one into a
  SUB-FOLDER named after it (`Web/DJI_0101.jpg`, `targetFolder` makes the name
  safe). Only a download cannot make a folder: there the target's name is a
  prefix (`Web-DJI_0101.jpg`). `deliverFilesTo` takes `FolderedFile`s and
  reports a sub-folder's failures as `Web/name`, so the export marks — keyed
  on what landed in the chosen folder — never count them.
- **One render, every target.** `renderRollPicture` decodes and grades ONCE;
  `deliver` loops `deliverOne` (cut, resize, sharpen, encode, stamp) per
  target, HDR included. A RAW decode is sized for the targets only when all
  ask a `long` edge (`decodeEdgeFor`); any other mode decodes whole. Whether
  the ORIGINAL is fetched is asked of the LARGEST target (`largestSize`),
  since every target is cut from the one render; the *Delivers* line and
  *This picture* speak of the FIRST (the folder itself).
- **A size is a CAP read against the picture's own delivered frame**
  (`longEdgeFor`): short edge × the frame's ratio, √(MP × ratio), or a share
  of the long edge — never above it. `deliverySummary` takes `size` and
  resolves it against EACH source it weighs (`capFor`), because a short edge
  is a different long edge on the proxy and on the original.
- **Screen sharpening is the TARGET's, after the resize** (`output-sharpen.ts`):
  a 3×3 binomial unsharp on luma, the delta added to R, G, B alike (no
  fringe), a soft threshold of 2 codes so a flat sky's noise stays; levels
  0.4 / 0.8 / 1.3. It runs in BANDS of 256 rows read with one row either side,
  so a 60 MP file never holds a second copy. **The walk is IN PLACE, and that
  is its trap** (fixed 2026-09-28): a band is written back before the next is
  read, so the row above band N is already sharpened on the canvas — reading
  it from there put a one-row seam every 256 rows of every sharpened export.
  `sharpenBands` carries the ORIGINAL last row of each band over (one row of
  memory); the row below is never written yet. The spec drives that walk
  itself over a buffer with bands of 1–256 rows and asserts it byte-identical
  to the whole picture — a spec of `sharpenRows` alone over original rows
  proved nothing about the loop. The native Swift port reads the original row.
  The HDR rendition's darker canvas is sharpened the same, or the gain map
  would disagree at every edge. The picture's own sharpen (`detail.ts`) is
  judged at the picture's density and cannot know the size a target asks.
- **A size is typed and COMMITTED on blur or Enter** (`SizeValue`): clamped
  per keystroke, "2048" passes through 2, 20, 204 and is pushed to the minimum.
- **Presets are starting points**, not references: Full size, Web · 2048 px,
  Feed · 1080 px across, Mail · 2 MP, Half · 50 %. A target made from one is
  the roll's own. Personal export presets across rolls are not built (the
  preset book would be their home).

## Everything an export writes is sRGB, and a P3 source is CLIPPED (2026-09-23, measured)

Not a choice anyone made: the grader uploads with WebGL's default
`unpackColorSpace = 'srgb'` into an sRGB buffer, the delivered canvas is a
default 2D canvas, and LibRaw is asked for sRGB. Measured: a Display P3 red
decodes as `254,0,0` in P3 and leaves the grader as `234,51,35` — sRGB red.
The browser itself would carry P3 (canvas, JPEG profile, `ImageBitmap`,
WebGL2's colour-space attributes all work here). Wide gamut is item 25 and a
WORKING-SPACE decision — a Rec.709 `.cube` fed P3 values shifts every colour —
briefed in `docs/lightroom-gaps.md` §11 and waiting on him. Until then, do not
"fix" one of the three places alone: a P3 buffer under an sRGB canvas, or a
P3 upload into Rec.709 maths, changes colours without widening anything.

## A watermark is the roll's STYLE, drawn on the targets that ask (2026-09-23)

`watermark.ts`, `RollExport.watermark` (additive, absent = default),
`ExportTarget.watermark` (a switch per target — the web copy signed, the
archive clean). The line is a TEMPLATE over what the files are already signed
with: `{creator}` (the identity on the preset book), `{year}` (the CAPTURE's,
`captureYear` on the original's EXIF head, as the copyright reads it),
`{title}` (the picture's). **A line that names `{creator}` while no name is
set is not drawn** — "© 2025" alone signs nothing, `resolveRights`' rule —
and the run says which pictures left unmarked. Size is a % of the file's
SHORT side, so every target carries the same mark; drawn AFTER the screen
sharpening (a mark is not detail) and on BOTH halves of an Ultra HDR file, so
the gain map is flat under it. A soft shadow of the opposite tone keeps it
readable over sky and coat alike. Driven headless: with a creator set and the
switch on the Web target only, the Web file's corner peaked at 240 over a
170 grey and the main file's stayed 170; the panel read `© 2026 Steeve
Pommier` (a PNG with no EXIF falls back to this year).

Driven headless: a v5 roll (`longEdge: 1200`) read as its one target; the
first set to 50 % and a Feed target added from the menu; one export
downloaded `edge.jpg` 1500×1000 and `Feed-edge.jpg` 1620×1080, the second's
edge 90 | 75 · 185 | 170 against the first's 91 · 169; the roll stored v6.

## A 16-bit PNG target, cut in float off the chain's own buffers (2026-10-05)

**Decision** (the fidelity audit's piste 6, his «fais les autres pistes»;
TIFF stays his NO of 2026-09-23): `ExportTarget.format: 'jpeg' | 'png16'`
(additive — `readTarget` reads an absent format as a JPEG and forces
`sharpen: 'off'` on a PNG, `exportName(ref, format)` → `.png`, the *Master ·
16-bit PNG* preset). **Where the bits come from**: `RenderGraph.readHalf`
(`graph.ts`) draws the chain WHOLE with its last pass turned onto a target
and reads that target back in row bands as RGB half-floats — what the GPU
hands back is its own choice (`IMPLEMENTATION_COLOR_READ_TYPE`: half-floats
taken as they are, floats converted) — undithered by construction (the
dither is the canvas write's), null on a `byte` chain; exposed as
`GraphGrader.renderHalf` and `PassGrader.renderHalf`, so `roll-render.ts`
asks the one grader it already holds, AFTER the 8-bit render (a read-back
redraws the chain). **The frame in float** is `deliver-half.ts` (pure,
tested): `resampleHalfInto` asks `unframePoint` where every output pixel
came from and reads the half picture bilinearly, supersampled k × k when the
output is smaller than the source (a downscale averages, never skips), a
tap off the picture the black of a `contain` framing's bars; samples stay
ENCODED like the canvas path's resample. The border is painted by
`drawDelivered` on a canvas with a blank picture (a blur border from the
8-bit graded render, as the thumbnail is) and widened ×257; the watermark
drawn on a cleared canvas and laid over by its alpha. **The file** is
`png-write.ts` (pure, round-tripped through `png-read.ts` in node): 16-bit
RGB, Paeth per row, `CompressionStream('deflate')`, chunks `iCCP` (the sRGB
profile), `eXIf` (the very TIFF block `exif-block.ts` makes — a PNG's chunk
holds it without `Exif\0\0`), `iTXt` `XML:com.adobe.xmp`; the run hands the
render `exifFor(delivered)` beside `stamp`, so a PNG and a JPEG of one
picture carry one block. **Refusals, said**: a constrained device never
reads a picture back (8 B/px whole: a 48 MP still is 384 MB) — the target's
JPEG leaves and `RollOutput.note` is a failure line; a GPU that refuses the
read-back the same. No gain map on a PNG. **Driven headless**: a JPEG
dropped on a roll with two targets (PNG 16, then a Web JPEG at 0.95),
exposure +0.5 through the slider, the run into OPFS: `IMG_0001.png` beside
`Web/IMG_0001.jpg`, 16-bit, chunks in order, signed, 96 % of samples off any
8-bit code, mean 0.65 code from the JPEG (its own compression); the gate row
in `check-render.mjs`: the read-back within 0.5 code of the undithered
canvas, a half source round-tripped exactly, headroom above white kept.
Not seen: a file opened in Lightroom or Photoshop (the eXIf chunk is read by
both since 2017; XMP in iTXt by every Adobe reader).


## A JPEG target says the COLOUR it keeps, measured (2026-10-06)

**Fact, measured in Chromium**: `canvas.toBlob('image/jpeg', q)` writes
**4:2:0** (a quarter of the colour) for every q < 1 — 0.99 included — and
**4:4:4** at exactly 1; there is no way to ask for 4:4:4 at 95. That, with
q 0.92, is most of his «nuances pixelisées» and of the files' lightness
against Lightroom (libjpeg on a 32.7 MP picture: q92 4:2:0 10.2 MB, q95 4:4:4
17.7 MB, q100 4:4:4 44.2 MB). Safari's encoder is unmeasured. **Decision**:
the panel never ASSUMES Chrome — `shared/media/browser-jpeg.ts` writes a
16 × 16 colour canvas at the quality and reads the sampling off the frame
header (`jpeg-chroma.ts`, pure), memoised per hundredth; `fullColourFrom()`
bisects 0.50–1.00. The quality row says `4:2:0 · a quarter of the colour on
this browser — full colour from 100 %`, a **Max** button beside the slider
sets 1 (always drawn, `aria-pressed` at 1 — a toolbar never inserts a
control), and the **Max · quality 100** preset is a full-size target at 1.
The Export tab's *Encoder* line and the settings sheet's *Encoder* section
read the same probe. **How to apply**: a claim about what an encoder writes
is measured on the browser in hand; MozJPEG (next) will be an engine beside
this one, not a replacement — its section rows go in `DevelopSettingsSheet`.
**Rev. 2026-10-06 (the polish pass)**: the fact is said ONCE in the tab — the
quality row's line says the state at THIS quality and where full colour starts
(`4:2:0 · a quarter of the colour — full from 100 %`; at 100 `4:4:4 · full
colour — several times the weight of 92 %`; `never full on this browser` where
it is), the *Encoder* line names the engine alone. Every target reads *Into ·
Size · Format · Quality · Sharpen · Watermark* through `FieldRow`: the first's
*Into* is a muted `Readout` («the folder you choose»), the others' the
sub-folder field, a `/` and a ghost trash; a clash is the row's hint in
danger. A target is ADDED from an `OverflowMenu` of the presets (*Add a
target*, a ghost verb with a chevron) — the `<select>` whose value was always
«Add a target…» was a control that lies (`frontend.md`).

## A reduced target is cut from the FLOAT picture, rounded once (2026-10-06)

**Decision** (step 3 of his settings plan, «une seule arrondi au lieu de
deux»): a JPEG target with a size, on a device that is not constrained and
outside an HDR delivery (`cutsFromFloat` in `roll-render.ts`), is resampled
from `renderHalf`'s float picture into the crop's rectangle by the 16-bit
PNG's own cut (`resampleHalfInto`, border painted first by `drawDelivered`
with a blank picture, a blur border from the 8-bit render), then brought to
8 bits ONCE by `bytesFromCodes16` — the GPU's dither pattern on the CPU, at
quality ≥ 0.9 only (`DITHER_MIN_QUALITY`: under it a JPEG erases the dither,
measured). Sharpening, watermark and stamp follow on the canvas as before.
**Measured headless** on 24 flat grey bands lifted by +0.13 EV between two
codes (2400 → 600 px): the reduced file's band means sit within 0.04 code of
the full-size dithered file (RMS 0.013) against 0.24 (RMS 0.13) the old way;
with the dither off it is plain rounding, as asked. A crop at 4:5, zoom 1.4,
7° rotation, a flip and a white border land in the same place on both paths
(mean 0.41 code apart; the 0.26 % above 24 codes are hard edges, the box
supersample against Chrome's canvas filter). **Cost**: one more pass of the
chain read back whole (8 B/px) — on SwiftShader 2.9 → 6.9 s for 3.8 MP, much
less on a real GPU; the reason a phone keeps the old path. **How to apply**:
a cut that changes size goes through float before its rounding; a new
consumer of `deliverOne` passes the half or accepts the second rounding.
