# A trip's ROAD — the GPS track kept beside the places

Read when you touch `shared/roadtrip/road-track.ts`, `TripDoc.road`, the Road
section of Trip settings, or how Virée and the Itinerary draw the line between
stops and count its kilometres.

## Places are TOLD, road points are DRIVEN (2026-10-09, his decision)

A trip keeps two kinds of points. A PLACE is named, shown, halted at, counted
and carries pictures — a few dozen per trip, chosen by hand or by Deduce. A
ROAD POINT is never named nor drawn as a point: it gives the line its shape,
the camera its path and the counter its kilometres — thousands per trip,
taken from a Polarsteps export, never typed. **Why**: Deduce read the track
once to cut stages and then dropped it, so Virée drew curves between sparse
places — four places for 2 000 km across the Nullarbor, a curve 872 km out at
sea over the Bight, and ≈ 14 000 km counted against the 22 000 the car really
did. The track itself has no gap there (485 fixes 3–14 Jan 2026, none more
than 67 km apart). **How to apply**: never turn road points into places, and
never make a place out of the track; a stop on the road is still a place.

## Four modes and a detail, the maintainer's own list (2026-10-09)

`RoadMode`: `crow` (no road — the curves, as before), `stages` (the road
between stays: a run of 18 h or more within 15 km keeps its two ends only —
walks, buses, the commute go), `moves` (every move without GPS noise: a fix
that jumps away and back within 2 h is dropped, then any fix within 500 m of
the last kept), `raw` (every fix). The DETAIL is apart: a Douglas–Peucker
tolerance from 0 to 2 000 m, default 100 — how many points, not which.
Measured on his whole export (flights out): stages ≈ 19 800 km, moves ≈ 23 400,
raw ≈ 23 700 (+ ≈ 1 050 km of March by steps, before the tracker started);
the car's own 22 000 sits between the first two. The noise threshold was
chosen on that track: Polarsteps fixes are already sparse, so a 2 km anchor
(the first lab's) ate real driving; 500 m plus the spike rule does not.
**How to apply**: the mode and the detail are the TRIP's, so every piece and
every counter reads the same line; the whole track is kept (≈ 55 KB encoded
for 7 578 fixes) so any mode can be read back — privacy is not a concern on a
finished trip for him (his words), but the backup and the Winnow copy carry
the raw fixes, home and work included, and that is said where it is written.

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

## `TripDoc.road` (v32), written from Deduce's Review (2026-10-09)

`TripRoad`: the encoded track, its fix count, the points placed by hand
(`added`, for the holes — never named), the mode, the detail and when it was
written; null on every stored trip (the v32 migration writes null). PORTABLE:
`toTripFile`, `parseTripFile` and `tripDocFromFile` all carry it (the four
places rule `studio.md` learnt on the intros). Deduce's Review offers *Keep
the road from Polarsteps*, ticked by default whenever the export has a track,
and Write works with only the road to write. `makeTripRoad` keeps the fixes
within the trip's span plus a day each side, and a re-import replaces the
fixes while keeping the mode, the detail and the hand-placed points.

## Trip settings → Road, one panel in both sheets (2026-10-09)

`RoadSettingsPanel.tsx` is drawn LIVE in the piece's Trip settings (section
`road`, written through `onChangeTrip` on every move like the other sections)
and as a DRAFT in the overview's Trip settings (`TripDetailsModal`, beside the
cover, written on Save through `TripDetails.road`). Each mode shows the km it
would count at the current detail, so the choice is made on the numbers; the
detail slider walks `ROAD_DETAILS` and is greyed under Crow flies (nothing to
smooth). With no road the panel says where one comes from (Deduce) rather
than hiding — the overview's sheet is where he looks for it.

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
fix. Measured locally on his track (never committed): 143 simulated stops,
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
Left as is: a stage's own tinted path between its places is still straight.

## Road points placed by hand, on the big map (2026-10-09)

`road-points.ts` + `RoadPointsSheet.tsx`, opened from the Road panel. A click
lands on the nearest stretch between two consecutive fixes (a flight
excluded, 300 km reach) and takes the time that far along it, strictly
between the two fixes, so `cleanFixes` merges it in order and every mode
draws through it; a click within 12 px of a point of yours takes it back.
Holes (stretches > 20 km, not flights) are drawn dashed and counted on the
panel's button. MEASURED on his real year: no hole over 150 km, 20 over
20 km — the Nullarbor line in the water was never a hole in the track but
the arcs between sparse places, which the road itself cures; hand points are
for trips where the phone was off. The Road panel's sheet and Forget question
are NESTED dialogs: `onNested` makes both parent sheets drop their
Escape/Enter (window listeners run in registration order, so the parent's
would fire first and close both).

## GPX adds to the road (2026-10-09, his «do gpx support»)

`gpx.ts` (pure) reads a `.gpx` with a regex scanner, not `DOMParser` (the
module stays node-tested; one pass over 100 000 points): `trkpt`, `rtept`
and `wpt`, namespace prefixes allowed, a point KEPT only with a time (a time
with no zone is UTC, the schema's rule), a timeless planned route REFUSED
with the reason — the road merges on the track's clock and has no other way
to order a point. Several files merge into one journey (a logger writes a
file a day). Trip settings → Road → *Add a GPX…* runs `addGpxToRoad` →
`addRoadFixes`: merged with what is there, within the trip's span ± a day,
the same instant once, mode/detail/hand points kept, `TripRoad.source`
becoming `gpx` or `mixed` (read back as `polarsteps` when unknown), and the
panel says what was added or why nothing was.

GPX in DEDUCE too (same day): a `.gpx` (by name or by its `<gpx` head) is the
TRACK half of the export — `PolarstepsTrack.origin: 'gpx'` — so its timed
points place the days on the same rules (solar clock without a `trip.json`,
the step's zone with one) and *Keep the road from GPX* writes `source: 'gpx'`.
All the GPX files of one drop are read as ONE journey and then weighed, as
one track, against a `locations.json` by the trip's days they cover. The
chip says `GPX`, `Polarsteps + GPX` or `Polarsteps`. Not driven in a
browser: the Deduce window needs a Winnow connection (a stub), so it rests
on the unit tests of `addPolarstepsFiles` and the Road panel's drive.
