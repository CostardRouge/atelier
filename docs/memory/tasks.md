# Tasks — saying that something is taking time

Read before touching `src/shared/tasks/`, `shared/ui/TaskEdge.tsx`,
`shared/ui/TaskPill.tsx`, or before adding a spinner, a bar, a "please wait"
or a cancel anywhere. The design and its five phases are
`docs/progress-feedback.md`; what is built is `docs/run-sheet.md`.

## T1 — one registry, two surfaces (2026-09-21)

**Decision.** `shared/tasks/tasks.ts` is module state with a subscription —
like the preset book and the session cache, never a React context — so a task
started by a hook SURVIVES the screen that started it (his question 4: a roll
export goes on while he walks to the gallery, and the pill still says so).
`startTask({label, scope?, progress?, detail?, cancel?})` returns a handle
(`update`, `done`); `useTasks(scope?)` is what a surface reads.

- **`TaskPill` lives in the MASTHEAD, at every width** (`App.tsx`, before the
  source pill): the one row every screen keeps, which answers his question 3
  (where on a phone) — the word goes on a compact shell and the dot stays,
  exactly the `SyncPill` rule. A pulsing accent dot and one word (`Working`,
  `2 running`, or the whole's percentage where every task is measured); the
  list in a popover with a bar and a Cancel per task. Draws nothing when
  nothing runs, and the popover goes with the last task.
- **`TaskEdge` is the media's surface**: a 2px hairline in a `relative` stage
  box, a fill where the length is known and a sweeping sliver where it is not
  (the lightbox's `animate-deck-load`), for the tasks whose `scope` is that
  media (`fileIdentity(file)`, a picture id). Words and Cancel are the pill's.
- **Under 400 ms nothing is drawn** (`SHOW_AFTER_MS`, `visibleTasks`,
  `nextReveal`): a task registers at once and the hook wakes itself when the
  youngest hidden one is old enough. A fast fetch never flashes.
- **`overallProgress` is null the moment ANY task has no length**: a bar half
  determinate would claim a whole nobody knows — the honest-value rule
  (`roadtrip.md`, "the real value or nothing") applies to a bar as to a badge.
- **A Cancel is drawn only where `cancel` is present**, and `cancelTask` is
  the only caller; a button that does nothing is worse than no button.
- **No ceiling on concurrent tasks** (his question 5): the popover lists them,
  oldest first. One task per operation a person asked for, never per frame.
- Driven in headless Chromium at 1400 and 390 px: nothing at 150 ms, the pill
  at 650 ms with the word (wide) or the dot alone (phone), the popover's two
  bars (`25 %` fill, a sweep), Cancel calling back, the pill gone with the
  last `done()`.

## T2 — every fetch of a media's bytes is a task (2026-09-21)

- **One seam, `trackedFetch`** (`shared/tasks/tracked.ts`): a task registered
  before the first byte, an `AbortController` as its Cancel, and a bar that
  moves with the bytes — against the server's `content-length` where the
  instance exposes it, else the weight the caller already knew (a row's
  `file_size`), else a sweep. A cancelled fetch rejects with an `AbortError`
  whose message names the task ("Fetching DJI_0202.JPG was cancelled"), so a
  caller says it or stays quiet (`isAbortError`, `fetch-options.ts`).
- **Every thunk takes `FetchOptions`** (`signal`, `onProgress`):
  `MediaOrigin.fetchOriginal`, a companion's `fetchFile`, `SensorSource.fetch`,
  the Winnow client's `fetchFile` (which reads the body chunk by chunk only
  when asked for progress). `WinnowClient.request` never REPLAYS an aborted
  request: the cache-heal retry is for a browser's refusal, not a person's.
- **Where the task starts**: `materialize` (one task per asset, named after
  the capture, `’s proxy` where it is the proxy — covering the picker, a
  slide's re-fetch, the browser's Add, a roll's own fetch; `quiet: true` for
  a caller that is already a task), `fetchSourceFile(source, scope)`,
  `deliveryFor`, `useCaptureView.load`, the roll export's original fetch, the
  Studio's capture fetch. `fetchHead` (a megabyte) starts none.
- **Scope is the capture's ASSET ID** (`<host>/<id>`) wherever a source
  vouched for one, else the file's identity — one key for the stage's edge
  and for every fetch of that capture's files (its companion is scoped to the
  PICTURE, not to its own id). The Develop viewport takes `scope` and draws
  `TaskEdge` on its bottom edge.
