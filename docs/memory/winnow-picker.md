# The Winnow picker — one modal for every "take media from an instance"

Read when you touch `shared/sources/winnow/picker/`, the Library's *browse
all*, Develop's *Add a day*, `DayPicker`, or anything that lists an
instance's day or folder for a person to tick. The design and its two labs:
`docs/winnow-day-sheet-verdicts.md` §7.

## What the rail decides, and where (2026-10-01, P1)

**Decision.** Everything the picker decides about rows is pure, in
`picker/pick-filter.ts`: five BUCKETS from Winnow's culling (pick · starred
without a flag · unrated · skipped · rejected — a flag outranks a star), a
`PickFacets` record (buckets, stars at least, type, extension, device, tags,
no final yet, not already held), counts, verbs, opening ticks, piles.
**Why**: the maintainer's ask was "see the verdicts and select by them";
the rows already carry everything (`GRID_SELECT`), so the work is reading,
and reading belongs in a module the tests can hold.

- **Only the library HALF goes to the server.** The other facets are
  multi-select and filtered over the scope's rows, because Winnow's own
  single-value `ext`/`device` parameters cannot say "A or B", and a half is
  a SCOPE (a capped list filtered afterwards loses rows — `use-scope-rows.ts`'s
  rule, kept).
- **Counts are the scope's, filters ignored**, so ticking one facet never
  moves another's numbers; a value still ticked that the scope lost is listed
  at zero so it can be unticked (`facetValues`).
