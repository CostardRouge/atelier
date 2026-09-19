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
- `rollProgress` counts a border as looked at.

Verified in the pane through the app's own `renderRollPicture` on a 3000×2000
half-blue/half-green JPEG: a 10 % vermilion border on a 1:1 file → 3400×3400,
vermilion outside, blue and green inside; a 1:1 crop at scale 2 → 1000×1000
(the zone, native density); a blur border on 9:16 → 3200×5689 with the fill
blue on the left and green on the right, darkened (208 against 254).
