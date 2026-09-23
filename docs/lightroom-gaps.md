# What stands between Develop and leaving Lightroom / Capture One

The maintainer, 2026-09-23, right after the roll's look turned out to dress every
picture (fixed in roll v5): *"le but du jeu, c'est que j'arrête de me servir de
ces outils externes et que je commence à me servir de mon outil"* — find what
was forgotten, what is obvious, and what is missing.

This is an **audit, not a set of decisions**. §1 and §2 are verified in the code
(file:line as of `b35c744`); §3–§5 are an inventory against Lightroom Classic's
Develop/Library and Capture One, each item checked for existence, not guessed;
§6 is a proposed order in commits; §7 is what is his to decide. What the suite
does that neither does (film emulsion + halation, stacked `.cube` looks and
packs, Ultra HDR, the capture's renditions, DNG GainMap/warp, borders) is not
repeated here.

## 1. Bugs — the stage and the file disagree, or data is shared by accident

1. **A subject mask is not in the exported file.** `roll-render.ts:204,269,299`
   call `layerPasses(stack, ar)` with no `rasters`; `layer-render.ts:45-53`
   says a subject layer without its raster "draws NOTHING". Only the stage runs
   `use-subject-masks.ts`. The picture on screen has the local adjustment, the
   JPEG does not. `render-layers.md` ("the rasters reaching every renderer") is
   wrong for the export. Fix: segment in the run (same model, same points) and
   hand the rasters to `renderRollPicture`. M.
2. **Importing one `.roll.json` twice makes two rolls share picture ids.**
   `rollDocFromFile` (`roll-file.ts:122`) clones `pictures` with their ids;
   thumbnails and working previews are keyed by picture id alone, so the two
   rolls overwrite each other's cells and deleting one deletes the other's.
   Fix: fresh ids on import. S.

## 2. Consistency gaps — the same class as the look

3. **Three answers to "is this picture edited?"** — the filmstrip dot
   (`Filmstrip.tsx:104`: develop or framing), `rollProgress` (develop, look,
   framing, aspect, border) and the remove confirm (`RollEditor.tsx`: develop,
   look, framing). An hour of heal spots or masks is removed without asking and
   the strip calls it as shot. One `isEdited(picture)` over every field. S.
4. **Copy/paste carries the develop only** (`develop-clipboard.ts`). Look,
   crop, lens, keystone, detail, repair, layers: never. Lightroom's ⌘⇧C is a
   dialog of sections. M.
5. **Batch verbs exist for four of nine groups** — develop, look, crop,
   border. Lens, keystone and detail are exactly what is shared across a roll
   (one body, one lens, one sensor) and cannot be synced; the Crop tab's
   "Apply crop" leaves the keystone beside it behind. The sections picker of
   item 4 is the one fix for both. S per group, or one M.
6. **A preset is the develop only** (`develop-presets.ts:30`,
   `DevelopPreset`). Since v5 a look is per picture, so "Portra + my curve" is
   two gestures on every picture. Optional `grade` (and sections) on a preset,
   a book version bump. M.
7. **No "reset this picture".** Reset zeroes the develop numbers only; the look
   and the layers have no reset at all. S.
8. **Undo is one stack for the roll** (`DevelopTool.tsx:185`, 50 steps, in
   memory): ⌘Z after stepping undoes the previous picture — or an Apply-to on
   others — with nothing visible changing. At least: a restore opens the
   picture it changed. S/M.
9. **Brush and heal sizes reset on every step** (`PictureWorkbench.tsx`
   state, remounted per picture) while the tab survives. Lift them beside the
   tab. S.
10. **Cells go stale** after Apply-to, undo, a pull from an instance or an
    import (known limit, `develop-roll.md`). A background re-bake of the cells
    a write touched. M.
11. **The lattice interpolation is a browser pref that changes the FILE**
    (`roll-cubes.ts`): one roll exports differently on two devices. Tiny
    numerically, but it is a document fact living in `localStorage`. S.

## 3. Editing tools — by daily impact

| # | Missing / partial | Today | Size |
|---|---|---|---|
| 12 | **HSL / colour mixer** (8 bands × H/S/L, targeted tool) | absent | M — it is a cube stage, `developStage` |
| 13 | **Texture · clarity · dehaze** | absent | M — local contrast needs a neighbourhood: a pass like `detail-pass` |
| 14 | **Colour grading wheels** (shadows/mids/highlights, balance) | absent | S/M — a cube stage |
| 15 | **Clipping overlay on the picture, RGB histogram, readout under the cursor** | luma histogram + clip % only | S |
| 16 | **Masks combined** (add / subtract / intersect), **colour range**, sky/background | one mask per layer; linear, radial, luma, brush, subject | M/L |
| 17 | **White balance in Kelvin on a RAW** + presets (daylight, cloudy, shade…) | gains ±100, eyedropper | M — the decode knows the as-shot multipliers |
| 18 | **B&W with a channel mixer** | a fixed film stock only | S |
| 19 | **Camera profiles** (DCP/ICC input, "camera matching") | absent; RAW colour is LibRaw's matrix | L |
| 20 | **Lens profiles, auto Upright** | manual sliders, no profile *by decision* | M/L — see §7 |
| 21 | **Sharpening detail + masking**, post-crop vignette | amount/radius only; lens vignette or a radial layer | S |
| 22 | **Content-aware remove**, spot visualisation | heal/clone discs, dust finder | L |
| 23 | **Side-by-side before/after, reference picture** | wipe + `\` | S/M |
| 24 | HDR / panorama / focus merge | absent | L, and last |

## 4. Output

| # | Missing | Today | Size |
|---|---|---|---|
| 25 | **ICC profile embedded** (even sRGB), **Display P3 / Adobe RGB** | untagged sRGB | S for the tag, M for wide gamut |
| 26 | **16-bit TIFF / PNG** (print, retouch hand-off), AVIF | JPEG + Ultra HDR, by decision | M |
| 27 | **Remove GPS / metadata on export** | GPS always leaves | S |
| 28 | **Export presets and several targets in one run** (full + 2048 web), short edge / megapixels / %, output sharpening, watermark | one long-edge cap per roll | M |

## 5. Workflow

| # | Missing | Today | Size |
|---|---|---|---|
| 29 | **A grid of the roll**, sort, drag to reorder | strip in import order; `movePicture` has no UI | M |
| 30 | **Virtual copies** (one frame in colour AND in B&W) | refused by `addPictures`' dedupe | M |
| 31 | **Snapshots, a per-picture history panel** | roll-wide undo, lost on reload | M |
| 32 | **Title, caption, keywords, copyright/creator** written into the file | none | M |
| 33 | **Culling signals where one edits** — Winnow's picks/stars shown read-only, filter on them | not read at all | S/M |
| 34 | **Send a developed picture to Trips / a Studio project** with its whole edit | deferred after v1; the modal hosts carry the global develop only | L |
| 35 | Import that COPIES off a card (+ backup) | references only; a card ejected goes dark unless previews are kept | M |
| 36 | Full-screen key, grid/loupe keys, filmstrip virtualisation for 1 000+ | none | S each |

## 6. Proposed order, in commits

- **Pass 1 — correctness (this week's kind of bug):** 1, 2, 3, 9, 11. Five
  commits, each S except 1.
- **Pass 2 — the obvious for a Lightroom hand:** 4 + 5 (one sections picker
  for ⌘⇧C/⌘⇧V and every Apply-to), 6, 7, 8, 15, 27, 25 (sRGB tag).
- **Pass 3 — the tools a daily edit reaches for:** 12, 13, 14, 18, 21, 17, 16.
- **Pass 4 — output:** 28, 26, 25 (wide gamut).
- **Pass 5 — workflow:** 29, 30, 31, 33, 32, 34.
- Later, and each its own brief: 19, 20, 22, 24, 35.

## 7. His to decide

- **Ratings and flags** stay Winnow's (`develop-tool.md` §8) — but may Develop
  at least SHOW and filter by Winnow's picks (33)?
- **JPEG only** (`develop-roll.md`): is a 16-bit TIFF wanted now (26)?
- **Lens profiles** were refused because invented coefficients would be a
  fabricated correction. **Lensfun** is a *measured*, open database (distortion,
  TCA, vignetting per lens and focal length) — does it clear that bar (20)?
- **A roll default look** for pictures added later, or strictly none (v5 says
  none; a batch verb dresses them)?
- **Virtual copies** break "a picture is added once" — accept two entries of
  one ref, marked as copies (30)?
