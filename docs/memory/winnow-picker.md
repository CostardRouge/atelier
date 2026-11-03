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
  In a SPAN the rail's facets also narrow the server's ask (`scopeKey`), but
  the ticks reset on the PLACE alone (`placeKey`, 2026-10-20): a Device or
  Type click used to wipe every tick there.
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
- **The grid's VIEW is a ⋯ panel** (2026-10-06, his pick A of
  https://claude.ai/artifact/NeMysG6QryTMpbtf2oKk8N; `SettingsMenu`,
  `frontend.md`): the sort `<select>` became its *Order* glyphs (still
  `browse-state`, per instance), and two new choices are PER DEVICE, never per
  instance — tile size S · M · L (`atelier.winnow.picker.tiles`, three whole
  `TILE_GRID` strings so Tailwind sees each, rows still pinned in pixels) and
  the rail as a column or folded (`atelier.winnow.picker.rail`, a wide screen
  only; folded, the phone's *Filters* button shows there too and unfolds it).
  The lab's *Tick all shown* was left out: the footer's **All** already is
  that verb.

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
The unfolded row is ONE grid row, pinned in pixels like the rest, so its
frames are `h-full aspect-[4/3]` inside `px-2 py-1.5` (the focus ring's 4 px
and air) — a fixed `h-24` overflowed the row less its padding and every frame
lost its top and bottom, the ring with them (2026-10-22, his screenshot).

## Space looks, a click ticks (2026-10-01, P8)

A tile opens LARGE on Space or a double click, in the shared `MediaLightbox`
(the instance's proxy over its thumbnail, Winnow's word, the body and the
day in the facts line) and pages through what the grid DRAWS, in its order;
Enter ticks the picture on screen, Escape goes back to the grid. Not
`WinnowLightbox`: that one lives in `app/` and carries the Library's own
verbs (pick, renditions, neighbouring days). **Traps, both met here**: a
button clicks on Space's RELEASE, so a tile claims keydown AND keyup of
Space or looking unticks it; and the tile behind keeps the focus unless the
look blurs it, so Enter would click that tile instead of ticking the picture
on screen. While the lightbox is up the picker's Escape/Enter and its grid
keys stand down (`useDialogKeys` takes `undefined`).

## A SPAN scope beside Day and Folder (2026-10-13)

**Decision.** The picker lists a SPAN of days as one scope (`picker/span.ts`,
`SpanPicker.tsx`), his ask beside the Flight Atlas: the picker was day by day,
and a trip or a season of flights is neither one day nor one Winnow session.
**How to apply**:

- **A span is asked for WHOLE, in PARTS** (rev. 2026-10-13, his report the
  same day: *«du 1er octobre 2025 au 13 octobre 2026 … n'affiche que les
  médias du mois d'octobre 2025»*). The first build asked a span in ONE capped
  walk (3 000), and since the list comes oldest first a dense year showed only
  its first weeks — reproduced on a stub, 13 762 media → 1 Oct to mid-Dec. Now:
  `client.calendar(from, to, filter)` (Winnow's `/api/assets/calendar`, one
  request, the same filters) gives the day counts, `spanChunks` cuts them into
  parts of ~2 000 media (whole days, contiguous, a heavy day alone), and each
  part is walked in pages of 500 (Winnow's `PAGE_MAX`), the grid filling as it
  lands, up to `SPAN_CAP` 20 000. A list that reaches its scope's ceiling — Day,
  Span or Folder — is SAID on the status line, never cut in silence. **Trap**:
  every reset (ticks, unfolded piles, the batch) keys on `scopeKey`, never on
  `rows`, which a span receives part by part; the opening ticks are seeded once
  the list is WHOLE (`loaded`) and added to what was ticked meanwhile.
- **A span is loaded ON DEMAND and drawn VIRTUAL** (2026-11-01, his report: a
  year's month strip did not jump, no feedback, repeated clicks piled up
  requests; lab https://claude.ai/artifact/XN3NqA19mwWwU1GNfiYX6H). The calendar
  answer gives every counted day its SECTION at its real height at once
  (`ceil(n / cols) × row + gaps`, the columns and row read from a hidden grid of
  the same classes), so the scrollbar knows the year and a month click scrolls
  there now; only sections within 1 200 px mount tiles (an `IntersectionObserver`
  on the sections), the rest are spacers, grey while their part is on its way.
  Parts (`SPAN_CHUNK` 1 000, i.e. two pages) are asked by `span-queue.ts`
  (pure, tested): the clicked month's part first, then the parts on screen, two
  at a time, a part nobody looks at any more ABORTED for a wanted one, the rest
  in order one at a time — no `SPAN_CAP` any more. The clicked month is ringed
  with a spinner and the status line says « loading <month> first · N media ».
  **Traps**: (1) a part's state lands a render BEFORE its rows (the rows are
  assembled in an effect): a day that looked empty for that one render was
  UNMOUNTED and came back as a new node the observer never watched — so a
  section is `hidden`, never removed; (2) parts above the view change height as
  they land (estimate → filtered count) and the browser's scroll anchoring
  loses it when a spacer becomes a grid — the picker keeps its own anchor (first
  day in view and its offset, given back after each change, `overflow-anchor:
  none`), and a month click keeps ITS day at the top until that day's rows are
  drawn. Day and Folder scopes, the Logbook and a span sorted by stars keep the
  batches. Measured on a stub of 8 983 photos, 1 s a page: a click on November
  draws it in about a second, stable over four runs.
- **One per burst** (2026-11-01, his ask): a facet (`oneBurst`, remembered with the others) that keeps ONE drawn frame
  per Winnow pile — a pick, then the most stars, then the pile's cover (`onePerBurst`, pure, tested), applied in `shown`
  after the other facets, so a burst whose pick a filter hides still shows its next best. The rail's count is the piles
  drawing more than one frame (`FacetCounts.bursts`).
- **A span asks the server for only what the rail keeps** (2026-10-13, his
  «quand les filtres … et que l'appareil est sélectionné, il faut que le filtre
  soit appliqué sur les médias venant du drone»): `serverFacets` sends the one
  kind ticked, or clips whenever the flight log is ticked, and the bodies ticked
  as Winnow's comma lists (`media_type`, `device` — its `csv` filters, read in
  its `lib/filter.ts`), to the calendar and every part alike; the host's own
  `narrow` wins. A year of everything (13 762 on the stub) becomes a year of one
  drone's clips (4 152). The rail still filters what arrives; the extension
  stays the rail's alone (its stored spelling, with or without a dot, is not
  certain). A ticked body narrows the span, so the rail lists the instance's
  other bodies beside it at zero (`/api/facets`, once per sitting) — ticking one
  asks for it. This REVISES P1's rule «only the half goes to the server», whose
  premise (Winnow's `ext`/`device` single-valued) is false for `device`, and
  for a SPAN only: Day and Folder are small and keep it.
- **A month strip** (`MonthStrip`, `spanMonths`) above a span's grid ordered by
  time: one bar per month from the calendar's counts, faint while its rows have
  not landed, a click growing the batch to reach that month and scrolling to
  its first day heading (`data-day`, `revealInScroller`). Winnow paginates
  correctly — read in its `api/assets/route.ts`: keyset on `(captured_at, id)`,
  timestamps kept as text so the cursor round-trips — so the fault was ours.
- **Presets**: the host's own spans first (the anchor's leg, a multi-day
  anchor), then the last 7 and 30 days, this month, this year, each ending
  today; two `DateRangeField`s for the rest. A preset applies and closes.
- **Where it opens**: `PickerHost.start.scope: 'span'` opens on it (with
  `start.span`, else the last span used on this instance — `BrowseState.span`
  —, else the month of the host's day up to today). Otherwise the picker still
  opens on the host's DAY; Span is a click away and keeps its last span.
- **The grid reads under day headings** in Span and Folder when ordered by
  time: CONSECUTIVE runs of `capture_date` (`dayRuns`, `rowDay`), never
  regrouped, so a ⇧-click, the tick verbs and the lightbox walk the order
  drawn. Ordered by stars, the headings go away.

## A FLIGHT LOG facet, read off the row (2026-10-13)

**Decision.** The rail filters clips *With a log* / *Clips without*
(`PickFacets.logs`, `logStateOf`), and a tile wears `SRT` when its clip's log
rides with it. **Why**: Winnow already PAIRS a DJI clip with its `.srt` — the
row carries `has_telemetry` and an `srt` sidecar — so finding the flights costs
no request; until now nothing said which clip had one. **How to apply**: a
photo has no log and is NEITHER (it passes only while the facet is empty); the
section shows only when the scope holds a clip, with a bar of the share that
carries a log. Server-side filtering by log is Winnow's to add
(`has_telemetry=1`), and would matter only for a span long enough to hit the
cap.

## *Logs only* — a clip's flight log without its video (2026-10-13)

**Decision.** The Library's *browse all* brings **Proxies · Originals · Logs
only**; `materialize(…, { fidelity: 'log' })` fetches each clip's `.srt` and
nothing else, and a row with no log brings nothing (the bar says how many are
skipped; the verb counts and is enabled on the rows WITH a log —
`PickerAction.label(n, rows)` and `enabled(rows)`). **Why**: a flight is a few
hundred kB of text, its 720p proxy a video — taking a season of flights for
Flight Atlas fetched every proxy only to read the log beside it. **How to
apply**:

- The `.srt` is vouched for with the CLIP's identity and an origin naming the
  log (`fidelity: 'original'`, no `fetchOriginal`), so the Library files it
  under its instance. Adding the clip later groups both by base name; the
  duplicate `.srt` the clip brings is the same name/size/date and is ignored.
- A log alone does NOT hold its clip: the sidebar splits `inLibrary` (an asset
  with a picture or a clip) from `logsInLibrary` (any asset with a log), and
  the picker's `held` reads the one its fidelity fills.
- `reuse(url)` hands back a log already read (the Logbook's tracks), so it is
  never fetched twice.
- **A clip may carry SEVERAL `.srt` rows, and the newest is the live one**
  (2026-10-13, his "156 added, 23 shown", MEASURED on his instance: 263 srt
  rows for 156 clips, the 107 extra all pointing at the folder the clips were
  moved OUT of). Winnow's relink re-records a moved clip's sidecars at the new
  path and keeps the old rows; its list sends them by id, OLDEST first, and
  Atelier took the first — a dead path. `srtSidecars` now sorts newest first
  and every reader goes through ONE fetch (`fetchLog` / `materialize`'s
  `fetchPlanned`): a 404 falls through to the next row, anything else stops,
  and a clip brings ONE log whatever its rows. The cure upstream (relink
  dropping the dead rows) is Winnow's.
- **A log the instance cannot hand over is SKIPPED, never the end of the run**
  (2026-10-13). Winnow streams a sidecar from the clip's SOURCE folder
  (`/api/sidecars/:id/download` reads `abs_path`, 404 "Sidecar file is not
  reachable" when it is gone) while the thumbnail and proxy come from its own
  cache — so a clip whose every row is dead lists as "with a log" and its
  `.srt` cannot be read. The add stopped at the first miss and kept only what
  came before; `addFlightLogs`
  (`flight-logs.ts`, both the Library's *Logs only* and the atlas door) now
  goes on, adds what landed, then throws ONE sentence (`log-failures.ts`: a 404
  is `unreachable`, said as "not on <host>'s disk") so the picker keeps the
  misses ticked. A failed READ is `missing`, never a track of `null`: the
  Logbook drew it as "no fix", which hid the cause.

## The LOGBOOK view, and a flight's track as its thumbnail (2026-10-13)

**Decision.** The grid's ⋯ offers **Grid · Logbook** (`PickerLogbook.tsx`,
per device in `atelier.winnow.picker.view`; a host may open on one —
`start.view`): one line per row, take-off clock (`localClock`), place, length,
distance, highest point, body, file. **Read tracks** (a toggle, `start.tracks`
for a host that wants it on) fetches the DRAWN clips' logs through
`flight-logs.ts` — once per session per URL, four at a time, 600 kept — and
`flight-track.ts` turns each into a flat glyph (metres around the take-off,
thinned to ~96 points) plus `flightSummary`'s numbers, drawn by `TrackGlyph`
in the Logbook and over a grid tile. **Why**: a log is text, so the picker can
show the FLIGHT, which a drone clip's thumbnail (sky, sea) rarely does.
**How to apply**: never read a log nobody asked for — the toggle is off unless
the host opens with it; only the batch drawn is read; *Logs only* then reuses
the files read (`heldLog`), so adding costs no second request. The Logbook
hides place, highest, body and file under 820px so the table never scrolls
sideways and its headers stay sticky.

## A host can narrow the request (2026-10-13)

`PickerHost.narrow` (`{ mediaType }`) is sent to the SERVER with every scope
and the month's marks — for what the host's `accepts` would throw away anyway,
so a long span is not cut by `SPAN_CAP` before the host's rows. The rail's
counts then describe the narrowed scope (an atlas picker says `0 photos`
nowhere: a status line drops the photo count when there are clips and none).

## The SUBJECT goes to the server with every scope (2026-11-02, rev. 2026-11-03)

His ask, from the Mosaic and Storytelling doors: «des filtres qui nous permettent de choisir la personne ou des
mots-clés … soit un lieu». **Decision.** A *Subject* section in the rail (`PickerSubject.tsx`, right under
Library): the instance's **people** (`/api/people`, the cover face from `faceThumbUrl`, the initial when the crop
fails; hidden people left out; past 8 entries a search field and the busiest 10, ticked first; two or more ticked
offer *All of them in the frame* = `person_mode=all`), **words** and a **place** by Winnow's own names
(`winnow-names.ts`'s kinds, a `Segmented` Country · Region · City · Place over one list; `instanceNames` keeps the
lists ten minutes). Unlike the rail's other facets, these narrow ON THE SERVER with every scope (`subjectQuery` →
`AssetQuery.people/together/words/names`, `client.calendar` sends them too so a span's parts are planned on the
narrowed counts): a row carries no person, and a span's parts would be cut by their caps before a client filter
saw them. **How to apply**: the subject is part of `scopeKey` (a change re-asks the scope) but NOT of `placeKey`
(ticks survive, as a Device click's do); its counts are the LIBRARY's (Winnow's lists), never the scope's, and
the rail's number and *Reset* include it; remembered per instance with the other facets (`readFacets` bounds
each list). An instance from before faces answers 404 → no People section, nothing said.

**The WORDS field has two ways, Describe the default (2026-11-03, his correction: «je pensais plutôt à la
recherche sémantique par IA … si tu cherches chien, perroquet, sunset, il faut que ça renvoie les bons
résultats»).** `PickFacets.wordsIn`: *Describe* asks Winnow's image index (`client.search`, `/api/search`, the
CLIP ranking the agent command already used) for the library's `RANKED` = 200 closest matches, once per text and
half. *In text* is the server's `q` (path + OCR text, every word as a part of a word), sent with the scope like
the rest of the subject. Winnow's tags are the rail's own *Tags* facet already, so no third way.

**A description is a SCOPE of its own, never intersected with the day (rev. 2026-11-03, his report «la recherche
par mot clé ml ne fonctionne pas»).** The first build kept only the ranked rows inside the open day or span: on a
real library the 200 closest are spread over years, so a day kept none. Read in Winnow's `src/app/api/search/
route.ts`: it ranks the WHOLE library (`source` = the half is its only narrowing, `MAX_LIMIT` 200, no date, no
filter). **How to apply**: while a description stands the ranked rows ARE the grid's rows (`describedRows`), the
day/span/folder set aside and said so (the rail's line, the count line «the closest to “…”, any day»); the rail's
facets still apply, the place ticks on the row's own names (a ranked row is `a.*`, `passesNames`); people CANNOT
narrow it — a row does not say who is in it — so a person ticked is said set aside (`describePeopleAside`). The
answer's `model` says what language the index reads: Winnow's default `ML_CLIP_MODEL` is `ViT-B-32__openai`,
English only («dog» finds dogs, «chien» barely), shown as a warning under the field (`readsEnglishOnly`); a
multilingual model (XLM-RoBERTa, NLLB) is his call in Winnow, after a re-index. `indexed: 0` is its own state
(nothing indexed yet). **The stub hid the bug**: one day of 90 rows makes «the scope» and «the library» the same —
`stub.cjs {spread: true}` puts every tenth row a year earlier and honours `date_from/date_to`; test a scope against
the library with it. The root fix — ranking WITHIN a scope (Winnow's `/api/search` reading `filterFromSearchParams`
into its CTE) — is a Winnow change, his call.

**WHY the index refuses is said, never «no index» (2026-11-03, his next report: the picker said «No image index on
this Winnow», Winnow's own Search page «Unexpected token '<', "<!DOCTYPE"», the URL a Cloudflare-branded 502).**
Winnow's route answers several refusals, and they were all one message: `enabled: false` with no reason = ML or CLIP
off (`ML_ENABLED`, `ML_CLIP_ENABLED`); `reason: 'pgvector not installed'`; a 404 = its `search` feature switched off
(`featureOff`); a **502 = `embedText` failed** — the APP container (`winnow_app`) posting `clip.textual` to the
immich-machine-learning `/predict`, reached only once `indexed > 0`. Cloudflare in front of his instance swaps
Winnow's 502 JSON for an HTML page, so the detail is lost and the status is the only witness. **How to apply**:
`client.search` turns a 404 / 502 into `enabled: false` with the remedy (`searchRefusal`) and keeps every other
failure an error; the rail and the grid both print the reason. The pictures' half of the index is made by the WORKER
(visual CLIP, faces, OCR all working there) and the words' half by the APP, so a working index with a failing
search points at the app → ML text call (its logs, `ML_BASE_URL` from the app, the ML image's textual model) — his
to check on the Optiplex; Atelier cannot see past Cloudflare's page.

## The MAP view, a box that ticks (2026-11-02)

His ask: «une vue par carte … dessiner une box sur la carte et toutes les photos qui sont à l'intérieur …
sélectionnées», Winnow's own gesture. **Decision.** The ⋯ panel's third view (`GridView` 'map', per device like
the others, `PickerHost.start.view` may open on it): `PickerMap.tsx` over the pure `map-pick.ts` (`hasPosition`
refuses a (0, 0) fix; `mapPoints`, `unplaced`, `boxOf` — null for a click —, `insideBox`, the GeoJSON of both).
MapLibre dynamically imported as everywhere, `TRACK_MAP_STYLE`, the shipped coastline, tiles the suite's opt-in
(`sessionTiles`, off at every first open, the land hidden under them), `boxZoom: false` because ⇧-drag is OURS.
The dots are a circle layer styled by `ticked` (accent) and `held` (hollow, 0.2); a click on a dot toggles it
(never a held one); ⇧ + drag, or any drag while *Draw a box* is on (a finger's way: it disables `dragPan` and sets
`touch-action: none` itself, `frontend.md`), draws the box live and on release ticks every unheld point inside —
ADDS to the ticks, never replaces, the chip says `N ticked in the box` with its ×; Escape clears the box (the
listener is on `window` in capture and stops the key, so the dialog stays). The points are the rail's SHOWN rows
(every facet and the subject apply), refitted once per `scopeKey` (`openingBounds`, max zoom 11), `Fit` by hand;
rows with no position are counted in the chip, never hidden in silence. Driven headless only (`drive-s3.cjs`,
`drive-s-phone.cjs` in the session's scratch): 78 of 90 stub rows placed, a ⇧-box over one town ticked 26, a
finger's box 8 on a 390 px phone, a dot click toggled one, the pref remembered `map`.

## Moved from the MEMORY.md index (2026-10-22)

The index outgrew its ~200-line budget, so its long entries were moved here verbatim on 2026-10-22; the index keeps a one-line pointer to this section. Fold an entry into the matching section above when you next touch it.

### Decisions (were "Decisions at a glance")

- ONE Winnow PICKER takes media from an instance everywhere (2026-10-01): `shared/sources/winnow/picker/`, a host passing only what differs (`PickerHost`: what it holds, what is ticked on open, its verbs — *Add to library* with fidelity, *Add to the roll* as refs); the rail filters over the scope's rows except the half (sent to the server), the verbs act on what is drawn, a burst shows its cover plus the frames Winnow said yes to. Since 2026-10-13 it lists a SPAN of days as well as a day or a folder (asked WHOLE, in parts planned from Winnow's calendar — one capped walk showed a year as its October), filters clips by FLIGHT LOG, shows a Logbook whose rows draw each flight's track, and the Library brings *Logs only* — a DJI clip's `.srt` without its video, which Flight Atlas's own door (`AtlasWinnow.tsx`) uses — `winnow-picker.md`, `flight-atlas.md`.

## Storytelling hosts it for the wall (2026-11-01)

Fourth host (`tools/storytelling/WallPicker.tsx`): the counted span, nothing ticked on open, *Put N on the wall* handing back ids and days. Nothing ticked because the rail's filters are the point there and a row ticked on open survives a filter that hides it — `storytelling.md`, « The wall's pictures from the Winnow picker ».

### Open items (were the index's "Open items")

- 2026-10-01 — **The ONE Winnow picker is BUILT** — the Library's *browse all* and Develop's *Add a day* are the same modal (`docs/winnow-day-sheet-verdicts.md` §7, `winnow-picker.md`, labs https://claude.ai/artifact/9hZnWW5Kog8nzwmNk1WXdw and https://claude.ai/artifact/R99xvWQAi3bHWt3hehv2i1), his §7.4 answered by its recommendations. Open: driving it against his REAL instance (stub only here), merging and deploying Winnow #277 so a burst's picked frame is listed without an unfold, and re-reading the capabilities sheet (`#/sources`) once it is.
- 2026-10-13 — **Flights come from Winnow too**: the picker's Span, Flight log facet, Logbook with tracks and *Logs only*, and the atlas's *From <instance>* door — driven headless against a stub only, never against his real instance (does it send `has_telemetry` and the `srt` sidecar on every row of a span as the client assumes?). Against his instance a span of 156 flights added 23: MEASURED there, 263 `.srt` rows for 156 clips, the 107 extra pointing at the folders his clips were moved out of (Winnow's relink keeps the dead row) and listed first — Atelier now takes the newest row and falls back on a 404 (`winnow-picker.md`), and skips and names a log no row can hand over; Winnow's relink dropping the dead rows, and whether it should KEEP sidecars in its own store, are his calls there — `winnow-picker.md`, `flight-atlas.md`.
