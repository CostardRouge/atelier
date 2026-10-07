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

## A VARIANT is a whole picture sharing a file; it leaves into a folder, never under a new name (2026-09-23, item 30)

His YES (`docs/lightroom-gaps.md` §8): Capture One's variants. **Decisions**:
(1) `RollPicture.variant` — absent for the first, 2, 3… for copies, numbered
one past the highest of the capture so a number is never reused while a higher
one stands; a variant is a WHOLE `RollPicture` (its own id, develop, crop,
look, words, delivery), not a diff over the first. (2) `addPictures`' dedupe
STAYS: a variant is MADE (`addVariant`, placed after the last entry of its
capture), never added from a file. (3) Two starts: `clone` (⌘', Lightroom's
virtual copy — everything, delivery back to `auto`) and `fresh` (Capture One's
New Variant — only what belongs to the FILE: `rendition`, the RAW base with its
measured `rawGain`, `lensProfile`; never `rawWb`, which is a choice). (4) THE
NAME: Winnow's `reconcile` pairs a final with its capture on the exact basename
+ capture time (read in `winnow/src/lib/reconcile.ts`), and his Gallery pairs
by name — so a copy leaves as `Variant 2/DJI_0101.jpg` (`variantFolder`), a
second target as `Web/Variant 2/…`, a download as `Variant 2-DJI_0101.jpg`; a
`_v2` suffix was rejected for breaking both. `deliverFilesTo` walks a `/` path.
(5) The bytes are the capture's: `use-roll-media` fetches once for a family
(`mates`, only built when a variant exists), `use-roll-previews` keeps one
working preview, the local count counts files. **How to apply**: anything keyed
by picture id stays per variant (thumbs, export marks, the draft); anything
keyed by the FILE must go through `sameMediaRef` or it doubles per variant; a
list that names a picture uses `pictureLabel`, a message about the file may
keep `ref.name`.

## Winnow's culling is READ live, never stored and never written (2026-09-23, item 33)

His answer (`docs/lightroom-gaps.md` §8): picks and stars SHOWN and FILTERED
on in Develop, culling staying Winnow's. **Decisions**: (1) the source is the
row Winnow already sends — `GRID_SELECT` joins `ratings` as `verdict` (`pick ·
reject · skip · unrated`, migrations 0001 + 0016), `star` 0–5 and a free-text
`color_label` no Winnow screen sets — read from ITS code, not guessed (the
timeline's lesson); `culling.ts` reads it, `use-roll-culling.ts` asks
`assetsByIds` per connected host in chunks of 200. (2) NEVER on the roll: a
copy would go stale while he culls in Winnow and would read as the roll's own
rating; it is a session cache keyed `host/id`, re-asked on `visibilitychange`
after 60 s and by *Refresh*. (3) A picture Winnow said nothing of (local, not
connected) has NO culling, not "unrated": it passes *all* and *not rejected*,
fails *picks* and *★ and up*. (4) The filter is the sitting's (React state),
and filters the strip the way *ignored* does — the open picture stays, ←/→
skip what it hides (`stepPicture`'s `skip`), and `otherIds` (every *Apply to N
other pictures*) follows the STRIP: Lightroom's "filter picks, then sync", the
count on the verb saying it. The Pictures table gains *Picks*, drawn only when
the roll has an instance to ask. **How to apply**: never add a verb that
WRITES a verdict or a star from Atelier; a colour label is shown only for the
five shared names (`labelColour`).

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
the same; on the LAYERS tab `P` and `M` are the mask's instead (Pick, mask
view — #185, `subject-picking.md`), `U` stays the delivery's everywhere, one
flag on the pure key map (`layersTab`) so the rule is written once. An output instruction, never a rating: nothing goes to Winnow.
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
**Tick all** (2026-09-28, his ask — row by row was too slow): a head row
with a three-state box over the rows SHOWN, so a filter then the box is a batch
(every Pick, every Edited); a click ticks all unless all already leave, then
unticks. `setLeaving` writes `deliveryFor` — `auto` wherever the rule already
answers, exactly as one row's `toggledDelivery` — so a tick never pins an
edited picture, and it never touches an ignored one. One `update`, one undo step.
**The verbs are PINNED** (2026-09-28, his pick "bouton + menu" from the lab
in `MEMORY.md`): `DeliverBar` (`shared/ui/` since 2026-09-29, when Trips and the Studio took it) sits under the inspector's scroll the way
the tab strip sits over it — docked, a sibling after the scroll box; in the
phone's drawer, `sticky bottom-0` inside the drawer's own scroller (the
drawer body scrolls, the panel does not). ONE primary verb (`roll`, else the
first) and the rest behind an `OverflowMenu` opening upward, so the bar keeps
one height; the run's sentence above, `exporting` and `note` under. What is
SET (Replace, the ⓘ text) stays in the Deliver section; only what is
TRIGGERED is pinned. Shown on the Export tab — and on EVERY tab while a run
goes on.
**The run is SEEN picture by picture** (2026-09-28, his pick V1 + V4; lab in
`MEMORY.md`): `shared/tasks/run-progress.ts` (pure, tested; generic since 2026-09-29 — see `tasks.md`) holds each
picture's state (`queued · active · done · failed`), the phase of the one in
hand (`Fetch · Develop · Write`, three words over the run's dozen step
sentences) and the step in words. `use-roll-export` drives it through ONE
`say(phase, words)` that also feeds the one-line status and the task pill's
detail, so the three never disagree; a picture that did not leave (skipped,
refused by the folder, broken) is `failed`, one written with a warning is
`done`. V1: while a run goes on the Deliver bar IS the run — a segment per
picture (one bar past 48, thinner than a hairline otherwise), the active
segment a SWEEP (its length is unknown, `tasks.md`), the name and the phase
chips, the time left, a Cancel. The time left is MEASURED — the mean of the
pictures this run finished — and absent until one has, never a guess from a
file size. V4: each filmstrip cell carries its state at its CENTRE (the one
spot no badge owns), pointer-transparent so a cell still opens its picture,
and the run's task is SCOPED (`runScope(roll.id)`) so a `TaskEdge` draws its
hairline along the strip's top. A Cancel from the bar or the pill shows at
once (`cancelling`), the picture in hand letting go when it can.
**A run LOCKS what it no longer reads, and nothing else** (2026-09-28, his
pick L2). The run renders from the roll, its export settings and the
identity as they were at the click, so an edit cannot reach a file in flight
— the risk was never corruption, it was a control that LOOKS as if it acted
on the run. So while a run goes on: the Export tab's section bodies are inert
and dim (`LockSections`, `frontend.md`) under a sticky notice naming the
click's time; which pictures leave is refused from its other doors too (`P`,
`U`, `M`, the strip's badge, tick-all — `LOCKED_DELIVERY`, said in the status
line); retouching stays FREE, the whole point of a non-blocking run. At the
end, the pictures edited meanwhile are NAMED first in the note
(`editedDuringRun`, `shared/develop/run-edits.ts`, the export marks' own fingerprint, so the sentence and
the table's `changed` cannot disagree) and "Export new or changed" sends
them. Rejected: locking a queued picture's retouching (L3 — it blocks the
very pictures one wants to fix) and a blocking window (V3).
**E3's badge LEFT the cell (2026-10-02, his Q6)**: a cell wears ONE pill
reading its state (`↑` leaves, `–` held, `⊘` ignored, beside `●`, the variant
number, `▶`, `!`) and no button; what is DONE to a picture from the band is
its ⋯ menu (right-click too — send ↔ hold, back to the rule, ignore, a
variant, off the roll) or the selection's bar for several, and `P` / `U` /
`M` on the stage — the Pictures table stays the other door. A held finger now
SELECTS (his Q3), it no longer ignores. Ignored cells are dimmed, or left out
by the band filter's "Ignored pictures: hidden" (`atelier.develop.showIgnored`,
a `localStorage` view pref, never the roll's), the OPEN picture always staying
in the band — «The roll's pictures are a BAND» below.

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

