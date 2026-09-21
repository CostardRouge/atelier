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

Not wired by T1 — the phases that follow do it: T2 the fetches, T3 the RAW
decode and the loupe, T4 the exports, T5 the one-off surfaces.
