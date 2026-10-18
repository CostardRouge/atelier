# A trip's ROAD as the openers drive and draw it

Read when you touch `roadHops` / `roadBetween` / `steerRoad` / `roadKms` /
`RoadDrive` in `shared/roadtrip/road-track.ts`, `road-ribbon.ts`, how Virée (`drive-plan.ts`, `drive-paint.ts`)
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
Streaky Bay → Esperance follows the Eyre Highway for 1 557 km. **A hop is
CUT where each stop MEETS the road** (2026-10-17): its foot on the segments
either side of the nearest fix (`footOn`), never the nearest fix itself — a
line keeps a fix every 2 km on a straight, so a cut at a fix ran up to a
kilometre past the place and back at EVERY stop, a reversal the vehicle drove
and the counter counted, read as a tremble. Virée's path goes through that
foot and not the place's dot (`buildPath`'s `on`): the vehicle stays on the
road through a place beside it, the dot is drawn where the place is, and a
road hop counts only the road between its two feet.

## The vehicle DRIVES the road: three styles, the RIBBON by default (2026-10-13)

His report on the driver (option B of the road-tremor lab,
https://claude.ai/artifact/EDJB8AfqbKStpfRKnEevcQ, his pick of 10-09): the
car «flotte et tremblote», and he wanted to switch between the lab's options.
**Decision**: `TripRoad.drive` (`RoadDrive`) — `fixes` (point to point),
`driver` (`steerRoad`, B) and `ribbon` (`road-ribbon.ts`, the lab's A made
local) — every style's settings kept side by side so a switch loses nothing;
absent = `DEFAULT_ROAD_DRIVE`, the ribbon at 100 m / 3 km. The older `steer`
is READ only: `null` → `fixes`, an object → `driver` with its values, absent →
the default (so a road he never tuned moves to the ribbon; one he tuned stays
on the driver until he switches). Read through `roadDriveOf`, never raw.
**The ribbon**: fixes nearer than the corridor merged into their mean, a
weighted cubic smoothing spline over arc length (Reinsch, one pentadiagonal
system, weights = the road a fix stands for so dense and sparse fixes smooth
alike, λ from `smoothM` as a half-power wavelength) in Mercator km (a
conformal frame: the corridor stays round), then every fix still outside the
corridor pulls (weight × (r/T)²) until the curve passes within it; the
corridor WIDENS to 2× the fixes' local scatter (median over ±6 knots against
a 2 km-scale curve) — no fix says where the road was better than its own
noise, and holding each one in a town was a zigzag. Sampled by the spline's
own bend (a cubic's bend peaks at its knots), kept at 2 m / 4° / 2 km —
finer than the driver's 5 m / 10°, whose polygon corners are a twitch.
**Measured** on the lab's synthetic road (5 draws, `moves`, GPS 45 m): bend
jerk ×1.3 the true road's (driver ×1.7, point to point ×5.0), 64 m mean from
the true road (driver 73), ≤ 92 m from any fix (driver 267); `raw`: driver
342 m, ribbon 129 m. A 37 000 km synthetic year: ribbon 140–190 ms, driver
340–440 ms. **Spikes — what was tried**: a fit residual misses them (a spike
stretches the line's arc length, so any curve follows it); a leave-one-out
residual alone dropped real sparse bends (a highway bend's middle fix sits
as far from its neighbours' chord as a 400 m error: worst stray 87 → 350 m);
the base-width rule alone dropped a dead end's tip (Cairns, 6.4 km cut). An
error is now ALL of: ≥ max(4 × corridor, 300 m) from where its neighbours put
it, they near theirs, further than they are apart, AND reached at ≥ 1.8× the
neighbouring stretches' speed. A spike between sparse fixes is KEPT as a
smooth bulge, on purpose. **The driver's own fixes**: it gave up at a stay's
cloud (aim within 5 m → `break` → a straight line to the piece's end) and
could orbit kilometres off with a tight radius; it now looks past the cloud
and is put back on the line when further off than it aims or stalled 60 steps.
**The line drawn is the line driven** (Virée, the Itinerary, the overview's
map, the Road pane). **What is counted never depends on the drive**: every driven point carries
`km` along the line at the detail (`countedKm`), `roadKms` reads it. The
ribbon reads EVERY fix the mode kept, never the Douglas–Peucker line (which
keeps a bend's noisiest fix). `roadHops`' `visits` skips 64-point blocks by
bounding box — a ribbon year is ~50 000 points.

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
ground. **The painter reads a BELL, not a chord** (2026-10-17, his «le ruban
tremble encore un peu dans les virages serrés»): `smoothHeadingAt` — the
road's tangent convolved with a Gaussian of σ = 0.7 vehicle lengths ON SCREEN
(`HEADING_SIGMA`, as wide as the old two-length chord), each segment weighted
exactly through `erf`. A box chord jolts twice per bend (its front end, then
its back end, crossing every polygon corner of the sampled line): measured in
Virée's own plan + camera on synthetic hairpins and 300 m bends, the peak
angular acceleration fell 4–7× close up, ~4× under Navigation and 20–50×
under Calm, slip unchanged. Smoothing the POSITION over that same bell was
tried and rejected — it stood the car up to 37 px off its own line; the
position takes a bell of its own, 0.05 vehicle lengths (~6 px, `PLACE_SIGMA`,
`smoothPointAt`, 2026-10-17), which rounds the CUSP a ribbon draws where
sparse fixes double back (a switchback as a V a few metres across, where the
car reversed in one frame): the jolt there fell 1.06 → 0.56 px under
Navigation (the background's level) and 3.1 → 1.9 px at an 8 km view, the
car's centre a few pixels off the line it covers. A wider position bell buys
nothing elsewhere: what is left is real bends driven at kilometres per
frame. A bell spanning more than 256 samples (a whole trip seen from
afar) reads them in power-of-two runs anchored to fixed indices, so a frame
costs ~0.015 ms at every zoom (0.44 ms per call uncapped over 8 000 samples). Close up the car follows its bend; from afar a town's streets, and a
hairpin smaller than the car, do not spin it. **The dashed road ahead is
anchored to the GROUND under a zoom** (2026-10-17, his «les pointillés
changent durant le driving ?»): a canvas lays a dash pattern in screen pixels
from the line's start, so every step of a following camera's pull-back slid
the dashes near a car 500 km down the road by whole dashes — they flickered
(a dash jumped > 3 px on 32–42 % of frames under Calm/Navigation). The track
bakes `dash` (`dashShift`: each step's change of scale times the car's arc
length, at 4× the track's rate) and the painter sets `lineDashOffset` from
it, the flown trail's dashes too: 0 % after, the residue under 0.2 px. The
Itinerary's ahead dashes start at the PEN and so travel with it — untouched.
**Under a following camera the place NAMES are steady** (`steadyLabels`,
2026-10-17): `placeLabels` re-decides each frame (right, left, above, below,
or dropped), and as the map scrolled, zoomed and turned names well inside the
frame jumped 14–95 times a second; now each keeps the right of its dot, runs
past the frame with the map, and FADES as an earlier name (or a card, weighed
by how much it shows) comes over a box half a line roomier than it — a fade
over ~20 px of motion, every answer continuous: 0.1–2 jumps a second left,
during the wide shots' fast zooms. A still map keeps `placeLabels`' packing.
Measured locally on his track (never committed): 143 simulated stops,
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