**Since 2026-10-02 the selection is also a MODE** (`docs/develop-roll-browser.md`,
built): `selectionAfterClick`'s rules are unchanged, a Shift/⌘-click just
turns the mode on; the `Clear` link, the count in the progress line and the
verbs' "N selected" reading are the `SelectionBar`'s now — «The roll's
pictures are a BAND» below. Do not add a mark or a button to a cell: a cell
is READ, the menu and the bar ACT.

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
  A RUN reads it ONCE, at the click, with the roll and its export settings
  (2026-09-28): it used to be read per picture, so a creator changed while a
  run went on signed one folder two ways. Anything a delivered file carries
  that is not on the roll snapshot is taken in that same destructuring.
  No default name — the site is public, so his name is nobody's default; the
  template's `{year}` is the CAPTURE year (`captureYear`, the export's own
  when unknown). Written over the camera's `Artist`/`Copyright` (an in-camera
  owner string is not the author), in EXIF AND XMP: EXIF ASCII is now written
  and read as UTF-8 (a `©` came out `)` through the old 7-bit mask), and the
  XMP is ONE packet — `withXmpPacket` replaces, and `wrapUltraHdr` takes the
  stamp's packet OUT of the base and folds its `rdf:Description` into the
  container's, since two packets in one file is what readers disagree about.
- **Every delivered JPEG carries an sRGB ICC profile** (2026-09-23, audit
  item 25, `exif/icc-srgb.ts`): a 520-byte v4 display profile BUILT from its
  numbers (Bradford-adapted primaries, D50 white, `chad`, one shared type-3
  `para` curve), never a shipped blob, in one `APP2` after the EXIF and XMP
  `APP1`s. The canvas encodes sRGB, so it moves no pixel (Chromium decodes the
  tagged and untagged file identically, measured); what it removes is the
  reader's GUESS — an untagged file is sRGB only by convention. Validated as an
  exact identity against LittleCMS's own sRGB (Pillow's ImageCms, 2 197
  colours, 0 codes apart): check a profile change the same way. Wide gamut
  (P3, Adobe RGB) is pass 4 and needs a P3 canvas, not a tag.
- **Copy, paste and Apply-to go through ONE vocabulary of SECTIONS**
  (2026-09-23, audit items 4+5, `develop/picture-sections.ts`; rev.
  2026-10-02, his *"ce n'est pas du tout le cas … j'utilise Arc"*). The
  sections ARE `PictureEdit` — "edited" and "what can be copied" one
  vocabulary. **⌘C copies the WHOLE picture with no dialog** — every section
  it has something in (`copiedSectionsOf`, the draft folded in since it can be
  a beat ahead of the roll; the develop numbers also go to the shared develop
  clipboard for the Trips/Studio sheets) — and **⌘V pastes onto the band's
  selection when there is one, else the open picture**, carrying
  `pastedSections(copied, carried)`: what a paste carries is ONE standing
  per-browser choice (`tools/develop/carried-sections.ts`, the old sheet's
  `atelier.develop.sections` key), ticked in a ▾ always drawn beside the paste
  glyph (`DevelopClipVerbs.pasteMenu`, `OverflowItem.checked` keeps the menu
  open) and in the ⚙ sheet alike. A section the source never touched is never
  pasted, so a target keeps its own; the ⚙ sheet's Copy is the deliberate one
  that carries an as-shot section and therefore resets it. **Why it was
  rebuilt**: ⌘⇧C/⌘⇧V never reached the page in Arc (⌘⇧C copies the URL), the
  copy glyph was disabled on a picture whose only edit was a look or a crop,
  and ⌘C/⌘V were DEAD after every slider drag — the range kept the focus and
  `targetOwnsTyping` counts an INPUT as typing. A chord now yields only to a
  field holding text (`targetTakesText`, `EditorKeyPress.targetTakesText`);
  letters and arrows still yield to the slider. No ⇧ chord is ours any more.
  The clipboard holds a SNAPSHOT of the source picture, so pasting back onto
  that same picture restores it (`applySections` skips the source only by
  IDENTITY, i.e. an apply-to). Defaults: develop, look, lens, detail — what
  one body shares. Never carried: rendition, RAW base (`developOnto` keeps the
  TARGET's), words, delivery state. The per-tab Apply-to verbs stay for the
  one-section gesture. ⇧C alone
  is still crop-to-view. **Reset this picture** (item 7) is the same sheet read
  the other way: the ticked sections back to as shot, NO confirmation — it is
  one undo step like every roll write (measured: reset all, ⌘Z restores the
  develop and the look); the well's ↺ still resets the develop numbers alone.
- **A preset may carry the LOOK** (2026-09-23, item 6, `DevelopPreset.look`,
  optional — no book version bump, an older book reads with none). Saved only
  from a host whose pictures OWN their look (the Develop tool passes `look`
  and `onApplyLook` to `DevelopPresetsSection`), ticked per save (*+ look*,
  off by default — a preset stays a light unless asked); a look alone is a
  valid preset. Trips and the Studio keep their looks on other rungs, so there
  the chip applies the numbers and says the look stays behind (a struck
  `+ look`), rather than guessing which rung to write. `develop.ts` cannot
  import the roll's grade reader (a cycle), so `normaliseDevelopPresets` takes
  an optional `readLook` the book passes.
- **An undo OPENS the picture it changed** (2026-09-23, item 8,
  `pictureAfterRestore`, called in `DevelopTool`'s `onRestore`). The stack
  stays ONE for the roll (per-picture stacks would split an Apply-to's single
  step), so ⌘Z after stepping undid the previous picture out of sight. The
  diff is by OBJECT IDENTITY — every write replaces the picture it touches and
  keeps the others — and the route is REPLACED, not pushed; the open picture
  among the changed, or nothing changed per picture, means stay. Measured:
  edit a, step to b, ⌘Z lands on a reverted, ⌘⇧Z re-applies there.
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
- **The place is named OFFLINE from the capture's own GPS, and is its own
  group** (2026-09-23, M4, `exif/delivery-place.ts`): `photoshop:City`,
  `photoshop:Country`, `Iptc4xmpCore:CountryCode` (XMP only — EXIF has no
  place field), from the committed GeoNames index loaded ONCE per run and only
  when the group is on. Read from the position as CAPTURED, before the choice
  drops it, so *Share online* sends the town without the coordinates. A town
  within 30 km only (`PLACE_MAX_KM`; the index's own 90 km is for naming a
  LEG — the Pinnacles are 35 km from Jurien Bay, the nearest town it holds),
  else the COUNTRY alone from the nearest town within 90 km (wrong only at a
  border in empty country, accepted), else nothing; the run names the
  pictures that got no town. Trap met building it: the run built `placeOf`
  and never handed it to `exportExifBlock` — every unit test passed, only
  reading the delivered file back caught it.
- **"Changed since last export" is a MARK kept BESIDE the roll, never on it**
  (2026-09-23, E4, `develop/export-marks.ts`, store `exports` v4 in
  `atelier-develop`). On the document it would be a write the undo stack
  records — every export an undo step, and an undo un-marking what WAS
  delivered — and the fact is this DEVICE's (the files landed in a folder
  here), like a folder handle; it does not travel with a synced roll or the
  `.roll.json`. A mark is `{at, key}`, `key` a fingerprint of the picture AS
  RENDERED (develop, look, crop/aspect/border, rendition, geometry, detail,
  repair, layers, title, caption — absent, `null` and `[]` one spelling at
  every depth, keys sorted); the roll's export settings, the delivery state
  and the identity are deliberately OUT (a new size is a knowing choice for a
  run, not a change to find). Only files that LANDED are marked
  (`Delivery.failed` names the refused ones). Undoing the edit brings the
  picture back to exported, because the key matches again — measured, as is
  a look restored after a reload keeping its key. Surfaces: a `✓ time` /
  `changed` chip per row, a *Changed* filter, the status line's count, and
  *Export N new or changed* only when it is a real subset of what leaves.
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
  decision 4 — `develop-originals.md` §7.4). `decodableOriginal` names
  what a browser reads on its own (jpg/png/webp/avif/gif/bmp) plus, since
  2026-09-26, the HEIF and JPEG XL this suite decodes itself — never TIFF —,
  and a RAW now goes down its own branch: `originalPixels` answers
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

## A run writes each picture as it lands (2026-09-28)

`exportPictures` used to render the whole run into memory — every JPEG and every second target's — and write it all at the end, then keep the files in `lastRun` until the NEXT run: gigabytes on a big roll, and on a phone where a long roll died. Each picture is now handed to `deliverFilesTo` as soon as it is rendered (its main file and its other targets' together), the counts and refusals are accumulated, and only the NAMES are kept (`RollRun.names`, for the unplugged send home, which can read them back from the folder). The folder is still picked at the click, before anything renders (`deliver-files.ts`). A cancel keeps what was already written — as it always said.

## The band's cells are memoised (2026-09-28, kept through the 2026-10-02 rebuild)

