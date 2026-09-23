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
trip file's rule, and a newer version is refused. **Every PICTURE gets a fresh
id on import too** (2026-09-23): thumbnails and working previews are keyed by
picture id alone, so one file imported twice made two rolls overwrite each
other's cells and deleting one deleted the other's. Verified: 19 specs, and the
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
so a rename keeps every link. (2) The look was one stack for the whole roll
until v5 — see «The look is the PICTURE's» below. (3) **A thumbnail no
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
  included. What is a TOOL rather than the picture's — the open tab, the
  brush, the heal/clone disc — lives in `RollEditor` beside it, so a size set
  on one picture is the size on the next (2026-09-23: the brush and the disc
  were workbench state and reset on every step).
- **A step is a history REPLACE** (`navigate(path, { replace: true })`, new in
  `use-hash-route.ts`): ←/→ along forty pictures must not make Back replay
  them. The route without a picture shows the first; it never redirects.
- **The open picture's cell is redrawn AS DELIVERED** 700 ms after the picture
  or its cube rests (`useDevelopPicture().snapshot`, graded whole through the
  held grader, never the split). The accepted limit: a cell is the picture as
  last SEEN in the editor, so "Apply to N others" and "Apply look to…" leave
  the other cells as they were until each is opened. The as-shot bake skips the open
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

## The look is the PICTURE's, never the roll's (2026-09-23, roll v5)

**Decision (maintainer).** *"C'est le média qui décide"*: he found the look
dressing every picture of a roll and wanted it per picture like every other
setting (develop, crop, keystone, lens, detail, repair, layers, border and
rendition already were). **How**: `RollPicture.grade` (a `RollGrade`, null for
none), `RollDoc.grade` gone. **Migration is part of reading**: a roll whose
stored `version` < 5 hands its one look to every picture carrying no `grade`
key, each its own copy — nothing changes on screen; a v5 roll's stray
top-level `grade` is ignored, so a picture its author left bare stays bare.
**The one stack follows the open picture** (`useRollGrade(open, update)`): it
remembers WHICH picture it holds and the look it agreed with it, writes back
to that picture only (`copyGradeTo`), and skips the restore when the next
picture wears the same look (no re-fetch on a roll dressed with one).
`useLutStack.restore` now drops a restore that lands after a newer one was
asked for — without it, stepping off a picture while its built-in was still
being fetched put that look on the next picture and the write-back stored it.
**The export never reads the live stack**: each picture is baked from its
STORED look (`tools/develop/roll-cubes.ts`, one fetch per distinct look per
run, waiting rather than answering "as shot" like `use-grade-cubes.ts` may on
screen), its grain from `picture.grade.film`. A look is copied onto others
only by `Apply look to N selected / N other pictures` (never the develop), a
look counts as developed in `rollProgress`, and a new picture starts with
none — never inherited. No rung above the picture (Trips' trip → piece →
picture chain) was built: a roll is a set of photographs, not a feed that must
read as one. Verified headless: a v4 roll read as two dressed pictures; a look
removed on one left the other's; a fast ←/→ sweep over look / no look / look
moved nothing; the verb dressed the bare one; an export of a black & white
picture and a bare one delivered 133,133,133 and 200,122,60.

## Which pictures LEAVE is one field on the picture (2026-09-23, E1)

`RollPicture.deliver`: `auto · yes · no · ignore` (`docs/lightroom-gaps.md` §10,
his call). **Rules**: (1) ONE field — *ignored* is its fourth value, never a
flag beside it, so no two answers contradict; absent reads `auto`, so no roll
migrated. (2) `auto` leaves when `pictureEdits` is non-empty (`delivers`); `yes`
/ `no` are the author's and win. (3) A toggle (`toggledDelivery`: `P`, a row, a
badge) gives the OTHER answer and stores `auto` when the rule already says it —
two toggles are back on the rule, never pinned. (4) *Ignored* = out of the
roll's WORK everywhere at once: never exported, stepped over by ←/→
(`stepPicture`'s `skip`, which also hands on from an ignored picture opened by
a click), left out of every Apply-to-ALL (`otherIds`; an explicit selection
still reaches it), out of both numbers of `rollProgress` (counted apart as
`ignored`). (5) The roll's verb is *Export N pictures* over `delivers`, and the
run plan counts only those. Keys `P` / `U` / `M` — letters, so AZERTY presses
the same. An output instruction, never a rating: nothing goes to Winnow.
**E2, the Export tab's *Pictures* table** (`DeliveryTable.tsx`): one row per
picture, the WHOLE row the target at 48 px (his words — a box alone is too
small, on a phone above all), a click giving `toggledDelivery`, `↺` back to
the rule, `›` to open; filters All · Edited · Leaving · Held
(`matchesDeliveryFilter`, which answers false for an ignored picture); the
ignored folded in their own group, unfolding by itself when the open picture
is one. Each row says the RUN PLAN's own line for that picture — so
`use-roll-export` plans every picture for `lines` and only the leaving ones
for the *Delivers* sentence — and the old read-only "picture by picture" list
is gone, the table being that list made operable. The table is built by
`RollEditor` (it holds the roll) and handed to `ExportPanel` as a node.
**E3, the filmstrip badge**: bottom-right of each cell (the "unreachable" `!`
moved to the top-right to make room); a click toggles, a right-click or a
550 ms touch hold ignores ↔ brings back, and the click that ends a hold is
swallowed so it is not a second gesture. Filled = the author decided, dashed =
the rule answers; a picture on the rule that stays OUT (a big roll's untouched
majority) shows its badge only under the pointer — always on a touch screen —
so the strip does not wear a hundred grey rings. Ignored cells are dimmed, or
left out by the status line's Hide (`atelier.develop.showIgnored`, a
`localStorage` view pref, never the roll's), the OPEN picture always staying
in the strip.

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

## The crop is a second tab over the SAME delivered picture (2026-09-16, D8; rev. 2026-09-19)

`CropStage` + `CropPanel` (`tools/develop/`; the D8 `FramingStage` is gone,
see «The crop is a ZONE» below), `WORKBENCH_TABS` + `pictureAspectRatio` + the
`R`/`D`/`X` keys in `roll-editor.ts` (tested), `framedThumbnail` in
`roll-thumb.ts`, and `useDevelopPicture().delivered()` — the one addition to a
shared block. Rules a later phase must keep:

- **The crop is SEEN on every tab** (the maintainer's report: leaving Crop
  showed the whole picture again and read as a lost crop). `useDevelopPicture`
  takes an optional `frame` that only its VIEWPORT paint and zoom read — the
  wipe is a clipped second `drawFramed` of the untouched source; the
  histogram, `delivered()` and `snapshot()` stay the whole picture. The
  Trips/Studio modals pass no frame and are unchanged.
