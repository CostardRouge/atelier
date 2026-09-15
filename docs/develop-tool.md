# Develop — the third editor

**Status (2026-09-15): the direction and eight choices are DECIDED by the
maintainer (§2, §8); the shared foundations and D1 are BUILT; the tool itself
is not.** From
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
/** shared/develop/roll-types.ts — pure, migrated like TripDoc and ProjectDoc. */
interface RollDoc {
  id: string;
  version: number;
  name: string;
  /** The source it is kept in (local or a Winnow) — one source, never synced across. */
  sourceId: string;
  createdAt: number;
  updatedAt: number;
  pictures: RollPicture[];          // the strip's order
  /** The roll's look, after every picture's develop — Trips' TripGrade shape. */
  grade: SavedLutLayer[] | null;
  outputTransform: OutputTransform;
  export: RollExport;               // long edge or source size, JPEG quality, originals mode (Auto)
}
interface RollPicture {
  id: string;
  ref: SavedMediaRef;               // hash-carrying, so a rename or an instance still finds it
  develop: DevelopSettings | null;  // null = as shot
  framing: Framing | null;          // crop · straighten · flip (shared/media/framing.ts)
  /** The frame shape of the crop: 'original' or a preset ratio. */
  aspect: 'original' | string;
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

- One document per person: `PresetBook { version, presets: DevelopPreset[],
  updatedAt }`, local in `atelier-develop` (store `presets`, one row), and on a
  Winnow as `kind: 'presets'`, id `mine` — the same `doc-sync` reducer and
  `SyncPill`, shown in the tool's gallery bar.
- **Every host reads and writes the book** through `savePresetIn` /
  `removePresetFrom`; the `DevelopPresets.keptOn` line says "in your presets".
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
  against a stub instance (the `testing.md` recipe). **The sync half is BUILT
  (2026-09-15, `c379211`: `use-document-sync.tsx` + `afterPull`); the gallery
  half (source list, remote lists, create-on-source, delete-from-source) waits
  for `ProjectGallery.tsx` to leave a parallel session's hands.**
- **D3 — the roll model**: `roll-types.ts` + migration + spec, `roll-store.ts`,
  `roll-remote.ts`, `roll-file.ts`; `remoteFor` reads `documents.kinds`.
  Winnow: `DOC_KINDS` += `roll`, `presets` (a commit THERE).
- **D4 — the preset book**: store, sync, the one-time merge from trips, every
  host switched to it.
- **D5 — the tool shell**: registry entry (`group: 'editor'`, accepts photo),
  routes, gallery, New roll, the Home door lookup, ledger counts.
- **D6 — the editor**: stage + filmstrip + Develop tab from the workbench
  blocks, the per-picture `key`, keyboard.
- **D7 — batch**: selection, apply / paste to selection, counts in labels.
- **D8 — crop**: framing on the stage and the Crop tab.
- **D9 — export**: framing-aware still export, full decode (the originals
  plan's O1 + O2 slot in here: Auto fetches an original only where needed),
  Send home (panel moved to shared).
- **D10 — the Library verb and the README** (a new `## Develop tool` section,
  the Home and tool counts).

RAW (O4–O6 of `develop-originals.md`) lands in the tool first, where it matters
most, and the modals get it through the same blocks.

## 8. Decided later the same day (maintainer, 2026-09-15)

All four recommendations accepted (*"ok pour tes recommandations"*):

- **The roll has a look** — one LUT stack for the roll, Trips' trip-grade
  shape, applied after each picture's develop.
- **No rating or flags** on a picture: culling is Winnow's job.
- **"Send to Trips / to a Studio project"** from a roll comes AFTER v1.
- **The name on screen is *Develop*** (the suite's word), slug `develop`.