Every cell re-rendered on every tick of the open picture's sliders — a roll of hundreds of cells for one picture's change. `Cell` (`RollBand.tsx`) is `memo`, and what it is handed is kept stable: the host's callbacks are read through a ref and handed as ONE handlers object for the strip's life (RollEditor passes inline arrows), the Winnow thumbnail as a client and an id rather than a fresh object, the availability as its KIND alone — `use-roll-media` rebuilds that map, objects and all, on every roll change — and the cell's rectangle from the layout (a new layout object only when the items, the width or the size changed). The picture's ⋯ menu is ONE `AnchoredMenu` for the whole strip, never one per cell. A new prop on a cell must be stable too, or the memo quietly stops holding.

## The crop's ASPECT rides a draft too (2026-09-28)

The framing always went through a write-through draft; the aspect was written to the roll at once — and a Free crop's aspect changes with every pointer move of a handle, so a drag rewrote the whole document per move. `PictureWorkbench` now holds `aspectDraft` beside `framingDraft`, the zone, the stage and the Crop panel read it, and `useWriteThrough<string>` writes it at rest (200 ms). Driven headless: a chip reads `original` in the roll at once and `4:5` after the rest. Anything that reads the roll's own `aspect` (the export plan) sees it a rest later, like every draft here.


## A roll takes CLIPS: played on the stage, switched to the rush, delivered as an MP4 (2026-09-30, rev. 2026-10-01: a crop)

**The maintainer, two lines: *"develop doit gérer les vidéos"* and *"ne pas
oublier d'aussi pouvoir switcher du proxy à la vidéo HD"*.** Built in one
pass; the rules a later agent must keep:

- **A clip is told by its ref's NAME** (`isClipPicture`, over `isClipName` in
  `library/assets.ts` — the one test every "is this a video?" question should
  share): a Winnow proxy is `<base>.mp4`, a rush `<base>.MP4`, and the answer
  must hold before a byte is in hand and on every device. Never by
  `File.type`: a fetched file carries none.