- **A modal sheet carries its own cancel**: the masthead's pill sits BEHIND a
  `fixed inset-0` lightbox and cannot be clicked through it (found by driving
  it), so `MediaLightbox` takes `taskScope`, draws the edge on the deck and a
  `cancel` link beside the chips, and a chip clicked again after a cancel
  clears its failure and asks again.
- Cancelled from the picker (`usePickFromInstance`), nothing is reported: the
  person did it. Elsewhere the sentence says "was cancelled".
- Driven against the stub instance with a 2.5 s delay on `/download`: no pill
  at 200 ms, `Fetching DJI_0202.JPG · 0 % · 10.0 KB` at 800 ms with the deck's
  edge, the sheet's cancel ending the request, the retry drawing 800 × 450,
  the sensor rung's fetch on the stage's edge (`aria-valuenow` 0, at the
  bottom) and in the pill, gone with the file. A trap on the way: a `void
  job.finally(...)` on a rejected promise is an unhandled rejection of its
  own — forget the flight with `then(f, f)`.

## T3 — the RAW decode and the loupe (2026-09-21)

- **`decodeRaw` is a task of its own** — `Opening DSC00123.ARW`, a sweep,
  since nothing measures a demosaic — registered the moment it is asked,
  which includes its wait in the decoder's chain. Its Cancel aborts a
  `signal` checked twice: before the file is read (a decode still queued
  costs nothing and the worker is never touched) and when the worker hands
  the plane back (the linearisation is not spent on a result nobody wants).
  **The worker's TURN is dropped, never the worker** — a cancel costs the
  next decode nothing, and `disposeRawDecoder` stays for a decoder that
  refused. `quiet: true` for a caller that is a task already; `scope` for
  the stage's edge. A cancelled decode rejects with an `AbortError` naming
  it.
- **The stage's decode passes its scope and a controller**
  (`useDevelopPicture({ taskScope, onRawAborted })`): cancelled from the
  pill, the hook says nothing on the stage and calls `onRawAborted`, and the
  workbench takes the picture BACK TO ITS RENDER (`base: null`) and says so —
  a base whose data never arrived is not a base. Stepping away from a picture
  mid-decode aborts the same way and tells nobody: nothing was asked. A
  render's own decode (`loadBadgeSource`) registers `Opening <file>` with no
  Cancel — the browser's `createImageBitmap` cannot be stopped — so a big
  JPEG at least says what it is doing past 400 ms.
- **The loupe's decode is `Looking closer at <file>`** with a Cancel: a RAW's
  drops the decoder's turn (quiet, under the loupe's own task), a render's
  lets the browser finish and throws the bitmap away. The loupe's pill says
  `loupe · cancelled`, a state of its own beside `failed`.

## T4 — the exports (2026-09-21)

The brief's "the real work" was smaller than written: the video pipeline
already took a signal (`frontend.md`), so T4 is the two loops that did not.

- **The Develop roll's run is ONE task** (`use-roll-export.ts`): `Exporting
  N pictures`, a picture at a time on its bar (`i / N`, the detail naming
  it), then `Writing the pictures` with the files written. Its Cancel stops
  BETWEEN two pictures and is handed down as an outer signal to every fetch
  in the run (`fetchSourceFile(source, scope, signal)`, `trackedFetch`'s
  `signal`) and to the RAW decode (`RollRenderOptions.signal` →
  `decodeRaw({ signal, quiet })`), so a 74 MB fetch in flight ends with it.
  **A cancelled run keeps what it rendered** (his question 2, answered by
  building): the pictures already rendered are written, and the note says
  `Cancelled after 1 of 2 — 1 picture written`; a fetch the cancel ended is
  never listed as a failure. A run cancelled before anything rendered says
  `Export cancelled — nothing was written`.
- **Trips' three exports are tasks** (`use-post-exports.ts`): `Exporting the
  piece`, `Exporting the slides`, `Encoding the hook`, scoped to
  `piece:<post.id>` so `BadgeStage` draws them on its edge; the header's own
  fill stays and the task mirrors its line and ratio. `renderDeck` takes a
  `signal` and stops between two slides, handing back what it made; the
  piece export passes the signal into the clip encodes and writes what
  rendered, saying `cancelled after N of M`.
- **The Studio's export registers a task beside its own bar and Cancel**
  (`Exporting <name>`, a variant at a time), scoped to the media, so the
  pill says the same wherever the person walks; nothing about its panel
  changed.
- Driven against the stub instance: a two-picture roll whose second JPEG is
  slow — the pill reads `Exporting 2 pictures · 50 % · 2/2 · DJI_0103.JPG`
  with the fetch beside it, its Cancel ends the request and the run, one
  file is written and the note says so.

Not wired yet: T5 the one-off surfaces.
