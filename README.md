# Atelier

A local-first **suite of browser tools for your captures** — photo and video,
across devices (DJI, Apple, Sony, …). Everything runs in your browser; files
never leave your machine — no upload, no account, no server.

Today it ships ten tools, converging into a few editors:

- **Studio** — the unified editor the suite is converging on. Opens on your
  **projects** (saved compositions with a baked preview); each project keeps
  its overlays, look and layout, remembers which folder its media lives in,
  and reopens in one click. Edit on one stage — overlays, LUT, export —
  **clips and photographs alike**.
- **Trips** — plan and track how a journey gets told. Give a trip its two
  dates and every day of it becomes a cell in a contribution-style grid; the
  holes are the days you have never posted from.
- **Develop** — gather the photographs you mean to develop into a **roll**,
  kept in this browser or on your Winnow; give each its own light, colour and
  crop under one look for the roll, and export them — from the proxy or the
  original — or send them home to the Winnow they came from.
- **DJI Telemetry** — view DJI drone flight telemetry in sync with the video it
  was captured with.
- **Telemetry Overlay** — place altitude, GPS and exposure readouts anywhere on
  a DJI clip and export an MP4 with the telemetry burned in.
- **Flight Map** — trace a DJI clip's GPS path on a map and scrub the video to
  walk the aircraft along it (the base map is opt-in — see below).
- **Composer** — combine a clip, its flight map and a draggable telemetry
  readout into one framed composition (aspect, layout, LUT), preview it live,
  and export it to MP4.
- **Photo EXIF** — inspect a photo's metadata (camera, lens, the full exposure
  triplet and GPS location) read straight from the file — the photo counterpart
  to Telemetry.
- **Compare A/B** — lay any two photos or clips under a draggable before/after
  divider, with synced playback when both are clips.
- **LUT Studio** — preview and batch-apply `.cube` colour LUTs to your footage in
  real time, with a before/after wipe.

> **The network exceptions.** Everything above runs offline and uploads
> nothing — no file, no photograph, no position ever leaves the machine. Two
> *optional* features can make a request, both off by default and both stated
> where you turn them on:
>
> - The Flight Map's **base map**: turning it on fetches map tiles from
>   OpenStreetMap, which reveals the viewed area to that tile server. The
>   flight path itself always draws locally.
> - The **place search** in Trips: looking a stage's place up sends *the words
>   you type* to OpenStreetMap's Nominatim service, and gets a name, a region
>   and coordinates back. Every place can be typed by hand instead, so the
>   feature is a convenience and never a requirement.
>
> Naming a place from *coordinates* is deliberately **not** one of them: the
> city index Trips names a deduced leg from ships with the app (see "Working
> the itinerary out"), so the position of your photographs is never sent
> anywhere for a name.
>
> A third kind of request exists only once you have connected a **Winnow**
> instance of your own (see "Sources" under the Studio): media is fetched from
> it, a trip or a project can be kept on it, and a **LUT pack's looks** are
> fetched from it the first time a picture asks for one — all under your
> account there. Nothing is sent to a server you did not name yourself.

Tools that consume the same kinds of files (photos, videos, DJI clips) share a
single **asset library**: import a folder once and switch tools freely — each
tool sees the subset it can use. A clip with a flight log also shows, over its
thumbnail, the rate the camera **shot** at (`120 FPS`) and a `4× SLOW` marker
when the file was conformed — read from both ends of the `.srt`, a few kilobytes,
never from the video.

The suite is a tiny shell (`src/app/`) plus self-contained tools (`src/tools/*`)
that share a generic core (`src/shared/*`). The masthead nav and the routes both
derive from one **tool registry** (`src/app/tools.tsx`), so adding a tool is a
single registry entry plus its component. Navigation is hash-based
(`#/telemetry`, `#/lut`), which deep-links cleanly on static hosting.

## Studio tool

The destination of the whole suite: one editor instead of eight pages.

**Projects first.** `#/studio/home` is a gallery of saved projects — thumbnail
(baked at save time, so nothing decodes), aspect, duration, element and file
counts. The whole card opens the project; its other verbs (use as template,
move to another source, delete) sit behind a ⋯ menu, with a dashed tile at
the end of the grid that creates a project or takes a dropped settings file.
Creating one goes through a small intro modal (name, destination
aspect, start-from-template, optional media folder). Everything you do in the
editor autosaves to IndexedDB, but **media is never copied**: a project stores
the folder's *handle* plus each file's name/size/mtime. Reopening re-lists the
folder after one permission click and reconciles it — found / changed /
missing — and missing media never blocks editing (a banner offers a re-point).
On browsers without the File System Access API (Firefox, Safari) the handle
can't persist, so reopening falls back to the same banner. A project is also a
template: "Use as template" duplicates its portable half (overlays, look,
guides, settings) with no media binding.

**Settings travel as a file.** Project settings (the ⚙ chip in the project
bar) has an *Import / export* section: **Export settings** downloads
`<project>.atelier.json` — that same portable half, custom `.cube` text
inlined so a shared grade lands identically — and **Import a file…** replaces
the open project's settings with a file's, behind a confirmation (the media
and the project name stay put). From the gallery, **Import a project file**
creates a *new* project instead, which is what you want for a preset someone
sent you. Nothing bound to a machine is written: no folder handle, no media
list, no thumbnail. An older file is migrated on read; a file from a newer
version of Atelier is refused rather than half-read.

**A house style for new projects.** On the dev server only (`npm run dev`),
project settings end on a **House style** section that writes the open
project's look — overlays, guides, title style, intro, closing card, grade and
export matrix — to `src/shared/projects/house-style.json`. Commit that file and
every new project created *without* a template starts from it, on the deployed
site too (the modal's "Start from" then reads **House style** instead of
**Blank**); **Back to the factory look** deletes it. It never carries the
format (chosen when creating), the capture-time shift, the cadence, the export
file name or the media, never what Trips sent into the project (its hook and
closing card), and never an uploaded LUT. Existing projects, imported project
files, duplicates and the projects Trips creates around a clip are left alone.
It is the Studio twin of Trips' house style, below, and shares its dev-server
writer.

**The editor.** Pick a clip, place overlay elements on the canvas stage (drag
to position, anchors keep edge pinning), grade through a `.cube` LUT, scrub
with the shared transport. The inspector is tabbed (Overlay / Style / Grade /
Info / Export); tools run edge-to-edge so a landscape clip finally gets the
width it needs. The whole suite has a **light and a dark theme**, chosen with
the button in the masthead (a monitor follows the system, a sun and a moon
are yours); the dark one is the same paper at night. **The editor sits in a
darkroom**: while a project is open the
paper gives way to hue-less grey around the picture, because a warm surround
biases the eye's reading of a grade. The galleries and the rest of the suite
keep the paper. Clips **without** an `.srt` are accepted: telemetry fields
read “—”, free text and the grade still work. Stepping to the next clip with
‹ › hands playback over rather than stopping it: if you were watching, the
next one picks up as soon as it is ready.

**Photographs are edited on the same stage.** A photo is not a second kind of
project: it is a media a project can hold beside its clips, so a rush and a
frame you shot the same afternoon sit under the same ‹ › and share the same
overlays, look and export matrix. What a still does not have, it does not
pretend to have — no transport, no trim, no cadence, no speed, no shutter
button (the export *is* the still); what stays is the A/B wipe, which is how a
grade gets judged. **The exposure readouts come alive**: a photo's EXIF is read
as the one telemetry cue it is worth, so ISO, shutter, aperture, exposure
compensation, focal length, GPS position, altitude and the capture clock/date
draw over a photograph exactly as they draw over a clip — and what a
photograph cannot answer (ground speed, vertical speed, heading, relative
altitude) reads “—” rather than being invented. Timing has nothing to bite on
over one instant, so the deck is drawn **settled**: every element where and how
it comes to rest, no entrances half-played. Export writes JPEGs through the
same variant rows — reframed, capped, overlays in or out
(`IMG_8801-4x5-1080p.jpg`) — with the cadence and speed controls simply gone.
A RAW file is kept in the library with the render its camera wrote inside it
as its cover and its sensor's pixels as its size; one that carries no render
says so in words, pointing at the JPEG or TIFF your developer can produce.
Where a RAW and its sidecar JPEG share a name, the pair is one photo and the
decodable half is the one you see, whichever the folder happened to list first. The row
still names both — `JPEG + DNG`, and a `+DNG` chip on the cover — so a RAW
added beside its JPEG is visibly there, and Develop opens it as the sensor.

**Trim.** The scrub bar carries two handles: everything before the in point
and after the out point greys out, and the playhead can only travel between
them. Whatever you drag, the picture follows it — grab a handle and you watch
the frame you are cutting on, not the one you left the playhead at. The push
works both ways: a handle dragged past the playhead carries it, and the
playhead dragged into a handle carries the handle outwards, so a tight range
widens without letting go. (Clicking in the greyed-out zone only lands on the
nearest kept frame; nothing is re-cut unless you drag through it.) The handles
are grabbed on the rail, the playhead by its head below — two bands, because
the two sit on top of each other constantly and neither must ever become
ungrabbable. The handles never cross (they stop one frame from each other).
Playback stops on the out point; press play there and it replays from the in
point, or turn on **↻** to loop the range. `I` and `O` cut at the playhead,
`Shift+I` / `Shift+O` put a handle back on the clip's own end, and a focused
handle steps by a frame with ← → (a second with Shift).
The range is what exports: every
variant is encoded from the in point, audio included, with the file starting at
zero — the overlays still read the *source* timeline, so telemetry and the
capture clock stay attached to the right frames. Each clip keeps **its own**
range, in the project and across clip switches, which is what lets you cut
several clips of one flight and export them one by one to assemble elsewhere. A
project reopened against different footage of the same name starts from the
whole clip rather than applying someone else's in/out points.

**The grade is a stack.** Add several looks and they apply in order, top to
bottom — each with its own strength (0–300%) and an on/off switch for
instant A/B, reordered with ↑/↓. The stack **bakes into a single LUT**
(each layer resampled through the previous one, the way an NLE flattens a
node graph), so the preview, the stills and every export variant still grade
through one shader pass.

**Film stocks: a look generated from an emulsion, not read from a file.** The
same picker offers six **FILM** stocks beside the vendor LUTs — *Reversal ·
vivid*, *Reversal · neutral*, *Negative · portrait*, *Negative · consumer*,
*Cross-process*, *Monochrome · panchromatic* — named by emulsion class rather
than by a brand, because each is a documented physical shape and not a claim
about someone's film. A stock is a layer like any other (strength, bypass,
order, house style, the `.atelier.json` and `.roadtrip.json` files), and its
cube is generated from a small model of the emulsion: per-channel
characteristic curves in stops (toe, straight line, shoulder — a different
shape per channel is the crossover, cool shadows under warm highlights), the
dye layers' overlap, coupler inhibition (a saturated colour melts toward
neutral instead of clipping — the thing a saturation slider cannot do), a
paper stage for the negatives, and dye saturation. Every stock keeps mid grey
exactly where it was, so picking one never changes exposure. Its dials are
live under the layer — pick a stock, then adjust coupling, rolloff, dye, the
print and the three curves — and the layer says when it has departed from its
stock. **Put it after a conversion LUT**: an emulsion applied to log footage is
nonsense, and the stack's order is yours. Grain and halation are not here yet:
they are spatial, not colour, and they arrive with the photo editor's render
core (`docs/film-simulation.md`).

**Develop: the media's own correction, before the look.** The Grade tab opens
on one settled row — `As shot`, or `+0.7 EV · highlights −40` — and
**Develop…** opens the same sheet Trips uses over the active photo *or clip*:
exposure in stops, brightness, contrast, highlights, shadows, whites, blacks,
temperature, tint, saturation, vibrance, with the grade stack underneath and a
wipe to the untouched frame. A clip opens on the frame under the playhead. The
correction bakes as the **first** stage of the same single LUT, so the stage,
the still export, every video variant and the frame grab all carry it. It is
kept **per media** in the project, keyed like the trims and guarded by the
file's content hash (a develop set on one file is not restored onto a
same-named other), follows a rename with them, and never enters
`.atelier.json` — a template is from no picture. **Copy** and **Paste** in the
sheet's header carry one set of numbers for the session, shared with Trips'
sheet, and **Apply to N other media** writes the same numbers onto every other
photo and clip of the project, each under its own hash, while Done writes the
one in hand. **Presets** are the same personal book as in Trips (below).

