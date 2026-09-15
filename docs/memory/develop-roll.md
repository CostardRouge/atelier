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
  and `PanelHost`: a column, or a sheet on a phone) while the filmstrip is its
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
- **Phone**: stage and strip share the height; the inspector is a `BottomSheet`
  opened from the shell's bar (`Develop` beside Library), removal is a
  desktop-hover verb for now.

Verified in the Browser pane: four dropped JPEGs → a roll → +1.2 EV stored
through the debounce → → / ← stepping with `history.length` unchanged and no
leak (0 on the next, 1.2 back) → ⌘C, → →, ⌘V pasted 1.2 → `\` showed "before"
and released → `Z` scale 1 ↔ 1.5 → Apply to 3 → removal of a developed picture
through the confirm → reload: route, develops, thumbnails pruned to three → the
look's output transform saved as `grade`, back to `null` on None → phone: stage,
strip, the bar's Develop opening the sheet.

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
