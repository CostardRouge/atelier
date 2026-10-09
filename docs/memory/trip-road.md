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