**Output transform.** Conversion LUTs (D-Log→709, Apple Log→709, S-Log→709)
are authored for a Rec.709 reference display — BT.1886, gamma 2.4, a dark
grading suite. A browser shows roughly gamma 2.2, so those looks arrive
lighter and flatter than intended: the error is ~+59% at code 0.1 and 0% at
both ends, which reads as milky, lifted blacks rather than a brighter image.
Pick **Rec.709 2.4 → sRGB** at the foot of the Grade tab and the grade is
re-encoded for the screen it will actually be watched on. Rec.709 and sRGB
share primaries, so only the curve changes — no gamut conversion is involved.
It defaults to **None**, so nothing you already made re-grades itself, and
`sRGB → Rec.709 2.4` goes the other way for a calibrated TV. It is a
*delivery* stage, always last, baked into the same single LUT. Note this is
tonal, not spatial: it restores contrast, it does not sharpen.

**Interpolation.** A 33³ cube holds 35,937 points; an 8-bit image holds 16.7
million colours, so nearly every pixel is interpolated between lattice points.
**Trilinear** averages all 8 corners of the enclosing cell — including the two
on the far diagonal, which have nothing to do with the colour at hand, so an
asymmetric look can tint greys the LUT leaves neutral. **Tetrahedral** (the
default, as in Resolve) splits the cell into 6 tetrahedra that all share the
neutral axis, and reads the 4 corners that matter. Measured on the shipped
cubes, the grey tint trilinear invents drops from 2.59 to 0.01 code values on
Apple Log→709; off the neutral axis the two can differ by up to 29 codes.
Toggle it in the Grade tab and watch a sky or a gradient — that is where it
shows. It is used by both the bake and the shader, so the preview and the
export never disagree.

The stage, element model and
export come from the shared overlay engine (`src/shared/overlay/`) — the same
renderer draws the preview and the export, so what you place is exactly what
burns in. An **A/B** toggle on the transport wipes original against composed
(draggable divider, editor-only), a **shutter** button beside it saves the
frame under the playhead as a JPEG with the look and overlays burned in at
source resolution; the **Info** tab reads the clip's facts and the live
telemetry at the playhead; **project settings** (name, format) stay editable
from the project bar, DaVinci-style. Beyond telemetry fields and free text,
the overlay kit holds a heading arrow (with an optional compass ring),
**viewfinder brackets** for the frame's corners, and **clock/date** fields
read out of the flight log.

**The introduction.** A social cut lives or dies on its first second, so the
Overlay tab opens on an **Intro** row: a hook title, a subtitle, a typed-out
question, and an invitation to **turn the phone** for footage you would rather
show in landscape. They are ordinary overlay elements — same fonts, same style
theme, same dragging — placed in a **scene**: one shared window they all live
in, and leave together. Inside it each element carries its own offset, so a
subtitle can land half a second after the title; move the scene and the whole
stagger moves with it — or let the scene **cascade** its elements by where
they sit (top to bottom, from the centre, the largest first, shuffled with a
kept seed), added to each one's own offset. The scene can lay a **veil** over the picture (colour,
strength, fade) so a title reads over any rush, and can **hold the rest of the
deck back** while it plays, fading the telemetry HUD in when it ends — the HUD
"boots up" after the hook.

Every element, intro or not, can now be given a **window** (appears at, disappears
at — both settable from the playhead) and an **entrance and exit**: fade, slide
in four directions, scale, typewriter or wipe, each with its own duration and
curve. Windows count from the clip's **in point**, so trimming the head never
eats the intro that plays over it. While you are editing an element that is not
on screen at the playhead, it stays drawn as a ghost so it can still be selected
and dragged. The phone pictogram is drawn into the video like everything else —
an export is a flat file, so the tipping gesture *is* the instruction.

