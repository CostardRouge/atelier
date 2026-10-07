# The map openers' next round — the stops panel, the camera, grouping places, the recap

**Status: DECIDED 2026-10-07 and BUILT the same day, §1 to §5, then the
finer tiles along a tight follow, the Itinerary's own camera and the
odometer digits; two gaps found that evening are built too — a stop that
learns its state from the town index (§1) and the *Days + km* counter
(§5). Only §5's «later» items are left: the picture of the DAY with a tick
per day, Défilé's ribbon under the map, the distance comparison.** The maintainer answered two labs the same day: «Labo Virée»
(<https://claude.ai/artifact/XkX5EwmpS2gf8g5Gyg2pa3>, §1–§4) and the trip
RECAP (<https://claude.ai/artifact/WXTxg7iybW7Ez2Q65CWmSq>, §5), both on the
labs' own recommendations except where §1 says otherwise — then, later in the
day, «tu peux commencer le développement de tout ça». What each built commit
fixed is in `docs/memory/roadtrip.md` («The stops panel…», «The trip RECAP…»).
Of §5, the **odometer digits are built** (the badge stays text drawn by
`drawOverlays`, which learnt to draw a numeral in fixed, rolling cells —
«The counter's digits are an ODOMETER» in `docs/memory/roadtrip.md`). The
picture of the DAY and Défilé's ribbon stay «later» as written.

Facts this rests on (read in the code on 2026-10-07): the stops editor is
shared by both map openers (`shared/roadtrip/hooks/stops-editor.tsx`, the big
map `tools/roadtrip/StopsMapSheet.tsx`); a stop is `MapStop {id, name, lat,
lon, picture?}` and knows nothing of its state or country; Virée's camera is
`whole | follow`, the follow view nailed to the car with `followZoom` a share
of the route's extent (`drive-plan.ts`, `viewAt`); Virée merges only pictures
shot within `MERGE_KM` (150 m), and only when its stops come from pictures.

## 1. The stops list in the panel — every stop, in a box, opened in a popover

His answer reverses the lab's recommendation (show the first five): a stop
must stay reachable from the panel because its PICTURE is chosen there.

- The list keeps **every** stop, in a box about **ten rows** tall that scrolls
  on its own (`overscroll-contain`, no `touch-action` on the box — only the
  grip claims a gesture, `frontend.md`). It no longer takes the whole
  inspector.
- A click on a stop opens a **popover** with its settings, replacing the
  selected-stop block under the list:
  - a **mini map** showing where the stop is;
  - its **name**, and a new **search** (`PlaceSearchField`);
  - its **state**, written like every other place of the suite: `Sydney NSW`,
    the state in full, or the name alone (the place-writing cascade of
    `roadtrip.md`, «A PLACE keeps what it knows»);
  - **latitude / longitude**;
  - the **picture** picker (Pick… / Change… / Remove);
  - **Earlier / Later**, kept, and Remove stop.
- **A stop KNOWS its place**, as a trip place does since v30: optional
  `state`, `area`, `country`, `countryCode`, `stateCode`, `searchCode` (and a
  writing `style`) on `MapStop`, read defensively by `readStops` — no
  migration. Filled when the stop is adopted from one of the trip's places (a
  copy: `HookStage.places` must then carry those fields, additively), from the
  search (`placeDetails` / `adoptSearchResult`, which never overwrite a typed
  field) and, where it can be read, from the town index (**built late on
  2026-10-07**: a town tapped on the big map, the town a stop is named after,
  and *Fill from the town index* under both lists — `hooks/stop-index.ts`).
  Written everywhere a
  stop's name is drawn — the openers' map labels, Virée's caption that follows
  the car, both lists — through `placeLine` / `writePlace` and the cascade stop
  → opener → trip. His words: «si je suis à Sydney, il faut afficher Sydney NSW
  ou donner la possibilité de choisir le nom complet, le short name».
- Not answered: whether the panel's list keeps the drag grip of PR #253. A
  scrolling list makes it useful again (the hook scrolls its box near the
  edges); ask before removing it.

## 2. The dash → a picture glyph

Accepted as proposed. The `—` / `photo` column becomes a small image glyph
when the stop holds a picture (its file name on hover), nothing otherwise, in
both lists.

## 3. The camera — accepted as proposed, with the presets

One pure, tested module, `map-camera.ts`, that Virée uses first and the
Itinerary may reuse to follow its pen. The camera TRACK is computed with the
plan, frame by frame, never accumulated while playing — so preview, seek and
export agree (the `(cues, time)` rule of `studio.md`).

| Option | Values | Notes |
| --- | --- | --- |
| Camera | Whole route · Follow the car | as today |
| View width | 5–3000 km, log slider | replaces the share of the route; a stored `followZoom` is read as a width at read time, no migration |
| Zoom | Fixed · Pull back on long drives (+ strength %) | the width follows van Wijk & Nuij's flyTo profile (ρ = 1.42) per hop, smoothed in log space |
| Orientation | North up · Heading up | heading-up puts the car two thirds down the frame (lead room); the 3D car is then seen from behind |
| Smoothing | 0–2.5 s | a CENTRED window on the car's position: the drive is known in advance, so no lag |
| Look ahead | 0–1.5 s | |
| Turn smoothing · Max turn speed | 0–3 s · 15–180 °/s | heading weighted by displacement, so a halt never turns the map; then a rate limit |
| Open wide · End wide | switches | establishing shot → the car → back to the whole route |

Presets (the lab's values): **Calm** — follow, 120 km, pull back 70 %, north
up, smoothing 1.1 s, look ahead 0.4 s, open and end wide; **Navigation** —
35 km, pull back 45 %, heading up, smoothing 0.7 s, look ahead 0.7 s, turn
1.4 s, 60 °/s, end wide; **Documentary** — 400 km, pull back 90 %, north up,
smoothing 1.8 s, look ahead 0.2 s, open and end wide; **Whole route**. Calm is
the default when Follow is chosen. The OpenStreetMap ground along the route at
a tight follow needs finer tiles: its own commit, measured. **Built** (`map-camera.ts`,
«Virée's CAMERA is a baked track» in `docs/memory/roadtrip.md`), **and the
finer tiles too** — a strip of one-tile patches along the road at the
follow's own zoom, inside a tile budget, fading to the wide raster as the
camera pulls back (`shared/map/tile-strip.ts`, «Finer tiles along a tight
follow»); **and the Itinerary's own camera**, following the pen on the same
track and presets, north up, clipped at the map's box, with the strip under
it («The Itinerary's CAMERA follows the pen»).

## 4. Grouping nearby places — accepted, every option kept

One pure, tested module, `stop-clusters.ts`, applied at render time — the
stop list is never edited.

- **Group nearby places**: Off by default; a distance (0.5–80 km, log) and
  three shortcuts, 2 km (neighbourhood), 10 km (city), 40 km (metro area).
- **Which places**: *One after another* (default — only consecutive stops
  merge, the journey's order stands; a later return is a second halt) or
  *Every visit* (all visits merge at the first; the car never comes back).
- **Name of the group**: *Town* (default — the biggest town of the shipped
  index near the group), *First place*, *Central place*.
- The halt sits on a REAL stop, the member nearest the group's centre; it
  shows the pictures of every member (six at most, the rest counted, as
  today) and its dot carries `×N`.
- For Virée's three sources (the trip's stages, your places, pictures — the
  150 m picture merge becomes this module's floor) and for the Itinerary too.
  The big map marks the stops that merged. **Built** («Nearby places are
  GROUPED» in `docs/memory/roadtrip.md`).

## 5. The trip RECAP — the badge counts while the car drives

His post-recap use: one picture, Virée, every place in order, the car — and
the badge's number counting as the car goes. Accepted on the lab's
recommendations («ça me va aussi»).

- **ONE clock, the trip's DAY**: the car's position, the counter, the
  kilometres and the background picture all read the day at `t`, computed
  with the plan (pure, `trip-clock.ts`), so none can disagree in preview,
  seek or export.
- **The counter** counts **Days** by default (also Kilometres, Places, Days +
  km — built: the day as the numeral, `of 90 · 1 479 km` beside it), with **odometer** digits — each in a fixed-width cell, so the badge
  never shakes when 199 turns 200.
- **Declared where the counter lives**: a mode *Follows the drive* in the
  badge's Counter section, offered only under Virée — never a silent
  override. It rides the contract that already exists: a layer's
  `content(t)` rewrites badge pieces (Défilé's numeral, Virée's *Caption
  follows the car*).
- **Pace**: a slider Calendar ↔ Road, **65 % toward Calendar** by default —
  screen time shared by days spent and by kilometres; on Calendar the car
  waits in Melbourne while the days run (which also answers the «surplace»).
- **Layout** *Map over photo*: each place's picture full-frame behind a map
  plate, cross-faded, a slow push-in; plus the **summary card** at the end
  (days · km · places) and **milestones** on the road (every 50 days or
  1 000 km), both on by default.
- **Dates of «your places»**: from the trip stage whose places hold the stop
  (matched by position, in the journey's order), else the stop's picture's
  date; a stop with neither stays on the road and moves no counter, and the
  panel says how many. The trip's stages are dated already.
- **Kilometres are as the crow flies**, between consecutive places — never a
  road distance, which the app does not know.
- **Length**: Virée's drive caps at 12 s; the recap needs up to 60 s.
- **Pictures**: forty full-frame backgrounds share the openers' 32 MP budget
  (~0.8 MP each) — accepted under a light veil, else cap the count.
- **Later**: the picture of the DAY rather than of the place, a tick per day;
  later still Défilé's ribbon under the map (the first opener STACK) and the
  distance comparison.

## Order

His pick on the recap lab's Q7: **the panel's list and the glyph first (§1,
§2), then the recap (§5), then the camera (§3)**; grouping (§4) slots beside
the camera. One commit each, roughly: the panel (list box, popover, a stop
that knows its place, the glyph) → `trip-clock.ts` → Virée's pace and longer
drive → the badge's *Follows the drive* → *Map over photo* → summary and
milestones → odometer → `stop-clusters.ts` + Virée's option → the same in the
Itinerary and the big map's mark → `map-camera.ts` → Virée's camera panel and
presets → tiles along the route → the Itinerary's camera.
