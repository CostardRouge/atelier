# What stands between Develop and leaving Lightroom / Capture One

The maintainer, 2026-09-23, right after the roll's look turned out to dress every
picture (fixed in roll v5): *"le but du jeu, c'est que j'arrête de me servir de
ces outils externes et que je commence à me servir de mon outil"* — find what
was forgotten, what is obvious, and what is missing.

**Status (2026-09-23): pass 1 is BUILT** — items 1, 2, 3 and 9, one commit
each; item 11 was withdrawn (below). His answers to §7 are in §8, with the two
things he asked for on the way.

This is an **audit, not a set of decisions**. §1 and §2 are verified in the code
(file:line as of `b35c744`); §3–§5 are an inventory against Lightroom Classic's
Develop/Library and Capture One, each item checked for existence, not guessed;
§6 is a proposed order in commits; §7 is what is his to decide. What the suite
does that neither does (film emulsion + halation, stacked `.cube` looks and
packs, Ultra HDR, the capture's renditions, DNG GainMap/warp, borders) is not
repeated here.

## 1. Bugs — the stage and the file disagree, or data is shared by accident

1. **BUILT** — **A subject mask is not in the exported file.** `roll-render.ts:204,269,299`
   call `layerPasses(stack, ar)` with no `rasters`; `layer-render.ts:45-53`
   says a subject layer without its raster "draws NOTHING". Only the stage runs
   `use-subject-masks.ts`. The picture on screen has the local adjustment, the
   JPEG does not. `render-layers.md` ("the rasters reaching every renderer") is
   wrong for the export. Fix: segment in the run (same model, same points) and
   hand the rasters to `renderRollPicture`. M.
2. **BUILT** — **Importing one `.roll.json` twice makes two rolls share picture ids.**
   `rollDocFromFile` (`roll-file.ts:122`) clones `pictures` with their ids;
   thumbnails and working previews are keyed by picture id alone, so the two
   rolls overwrite each other's cells and deleting one deletes the other's.
   Fix: fresh ids on import. S.

## 2. Consistency gaps — the same class as the look

3. **BUILT** (`pictureEdits`) — **Three answers to "is this picture edited?"** — the filmstrip dot
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
9. **BUILT** — **Brush and heal sizes reset on every step** (`PictureWorkbench.tsx`
   state, remounted per picture) while the tab survives. Lift them beside the
   tab. S.
10. **Cells go stale** after Apply-to, undo, a pull from an instance or an
    import (known limit, `develop-roll.md`). A background re-bake of the cells
    a write touched. M.
11. **WITHDRAWN** — *The lattice interpolation is a browser pref that
    changes the file.* True, and DECIDED that way on 2026-08-21
    (`media-pipeline.md`, «Tetrahedral LUT interpolation»): the mode changes
    how faithfully a grade is READ, not what the grade is, so it is a
    `localStorage` preference and never a document field. Tetrahedral is the
    default everywhere; a roll only exports differently on a device where he
    chose trilinear by hand.

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

- **Pass 1 — correctness (this week's kind of bug):** 1, 2, 3, 9 — BUILT
  2026-09-23; 11 withdrawn.
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

## 8. His answers (2026-09-23)

- **Winnow's picks and stars, read-only in Develop: YES** (33) — shown and
  filtered on, never written: culling stays Winnow's.
- **TIFF: NO for now** (26) — he does not see what it would serve; JPEG (and
  Ultra HDR) stays the one format.
- **Lensfun: YES** (20). Profiles are fetched ON DEMAND — the lens a picture
  was shot with, when it is first asked for — and KEPT locally; never the
  whole database in `dist/`, which he does not want to weigh. Automatic is
  preferred; a profile file picked by hand is an accepted fallback if a fetch
  cannot be made to work. It is a network request to a third party (the
  Lensfun data, CC BY-SA 3.0), so it joins `local-first.md`'s list and the
  README's callout, and says what it fetches.
- **A roll default look: NO** (v5 confirmed) — *"la photo, une fois qu'elle a
  été rajoutée, il faut qu'elle soit vraiment nature"*.
- **Virtual copies: YES** (30) — Capture One's *variants*: one frame cropped
  two ways, or in colour and in black and white. `addPictures`' dedupe stays
  for ADDING; a variant is made from a picture already on the roll.

Two asks that came with the answers, both awaiting a proposal:

- **Choosing which pictures an export takes**, explicitly — today the Export
  tab offers this picture, the Shift/⌘-marked ones, or the whole roll; he
  wants a clearer state per picture (a tick, an `export / skip` tag, a grid in
  the Export tab, or a modal) and asked for options.
- **Metadata written into the delivered file**: title, caption, copyright set
  in the Export tab; the tool's own signature (already `Software: Atelier` in
  every export that carries EXIF — and load-bearing: `software-mark.ts` is how
  the suite refuses to offer its own exports as a capture's rendition); and a
  checklist of what leaves — GPS, place, the camera's EXIF, the exposure
  triangle — grouped. He asked for a strategy.

## 9. The proposal for those two asks (2026-09-23, awaiting his five answers)

Interactive lab: <https://claude.ai/artifact/SgJpjQtNXF62Quott5ahkk> (*Delivery
Lab*). Nothing below is decided.

- **Which pictures leave** — a DELIVERY STATE stored on the picture:
  `auto · yes · no`. `auto` follows a roll rule, recommended *edited pictures
  leave* (`pictureEdits`); an explicit choice always wins. It is an output
  instruction, not a rating: culling stays Winnow's. Set from a table in the
  Export tab — the existing *picture by picture* run plan with a tick per row
  and filters (all · edited · leaving · not yet exported) — plus a badge on
  each filmstrip cell for the glance. A separate export sheet (Lightroom's
  dialog) was drawn and not recommended: it hides the picture and doubles the
  tab. Shift/⌘ marks gain *send / hold the marked*.
- **What a file says** — the signature stays ALWAYS ON, decided here at his
  invitation: `Software` is the conventional home (Lightroom writes its name
  there) and `software-mark.ts` READS it to refuse the suite's own exports as
  a capture's rendition, so a checkbox would reopen that bug. It is added to a
  picture that carries no EXIF today (it leaves unsigned) and mirrored as
  `xmp:CreatorTool`. Author and copyright are his IDENTITY, set once and
  synced (`{year}` = the capture's year), written as `Artist` / `Copyright`
  and `dc:creator` / `dc:rights`; title and caption are the PICTURE's
  (`dc:title`, `dc:description`, `ImageDescription`; a variant has its own).
  What leaves is a grouped checklist on the roll with three presets (All ·
  Share online — no GPS, no serials · Minimal — rights only): camera · exposure
  triangle · capture time · GPS · place · identifiers · title/caption ·
  rights · signature (locked). **Place** is new and offline: the city from the
  GPS through `public/geo/cities.json`, written as XMP even when the GPS stays.
- **Two constraints the build must keep**: a block with every camera group kept
  is COPIED whole (MakerNotes included); dropping one REBUILDS it from its
  fields and the MakerNotes are lost — said in the panel. And a JPEG carries
  ONE XMP packet: the Ultra HDR container already writes one, so the new
  properties merge into it.
- **Commits**: E1 the state + badge + rule, E2 the table, E3 (later) *changed
  since last export*; M1 signature everywhere + rights, M2 title/caption + the
  XMP merge, M3 the groups and presets, M4 the place.
- **His five questions**: what leaves by default (edited, recommended · all ·
  none); GPS by default (kept, recommended — he finds a picture by its
  position); the copyright text; the signature (`Atelier` · with a version ·
  with the site's address, which belongs in XMP rather than `Software`); and
  where the state is set (table + badge recommended · table alone · sheet).

## 10. His answers to §9, and the ignored state (2026-09-23, lab v2)

**Decided**: what leaves by default is the EDITED pictures (`pictureEdits`); the
GPS leaves by default (preset *All*); the copyright text is ENGLISH, the
interface's language — `© {year} Steeve Pommier. All rights reserved.`, `{year}`
the capture's year; the signature is `Atelier` alone (there is no real version:
`package.json` sits at `0.1.0` and was never bumped, and the roll's `version`
is the document FORMAT — writing it would read as "Atelier 5"; a build id,
injected at build time and written as XMP, is the honest version if ever
wanted); and the state is set from BOTH the Export tab's table and a badge on
each filmstrip cell. **A table row is clickable in full** (48 px), never its
checkbox alone — his words: a box is too small a target, on a phone above all.

**E1–E3 BUILT 2026-09-23** after his "OK pour tout" — the four-state field and
its keys, the Export tab's table, the filmstrip badges (`develop-roll.md`,
«Which pictures LEAVE is one field on the picture»). M1–M4 and E4 are next.

**M1 BUILT 2026-09-23** — every file signed (a picture with no EXIF included,
EXIF + `xmp:CreatorTool`), the creator and copyright an identity on the preset
book with no default name (the site is public), `{year}` the capture's year,
EXIF text in UTF-8, and ONE XMP packet folded into the Ultra HDR container's
(`develop-roll.md`, «Every delivered file is SIGNED»).

**M2 BUILT 2026-09-23** — each picture's own title and caption (`dc:title`,
`dc:description`, the caption also as `ImageDescription`), in the Metadata
section (`develop-roll.md`, «A picture's title and caption are the PICTURE's»).

