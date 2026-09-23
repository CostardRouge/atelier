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
  0.4 / 0.8 / 1.3. It runs in BANDS of 256 rows read with one row either side
  — a spec holds band = whole — so a 60 MP file never holds a second copy.
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
