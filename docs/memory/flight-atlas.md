# Flight Atlas (experimental)

Read before touching `src/tools/atlas/` — the instrument that draws every selected drone flight on one map and animates them together.

## Why it exists and what it is not (2026-10-12)

**Decision.** The maintainer asked for a NEW, EXPERIMENTAL usage («peut-être pas quelque chose qu'on va garder»): load all his drone trajectories — telemetry only, never the videos — and draw them on a map as elegantly as the Perth bus animation he showed (dark ground, violet network of every route, cyan comets with white heads, a big clock and «413 buses running» in a corner, the activity curve under it), with many original sliders for colours, places, map visibility, speed, per-flight colours, pulses, and STAGGERING (all at once, one by one, slightly offset). He left it to the agent overnight («carte libre, sois autonome»). **How to apply**: it is an `instrument` in the registry (`/atlas`), not a document kind — the flights are the Library's selection, the dials are a `localStorage` convenience (`atelier.atlas.settings`, read back through `sanitizeSettings`, so no migration ever), and what leaves is an MP4/PNG. Keep it deletable: nothing outside `src/tools/atlas/` depends on it, it touches `shared/` only by importing.

## The shape (2026-10-12)

- **Pure modules, tested**: `atlas-flight.ts` (cues → typed-array track in Web Mercator WORLD units, ≥ 0.25 s between kept fixes, a jump > 120 m/s dropped, TIME from the cue's wall-clock stamp so a conformed clip runs at its real pace, `startWall` a UTC calendar READ AS LOCAL time — read with UTC accessors everywhere), `atlas-schedule.ts` (the choreography), `atlas-view.ts` (camera), `atlas-places.ts` (single-linkage places at 4 km + Douglas–Peucker), `atlas-settings.ts` (dials, presets, sanitising), `atlas-colour.ts`, `atlas-hud.ts`.
- **One painter** (`atlas-paint.ts`) for the preview and the export, sizes given for a 1080 short side × `unit`. Points are projected BY HAND through one affine (never a canvas transform: line widths stay pixels, doubles never pass a float32 matrix), into reused buffers; lines are thinned per zoom level by `LodCache` (a third of a pixel). Measured: a swarm of 37 flights at dpr 2 holds 60 fps headless.
- **The view is normalised by the frame's short side**, so the same view is the same picture in a 700 px preview and a 4K export. Trap met on the first run: `fitView` floored the room at «1 pixel», which in short-side units is the whole frame — every fit was 2.4× too tight. Any floor in that module must be relative to the short side.
- **Choreography in FLIGHT seconds, then scaled to the asked length**, so a dial keeps its meaning at any length. Five modes: together, cascade (spacing = stagger × mean slot), relay (overlap), clock (seconds of day, a flight slowed `dayStretch`× against the clock, night croppable), calendar (idle between flights capped, the clock RACES through the cut via piecewise-linear `ClockMap` anchors). `equalize` pulls each slot towards the mean; jitter and the shuffle are SEEDED — preview = export.
- **The follow camera is a function of time**: a track simulated once at 1/30 s (exponential ease in centre and log-scale, out faster than in, the zoom held back when the next box is more than 0.6 frames away so a jump between places reads as travel) and interpolated. Never an accumulator in the rAF loop — an export at another fps must draw the same frames.
- **The stage** paints from a `PlayClock` store outside React (the transport subscribes; the 200-control inspector never re-renders while playing), letterboxed to the export's aspect (WYSIWYG), wheel/pinch/drag through `useZoomGestures`, any of which turns the camera to `free`.
- **Tiles** (`atlas-tiles.ts`): the canvas IS Web Mercator, so a raw tile is drawn with one affine `drawImage`, TONED ONCE on landing on its own opaque 256 px canvas (blend modes on a frame with holes would tone the bare ground too), dimmed by one full-frame fill of the ground colour (a no-op where there is no tile), an ancestor standing in while loading; the export awaits `ready()` per frame. The coarse 1:50m coastline is NOT drawn over tiles (it is a wrong second coast at drone scale).

## Round two: overlay, framing, mount (2026-10-12)

His second ask, the same night: statistics in the overlay, title/subtitle «style look like in studio and trip», Format and Export tabs (resolution, ratio, borders), a way to CROP the atlas (whole world, the concerned zone, a chosen zone), a camera that dives on a drone from time to time (random or picked, optional), the drone's brand and model, a date range. **Decisions**:

- **The overlay is drawn by the shared text engine** (`drawOverlays` + `StylePanel`, `atlas-overlay.ts`), never by hand: each piece becomes ordinary `text` elements under `hud.theme`, a label pinning `uppercase`/`letterSpacing`/`weight`, an accent pinning `color`. The activity curve is the one piece the engine has no element for; it is drawn beside them. Pieces live in six SPOTS and stack in one fixed order; a statistic's numeral is the engine's ODOMETER, but only when LIVE — a total held still would freeze mid-roll — and its text is CUT, never rounded (`atlas-stats.ts`), or 41.7 rounded to «42» would roll past itself.
- **Statistics are measured** from running totals kept per fix (`cumKm`, `cumAltS` — the time integral of height, so the average height is time-weighted —, `cumMaxAlt`, `cumMaxSpeed`); nothing estimated.
- **The aircraft comes from the clip's MP4 metadata, never the log** (a DJI `.srt` names none): `read-aircraft.ts` walks box HEADERS (16-byte reads) to `moov`, reads only its `udta`/`meta`; `atlas-aircraft.ts` parses QuickTime `©mdl`/`©mak`/`©enc`/`©too`, an `ilst`, Apple `keys`+`ilst`, then a camera code or a `DJI…` word. A short code table (FC8482 Mini 4 Pro — his body —, FC3582, FC7303, FC3411, FC3170, FC220, FC330); an unknown code stays the code. Untested on a real DJI MP4: which tag his drone writes is unknown.
- **The mount**: `mapRect(format, W, H)` is the map's rectangle; every camera fits to `mapUnitFrame` (the MAP's shape, not the frame's), the painter offsets its affine by the rect's corner and clips to it — no second canvas. Gestures and the export's tile wait measure inside the mount too; forgetting that offset is the bug to expect.
- **Framing** adds `world` (`WORLD_BOX`, Mercator's useful band) and `zone` (`camera.zone`, a world box drawn on the stage — the four screen corners unprojected — or the view's `visibleBox`).
- **Spotlight** (`atlas-spotlight.ts`): episodes laid out once (every N s, the next flight in the air with ≥ 60 % of min(hold, its slot) left — the first cut required a whole slot and found nothing in a tight cascade), seeded; the camera track now aims at VIEWS (`buildCameraTrack(targetAt: t → view)`), the spotlight's view centred on the head at `closeness` km. **Trap**: an exponential approach on the centre throttled the zoom (held back until the aim is near) to ~1.4 levels a second — a 12-level dive took 8 s; while travelling the centre now moves ~3× faster. On a place or zone frame only the flights it shows are followed (random picks otherwise jumped continents). Short slots (a dense relay) give short dives — inherent, said in the hint.

## What is unverified / open (2026-10-12)

- Driven headless only, on SYNTHETIC logs (37 flights at Perth, Fremantle, Byron Bay, Guadeloupe — `scratchpad` generator, not in the repo); never on his real SRT folder, his Mac or his phone.
- The MP4 path could not be encoded here (no H.264 in headless Chromium); the PNG still and poster were. A failure says so and points at the PNGs.
- DJI logs in the old `GPS(...)` format parse to nothing (the shared parser's limit) and are listed as «without a GPS track».
- Ideas left for his verdict, not built: free placement of overlay pieces by drag, a flight-path heatmap/density mode, slowing time while the spotlight follows, per-flight colour overrides, saving named presets.

## Flights from Winnow: the picker, logs only (2026-10-13)

**Decision.** The Flights tab's **From <instance>** (`AtlasWinnow.tsx`) is the
shared Winnow picker with an atlas HOST, not a screen of its own: it opens on
a SPAN (the last one used on that instance), lists only clips with a `.srt`
(`accepts` + `narrow: { mediaType: 'video' }` so the server's cap counts
clips), in the Logbook with tracks read, everything ticked, and adds with
`materialize(…, { fidelity: 'log' })` — the `.srt` alone, never the video,
reusing the logs the Logbook already read. **Why**: his ask after the first
round — the Winnow modal was day by day and mostly photos and videos; the
pair (clip + log) was on every row already. **How to apply**: the logs land
in the Library like any file and `addFiles` SELECTS them, which is what makes
the atlas draw them at once; a flight whose log is in the Library is drawn
*in library* and cannot be ticked twice. The picker side is
`winnow-picker.md` (Span, Flight log facet, Logs only, Logbook).
