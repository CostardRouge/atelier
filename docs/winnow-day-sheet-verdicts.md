# Adding a culled day — Winnow's verdicts in the Develop day sheet

**Status (2026-10-01): a proposal, nothing built.** §2 is fact, read in this
repo and in `CostardRouge/winnow` the same day; §3 onwards awaits the
maintainer, and §6 lists the five choices that are his. Lab, the current sheet
beside three faces over one sample day, with a gesture counter per task:
<https://claude.ai/artifact/9hZnWW5Kog8nzwmNk1WXdw>

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