- **The crop has its own Apply to** (`copyCropTo`, pure, tested): aspect +
  framing onto the selection, else every other picture — never the develop. A
  pan is copied as is: `framingTransform` clamps it to each picture's slack.
- **The crop stage draws `delivered()`, never `source.image`**: a crop is
  judged on the developed picture, repainted from the held raster copy
  (`held-grader.ts`) on `source` AND `cube`, never graded again per drag.
- **`DevelopViewport` stays MOUNTED (`hidden`) while the crop is open**: its
  paint is keyed on the picture, not the canvas element, so an unmounted one
  came back BLANK.
- **The framing has its own 200 ms write-through timer**; the aspect is written
  to the roll AT ONCE (it is the document's, not a draft) and the history's
  700 ms label coalescing makes a drag ONE undo step. An untouched framing is
  `null`. The open tab lives in `RollEditor`, so stepping keeps it.
- **A cell is the picture as delivered — graded AND framed** (`framedThumbnail`).
- **The free shape rides `aspect`** (`'free:<w/h>'`, four decimals, 1:5..5:1,
  `crop-aspect.ts`): every ratio reader is unchanged, `aspectFileTag` names the
  file `-crop`, and `rollProgress` counts an aspect other than `'original'` as
  a crop even with an untouched framing.
- Gestures are heard on the STAGE, not a canvas inside it, with `touch-none`
  there (a fixed-height box, not a scroller) and `blockNativeZoom` — a phone's
  fingers land either side of a small picture.
- The docked inspector wears the two editors' frame (`frontend.md`).

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
- **An export is named EXACTLY after its picture** (2026-09-20, his own
  convention): `DJI_0101.JPG` → `DJI_0101.jpg`, no `-developed`, no shape tag.
  He keeps a source folder and a Gallery folder side by side and pairs them BY
  NAME — by eye, and the way Winnow's `reconcile` would — so a word added to
  the name breaks the pairing, which is the whole point of the file. Only the
  extension changes: a JPEG leaves, whatever the picture was developed from
  (his call; he will say if another format is ever wanted). Collisions are
  numbered, never stamped with a date (`shared/sources/unique-name.ts`:
  `-1`, `-2`, `-3`, case-folded because his volume is) — inside a run, where
  two crops of one picture want one name, and against the folder being written
  into. `aspectFileTag` went out with the tag; `crop-aspect.ts` keeps the rest.
- **The folder is picked AT THE CLICK, before a pixel is rendered**
  (2026-09-20): `pickDeliveryTarget()` first, the render second,
  `deliverFilesTo` last — `frontend.md`'s picker trap, found here as "Export
  this picture works, Export the roll does nothing". A working preview is
  never exported (`develop-media.md`), and the EXIF is stamped INSIDE the
  render, on the base JPEG before any Ultra HDR container is written round it
  (`RollRenderOptions.stamp`, `hdr.md`).
- **A write NEVER replaces without being told to** (`RollExport.replace`, off
  by default; `writeItems` takes `replace` with no default so every caller
  says which it means — the Studio's and Trips' say `true`, which is what they
  always did). Off, the folder is asked about each name as its turn comes
  (`nameTaken` → `uniqueNameAsync`) and a taken one is numbered; the run's
  sentence says how many were. The probe goes to the real file system, so a
  case-insensitive volume answers about `DJI_0101.JPG` when asked about
  `DJI_0101.jpg` — which is the case that matters, since an export named after
  its picture is exactly what would otherwise land on its own original. A
  DOWNLOAD cannot honour the choice: the browser numbers a repeat itself.
  **And the run SAYS it when the folder it was given is the one the pictures
  came from** (2026-09-21, his call), offering a suffix — the one exception to
  the exact name above, never the default. Only where a directory HANDLE was
  picked: a download has no folder to compare, and the browser and the OS name
  it. The comparison is `FileSystemHandle.isSameEntry` against the handle the
  roll already remembers for its local pictures (`develop-media.md`), never a
  path or a name, so a folder that merely looks alike answers false.
- **A delivered picture carries the ORIGINAL's EXIF, whatever its pixels came
  from** (2026-09-20, the maintainer's rule: *"il faut que je puisse à la fin
  exporter… avec les informations du fichier original"*). Where the pixels come
  from and where the metadata comes from are two questions, and only the first
  is a trade-off — he develops on a proxy for the speed of it and still needs
  the file he keeps to read like the capture. The run asks in this order: the
  original itself when it has it (fetched for the pixels, or held from a
  previous run), else `MediaOrigin.fetchOriginalHead` — a quarter of a megabyte
  instead of twenty-odd, and what stops the transfer is CANCELLING the body,
  since Winnow's download route ignores `Range` —, else what the instance
  vouched for. The choice and the block are `shared/exif/stamp-exif.ts`; a
  picture that ends up on the poorest account, or on none, is SAID in the run's
  sentence rather than filed away silently. Whatever the account, the block
  says `Software: Atelier` (since 2026-09-21, the copied one included) — the
  mark that keeps an export sitting beside its original from being offered as
  the camera's file (`renditions.md`, R1b).
- **Every delivered file is SIGNED, and carries the author's rights**
  (2026-09-23, M1 of `docs/lightroom-gaps.md` §9). The signature is not a
  switch: `software-mark.ts` READS it to refuse the suite's own exports as a
  capture's rendition, so a picture with NO account now leaves with a block of
  the signature alone (it used to leave bare) plus `xmp:CreatorTool`. The
  identity (`creator` + a copyright TEMPLATE, `exif/delivery-meta.ts`) lives on
  the PRESET BOOK (`PresetBook.identity`), because the book is the one personal
  document every device already finds; `mergeBooks` keeps the edited copy's.
  No default name — the site is public, so his name is nobody's default; the
  template's `{year}` is the CAPTURE year (`captureYear`, the export's own
  when unknown). Written over the camera's `Artist`/`Copyright` (an in-camera
  owner string is not the author), in EXIF AND XMP: EXIF ASCII is now written
  and read as UTF-8 (a `©` came out `)` through the old 7-bit mask), and the
  XMP is ONE packet — `withXmpPacket` replaces, and `wrapUltraHdr` takes the
  stamp's packet OUT of the base and folds its `rdf:Description` into the
  container's, since two packets in one file is what readers disagree about.