**The outro.** The other end of the piece: a project can close on an **outro
card** — a flat ground carrying lines of text and, if you give it a link, a
locally-encoded QR code — that the export keeps encoding for a few seconds
**after the footage's last frame**. Appended, never laid over the picture: the
footage keeps every one of its frames, the audio simply ends with it and the
card plays silent, which is what an outro is on every platform. The card
recomposes for each variant's frame like every overlay, and it rides only the
variants that carry the overlays — a clean master stays clean. The stage
cannot scrub past the clip, so the Overlay tab's Outro row carries its own
preview, painted by the very renderer the export uses; edit the lines, the
hold, the ground and the QR link there. (Trips fills this slot with the
trip's call to action when it briefs a project — see the bridge below.)

**The instruments.** A **heading tape** — the cockpit ribbon: a slice of the
compass sliding under a fixed sight, ticks dissolving into the image at both
ends, letters on N/E/S/W. Nearly everything is a knob: width, visible span,
which degrees get ticks and which get labels, tick height, edge fade, opacity,
sight colour and mark, where the "247° WSW" reading sits, baseline rule on or
off. With no heading (hovering, or a clip without telemetry) the scale simply
isn't drawn — a tape frozen on an invented bearing would be a lie. Alongside
it, a **battery gauge**: cell, fill, low-charge alarm colour and threshold,
caption placement. Note that DJI's per-frame `.srt` carries **no battery
level** — the Mini 4 Pro included — so the gauge takes an authored value by
default, and can be pointed at a telemetry key for firmware that does write
one. It never invents a level: with nothing to read it draws empty. Speeds
read in **m/s, km/h or mph**.

**Slow motion and time-lapse.** A conformed clip plays at a speed the camera
never shot at: a hundred and twenty frames a second laid down at thirty makes
one second of flight last four seconds of file. Every speed rebuilt from the
log is a distance over a time, so on that clip the ground speed would read a
quarter of the truth — and a hyperlapse would read many times too much. The
studio measures the real cadence from the log's own capture timestamps and
corrects the rates; the **Info** tab states what it found (`120 → 30 fps ·
4× slow motion`), and project settings let you override it by hand for footage
whose log says nothing. Only rates move: a heading is a direction and survives
any conform, and the clock badges keep reading the capture time — which is why
they tick slowly on a ralenti, and that part is true. The container cannot
help here: a conformed file honestly declares the rate it *plays* at, and the
rate it was shot at is written nowhere in the mp4.

**Why the heading stutters, and what to do about it.** The flight log has no
compass and no yaw: the heading is *course over ground*, rebuilt from GPS
fixes about a second apart. So it steps (the GPS is slower than the video),
and it disappears whenever horizontal travel falls below a metre — hovering,
creeping, or yawing on the spot, where the nose turns but the ground track
doesn't. Both heading instruments therefore carry a **smoothing** control: a
window of readings averaged as directions rather than numbers (350° and 10°
average to North, not South), which eases the steps *and* bridges the short
gaps. When the reading really is gone you choose what happens — hold the last
bearing while it fades out (the default), hold it plainly for a set time, or
drop to the no-data state at once. The smoothing is a pure function of the cue
list and the playhead, never an accumulator over rendered frames, so the export
burns in exactly what the preview showed.

**And why they start blank — "value from the start".** Speed, vertical speed
and heading are not read from the log, they are *measured* between two GPS
fixes about a second apart. The clip's first second therefore has nothing
behind it to measure: the readouts, the arrow and the tape sit on `—` exactly
where a social cut begins. Those elements carry a **Value from the start**
switch, on by default, which fills that hole with the same window measured
*forward* — the reading the instrument is about to have, one second early.
It is a real measurement of the coming second, never an extrapolation: an
aircraft that does not move still shows nothing, and a value the look-back can
measure is never covered by the one ahead. Turn the switch off for the strictly
backward-looking reading. It only ever applies to the opening window — a gap in
the middle of a clip belongs to the gap behaviour above, since carrying a
bearing backwards there would announce a turn before it happens.

**Playback speed.** The transport carries a speed picker (0.25× to 4×) that
changes **only what you are watching** — no readout moves with it, and the
export has its own delivered speed. On a conformed clip it also offers
`real (4×)`, which plays a 4× ralenti back at the pace it was flown; that option
follows the clip, so it stays right when you step to another one.

**Keyboard.** `Space` plays and pauses the clip — here and in Grade, Compare,
Composer and the legacy Overlay, all of which share one transport — and
`Delete` (or `Backspace`) removes the selected overlay element. Both stand
down while you're typing in a field, and space is left alone whenever the
focused element already answers to it (a button, a slider, a `<video>` with
its own controls), so it never fires twice.

**Undo and redo.** Two arrows sit at the top of the editor, next to the save
state, and `⌘Z` / `⇧⌘Z` (`Ctrl+Z` / `Ctrl+Y` elsewhere) do the same from the
keyboard. A step covers the composition — the elements, the guides, the style,
the intro and the closing card, the name and the format, the trims, the
develops, the export settings and the grade — and never what you are merely
*looking at*: switching media is not an edit, and neither is the preview speed.
A run of small changes made together (dragging a slider, typing a name) steps
back as one, and inside a text field `⌘Z` stays the browser's own undo of the
letters you are typing. Fifty steps are kept while the project is open; undoing
is itself an edit, so it saves — and syncs — like any other. Trips and Develop
carry the same pair, over the trip and over the roll.

**Finding your way in a long deck.** The element list folds away behind a
header carrying the count, and even open it is capped and scrolls on its own
rather than pushing the style panel off the bottom. Selecting an element —
from the list or by clicking it on the frame — scrolls its settings into
view, and keeps the matching row visible in the list.

**Reading the clock.** Clock, date and timestamp elements each choose how they
read: 24-hour or 12-hour, AM/PM shown or not, seconds and milliseconds on or
off, and a date in ISO, `30/05/2026`, `05/30/2026`, `30 May 2026`,
`May 30, 2026` or `Sat 30 May 2026`. There is deliberately **no timezone
picker**: the flight log records a bare wall-clock reading with no offset and
no zone name — whatever the aircraft's clock said — so converting it would mean
guessing where it came from, and a dropdown would be false precision. What the
project settings offer instead is a **correction**: hours, minutes (the
half- and quarter-hour zones are real) and whole days, applied to the footage
once so every time element moves together and none can contradict another. It
rolls the date across midnight rather than wrapping the hour.

**Adding is a palette, not a dropdown.** Everything you can drop on the frame
sits in a foldable grid — Flight, Camera, Time, Shapes — and each cell
previews *what it will actually add*: the live value at the playhead, in the
project's title style, on a dark stage. No telemetry in the clip? The cell
shows the label alone rather than a made-up number. A cell already on the
frame is marked, never blocked. The starter deck is an offer when the frame is
empty and a confirmed **Reset deck** once it isn't — it can no longer wipe a
layout by surprise.

**The export matrix.** One press of Export can produce several deliverables:
each *variant* picks a frame (source or any destination preset — a landscape
master cover-crops into 9:16 with the overlays recomposed for that frame), a
delivery resolution (short-side 1080p/720p, never upscaled), a **frame rate**
(source, or 24/25/30/48/50/60/120), a **speed** and whether the overlays burn
in. The clip keeps its duration whatever the cadence — below the source rate
frames are dropped, above it they are duplicated, and the panel says so rather
than implying interpolated motion. The **speed** is the other axis: it moves the
duration and leaves the cadence alone (2× delivers half as long at the same
fps), the menu offers the one that puts a conformed clip back at life's pace
(“4× speed — real time” on a 4× ralenti), and the row states what you will get —
`2× speed — 0:01 instead of 0:03, delivered without audio`. Silent on purpose:
audio is copied bit-for-bit and never re-encoded here, and a copied track
against a re-timed picture is a desync, which is worse than no track. Burned-in
telemetry is unaffected — every frame keeps its own reading, so a sped-up clip
still says how fast the aircraft was really flying. Names follow automatically
(`vol-9x16-1080p-30fps-2x-clean.mp4` —
suffixes only where a variant departs from the source), the base name is
editable, and the whole matrix persists with the project (templates carry
it). Variants render sequentially with per-variant progress, each row counting
up while it works and keeping **what it cost** once done — file size, render
time and speed against realtime (`367 KB · 16 s · 0.2× realtime`), with a total
for the run. That is how you tell what a setting costs on *your* machine; the
figures live for the session and clear as soon as the setting that produced
them changes. Files land in the browser's downloads by default, or — on
Chromium — straight into a **destination folder** you pick once, stills
included.

**Title styles.** The Style tab adopts a named look as the project's theme —
*Or ciné* (optical-print gold serif), *Pixel CRT* (terminal red on phosphor),
*Rouge plein cadre* (flat saturated caps), or Neutral — then tweaks it: one
**glow slider** (matte → fluo) drives a four-layer film halation (softened
core, tight bright halo, wide warm-drifting bleed, animated grain — the grain
is phased from the media time, so preview and export are frame-identical),
with each layer hand-tunable in an advanced disclosure. Elements follow the
theme; editing an element's appearance pins just that property as an override
(marked ↺ — one click follows the theme again). Geometry never comes from the
theme: size is a multiplier, positions are untouched, so switching looks never
breaks a layout.

Next phase: the remaining tools become studio panels.

## Trips tool

Editing a clip is one problem; telling a whole journey, months after it
happened, is another. Trips is about the second one. Its route is still
`#/roadtrip` — the name on screen changed, every link ever made still
resolves.

**A trip is its two dates.** Give a trip a name and the days you left and came
back, and everything else derives from that: day 27 of 310 is a
subtraction, not something you record. Dates are handled as plain calendar days
(`YYYY-MM-DD`) and every subtraction runs in UTC, so a trip planned in one
timezone and reviewed in another never disagrees about which day a photo
belongs to — and a daylight-saving change cannot shift a day number. None of it
is fixed at creation: the name is edited by clicking it on the trip's heading,
and the dates and the route are reopened by clicking the line under it — the
same sheet that asked for them, which says before saving what a shorter span
does to the legs it no longer covers (trimmed, or removed when they fall
outside it entirely). Pieces are never moved and never deleted.

**The calendar is the point.** `#/roadtrip` lists the trips as **cards with
their cover** or, one toggle away, as **bands** — the trip you were on first
with a Resume button, then one progress row per trip. A trip opens on every
day of it, as a **calendar of months**: one block per calendar month the trip
touches, seven columns Monday to Sunday, the blocks side by side where the
window is wide enough (three to a row above 1180px, two below, one on a phone)
and a day never narrower than a pointer can aim at. Above the blocks the
whole trip stays in view as a **map** — a contribution-style heatmap, one
column per week, fitted to the width — read and jumped from (one click per
month) and never aimed at; the frame on it is where you have scrolled to.
Under each week a **ribbon** says which leg you were on. A trip of a month or
less skips all that: it is drawn as its own weeks with one week either side to
situate it, and no map — four days do not need a year.
Its job is the **holes**: with thousands of photos and a year's distance,
what you cannot answer from memory is which days you have never told. Empty
cells are drawn like any other, five intensity rungs separate "nothing here"
from "drafted but never sent" from "published once, twice, more", and the
heading carries three figures — days told, published, and the longest
silence, which jumps to its first day when clicked. Hovering a cell raises a
card — the day, its number, what is sitting there and whether any of it went
out — drawn immediately rather than after the browser's own tooltip delay, so
the grid can be swept rather than interrogated. Clicking a day opens it: what
has already come out of it, and three buttons to tell it — **Reel**,
**Carousel**, **Single photo**. Each one is a single click: the piece is
created with the look the trip last gave that kind and **opens straight away**,
where it is named and dressed. The same three verbs also sit under a picture
you are looking at large, in the Library's preview sheet — the moment "this one
is worth a piece" is actually decided — and starting one there brings the
picture across (fetching it from a connected Winnow if that is where it lives)
and composes the new piece over it. A fourth verb sits beside them, **Locate
it**, which reads where that photograph was taken and offers the place to the
leg of its own day (see *Working the itinerary out*, below). Any row in that list opens its piece — the whole
row, not just the thumbnail — and a piece can be **duplicated** on the spot,
carrying its look and its slides but neither its publication nor its Studio
link. **Where you are is in the URL**: `#/roadtrip/australia-d1060760/2025-07-09`
names the trip and the day, so coming back from a piece lands on the day you
were working on rather than on day one of three hundred, a reload keeps its
place, and a day can be linked to. The trip's part is readable but resolves on
an id fragment, so renaming a trip never breaks a link. Each piece in that list carries **a thumbnail of
its own hook**, kept in the browser beside the trip, so a day reopened months
later shows what you left there instead of a file name.

**The hook.** Open a piece and you compose its badge over the picture, in the
same darkroom the Studio grades in, with the deck and its transport as one
band under the picture (see *A post is a deck*). The badge is the
number the trip gives it, big, with everything else deliberately subordinate —
"Australia · Day · **27** · of 310 · ◆ Kalbarri · 1 year ago today". It counts
four ways (day of trip, a range of days, the day at a place, how long you
stayed), and closes on an optional line about when. Pick a frame (9:16, 2:3,
3:4, 4:5, 1:1, 4:3, 3:2, 16:9), place the block on a 3×3 grid, size the numeral, and export a
PNG — ready as a Reel's opening frame or a carousel's first slide.

The picture takes every pixel the column can spare — it grows with the window
rather than stopping at a fixed fraction of it — while the transport and the
export button stay put. On a wide screen the badge holds still while its
controls scroll beside it —
the Studio's layout, and the reason is the same: you are watching the picture,
not the panel. On a phone the picture and the band under it own the screen
and nothing scrolls: the four tabs are the bottom bar, each raising its panel
as a sheet over the picture, the band's controls are finger-sized, and the
band keeps clear of the bar however tall the frame is.

A piece is renamed in place, by typing over its title — the same gesture as a
Studio project's name.

**The picture is whatever is ticked in the Library**, and the two stay in step:
opening a piece points the Library at its picture, and picking another one
there re-points the piece. With a Winnow connected, the Library's instance tab
lists that piece's day by itself — the day is the piece's, so it is never
typed — and one click brings a picture across. Videos work as well as photos: the frame the hook sits
on is chosen by **dragging along a filmstrip of the clip itself**, the way a
phone gallery picks a cover — the thumbnails fill in as they decode, the
preview follows the drag, and the arrows nudge frame by frame.

**Stages** are the legs of the trip, each with its own span. They are what lets
a badge name a place, say "3 days in Kalbarri", or count which day of a stop a
picture is — and an optional marker sets the place off from the rest.

They live on a **ruler between the map and the months** — a video editor's
timeline scaled to days. It details the **months on screen**: the one you
have scrolled to and its two neighbours, so the legs of a quarter at a time
get the width a pointer can grab (about nine pixels a day on a year-long
trip) while the map above keeps the whole year in view — scroll the calendar
and the ruler follows. Each leg is a bar: drag either edge to change when it began or ended,
drag its middle to slide it whole, and every move snaps to a day while a pin
follows the pointer saying the date it would land on and how long the leg
would then be. A run of days no leg covers offers a `+` that adds one over
exactly that run; legs that overlap on a travel day stack in a second row
rather than hiding one another. The months and the ruler are the same calendar
seen twice: each week wears its leg's ribbon in the leg's tint, the day you have
open is a **playhead** — click anywhere on the track to go to that day, or
move it with the arrow keys — and **right-clicking a day** offers the edits
that make sense there, worded with the leg they would touch: start a stage
here (inside a leg, that cuts it in two), end "Perth → Kalbarri" here, extend
it to here. Clicking a bar opens that leg's fields — in a column beside the
calendar above 1180px, with the open day, and beneath the ruler below — and
goes to the day it began; clicking a day a leg covers opens that leg. Nothing
is drag-only — a focused edge, bar or playhead moves with the arrow keys.

**On a phone the same calendar is the whole screen.** Below 820px the grid
this replaced gave a year-long trip a 6px cell — seven times too small for a
finger — so the months stack one to a row, the column scrolling, and a day is
a seventh of the width, ~47px, with nothing to invent; the map above is one
tap per month. The ruler does not fit a phone and leaves it entirely (its job
is done on the calendar itself, below).
A tap on a day **selects** it and never opens anything: the **strip** above
the bottom bar re-reads — the date, the leg, and the day's pieces as their own
hook thumbnails, three at most, then `+N`; on a day nothing came out of, the
strip carries **+ Tell it** instead. The strip pulls up into the **day sheet**:
what was told, each row's actions behind one `⋯`, the leg in one row with
*Edit ›*, and the three verbs. The bottom bar the shell draws on every tool
screen carries the overview's own cells beside the library: **Stages** — the
legs as a list, each with its coverage as a small barcode, the open one
unfolding its fields, and the uncovered runs as rows with `+ cover` — and
**Trip**, the dates-and-route sheet. A leg's dates are dragged on the
calendar itself: **Adjust on the calendar** fades every other day, puts a
28px grip on each end, and one cell is one day — 47px against the ruler's
6 — with a tap moving the nearer edge and a stepper per edge under the
calendar as the keyboard's twin; Done writes it, Cancel drops it. A toggle in
the bar swaps the rungs for **pictures**: each told day draws the hook of its
piece in its cell, with a count when it holds several. The choice is
remembered by the browser, and the same toggle sits in the wide screen's bar.
Above 820px the strip, the sheets and Adjust do not apply: the day and the
leg are panels on the screen, and the ruler is what edits a leg.

A stage lists **the places it went through, in the order you lived them**,
as a row of chips joined by the badge's own arrow. The first is where the leg
began and the last is where it ended, so a start and an end are the list
itself rather than two more fields to keep in step; drag a chip (or move it
with the arrow keys) to reorder, click one to edit it. Leave the stage's own
name empty and it writes itself from those two ends — "Perth → Cairns" — and
typing a name over it always wins; clearing that name gives the derived one
back rather than a blank. A place is a *point inside* a stage and carries no
dates of its own: the stage is the dated thing, so "Uluru on the 12th" inside
a nine-day leg means splitting the leg, not dating the place — which is what
"start a stage here" on that day does.

Each place can carry **coordinates**, and there are two ways to get them: type
the name and leave it at that (a place that is only a name is a complete
place), or use the **optional place search**, which sends the words you type to
OpenStreetMap's Nominatim and fills in the name, the region and the position.
That search is **off until you turn it on**, it says exactly what it will send
before it sends anything, and it fires on Enter or the button — never as you
type. Places are only ever typed on a leg: the New trip dialog asks for the
name and the two dates and nothing else, so a trip starts with no leg at all
and a day outside every leg names no place rather than claiming one.

**Working the itinerary out, instead of typing it.** Drawing a three-month
trip's legs by hand is some three hundred gestures, most of them archaeology
about where you were on a given day — so the legs can be *deduced* instead,
and a picture can place a single day.

**Deduce** (in the stages header, for any connected Winnow) asks the instance
for **one position per day** over the trip's span — a few kilobytes for a
hundred days; no photograph is fetched and nothing is read from your media. A
leg is then a run of consecutive days whose position stays inside a radius of
the run so far, and you say what that means: the radius of one halt, how many
days make a halt rather than a stop on the way, whether a shorter run is listed
on its own (marked, and left unticked) or folded into the halt it was on the
way to, whether a day the instance has no position for is **covered** by the
leg around it — nothing is invented there, a leg is a span — and, off by
default and marked wherever it shows, whether the days of a move are guessed
between two places. Moving any of those never asks the instance again. What
comes back is a list of proposals, one tick each, in the same shape a re-run
later would produce: nothing is written until you accept it, and no piece is
ever created.

**Locate it**, under a photograph you are looking at large, is the same
question asked of one picture: it reads the position and the day out of the
file's own EXIF (or, for a picture fetched from a Winnow, the metadata that
instance recorded at ingest), says what it measured, and offers **one** edit —
name the leg of that day, add the place to a leg that already has a route, or
start a leg there when none covers it. A picture dated outside the trip, one
with no position, and one whose position is the `0, 0` a camera writes with no
fix are each said plainly rather than quietly used.