- **A clip takes the GLOBAL develop, the look and (since 2026-10-01) ONE
  crop, and nothing else** — what the export grades every frame through
  (`SOURCE → CUBE → [FILM] → OUTPUT`, the variant path's own chain) and then
  cuts. A border, the keystone and lens warps, detail (Presence included),
  the post-crop vignette, repair and the layers are passes over ONE still
  frame: on a clip they would have to follow the picture from frame to frame,
  which nothing here does and Lightroom does not do either. So they are
  refused at EVERY door, not hidden at one: the workbench has three tabs
  (`workbenchTabsFor`, `CLIP_TABS` — Adjust, Crop and Export; `D`/`L` do
  nothing, the editor lands a clip on Adjust when the tab it held is not one
  of its), the stage is handed null for each of them (so preview = export
  holds by construction), `copyBorderTo` skips a clip and the border verbs
  count only the frames (`frameOtherIds`), and `withSections` /
  `withoutSections` reduce a clip's sections to `CLIP_SECTIONS`
  (`sectionsFor`) — a paste, an apply-to and a reset all go through them.
  `pictureEdits` needs no clip branch: a clip can never carry the other
  sections.
- **The crop on a clip is held STILL** (2026-10-01, his *"le crop sur un
  clip"*): the same `aspect` + `framing` the roll always stored, the same
  `CropStage` / `CropPanel` (the panel takes `clip` and drops `BorderSection`;
  the Keystone and Lens panels are not drawn), the same `frame` handed to
  `useDevelopPicture` — so the Adjust stage draws the square and the wipe
  follows it with no clip branch. Three things a photograph never needed:
  (1) `delivered()` and `snapshot` grade a clip AT `video.currentTime`, as
  `paintStage` does — the held grade is keyed on the instant, and without it
  the crop stage drew the first frame it ever rendered whatever the transport
  did; (2) `DevelopPicture.frameSeq` (the hook's `restedFrame`, exposed) is a
  dependency of the crop stage's paint, since the element `delivered()` reads
  moves under it with nothing else React can see; (3) the transport is drawn
  AFTER the crop stage in the column, so on the Crop tab it stays under the
  picture and the zone is judged on any frame. A crop that MOVES (a pan or a
  zoom over time, Trips' `framing-motion`) is deliberately not here.
- **The export cuts every frame through the still export's own arithmetic**
  (`clipDelivery` in `roll-clip-render.ts`, pure, tested): `deliveredLayout`
  read against the clip's DISPLAY frame — the zone at the clip's own density,
  the cap (`longEdgeFor`) read against the DELIVERED frame as for a
  photograph, never an upscale, rounded to EVEN for the encoder — then
  `drawDelivered` per frame with no border, from an upright scratch canvas
  when the container is turned (a turned clip's framing was written in its
  display frame, the one the stage showed). `outputSize` is set whenever the
  frame is cropped or capped (the flag baked), and `Auto`'s `deliverySummary`
  is handed the picture's framing and aspect, so a 1:1 zone out of a 360 px
  proxy asks for the rush where the whole proxy would not have (measured:
  *the proxy would be upscaled ×2.00*, the rush fetched, 720 × 720 written).
- **The Library bar no longer greys clips out for Develop**: the registry's
  `accepts` is `['photo', 'video+telemetry', 'video']` (`app/tools.tsx`) —
  `assetUsableBy` is what dims a tile, and the tool had declared photographs
  alone. The Winnow lightbox lists a VIDEO row's files too (`WinnowLightbox`,
  `viewRows`): proxy and rush as chips, the rush fetched on its chip and held
  under the same asset id the stage and the export read, and the `Develop`
  verb carries the file on screen onto the roll like a photograph's.
- **The stage is the sheet's clip stage** (`use-develop-picture.ts`'s
  `video`, `DevelopTransport` under the viewport, Space on the tool's window
  with `targetOwnsSpace` and no dialog open, `restedFrame` feeding the
  histogram and Auto). The loupe is off on a clip (no whole file to decode).
- **The rush is a row of the name's menu** because `captureInput` is handed
  `canDraw: canStageDraw` (`projects/media-rendition.ts`, the Studio's) —
  `renditionsOf`'s default knows pictures only and would BLOCK an `.MP4`. The
  fetch goes through `fetchHeld` (one flight per asset, `held-fetch.ts`) and
  `fetchSourceFile` does too since this day, so an export that starts while
  the stage is still bringing the rush JOINS that fetch; choosing another row
  aborts THIS reader only (`flight` ref in the workbench). Measured headless:
  three switches and an export, ONE `/download`.
- **The playhead survives the switch** the Studio's way: the new element's
  `videoTimeSeconds` is read from the OLD element's `currentTime` DURING the
  render that swaps `shownFile` (a ref compared per render), never in an
  effect — an effect runs after the decode effect already started at 0, and
  would re-decode. Measured: seek 1.5 s, switch proxy → rush, 1.5 s.
- **`measurePicture` is video-aware** (`loadClipMeta`, no thumbnail): without
  it the *Delivers* row, the chip's pixels and the rows' `640 × 360` were all
  empty for a clip. The chip says `proxy · clip · W × H` / `MP4 · clip · W × H`
  (`pictureFidelity`); the menu's proxy hint is `CLIP_PROXY_ADDS`.
- **The export is `roll-clip-render.ts`** over `exportProcessedVideo`: the
  container is DEMUXED FIRST (`demuxSource`) because the pipeline reads
  `outputSize` before it asks for a processor, and only the track and its
  matrix say what frame the cap is read against; uncapped, the graded frames
  stay in coded orientation with the rotation flag standing (the LUT tool's
  path); capped (the FIRST target's size through `longEdgeFor`, even numbers,
  never up), each frame is turned upright and drawn smaller, the flag baked.
  Sound is copied. The name is the capture's exact name as `.mp4`
  (`exportName`); `decodableOriginal` now accepts a clip's name so `Auto`
  fetches the rush where the first target's frame asks for more than the
  proxy holds (an HEVC rush WebCodecs cannot decode fails at the demux and is
  said by the run, never refused on a name). Quality, borders, HDR, the
  watermark, the metadata groups and the other targets do not reach a clip:
  `clipNote` says so once per run. Progress is relayed per PERCENT, not per
  frame (`say` sets state).
- **A clip's cell** is one frame a second in (`bakeClipThumbnail` over
  `loadBadgeSource`, released), marked ▶ at bottom-centre (the one spot free);
  a WORKING PREVIEW is never made of a clip (`use-roll-previews.ts`'s
  `isLocal`). The day sheet lists `media_type === 'video'` too; the Library
  verbs and the drop take a `video`/`video+telemetry` asset's clip
  (`rollFileOf`, `rollFiles` — the `.srt` stays the Studio's).

Verified headless (`testing.md`, «Clips through the Develop tool»): a stub
clip's roll opened on `proxy · clip · 640 × 360`, two tabs, the cell marked;
Play advanced the position, Space paused it; exposure +1 wrote `1` to the
roll and lifted the stage; the rush row read `DJI_0007.MP4 · 1280 × 720 ·
752 KB`, the switch kept 1.5 s and stored `delivered:dji_0007.mp4`; the
export wrote `DJI_0007.mp4` 1280 × 720 · 4.02 s from the HELD rush (one
download in all), read back brighter than the source (143 against 129); a
clip DROPPED from disk opened, baked its cell, and left capped at 320 × 180.
On 2026-10-01 (the crop): `C` opened the crop stage with the transport under
it and no Borders / Perspective / Lens; `1:1` stored `aspect: '1:1'`; the
Adjust stage went from 640 × 360 to 640 × 640 and still played; the Export
tab read *the proxy would be upscaled ×2.00* and the run wrote `DJI_0007.mp4`
at 720 × 720 · 4.02 s from the rush. Not driven: an HEVC rush, a real H.264
encode (this Chromium has none — the encoder was swapped to VP9 for the run,
`testing.md`), a turned (rotated) clip's crop, his phone.

## The JOURNAL is on the picture, written in the same write as the edit (2026-09-30, T1 of `docs/develop-timelapse.md`)

`RollPicture.journal` (roll v7, `journal.ts`, pure): a step per write of the ONE updater — the sections that moved (`sectionsChanged`, the `PictureEdit` vocabulary) and their values after (`SectionValues`, the crop as aspect + framing together) — appended by `journalRoll(prev, next, now, via)` inside `RollEditor.update`, INSIDE the document. **Why**: undo is a stack of whole documents, so a step inside the picture is undone and redone with its edit by construction; a listener or a store beside the roll (the export marks' shape) would have to be kept in step by hand. Rules: (1) the changed pictures are found by IDENTITY (every write replaces the picture it touches) and diffed by section, so a write that moved nothing leaves no step; (2) coalesced on the history's own `COALESCE_MS` — the same sections, the same `via`, inside the window → the last step is REPLACED, a drag is one step; (3) bounded (`JOURNAL_MAX_STEPS` 300, `JOURNAL_MAX_BYTES` 96 KB per picture, the two OLDEST adjacent steps sharing a section merged first — a painted mask's every stroke is the heavy case); (4) never an edit (`pictureEdits`), never in an export mark's key (`KEYED`), never carried by `withSections` / `withoutSections` (an Apply-to, a paste or a reset lands on the TARGET as its own step, `via` said: `apply · paste · reset`), a `clone` variant takes it (`structuredClone`), a `fresh` one does not, the `.roll.json` carries it; (5) absent and empty are one spelling, `readJournal` drops a step with no time or no known section and reads each value through its own reader, so an old roll is byte-identical. (6) **A picture edited before v7 has settings and no story**: `pictureJournal` prepends one synthetic step per section the record does not explain, in `STANDARD_ORDER` (crop · perspective · lens · develop · detail · repair · layers · look · border · vignette), marked `via: 'earlier'` and `reconstructed` — folding the steps over `asShot(p)` gives the picture EXACTLY, asserted in the spec; a surface showing such a step must say "standard order (not recorded)". The stage's VIEW is not recorded (a way of looking, two components below the funnel); a preset applied through the draft reads as the author's own gesture (no `via`). Verified by the spec only: the undo half is a consequence of the document, not driven headless here.

**Chapters (T2, `timelapse-chapters.ts`, pure).** A chapter is a TOOL, not a write: consecutive steps of the same sections with the same `via` fold into one, carrying the picture BEFORE and AFTER as whole `RollPicture` states folded from `asShot(p)` (so a painter renders N + 1 states and re-derives none); a run that ends where it started leaves no chapter. The caption says the DIFFERENCE (`describeDevelopChange`: the sliders that moved with their value after, then the new lines of `developLines` — a `SLIDER_LINE` regex keeps the two from repeating; `describeLook` names the enabled layers with a strength under 100 %, the output transform's label, the texture; the crop says its aspect, `turned`, `straighten`, `flipped`), and `via: apply | paste` appends *from another picture*, `reset` says `Reset …`. The REGION is read in the step's own geometry — the changed patches' destination AND source discs, a changed layer's radial box, a brush's strokes' box, a subject's or colour range's points padded — in half-diagonal units converted per axis (`halfDiagonal`), padded by half, held inside the picture; a band, a luma, a shade or a global section is `null` = the whole picture; `cameraFor` fills 60 % of the frame, capped at 3×, its window kept inside the picture. Weights: crop and layers 1.4, repair and look 1.2, develop 1, perspective 0.8, the rest 0.5; `keepCount` is 5 · 8 · 14 at 15 · 30 · 60 s and `keptChapters` folds the lightest (ties: the earliest) into the chapter that FOLLOWS (the last one for a trailing run), whose `before` reaches back and whose caption says `· + detail`; a hidden chapter folds the same way, and the chain of states stays continuous (asserted). **The chain is continuous BY IDENTITY, not by value** (2026-10-01, his first report on the sheet: *A state of the script was not rendered*, the tool crashed from the preview's rAF): the painter's rasters are keyed on the state OBJECT, so a chapter's `before` must be the previous chapter's `after` object — a step that changed nothing keeps the running object instead of advancing to an equal one, and a dropped run (a slider put back) is closed over by re-pointing the next chapter's `before` at the previous live `after`. Belt and braces: `TimelapseScript.states` is the SET of every state a frame can ask for (`asShot`, each kept chapter's `before` and `after`), de-duplicated, so a broken chain costs a render and never a throw, and `has()` is complete. Tests pin the two shapes; the drive is `drive-putback.mjs` (scratchpad), which crashed the old code and passes the new.

**The script (T3, `timelapse-script.ts` + `timelapse-options.ts`, pure).** `RollExport.timelapse` (v7, `readTimelapseOptions`: format · seconds 6–120 · hook `result-first | raw-first | flash` · reveal `wipe | split | flicker` · camera `follow | still` · beat BPM or null · five overlay switches · ground · sound · the five WORDS, English by default and each editable) is the ROLL's, so a second device draws the same; `RollPicture.makingOf` (`readMakingOf`, `setMakingOf`: hidden chapter ids, caption overrides — an emptied caption is never stored, the computed one returns) is the picture's, a document write like any other and never an edit. `timelapseScript(pictureChapters, options, extras)` times the three moments — the hook 1.8 · 2.4 · 3 s and the reveal 3 · 4 · 5 s at 15 · 30 · 60 s, the body shared by weight over `keptChapters` — hands each chapter a camera FROM the previous chapter's target TO its own (`WHOLE_PICTURE` under `still`), and builds the captions, the counter, the hook's words and the plate/credit as `OverlayElement`s with a `window` per chapter (JetBrains Mono, a box legibility, a slide-up entrance), so `drawOverlays` draws them and nothing else does. A BEAT rounds every moment to a half-note grid (`beatGrid` = 120 / bpm, never under one) and the script says the length it reached (`seconds`), which the encode must read instead of the option. `states` is every state a frame can ask for, once each (see the chain entry above). **Long text WRAPS, as a flex row** (2026-10-01, his report: overlays hidden past the frame's edge): `drawOverlays` draws one line per element, so every block (`block()`) is fitted first by `fitText` — the ` · `-joined facts packed whole, a fact longer than a line broken on its words (`packLines`), the size stepped down by 8 % while it takes more than three lines and never under 65 %, then BALANCED like `text-wrap: balance` (the narrowest budget keeping the line count) — and laid out one element per line from a FOOT that never moves (captions grow upward from 0.86, the tease downward from 0.12, the credit and the plate as ONE column from 0.955 so a wrapped credit lifts the plate); the first line keeps the block's id, the others `id.1`, `id.2`. The budget is the MONO face's (0.62 em, a box's padding taken off, 90 % of the width), which is only true because every text element PINS all eight themable keys in `styleOverrides`: the painter draws through the neutral theme, which had been silently swapping the mono face, the weight and the boxes for its own since T5. **The words' STYLE is the roll's** (2026-10-01, his ask: radius, colours, size, font): `TimelapseOptions.style` (`readTimelapseStyle`, clamped, an unknown font or a non-`#rrggbb` colour reads as the default) — font from the engine's own five faces, size 0.7–1.5, bold, capitals, background `box | shadow | none`, radius (the engine's `radiusFrac`, 0 square to 4 pill), box opacity, and three colours (words, box/shadow, accent). The script reads it ONCE into a `Look` (`lookFor`): the captions and the hook take the main background, the tease takes the ACCENT (its box, or its words' colour when there is no box), the counter/plate/credit keep a soft shadow (none with `none`). The DEFAULT is his (2026-10-01): VT323, bold, a SOLID (opacity 1) SQUARE (radius 0) black box, white words, the vermilion accent — a roll that stored a style keeps it, one that never did now reads this. Lengths are 10 · 15 · 30 · 60 s; at 10 s the hook is 1.5 s, the reveal 2.5 s and three chapters are kept. Capitals are applied to the STRING before fitting, so the width budget counts them; each face has its own advance (`ADVANCE`, ×1.15 for capitals in a proportional face). The preview loads a newly picked face (and weight) itself and redraws, since its prepare only loaded the faces it started with. The reveal's BEFORE / AFTER corner labels are drawn by the painter itself and are fitted to half the picture (smaller down to 60 %, then squeezed by `fillText`'s `maxWidth`). Kept in `timelapse-options.ts` apart from the script so `roll-types.ts` reads the options without a cycle.

**The pass chain is ONE function (T4, `picturePasses` in `roll-render.ts`).** `picturePasses(settings, ar, scale, rasters, raw)` builds both halves of a picture's chain — before the cube (the camera's shading on the RAW path, the repair, the noise passes) and after it (the geometry with the camera's warp on the RAW path, the layers with their rasters, the sharpen, the post-crop vignette) — for the delivery, its darker HDR twin and every state of a making-of. `raw` is the one switch: a render or a proxy has had the calibration applied by the camera, and applying it twice lifts the corners into white; `use-roll-export` sets `calibration` only on the RAW path, so the export is unchanged to the byte (a pure code motion — `freshPasses`/`freshPre` were already this function for the HDR twin). Only the ASPECT reaches the vignette (its map is in [0,1]); a pass holds textures on the context it first drew on, so every grader takes a chain of its own. Verified: `check-render.mjs` and `check-bands.mjs` both pass after it (Playwright installed in the scratchpad and symlinked into `node_modules/`, never a dependency).

## The making-of's painter and sheet (2026-10-01, T5 of `docs/develop-timelapse.md`)

`tools/develop/timelapse-paint.ts` (DOM) is ONE `draw(script, t)` for the preview and the file. **Rules**: (1) a raster per STATE, graded once — `prepareTimelapse` decodes the picture once at `edge` (the sensor through LibRaw where the picture is developed on it) and renders every state of `script.states` through `picturePasses` + `makeFrameGrader` into an `ImageBitmap`, a grader built and disposed per state; the rasters live in a `StateCache` keyed by the STATE OBJECT, reused across prepares of the same source and edge, so hiding a chapter or changing the length renders nothing new — which is why `usePictureChapters` memoises the chapters on the picture's `journal` and a key of its sections, never on the picture object a caption typed replaces. (2) The script is read at every draw and the states are fixed at the prepare: `painter.has(script)` guards a frame asked for a script whose chapters moved. (3) A transition is a crossfade of two rasters over the first 45 % of the chapter (`TRANSITION_SHARE`); a chapter with `crop` among its sections draws the picture BEFORE with the zone growing over it — the after's four corners through `unframePoint`, interpolated from the before's, mapped back through `framePoint`, a veil in even-odd, the outline and the thirds — and CUTS to the after at the transition's end. (4) The tools: a repair chapter's rings at the changed patches' destination AND source discs (dashed, joined), a layers chapter's mask as an accent tint rasterised at 160 px through `maskAt` (a subject through its raster from the state's render; a luma or colour range draws nothing, it reads the pixels), drawn through `drawPictureIn` so the crop carries it; both whole for the first half of the transition and faded by its end. (5) The frame: the delivered picture (`deliveredLayout` + `drawDelivered`, border and all) FITTED at 94 % of the frame over a ground (its own blurred 48 px copy darkened, or paper, or ink); the camera is a transform about the chapter's target through `frameAffine`, travelling 0.6 s on out-cubic with a geometric zoom; the hook pushes in 4 %. (6) The reveal draws the as-shot raster in the FINAL state's frame over the final, clipped left of a divider (the wipe sweeps right → left over 55 % of the reveal; the split holds the middle; the flicker alternates on twelfths), with `BEFORE`/`AFTER` labels drawn by the painter — the first before/after any export of the suite draws. (7) The captions, the counter, the hook's words, the plate and the credit are `drawOverlays` on the script's elements in the neutral title style, their fonts loaded first by `ensureOverlayFonts`; the bottom hairline is the video's own clock. Grain is frozen (one field per state). `use-timelapse-preview.ts` plays it on the page's canvas at an 800 px long edge from a 1600 px decode, looping, with a rAF clock; `TimelapseSheet.tsx` is the storyboard (pills for the roll's options, the five switches, the words, the chapter list with an eye and an editable caption whose placeholder is the computed one) opened from the Export tab's *Making-of* row (`ExportPanel`'s `makingOf` slot) or the bar's menu verb, the state in `RollEditor`, the sheet drawn by `PictureWorkbench` over `shownFile` + the RAW + the calibration at the rung in hand. **Traps met headless**: a `Button` with an `sr-only` child is NAMED by that child, not its `title`; a slider left focused keeps the editor's letter keys (`c`, `e`) — blur first. Driven headless (recipe in the scratchpad's `drive-t5.mjs`): a dropped JPEG, exposure and contrast by keyboard and a 4:5 chip → three journal steps, ⌘Z two, ⇧⌘Z three; the row `2 steps recorded · 15 s · 9:16`; the sheet's canvas at 0.4 s brighter than at 1.5 s (the after over the as-shot) and at the end; captions off changed the bottom band; Split stored on the roll, a folded chapter and a caption on the picture; no horizontal overflow at 390 px; no page error.

- **The hook and the reveal are ONE kind of moment** (2026-10-01, his ask: "the same kind of options for both"): `MomentOptions` = figure (`cut · crossfade · wipe · split · flicker`) · order (which picture first; it LANDS on the other) · seconds (null = `momentLengths`) · bounces (0–2 extra back-and-forths). ONE pure function, `pairAt(figure, order, bounces, q)`, says how much of the picture as shot covers the finished one at any point (width from the LEFT — before → after reads left to right — and alpha), and ONE painter routine, `drawPair`, draws it for both moments; the hook lands at 62 % of its length, the reveal at 55 %. A roll stored before this kept a WORD (`result-first · raw-first · flash`, `wipe · split · flicker`) and `readMoment` reads it as its figure. Split and flicker show both pictures at once, so the hook says `BEFORE ↔ AFTER` in one line. **The tease** is `off · hook (for `hold` s from the hook's turn, spilling into the first chapter — his report: it left too soon) · title (to the end)`. **The ending** is a moment of its own after the reveal (`EndingOptions`: hold 0–8 s, default 2; motion still · push · pull · drift; loop; an end LINE in the accent, with ready-made calls to action in `END_LINES`); the body shrinks to keep the asked length. **The loop** crossfades the last `LOOP_SECONDS` into the video's first frame (painted once per script into an offscreen canvas) and everything that would stay to the end — the title, the end line, the plate, the credit — fades out where that starts, so the last frame and the first are the same picture with the same words. **Progress** is `line` (the hairline) · `stories` (a segment per moment along the top, `progressSegments`) · `none`.

- **A running export must not move the screen** (2026-10-01, his report: during a making-of export the status text changed very fast and the button zone jumped). The root cause was the SHEET: the workbench rebuilt its `source` as a new object on every render, and the preview's preparation was keyed on it, so every progress report of the run (one per encoded frame) restarted the preview. Now the source is memoised in the workbench AND the preview hook keys on the source's contents (file, RAW file, gain, calibration), so a host that rebuilds it cannot restart anything. Around it: the making-of reports only when its step, words or whole percentage change (≈100 updates, not 450); the sheet's status is one truncated line; the `DeliverBar`'s running rows never wrap (the time left has an always-drawn slot, the stage chips do not wrap, the headline truncates, Cancel has a fixed width); the masthead `TaskPill`'s percentage sits in a slot as wide as `100 %`. Rule for any run: a value that changes per frame goes in a slot of fixed width, and a prop object handed to a component that prepares work is memoised, or keyed on its contents by the receiver. Not changed, deliberately: the Export tab's lock notice still appears at the run's start and goes at its end (one move each way, the L2 design), and the bar still grows into the run (his V1 pick).

**The export (T6, `use-timelapse-export.ts`).** A run of the suite's shape: the folder picked AT the click (`pickDeliveryTarget` first — `frontend.md`'s picker trap), a task on the PICTURE's edge (`taskScope`, so the stage's `TaskEdge` draws it), one unit with three stages (Render · Encode · Write) on the SAME `DeliverBar` as the roll's export — `PictureWorkbench` merges the two (`anyProgress`), the Export tab locks on either and the bar is drawn on every tab while either runs —, a Cancel ending the decode or the encode in flight. The states are graded at `min(exportEdge(), frame long edge × deepestZoom(script))`, so a close-up is not a blow-up and a phone keeps its ceiling; `encodeFrames` paints every frame through the sheet's own painter at `script.seconds` (the beat's length, never the option's); the file is `makingOfName(ref)` = `DJI_0101-making-of.mp4` — a SUFFIX, because a delivered picture's exact name exists to pair it with its capture and a video is not a rendition of the picture. H.264 is said BEFORE the click (`useAvcEncodeSupport` → the sheet's verdict disables the verb). Driven headless with the encoder faked the way `render-video.test.ts` fakes it (an init script: a `VideoEncoder` whose `isConfigSupported` answers for `avc1.640034`, chunks as instances of the global `EncodedVideoChunk`, `showDirectoryPicker` → the OPFS): 450 frames at 1080 × 1920 and 30 fps for 15 s, a real `ftyp` container in the OPFS under the right name, the note on the sheet and on the bar. The encode itself is NOT verified here — no H.264 in this Chromium — and must be run once on a real machine or the desktop app's pane.

**The sound (T7).** `timelapseScore(script, kit)` (pure, tested): the kit's `tick` where each chapter starts (the level falling a touch per chapter), its `leg` landing at the hook's cut (the tease; none under `flash`), the `seat` where the reveal's figure ends — the openers' own kits (`tick-kits.ts`), so the four names on the Sound pill are the same four Défilé offers. Rendered by `renderBed` ahead of the AAC priming and handed to `encodeFrames` as `audio`; `'none'` (the default, his §6) writes NO track. The note says what became of it (*with its ticks* · *silent: …*): this Chromium renders the bed and cannot encode AAC, and the run said exactly that. The preview is silent, said in the hint. The plate, the credit, the ground and the three hooks and three reveals the plan listed under T7 were built with T5. **The whole plan is BUILT, T1 → T7**; what no run here could verify is the H.264 encode and the AAC track on a real machine, and the feel of the video on his own pictures.

- **The sheet's preview STICKS** (2026-10-01, his report: it scrolled away): the whole preview column is `sticky` inside the sheet (the sheet is the scroller; a sticky child of the column alone would leave with the column on a phone, where the columns stack), on the paper so the settings scroll under it, and its picture is sized from a HEIGHT budget — `--tl-preview-h`, 60 % of the measured `--app-h` up to 36rem on a desktop, 34 % on a phone — through `width: min(100%, budget × aspect)`, so a 9:16 preview never outgrows the screen it must stay on.
- **A making-of is a PHOTOGRAPH's** (2026-10-01, the merge with clips): its states are graded as stills, so a clip gets no Making-of row, no menu verb and no sheet (`isClipPicture`).

## The roll's pictures are a BAND, a COLUMN or a CONTACT SHEET; a cell is calm and the selection is a MODE (2026-10-02)

His *«les miniatures sont trop petites»* → `docs/develop-roll-browser.md`, face
D picked with its §7 recommendations, built C1–C7 the same day (`Filmstrip.tsx`
is gone; `RollBand.tsx`, `ContactSheet.tsx`, `SelectionBar.tsx`, `BandGrip.tsx`,
`use-strip-prefs.ts`, `use-thumb-aspects.ts` over `shared/develop/roll-strip.ts`).
The rules a later agent must keep:

- **Geometry is pure** (`roll-strip.ts`, tested): Flickr-style justified rows,
  one scrolling row, the column, the sheet, rows ↔ height, columns ↔ width, the
  fold threshold, the auto height from the roll's MEDIAN aspect, the prefs
  reader, the filter. A cell is drawn at the rectangle the layout answers,
  never by CSS flow, so the host knows every size before it paints. Aspects
  are the thumbnail's own (`use-thumb-aspects.ts`: KNOWN from the store or
  the bake since 2026-10-06, measured once and written back where not —
  «The band draws the cells near the view» below) and fall back to the
  picture's; the layout re-justifies as they land.
- **Preferences are PER DEVICE**, `localStorage['atelier.develop.strip.<desktop|phone>']`
  (`StripPrefs`: place, height, width, folded, auto, thumb, sheet), never on
  the roll; a phone's `place` is read as `bottom` whatever it says, and its
  menu offers no placement.
- **The size is the DRAGGED one by default** (his Q2), "height follows the
  roll" a menu option; a drag under the fold threshold folds to the rail
  (`bandAfterDrag`). Trap: the box that sizes the band must be measured APART
  from the band — the status lines have their own `useElementSize` and the
  toolbar is a constant — or the auto height reads its own output and
  flickers (707 ↔ 743 px; Playwright's "element is not stable" was that).
- **The column** (his Q1): `place: left | right`, the band's cell `row-span-2`
  in a grid column of its own (`auto`), the stage handed its column through
  `PictureWorkbench`'s `columns` — never in focus, where the grid has ONE
  column and a `col-start-2` would make an implicit one —, the status lines a
  grid item of their own under the stage. The grip is the band's stage-facing
  edge, `−` / `=` step the COLUMN COUNT (`columnLayout` takes no thumbnail
  height), and `maxBandWidth` keeps the stage 320 px: two columns are a
  GREYED glyph of the band's settings panel at 1270 px with the Library docked
  (its reason as the tooltip), not a silent clamp — the panel itself is
  `SettingsMenu`, `frontend.md`, «A view's settings are a PANEL».
- **A cell is CALM**: one pill (`⊘ ● ↑ – variant ▶ !`), Winnow's mark, the
  run's mark at the centre, a caption from 112 px (his Q5; always in the
  sheet). The delivery badge and `×` LEFT it (Q6). Acting is the picture's
  ⋯ menu (a right-click too; one portalled `AnchoredMenu`, extracted from
  `OverflowMenu`, for the whole strip) or the SELECTION — a mode (`S`, Select,
  a Shift/⌘-click, a finger held on touch: `press-intent.ts`'s
  `LONG_PRESS_MS` / `PRESS_SLOP`, the click after the hold swallowed, the
  touch `contextmenu` suppressed) whose header is the `SelectionBar`: words on
  a desktop, glyphs on a phone and in the column (`narrow`), Apply folded into
  More under 800 px (`dense`). `⌘A` only while selecting; a removal that
  empties the selection ends the mode; `openAfterRemovals` picks the next open
  picture for a bulk removal.
- **The sheet** (`G`, ▦) covers the stage and the band and NEVER the inspector
  (Q4; `span=2` beside a column), full screen on a phone. **Focus** (`F`, ⤢)
  hides the band, the inspector and the page bar; Escape steps selection →
  sheet → focus → the stage's own (`onEscape` returns whether it took it).
- Keys live in `editorKeyAction` (S, ⌘A while selecting, B, G, F, −, =) and
  are relayed through `callbacks.current`, like every other.
- Driven headless at 1270 × 1300, 1700 × 1200 and 390 × 844 (touch) — NOT on
  his Mac or his iPhone. §7 of the brief stays his to overrule.
- **On a phone (2026-10-06, his screenshots)**: the sheet's header is TWO rows
  (title · count · ✕, then filter · size · Select) — one `flex-none` row could
  not wrap and pushed Select and ✕ off the screen; its bottom room is paid
  INSIDE the scroller. A band of ROWS snaps (`snap-y snap-mandatory`, cells
  `snap-start`, `scroll-padding` = the layout's `pad`), so it rests on whole
  rows with breathing room under the header instead of a row sliced flush
  against it; the reveal of the open cell is scoped to the band's own body
  with the same `pad` as margin. The stage bar's ± fold into the zoom pill's
  menu on a phone (`StageZoomControl` `folded`), and Focus and Keys and
  gestures join that menu and leave the well — at 390 px the pill (128) and
  the nine-verb well (324) were 86 px wider than the row, so `?` and Focus
  sat off-screen. Driven at 390 × 844 touch: nothing past the right edge.

## The band draws the cells near the view, and a thumbnail knows its shape (2026-10-06, P2 of `docs/develop-performance.md`)

Audit PERF-03: a roll of 300 put 300 cells in the DOM at open, decoded 300
thumbnails to measure them, and re-rendered every cell for each one that
landed. Measured headless on a seeded roll of 300 with stored thumbnails:
at open 300 → 15 cells and 300 → 0 decodes on a desktop, 8 cells on a phone,
the JS heap 69 → 43 MB; the contact sheet 600 → 60 cells; a picture opened
far down the roll by its route draws 15 cells around it with its own in
view. Rules:

- **The cells DRAWN are those within one box of the scroll view on the
  scroll axis, and the open one always** (`cellsInView`, pure, specs): the
  host's scroller publishes its position and its box (`useScrollView`, read
  once per frame and published only past a quarter of the box, so a fling
  re-renders the strip a few times and never per frame) and `StripCells`
  filters the layout's rectangles — the layout itself stays whole, so the
  `<ol>` keeps its full extent and the scrollbar its length.
- **A drawn cell's picture is EAGER, and the instance's thumbnail stays
  until a local one replaces it** (2026-10-06, his iPhone: «certaines
  miniatures ne chargent pas»). A `loading="lazy"` `<img>` inside a scroller
  may never start in WebKit — no load, no error, so `WinnowThumb`'s retry
  never runs and the cell is an empty frame (headless too: lazy cells still
  pending after 6 s); the window already limits what is drawn, so the band's
  blob `<img>` and its `WinnowThumb` (`eager`) load at once. And a remote
  picture fetched into the pool (the open one and its neighbours, `ready`)
  used to swap its instance thumbnail for "…" until its own bake landed —
  one decode at a time, never if the bake failed; now any cell with a
  `remote` and no local thumbnail draws the instance's, whatever its state.
  `useScrollView` also re-reads the position when its box changes SIZE: a
  resize can clamp the scroll without a scroll event.
- **A cell takes its rectangle as plain numbers** (`x y w h cap`), never the
  layout's object: the layout is rebuilt as thumbnails land, and the memo
  held on nothing while every cell was handed a fresh `StripCell`.
- **The `<img>` is `loading="lazy"`**: a cell in the margin loads its picture
  as it comes near and never ahead of the ones on screen.
- **A thumbnail knows its shape**: the aspect is kept BESIDE the bytes
  (`ThumbRecord.aspect`, from the canvas the bake drew on — `BakedThumb` —
  or the snapshot's, handed to the band in the SAME render as the blob
  through `keepThumb`); one stored before it was kept is measured once at
  the next open and written back (`setRollThumbAspect`), so the 300 decodes
  are paid once per old roll and never again. `useThumbAspects` trusts
  `known` for a blob it has not measured: the host keeps the two maps in
  step, or a stale aspect would shape a cell until the next open.
- **The open cell is scrolled to by its RECTANGLE** (`useScrollToOpen`),
  nearest edge, once per open picture per axis — never asked of the DOM
  (the first layout is laid at no width) and never again on a later layout,
  which would pull the band back under a hand that scrolled away. A box
  still unmeasured waits for the one that is.
- The bake order is the open picture first, then outward: the cells on
  screen get theirs first. The bench: `testing.md`, «The band bench».
- **With the snap of the phone's band of rows** (above): the cells outside
  the drawn window are no snap points, and the window is published every
  quarter of the box while the hand scrolls, so the rows the scroll can rest
  on are always drawn ahead of it; the reveal of the open cell takes the
  same `pad` as its margin, by arithmetic on the body's own scroll position.

## Auto level: the horizon found by itself (2026-10-02, A2 of `docs/auto-develop.md`)

`shared/develop/auto-level.ts` (pure, 10 specs) + an **Auto** button in the
Crop tab's Level row. `measureTilt(luma)`: a 5-tap binomial blur, a
**Scharr** gradient per pixel, each edge's line direction folded to its
deviation from the nearest axis (the fold `levelDelta` makes, so a leaning
wall and a tilted horizon vote together), a 0.1° histogram within
`MAX_TILT` (15°) weighted by edge strength (edges under 15 % of the strongest
do not vote), the peak refined by a weighted mean over ±1°, and a
CONFIDENCE — that window's share of the mass — under which (`CONFIDENCE_FLOOR`
0.2) the verb says "no line to level on" and turns nothing. The panel reads
the picture AS SHOT through `picture.asShotSample(512)` (new on
`DevelopPicture`: a fresh canvas with the source drawn small, on demand), and
writes through `crop.straighten(levelFine(tilt, flipX, flipY))` so the zone
refits from the intent exactly as a drawn Level line does; a flip reverses
the sign, a quarter turn needs no account. **Two traps, both measured in the
specs**: Sobel's kernel is not rotation-symmetric and read a 4° edge as 3.8°
(a 5 % shrink on every angle) — Scharr's (3, 10, 3) is exact to the tenth;
and without the blur a nearly horizontal edge is a staircase whose long runs
vote for 0°. **A third, found only by driving it**: `asShotSample` first drew
the source to 512 px in ONE `drawImage`, and the browser's default downscale
is a bilinear SUBSAMPLE — at 3.1× it turned a 4° horizon into a staircase the
module read as 5.9° at 36 % confidence (reproduced in node by subsampling the
same picture). The sample is now halved step by step with
`imageSmoothingQuality = 'high'`, so every source pixel is averaged; a
sampler for any measurement (a histogram excepted) must downscale that way.
Driven headless against the dev server on a 1600 × 1200 PNG with a horizon
falling 4° to the right: *Auto* wrote Straighten −3.9° (79 % of the edges
agree), kept through a later crop, no page error.

## Crop to the subject (2026-10-02, A3 of `docs/auto-develop.md`)

`shared/develop/subject-crop.ts` (pure, 11 specs) + `tools/develop/use-subject-crop.ts`
+ a *Subject* row in the Crop tab. `maskBounds` reads the subject's box and
covered share off a `BrushRaster`; `subjectZone` takes the box's corners into
the TURNED picture's frame (`screen = R(θ)·M·q`, the zone's own, so a flip
mirrors the centre and a quarter turn transposes the box), pads by
`SUBJECT_MARGIN` (12 % of the longer side, each side), grows the SHORTER side
to the locked ratio (the subject is never cut to a format), and SETTLES the
zone: `settleZone` moves it toward the middle as little as it takes, keeping
its size, and shrinks (`fitIntent`) only when even the middle cannot hold it
— a subject at the edge keeps its shoulder. Refused and said: a mask under
`MIN_SUBJECT` (0.5 % of the frame), a box past `MAX_SUBJECT` (92 % of both
edges). **Where the subject comes from**: the union of the picture's Subject
layers' rasters (`subjectLayersToSegment`, the very rasters the layer pass
draws — `resolvedSubjects`) when it has any; else the model is asked about
the CENTRE, once (`segmentSubject` over `picture.segmentSource`, else
`asShotSample(1024)`), as a task on the stage's scope so the hairline says
it, and the told line says *from the centre* — an assumption spoken, never a
crop from nowhere. The zone goes through `crop.setZone` so the chip is kept.
Three taste constants, named for his pictures. Driven headless on the same
synthetic picture with no Subject layer: the model loaded on SwiftShader,
answered the centre, the told line read *cropped to what the model finds at
the centre*, the Shape row went 1.33:1 → 1.70:1 and the straighten stayed
— the plumbing, not the taste, since a synthetic picture has no subject to
judge. Not driven on a photograph with a Subject layer.

