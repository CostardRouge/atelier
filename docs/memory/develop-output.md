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

Driven headless: a v5 roll (`longEdge: 1200`) read as its one target; the
first set to 50 % and a Feed target added from the menu; one export
downloaded `edge.jpg` 1500×1000 and `Feed-edge.jpg` 1620×1080, the second's
edge 90 | 75 · 185 | 170 against the first's 91 · 169; the roll stored v6.