- **A picture's title and caption are the PICTURE's** (2026-09-23, M2):
  `RollPicture.title` / `caption`, stored trimmed and absent when empty
  (`wordsOf`, `setPictureWords` — the same roll back when nothing changed, so
  a blur is no undo step). Carried by no preset, paste or Apply-to (two frames
  of one scene are captioned apart), but by the `.roll.json` backup. The
  caption is written as `ImageDescription` too (Lightroom's and Capture One's
  Caption); a title is XMP only — EXIF's `XPTitle` is Windows-only UTF-16 and
  not worth a tag. A picture with no caption keeps the capture's own
  `ImageDescription`. Typed into drafts committed on blur, in the Export tab's
  Metadata section; text fields keep P/U/M (the editor's keys yield to typing).
- **What leaves is ONE choice per ROLL, in groups** (2026-09-23, M3,
  `exif/meta-groups.ts`, `RollExport.metadata`, absent = All). A roll because
  "this set goes online without its position" is said of a delivery, not of
  a frame. Seven groups (camera · exposure · time · position · maker notes and
  serials · title and caption · creator and copyright) plus the signature
  drawn LOCKED among them, so its missing switch does not read as an
  oversight; presets All (default — GPS leaves, his call) · Share online (no
  position, no serials) · Minimal (rights + signature). The one cost, said in
  the panel: `keepsWholeBlock` (every capture group AND the maker notes) is
  what lets the camera's block be COPIED; anything less REBUILDS it from the
  fields `ExifData` names, and maker notes, serials and unnamed tags stay
  behind. A group left out CLEARS the camera's own value too (`authorTags`:
  string writes, null clears, undefined keeps) — rights off means no owner
  string either. The copyright's `{year}` is still the capture's even when the
  time does not leave. The run's "no body / no EXIF" warnings fire only when
  the choice asked for what was missing.
- **The workbench holds TWO files since 2026-09-21: the picture's, and the one
  on the stage** (`renditions.md`, «R3a is BUILT»). `file` stays what the
  picture IS — its identity, its origin, its EXIF, what the export hook
  measures — while `shownFile` is the rendition drawn (a fetched original, a
  folder sibling): it is what `useDevelopPicture`, the chip and the kernels'
  `fullWidth` read. A new consumer of the bytes on screen takes `shownFile`;
  one that needs the picture's identity takes `file`. Since R4 the export
  follows the same answer (`renditions.md`, «R4 is BUILT»): a stored
  delivered rendition is fetched through `deliveredSourceFor`, the three
  words are gone from the roll and the panel, and *Proxies only, for this
  run* is the editor's switch, never the document's.
- **The row NAMES the pixels it measured** (2026-09-20): `sourceLabel` reads
  `Camera render` where the file in hand is a RAW — `MeasuredPicture.viaRawPreview`
  from `measurePicture`, which now decodes through `decodePhotoSource` — so a
  DNG says `Camera render 960 px → 1920 · ×2.00 upscaled · asked 1920` instead
  of `File 8064 px`, which was the one sentence the plan must never say. The
  fidelity half of it is `develop.md`, «A picture says its PIXELS».
