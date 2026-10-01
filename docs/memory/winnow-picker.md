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
