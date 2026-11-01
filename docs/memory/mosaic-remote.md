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
