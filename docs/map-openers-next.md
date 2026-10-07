# The map openers' next round — the stops panel, the camera, grouping places

**Status: DECIDED 2026-10-07, NOT BUILT.** The maintainer answered the lab
<https://claude.ai/artifact/XkX5EwmpS2gf8g5Gyg2pa3> («Labo Virée») and said
explicitly not to start building yet. A second lab, the trip RECAP
(<https://claude.ai/artifact/WXTxg7iybW7Ez2Q65CWmSq>: the badge's counter
following Virée's car), was published the same day and awaits his answers; it
may change the order below, not these decisions.

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
  field) and, where it can be read, from the town index. Written everywhere a
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
a tight follow needs finer tiles: its own commit, measured.

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
  The big map marks the stops that merged.

## Order (a proposal; he has not ruled on it)

One commit each, as the lab listed: the panel (list box, popover, a stop that
knows its place, the glyph) → `stop-clusters.ts` + Virée's option → the same
option in the Itinerary and the big map's mark → `map-camera.ts` → Virée's
camera panel and presets → tiles along the route → the Itinerary's camera.