Both name a place from a **city index that ships with the app** — GeoNames'
`cities1000` (135 000 towns), built into `public/geo/cities.json` and fetched
from this site the first time a name is needed, never at start-up (Develop
reads the same index to write a delivered picture's place). So naming a
leg is **not** a third network exception: the alternative, reverse-geocoding,
would send the coordinates of your photographs to someone else's server for a
name, which is a far larger claim on your data than the place search's typed
words. Nothing near enough in the index means the leg arrives with its dates
and no place, rather than a made-up one. *The GeoNames data is used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the attribution is
carried inside the generated file, and `scripts/gen-gazetteer.mjs` rebuilds
it.*

**The temporal line.** Under the place, in the badge's quietest type, a line
can say how long ago the picture was taken — **beside** the trip's name, never
instead of it: "AUSTRALIA" is what makes a post recognisable in a feed, and a
badge that traded it for "9 months ago" lost the one word the whole strategy
rests on. It is a set of choices rather than one: the
elapsed days, weeks, months, years-and-months, a plain "since 27 Mar 2025", or
the true anniversary. **Anniversary only ever fires on the actual anniversary** —
same month, same day — because a line that announces one on a day that is not
one is a lie the rest of the tool would not tell; on any other day the trip's
name comes back, and the panel says so. **Auto** picks the truest striking line
for the gap on the day it is read. The reference day is itself a field: set it
ahead and the line reads correctly on the day the post goes out, not on the day
you composed it.

**The camera credit.** Under the temporal line, quieter still, a piece can
credit what took the picture — body, lens, focal length, aperture, shutter,
ISO, read from the photograph's own EXIF at every render rather than typed or
stored. It is **off unless a piece asks for it**: a badge is a signature, and
one that grew a sixth line on its own would have changed every piece already
composed. The line is never invented — a picture that records nothing draws
nothing, and the panel says so beside the switch instead of showing a made-up
exposure. A fetched picture still gets it: a Winnow proxy is a re-encode with
no metadata, and the instance's own reading of the capture is merged under the
file's. Like every other piece it can be replaced with free text, which is how
a scan or a film frame gets credited at all.

**Every option shows what it would really say.** The counter modes and the
temporal modes are listed with the line they would draw *for the post in hand* —
"Day · 27 · of 310", "Kalbarri · 3 · of 4", "515 days ago" — or, when a mode has
nothing to count, the reason: "No stage covers 27 Mar 2025", "This piece tells a
single day — give it an end date to count a range". The old fixed examples were
invented values, and three of the four counter modes looked broken because
picking one changed nothing and said nothing.

**The day is measured, not guessed.** Everything the badge draws is a
subtraction from the day the piece is filed under, so the editor reads the
picture's own date — the camera's `DateTimeOriginal` where there is one, the
file's date otherwise, and it says which — and offers to file the piece under
it. A picture dated outside the trip is called out rather than counted: a photo
from another year will happily read "day 261 of 310", arithmetically correct and
about a day it has nothing to do with. The piece's day and its "through" date
are both editable fields, so a range is one input rather than a mode with
nothing behind it.

**Every word is yours.** The badge is written in English out of the box and
every word — the counter's, the units, the templates — is a field on the trip,
so writing the deck in French is a handful of inputs (there is a one-click
French button) rather than a language setting with two options. On top of that
any single piece — the trip name, the word, the numeral, the total, the place,
the camera — can be replaced with free text per post; clearing the field always gives the
computed value back.

**Each piece can depart from the trip's style**: its casing (as-is, UPPER,
lower), its ink, a panel behind it (fill, corner radius, outline) and an
entrance and exit drawn from the engine's own animation model — fade, slide,
scale, typewriter, wipe, with duration, easing and a stagger delay. The hook
has a **duration**, which is what an exit animation lands on; playing the piece
from the band under the preview shows the entrance land and the exit leave.

**A look you like becomes the starting point.** Trip settings (the ⚙ beside the
way back) → **New pieces** saves
the open piece's look (frame, opener, placement, shades, per-piece styling,
what it counts) for the next piece of that kind in the trip; what a piece says
about one day is never inherited. On the dev server only (`npm run dev`), a
**House style** section goes one step further and writes the whole trip's look
— words, title style, closing card, those saved looks, grade and car — to
`src/shared/roadtrip/house-style.json`. Commit that file and every *new* trip
starts from it, on the deployed site too; delete it (**Back to the factory
look**) and they start from the factory again. Existing trips and imported
backups never change. The name, dates, legs and pieces never travel, nor do the
pictures or stops an opener was given, nor an uploaded LUT (its whole `.cube`
would ride in the bundle; put it in `public/luts/` instead). The endpoint that
writes the file — the Studio's house style uses the same one — exists only
while `vite` serves, and refuses any request that does not come from the dev
server's own page.

**The picture is framed where you want it.** A 3:2 photograph in a 9:16 frame
loses its sides, and the subject is rarely in the middle: drag the picture on
the stage to move it, the wheel, a trackpad pinch or two fingers to zoom it
about the point you aim at, and a slider or
a quarter-turn button to rotate — straightening a horizon included — and two
buttons to **flip** it horizontally or vertically, which mirror what the frame
shows whatever the rotation. The badge keeps first claim on a press, so grab
the picture where no text sits. Under **Fill** (the default) it can never be
zoomed out past covering the frame or dragged off its edge, so a gap only
appears where you asked for one: **Whole** shows the entire picture with
**black bars** where it falls short of the frame, and a drag slides it along
them. The preview, the PNG deck and the burned-in hook clip all draw through
the same transform. Each picture of a carousel is framed on its own.

**A slide can hold several pictures.** The Picture tab's **Layout** section
offers grids, stacks, bentos, insets and scattered prints; the slide's own
picture is always the first cell, and the others are filled from the Library,
which follows whichever cell is selected. Click a cell on the stage to select
it, drag to reframe the picture inside it, the wheel or a pinch to zoom it about
the point under your hand, and hold
(or Alt-drag) onto another cell to swap the two. A picture can also be
**dragged straight onto a cell** — grab any row of the Library, or a tile of
the Winnow tab (it is fetched as it lands). As soon as a drag starts the stage
shows every cell it can go in; the cell under the pointer says whether the
picture will be placed there or replace the one it holds, a drop between two
cells is refused, and the cell confirms when the picture has landed (or says
why it could not). With no layout, a drop anywhere on the picture replaces the
slide's own. Dragging is a mouse gesture; on a phone, use the cell stepper. Every cell keeps its own
framing and develop; an empty cell shows the layout's background in the
export, and a smaller layout keeps the extra pictures rather than dropping
them. The Picture tab's **Motion** section lets the cells **arrive** (one
entrance for all of them, spread by an order — from the centre, row by row,
the biggest first, shuffled with a kept seed — optionally moving the picture
inside its cell rather than the cell) and **leave** against the slide's screen
time; a collage that moves is delivered as a video, one that does not as a
PNG.

**The badge can cascade.** Instead of a delay typed on each piece, the Look
tab's **Cascade** gives the whole badge one entrance and spreads it over the
pieces in an order — top to bottom, the numeral first, shuffled once with a
seed that is kept, so the export lands exactly as the preview did. Every
entrance and exit, on a badge piece or a Studio title, can now travel on more
curves: the four eases, their cubic and exponential cousins, **Back** and
**Spring** (which overshoot before they rest) and **Steps** (which moves in
jumps, like stop-motion).