- **The verbs act on what is DRAWN** (`drawn`: the shown rows plus an
  unfolded pile's frames), never on the whole day: filter by a body, press
  `4`, and that body's ★4+ are ticked. A ticked row nothing draws is COUNTED
  (`hiddenTicked`) and still added — never added in silence, never dropped.
- **Opening ticks** (`openingTicks`): `picks` ticks a culled scope's picks
  and, where Winnow picked nothing, everything not held EXCEPT the rejects;
  `none` ticks nothing (the Library: an add downloads); `all` is
  everything-but-rejects. Nobody opens a day to add what they threw away.
- **A pile** (`pilesOf`, `surfaced`): its cover — the stored one when
  listed, else its first listed frame, Winnow's own fallback — plus every
  frame Winnow said yes to (a pick or a star); the rest unfold under the
  cover, in their own row, and are then left out of the flat list so no
  picture is drawn twice.
- **Remembered per instance** in `browse-state.ts` (`facets`, `sort`), shared
  by every host — his question 2 of §7.4, answered yes by recommendation.

**`bursts: 'frames'` is GATED.** `AssetQuery.bursts` sends `collapse=pairs`
(Winnow #277), which an older instance reads as no collapse at all — every
RAW+JPEG pair listed twice. Send it only where `listsBurstFrames(caps)` says
the instance announced it (`media.listCollapse`); a stale capabilities sheet
simply keeps the fold.

## The day stepper is shared, and its month honours a filter (2026-10-01, P2)

`DayPicker` (the stepper + its `MonthPanel`, bars or weeks) moved from
`src/app/` to `shared/sources/winnow/DayPicker.tsx`, because the picker lives
in `shared/` and `shared/` never imports `app/`. Two props were added, both
optional so the sidebar's call barely changed: `filter` — the month's counts
are asked under it and CACHED per month AND filter (a half's month is not the
whole library's) — and `showLine`, off in the picker, whose own status line
says the same thing. The sidebar now passes its half, so a day its strip
calls full is full in the half the tab lists; before, the strip counted both
halves while the grid listed one.

## The modal and its host contract (2026-10-01, P3)

`WinnowPicker` (`picker/WinnowPicker.tsx`, with `PickerRail`, `PickerTile`,
`picker-host.ts`) knows no tool: a host passes a `PickerHost` — title,
destination pill, start (a day, and a half when it is looking at one),
anchor for the month's marks, `held` + its label, `openTicks`, `accepts`,
`extras` drawn in the bar, and `actions` (the last is the primary, Enter;
`run(rows, { signal, progress })` resolves `true` to close). It always OPENS
ON THE HOST'S DAY (scope Day); the folder, the half (unless the host names
one) and the rail come back from `browse-state`. The scope's ticks are
re-seeded when its rows ARRIVE, never on a facet or a tick. **How to
apply**:

- **One date control.** `Day` is the shared `DayPicker` (bars or weeks);
  `Folder` is a button whose popover lists the instance's sessions under the
  same half. A popover that closes on Escape CLAIMS the key
  (`preventDefault`) — `useDialogKeys` stands down on a prevented press, so
  the first Escape closes the popover and the second the picker.
- **A tile's pile badge is a SIBLING of its button**, never inside it: a
  button in a button is invalid, and a click on the badge must not tick.
- **A `Button`'s own `inline-flex` outranks `hidden`** in the generated
  sheet (the trap `WinnowBrowser` already paid): a breakpoint that hides a
  `Button` goes on a wrapper (`hidden max-[820px]:contents`), never on the
  button's `className`.
- `CullMark` moved to `shared/sources/winnow/` with its second consumer
  (the picker after Develop's filmstrip and Pictures table).
- On a phone the rail is a full sheet behind *Filters · N* with a pinned
  *Show N media*; the scope and the date take their own line, the close
  button stays beside the title.

## The Library hosts it as *browse all* (2026-10-01, P4)

`app/LibraryPicker.tsx` replaces `WinnowBrowser` (865 lines, deleted): it
opens on the sidebar's DAY AND HALF, marks the tool's span in the month
(the sidebar's own `dayAnchor`), draws what the pool holds *in library*,
ticks NOTHING on open (an add downloads — his question 1 of §7.4, answered
by the recommendation), and its one verb fetches each ticked row through
`materialize` at the chosen fidelity, kept in `browse-state` beside the rail
and written read-modify-write so neither half of the place overwrites the
other. A Cancel stops the run and what landed is still added. Closing it
leaves the sidebar where it was (question 3). **Given up**: the old browser's
*by leg* tab (dormant behind `TIMELINE_SYNC_ENABLED`) and its server-side
`mediaType`/`ext`/`device` selects, which the rail's multi-select facets
replace. Driven headless against a stub: the month walked back to a culled
day, `P`, Sony + `4`, the folder popover, the Gallery half, *Add 4 to
library* → four files in the pool; Escape closes the month first; a phone
gets the rail as a sheet and no horizontal scroll.

## Develop hosts it as *Add a day* (2026-10-01, P5)

`tools/develop/RollPicker.tsx` replaces `WinnowDaySheet`: it opens on the
open picture's day, marks it and the span the roll already covers, draws
*on the roll* through `sameMediaRef` (an asset-id set first, the hash-then-
name walk only for the rest), takes photos and clips, ticks a culled day's
PICKS on open (else everything the roll lacks but the rejects), and its verb
adds `rowMediaRef`s — nothing fetched, as before. **Trap**: a host object
rebuilt per render re-derives the whole scope's rows on every one, so the
roll editor memoises the held refs and the roll's span, and the verb reads
`addRefs` through a ref. The open picture's day is `pictureDay` in the
BROWSER's zone (unchanged from F3), so a picture shot at 07:00 +10:00 opens
on the previous day in a UTC browser — the picker shows that day, it does
not correct it. Driven headless against the stub: a new roll's *Add a day*,
the month walked to a culled day, six picks ticked on arrival, *Add 6 to the
roll*, the picker closed and the strip filled.

## The sidebar's instance tiles wear the marks; no verdict filter there (2026-10-01, P6)

`WinnowScopeGrid`'s tiles draw `CullMark` (flag, stars, label) top-right,
from the row they already hold — no request. The sidebar gets NO verdict
filter of its own: his question 5 of §7.4, answered by the recommendation
(the marks first, a "⚑ only" beside All · Incoming · Gallery only if asked
after use); narrowing by verdict is the picker's job, one *browse all* away.

## A pile's frames: listed where announced, asked for on unfold otherwise (2026-10-01, P7)

The picker asks its scope with `bursts: 'frames'` (`collapse=pairs`) when
`listsBurstFrames(connection.capabilities)` says so — the elected frame of a
pile then surfaces as its own tile and `P` ticks it. Otherwise piles come
folded, and unfolding one whose listed frames are fewer than its size asks
`burstId` (one request, the half kept) and merges the frames into the scope's
rows — never into the opening ticks, which describe the scope as it arrived.
The capabilities sheet is a SNAPSHOT: a browser connected before Winnow #277
keeps folding until `#/sources` (or a gallery's probe) re-asks the instance,
and the fallback covers it meanwhile. Driven against the stub both ways: with
`pairs` the day lists 44 media and `P` ticks 7 (the burst's pick included);
without, 43 and 6, and the unfold asked `burst_id=9001` and drew 5 frames.