## Both section switches end on a `never`; no key acts under a modal sheet (2026-10-02)

`sectionValues` (`journal.ts`) and `readSectionValues` (`roll-types.ts`)
end on `unreachedSection(s: never)`: a `PictureEdit` member a switch
forgets now fails `tsc` instead of being read as `{}` — which made
`sameSection` compare `{}` with `{}`, so `sectionsChanged` was blind to the
new section and the journal missed it (`docs/audit-2026-10-02.md`, ARC-05;
the whole fix, one `SECTIONS` record the three id lists derive from, is
still open). And the workbench's window key handler stands down for ANY
`[aria-modal="true"]`, not only an `alertdialog`: with the keys sheet, the
settings or the making-of open, ←/→ changed the picture and P/M/U, V and
Delete changed its delivery, its mono and its patches behind the sheet, into
the export (UX-01). A sheet drawn OVER the editor is `aria-modal`; a drawer
or a bottom sheet the author edits THROUGH (the phone's `DockedDrawer`, the
palette) is not, and must stay not, or the keys die with it.

## Develop's SETTINGS are the device's, opened from inside the roll (2026-10-06)

**Decision** (his pick of the three places in the lab https://claude.ai/artifact/Ts6hWzvxxybV67QAR9Z6D8): a sheet opened by a ⚙ in the roll's `PageBar` (`DevelopSettingsSheet.tsx`, not the picture-sections `SettingsSheet.tsx`), never a route and never from the rolls gallery. It gathers what belongs to this DEVICE — Encoder (since 2026-10-06's second commit: the engine, and the colour it keeps per quality, MEASURED — `develop-output.md`), Rendering (the dither switch, look interpolation, Big pictures, past 1:1), Device (the class, applied on reload; the subject model's worker), Network (Lensfun) — and none of it travels with a roll, a preset or a paste. **Not ⌘,**: Chrome on a Mac owns it (its own preferences), and the suite takes no chord a browser may own. Toolbar STATE (facts with `I`, the A/B split, ignored pictures) stays on its toolbar, not here: a fact said twice is said once. The sheet's open state is a module store (`develop-settings-open.ts`) so the Export tab's *Encoder* line opens it on a section without a callback through the workbench; the roll closes it on unmount, and a sheet opened ON a section shows that pane on a phone, not the list. The line's verb says *Settings*, not *Change*: there is nothing to change until a second engine exists. **Next**: MozJPEG in a worker in bands (an *Engine* choice in the Encoder section) — smaller targets are rounded once since the third commit (`develop-output.md`); a per-picture deband slider only if asked — noise on an 8-bit SOURCE was REJECTED (his «ça risque beaucoup de dégrader les images»: a develop stretches it into grain). **How to apply**: a new per-device choice is a `localPref` (`shared/ui/local-pref.ts`) shown in this sheet, never a `useState` of its own.

**Rev. 2026-10-06, the polish pass («coherent, elegant, clean and handy»).** A row of the sheet is the inspector's split at a setting's label width: the NAME, its control, ONE state line under the control (`text-xs text-muted`, what the choice in hand does, changing with the value) and the standing why behind an ⓘ beside the name (`InfoDotButton`, the `FoldHints` shape) — the first cut put a paragraph of mono `text-3xs` (9 px) under every control, which read as a manual nobody could read. Controls take `useFingerSize()` (`md` under a finger); Enter closes like Escape, every row writing at once (the Trip settings' rule); the Network section's id is `network` (`privacy` is still decoded from a stored value); the phone's list is `flex-1` alone — `flex-none` beside it won and left a gutter. No hint carries a date or a session fact (`frontend.md`, 2026-10-06). The Export tab's *Encoder* line says the engine alone (`Browser` + *Settings ›*): what it keeps of the colour is said under each JPEG target's quality, where the quality is set (`develop-output.md`).


## Each picture AS SHOT is kept beside its record (2026-10-07, B1 of `docs/auto-develop.md` §6)

**Decision** (his «start and everything that could be autodevelop», with a
settings row where a question would have been asked). A develop is a record,
and a model can only learn what the record ANSWERS TO — the picture before it —
while the roll's thumbnail is the picture as delivered. So every photograph
whose file is in hand gets a PAIR baked once and kept in `atelier-develop`'s
`shots` store (v5): a 256 px JPEG of it as the browser decodes it (1–2 kB on a
flat picture, ~14 kB on a real one), the `SourceStats` the Auto verbs read,
measured off that very canvas, and the camera's facts (`shotExifOf`: body,
lens, exposure, white-balance mode, the hour — never the GPS, never a word),
plus the file's own size and whether a RAW's render stood in. Keyed by picture
id, never on the document, pruned with the picture and with the roll. Rules:

- **A DEVICE choice, kept by DEFAULT** (`shotsPref`, `atelier.develop.shots`,
  absent = on; the Learning section of Develop's settings): every day without
  a pair is dataset lost (§4 decision 2), and his §8 question — whether the
  vignette may be kept — became a row he can switch. Off means GONE: the sheet
  clears the store itself (`clearRollShots`) and the hook only forgets what it
  knew, so a later Keep bakes afresh — a hook may not be mounted when the
  switch is thrown. The working previews' rule, device-wide instead of
  per roll.
- **Baked in the roll's one background decode slot** (`shot-bake.ts` through
  `enqueueRollDecode`), decoded AT 256 px by the one door, the real file before
  a working preview (`use-roll-shots.ts` leaves a preview out of `tried`, so
  the real file is read when it comes); a clip is never baked. A canvas-made
  JPEG or a preview carries no EXIF and the record says `exif: null` rather
  than inventing a body.
- **The one exception to «media bytes are never persisted» grew a FOURTH
  case** (`local-first.md`): a vignette is media, small, local, per device.

Driven headless (`shots.mjs` in the session scratchpad: a roll seeded through
`putRoll`, two canvas JPEGs dropped on the editor): two records in the store
within a second, 64 bins each, the linear means telling the blue picture from
the warm one, `natural` 1600 × 1000, the Learning pane reading `2 kept · 3.0
KB`, Off → 0 records and the pane saying so, Keep → 2 again, no page error.
Not driven: a RAW's pair (`viaRawPreview`), a real file's EXIF.

**The TRAINING FILE (B2, same day)** — `training-dump.ts` (pure, specced) and
a *Training file* row under the switch, in the SAME Learning section rather
than on the gallery the brief named: one place, beside the choice it depends
on, reachable on a phone (the gallery's header is not drawn there). One JSON
file (`atelier-training-<day>.json`, `kind: atelier/training-pairs`, v1),
one line per picture of EVERY roll that has its pair: the vignette as a data
URL, its stats, the camera's facts, the sections edited, and the RECORD
normalised through the very readers a roll uses (`normaliseDevelop`,
`normaliseFraming`, `keystoneOrNull`, `lensOrNull`, `detailOrNull`,
`postVignetteOrNull`, `readPatches`, `readLayers`, `readRollGrade`), so a
script never guesses an absent field. Rules: an UNTOUCHED picture is a pair
(«change nothing» is an answer to learn); a look's legacy inlined `.cube`
text is replaced by its byte count (a lattice is not a label); the media's
asset and source ids, the journal, the words and the delivery stay out; a
vignette that cannot be read keeps its line with `vignette: null`; a picture
without a pair (a clip, a file never in hand) is COUNTED in the line under the
verb, never silently dropped. Driven headless (`dump.mjs`): a developed and
an untouched picture gave a 7 kB file with both, the line reading
`atelier-training-2026-10-07.json · 2 pairs`. A trainer outside the repo (B3)
reads it; the model it makes comes back as a verb (B4).

## Auto detail: the noise and the sharpen seeded from the ISO and the material (2026-10-07, A4 of `docs/auto-develop.md`)

`shared/develop/auto-detail.ts` (pure, 7 specs) + an *Auto detail* switch at
the head of the Detail tab (`DetailPanel`'s `auto`), held by the workbench
over the whole detail record through `use-value-switch.ts`. What it reads,
never guesses: the ISO of the file ON SCREEN (`useEffectiveExif(shownFile)` —
the vouched record for a proxy) and the MATERIAL the picture is developed
from (`onSensor` → the sensor; a working preview or an origin whose fidelity
is `proxy` → a proxy; else the camera's file). Rules:

- **Per STOP above a floor**, like Lightroom's and Capture One's seeds:
  luminance 12 a stop above ISO 800, colour 10 a stop above 400 (capped 80),
  the sharpen's masking 12 a stop above 800 (capped 60); the sharpen by
  material — 35 on a demosaiced sensor, 20 on a body's JPEG (sharpened
  already), 0 on a proxy, SAID (`no sharpen on a proxy`). The radius and the
  Detail are the lens's and the hand's and are never written. Every number is
  a named taste constant (`docs/auto-develop.md` §8).
- **No ISO → the sharpen alone**, and `no ISO in the file · noise left alone`:
  nothing written where nothing was measured. A clamp is said.
- **A VALUE switch** (`value-switch.ts`, pure, 6 specs; `use-value-switch.ts`,
  a session map keyed picture|verb): `switchState` over the whole record, so
  the radius a hand set comes back with the rest on a turn-off and ⌘Z lights
  the switch. **Trap, found by the drive**: a `before` that is itself NULL (no
  detail record yet) is not "nothing to put back" — the first turn-off left
  every number standing; the restore is BOXED (`{ value }`) since.
- The Auto row's three verbs keep `auto-slots.ts` (disjoint fields on one
  record); a verb that writes a RECORD whole takes the value switch.

Driven headless (`detail.mjs`, a canvas JPEG stamped ISO 3200 through
`buildExifBlock` + `withExifBlock`): the caption `ISO 3200 · the camera’s
file`, the click writing `noise 24 · colour 30 · sharpen 20 · masking 24`
into the sliders and, after the autosave, the roll; off → every number 0 and
`null` stored; ⌘Z → relit with the numbers back. A drive that re-navigates
to the picture's hash right after a drop races the editor's remount and its
tab click is lost — click after the drop settles, and retry until the tab's
own sliders exist.
