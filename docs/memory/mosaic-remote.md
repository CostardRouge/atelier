# Mosaic — kept on a Winnow, driven by an agent

Read before touching how a mosaic LEAVES its tab: `mosaic-remote.ts`,
`shared/mosaic/mosaic-summary.ts`, the sync in `MosaicTool.tsx`, the
gallery's driver in `MosaicGallery.tsx` (M8), and the `mosaic.*` commands
(M9). The core is `mosaic.md`; the suite's sync is `architecture.md` and
`docs/roadtrip-persistence.md`.

## A mosaic is kept like a roll: listed by a summary, its grids travel, its tiles never (2026-11-01, M8)

**Decision**: kind `mosaic` in the instance's document bucket, over the
shared plumbing (`doc-remote.ts`, `doc-sync.ts`, `useDocumentSync`,
`useDocumentGallery`) — LOCAL NOW, REMOTE ON IDLE, the `SyncPill` beside ‹ ›
in the bar. The wire copy is the document minus `sourceId`: pictures by
reference WITH their grids (the measure of record, so another device
measures nothing), target, crop, settings, chain. The 160 × 90 tiles and the
poster never travel — `tile-bitmaps.ts` cuts tiles again from the instance's
thumbnails as cells draw. Every PUT carries `mosaicSummary` (title, dates,
pictures, measured, instance) and the gallery lists by it where the instance
keeps summaries (`fetchRemote` before mirroring), because a mosaic weighs
~200 bytes a picture. Nothing is thinned to fit the instance's cap — the
grids ARE the mosaic — so an oversize one is refused with the client's
sentence. `mirrorMosaic` also writes the grids into the device's shared
`measures`, so a second mosaic made here from the same pictures measures
nothing either. A new mosaic is born on this device (the atlas's rule); the
⋯'s *Keep on <instance>…* moves it, target first then origin deleted, the id
kept (route, poster, history). **Why**: the roll's precedent fits a heavy
document; his Q6 left Winnow's side to him. **How to apply**: his Winnow
must list `mosaic` in `capabilities.documents.kinds` before any of this
shows there — until then the gallery prints `absentSources`' one line and
never pushes.

## Every open from the gallery asks the instance again (2026-11-01, M8)

**Trap**: the shells resume (pull) once per document id while it stays in
state, and a mosaic moved to an instance or edited on another device came
back from the gallery with the mirror it had — the two-device drive caught
it. **Fix**: `MosaicTool` keys the resume on `id@sourceId` and forgets it
whenever the route is the gallery, so each open asks (a 304 when nothing
changed). **How to apply**: Develop, Trips and the atlas still key on the id
alone; port this if a two-device complaint comes from them.

## Driven with two browser contexts over one stub bucket (2026-11-01, M8)

The scratch stub (`launch(N, { bucket, browser })`) answers
`/api/apps/atelier/docs` from a Map shared by every context, with If-Match
(412), If-None-Match (304) and `fields=summary`: device A moves a mosaic
there, device B lists it by summary, opens it with nothing measured (40 of
40 grids, the shared `measures` filled), renames it — pushed on idle —, A
reopens it and takes B's title, B deletes it on both sides. **Trap**:
`access-control-allow-headers: *` is literal under credentials; a stub must
list `if-match`, `if-none-match`, `content-type` and expose `etag`.

## The commands are registered at three levels, and read the mosaic as it IS (2026-11-01, M9)

**Decision**: the shell (`MosaicTool`, owner `mosaic`) registers `mosaic.list`,
`.create`, `.open`, `.keep` (`moveMosaic`, the open one, flushed first),
`.undo`, `.redo`; the editor (`use-mosaic-commands.ts`,
`useMosaicEditorCommands`) `mosaic.get`, `.add`, `.measure`, `.target`,
`.frame`, `.set`, `.motion`; the stage (`useMosaicStageCommands`, mounted
with the workbench) `mosaic.stage`, `.play`, `.stop`, `.snapshot`,
`.export`. Bounds are typed params (refused, never clamped); what only the
mosaic can say is `shared/mosaic/mosaic-commands.ts` (pure: the outline, a
target that must be held AND measured, the crop, `withMotionAsked` — the
transport's and the Motion section's rules in one). `mosaic.add` reuses
`ASSET_QUERY_PARAMS` / `askFromParams` / `keepAsk` (Develop's door), lists up
to 20 000 rows (the picker's span cap) and drops rejects unless a verdict is
asked, like the picker's ticks. `mosaic.export` takes the export settings
as overrides of ONE run (`useMosaicExport.run(kind, overrides)`, now
answering an `ExportOutcome`) and saves them as the mosaic's. No bridge
bump: the tab lists its commands live, and `MCP_INSTRUCTIONS` names only
Develop and Trips — adding Mosaic there would force a reinstall
(`bridge-version.ts`). **Traps fixed by the drive**: (1) a batch's
`mosaic.motion` then `mosaic.play` ran before React rendered, so `play`
and `available()` read the old mode — every write of the editor now goes
through `act` (the shell's `change` that also writes the editor's
`docRef` at once), the workbench receives that ref as `latest`, and the
stage's play/export `settle()` until the render has caught up (1 s cap);
(2) `mosaic.add {wait}` answered "0 measured" because the run wrote its
grids through the raw `change` — it writes through `act` too, and
`measure` hands back the run already going so a `wait` waits for the real
one; (3) a snapshot of a scene still landing its lots showed a flat patch —
it waits for `progress === 1` while still. **How to apply**: a new mosaic
command reads `latest.current`, never the render's `doc`; one that runs the
player or the exporter calls `settle()` first. Driven through
`window.atelier` (the bridge's registry) on a 60-picture stub: create →
add (wait) → target → frame (1:1, a crop) → set → snapshot → motion + play
in one batch → stage → stop → get → export PNG 720 → undo → keep on the
stub's instance; seven refusals (an unknown param, a picture not held, a
scale under 0.1, a tint over 0.7, Play in Still, a short of 1000, an
instance that cannot keep mosaics), each saying the range or the way out.

## What the independent review caught, and the rules it left (2026-11-01, M8–M9)

A fresh reviewer read the two commits; five findings were real, each
reproduced by a drive (`drive-review.cjs` in the session's scratch) and fixed:
(1) **a replacement is not an edit** — `replaceOpen` (a pull, the pill's
verbs, a lock reload, a move) now `reset`s the undo history, Trips' and
Develop's rule; Atlas has no history, which is why copying it missed it:
an undo there pushed the losing copy back over another device's edit, or
undid a move onto a deleted origin. (2) `mosaic.keep` (and undo/redo) are
`unavailable` in a read-only tab (`needWrite`), since `moveMosaic` writes
outside `change`. (3) **a move holds the document still**: the debounce
is flushed, `moving` makes `change` a no-op, the sync is `clear()`ed so no
push races the origin's delete, and the resume effect re-attaches on the
new source (a manual `resume` only when the move failed). (4) **a measure
asked during a run queues one after it** — a run's list is fixed when it
starts, so answering the running one left pictures added meanwhile, or a
retry, never measured. (5) **an undo waits for the render on both sides**:
the stack records after the render that follows an edit, and the step put
back reaches the editor's `docRef` only at the next one, so
`mosaic.undo` / `.redo` `settle()` before reading the stack and before
answering. **How to apply**: a write that does not go through the editor's
`act` (the shell's undo, a pull) is invisible to the editor's commands until
a render — a shell command that writes settles before it answers.
