# Develop — the roll, the preset book, the tool's shell and editor

Read when you touch the Develop tool (`src/tools/develop/`), the roll
document (`shared/develop/roll-*.ts`), the personal preset book
(`preset-book*.ts`, `use-preset-book.ts`) or the editor's rules
(`roll-editor.ts`). The workbench blocks every host shares, the histogram and
the decision to make the tool are in `develop.md`; the plan and its phases in
`docs/develop-tool.md`.

## The roll is read ONE way, wherever it comes from (2026-09-15, D3)

`roll-types.ts` (`RollDoc` v1), `roll-store.ts`, `roll-remote.ts`, `roll-file.ts`
— the trip's twins, built before any screen. Rules a later phase must keep:
(1) **one reader** — the store, the instance and the `.roll.json` all go
through `readRollDoc`, which drops a picture whose ref names nothing, keeps
the first of two entries with one id, and stores an as-shot develop, an
untouched framing and an empty look as `null` (one spelling each, so
"developed" and "has a look" are simple tests). (2) **a picture is added
once** — `addPictures` dedupes by source id → hash → name and size, so adding a
day again never duplicates what was already developed. (3) **the database is
`atelier-develop` v1 with FOUR stores from the start** (`rolls`, `thumbs` keyed
by PICTURE id, `sync`, `presets` for D4's book) so no later phase needs an
upgrade transaction; thumbnails are pruned by whoever removes a picture or
deletes a roll. (4) **a kind is asked for** — `remoteFor(sourceId, kind)` and
`rollRemoteFor` return null for an instance whose `documents.kinds` does not
name `roll` (`bucketHolds`; a bucket with no list is read as trip + project
only), so an instance without Winnow's `43f01e9` hides rolls instead of a 400
on the first push. The trip and project drivers still call `remoteFor(id)`
without a kind — unchanged, since every bucket keeps them. (5) the file is a
BACKUP (fresh id, importing source, refs and custom `.cube` text travel), the
trip file's rule, and a newer version is refused. Verified: 19 specs, and the
store round-tripped in the Browser pane (put/get/list, a thumbnail written and
pruned, a sync record, the four stores present). **Winnow's side was committed
without its typecheck**: that checkout has no `node_modules`.

## The preset book is ONE live store every host reads (2026-09-15, D4)

`preset-book.ts` (pure, tested), `preset-book-remote.ts` (kind `presets`),
`use-preset-book.ts` (module state + `usePresetBookHost`). `DevelopSheet` draws
the book when a host passes no `presets`, so Trips and the Studio get the same
list with no host code; the tool will call `usePresetBookHost()` itself.
Rules a later agent must keep:

- **The id is a UUID, never a fixed `mine`.** Winnow's bucket key is
  `(app, id)` — not per user — so a fixed id collides between two accounts on
  one instance (the second gets a 404 on a foreign row). A second device finds
  the book by LISTING kind `presets` when the person keeps theirs there, and
  merges into that row's id.
- **No conflict is ever handed to a person.** A 412 on push is pulled,
  `mergeBooks`-ed (server order and id; the LOCAL copy of a name wins; local-only
  names appended) and pushed again once; a record left in `conflict` heals on
  the next trigger. The accepted cost: a preset deleted on one device can come
  back from another's copy (no tombstones — a list of names is not worth them).
- **A clean resume takes the server's copy; a dirty one merges.** A book the
  instance no longer holds (another device took it home) stays here, kept in
  this browser (`keepHere`) — never resurrected there on its own.
- **Trips' old lists are merged in ONCE per trip** (`mergedTripIds`; the
  book's numbers win on a name). `TripDoc.developPresets` stays on the
  document and in `.roadtrip.json` but no host writes it any more — do not
  "clean it up", a trip imported from an old file still carries a list to
  merge. Trips' `savePreset` / `removePreset` wrappers are gone.
- **Loaded lazily, once per tab**, when the first host subscribes — opening
  the Studio or Trips never touches `listTrips` or the instance until a sheet
  opens. Moving the book (`keepPresetBookOn`) is the person's gesture: the
  target is written and acknowledged before the origin's copy is deleted, and
  moving home deletes the instance's copy first (refused while unreachable).
  The picker appears only when a second source keeps kind `presets`.

Verified against the stub instance (`testing.md`'s recipe with `kinds`
including `presets`): four trips merged into a fresh book; Keep on → list +
PUT; a server-side change + a local save → PUT 412 → GET → PUT, both names
kept; a reload with a clean record took the server's removal; a second book
kept on the same instance merged into the first's row and its own row went; a
move home sent DELETE with If-Match; a row deleted behind the browser's back
came back as "kept in this browser". In the Trips sheet: the row, the picker
moving it, "unsaved changes — saving to … shortly", then the idle PUT.

## The tool shell: routes, gallery, one updater (2026-09-16, D5)

`tools/develop/`: `DevelopTool` (Trips' shell shape: route-addressed, 800 ms
local debounce as `beforeFlush`, `useDocumentSync` with **`kind: 'roll'`**, the
hook's optional `kind`, so a roll is never pushed to a bucket that predates
rolls), `RollGallery` (the project gallery over `useDocumentGallery`, the cover a
mosaic of the first four thumbnails), `NewRollModal`, `use-roll-grade.ts`.
Rules: (1) **routes** are `develop-route.ts`'s, the trip's `<slug>-<id8>` ref,
so a rename keeps every link. (2) **The roll's look is one stack for every
picture** (`useRollGrade`, Trips' `useTripGrade` with one scope), written back
only when it differs from what was last restored, an empty look stored as
`null`, and written through the editor's UPDATER (below). (3) **A thumbnail no
picture has is baked from the Library's FILE** (`roll-thumb.ts`, `findMedia`
name → hash), one decode at a time, once per picture per visit; a bake that
lands after its run was superseded still sets it (the picture is already marked
tried). (4) A modal's Enter is `useDialogKeys`' on the window: a `<form>` with a
submit button around a text field would run the create TWICE. The sources
ledger counts rolls (`DocCount.rolls`). D5 first shipped a contact sheet over
the modal sheet; D6 replaced it. Verified against the stub: Move to the
instance (PUT), resume (GET with `If-None-Match`), a rename pushed after the
idle with `If-Match`, Delete (DELETE with `If-Match`, thumbnails and record
pruned).

## The editor writes THROUGH, and the strip never remounts (2026-09-16, D6)

`RollEditor` (the roll: bar, grid, filmstrip, thumbnails, verbs),
`PictureWorkbench` (one picture: stage, toolbar, inspector) and `Filmstrip`; the
pure rules are `roll-editor.ts` (tested). Rules a later phase must keep:

- **No Done.** The draft is written to the roll 200 ms after it rests and on
  leaving the picture (the pending value flushed in the unmount cleanup), and
  `sameDevelop` drops a write that says nothing new (null ≡ an untouched set),
  so remounting a picture never dirties the roll.
- **ONE updater** (`update(change)` over a ref that advances immediately): a
  develop, the look and a batch landing in one tick compose instead of the last
  replacing a roll the others already moved on. Every writer goes through it.
- **The workbench is keyed per picture and returns TWO grid cells** (the stage,
  and `PanelHost`: a column, or a drawer on a phone) while the filmstrip is its
  parent's cell, so stepping remounts the draft (never-inherit) and never the
  strip (its scroll survives). The grid is inside an `@container` wrapper: the
  inspector narrows to 18rem under 880px of TOOL width, the Library's width
  included.
- **A step is a history REPLACE** (`navigate(path, { replace: true })`, new in
  `use-hash-route.ts`): ←/→ along forty pictures must not make Back replay
  them. The route without a picture shows the first; it never redirects.
- **The open picture's cell is redrawn AS DELIVERED** 700 ms after the picture
  or its cube rests (`useDevelopPicture().snapshot`, graded whole through the
  held grader, never the split). The accepted limit: a cell is the picture as
  last SEEN in the editor, so "Apply to N others" and a look change leave the
  other cells as they were until each is opened. The as-shot bake skips the open
  picture.
- **Keys** (`editorKeyAction`): ←/→ step (a held arrow sweeps), `\` holds before
  until released, `Z` fit ↔ one step closer, ⌘/Ctrl-C/V copy and paste the
  develop (⌘C yields to a text selection). A focused field or slider keeps them,
  and an open `alertdialog` keeps every key.
- **Phone**: stage and strip share the height; the inspector is a
  `DockedDrawer` under them (rev. 2026-09-16 — it was a `BottomSheet`, whose
  wash tinted the photograph being judged: `frontend.md`), opened from the
  shell's bar (`Develop` beside Library) and marked there while it is up.
  Removal is a desktop-hover verb for now.

Verified in the Browser pane: four dropped JPEGs → a roll → +1.2 EV stored
through the debounce → → / ← stepping with `history.length` unchanged and no
leak (0 on the next, 1.2 back) → ⌘C, → →, ⌘V pasted 1.2 → `\` showed "before"
and released → `Z` scale 1 ↔ 1.5 → Apply to 3 → removal of a developed picture
through the confirm → reload: route, develops, thumbnails pruned to three → the
look's output transform saved as `grade`, back to `null` on None → phone: stage,
strip, the bar's Develop opening the sheet.

## The filmstrip's batch is a Shift/⌘-click selection, apart from the open picture (2026-09-16, D7)

`roll-editor.ts` gained `pictureRange` and `selectionAfterClick` (pure, tested):
a plain click still opens a picture and never touches the selection (the
caller only calls `selectionAfterClick` for a modified click); **Shift
REPLACES the selection with the range from the anchor** (repeated Shift-clicks
do not accumulate, matching Finder rather than a text-editor's extend-and-add)
and never moves the anchor; **⌘/Ctrl toggles one picture in place** and
becomes the new anchor. The anchor itself is not stored across an unrelated
open-picture change: `RollEditor` resets it to null whenever `openId` changes
by any OTHER means (a plain click, ←/→, the route), so the next Shift-click
always ranges from the picture actually open, never a stale one.

**The selection is a batch TARGET list, not a second "open".** `RollEditor`
computes `selectionTargets` (the selection minus the open picture, since
writing a picture's own develop onto itself is a no-op that would only
confuse the count) and feeds `DevelopApplyVerb`s that read it: `Apply to N
selected` writes the open draft to each target, and — only while something is
copied (`hasCopiedDevelop`) — `Paste to N selected` writes the clipboard's
develop instead, ignoring the draft `DevelopApplySection` always passes it (a
verb's `run(settings)` is free to ignore `settings`, which is what makes a
paste-verb fit the existing one-shape contract with no host change). With no
selection the roll falls back to the original "Apply to N other pictures"
(all of them). Clearing selects none via a `Clear` link beside the count in
the progress line; a removed picture is filtered out of the selection by
recomputing a `visibleSelected` view rather than pruning the raw state.

**Why no shared code**: only this tool's filmstrip supports multi-select (the
Trips/Studio modals show one picture), so the selection lives entirely in
`tools/develop/` — `DevelopApplyVerb`'s existing contract needed no change.

Verified in the Browser pane (six dropped JPEGs, no real Winnow needed):
Shift-click from the open picture across three more selected exactly that
range with checkmark badges; a repeat Shift-click at a nearer picture shrank
the range instead of adding to it; ⌘-click toggled one picture in and back
out while leaving the rest of the selection alone; "Apply to 3 selected"
wrote +1.5 EV to the three non-open targets only (the other two, unselected,
stayed as shot); Copy on the open picture then a fresh ⌘-click pair then
"Paste to 2 selected" wrote the same +1.5 EV to those two; Clear dropped the
badges and the verb reverted to "Apply to 5 other pictures".

## The crop is a second tab over the SAME delivered picture (2026-09-16, D8)

`FramingStage` + `CropPanel` (`tools/develop/`), `WORKBENCH_TABS` +
`pictureAspectRatio` + the `R`/`D` keys in `roll-editor.ts` (tested),
`framedThumbnail` in `roll-thumb.ts`, and `useDevelopPicture().delivered()` —
the one addition to a shared block. Rules a later phase must keep:

- **The crop is SEEN on every tab** (2026-09-16, the maintainer's report:
  leaving Crop showed the whole picture again and read as a lost crop).
  `useDevelopPicture` takes an optional `frame` (aspect ratio + framing) that
  only its VIEWPORT paint and zoom read — the wipe is a clipped second
  `drawFramed` of the untouched source, so before/after lines up on the crop;
  the histogram, `delivered()` and `snapshot()` stay the whole picture (the
  crop stage frames `delivered()` itself). The Trips/Studio modals pass no
  frame and are unchanged. The export always applied the stored crop.
- **The crop has its own Apply to** (`copyCropTo`, pure, tested): the open
  picture's aspect + framing copied onto the selection, else every other
  picture — never the develop. A pan is copied as is: `framingTransform`
  clamps it to each picture's slack at draw. Same D6 limit on the other cells.
- **The crop stage draws `delivered()`, never `source.image`**: a crop is
  judged on the developed picture. `delivered()` reads the ONE held grader at
  call time, so a drag repaints from the held raster copy (`held-grader.ts`)
  and never grades again; a caller repaints on `source` AND `cube`.
- **`DevelopViewport` stays MOUNTED (`hidden`) while the crop is open.** Its
  paint effect is keyed on the picture, the cube and the wipe — not on the
  canvas element — so an unmounted viewport came back BLANK on the Develop
  tab (the first D8 draft's fault). `usePictureZoom`'s ResizeObserver takes
  the 0×0 of a hidden box and re-measures on return; nothing else is needed.
- **The framing has its own write-through timer** (same 200 ms), separate from
  the develop's: a drag fires per pointer move. An untouched framing is
  written as `null` (`isDefaultFraming`), the aspect at once (discrete). The
  open tab lives in `RollEditor`, never in the workbench: the workbench is
  keyed per picture, and stepping must not drop you back to Develop.
- **A cell is the picture as delivered — graded AND framed** (`framedThumbnail`,
  keyed on the crop too, never upscaled past the source's long edge). The
  other cells keep the D6 limit (as last seen).
- The gestures are the badge stage's plus a PINCH (2026-09-16): wheel = trackpad
  pinch, two fingers zoom the framing while moving it by their centre, and they
  are heard on the STAGE rather than on the canvas — a phone letterboxes a
  147px crop inside a 374px stage, so fingers landing either side of the
  picture, which is how anything small is pinched, reached no listener at all.
  `touch-none` moved to the stage with them and is right there (both axes, a
  fixed-height box, not a scroll box — `frontend.md`'s rule is about
  scrollers). One write per event, zoom before move: `panBy` clamps at the
  scale it is given, and two writes in one event would each read the render's
  copy and the second would throw the first away. No rotate handle, exactly as
  Trips: the slider and the turn buttons are the rotation. Reset keeps the fit
  (Trips' rule: asking for Whole is not a crop).
- The docked inspector now wears the two editors' frame (`border border-line
  rounded-paper bg-surface p-3`, the `Segmented` strip pinned, the sections
  scrolling under it) — the `frontend.md` rule D6 had not yet applied.

Verified in the desktop app's Browser pane on four canvas-made JPEGs: −1.5 EV
then `R` → the crop stage showed the DARKENED picture; 1:1 → a square crop
centred; a drag panned it, the wheel zoomed to 2.12× and Reset appeared; +90°
then Horizontal → −90° mirrored (`flipFraming`); `D` → the Develop viewport
came back painted; the cell redrew square, turned, mirrored, dark; a reload
read `{aspect: '1:1', framing: {rotation: -90, flipX: true, scale: 2.117, x:
-0.3}}` from `atelier-develop` with the three untouched pictures `null`; on a
375×812 phone the bar read LIBRARY · DEVELOP · CROP, Crop raised the sheet
over the crop stage, Escape closed it.

## The export decides its pixels before it reads one (2026-09-16, D9)

`roll-export.ts` (pure, tested), `roll-render.ts`, `use-roll-export.ts`,
`ExportPanel`, `shared/sources/original-cache.ts`, `shared/sources/deliver-files.ts`,
`SendFinalsPanel` now in `shared/sources/winnow/`. Rules a later phase must keep:

- **The long edge is a CAP, never a target**: `rollOutputSize` is the aspect
  box the source covers at its own density, capped — a small file asked for
  4096 delivers what it has. So the frame a proxy gives on its own is always
  "exact", and the upscale question (`pixelHeadroom` < 1, F3 of
  `develop-originals.md`) is asked against the frame the ORIGINAL could give:
  that is what `Auto` fetches the original for, and the line then says
  `· asked 1920` when the proxy delivered less. With Size = source, Auto
  always turns to a decodable original — its pixels ARE the source size.
- **A RAW original is never fetched** (`decodableOriginal`: jpg/png/webp/
  avif/gif/bmp only — no HEIC, no TIFF): decision 4, the render the person
  developed is what leaves, and the reason is said on the *Delivers* row.
- **Each picture renders through its OWN cube** (`stack.composeWith(develop)`),
  decoded whole, graded at source density, then `drawFramed` — the crop stage's
  transform, so the file is the stage. The frame seam of `develop-tool.md` §6
  lives here, not on `exportPhotoVariant`.
- **A fetched original is held for the session by asset id**, never persisted
  (decision 3): the second export of the same picture pays no fetch, whatever
  mode. Measured in the pane: Auto → 1 fetch, Proxies → 0 and the proxy's
  pixels, Originals → 0 and the held original's pixels.
- **The finals plan links each file to ITS capture** (`FinalCandidate.assetId`,
  `FinalsItem.originalAssetId`, one upload per file); a run is offered home
  only when every picture came from ONE instance, and `plan.originalAssetId`
  names the run's capture only when all files agree (the Studio's sentence).
- `MediaOrigin.name`/`bytes` are what say whether an original is decodable and
  what it weighs — read from Winnow's row at materialise; a file the person
  opened has no origin and nothing to decide.
- **Trap — verifying identity from the page**: `import('/atelier/src/…')` in
  the pane makes a SECOND module instance once HMR has stamped the app's with
  `?t=`; register through the URL `performance.getEntriesByType('resource')`
  lists, or the app never sees the origin.

Verified in the pane on canvas-made JPEGs with `showDirectoryPicker` stubbed
and two files registered as proxies through the app's own module: A-land (1:1,
zoomed, −1.5 EV) → `A-land-developed-1x1.jpg` 1000×1000, darkened; the roll →
four files at 1000², 900×1400, 2000×900, 1200²; C-wide (proxy 2000×900,
original 6000×2700 JPG) → `Original 6000 px → 6000 · exact`, Auto fetched once
and wrote 6000×2700, Proxies wrote 2000×900 with no fetch, Originals wrote
6000×2700 with no fetch; D-sq (proxy over a DNG) → `Proxy 1200 px → 1200 ·
exact · asked 8000`, the RAW reason, no fetch under Originals; the finals panel
appeared after the run and said the instance is not connected. Not exercised:
a real upload (no instance) — the client path is the Studio's, unchanged but
for `originalAssetId` per item.

## The Library's Develop verb answers AFTER the render (2026-09-16, D10)

Both Develop screens publish one `MediaAction` (`usePublishMediaActions`):
`RollEditor` adds the active picture to the open roll and opens it (a picture
already on the roll is opened — `addPictures` dedupes, `sameMediaRef` finds
it), `RollGallery` starts a roll named by `defaultRollName()` (exported from
`NewRollModal`) on `local` and opens it. **Trap that shaped it**: the shell
calls `run()` in the SAME tick as `lib.setActive(id)` (`AssetSidebar`'s
`onRun`, the lightbox after its fetch), so a `run` that read `lib.activeId`
from its closure would develop the PREVIOUS active asset. Trips never hit it
because its verbs read nothing (the slide picks the active asset up later).
So the verb only bumps a `pending` counter and an effect keyed on it AND on
the active file does the work once React has rendered the activation; a
non-photo says so in the notice and resets. **How to apply**: a verb that
needs the active media itself never reads it inside `run`. Verified in the
pane: from the open roll, the Library's preview sheet drew `DEVELOP ON ROLL ·
… · Develop`, and the click added the new picture as the fifth and opened its
route; from the gallery the same sheet drew `DEVELOP · Develop` and the click
made `Roll · 16 Sept` on `local` with that one picture and opened it.

## Undo and redo over the roll (2026-09-15)

**Fact.** `DevelopTool` wires the shared history engine exactly as Trips does —
watched at its own `handleChange`, reset by the sync machine's `onReplace`, the
buttons in the `headerExtra` slot beside the pill; the engine's rules are in
`architecture.md`, the per-tool reasoning in `roadtrip.md`. The label is the
picture the route names (`picture:<id>`), so one picture's slider never merges
into the next picture's. **How to apply**: the editor's write-through is what
the history sees, so one step is one write, not one slider frame — and a draft
that has not been written through yet is not a step. Verified in headless
Chromium against the IndexedDB document: a roll renamed, stepped back and
forward again.
