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

Not wired yet: T3 the RAW decode and the loupe, T4 the exports, T5 the
one-off surfaces.
