# One Winnow picker — verdicts, filters, two hosts

**Status (2026-10-01): designed, nothing built.** The first round (§1–§6) is
kept as the record of how it was argued; **§7 is what he chose and what will
be built** — it supersedes §3's recommendation, §5's plan and §6's questions.
§2 and §7.1 are fact, read in this repo and in `CostardRouge/winnow` the same
day. Two labs: the first, three faces over one day
(<https://claude.ai/artifact/9hZnWW5Kog8nzwmNk1WXdw>); the second, his pick
merged with *browse all*, in both hosts
(<https://claude.ai/artifact/R99xvWQAi3bHWt3hehv2i1>).

## 1. The ask

His words (translated): inside a roll, *Add a day…* opens a sheet over the
connected Winnow, and it saves time. He wants that sheet to **show the
verdicts**: sort by stars, see what was rejected and what was picked, see
everything; **smart filters** to go faster; **tick every pick, every 5★** in
one go; see *what was done in Winnow*; and maybe bring over Winnow's bulk
selection bar, rearranged for adding media. The problem he starts from: **a
picture that already has a verdict in Winnow cannot easily be added.**

## 2. What the code says (fact)

- **The sheet** is `src/tools/develop/WinnowDaySheet.tsx` (F3 of
  `docs/develop-tool.md`, `develop-media.md`): one day of the first
  connection through `useScopeRows` (the Library tab's own read), photos and
  clips, a tile grid, *Tick all / Tick none*, *Add N to the roll*. It hands
  back refs (`rowMediaRef`) and fetches nothing.
- **Every row it reads already carries Winnow's culling and more.**
  `GRID_SELECT` (`winnow/src/lib/assetQuery.ts`) joins `verdict` (`pick ·
  reject · skip · unrated`), `star` 0–5, `color_label`, `tags`, `edit_count`
  (a Gallery final is linked to this original), `burst_count` /
  `burst_cover_id` / `burst_kind`, the pair's `companion_*` and `group_kind`,
  plus `a.*`. Atelier already reads the first three for the roll's strip
  (`shared/sources/winnow/culling.ts`, item 33 of `docs/lightroom-gaps.md`).
  **The sheet draws none of them.**
- **Everything the roll lacks starts ticked.** Keeping 16 picks out of 84
  means *Tick none* then 16 clicks on pictures that do not say they are picks.
- **A frame picked INSIDE a burst never reaches the sheet.**
  `WinnowClient.assets()` always sends `collapse=1`; Winnow's `buildFilter`
  reads it as BOTH "hide the pair's companion" and "show a burst pile as its
  representative only" (cover, else first live frame —
  `winnow/src/lib/filter.ts`, `collapseGroups`). Electing the best frame of a
  pile is exactly what a pick inside a burst is; Winnow's pile verdict (from
  the cover, `burstExpandCTE`) reaches every frame, a frame's own verdict does
  not surface. The roll's strip does not suffer it — `assetsByIds` asks by id.
- **One day, 400 rows** (`ROW_CAP`), no folder, no range — though the client
  already takes `sessionId` and a date range (`AssetQuery`), and Winnow's
  `/api/assets` already filters on `verdict` and `star_min` (`FilterSchema`),
  which `filterParams` never sends.
- **Winnow's `BulkActionBar` WRITES** — pick, reject, stars, tags, delete
  (`winnow/src/app/BulkActionBar.tsx`). Atelier's rule since 2026-09-23 is
  that culling is read, never written (`develop-roll.md`); the bar's SHAPE
  can come over, its verbs cannot as they are.

## 3. Three faces (the lab draws all three)

- **A · Ribbon** — the verdict count drawn once as a segmented bar whose
  legend items are the filter (Winnow's own rule, `frontend.md` there: a
  count is a toggle label or a legend, never pills), then a chip row (stars ≥
  N, without clips, with RAW, not yet in the Gallery, labelled, off the roll,
  sort). The most compact; fits a phone unfolded.
- **B · Rail** — Lightroom's / Winnow's gallery filter panel: a facet rail
  with counts, a clickable star histogram, devices, tags. Most criteria, all
  visible; on a phone the rail becomes a sheet, two gestures more per filter.
- **C · Groups** (recommended) — A's ribbon and chips, then the grid
  **grouped by verdict**: Picks · Starred without a flag · Unrated · Skipped
  · Rejected (folded at the bottom, counted, one click away). Each group
  title is a tri-state tick: **one click ticks every pick**. "See
  everything" without hiding anything, and the shortest gesture for the three
  lab tasks (picks; picks + every 5★; everything but the rejects).

All three share the **bar**: Winnow's bulk bar rearranged to TICK — the
count (and how many ticked pictures a filter hides), *All · None · Invert*,
*Tick ⚑ Picks · ★5 · ★4+* (replace; ⇧ adds), *Add N to the roll* pinned at
the right, full width on a phone. Keys `P` `5` `4` `3` `A` `N` `I`, ⇧-click
a range, `Space` to look large.

## 4. Rules the proposal sets

1. **Read, never write.** No verb of the sheet sets a verdict, a star or a
   tag in Winnow (question 3 is whether that should change).
2. **Showing is not ticking.** A filter changes what is drawn, never what is
   ticked; a ticked picture a filter hides is COUNTED on the bar ("3 hidden",
   one click shows them) and never added in silence — Winnow's rule that an
   aggregate must decompose on the same screen.
3. **A pile shows its cover and every frame Winnow said yes to** (pick or a
   star); the rest unfold on demand. Needs the list to fold pairs only (W1).
4. **Rejects are there, folded.** Counted, openable, ticked by no verb but
   *All*.
5. **Opening a culled day ticks its picks**; a day with no pick keeps today's
   rule (everything the roll lacks).
6. **Already in the Gallery** (`edit_count > 0`) is a mark on the tile, so a
   delivered picture is not developed twice by mistake.
7. Every mark reads from the row (`cullingFromRow` and its siblings), never
   from a guess; a row from an older instance without those keys draws no
   mark rather than "unrated" (`culling.ts`'s existing rule).

## 5. The plan, in commits

| # | Repo | What |
| --- | --- | --- |
| W1 | winnow | `collapse=pairs`: fold the pair's companion, keep every burst frame; announced in `/api/capabilities` so Atelier knows it may ask. ~3 lines in `api/assets/route.ts` + `buildFilter`'s opts. Without it Atelier asks each pile by `burst_id` (one request per pile). |
| P1 | atelier | `shared/sources/winnow/pick-sheet.ts`, pure + tested: buckets, groups, tick-by verbs, the opening rule, pile surfacing, hidden-ticked count. Extends `culling.ts`. |
| P2 | atelier | Tile marks on the sheet (flag, stars, label, pile, `+RAW`, Gallery), over `CullMark`. |
| P3 | atelier | The ribbon + chips and the grid grouped by verdict, rejects folded. The sheet moves to `shared/` if question 5 says so. |
| P4 | atelier | The bar: count + hidden, All/None/Invert, tick by verdict/stars, ⇧-range, keys. |
| P5 | atelier | Piles unfolded — on `collapse=pairs` when the instance says so, else per `burst_id`. |
| P6 | atelier | Scope: Day · Folder (Winnow session) · The roll's days; `verdict` / `star_min` sent to the server when a scope would pass `ROW_CAP`. |
| P7 | atelier | `Space` opens the shared `WinnowLightbox` on the tile, with its verdict and a *Tick*. |

## 6. His questions

1. **Which face?** Recommended: C. A is its top half; B is costly on a phone.
2. **What is ticked when a culled day opens?** Recommended: its picks.
   Alternatives: everything (today), nothing.
3. **Should the bar be able to WRITE a verdict into Winnow** (pick, reject,
   star from Atelier)? Recommended: no, as decided 2026-09-23 — Winnow stays
   where culling happens; a yes is a fourth write path to Winnow
   (`local-first.md`).
4. **How far does the scope go?** Recommended: day, then folder, then the
   roll's days, in that order of commits.
5. **The same sheet elsewhere?** A hook's picture chooser (Trips) and the
   Library's Winnow tab read the same rows. Recommended: the sheet in
   `shared/` from P3, wired elsewhere later.

## 7. His pick, and one picker for two hosts (second round, same day)

**His answer**: **B · Rail** — Groups was interesting, but he wants to narrow
by **device** and **tags** too, which only the rail offers. Then three asks of
his own: the sheet looks like the Library's *browse all*
(`src/app/WinnowBrowser.tsx`), so **merge the two** and gather what each has;
add **Incoming / Gallery / both** and **extensions**; take the sidebar's **day
stepper with its mini calendar** and its **bars**; and offer the result **in
the Library sidebar too — the same modal, with the host's own actions** (the
Library selects and adds to the library, Develop adds to the roll).

### 7.1 What each half brings (fact)

- **`WinnowBrowser`** (865 lines, the sidebar's *browse all*): by day / by
  folder (/ by leg, dormant behind `TIMELINE_SYNC_ENABLED = false`); half ·
  media type · extension · device sent to the server as single values
  (`FilterQuery`), choices from `/api/facets`; `browse-state.ts` remembers per
  instance the view, filters, month, day, folder and fidelity — never the
  selection; *Proxies · Originals* with the weight; `materialize` per row with
  an abort on Cancel; tiles mounted 240 at a time. Its left column is a month
  grid or a folder list.
- **`WinnowDaySheet`** (226 lines, Develop): refs through `rowMediaRef`, "on
  the roll" through `sameMediaRef`, the opening tick rule, photos and clips.
- **`DayPicker`** (the sidebar's Winnow tab): a stepper (‹ value ▾ ›) whose
  value opens `MonthPanel` — the month as a density strip (`day-density.ts`,
  one bar per day, normalised to the month's peak, floor 0.22) or as a week
  grid, toggled and remembered (`atelier.library.month-view`); one
  `calendar()` per month cached for the popover's life; a busy state that is
  never read as empty; the ANCHOR marks (the tool's day in accent, the span
  around it in ink). It lives in `src/app/`, which `shared/` cannot import.
- Rows also carry `tags` and `device` (`GRID_SELECT`'s `a.*` and its tags
  subquery); `WinnowAssetRow` declares neither yet.

### 7.2 The shape

- **One modal, `shared/sources/winnow/picker/WinnowPicker.tsx`, that knows
  no tool.** A host passes a `PickerHost`: `title`, `destination` (the pill:
  *Library*, *Roll · Whitsundays*), `anchor` (the open day and the span
  around it, for the calendar's marks), `start` (day, half), `held(row)` +
  `heldLabel`, `openTicks` (`picks` · `none` · `all`), `accepts(row)`,
  `extras` (the Library's *Proxies · Originals* and weight) and `actions`
  (`label(n)`, `run(rows, ctx)` with `ctx.signal`, the last one primary).
- **Header**: the title, the destination pill, the scope (**Day · Folder**),
  and ONE control whose value opens a popover — the sidebar's month panel for
  a day, the folder list for a folder. `WinnowBrowser`'s left column goes.
- **The rail**: *Library* (All · Incoming · Gallery — a SCOPE, sent to the
  server like the sidebar's `HalfPicker`, because a capped list filtered
  afterwards loses rows) · *Winnow verdict* · *Stars, at least* (a clickable
  histogram) · *Type* · *Extension* (with the pair: `.hif + .arw`) · *Device*
  · *Winnow tags* · *State* (not yet in the Gallery; not already held).
  Facets are multi-select and filtered here over the scope's rows; their
  counts are the scope's, so ticking one facet does not move another's.
  `verdict` / `star_min` go to the server only when a scope would pass the
  row cap. On a phone the rail is a full sheet behind *Filters · N*, the
  active filters as removable chips.
- **The verbs act on what is SHOWN** — revising §4.1–2's lab, which ticked
  across the whole day: filter by a device, press `4`, and the ★4+ of that
  device are ticked. A ticked picture a filter hides is still counted on the
  bar and still added.
- **The two hosts**:

| | Library · sidebar | Develop · roll |
| --- | --- | --- |
| Entry | *browse all*, over the Winnow tab's day stepper | *Add ▾ → A day from <host>…* |
| Opens on | the sidebar's day AND half | the open picture's day |
| Calendar marks | what the tool has open, and the span around it (a trip) | the open picture, and the roll's days |
| Held | *in library* (`host/id` in the pool) | *on the roll* (`sameMediaRef`) |
| Ticked on open | nothing — an add downloads | the picks of a culled day, else everything |
| Actions | *Proxies · Originals* (+ weight), *Add N to library*, Cancel stops it | *Add N to the roll*: refs, nothing fetched |
| Remembered per instance | scope, filters, half (`browse-state.ts`, one place) — never the selection | same |

- **The sidebar keeps its compact tab** (stepper, half, file-name filter,
  grid); its tiles gain the same marks; *browse all* opens the picker where
  the sidebar is looking.

### 7.3 The plan, in commits (supersedes §5)

| # | Repo | What |
| --- | --- | --- |
| W1 | winnow | `collapse=pairs`, announced in `/api/capabilities` (unchanged from §5). |
| P1 | atelier | `picker/pick-filter.ts`, pure + tested: facets and their counts, verbs over what is shown, opening rules, pile surfacing, hidden-ticked count; `tags` and `device` declared on `WinnowAssetRow`. |
| P2 | atelier | `DayPicker` + `MonthPanel` move to `shared/`, unchanged for the sidebar. |
| P3 | atelier | `WinnowPicker` + `PickerHost`: header, rail, grid, marks, bar, folder popover, phone. |
| P4 | atelier | Library host: *browse all* opens it on the sidebar's day and half; `WinnowBrowser.tsx` retired, adds still through `materialize`. |
| P5 | atelier | Develop host: `WinnowDaySheet.tsx` retired. |
| P6 | atelier | The sidebar's Winnow tiles wear the marks (`CullMark`). |
| P7 | atelier | Piles unfolded — `collapse=pairs` when announced, else `burst_id`. |
| P8 | atelier | `Space` opens `WinnowLightbox` on a tile, with *Tick*. |

### 7.4 His questions (supersede §6)

1. **What is ticked when the Library opens it?** Recommended: nothing, an add
   downloads; Develop keeps its picks.
2. **Are the filters shared between the two hosts?** Recommended: yes, per
   instance as today; the day comes from the host.
3. **Does closing the picker move the sidebar to the day it was on?**
   Recommended: no — the sidebar follows the tool.
4. **Does *by leg* come back as a third scope?** Recommended: not while the
   timeline is off; the contract leaves room.
5. **Does the sidebar gain a verdict filter** (a "⚑ only" beside All /
   Incoming / Gallery)? Recommended: the marks first (P6), the filter on
   request.

§6's question 3 (write a verdict from Atelier) stands answered by the rule:
the bar ticks, it never writes.