**Proposed then, accepted as drawn** (his idea, drawn in the lab): an **ignored** state.
Recommended as the FOURTH value of the one delivery field —
`auto · yes · no · ignore` — never a second flag beside it, so no combination
can contradict another: an ignored picture never leaves, and un-ignoring puts
it back to `auto`. *Ignored* means "out of the roll's work" in every reader at
once: ←/→ skip it (from an ignored picture they go on to the next that is not),
"Apply to N other pictures" skips it, the "developed" count leaves it out, the
filmstrip dims it or hides it (*Show ignored*), the table folds it into an
*Ignored · N* group — and a click still opens it. Against "take off the roll",
it keeps the picture's edits and is undone with one key. It is Lightroom's
reject / Capture One's hide scoped to ONE roll, and nothing is written to
Winnow, whose culling stays its own (shown read-only, §8). Keys proposed, all
free in `editorKeyAction` and plain letters so AZERTY is the same: `P` send ↔
hold, `U` back to auto, `M` ignore ↔ un-ignore. The badge's click toggles send
↔ hold; auto and ignore go through the keys, the table, or a long press /
right click. Commits: E1 the four-state field, the rule, the keys and the
skipping; E2 the table; E3 the badges and *Show ignored*; E4 (later) *changed
since last export*; then M1–M4 of §9. His open questions: the ignored state as
described or a display filter only; ignored cells dimmed (recommended) or
hidden by default; the three keys; which pass comes first.
