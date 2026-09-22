# The trip overview on a phone — measured, and three directions

**Status: a proposal, not a set of decisions.** §1–§2 are traced to files and
measured; §3 onwards is design and waits on the maintainer. §7 lists what is
his to choose. Read it before touching `DayHeatmap.tsx`, `ShortDayStrip.tsx`,
`LoupeBrush.tsx`, `StageRuler.tsx`, `day-grid.ts` or `loupe.ts`.

The interactive boards carrying the three directions (the phone at 390 × 844,
scrollable, with the Australia trip's 345 days as sample data):
<https://claude.ai/artifact/ESuup2fagvzyGVZBd97uP9>

Written 2026-09-22, from the maintainer's report: *«dans un trip qui est long,
et même un trip qui est court, on essaie d'afficher l'entièreté des cellules de
jour […] il faudrait que les blocs de jour aient une taille minimale, et qu'on
rende la zone scrollable […] l'objectif principal, pouvoir rendre l'interface
utilisable sur mobile. Puisque là, ce n'est pas le cas.»*

## 1. What the screen is today

`TripOverview` is one scrolling column: the heading and three figures, then
**the journey** — `ShortDayStrip` up to 31 days (`isShortTrip`), else
`DayHeatmap` with `LoupeBrush` over it — then `StagesPanel` (its header, the
`StageRuler`, the open leg's card), then `DayPanel`.

Both day surfaces **fit their box and never scroll for want of room**:

- `fittedColumn` (`day-grid.ts`) divides the box among the trip's weeks and
  floors the cell at `MIN_FIT_CELL` = 6, capping at `MAX_FIT_CELL` = 28.
- `ShortDayStrip` gives every day a `flex-1` cell with a 4 px gutter.

The loupe is a window **dragged** over the heatmap (`LoupeBrush`, moved from
its body after a 350 ms still hold, `press-intent.ts`), and the `StageRuler`
draws that window across its own box at `rulerDayWidth`, floored at
`MIN_DAY` = 6.

## 2. What that measures at 390 px

The shell pays `px-4`, so the column is **358 px**; the heatmap's scroll box
pays another `pl-3 pr-3`, so its content is 334, of which the weekday rail and
its gutter take 34.

| | | |
| --- | --- | --- |
| A day on the Australia trip (345 days, 50 weeks) | `fittedColumn(334, 50)` → column 6, gap 1 | **6 × 6 px** |
| A day on a one-month trip | `(358 − 30 × 4) / 31` | **7,7 px wide** |
| A day on the ruler, with the 56-day loupe | `max(6, 358 / 56)` | **6,4 px** |
| A leg's drag handle (`HANDLE` = 10) | at that day width | **1,5 day wide** |
| The recommended touch target | iOS HIG · Material | 44 · 48 px |

So the trip's own cell is **seven times too narrow**, and 1/53 of the
recommended area. The weekday label above a short trip's cell (`Mo 12`, at
`text-3xs`) has no room to be written either. `hover:scale-125` — the one
affordance the cell carries — does not exist on a touch screen.

Three surfaces in one screen scroll on three different axes and at two
different scales: the grid at 4,4 px per **week**, the ruler at 6,4 px per
**day**, and the loupe travelling over the first to move the second. Three
gestures for one question: *which day am I looking at?*

And the page is **not full**: the whole column comes to about 560 px of the
844 available. The room is there; the calendar refuses it, because it insists
on showing the entire year at once.

## 3. The two decisions the three directions share

**3.1 — The overview stops being a target and becomes a map.** The maintainer
refused dropping the heatmap for a long trip on 2026-09-13 (*«on a year-long
trip it was a good idea, it is the only thing that shows the whole journey at
once»*) and that refusal stands: the year stays, at 5 px cells, in a band of
about 300 × 41 px. What changes is what it is FOR — it is read, and it is
jumped from (one target per month, or per leg: twelve, not 345). Nothing is
aimed at a single day there any more, which is exactly the fault reported.

**3.2 — The loupe is the scroll position, not a brush.** The window a phone
should see is the window a phone already scrolls to. Deriving it from the
scroller removes `LoupeBrush`, its 350 ms hold, `useFlingPan` on the ruler and
`panWeeks` from the phone, and answers *«cette zone devrait être scrollable de
manière native»* literally. `loupe.ts` survives for the wide screen, where the
brush works and was chosen.

**3.3 — A day cell has a floor, and the box scrolls past it.** On a `compact`
shell the cell is a constant **28 px** (today's `MAX_FIT_CELL`, made the floor
too) and the grid scrolls; the legs ride in the SAME scroller, on the same
axis, which is the other half of the ask — *«la zone qui scrolle […] devrait
aussi scroller la zone des stages et legs»*.

**A finding that shapes everything after it.** On a phone you cannot have the
weekday grid AND the day ruler on one span at usable sizes: they are inversely
coupled. A 28 px cell puts ~73 days on screen, which is 4,9 px a day on the
ruler — under its own `MIN_DAY`, so the ruler would scroll on its own again
and the two would disagree. Wanting an 8 px day on the ruler would ask for a
47 px cell, which is 329 px of calendar height. **So a phone gets ONE day
surface, and each direction is a different choice of which one.** The ruler
survives on the wide screen in all three.

## 4. A — Le ruban

The grid keeps its shape (weeks as columns, Monday at the top); the cell is
28 px, so it can carry its own date, and the box scrolls sideways. The legs are
a lane inside that scroller: a 28-day leg is 124 px wide and can finally be
read (today it is 28 px). The map above frames what the ribbon shows, and
follows it as you scroll.

- **Keeps**: the weekday pattern in the surface you touch; leg drag; the
  smallest change — `fittedColumn` gains a floor, one component evolves.
- **Costs**: no ruler on a phone. A leg is dragged on its lane at 4,4 px a day
  (against 6,4 today) or set exactly in its two date fields.

## 5. B — Les mois

The axis turns: weeks become rows, one block per month, and the PAGE scrolls —
the phone's own gesture. The cell size falls out of the geometry
(`(358 − 24) / 7` = **46 px**), so there is no floor to invent. Under each week
a ribbon says which leg you were on, with a round grip where the leg really
begins or ends: at 46 px a day, **this is the most precise leg editing in the
suite**, seven times what the ruler offers today.

- **Keeps**: the weekday pattern (the columns ARE the weekdays), and it erases
  the short/long split — `ShortDayStrip` and `isShortTrip` stop being a case.
- **Costs**: one month per screen, so the year is ~5 300 px of scrolling; the
  map at the top stops being a nicety and becomes the way around.

## 6. C — Les escales

The legs become the spine: twelve rows, the one you open unrolls its days as
48 px lines that can SAY what came out that day — which no cell will ever do.
It is L3 of the September audit (*«legs first, a thin whole-trip barcode over
one row per leg»*, recorded then as a candidate second view) carried onto a
phone.

- **Keeps**: the most generous target, and a day that reads as a sentence.
- **Costs**: the weekday pattern survives only on the map — *«I never post on
  Sundays»* is no longer legible in the surface you work in; a trip with no leg
  has no skeleton. It is a third screen, not a variant of the calendar, so it
  is better as a SECOND view (like the gallery's Cards / Bands) than as the
  view.

## 7. What is not touched, and what is his to decide

**Above 820 px nothing moves.** The fitted grid, the dragged loupe and the leg
ruler stay exactly as they are — the L1 he chose in September, on the screen
where it works. The floor and the scroll apply on the `compact` shell only. A
coarse pointer on a tablet is the one case the rule does not yet cover, and it
is deliberately left open rather than guessed.

His to decide:

1. **Which direction**, or which as the first view and which as the second.
2. **Leg drag on a phone.** He ruled on 2026-09-13 that the ruler's
   drag-and-drop is kept. A keeps it and degrades it to 4,4 px/day; B makes it
   better than today; C drops it for two date fields. This is the only point
   where a direction asks him to revisit that ruling.
3. **Whether the map gets a "today / the open day" mark**, and whether tapping
   it jumps by month (A, B) or by leg (C).
4. **28 px** as the floor, or wider. 28 is today's cap, which makes the fitted
   range collapse to a single number; 44 would be the HIG's, at 329 px of
   calendar height.

Nothing here is built. Recommended if only one thing is built: **B**, because
the target size stops being a number someone has to choose, the leg editing
gets better rather than worse, and a short trip and a year stop being two
screens.