**The picture can be helped.** A bright sky exactly where the hook sits is the
normal case, so up to four **shades** can be laid over it. One shade is a
direction, picked on a 3×3 grid whose cells show the gradient they draw — from
any of the four edges, a quarter circle from any of the four corners, or, in the
centre, a radial or a band across the middle either way — a reach, a strength
and **its own colour**, and it can be **inverted**: "from the top, reaching
halfway, inverted" is clear at the edge and darkest at mid-frame, which is what a
centred hook on a textured picture needs. *Follow badge* hands part of the shade
to the badge: **Edge** gives it the reach (a top or bottom shade lands on the
block's own edge, a radial centres on it), **Anchor** gives it the place as well
— a badge anchored bottom-left gets its shade in that corner, and takes it along
when it is re-anchored. They stack, so a wash from the left and a corner vignette
can be on at once.
Darkening the picture keeps the typography clean, which a panel behind every
line does not.

The badge is built out of the **same overlay engine the Studio uses**, not a
second rendering system: it is a stack of ordinary text elements, so it
inherits the title-style presets (Neutral, Or ciné, Pixel CRT, Rouge plein
cadre) — through the very same style picker the Studio's Style tab uses — and
the preview is the export at a smaller size. The style and the words belong to
the **trip**, not to the post: a badge that varies per post stops being the
signature that makes a post recognisable in a feed.

**The opener.** The badge is one way to open a piece; the Look tab's first
section picks another from cards — a card you cannot feed (a route with no
located place) is greyed with the reason, never hidden. **Badge** is the plain
one. **Défilé** runs the trip past before landing on the day: a measuring tape
of the whole trip sweeps to the day you are telling, decelerating like a
mechanism coming to rest; every stop flashes a real picture as the head lands on
it, a day nobody told goes dark, and the badge's numeral steps with the head. The
stops are either the days other pieces tell — each flashing the photo that piece
is made from, never its finished hook — or **pictures you pick**: choose a span
(the trip so far, this leg, the last week, or any two dates), see every photo shot
in it from the Library and, when one is connected, your Winnow, all of them
ticked, and untick what does not belong — or add pictures straight from this
computer, which join the Library and stay in the grid whatever day they were
shot on. The sweep shows them in the order they
were shot, several on one day holding the head on that day while they change;
a picture from the instance is fetched only when the sweep draws it, cropped to
the frame and graded with the piece, and never lands in the Library. Its sweep is
yours to shape — five motions (settle, brake, even, wind up, glide), a hold before
it starts, where it starts and how many days it samples — and so is the tape: its
width, its colours, the ticks' height, opacity and spacing, a band behind it
for a bright picture, a fade at both ends, a bar, a dot or a needle for the
head. It **ticks** at every landing, a deeper tick where a leg of the trip
begins and a low seat on today, in a choice of voices (ratchet, woodblock,
typewriter, shutter) with a pitch, a drift along the sweep and a volume — the
same sound the export writes, heard live behind a speaker toggle that is off on
every visit. **Virée** puts a little car on the map: a paper map of
the trip so far (drawn here — no tiles, nothing fetched), the road as a curve
through its stops, and a cartoon Land Cruiser Prado, a miniature rendered in the
browser with its wheels turning, driving from stop to stop. The stops are the
legs' located places, arriving where this day's leg ends, or the **pictures
you pick** — each one shot with a position in its EXIF is a stop, in the order
they were shot, a run shot at one spot one stop. At a stop with pictures the car
halts and they pop as **prints** beside it, piled like a stack on the map, or
fill the frame, or take the paper's place behind the road while it halts; a
picture without a position rides with the stop before it, or with the end of
the leg its day belongs to, and anything that fits nowhere is counted in the
panel rather than guessed onto the map. The told days' pictures can ride along
too. When the car arrives the map fades away and leaves the piece's own picture
under the badge, or stays. Everything is yours: the road (curved or straight,
the way ahead dashed, faint or hidden, a trail behind the car, its colours and
width), the pictures (how they show, a beat per picture, whether the prints
stay, their size, a pause at every stop), the car (how big it is drawn and
how steeply the camera looks at it, per piece — the car itself is the trip's,
below), the map (paper or the picture itself, paper and ink colours, lines of
latitude and longitude, a vignette, where it sits and how big, dots, the stops'
names, a compass rose, a scale bar, the distance so far in km or miles counting
up as it drives), the motion (the time on the road, the five motions, a hold
first, a beat at the end, whether the camera fits the whole route or follows
the car at a zoom, the badge's place following the car), and the sound: a tick
at every stop on the same voices, deeper where a leg begins, the seat on
arrival, a shutter click as each print lands.

**The car is the trip's, and it has a garage.** One car per journey: every
Virée of a trip drives the same one, and it travels in the trip's backup. It is
a Toyota Land Cruiser Prado (the J120), and the garage dresses it — a colour
from the factory range or one of your own, a factory gloss or a matte coating
(Raptor black, the default), and the gear: a bull bar with two spot lights, a
roof basket carrying a solar panel on the left, an aluminium storage box and
three jerry cans across the rear (water, petrol, water), an awning bag along
the side, mud flaps, window visors, the spare on the tailgate, the door
mirrors — each a switch. The car turns on a turntable while you dress it (drag
to turn it, the arrow keys turn and tilt it; it stands still if your system
asks for less motion), drawn by the very renderer the map uses, so what the
garage shows is what the opener gets. The garage opens from the opener's own
panel («Configure the car…», with Cancel and Done) and lives in the trip's
settings as its Car section, where every switch writes at once. On a wide
screen both show the car beside its choices, which scroll on their own, so a
switch far down the list is seen on the car the moment it flips.

**Itinerary** is the one you compose yourself: pick the
stops on a map — click to drop one where you like, drag it to move it, take
one of the trip's own places with a click, or find it by name through the same
opt-in place lookup the legs use — and the pen travels them in order, bowing
from stop to stop, waiting at each for as long as you ask. There are no tiles
and no basemap: the picking map is the very projection the export draws, run
backwards, so what you point at is what goes out. Each stop can carry **one
picture**, and how they are shown is the point of it: **pinned** beside their
own dot as the pen lands (several on screen at once, on paper or bare, with a
stem down to the dot), on a **card** under the map captioned with the stop's
name, **filling the frame** behind the map with a dim so the line survives, or
laid out as a **strip** along the edge with the stops still ahead held back. A
stop that holds no picture draws nothing — never the one before it standing in
— and the panel says so before you export. The map is yours to place (top,
middle or bottom, kept left, centre or right, at a size, on a translucent
plate for a busy picture, over a chart's lat/lon grid if you want one) and to
dress: the line's width and its two colours, the stops still ahead dashed,
faint or hidden, the dots and their size, numbers on them, the names at the
ends, where the pen is, everywhere it has been or on every stop, a north
arrow, and the distance travelled in km or miles counting up with the pen —
the straight-line sum of what it has drawn, never a road distance. The pen can
be a dot or a little plane, the badge's caption can follow it from stop to
stop, and it ticks at each arrival on the same voices as Défilé. Every opener
runs on the same clock as the badge, in the preview and in the file.

*A **Route** opener used to draw the trip's own shape from the legs' located
places; the Itinerary replaced it, and a piece composed with one is converted
into an itinerary of those same places when the trip is next opened.*

**Nothing is keyed by a file name.** A post records the *day* it tells, never a
filename: exports get renamed and re-graded between tools, and a tracking system
built on names goes stale the first time you touch Capture One. A post does
point at a picture, but only as a hint for re-finding it — lose the file and the
post still holds its day and its badge. Trips live in their own IndexedDB
database and autosave as you edit; a refused write (private window, full disk)
is said out loud rather than swallowed. The two arrows at the top of the
overview and of the piece editor — and `⌘Z` / `⇧⌘Z` — step the whole trip back
and forward: a badge moved, a leg resized, a piece added or deleted, the look
you were trying out.

**A post is a deck.** The hook is slide one; add as many content pictures after
it as you like, each with its own optional caption, and close on the trip's
**call-to-action card** — headline, sentence, link and a **QR code**, edited
once in the trip's own settings and appended to every deck that asks for it. A
reel or a single photo is the same model with a deck of one, so a piece can be
re-cut into a carousel without being rebuilt. Export writes the whole deck as numbered PNGs into a
folder you pick (or downloads them one by one where the folder picker is not
available), named so a file listing is already in swipe order. The order is
yours, and so is the time: under the picture, at every width, the deck is **one
band** — every slide end to end on the piece's clock, a clip as wide as its cut
and a still as wide as the seconds its inspector gives it, slid under a needle
that never moves. Drag the band (or use the arrow keys on it) and the slide under
the needle is the one open; ▶ or `Space` plays **the whole piece**, slide after
slide, on the stage. `⋯` moves the open picture earlier or later, removes it, or
closes the piece on the call to action; `+` adds the active picture. Only the middle moves — a hook that opened third
and a call to action that came second would stop being either.

**A slide can be a video, and it plays on the stage.** Put a clip on the hook
or on any content slide and it plays when the piece reaches it; **Cut** on the
band opens the Studio's own trim bar in its place, looping the stretch while you
**cut what it delivers** — in and out handles that never cross, `I` / `O` to cut at the playhead, the
picture following whichever handle you drag. A **speed** menu (¼× to 4×) plays
the stretch faster or slower, on the stage and in the file alike: what you
watch is what goes out. The badge is timed by the clip — its entrance lands on
the first frame of the stretch and keeps its own pace whatever the speed — and
pauses settled on the in point, the composition view the band and the PNGs
show. The filmstrip in the Picture tab still chooses the in point by pointing
at the clip itself, and slides the whole stretch along it. A slide stores its
in point, its screen time and its speed; the stretch of the source is derived
from the three, so the bar, the band's length and the export can never
disagree. Exporting burns the badge (or the caption) into the clip through the
**same WebCodecs pipeline the Studio exports with** — cover-cropped into the
post's frame, the shades applied per frame, the clip's own audio copied through
untouched — and a re-timed clip therefore goes out **without its own sound**,
said in the plan before anything runs. The one exception to "never re-encoded"
is the one you ask for: a Défilé's ticks become the track of a photo, of a clip
recorded without sound (most drone footage) and of a re-timed clip, and are
**mixed into** a clip's own sound only when its "Mix in" switch is on — off,
the clip keeps its sound bit-for-bit and the export note says the ticks stayed
out. It reads MP4 and MOV (what the demuxer handles) and says so plainly for
anything else; the PNG export has no such limit.

The QR code is generated **on your machine** — a ~250-line encoder in
`shared/lib/qr.ts` rather than a call to a web service, because a card that
fetched its own QR would be the one place the suite phoned home. Byte mode,
error-correction level M, versions 1 to 10 (213 characters); a link that does
not fit is refused with a reason rather than drawn as a code that scans to half
a URL.

**Develop: a picture's own correction.** On the Picture tab, one settled row
says what has been done to the open slide's picture — `As shot`, or
`+0.7 EV · highlights −40 · vibrance +15` — and **Develop…** opens a sheet
over it: exposure (in stops), brightness, contrast, highlights, shadows,
whites, blacks, temperature, tint, saturation and vibrance, with the trip's
look underneath so a correction and a grade are set in one place. The picture
on the sheet is exactly what the piece will deliver — the correction, then the
look, then the output transform — and a drag across it wipes to the untouched
frame (hold the corner chip to see it whole). The correction bakes into the
same single LUT the grade already goes through, so the stage, the slide rail,
the PNG deck and the hook clip all pick it up with nothing else to do. It
belongs to **that slide**, like its framing: it is never inherited by the next
picture, and ↺ puts it back to as shot. Every luminance move keeps hue and
keeps a grey grey; only temperature and tint tint. On a JPEG or a Winnow proxy
the sheet says so — an 8-bit picture has nothing above white to give back;
developing a RAW is what the next phases are for (`docs/photo-develop.md`).

**The same light on many pictures.** The sheet's header has **Copy** and
**Paste** — one set of numbers kept for the session, never stored, and the
same clipboard the Studio's sheet reads, so a correction crosses the two tools
in two clicks. **Presets** are your own book, the same list in every Develop
sheet (Trips and the Studio): `Save current as…` keeps the numbers under a name
of your choosing (there is no factory set), a chip writes a copy of them onto
the open picture, and × removes the preset without touching any picture it was
applied to — a preset is applied, never followed. The book is kept in this
browser, or on a connected Winnow if you pick it there, and then follows you to
another device; a change made on two devices is merged by name, never asked
about. The presets a trip kept before the book existed are brought in once.
**Apply to…** offers what is worth a batch:
*the other slides of this piece* and *the other pictures of this day*, each
verb naming its count; a click writes the same numbers onto each of those
pictures as its own copy, right away, while **Done** still writes the picture
in hand. A whole trip is deliberately not offered: a day is the largest set one
light is likely to hold.

**The Studio and Trips are joined up.** A piece can link the Studio project
its clip is graded in — pick an existing one or create it from the piece — and
the badge is then **sent into that project as an intro scene**. One export from
the Studio carries the grade, the telemetry overlay and the day badge, so there
is nothing left to join afterwards on a phone. Sending is explicit and
repeatable: everything the bridge writes is named `roadtrip:…` and lives in one
scene, so a second send replaces the first and never touches the grade, the
trim, the telemetry elements or your own intro. The one thing that does not
cross over is the shades — a Studio scene has a flat scrim rather than a
gradient, so the strongest shade's colour and strength go over as that veil and
the *shape* stays here, which the panel says out loud. When the piece **closes
with the trip's call to action**, the send also writes that card into the
project's **outro** — the same closing card the carousel export appends as its
last slide, appended here after the footage of the reel — under the same
rules: a resend replaces it, unlinking removes it, and an outro you composed
yourself in the Studio is never overwritten (the panel tells you the card
stayed behind instead).

Currently in place: the trip, its days and stages, the grid, day-keyed posts,
the badge — words, temporal line, per-piece styling, animation and picture
treatments — the deck through to its PNGs, clips that play, trim and re-time
on any slide and leave as video, the located places a stage went through, and
the bridge into the Studio.
A portable `.json` export of a trip is the phase that follows.

## Develop tool

The third editor, for photographs you mean to **develop** rather than compose.
It opens on your **rolls** — cards grouped by where each is kept, with the
first pictures as a cover and how many are developed — and a roll is a set of
pictures, each keeping its own develop, plus a **look** for the whole roll that
dresses every picture after its own correction.

**Making a roll.** *New roll* asks for a name, where to keep it when a Winnow
can keep rolls too, and whether to start with the photos ticked in the Library
(a folder, or a day on your instance). Inside a roll, **Add** brings pictures in two ways: *A day
on …* opens one day of your Winnow — photographs only, everything the roll
does not have yet ticked, what it has already marked — and adds references
without downloading anything; *N ticked in the Library* adds the photos
ticked there, counting only those the roll does not hold yet. With one way
available it is a single button, and it is gone when there is nothing to add. A roll holds a
*reference* to each picture — its name, size and content hash — never a copy of
the file. A picture that came from your Winnow comes back by itself when the
roll is opened, even after a reload and without passing through the Library:
the picture you open is fetched from the instance, then its two neighbours on
each side, and the filmstrip shows the instance's thumbnails meanwhile. It is
only ever asked of an instance you connected, and the roll says so when it is
not signed in (*Sign in*, *Try again*), when the instance no longer has a
picture, or when a picture lives on an instance this browser is not connected
to. A picture from your own disk is found again from the folder it came from:
*Add › A folder on this computer…* remembers the folder for that roll, so the
next visit reads it by itself where the browser still allows it, or after one
click on **Reopen** — and dropping photographs or a folder anywhere on the roll
finds the ones it already holds and adds the others. (Remembering a folder
needs Chrome or Edge; elsewhere a pick or a drop lasts the session.)

**Developing.** A roll opens in its editor: the picture large, the roll as a
filmstrip under it, and beside it the same controls as the Develop sheet in
Trips and the Studio — the histogram, the sliders, your presets, the
before/after wipe and zoom, and the picture's **look** (LUTs, output
transform, grain), applied after its correction. Every setting belongs to the
picture it was made on — the develop, the look, the crop, the masks — so the
next picture keeps its own; **Apply look to N other pictures** (or to the
marked ones) is how one look dresses several. There is no Done: what you set is saved on
the roll as you go. **←/→** move along the strip, **\\** held shows the picture
as shot, **Z** goes closer and back, **⌘C / ⌘V** copy a develop from one
picture to the next, and **Apply to N other pictures** writes it onto the rest
of the roll, each as its own copy. **Shift-click** marks a range of the strip
and **⌘/Ctrl-click** one picture, and the batch verbs then read the marks —
*Apply to N selected*, *Paste to N selected*. For more than the develop,
**⌘⇧C** (or the ⚙ glyph above the picture) opens the picture's settings as
**sections** — develop, look, crop, border, perspective, lens, detail, repair,
layers — ticked like Lightroom's Copy Settings: **Copy** holds them, **⌘⇧V**
pastes them onto the picture on screen, and *Apply to N selected / N other
pictures* writes them across the roll; **Reset** puts the ticked sections of
the picture on screen back to as shot — its look and its layers included —
one ⌘Z away. A **preset** saved here can carry the picture's look too (tick
*+ look* when naming it): the chip then dresses a picture in both. In the
Trips and Studio sheets, where a look lives elsewhere, the same chip applies
the numbers alone and says so. The develop, the look, the lens and the
detail are ticked to start — what a roll shot with one body shares — and the
ticks are remembered. A picture's file, its RAW base, its title and caption and
whether it leaves are never carried. A filmstrip cell shows the
picture as it was last seen in the editor — developed and cropped — and a dot
marks what is developed. On a phone the picture and the strip share the
screen and the three tabs open from the bottom bar.

**Layers.** The **Layers** tab (**L**) adds a develop that applies only
somewhere: a *linear* or *radial* gradient, a band of *brightness*, a mask
*painted* by hand, a *subject* found by a model from a point you tap, or the
*whole picture*. Every Develop slider works inside a layer, and layers add up
from the bottom of the list to the top. A new Subject layer starts with
**Pick** on (**P**): tap the thing you mean and the model finds it at once —
a ring turns while it thinks, then what the tap added blinks twice — tap
again to add to it, tap a marker to take it off. While you pick or paint, the
mask shows by itself as its **outline**; **M** steps it to a red **fill** and
to hidden, and the box under it keeps it shown once Pick is off. Any layer
can take a subject **out** of itself (*Except › The subject*): darken the
whole picture except the person, and the person's own layer alone decides
them. The model (17 MB) is served from this site and loads the first time a
subject is asked for; an export segments the same points on the picture it
delivers.

**Cropping.** The **Crop** tab (**C**; **A** goes back to Adjust) shows the
whole developed picture, still, with the part you keep drawn over it and the
rest darkened. Drag inside the zone to move it, on the picture to draw a new
one, or one of its eight handles to move that edge or corner — the opposite
one stays where it was. A **format** holds its shape (*Free*, the picture's
*Original*, or one of the suite's aspects; **X** swaps portrait and
landscape, Shift holds the shape in Free); a double-click takes the largest
zone of it, and the arrow keys nudge the zone once the stage has been touched.
**Straighten** turns the picture *under* the zone, which shrinks just enough
to keep clear of the corners and grows back to what you drew when you
straighten back; **Level** corrects the angle from a line you draw along the
horizon. The quarter turns take the zone with the picture, and the two flips
mirror what the frame shows. A pinch, the wheel or the ± pill looks closer at
the picture without touching the crop. The crop belongs to the picture, is
saved as you go, and is never inherited by the next one.

**Crop to the view.** Zoomed in on the Adjust stage, a small **crop** pill
appears in its top-right corner (or **⇧C**, or *Crop to this view* in the %
menu): what the screen shows becomes the crop, the view goes back to the fit,
and the picture on screen does not move — so the part you were studying never
has to be found again on the Crop tab. It keeps the angle and the flips
already set, leaves a border out, is one undo, and a view closer than a crop
may go (8×) is grown to the smallest crop about where you were looking.

**Borders.** Under the crop, **Borders** puts a canvas round it: a **file**
format the bars reach (*Free* is the crop plus its margins; 4:5, 9:16, 1:1… for
a post), a **fill** — black, white, paper, vermilion, any colour, or **Blur**,
the picture itself softened behind it, made on your machine — and two
**margins**, left·right and top·bottom, as a share of the crop's short side so
they look the same at any size (linked unless you unlink them). A small
preview above it shows the file exactly as the export will write it, with its
size. **Apply crop to…** and **Apply borders to…** are separate: one border
can go on a whole roll whose crops each differ.

**Repairing.** The **Detail** tab (**D**) starts with **Repair**: a patch
replaces a disc of the picture with another disc's pixels, feathered at its
edge — **Heal** matches the borrowed texture to the spot's own surroundings,
**Clone** copies it as it is. With Repair on, a tap places a patch that
borrows from beside itself; a drag from the spot points at where to borrow
from, at any distance, the source turning round the spot as your hand does.
Every ring on the picture stays alive afterwards: drag a solid ring to move
its patch and **click it to take the patch off** (the cursor shows a −), drag
its dashed ring to change where it borrows from and click that one to edit
the patch — **Size**, **Feather** and Heal / Clone then apply to it, and
**⌫** takes it off too. **Find spots** looks over the picture for the marks a
sensor leaves: it draws the photograph as a **map** of what falls below its
surroundings, where a mark a screen hides at the fit reads as a bright disc,
and *proposes* the small round ones as dotted rings at the **sensitivity** you
set — a texture, a wire or the corner of a roof is left alone. Tap a proposed
ring to heal it, or **Heal all**; a proposal is never a patch until you take
it. Patches are numbers on the roll, never pixels: they follow the crop, the
thumbnail and the full-size export. Under Repair, the same tab holds
**Noise**, **Fringing** and **Sharpen**, judged honestly under the loupe.

**Which file.** A chip above the photograph says what it is developed from
(`JPEG · 8-bit`, `RAW · camera render · 960 × 540`…) and opens the list of the
capture's files: the proxy your Winnow made, what the camera delivered — its
JPEG, or the render written inside a RAW — and the sensor itself, with its
calibration rungs nested under it (*Gain*, *Gain map*, *Gain map + warp*,
each an amount of the camera's own calibration read from the DNG, offered
only where the file carries it). A file that is not here is fetched from its
instance and held for the session, its weight said before the click; a DNG
beside a JPEG in a folder is the sensor with no fetch at all. The choice is
saved on the picture, so another device shows the same one, and the export
follows it. **On a phone or a tablet** the sensor is decoded to what the
device can hold — 2560 px on the stage, 4096 px in an export, and the export
says when a picture left under its sensor's pixels — the decoder is let go
between pictures, and a picture you come back to is not decoded twice; the
loupe, which decodes the file whole on a computer, says *as close as this
device goes* instead. A browser cannot ask a phone how much memory a tab may
take, so the rule is coarse: iPhone, iPad and Android count as phones, and
`localStorage['atelier.device']` (`constrained` or `roomy`) overrides it.

**Which pictures leave.** Every picture says whether it leaves: by default the
ones you **edited** do, and you decide otherwise per picture — send one you did
not touch, hold back one you did. The **Pictures** table in the Export tab
lists the roll one row per picture (the whole row is the click, with what the
picture would leave from and at what size), filtered by *Edited*, *Leaving* or
*Held*; the badge at the corner of each filmstrip cell does the same without
leaving the photograph. **P** sends or holds the picture on the stage, **U**
puts it back on the rule (on the Layers tab, **P** and **M** belong to the
mask instead — Pick and the mask's view). A picture you do not want to work on at all can be
**ignored** (**M**, or a right-click / a held finger on its badge): it never
leaves, **←/→** step over it, "apply to the other pictures" leaves it alone,
the strip dims it or hides it, and a click still opens it. None of this is a
rating — culling stays Winnow's. Once a picture has been exported, its row
says when (`✓ 14:32`), and says **changed** if you edited it since — its
develop, look, crop, geometry, repairs, layers or words; a new export size or
quality does not count. The *Changed* filter lists the pictures that leave and
were never exported or changed since, the status line counts them, and
**Export N new or changed** delivers just those. The record is kept on this
device beside the roll, not in it, so an export is never an undo step and an
undo never forgets one.

**What a file says.** A delivered JPEG carries the original's EXIF (below), and
the **Metadata** section of the Export tab adds what is yours. Every file is
**signed** — `Software` in its EXIF and `xmp:CreatorTool` in its XMP say
*Atelier*, even a picture nothing else is known about; it is also how the suite
recognises its own exports beside the originals, so it is not a switch. Give a
**creator** once and every file carries it as `Artist` / `dc:creator`, with a
**copyright** line (`© {year} {creator}. All rights reserved.` by default,
`{year}` being the year the picture was TAKEN) as `Copyright` / `dc:rights`,
over whatever the camera wrote. Both are kept with your presets, so another
device signs the same way; nothing is written until a name is given. Each
picture also takes its own **title** and **caption** there (`dc:title`,
`dc:description`, and the caption as EXIF `ImageDescription`, which Lightroom
and Capture One show as the caption) — the picture's alone, carried by no
preset, paste or "apply to". **What leaves** is chosen for the whole roll, in
groups — camera and lens, exposure, capture time, GPS position, maker notes and
serials, title and caption, creator and copyright, and a **place name** — with
three presets: *All* (the default, GPS included), *Share online* (no position,
no serials, the town kept) and *Minimal* (your rights and the signature
alone). The place is the town and country the picture's own GPS falls in,
named from the same offline city index as a trip's legs (below) — nothing is
sent anywhere — written as XMP `photoshop:City` / `photoshop:Country` even when
the position itself stays home; a town is named within 30 km, farther out only
the country, and the run says which pictures got no town. While every group of the
capture is kept the camera's EXIF block is copied whole; leaving one out
rebuilds it from the fields Atelier reads, and the panel says the maker notes
stay behind. The file holds ONE XMP packet — an Ultra HDR export folds these
into its own — and says its colour space: every export carries a small sRGB
ICC profile, so a colour-managed reader (Lightroom, a print lab, a wide-gamut
screen) reads the colours as they were meant instead of guessing.

**Exporting.** The **Export** tab writes JPEGs — this picture, the marked
ones, or every picture that leaves — into a folder you choose (downloaded one
by one where the browser has no folder picker). Each is decoded at its own size,
developed under its own look and cropped as the stage showed it — a crop
leaves at the picture's own density, so a small zone makes a small file, never
one blown up to fill its aspect; the **Size** is a ceiling on the long edge and
never upscales. Each picture leaves from the file you chose above the
photograph — its RAW when you developed it on the sensor, the camera's own
JPEG when you picked it, else where it opened, and there the full-size
original is fetched only where the proxy could not fill the frame asked for.
The panel says the whole run before a byte moves (`4 pictures · 1 from the
sensor · 1 from the file chosen · 69 MB to fetch`, one line per picture behind
*picture by picture*), and a *Delivers* line says, for the picture in hand,
exactly what will be written (`Proxy 2000 px → 1080 · ×1.85 to spare`,
`DJI_0101.JPG 6048 px → 1920 · ×3.15 to spare`). One switch, **Proxies only,
for this run**, delivers everything from what is already here — a RAW base is
set aside and the run says so — and is never remembered on the roll. A RAW
original is reached only through the render inside it, measured first. Fetched
originals are kept for the session only, up to a ceiling sized from your
device (a quarter of its memory, between 256 MB and 1 GB; 192 MB on a phone
or a tablet); past it the ones you used least recently are let go and fetched
again when a picture needs them.
After a run whose
pictures came from an instance, **Send N files to …** uploads them home into
that Winnow's finals, each linked to its own capture — the same panel the
Studio uses, and the same rule: only what you just rendered, only to the
instance it came from, never automatically.

**From a picture.** Under any picture you are looking at large — in the
Library's preview sheet, or a day on your Winnow — a **Develop** button adds
it to the open roll and opens it there (a picture already on the roll is
opened, never added twice); from the rolls gallery the same button starts a
new roll from it. That sheet also shows the capture's other files as chips —
*Proxy*, the camera's JPEG, the render inside its DNG or ARW — fetched only
when you click one and kept for the session; looking writes nothing, and
pressing **Develop** while one is on screen opens the roll on that file.

**Keeping it.** A roll saves as you go — with the same undo and redo as the
Studio and Trips, over the whole roll — and one kept on a Winnow saves there
after a few seconds of quiet, with the same status pill as a trip; the gallery
moves, deletes and exports it (`.roll.json`, a backup — importing always makes a
new roll). Thumbnails are baked here from the Library's files and never leave
the browser.

**Working previews.** A roll with pictures from your own disk can keep a
**working preview** of each — a 2048 px copy, stored in this browser only —
so it opens and can be developed and cropped while the files themselves are
away (on a phone, where a folder cannot be remembered, it is the only way).
It is off until you ask for it on that roll (*Keep them*, with the weight said
first), the strip and the chip say when a picture is shown from its preview,
an export made from one says so, and *Stop keeping them* deletes them.
Pictures from your Winnow never get one: the instance is where they live.

## Telemetry tool

When a DJI drone records, the memory card holds both the video (`.mp4`) and a
same-named `.srt` file. That `.srt` is **not** subtitle text — it's per-frame
flight telemetry (altitude, GPS, camera settings) encoded in the SubRip format.
The tool plays the video and shows the telemetry for the currently displayed
frame, synchronized frame-by-frame.

The `.srt` records *where* the aircraft was, not how fast it was moving, so the
tool reconstructs the missing motion from successive GPS fixes: **ground speed**
(horizontal), **vertical speed** (climb/descent) and **heading** (course over
ground, with a compass point). These appear alongside the raw fields in the
Flight panel and the live gallery readout, and can be burned in with the
Telemetry Overlay tool. Those rates are computed per second of *capture*, not
per second of file, so a slow-motion or time-lapse clip reads true — see
"Slow motion and time-lapse" above.

### Usage

1. Open the app (the Telemetry tool is the default).
2. Give it your footage — two ways in, your choice:
   - **Just the files**: a single `.mp4` and its `.srt`. Click the drop zone (or
     "Choose files") and select them.
   - **A whole folder** from your DJI memory card ("choose a folder").
   - Or **drag** either onto the drop zone. Videos are paired with their `.srt`
     siblings automatically.
3. Browse the gallery — each card plays its video inline **with its telemetry
   running live**: an altitude badge on the frame plus a readout (altitude, GPS,
   exposure) that follows playback. No click required to see the data.
4. Click **"Open full view"** on a card for the dedicated single-clip page: the
   large video plus the full Flight and Camera panels, synced to the displayed
   frame.

### Completing incomplete pairs

Loose files are welcome too — a `.mp4` with no `.srt`, or an `.srt` with no
video. Both appear in the gallery:

- A video with no telemetry shows an **"Add telemetry"** action.
- A telemetry file with no video shows an **"Add video"** action (its readout is
  already visible — the `.srt` is readable on its own).

The same actions appear in the full view. When you manually attach a file whose
name doesn't match the card (e.g. you pick `DJI_0099.SRT` for a `DJI_0001`
video), it is **attached anyway** — no friction — but a small, reversible
"names don't match" warning appears so an honest mistake doesn't go unnoticed.
Click **Remove** to undo.

### Choosing files — access paths

All converge on the same client-side pipeline; nothing is ever uploaded.

| Path | When | Browser support |
| --- | --- | --- |
| Individual file picker (`<input multiple>`) | one clip + its `.srt` | all |
| Native directory picker (`showDirectoryPicker`) | a folder, preferred | Chromium |
| `<input webkitdirectory>` folder dialog | a folder, fallback | Firefox, Safari, all |
| Drag-and-drop a folder or files | UX convenience | all |

Listing a folder is **instant even for dozens of multi-GB videos**: a `File` is
a lazy reference to the file on disk, so no video bytes are read just to list
them. The small `.srt` text files are read lazily (per card, as it scrolls into
view) to build the telemetry summary.

## LUT Studio tool

Add a collection of clips, pick a `.cube` look, and preview the grade in real
time on a WebGL canvas — with a Lightroom/Capture One-style before/after wipe.
Batch-export graded copies (H.264 via WebCodecs). The built-in LUTs live in
`public/luts/` and are discovered at build time, grouped by sub-folder
(apple/dji/sony/classic). See [`public/luts/README.md`](./public/luts/README.md)
to add your own — just drop a `.cube` in, no code to edit.

### Choosing a look

Every panel that grades — the Studio's Grade tab, a Trips piece, the Develop
workbench — offers the same two ways in: a native list grouped by family, and
a **gallery** that shows each look *on a photograph* before you pick it, since
reading a name off a dropdown tells you nothing about a LUT.

**Where the tool has your picture open, the gallery shows it.** A band across
the top draws the look you are aiming at on *that* photograph, with a compare
toggle that wipes it against the original — before on the left, after on the
right, the way Lightroom and Capture One put it. So the gesture there is aim,
then take: the first click moves the band, and the look is yours on the second
click, on "Use this look", or on Enter. Where no picture is open there is
nothing to aim at and a click is the choice, as it always was.

It costs one lattice — the look under your eye — and that is the point: the
grid keeps its cheap pre-baked tiles, which is also what makes two looks
comparable, since every tile is the same subject. The band shows the look
*alone*, without the correction you have set on the picture. And it says the
one thing only your own photograph can reveal: aim a conversion look at a
picture that is not log footage and it tells you so, rather than leaving you
to read the over-contrast as a broken look.

The tiles are baked once, ahead of time, and shipped — so opening the gallery
fetches and parses no `.cube` at all. Each look is shown on the reference its
kind asks for: a **conversion look** (D-Log, S-Log3, Apple Log…) on a log
frame, because a conversion LUT read on an ordinary picture comes out
over-contrasted and looks broken through no fault of its own; everything else
on an ordinary photograph. Both references are in `public/reference/`. If you
want *every tile* on your own picture too — not just the band above them —
"Tiles on my picture too" or "Preview on a photo…" puts them all on a live
bake. That one is offered rather than assumed, because it reads a lattice per
look and the band already answers the usual question for one.

A **★** in a tile's corner builds a Favourites row at the top of the rail, and
the same shortlist becomes the first group of "Add a look". It is kept in this
browser, never in a trip or a project file — your shortlist is yours and does
not travel with a document you share.

### Your own looks — the vault

A `.cube` you bought or made goes into a **vault**: a private library this
browser keeps in IndexedDB, holding each look's lattice as compact binary
rather than text.

- **"Upload .cube…"** puts a single look there, under *My looks*.
- **"Packs…"** in the gallery imports a whole purchased **pack** — pick its
  folder and Atelier reads the author's own tree (category, camera), cleans
  the names, lets you rename and hide what you do not shoot, and bakes each
  look's thumbnail once. The pack appears in the rail under its own name, with
  the author and where it came from behind an ⓘ.

Two things about this are deliberate, and both are about *keeping the looks
yours*:

- **A document stores a reference, never a lattice.** A trip, project or roll
  that uses one of your looks records which look it is — about a hundred bytes
  — and the lattice stays in the vault. So a `.roadtrip.json` you send someone
  does not carry the looks you paid for, and a trip does not grow by several
  megabytes per look. Graded exports are unaffected: the picture you deliver is
  the whole point of a licence.
- **Nothing of a pack is ever published.** Its files are not in this
  repository, not in the deployed site, and not in anything you export. A look
  is never resampled either — 65³ stays 65³, exactly as its author made it.

If you have connected a Winnow, a pack can be **kept on it** so your other
devices have it too: the small index goes into your document bucket, the
lattices into your own file store, and a device downloads a look the first
time a picture actually asks for it — then never again. A device that does not
hold a look says so on the layer, in its place, rather than quietly grading
the picture as if no look had been chosen.

**What it all weighs, and dropping what you will never use.** A pack of 65³
looks is about 1.6 MB apiece — forty-odd megabytes for twenty-five, most of
them for cameras you may not own. So "Packs…" says what every row costs: the
vault's total, each pack's, each category's and each look's, measured in this
browser and worked out for the instance the pack is kept on. Beside that,
there are two different verbs and the difference matters:

- **unticking** a category or a look puts it away. It leaves the pickers, its
  bytes stay, and a grade already wearing it still renders.
- **forgetting** a look (the bin at the end of its row) gives the bytes back,
  here and on the instance. A grade wearing it then says the look is gone,
  the way it does for a look this device never had; importing the folder again
  brings it back. A look whose lattice another look also uses is dropped from
  the pack without freeing anything, and the screen says so rather than
  claiming a megabyte came back.

### Sources — connecting a Winnow

The library's files usually come from a folder on this machine. They can also
come from a **[Winnow](https://github.com/CostardRouge/winnow)** instance — the
maintainer's self-hosted triage app, which indexes every capture on a NAS,
builds a proxy for each one and knows a DJI clip's `.srt` flight log as a
sidecar. Open `#/connect`, or the "or connect a Winnow" link under the drop
zone, confirm the instance's address, and it becomes a source with **its own
tab in the Library**, beside `Local` — the two never mix. The instance's tab
is a *view*, not a pile: it lists what the instance holds for **the day the
active tool has open** (a trip piece's day, or the day selected in the
trip overview; a date field when nothing is open), and re-asks when that day
changes, so nothing accumulates and nothing needs clearing. One click on a
tile fetches that picture into the library as an ordinary file — the
**proxy** (an H.264 clip or a WebP photo, fast and decodable everywhere) — and
makes it the active one; a tile already fetched is marked and only
re-activates. "Browse all" opens the full browser — by day or by folder, with
filters — to tick many at once, or to take the **original** instead, with its
weight shown first. A DJI clip brings its flight log along either way.

When the Winnow serves its **timeline** (media grouped into legs by place and
date), the browser gains a third way in, **by leg**, and a trip can be seeded
from it: the legs become the trip's stages — span, places, order — and nothing
else; no post is created, so the grid of days still to tell stays yours. Re-run
it later and it proposes what the timeline gained, renamed or lost, one tick
per leg, never a sync. A Winnow can link straight into either screen
(`#/roadtrip/new?source=<host>`); the link is a proposal you confirm.

After a Studio export of a clip or photo that came from a Winnow, one button
**sends the finals back** to that instance — the files you just rendered, into
its finals root, linked to the capture they were cut from — so its lineage
records that the capture has been told. It says what will leave and how heavy
it is, refuses before a byte moves when the account is read-only or a file is
over the instance's upload limit, and is never automatic.

A connected Winnow that declares a **document bucket** can also *keep a Road
Trip or a Studio project* — the other thing Atelier writes to a server, beside
the finals. Pick "Keep on
winnow.example" when creating or importing a trip and it saves there as you
edit: locally at once, to the instance after a few seconds of quiet, when the
tab hides, when you leave the trip, or on "Save now". Open the trip gallery on
another device signed in to the same Winnow and the trip is there; opening it
pulls the latest copy. A status pill always says where the trip stands —
saved, saving, offline and kept here, sign in to keep saving, or refused
because another device changed it since (then you choose: keep mine, or take
theirs). The trip document holds place names, dates and the text of your
badges, and only your own account can read it back; the hook thumbnails never
travel and are re-drawn locally. A trip can be moved between this browser and
an instance from its card; the `.roadtrip.json` file remains the offline way
to cross. A Studio project kept on an instance works the same way from the
project gallery and the project bar; its media folder never travels — only
the list of clips does, so on another device the project opens and asks you
to point it at the footage.

A connected Winnow can also **keep your LUT vault** (see "Your own looks"
under LUT Studio), which is the third thing Atelier writes to a server: a
pack's index into the same document bucket, its lattices into your own file
store, keyed by the file's hash so a look is stored once and never
re-uploaded. A device fetches a look the first time a picture asks for it and
caches it, which is what lets a phone grade offline afterwards.

Plainly, what this changes about the promise above: Atelier holds no account
and talks only to a server you named yourself, signed in with that server's own
session — nothing runs at boot, and no credential is stored here. It **fetches**
from it; **uploads to it** only on that one button, only what you just
rendered; and, if you ask it to, **keeps a document** — a trip, a project, a
LUT pack — on it, under your account there. Your media never leaves machines
you own, and neither do the looks you paid for. It works when Atelier
and the Winnow share a site (e.g. `atelier.example` and `winnow.example`) and
the Winnow lists Atelier's origin in its `CORS_ALLOWED_ORIGINS`; a foreign
instance would need a credential of its own, which is not built. The timeline
and the write-back are built against Winnow's forthcoming API and will be
re-checked when it lands; the trip bucket is the patch under
`docs/winnow-patches/` until it does.

### Online

Deployed via GitHub Pages at [`atelier.steeve.website`](https://atelier.steeve.website/).

> Base path: `vite.config.ts` derives the Pages base path from the repository
> name (via `GITHUB_REPOSITORY` in CI, falling back to `atelier` locally), so a
> repo rename can't 404 the assets. The deploy workflow overrides it with
> `BASE_PATH=/` because the custom domain serves the site from the root — the
> domain itself lives in the repository's Pages settings, not in a `CNAME` file.

### Icons and the home screen

Add Atelier to a phone's home screen and you get the mark — the ink frame with
its vermilion dot — not a screenshot of whatever page you were on. That takes a
real PNG: iOS reads `apple-touch-icon` and nothing else, in Safari and in
Chrome for iOS alike, since both are WebKit. Android's launcher reads the
manifest's 192/512 pair, plus a maskable pair so its own shape mask never clips
the drawing.

The three SVG sources live in `public/icons/` (rounded tile, full-bleed Apple
square, inverted maskable); `node scripts/gen-icons.mjs` rasterises the seven
PNGs beside them, and the output is committed — a static host cannot make them
on the fly. Change the mark in the sources, re-run it, commit both halves.
Tapping that icon opens Atelier **as its own app** — no address bar, and the
status bar takes the paper colour instead of staying system white
(`display: "standalone"` in the manifest, `apple-mobile-web-app-capable` and
the `default` status-bar style in `index.html`, since iOS reads no manifest for
this). The trade-off is worth knowing before you install it: **iOS gives a
home-screen app a storage container of its own**, so the trips and projects you
saved in Safari are not in it. Carry one over with a `.roadtrip.json` or
`.atelier.json` export, or keep it on a Winnow and sign in there. Android has
no such split — the installed app and the browser share one origin.

**A tool screen behaves like an app screen, not a web page.** The masthead and
the section bar at the bottom stay where they are, only the lists between them
scroll, and the page underneath cannot be dragged or bounced: the shell locks
the document (`data-shell="fixed"` on `<html>`) for as long as a tool is open
and hands the scroll back on Home and `#/sources`, which are reading pages. The
viewport is declared `viewport-fit=cover`, which is what lets the app pay for a
notch and a home indicator itself. Pinch-zoom is untouched.

### Local development

```bash
npm install
npm run dev        # start the dev server
npm test           # run the unit tests
npm run typecheck  # type-check without emitting
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Photo EXIF tool

The photo counterpart to Telemetry: select photos in the library and read their
embedded metadata — camera body, lens, the exposure triplet (shutter, aperture,
ISO), exposure bias, focal length, and GPS location (with a one-click
OpenStreetMap link, opened only when *you* click it). The gallery shows a
camera/exposure line per photo; the full view lays out Camera, Exposure, Image
and Location panels beside a large preview.

EXIF is read straight from the bytes by a small **dependency-free parser**
(`exif-parser.ts`): it walks the JPEG `APP1` segment, or — since DNG and most
camera RAW begin with a TIFF header — the TIFF IFDs directly, so **RAW files
report their settings even when the browser can't decode a preview**. Only the
first 256 KB of each file is read, lazily as a card scrolls into view, and every
offset is bounds-checked so a truncated read just drops the fields it can't
reach. The parser and the value formatters are pure and unit-tested, including a
hand-built TIFF fixture and the GPS DMS-to-decimal conversion.

## Flight Map tool

Plots a DJI clip's GPS track on a map and moves a marker along it as the video
plays or scrubs — the spatial counterpart to the Telemetry tool, reading the
**same parsed cues**. The marker is driven by the very same `useActiveCue` hook
the Telemetry panels use, so it stays frame-accurate.

The path always draws **offline**: MapLibre renders the track line on a plain
backdrop with no tiles, so nothing leaves the machine. A **"Load map
background"** toggle adds an OpenStreetMap raster layer on demand — one of the
suite's two optional network requests (the other is the place search in Trips),
surfaced explicitly because it reveals the viewed area to the tile server.

MapLibre is a heavier dependency, so it's **dynamically imported** (JS *and*
CSS): it stays out of the main bundle and downloads only when you open this
tool. The cue-to-track extraction (filtering null-island fixes, bounds, line
coordinates) is pure and unit-tested; the map glue lives in `use-flight-map.ts`.

## Composer tool

Brings the suite's pieces together: a DJI clip, its **flight map**, and a
**draggable telemetry readout**, composited into one framed video. Pick the
output **aspect** (16:9, 9:16, 1:1, 4:5) and **resolution**, a **layout** (video
and map side-by-side, stacked, or one inset over the other), per-pane
**object-fit** (cover/contain), and a **LUT** for the footage; drag the readout
anywhere; then **play/pause** to preview the whole assembly in real time.

The map can **fit the whole track** or **follow the aircraft** (centred, panning
with it as the clip plays), with a zoom-offset slider on top of the auto-fit.
The readout is fully configurable — which fields show, label prefixes, text and
background colour/opacity, corner radius, font and size — and can be toggled off.

It's a single `<canvas>` compositor: each frame draws the (LUT-graded) video and
the map's WebGL canvas into their computed panes, then the readout on top. The
map runs as a non-interactive MapLibre instance with `preserveDrawingBuffer` so
its canvas can be composited, and its marker is a GL layer (a DOM marker
wouldn't be captured). The pane/object-fit geometry (`compose-layout.ts`) and the
readout model (`overlay.ts`) are pure and unit-tested.

**MP4 export** reuses the shared WebCodecs pipeline (`exportProcessedVideo`) with
an `outputSize` set to the composition frame, and a processor that draws each
decoded frame's composite exactly as the preview does — the same
`compose-layout`, `draw-readout` and frame-grader. Since that per-frame draw is
synchronous, the map can't be re-rendered per frame: instead a full-resolution
export map is built once, framed to the whole track, rendered, and **snapshotted**;
each frame draws that snapshot and places the aircraft marker via `map.project()`.
Audio is copied through untouched. HEVC that the browser can't decode surfaces a
clear message (no seek fallback yet).

## Compare A/B tool

The LUT before/after wipe, generalised to **two different files**. Pick any two
photos or clips from the library and drag a divider across the stage — A on the
left, B on the right. Where the LUT wipe runs one source through a shader split,
this layers two media and clips the top one with a `clip-path` inset, so it
compares two distinct grades, two takes, or a retouch against its original.

When both sides are clips, a single transport drives them together: play/pause
and scrub seek both, and a light drift-correction keeps the follower locked to
the leader, so two exports of the same shot line up frame-for-frame. Only the
two compared files are ever decoded; nothing uploads. The wipe maths and the
A/B pair reconciliation (keeping a valid pair as the selection changes) are
pure and unit-tested.

## HEVC / H.265 footage

Recent DJI drones often record in **HEVC / H.265**, which not every browser
decodes natively (Chrome's support is inconsistent depending on the OS; Safari
handles it best). When a clip can't be decoded it shows as a black frame with a
**"playback unavailable"** placeholder, and any export that relies on decoding it
would fail.

**The fix is built in.** A **"Transcode to H.264"** button appears on every clip
the browser can't decode — in the gallery, LUT Studio and Telemetry Overlay. It
runs a real ffmpeg, compiled to WebAssembly, **entirely on your machine**
(nothing uploads) and rewrites the clip to H.264. Once it finishes, that clip
plays, grades and exports everywhere like any other. The ~31 MB ffmpeg core is
fetched once, on first use, from a CDN and then cached by the browser;
transcoding is CPU-bound and slower than real time, so it's opt-in per clip.

Notes:

- **Telemetry never needed this** — the `.srt` is plain text, so the summary and
  the synced view work even before (or without) a transcode.
- The alternatives still apply: open the clip in Safari (the most reliable HEVC
  decoder), or transcode on the command line, e.g.
  `ffmpeg -i in.mp4 -c:v libx264 out.mp4`.
- A future native app (Tauri) will bundle ffmpeg for guaranteed decoding and
  real thumbnails without the in-browser download.

## Architecture

The suite is organised so that **`shared/` never imports `tools/`**: generic
building blocks know nothing about any specific tool, and each tool is
self-contained. Pure logic lives in `*/lib`-style modules — **dependency-free,
DOM-free** — so it's reusable as-is (Node, a worker, a future native app). The
**only** brick that changes for a native shell is `shared/sources/file-sources.ts`.

```
src/
├── app/                        # the shell + tool wiring
│   ├── App.tsx                 # masthead + active tool + footer, all from the registry
│   ├── tools.tsx               # the tool registry (nav + routes derive from it)
│   ├── ErrorBoundary.tsx       # a tool crash shows a recoverable panel, not a blank app
│   ├── Home.tsx · ToolSwitcher.tsx · AssetSidebar.tsx
│   ├── use-hash-route.ts       # minimal hash router (useSyncExternalStore)
│   └── site.ts                 # site-wide constants (repo URL)
├── shared/                     # generic, tool-agnostic — never imports tools/
│   ├── lib/                    # pure: format, cube-parser, use-in-viewport (+ tests)
│   ├── library/                # the shared asset library: group files into assets
│   │                           #   (incl. DJI video↔SRT pairing), capability-match per tool
│   ├── telemetry/              # SRT parser, motion, cadence, cue lookup, flight-path extraction
│   ├── exif/                   # dependency-free JPEG/TIFF EXIF reader, plus exif-cue:
│   │                           #   a photograph read as the one telemetry cue it is worth
│   ├── overlay/                # the overlay engine: element model, canvas stage,
│   │                           #   draw/measure/hit-test, fonts, guides, burn-in export,
│   │                           #   animation + scenes (the intro layer, pure), still-frame
│   │                           #   (a deck settled for a still), and the
│   │                           #   ElementList/ElementPanel/Timing/Scene/Guides editors
│   ├── lut/                    # WebGL2 LUT renderer, frame grader, picker, built-ins
│   ├── map/track-map.ts        # the one MapLibre track-map: style, line layer, OSM tiles
│   ├── media/                  # metadata, transcode, WebCodecs export, transport/object-URL
│   │                           #   hooks, export-path decision, download/naming,
│   │                           #   photo-frame (decode a still, render one variant of it)
│   ├── projects/               # studio project documents: types, media reconciliation,
│   │                           #   IndexedDB store (handles + thumbnails persist; media never)
│   │                           #   + project-file (the portable half as .atelier.json)
│   └── sources/                # file-sources (read, incl. persistable directory handles)
│                               #   + write-files (export to folder)
├── tools/
│   ├── studio/                 # the unified editor: project gallery + creation modal +
│   │                           #   autosaving editor (stage, tabbed inspector, export)
│   ├── telemetry/              # DJI flight-log viewer (the original tool)
│   │   └── TelemetryTool.tsx · DetailView.tsx · Gallery.tsx · VideoCard.tsx
│   ├── overlay/                # the Telemetry Overlay page (engine lives in shared/overlay)
│   ├── exif/                   # read photo EXIF (camera, lens, exposure, GPS)
│   │   ├── exif-format.ts      # pure value formatters (shutter, f-stop, GPS…)
│   │   ├── use-exif.ts         # lazily read + parse a file's leading bytes
│   │   └── ExifTool.tsx · Gallery.tsx · PhotoCard.tsx · DetailView.tsx
│   ├── compare/                # A/B before/after wipe over two media
│   │   ├── compare.ts          # pure: clamp, clip-path inset, pair reconcile
│   │   └── CompareTool.tsx     # layered stage + divider + synced transport
│   ├── map/                    # GPS flight path on a map (MapLibre)
│   │   ├── use-flight-map.ts   # lazily-imported MapLibre map + marker + tiles
│   │   └── MapTool.tsx         # clip switcher + map stage + synced video
│   ├── composer/               # video + map + telemetry → one composition
│   │   ├── compose-layout.ts   # pure: pane rects, object-fit, output size
│   │   ├── use-composer-map.ts # MapLibre map for compositing (GL marker)
│   │   └── ComposerTool.tsx    # canvas compositor + live preview
│   └── lut/                    # colour grading (generic, multi-device LUTs)
│       ├── LutStudio.tsx
│       ├── export-video.ts · batch-export.ts · clip.ts
│       └── use-lut-preview.ts
├── index.css
└── main.tsx
```

Adding a tool: create `src/tools/<tool>/<Tool>.tsx`, then add one entry to
`TOOLS` in `src/app/tools.tsx`. The nav, the route, and the optional full-height
frame all follow from that entry.

### Notable implementation details (Telemetry)

- **Parsing the double-bracket field.** Most fields are one bracket each
  (`[iso: 100]`), but altitude packs two pairs into one bracket
  (`[rel_alt: 35.200 abs_alt: 80.196]`). Rather than assume "one bracket = one
  field", the parser extracts the inner content of *all* brackets, joins it, and
  sweeps with a global `key: value` regex — handling both shapes uniformly.
  This is covered by an anti-regression test.
- **Reconstructed motion (speed & heading).** Raw telemetry has position but no
  velocity, so `motion.ts` differences each cue against the most recent one at
  least ~1 s older (a binary-search look-back), giving ground speed (haversine
  distance ÷ time), signed vertical speed, and a course-over-ground heading.
  The window matters: GPS only refreshes a few times a second, so differencing
  adjacent 60 fps frames would flicker `0 → 45 → 0`; the window spans several
  fixes for a stable readout. Heading is suppressed while hovering (movement
  below the GPS-noise floor), where "direction of travel" is meaningless. The
  cues of the opening window — the ones with no past to difference against —
  also carry the *same window measured forward*, kept in a separate field so it
  can fill a hole but never cover a real measurement (see "value from the
  start" above). Pure and unit-tested, so the same values feed the panels, the
  gallery and the overlay export.
- **Frame-accurate sync, shared once.** The `useActiveCue` hook uses
  `video.requestVideoFrameCallback()` and reads `metadata.mediaTime` (the exact
  presentation time of the displayed frame), falling back to the `timeupdate`
  event + `video.currentTime` on browsers that don't support it. Both the gallery
  cards and the detail player use this one hook — the live readout is identical
  everywhere.
- **Efficient cue lookup.** A 5-minute 60 fps clip is ~18 000 cues, so lookups
  use binary search (last cue with `start <= t`), never a linear scan.
- **No memory leaks.** Object URLs created for the video are revoked when the
  file changes or the component unmounts — never 50 URLs held open at once.
- **Lazy gallery, live telemetry.** Each card uses an `IntersectionObserver`;
  the video object URL, duration, and SRT parse only happen once the card scrolls
  into view.
- **Pairing is pure and tested.** `pairFiles` groups by base name
  case-insensitively and keeps any group that has a video *or* an SRT. Junk
  (`.LRF`, `.THM`, hidden files) is ignored.

### Other telemetry formats

Only the modern DJI "bracket" format is supported today. Older models (Mavic,
etc.) use a different layout (`GPS(...)`, `BAROMETER:...`). The parser keeps
format detection explicit so additional formats can be plugged in later without
rewriting the entry point.