- **A RAW original is reached only through the render INSIDE it, and only
  when that render is bigger than the proxy** (2026-09-20, correcting
  decision 4 — `develop-originals.md` §7.4). `decodableOriginal` still names
  what a browser reads on its own (jpg/png/webp/avif/gif/bmp — no HEIC, no
  TIFF), and a RAW now goes down its own branch: `originalPixels` answers
  with `OriginalInfo.render`, which is null until the file's head has been
  read, and `choosePixels` refuses to act on a guess while it is. The sizes
  come from `rawSizesFrom` over a megabyte of the original's head — the read
  the run was already making for the EXIF, raised from 256 KB — cached for
  the session in `original-cache.ts` (`heldRawRender`, `undefined` = not read,
  `null` = read and the file said nothing), and the *Delivers* row reads the
  SAME cache, so the row and the run can never disagree. The frame is no
  longer planned against the sensor's pixels either: they can never be
  delivered here, so `· asked 8064` was a promise nothing could keep. A RAW
  original that does win is labelled `Original render`, never `Original`.
  **Why it matters**: a DJI DNG holds a 960 × 540 render — `Auto` fetching
  74 MB for 0.52 megapixels is the mistake the whole branch exists to stop.
  The sensor is reached by developing on `base: 'raw'`, never by the export.
  Measured in the pane on two synthetic DNGs (`testing.md`'s recipe): the
  960 px one delivered `DJI_0101.jpg 2048×1152` with **zero** full fetches
  and the row read *"its original is a RAW whose own render is 960 px against
  the proxy's 2048 — the proxy is what leaves"*; the 6048 px one delivered
  `DJI_0202.jpg 6048×4032` after ONE fetch, the row reading `Original render
  6048 px → 6048 · exact`, and Proxies held it at `2048 · exact · asked 6048`. Driven at **390 px** too, where the row lives in the
  docked drawer: `Camera render 960 px → 960 · exact`, no horizontal
  overflow, and *Export this picture* wrote `DJI_0101.jpg 960×540` — the
  picker-first order (`pickDeliveryTarget` → render → `deliverFilesTo`) is
  what makes that work at any width, and it is unchanged.
- **The export climbs the RAW ladder to the top rung the FILE can give, and
  never crosses `proxy` → `gain`** (2026-09-20, the maintainer's "always max"
  with the one boundary it does not override). Within the RAW rungs there is
  no reason to deliver less calibration than the body was measured for — it
  is two GPU passes — so the run reads `topRung(cal)` and renders through
  `calibrationAt` at it. Crossing from the proxy to the sensor, by contrast,
  is refused exactly as it always was (`develop-originals.md` §7.4,
  `raw.md`): numbers nobody has seen on the sensor's data are never applied to
  it at the door, and a RAW never checked in Develop still leaves from its
  render with the run saying so. Because the PREVIEW already carries the
  calibration from `gain map` up, the climb changes the file only for a
  picture left standing on `gain` — and that is the one case the *Delivers*
  row names: *"developed on its RAW at Gain — the export climbs to Gain map +
  warp, the calibration its own file carries, so the file will differ from the
  stage"*. Measured in the pane.
- **Each picture renders through its OWN cube** (`stack.composeWith(develop)`),
  decoded whole, graded at source density, then `drawFramed` — the crop stage's
  transform, so the file is the stage. The frame seam of `develop-tool.md` §6
  lives here, not on `exportPhotoVariant`.
- **A fetched original is held for the session by asset id**, never persisted
  (decision 3): the second export of the same picture pays no fetch, whatever
  mode. Measured in the pane: Auto → 1 fetch, Proxies → 0 and the proxy's
  pixels, Originals → 0 and the held original's pixels.
- **Sending a roll home is UNPLUGGED** (2026-09-20, the maintainer's call — a
  roll delivers to the FILE SYSTEM only). Read in Winnow's own `main` before
  taking it out: `/api/upload` reads `files` and `paths` alone and IGNORES
  `original_asset_id` and `chapter_id`; `planDestination` files an upload into
  `{incomingDir}/{device}/{YYYY}/{YYYY-MM-DD}/{file}`, so it lands in the
  INCOMING as a new capture and never in a finals (Gallery) root; and
  `reconcile` pairs an edit only inside a finals root, on the lowercased
  basename sans extension plus `captured_at`. A canvas-made JPEG carries no
  EXIF, so it would also file under `unknown/<today>`. His Gallery volume is
  mounted READ-ONLY on purpose, which is the deeper reason the feature waits.
  Re-plugging is one element in `ExportPanel` once Winnow can receive a final:
  `use-roll-export.ts` still records `RollRun` (the files, each one's
  `assetId`, the one instance) and `SendFinalsPanel` still links each file to
  ITS capture (`FinalCandidate.assetId`, `FinalsItem.originalAssetId`, one
  upload per file, a run offered home only when every picture came from ONE
  instance). The Studio's own send is untouched.
- `MediaOrigin.name`/`bytes` are what say whether an original is decodable and
  what it weighs — read from Winnow's row at materialise; a file the person
  opened has no origin and nothing to decide.
- **Trap — verifying identity from the page**: `import('/atelier/src/…')` in
  the pane makes a SECOND module instance once HMR has stamped the app's with
  `?t=`; register through the URL `performance.getEntriesByType('resource')`
  lists, or the app never sees the origin.

Verified again in the pane on 2026-09-20 for the export pass (the name, the
overwrite guard, the EXIF): a camera-like JPEG built in the page (gradient +
a block from `exif-build.ts`) answered the Library's transient file input
(patch `HTMLInputElement.prototype.click` for `type === 'file'` — the app has
no standing file input to set `.files` on), `showDirectoryPicker` returned an
OPFS directory, and two runs with Replace OFF wrote `DJI_0101.jpg` then
`DJI_0101-1.jpg` with the sentence *"1 picture written · 1 numbered, the folder
already held that name"*; a third with Replace ON wrote no third file. Both
files read back through `parseExif` with the make, model, lens, ISO, shutter,
aperture, focal length, GPS, altitude and capture time of the original, and
decoded at 1600×1200 — the splice does not break the JPEG. NOT verifiable
there: the case-insensitive collision (`DJI_0101.JPG` against `DJI_0101.jpg`),
because OPFS is case-sensitive while the volume this lands on is not.

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

## Undo and redo over the roll (2026-09-15, rev. 2026-09-16)

**Fact.** `DevelopTool` wires the shared history engine exactly as Trips does —
watched at its own `handleChange`, reset by the sync machine's `onReplace`, the
buttons in the `headerExtra` slot beside the pill; the engine's rules are in
`architecture.md`, the per-tool reasoning in `roadtrip.md`. The label is the
picture the route names (`picture:<id>`), so one picture's slider never merges
into the next picture's. **How to apply**: the editor's write-through is what
the history sees, so one step is one write, not one slider frame — and a draft
that has not been written through yet is not a step.

**An editor with no Done needs its drafts level with the document in BOTH
directions (`shared/develop/write-through.ts` + `use-write-through.ts`).** The
maintainer's report was flat: *"undo redo dont work in develop"*. Half of it was
the ⌘Z owner (`frontend.md`); the other half is that `PictureWorkbench` reads
`entry.develop` and `entry.framing` ONCE — right, as the never-inherit rule, for
a workbench keyed per picture — and so ignored the roll moving under it. An undo
stepped the roll back correctly and the screen did not change at all: the
sliders, the preview (the draft rides `stack.setDevelop`) and the crop stage all
still showed the undone numbers, and the next nudge wrote them straight back
over the step. **The rule, and its whole difficulty, is telling the two sides
apart**: during a gesture the document LAGS the draft by the write's rest, so a
lagging value must not read as somebody else's edit — which needs one remembered
value, the last one handed to the document. The draft moved → a write is owed;
the document moved to something this editor did not write (an undo, a redo, a
batch verb, an instance's copy) → drop what was owed and re-seed. Dropping
matters on its own: an undo landing inside the 200 ms rest would otherwise be
put back a moment later by the write already in flight. A gesture that ends
where it started owes nothing. The decision is pure and tested; the hook owns
only the timer and the unmount flush (which is what keeps a picture's numbers
when you step to the next one).

Verified in headless Chromium against the running editor (a JPEG built on a
canvas and dropped in through a synthetic `DataTransfer`): the exposure slider
moved, ⌘Z **with the slider still focused** put it back, ⇧⌘Z returned it, both
buttons the same, the crop's zoom stepped back and forward on its own draft, and
an undo pressed inside a gesture's rest held instead of being overwritten.

## The crop is a ZONE drawn over the whole picture (2026-09-19)

**Decision (maintainer, over two prototypes he reviewed and accepted in
full).** The D8 crop stage made the crop zone BE the canvas, letterboxed in the
stage: a handle changed the canvas's aspect, so the whole view resized, the
axis it was fitted on flipped as its ratio crossed the stage's (a horizontal
drag moved the vertical), the zone grew from its centre and the picture
re-zoomed to cover, so what was cut was never seen. He wants the classic crop:
the whole picture still, a zone drawn over it, the cut part under a veil, the
picture turning UNDER the zone. Develop tool only — Trips keeps its framing
grammar and its Whole.

**Nothing migrates.** `shared/develop/crop-rect.ts` (pure, tested) turns a
zone `{cx, cy, w, h}` — source pixels, the TURNED picture's frame, origin at
its centre — into the `aspect` + `Framing` (`fit: 'cover'`) the roll already
stores, and back through `framingTransform` itself, so the zone read from a
stored crop is what the renderers will cut (the pan clamped as they clamp it).
Round-trips are pinned at 0°, 2.6°, 45°, 90° and with flips. Rules a later
agent must keep: (1) **every gesture is a candidate then a clamp** —
`clampToward` bisects from the last VALID zone toward the candidate,
interpolating the four EDGES, which is what keeps a handle anchored, a locked
ratio locked and a drag stopped at the edge instead of jumping; a starting zone
that is not valid is returned untouched. (2) **Valid** = every corner inside
the turned picture (Fill's invariant), no smaller than `MAX_FRAMING_SCALE`
allows, a ratio inside the free aspect's 1:5..5:1. (3) **A move slides**: the
whole move as far as it goes, then the rest on x, then on y. (4) **Rotation
works from an INTENT** (`fitIntent`): the last zone the author drew, shrunk
just enough at the new angle and never grown past it, so 3° then 0° gives the
drawn zone back; a centre that fell off is pulled toward the middle only as
far as the smallest zone needs. (5) `EPS` in the containment test is 1e-9 of
the long side: at 1e-6 a 3000 px picture let a zone overhang by 3 mpx and the
edge tests failed — keep the tolerance float-sized, never pixel-sized.

**The stage** (`CropStage` + `use-crop-zone.ts`, replacing `FramingStage`;
`resizeAspectRatio` retired). Rules: (1) the zone is DERIVED from what the roll
stores (aspect + the framing draft), never kept beside it — an undo or a batch
verb moves it with no wiring; only the lit chip and the intent live in the
hook. (2) The view is fitted ONCE on the quarter-turned picture: a fine angle
never refits it, and nothing a gesture does resizes it. (3) One canvas draws
picture, veil (even-odd), dashed outline, thirds and handles; the size tag is
the only DOM element, in the FILE's pixels (`RollExports.openSize`), not the
decoded preview's. (4) The stage takes focus on a press, and only a FOCUSED
stage claims the arrows (`preventDefault`, which the editor's window handler
respects) — unfocused, ←/→ still step the roll. `X` is an editor key
(`'swap'`), answered on the Crop tab only. (5) `cropFromZone` snaps a scale
within 1e-6 of 1 and a pan under 1e-9 to exact values: the largest zone is
built a hair inside (`fitAround`'s 1 − 1e-9), and a stored `scale:
1.000000001` made an untouched picture count as developed — measured in the
pane. (6) A preset without a turned twin (4:5) swaps into Free.

**Rotation under the zone** (`use-crop-zone.ts`): Straighten is the FINE
angle (±45° inside the current quarter, `splitRotation`), the quarter turns
turn the zone WITH the picture (`quarterTurnZone`, exact, no refit), the flips
mirror the zone's centre and negate the angle (`flipFraming`'s rule), and
Level turns a line drawn on the stage into a correction of the fine angle.
The hook remembers what it last WROTE: when the stored crop differs (an undo,
a batch verb), the intent is re-read from the zone on screen, so a rotation
after an undo never refits a stale zone. Verified in the pane on a JPEG with a
3° horizon: Level along it gave −3.0° with the zone shrunk just enough and the
dense grid up; Straight gave the 4:5 zone back and the roll stored `framing:
null`; +90° turned a 4:5 zone into 5:4 over the same part; Horizontal then
stored `rotation: -90, flipX: true` and the Develop viewport showed the same
crop mirrored. Trap: the pane's screenshot can lag a click by a frame — read
the stored roll before concluding a button did nothing.

**Phone and the view.** A pinch, the wheel and the ± pill zoom the stage's
VIEW (`CropView` in `use-crop-zone.ts`, 1..8×, about the fingers' centre,
measured from where the pinch began) — never the zone; `Z` toggles it on the
Crop tab. A second finger cancels the one-finger gesture and the finger left
after a pinch starts nothing. A finger's hit radius on a handle is 22 px (a
44 px target) against 10 for a mouse, and the handle keeps its GRAB offset: a
finger landing 19 px inside the edge made the edge jump to it until the offset
was kept. The inspector is the D6 `DockedDrawer` under the stage, so it never
covers the zone. Verified in the pane at 375×812 with synthetic touch
pointers: a two-finger spread took the view to 400% with the stored framing
byte-identical; in Free, a finger 19 px inside the right edge dragged 60 px
moved that edge exactly 60 px, the left edge and the height untouched (read
back by hover-scanning the stage's cursor zones); under Original the same drag
kept 1.5:1 about the centre. Not driven: a real phone, a real multi-touch.

**An untouched picture opens on Free** (2026-09-21, the maintainer: *"quand je
vais dans crop, j'aimerais que par défaut l'option soit réglée sur free, comme
ça je ne perds pas de temps à faire un clic"*). `openingCropChip`
(`crop-aspect.ts`, pure, tested) is the one reader: untouched — `'original'`
with a default framing — opens on Free; anything else opens on the chip its
STORED crop names, so a locked ratio comes back locked and `'original'` is
still `'original'` where it was deliberately chosen. `reset` lands on Free for
the same reason: it leaves the picture untouched. **It writes nothing** —
`setChip('free')` has no ratio to fit — so a picture opened on Free and left
alone still stores `'original'` with an untouched framing, and `rollProgress`
still counts it as uncropped. The rule is worth keeping wherever a default
chip is added: a default that DIRTIES a document is a different thing from a
default that only says what the next gesture may do.

**Crop to the view** (2026-09-23, the maintainer: zoomed in on the stage he
often likes the view AS a crop, and wanted iOS Photos' discreet offer rather
than trips back and forth to the Crop tab to find the same zone again). A
zoomed Adjust stage offers it three ways — a quiet `crop` pill heading the
top-right corner's column (the loupe's status under it, so the verb never
moves), `⇧C` (`'crop-view'`, the one shift chord besides `?`), and a row of the
`%` menu. Rules: (1) the zoom stays LOOKING (`frontend.md`, «Two uses, one
hand») — no gesture writes; only the explicit verb does. (2) The arithmetic is
`zoneFromView` (`crop-rect.ts`, pure, tested through `framingTransform` under a
turned, flipped, panned crop): the visible share of the DELIVERED canvas
(`visibleWindow`, `pan-zoom.ts`), the border cut away, mapped linearly into the
zone the canvas shows — the canvas is the zone the right way up, so rotation,
flips and pan are kept for free. (3) It is offered only when it would change
something (null at the fit, or over margin only) and never over a legacy
`contain` framing, whose canvas is not its zone. (4) It writes through
`useCropZone().cropTo` (chip → Free: the shape is the screen's), and the view
returns to the fit AT ONCE (`PictureZoom.fit`, not the animated reset) — the
new picture at the fit IS what was on screen, measured headless to 0.004 of
the frame. (5) A view closer than a crop may go (8×) grows to the smallest
zone about its own centre and is slid in by an exact clamp in the picture's
axes; **trap**: `fitAround(…, cap = 1)` cannot grow a zone, and asked to it
pulls the centre along a diagonal to the MIDDLE — the first build cropped a
4000 % view by an edge to the picture's centre. One undo step, like any crop.

## A picture may be delivered on a BORDER (2026-09-19, roll v2)

**Decision (maintainer, over a second prototype).** Coloured bars or margins
round the crop, a subsection of the Crop tab; blur is wanted. `RollPicture.border`
(`null` = the file IS the crop) — `aspect` (the file's shape or null for crop +
margins), `fill` (`#rrggbb` or `'blur'`), `margin` {x, y} as fractions of the
CROP's short side, the picture always centred (v1). `border-layout.ts` (pure,
tested: the layout, the reader, `legacyWholeBorder`, a box blur),
`border-paint.ts` (the ONE painter: export, cell, viewport, panel preview).
Rules a later agent must keep:

- **`ROLL_DOC_VERSION` is 2.** The lift lives in `readPicture` and is
  idempotent. `photo-editor.md`'s edit-stack migration becomes v2 → v3.
- **A crop leaves at the source's OWN density** (`deliveredLayout`,
  `cropZoneSize`): the file is the zone (+ border), capped by the long edge,
  never the aspect box with a small zone blown up into it — which is what D9
  did, a zoomed crop reading `×1.50 upscaled`. So a proxy is only ever
  upscaled against what the ORIGINAL could give, and `Auto`'s question is
  unchanged. The *Delivers* line names the crop's long edge when a border makes
  the file larger than it.
- **Legacy Whole** (`fit: 'contain'`, D8): read as zone = whole picture +
  `border {aspect: <old aspect>, fill: '#000000', margin 0}` ONLY when exactly
  representable without the picture's size — scale 1, a half turn at most, no
  pan (any pan when the aspect was `original`). Same composition, but now at
  the picture's own density instead of the aspect box's: bigger file, same
  picture. Anything else (a quarter turn, a zoom, a pan, a tilt) STAYS
  `contain` and renders through `drawFramed`'s legacy path unchanged; the crop
  stage reads it as its cover twin and the first crop gesture replaces it.
- **The blur fill blurs a 48 px copy of the crop** (three box passes, then
  scaled to cover, darkened 18%), so preview and file blur the same picture
  whatever their size — no `ctx.filter` (Safari).
- **Apply to is TWO verbs** (the maintainer's one change to the prototype):
  `copyCropTo` never touches the border, `copyBorderTo` (pure, tested) never
  the crop, so a roll can wear one border over crops that each differ.
- **"Edited" has ONE answer, `pictureEdits`** (`roll-types.ts`, 2026-09-23):
  develop, look, crop (an aspect alone counts), border, perspective, lens,
  detail, repair, layers — a value dragged back to its default is none, and
  the `rendition` is a choice of bytes, never an edit. The filmstrip's dot and
  tooltip, `rollProgress` and the remove confirmation all read it: they had
  three different tests, and an hour of heal spots was removed without asking.

Verified in the pane through the app's own `renderRollPicture` on a 3000×2000
half-blue/half-green JPEG: a 10 % vermilion border on a 1:1 file → 3400×3400,
vermilion outside, blue and green inside; a 1:1 crop at scale 2 → 1000×1000
(the zone, native density); a blur border on 9:16 → 3200×5689 with the fill
blue on the left and green on the right, darkened (208 against 254).

**The Borders UI** (`BorderSection.tsx`, under Crop in the same tab): a switch
in the section's header (off → `null`; on again restores the last border this
visit, not the default), the FILE format (Free = `aspect: null`), four swatches
+ `<input type="color">` + Blur, two margin sliders 0–25 % linked by default,
and a "What the export delivers" preview drawn by `drawDelivered` with the
export's size (`openDelivery.out`) under it — the stage keeps the whole
picture for cropping, so the panel is where a border is seen while set. Every
change is written to the roll at once (`copyBorderTo(roll, [id], …)`), like
the aspect. Verified in the pane: on, 4:5, Blur → preview 0.8 and "delivers
2512 × 3140 px"; *Export this picture* (showDirectoryPicker stubbed) wrote
`A-tilt-developed-crop.jpg` at 2512×3140 whose pixels at three points equal
the preview's exactly (blur top 89,133,178; sky; grass); *Apply borders to 3
other pictures* gave the three the border and left every aspect and framing
byte-identical; after a reload the Develop viewport showed the crop on its
blur. Not driven: a real phone, the free colour picker's native dialog, a
Winnow original through Auto with a border (the arithmetic is tested).

## 2026-09-19 — The stage gets its room back: help behind a key, facts in a corner

**The maintainer, looking at the editor: *"we have a bunch of text under the
media preview, keyboard shortcuts legend etc, lets have it under a shortcut: h
or a help icon"* and *"we also have edit details displayed underneath the media
preview, i dont need to see them"*.** Four lines of grey prose sat under every
photograph — the develop's numbers, the picture's material, which gesture
applied, and six shortcuts — and on a narrow screen they wrapped to eight.

**Two different things, so two different answers.** What TEACHES (the six
shortcuts, and every gesture hint that used to ride the caption) is read once
and then costs the picture room every day after: it went behind `H`, `?`, and a
`?` verb in the stage bar (`shared/develop/DevelopShortcuts.tsx`), where it
could finally say MORE than it did as a sentence — the drag, the pinch, the
divider's handle, the filmstrip's modifiers. What the picture SAYS about itself
is still worth having at hand, so it moved ONTO the photograph: a corner stack,
one fact per line, toggled by `I` and off by default (`DevelopViewport`'s
`facts` prop, `developLines` in `develop.ts`, `useLocalFlag`). Over the picture
rather than under it because a stage is where the room is, and a corner costs
nothing when there is nothing to say.

**Rules that came out of it.** (1) A fact list and a settled row must never be
able to disagree: `developLines` is the source and `describeDevelop` is its
`join(' · ')`, asserted in the test — and no entry may contain the separator, or
a corner draws two facts as one. (2) The CROP stage keeps its line UNDER the
picture: its framing handles reach into every corner, so an overlay there would
cover a grip. (3) `?` is read BEFORE `editorKeyAction`'s blanket refusal of
shift chords — on most layouts it cannot be typed without shift, and a help key
nobody can press is not a help key. (4) A browser preference, never a document
(`shared/ui/use-local-flag.ts`, the generic shape of the rule `use-pixel-view.ts`
and the gallery's card/band choice already followed).

The Develop SHEET (Trips, the Studio) keeps its caption under the picture: it
is a modal with no `I` and no stage bar, and the facts are the only thing it
says. If it ever grows the overlay, it grows the key with it.

Driven headless: the legend is gone from the roll editor's footer, `I` toggles
the corner stack (`+0.7 EV`, then the picture's material) and survives a reload
as `0`/`1`, `H` opens AND closes the sheet, `?` opens it, Escape and the bar's
verb close it.

## 2026-09-19 — The compare is a switch, and a picked point is visible

**The maintainer, on the subject mask: *"we need a way to toggle on and off the
a/b compare feature vertical, because when I pick a segmentation layer i can not
see and it also move the compare line… when we pick grey we have the right
behavior, we disable the compare feature temporarily until the pick is done"*.**

Three faults under one report, and the third is the one that mattered.

**(1) The split hid the very thing being edited.** A picture left wiped at 0.5
draws the layer's effect on ONE side; a subject tapped on the other side
visibly did nothing. **(2) A tap that missed the frame fell through to the wipe
and threw the divider.** Both are cured by SUSPENDING the compare whenever a
mask tool holds the pointer — the rule the grey dropper already followed by
taking the pointer whole. `useDevelopPicture` now derives `suspended` from
`paint || picking`: `comparing` goes false, the shown wipe goes to 0 (the whole
picture delivered), the divider is not drawn and a drag places nothing. The
stored wipe is REMEMBERED, so the line is back where it was the moment the tool
is put down. Beside it, a plain switch the host owns — `compare`, a browser
preference, on by default — because a divider is a second thing on a photograph
and the hours spent on a mask are exactly the hours it is in the way.

**(3) The markers did not exist.** `MaskPanel` documents *"tapping a marker you
already placed removes it"*, and the code did hit-test one — but nothing was
ever DRAWN, so there was nothing to aim at. That is the literal reading of "i
can not see", and it needed the forward map: `framePoint` (`media/framing.ts`,
the exact inverse of `unframePoint`, which the spec had been carrying as a
private copy) plus `DevelopPicture.stagePoint`. **`stagePoint` is computed from
the view's own arithmetic (`view.rect`), never from a measured
`getBoundingClientRect()`** — during a render the canvas still carries the
PREVIOUS transform, so a measured marker lags the picture by a frame on every
pan, the same class of bug as the async-paint size read.

**The + and − the maintainer asked for, as native as they go.** The viewport
wears `cursor: copy` — the browser's own `+` badge — while a tap-gesture tool is
armed, each marker draws a `+` disc, and the one under the pointer loses its
vertical stroke to become `−`: the icon says what the CLICK will do, not what
the marker is. A marker answers its own press and STOPS it: letting it bubble
would run the stage's hit-test against state the click had already changed,
which removes twice and lands as an add. Markers are drawn whenever the subject
layer is open (a picked point is a fact about the layer) and removable only
while Pick is on.

**A layer's visibility is a VERB** (his fifth ask): an eye / crossed-eye
`IconButton` in the layer's own row of verbs, with the name struck through when
it is off. The bare checkbox it replaces read as "include this one" rather than
"show it", and an unticked box only ever says which state it is NOT.

Driven headless: the pill splits and unsplits, a drag while off moves nothing,
the divider returns to 0.45 where it was; Pick arms the `copy` cursor and holds
the compare, a tap draws its marker at the tapped pixel, a second adds, clicking
a marker takes it off, putting the tool down brings the divider back; the eye
hides and shows.

## 2026-09-22 — The compare reads BEFORE → AFTER, left to right

**The maintainer: *"lets invert the compare after/before — I prefer
before/after, it will be more coherent with other places"*.** The shader's
split had put the GRADE on the left since the LUT tool's first version
(`lut-gl.ts`), and everything that drives it inherited that: the LUT Studio's
wipe, the look gallery's scene, the Develop stage's own 2D wipe. The Studio's
overlay stage had always done the opposite — the original on the left, the
composite on the right (`use-overlay-stage.ts`) — so the suite disagreed with
itself, and the LUT side also disagreed with Lightroom and Capture One, which
the code claimed to be copying.

**One direction now, everywhere: the picture AS SHOT on the left of the
divider, the corrected one on its right.** How to apply: `u_splitX` is the
divider's position and the original is drawn where `v_uv.x < u_splitX`; a label
beside the divider says `Original` left, `Graded` right; the Develop stage's
pill says `before · after`.

**The consequence to watch in `useDevelopPicture`**: `wipe` is no longer "the
share painted graded" but the DIVIDER's position, with the as-shot picture to
its left — so **no split is 0, not 1**. Every reader of it flipped with the
meaning (`shownWipe`, the stage paint, the loupe's paint, the divider line, the
pill), and a `wipe < 1` left anywhere would draw a split nobody asked for on a
picture at rest.

## 2026-09-22 — The stage bar: four controls, and nothing inserted

**The maintainer, looking at the row above the photograph: *"elles ne sont pas
toutes uniformes… la pilule de changement de proxy n'a pas du tout les mêmes
codes visuels que les autres… les boutons copy, paste, as shot prennent de la
place… peut-être qu'il serait temps d'appeler cette option reset de manière
explicite… le bouton compare, je pense qu'il peut être plus discret, on pourrait
reprendre l'exemple qui est fait dans le studio… lorsque l'on clique sur plus,
automatiquement, si on reclique une deuxième fois sans changer de position de la
souris, on se retrouve sur le bouton pixel"*.** Seven controls in four visual
codes. Variants were drawn for each fault on one canvas
(https://claude.ai/artifact/PsWGj7UBtDpz9EGNjz6DUz) and he picked **A2 · B2 ·
C1 · D1**, with E2's one block of verbs; what each buys is below, and what it
costs is the line after it.

**The NAME is the menu of the capture's files (B2).** The file name and the
fidelity chip answered the same question — which bytes are on screen — so they
are ONE control at the left of the bar: `DJI_0202.DNG` in mono, the chip as its
faint uppercase suffix, a `▾` at the end, and `DevelopBaseMenu`'s own list of
renditions under it. It costs no pill, and that is what pays for the real win:
the chip used to be `@max-[880px]:hidden`, so a phone could not reach the
rendition at all. **How to apply**: `name` is a prop of `DevelopBaseMenu` now,
and when there is nothing to choose (one row, no rung) it renders the same two
spans as TEXT — a chevron over a menu that cannot change anything is an
invitation to a dead end.

**Copy · Paste · Reset as one WELL of glyphs (A2), and the stage's own two
verbs join them in it (E2).** Three underlined links were the bar's third
visual code and ≈ 150px of it. A menu was drawn beside this one and NOT taken:
every verb stays at one click, which is what a photographer pasting the same
light down a filmstrip actually does. `DevelopActionsGroup`
(`shared/develop/`) draws the three `IconButton`s, and `children` — past a
hairline — are the HOST's: the Develop bar puts its `A/B` and its `?` there, so
the row ends with ONE block instead of five loose pills. **How to apply**:
Reset is a GHOST button, set apart from two benign verbs because it throws work
away, and it greys with `asShot` so the block also says whether there is
anything to undo; the full sentence, `Reset to as shot` included, lives in each
tooltip, which is the whole of his "appeler cette option reset de manière
explicite"; `clipboard={false}` keeps the well for the host's verbs alone on a
stage with no develop to copy (the crop). The modal keeps
`DevelopClipboardActions`: a sheet has room and no stage bar. `Icons` gained
`copy` and `paste` — the suite had neither.

**The compare is `A/B` (C1)**, the Studio's own word and its exact colours
(`border-accent bg-accent-wash text-accent-ink` on, plain and muted off), at
`IconButton`'s height inside the well. Three states still, and the suspended one
— a mask tool holding the pointer — is a DASHED border rather than a third word.
**The trap it walked into**: neither it nor the `?` can be `IconButton` plus an
override, and neither could ride `developPillClass` (which carries `text-muted`)
— two utilities of one property resolve by Tailwind's order, not the class
list's. Both spell their own shape at `IconButton`'s exact height, so the well
still reads as one family, and take their colour at the call site.

**Nothing is INSERTED in the bar any more (D1).** The `smooth ↔ pixels` button
was rendered only past 1:1, so crossing 100 % pushed every verb after it
sideways and a second press of `+` landed on `pixels` — his report, exactly.
The mode now hangs off the percentage, which was already a button ("back to the
fitted size", now the menu's first rung): `StageZoomControl` takes optional
`items`, and with them the label becomes an `OverflowMenu` trigger of ONE
width. `ZoomControls` gained an optional `zoomTo` for the `100 %` rung.
**The one thing D1 costs, and he chose it**: the mode's state is only visible
inside the menu — D2 (the mode as a `· px` suffix in the pill) was offered
beside it and not taken.

Driven headless on a dropped JPEG and on a JPEG + DNG capture: `+` stays at the
same x to the pixel while the zoom crosses 100 % (three measurements, 0 px),
the menu's four rungs mark the live one and `Pixels as pixels` really sets
`image-rendering: pixelated`, the name is a menu for the pair and TEXT for the
lone JPEG, the well's five verbs are all 28px and enable exactly when they can
act (`· copied` / `· reset`), A/B goes accent → plain → dashed under Pick grey,
and at 390px the bar holds two lines with no horizontal overflow.

## 2026-09-22 — The corner says what the CAMERA did too

**The maintainer: *"dans les info overlay (i kb shortcut) ca sera bien
d'afficher les info exif: shutter, f/, iso, ev etc"*, then, shown six
placements, *"option a"*.** The stack toggled by `I` said only what this
session had done — `developLines`, the layers, the patches, the fidelity note —
while the two lightboxes had been drawing `exposureSummary` all along. Develop
was the one editor that never read a photograph's own numbers.

**One stack, the capture on TOP, marked.** `DevelopViewport` gained a `shot`
prop drawn above `facts`, behind a hairline that only exists when both families
are present, with the accent down its left edge. The mark is the whole point:
everything under the rule is a draft that changes on every drag, the line above
it is the file's own and can never be edited — two authorships in one box is
readable exactly as long as one of them is marked. Same key, same chip, no
second corner (`after` and `◐ hold` already hold the other three).

**A shorter line than the lightbox's** — `captureLine` in `exif-summary.ts`,
`ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV`, where `exposureSummary` leads with the body
and the lens: the stage names the file in its bar, and every character is a
pixel of the photograph. It is also the one place the COMPENSATION is printed,
since that is what says the camera was argued with before the sliders were; a
bias of zero says nothing, a default being no decision. Absent fields stay
absent — the rule `exposureSummary` already held.

**Which file's EXIF: the one ON SCREEN** (`shownFile`, the picture's rendition).
Switch to the DNG and the numbers are the DNG's; stay on a Winnow proxy, whose
re-encode carries no metadata at all, and `readEffectiveExif` merges the
instance's vouched record under it. Nothing is stored on the roll: a read costs
the head of one file and is always true.

The hook moved to `shared/exif/use-effective-exif.ts` at its second consumer
(it was Road Trip's `use-exposure-line.ts`), and split: `useEffectiveExif`
returns the merged `ExifData`, `useExposureLine` stays the badge's line over it.

Not driven in a browser: the pure half (`captureLine`) is unit-tested and the
four CI gates are green, but the corner itself was not seen over a real
photograph — it needs a file drop this container cannot perform.

## 2026-09-23 — The tabs answer to their own initials, and the first one is Adjust

**The maintainer: *"why r is the kb shortcut for crop? lets have it to be C"*,
*"lets rename develop tab to adjust"*, then the whole set — `E` export, `L`
layers, `D` detail, `A` adjust, `C` crop.** `R` and `D` were the only two tabs
with keys and neither named itself: `R` was reached for because `C` was
believed taken by copy, and `D` opened a tab called Develop *inside the Develop
tool* — a word that told you nothing about which of the five you were on.

**A tab's key is its initial, with no exception, or the set is not learnable.**
`TAB_KEYS` in `roll-editor.ts` maps the five letters onto `WorkbenchTab`, and
`editorKeyAction` returns `{ tab }` rather than a fifth and sixth string in its
union — one object case in the workbench's switch covers every tab, so a sixth
tab is one line in the map and nothing at the call site.

**`C` was never taken.** The chord branch is read FIRST (`metaKey || ctrlKey`
returns before the bare letters), so ⌘C is still copy-the-develop and a bare
`C` opens the crop; that ordering is what makes initials possible at all, and
it is asserted in the test rather than left to be re-discovered.

**The tab is `adjust` in the code, not only on screen.** Renaming the label and
keeping the id `develop` would have left the mismatch that caused the ask; the
id is internal state (`RollEditor`'s `useState`, the section bar it publishes)
and appears in no route or document, so it cost nothing.

## Two per-render costs from the 2026-09-22 audit (2026-09-22)

**Decision.** `PictureWorkbench` memoises the crop zone's `src` (`{ width, height }` of the decoded source) on the source, and `RollEditor` indexes a folder's siblings by lowercased base name once per sibling list. **Why**: a fresh `src` object per render recomputed the crop zone and the view, and both canvases under them repainted — a rotated, high-quality draw at device pixels — on every render of the workbench, which renders on every slider tick and pointer move; and the export plan asked every picture's siblings on every roll change, each answer a filter over the whole folder, rows × folder per edit. **How to apply**: a hook that takes an OBJECT argument memoises on the values inside, never on a literal built in the call; a lookup a plan runs per row is a `Map` built once per list.

## On a phone the roll's bar is ONE row (2026-09-22, after his screenshot)

The bar wrapped to two lines at 390px — back with its word, the name at
`text-2xl`, then history and "Add a folder…" on a row of their own — and the
photograph paid ~45px for it. On `compact` the back is its chevron
(`iconOnly`), `RollTitle` takes `size="md"` inside a `flex-1 min-w-0` span,
and Add is its glyph with the verb as `aria-label`/`title` (the menu, when
there is one, still names every way in). The Trips overview's bar, the same
fix; a wide screen keeps every word. Measured: the stage's top moved from 214
to 172 css px.

The filmstrip's × badge overhangs its cell by 4px, and a scroller that clips
x clips y too — on a touch screen, where the badge is always drawn at 28px,
its top was sliced flat. The strip pays `pt-1.5 pr-1.5` for it; any badge
overhanging a cell in a horizontal scroller needs the same room.
