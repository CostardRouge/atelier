# A trip's ROAD as the openers drive and draw it

Read when you touch `roadHops` / `roadBetween` / `steerRoad` / `roadKms` in
`shared/roadtrip/road-track.ts`, how Virée (`drive-plan.ts`, `drive-paint.ts`)
or the Itinerary (`map-plan.ts`, `map.tsx`) lays a hop on the road, the
vehicle's heading, or the overview's map of the road. What the road IS (the
modes, the detail, `TripDoc.road`, the panel, GPX) is in `trip-road.md`.

## A hop takes the road only where the road joins it (2026-10-09)

`roadBetween`: the first visit of stop A at or after the cursor left by the
previous hop, then the first visit of B after it on the same piece, within
25 km — so a road driven out and back through one town takes the right pass
each time; failing forward, the road driven the other way (an author's own
stops listed against the clock). A hop with no road under it — a stop off the
road, a flight between, an order never driven — keeps its curve. A flight
(> 200 km/h and > 50 km between two fixes) CUTS the line into pieces; a
ferry (slow, over water) stays a straight hop. Verified on his track:
Streaky Bay → Esperance follows the Eyre Highway for 1 557 km.

## The vehicle STEERS the road (2026-10-09, his pick of option B)

His report: on a Polarsteps road the car trembled — it drove straight from
fix to fix, so each fix's GPS scatter was a turn of the wheel. The lab
(https://claude.ai/artifact/EDJB8AfqbKStpfRKnEevcQ) weighed four cures: a
smoothing spline with a passing precision (A), a driver aiming ahead (B),
more sliders on the points (C: Douglas–Peucker KEEPS the noisiest fix, and a
polygon of fewer points still turns at each one) and the heading alone (D:
the car slid instead). He chose **B with several sliders**. `steerRoad` is
pure pursuit on each piece after the detail: from the first point the
vehicle aims at the MEAN of the recorded line between ½ and 1½ look-ahead
(a fix to one side is outvoted; averaging only helps once the look-ahead
exceeds the fixes' spacing), turns no tighter than the radius, steps along
ARCS (a sixth of the look-ahead, the radius where it turns its tightest) and
keeps a point when the arc strays 5 m from its chord, turns 10° or runs
2 km — no Douglas–Peucker afterwards (324 ms of a 22 000 km year's 525). A
year of minute fixes with ±65 m noise: 157–250 ms at 500 m / 50 m, measured
headless; cached per stored road like the rest of `tripRoadLine`. **The
line drawn is the line driven** (Virée, the Itinerary, the overview's map),
but **what is counted is the road as recorded**: every steered point carries
`km` along the recorded piece, `roadKms` reads it between two such points,
so `RoadLine.km`, a hop's km, the counter and the Itinerary's readout never
lose the 1–5 % the rounded corners shorten. `TripRoad.steer` (optional:
absent or null = the recorded line, so no stored trip moved, no version
bump), two sliders under Detail — Look ahead (0 = off, then `ROAD_LOOKS`
200 m–3 km) and Turn radius (`ROAD_RADII` 10–500 m, greyed when off) —, the
reason behind the panel's ⓘ. A new road starts OFF (his Q2 unanswered); a
re-import keeps it. The panel's per-mode km and Deduce's offer read the line
with `steer: null` (the same km, without a drive's cost). The steered points
carry no meaning for `RoadPointsSheet`, which reads its own raw line.

## Virée drives the road (2026-10-09)

`HookContext.road` is `tripRoadLine(trip.road)` (cached per stored road in a
WeakMap, so every surface reads one line); `drivePlan`'s last argument takes
it. `roadHops` (cached per line and stops) finds each hop on the road with
the cursor carried along; a hop is refused — and keeps its curve — when its
two stops are under `SAME_PLACE_KM` (3 km: measured on his real year, four
120 km loops between stops 1 km apart, the commute at the end of the trip)
or its road length passes `DETOUR_RATIO` × the crow AND the crow + 150 km.
The plan's box fits the road too (a sample of ≤ 4 000 points: a spread of
every fix overflows `Math.min`'s arguments in JavaScriptCore). `RoadPath.km`
carries the kilometres at each sample — the road's own along a road hop, the
crow's shared by arc on a curve — so `kmAt`, `kmAtStop`, the milestones
(`sAlong`) and the summary card count what the vehicle drives, exactly, never
by plan length (the projection's scale varies with latitude). On a road path
the heading is read over a chord (`headingAt`), or the car twitches on every
fix — and the chord is NEVER a share of the piece (2026-10-09, his report of
a trembling car): 3 % of the path was 1.3 km on a day and 600 km on a piece
driving the whole trip, which pointed the car at a far town while it slid
through every bend. The plan's default is `ROAD_HEADING_KM` (1 km) on the
ground; the painter passes its own, two vehicle lengths ON SCREEN
(`HEADING_LENGTHS`), so close up the car follows its bend and from afar a
town's streets do not spin it. Measured locally on his track (never committed): 143 simulated stops,
99 hops on the road at `stages`/100 m, the road hops summing to the line's
own km within 1 %, ~100 ms for the first plan, ~10 ms cached.

## The Itinerary and the overview's Map draw the road (2026-10-09)

The Itinerary reads the road through `MapOptions.roads`, DERIVED in
`drawnOptions` (and the panel) from `roadHops` and never stored — the road is
the trip's, not the piece's. Every fit of the drawn map goes through
`mapFit(o)` (stops + a ≤ 4 000-point sample of the road): the paint, the
camera's subject and bounds and the OSM ground must fit on the same points,
or the tiles slide under the line. A road hop is a `RoadShape` whose
fractions are KILOMETRES, so the pen, the drawn/ahead split and the distance
readout agree; the pen's pace shares time by the road's planar length
(`planarHops(stops, roads)`). The overview's Map adds the road as a MapLibre
`line` layer (GPU, not the per-frame SVG) and then drops the solid straight
strokes between stages, keeping the dotted ones (they say days are
unaccounted for); it frames the places plus the road inside their box grown
by its own size (≥ 2°), never the far end of a flight home the track carries.
Since the same day a stage's own TINTED path follows the road too
(`stageRoads` in `trip-map.ts`): the hops are found over EVERY stage's places
in lived order in one `roadHops` pass, so the cursor carries from stage to
stage (an out-and-back road takes the right pass), computed in a `useMemo`
on the stages and the road and never per frame — the search scans the whole
line; the dial sits halfway along the path as drawn (`pathMidpoint`), on the
road, and the stage focus flies there.
