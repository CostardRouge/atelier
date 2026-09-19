# Develop — the third editor

**Status (2026-09-16): the direction and eight choices are DECIDED by the
maintainer (§2, §8); the shared foundations and EVERY phase, D1–D10, are BUILT
— the tool has its gallery, its full-screen editor (stage, filmstrip, the
Develop, Crop and Export inspectors), a filmstrip batch selection, a still
export that delivers from a proxy or its original and goes home, and the
Library's `Develop` verb. What v1 leaves open is §8's "after v1" (send to
Trips / a project) and the RAW path (O4–O6 of `develop-originals.md`).** From
his brief of the same day (*"un troisième outil officiel de développement
d'images … à peu près la même interface que la modale … je n'ai pas envie de
réinventer la roue … si des choses communes peuvent être développées, on
anticipe et on les développe"*). §1 is what exists; §2 and §8 the decisions; §3–§6
the plan; §7 the phases in commits. Read
`docs/memory/develop.md` first, then `docs/photo-develop.md` (the engine and
the modal) and `docs/develop-originals.md` (proxy, render, RAW).

**What it reverses.** `photo-develop.md` §7.5 and §11.2 recommended *no ninth
tool* ("the Studio already is one"), on the reasoning that a `#/develop` route
over the Library would have no document and lose its numbers. The maintainer
chose a tool, and the objection is answered by giving it a document (§3). It
does NOT reverse `studio.md`'s «stills on the same stage as clips»: the Studio
still edits photographs inside a project, and a roll is not a second kind of
project — it is what a developer keeps, not what an editor composes.

## 1. What is shared already (built 2026-09-15)

The modal was split so a full-screen host lays out the same blocks
(`docs/memory/develop.md` for the rules):

| Block | File | The tool uses it for |
| --- | --- | --- |
| The numbers, riding a stack | `use-develop-draft.ts` | the open picture's draft, remounted per picture with a `key` |
| The picture: decode, grade, split, zoom, wipe | `use-develop-picture.ts` | the big stage |
| Its drawing, host-sized | `DevelopViewport.tsx`, `DevelopCaption` | the stage and its caption |
| Light · Tone · Colour | `DevelopSliders.tsx` | the inspector's Develop tab |
| Clipboard, presets, apply-to, look | `DevelopSections.tsx` | header verbs, the Presets and Apply sections, the roll's look |
| Host contracts | `develop-host.ts` | `DevelopPresets`, `DevelopApplyVerb` |
| The settled row | `DevelopSection.tsx` | anywhere a picture's develop is summarised |
| Preset list rules | `develop-presets.ts` | the personal preset book (§4) |
| The engine | `develop.ts`, `lut-stack.ts` | unchanged: develop → look → output in one cube |

## 2. Decisions (maintainer, 2026-09-15)

1. **The tool opens a ROLL** — a document like a trip or a project: a named
   set of pictures, each with its own develop, plus the roll's look and export
   settings. Trips and the Studio keep their own develops; crossing between
   them is an explicit verb, never inheritance.
2. **Presets are personal and shared by every host** — one list, the same in
   the Develop tool, the Trips modal and the Studio modal, kept locally and
   synced to a Winnow like a document. A trip's existing presets are brought
   in once.
3. **v1 of the tool has**: crop · straighten · flip; export a developed JPEG
   and send it home to Winnow as an edit; a filmstrip with multi-select and
   batch; a histogram.
4. **Shared foundations first** (§1, done), the per-tool document plumbing
   NOT refactored now.

## 3. The roll

```ts
/** shared/develop/roll-types.ts — BUILT (D3): pure, read through `readRollDoc`. */
interface RollDoc {
  id: string;
  version: number;                  // ROLL_DOC_VERSION = 2 since the border (2026-09-19)
  name: string;
  /** The source it is kept in (local or a Winnow) — one source, never synced across. */
  sourceId: string;
  createdAt: number;
  updatedAt: number;
  pictures: RollPicture[];          // the strip's order
  /** The roll's look, after every picture's develop — Trips' TripGrade shape; null = none. */
  grade: { layers: SavedLutLayer[]; output: OutputTransform } | null;
  export: { longEdge: number | null; quality: number; originals: 'auto' | 'proxies' | 'originals' };
}
interface RollPicture {
  id: string;
  ref: SavedMediaRef;               // hash-carrying, so a rename or an instance still finds it
  develop: DevelopSettings | null;  // null = as shot
  framing: Framing | null;          // null = uncropped (an untouched framing reads as null)
  aspect: 'original' | string;      // an ASPECT_PRESETS id
}
```

- **Where pictures come from**: the Library (a folder), a Winnow day or leg
  through the media scope (`media-scope.tsx`, the roll publishes its span like
  Trips), and "Add from this computer". A picture is a REF; the bytes are
  found the way every tool finds them (Library by name/hash, else the
  instance's proxy, re-fetched by `assetId`).
- **Storage**: its own IndexedDB database `atelier-develop` (stores `rolls`,
  `thumbs`, `sync`), the trip-store rationale (a document per database, no
  schema war). On a Winnow: one more `DOC_KINDS` entry (`roll`) in
  `winnow/src/lib/appDocuments.ts` — no migration, the column is TEXT — and
  Atelier's `remoteFor` learns to read `documents.kinds` so an older instance
  hides the feature instead of failing with a 400.
- **Backup file**: `.roll.json`, the trip file's rules (a backup, not a
  template: minus id, timestamps and `sourceId`; refs travel).
- **What is never stored**: the selection, the zoom, the wipe, the open tab.

## 4. The personal preset book

- One document per person: `PresetBook { id, version, presets, mergedTripIds,
  updatedAt }`, local in `atelier-develop` (store `presets`, one row), and on a
  Winnow as `kind: 'presets'` under a UUID — **not** a fixed `mine`, because the
  bucket's key is `(app, id)` and two accounts on one instance would collide; a
  second device finds it by listing the kind. The same `doc-sync` reducer,
  its sentence drawn in the presets section with a "keep on" picker (built:
  `use-preset-book.ts`, `develop-roll.md`).
- **Every host reads and writes the book** through `savePresetIn` /
  `removePresetFrom`; a 412 is merged by name (`mergeBooks`) and pushed again,
  never shown as a conflict.
- **Migration, once**: on first load, each trip's `developPresets` are merged
  into the book by name (a name already in the book keeps the book's numbers);
  the trip field stays readable and travels in `.roadtrip.json`, but no host
  writes it again. Recorded so a later agent does not "clean it up".

## 5. The screens

- **Routes**: `#/develop/home` (gallery), `#/develop/<roll>` (editor),
  `#/develop/<roll>/<picture>` (addressable picture, Back lands on it).
  Redirects check `isWithinRoute`.
- **Gallery**: rolls as cards (cover = the first developed picture, count
  "18 of 42 developed"), New roll, Import, grouped by source — the Trips and
  Studio gallery patterns.
- **Editor, wide** (darkroom surface): the stage (`DevelopViewport`, whole
  height, the zoom pill in the PageBar), the inspector on the right with three
  tabs — **Develop** (histogram, `DevelopSliders`, presets, apply to selection,
  the roll's look), **Crop** (aspect, straighten, flip, reset), **Export**
  (the plan with the *Delivers* line of `develop-originals.md`, originals
  mode, JPEG quality, Export, Send home) — and the FILMSTRIP as a band under
  the stage (click opens, Shift/⌘ selects, the count of the selection names
  the batch verbs: "Apply to 6 selected", "Paste to 6").
- **Editor, phone**: stage on top, filmstrip under it, the inspector in the
  shell's bottom bar as sections (the Trips grammar), sliders in a
  `BottomSheet`.
- **Keyboard**: ←/→ picture, ⌘C/⌘V develop, `\` hold for before, `Z` fit ↔ 1:1,
  `R` crop tab.
- **Crop on the stage**: the Trips framing gestures (drag, pinch-zoom, rotate
  handle, flip buttons) over `shared/media/framing.ts`; Whole vs Fill as there.
  While the Crop tab is open, a drag frames instead of wiping.
- **Histogram**: a strip of luminance bins over the GRADED preview with two
  clip marks, computed from a downsampled read of the canvas in a pure
  `histogram.ts`. It is also drawn in the modal — the same block. Not the
  retired Scopes tool (no waveform, no vectorscope).
- **Home**: a third door ("Develop · resume the last roll"). `Home.tsx` hard
  codes two doors (`t.id === 'studio' ? StudioDoor : TripsDoor`); the doors
  become a per-tool lookup so the third is an entry, not a ternary.
- **Library**: the lightbox's `MediaActions` gains "Develop" (adds the picture
  to the open roll, or a new one) — the verb §7.4 of `photo-develop.md` said
  needed a publisher.
- **Sources screen and ledger**: `DocCount {projects, trips}` gains rolls.

## 6. Seams the tool needs that do not exist yet

- **A still export that takes a framing.** `exportPhotoVariant`
  (`photo-frame.ts`) cover-crops only; the roll exports crop/straighten/flip at
  source density (grade before the crop, the existing rule), so it gains an
  optional `Framing`, drawn through `drawFramed`.
- **`SendFinalsPanel` lives in `tools/studio/`**; a second consumer moves it to
  `shared/sources/winnow/` (`shared/` never imports `tools/`).
- **The document plumbing is copied line for line** between `StudioTool` and
  `RoadTripTool` (flush on idle, visibility flush, resume/pull, keepMine /
  takeTheirs / keepLocal / deleteHere, the pill) and between the two
  galleries. The maintainer chose not to refactor it now; the roll is the third
  consumer, so its phase D2 extracts a `useDocumentSync` hook and gallery
  helpers FIRST and moves the two existing tools onto them in the same pass —
  a third copy is where copying stops being cheaper.

## 7. Phases (one commit each)

- **D1 — the histogram block** — **BUILT 2026-09-15**: pure `histogram.ts` +
  spec, `DevelopHistogram`, read by `useDevelopPicture`, drawn at the top of
  the modal's column. Useful before the tool exists.
- **D2 — shared document plumbing**: `useDocumentSync`, gallery source helpers;
  Studio and Trips moved onto them, behaviour unchanged, their sync verified
  against a stub instance (the `testing.md` recipe). **BUILT 2026-09-15**: the sync
  half in `c379211` (`use-document-sync.tsx` + `afterPull`), the gallery half
  right after (`document-gallery.ts` + `use-document-gallery.ts`).
- **D3 — the roll model** — **BUILT 2026-09-15**: `roll-types.ts` + spec,
  `roll-store.ts` (DB `atelier-develop` v1: `rolls`, `thumbs`, `sync`,
  `presets`), `roll-remote.ts`, `roll-file.ts` + spec; `remoteFor(id, kind)`
  reads `documents.kinds` through `bucketHolds`. Winnow: `DOC_KINDS` += `roll`,
  `presets` (its commit `43f01e9`, not pushed).
- **D4 — the preset book** — **BUILT 2026-09-15**: `preset-book.ts` + spec,
  `preset-book-remote.ts` + spec, `use-preset-book.ts`; `DevelopSheet` draws the
  book by default, so Trips and the Studio switched with no host code; Trips'
  preset wrappers removed.
- **D5 — the tool shell** — **BUILT 2026-09-16**: registry entry, routes
  (`develop-route.ts` + spec), `RollGallery` over `useDocumentGallery`,
  `NewRollModal`, the Home door lookup (`DOORS`), `DocCount.rolls`; the roll
  screen was first a contact sheet over the modal sheet, replaced by D6.
- **D6 — the editor** — **BUILT 2026-09-16**: `RollEditor` + `PictureWorkbench`
  + `Filmstrip` over the workbench blocks, `roll-editor.ts` + spec (keys,
  stepping, removal, develop equality); write-through with no Done, one
  updater, a history-replacing step, the open cell redrawn as delivered, the
  inspector a sheet on a phone. Only the Develop inspector exists: the Crop and
  Export tabs arrive with D8 and D9, so no empty tab is drawn before them.
- **D7 — batch** — **BUILT 2026-09-16**: `selectionAfterClick` + `pictureRange`
  in `roll-editor.ts` (tested), the filmstrip's Shift/⌘-click, `DevelopApplyVerb`s
  that read the selection instead of "every other picture" once one exists.
- **D8 — crop** — **BUILT 2026-09-16**: `FramingStage` (the delivered picture
  framed into its aspect box over `shared/media/framing.ts`, drag pans, wheel
  or pinch zooms) and `CropPanel` (aspect, fit, zoom, rotation, turn, flip,
  reset — Trips' Framing section plus the aspect), the inspector's two tabs
  (`WORKBENCH_TABS`, also the phone bar's cells), `R` / `D` keys,
  `pictureAspectRatio` in `roll-editor.ts` (tested); the crop written through
  on its own timer, the filmstrip cell redrawn framed (`framedThumbnail`).
  **Replaced 2026-09-19** by the classic crop — `CropStage` (the whole picture
  still, a zone drawn over it, the picture turning under it; `crop-rect.ts`)
  — with the same stored fields: `develop-roll.md`, «The crop is a ZONE».
- **D9 — export** — **BUILT 2026-09-16**: `roll-export.ts` (pure, tested:
  `rollOutputSize`, `pixelHeadroom`, `choosePixels`, `deliverySummary`, the
  *Delivers* line, names) and `roll-render.ts` (decode whole → grade through
  the picture's own cube → `drawFramed` → JPEG), the Export tab
  (`ExportPanel`: size, quality, `Auto · Proxies · Originals`, the line, the
  verbs, the finals), `use-roll-export.ts`; `MediaOrigin.name`/`bytes` (O1),
  originals held for the session (`shared/sources/original-cache.ts`, O2),
  `SendFinalsPanel` moved to `shared/sources/winnow/` with per-file capture
  ids (`FinalCandidate.assetId`), `shared/sources/deliver-files.ts`. The
  framing seam landed over `drawFramed` in `roll-render.ts`, not on
  `exportPhotoVariant` (§6): no Studio caller passes a framing to it yet.
- **D10 — the Library verb and the README** — **BUILT 2026-09-16**: both
  Develop screens publish a `Develop` `MediaAction` (the editor adds the
  active picture to the open roll and opens it, never twice; the gallery
  starts a new roll from it), answered in an effect after the render, never
  in `run`'s closure (`develop-roll.md`); the README's `## Develop tool`
  section extended (batch, crop, export, send home, the verb). The Home door
  and the tool count needed nothing: D5 had built the door, and the README
  already counted ten tools.

RAW (O4–O6 of `develop-originals.md`) lands in the tool first, where it matters
most, and the modals get it through the same blocks.

## 8. Decided later the same day (maintainer, 2026-09-15)

All four recommendations accepted (*"ok pour tes recommandations"*):

- **The roll has a look** — one LUT stack for the roll, Trips' trip-grade
  shape, applied after each picture's develop.
- **No rating or flags** on a picture: culling is Winnow's job.
- **"Send to Trips / to a Studio project"** from a roll comes AFTER v1.
- **The name on screen is *Develop*** (the suite's word), slug `develop`.

## 9. A roll finds its own pictures (maintainer, 2026-09-16)

**The report.** A roll reopened after a reload showed its thumbnails and
nothing else: a click said *not in the Library* until the day was found again
in the sidebar and its pictures ticked. And *Add 3 selected* stayed on the bar
for pictures already on the roll. His words: the Library is historical, the
workflow should not have to pass through it, and a picture's link is already
known. Winnow first, local files as a bonus. The proposal page:
https://claude.ai/artifact/XhJEmU2YASJW6S5MedddV5 — **all its recommendations
accepted**:

- **Q1 — a picture the roll fetches does NOT enter the Library.** The roll is
  the working list; the Library stays a place to choose from.
- **Q2 — working previews for LOCAL files only**, opt-in per roll with the
  weight shown; never for a Winnow picture, whose ref is its address. It
  reverses `local-first.md`'s "no media bytes persisted" for that case only.
- **Q3 — fetch the open picture and two neighbours each side**, the rest on
  demand; widen only after measuring.

Phases, one commit each:

- **F1 — the roll fetches its Winnow pictures itself** — **BUILT
  2026-09-16**: `roll-media.ts` + spec (order, window, states, the stage's
  sentence), `use-roll-media.ts` (Library first, else `refetchMedia` into a
  pool of the roll's own), states in the filmstrip with the instance's
  thumbnail before a fetch, a status line with *Sign in* / *Try again* /
  *Sources*, and the export fetching what it needs on the spot.
- **F2 — an honest add button** — **BUILT 2026-09-16**: the bar's button
  counts only the ticked photos the roll does not hold (`sameMediaRef` over
  their hashed refs) and is not drawn when there are none; the one *Add* menu
  arrives with F3, when there is a second way in to gather.
- **F3 — add a day from a Winnow, inside the roll** — **BUILT 2026-09-16**:
  `WinnowDaySheet` (one day of the first connection, photos only, what the
  roll lacks ticked), `rowMediaRef` beside `materialize` (+ spec: the ref a
  fetched proxy would carry, size 0), and the bar's *Add* — a button for one
  way in, a menu (`OverflowMenu`'s new worded trigger) for two.
- **F4 — local files: the folder handle and re-linking by drop** — **BUILT
  2026-09-16**: `atelier-develop` v2 with a `folders` store (per roll, per
  device), `use-roll-folders.ts` (read at once where the permission holds,
  *Reopen* otherwise), *Add › A folder on this computer…*, a drop anywhere on
  the roll (found again, or added — `splitByRoll`, `photoFiles`, tested) and
  `dropDirectoryHandles` to remember a dropped folder in Chromium.
- **F5 — working previews** (palier C) — **BUILT 2026-09-16**: `previews`
  store (DB v3), `working-preview.ts` (+ spec), `use-roll-previews.ts`, the
  preview state in the strip and the status line, the fidelity chip, and the
  export saying a picture left from its preview.

