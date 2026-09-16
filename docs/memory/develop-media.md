# Develop — where a roll's pictures come from

Read when you touch how the Develop tool finds a picture's BYTES
(`shared/develop/roll-media.ts`, `tools/develop/use-roll-media.ts`), how
pictures get onto a roll, or anything that could make a roll persist or
fetch media. The roll document itself is `develop-roll.md`; the plan and the
maintainer's decisions are `docs/develop-tool.md` §9.

## The roll fetches its Winnow pictures itself, outside the Library (2026-09-16, F1)

**Decision (maintainer, Q1 and Q3 of §9).** A roll resolves each picture's
bytes on its own: the Library first (`findMedia`, name then hash), else the
instance its ref names through `refetchMedia` — `materialize`, so the file
carries the original's hash, the row's EXIF and a `fetchOriginal`, and the
export's `Auto` keeps working. **The fetched file is NOT added to the
Library**: it lives in `useRollMedia`'s pool. **Why**: the maintainer's
report — a reopened roll showed thumbnails and nothing else until its day
was ticked again in the sidebar; Trips already re-fetched (into the Library)
and Défilé already fetched outside it, Develop did neither. **How to apply**:

- **Only what is near**: the open picture, then after/before alternately out
  to `FETCH_RADIUS` (2), one request at a time; pool entries beyond
  `KEEP_RADIUS` (6) are dropped when the open picture moves. An in-flight
  fetch is never cancelled (its promise is kept by picture id and reused), a
  run superseded by a step just stops starting new ones.
- **Only a connected instance** (`resolvableSource`), only while a roll is
  open — `resolve-media.ts`'s rule for Trips, unchanged.
- **A failure is kept per picture and never retried on its own**: `failed`
  (the instance's sentence, and a sign-in link for a 401), `gone` (a 404 — its
  numbers are kept), `unconnected` (the ref names a host this browser has not
  allowed), `local` (no `assetId`). The status line says each once and offers
  *Sign in*, *Try again*, *Sources*; the stage says the open picture's.
- **The export fetches on the spot** (`fileFor`, not kept when far from the
  open picture), so *Export the roll* no longer refuses a picture merely
  because it was never opened.
- **A cell with no stored thumbnail shows the instance's own** (`WinnowThumb`)
  while the picture waits or loads — a roll's strip is complete before any
  byte is fetched.
- **Trap**: the summary's instance must be kept per state — a failure on one
  host and an unconnected ref on another named the wrong one in one line.

Verified in the Browser pane on a dev server of the branch against the
scratchpad stub, extended with `/api/assets`, `/api/assets/:id`, `/proxy`,
`/download`, `/thumb`, a `signedOut` switch, a delay and a delete: a roll of
six instance pictures, one local and one on an unconnected host, reopened
with an empty Library → the open picture showed after its fetch, 102 and 103
followed, 104–106 waited with the instance's thumbnails, the local and
unconnected ones were said; → → fetched 104 and 105 only; signed out, 106
failed with *Sign in · Try again*, and *Try again* signed in fetched it; 106
deleted on the instance → `gone` in the cell, the line and the stage;
*Export the roll* from the first picture after a reload wrote the five
reachable pictures (fetching the two outside the pool, originals under Auto)
and named the three it could not. The Library stayed empty throughout.

## The add button counts only what the roll does not hold (2026-09-16, F2)

The Library TICKS every asset it imports, so "the Library's selection" is
mostly pictures a roll already has: counting it kept *Add 3 selected* on the
bar of a complete roll. `RollEditor` now hashes the ticked photos
(`hashedMediaRefs`, memoised) and keeps those no picture matches
(`sameMediaRef`: asset id, else hash, else name and size); the button is drawn
only when that list is not empty (the empty roll's own button stays, disabled,
beside its explanation). **How to apply**: anything that offers "add what is
ticked" filters against the document first — the Library's selection is not a
statement about the roll. Verified in the pane: no button on a roll with
nothing new ticked; two dropped JPEGs → *Add 2 from the Library*; after the
click the button went away with both still ticked.

