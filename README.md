# Atelier

A local-first **suite of browser tools for your captures** — photo and video,
across devices (DJI, Apple, Sony, …). Everything runs in your browser; files
never leave your machine — no upload, no account, no server.

Today it ships nine tools, converging into a single studio:

- **Studio** — the unified editor the suite is converging on. Opens on your
  **projects** (saved compositions with a baked preview); each project keeps
  its overlays, look and layout, remembers which folder its media lives in,
  and reopens in one click. Edit on one stage — overlays, LUT, export.
- **Road Trip** — plan and track how a journey gets told. Give a trip its two
  dates and every day of it becomes a cell in a contribution-style grid; the
  holes are the days you have never posted from.
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

> **The one network exception.** Everything above runs offline and uploads
> nothing. The single feature that can make a network request is the Flight
> Map's *optional* base map: turning it on fetches map tiles from OpenStreetMap,
> which reveals the viewed area to that tile server. It's off by default — the
> flight path itself always draws locally.

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
(baked at save time, so nothing decodes), aspect badge, duration, element and
file counts. Creating one goes through a small intro modal (name, destination
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

**The editor.** Pick a clip, place overlay elements on the canvas stage (drag
to position, anchors keep edge pinning), grade through a `.cube` LUT, scrub
with the shared transport. The inspector is tabbed (Overlay / Style / Grade /
Info / Export); tools run edge-to-edge so a landscape clip finally gets the
width it needs. Clips **without** an `.srt` are accepted: telemetry fields
read “—”, free text and the grade still work. Stepping to the next clip with
‹ › hands playback over rather than stopping it: if you were watching, the
next one picks up as soon as it is ready.

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
stagger moves with it. The scene can lay a **veil** over the picture (colour,
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

## Road Trip tool

Editing a clip is one problem; telling a whole journey, months after it
happened, is another. Road Trip (`#/roadtrip`) is about the second one.

**A trip is its two dates.** Give a trip a name, a destination and the days you
left and came back, and everything else derives from that: day 27 of 310 is a
subtraction, not something you record. Dates are handled as plain calendar days
(`YYYY-MM-DD`) and every subtraction runs in UTC, so a trip planned in one
timezone and reviewed in another never disagrees about which day a photo
belongs to — and a daylight-saving change cannot shift a day number.

**The grid is the point.** `#/roadtrip` shows every day of the trip as a cell in
a contribution-style grid, one column per week, Monday at the top. Its job is
the **holes**: with thousands of photos and a year's distance, what you cannot
answer from memory is which days you have never told. Empty cells are drawn
like any other, five intensity rungs separate "nothing here" from "drafted but
never sent" from "published once, twice, more", and the longest stretch of
silence is called out with a link that jumps to it. Hovering a cell raises a
card — the day, its number, what is sitting there and whether any of it went
out — drawn immediately rather than after the browser's own tooltip delay, so
the grid can be swept rather than interrogated. Clicking a day opens it: what
has already come out of it, and one gesture to add another piece — a reel, a
carousel or a single photo. Each piece in that list carries **a thumbnail of
its own hook**, kept in the browser beside the trip, so a day reopened months
later shows what you left there instead of a file name.

**The hook.** Open a piece and you compose its badge over the picture: the
number the trip gives it, big, with everything else deliberately subordinate —
"Australia · Day · **27** · of 310 · ◆ Kalbarri · 1 year ago today". It counts
four ways (day of trip, a range of days, the day at a place, how long you
stayed), and closes on an optional line about when. Pick a frame (9:16,
4:5, 1:1, 16:9), place the block on a 3×3 grid, size the numeral, and export a
PNG — ready as a Reel's opening frame or a carousel's first slide.

The picture takes every pixel the column can spare — it grows with the window
rather than stopping at a fixed fraction of it — while the transport and the
export button stay put. On a wide screen the badge holds still while its
controls scroll beside it —
the Studio's layout, and the reason is the same: you are watching the picture,
not the panel. Stacked on a phone, the page scrolls as one, because a panel
with its own scrollbar inside a scrolling page is a trap.

**The picture is whatever is ticked in the Library**, and the two stay in step:
opening a piece points the Library at its picture, and picking another one
there re-points the piece. Videos work as well as photos, with a frame
scrubber.

**Stages** are the places the trip stopped at, each with its own span. They are
what lets a badge name a place, say "3 days in Kalbarri", or count which day of
a stop a picture is — and an optional marker sets the place off from the rest.

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
any single piece — the trip name, the word, the numeral, the total, the place —
can be replaced with free text per post; clearing the field always gives the
computed value back.

**Each piece can depart from the trip's style**: its casing (as-is, UPPER,
lower), its ink, a panel behind it (fill, corner radius, outline) and an
entrance and exit drawn from the engine's own animation model — fade, slide,
scale, typewriter, wipe, with duration, easing and a stagger delay. The hook
has a **duration**, which is what an exit animation lands on; a transport under
the preview plays the whole thing so you can watch the entrance land and the
exit leave.

**The picture can be helped.** A bright sky exactly where the hook sits is the
normal case, so up to four **shades** can be laid over it. One shade is a
direction — from any of the four edges, a band across the middle either way, or
radial — a reach, a strength and **its own colour**, and it can be **inverted**:
"from the top, reaching halfway, inverted" is clear at the edge and darkest at
mid-frame, which is what a centred hook on a textured picture needs. *Follow the
hook* hands the reach to the badge itself — a linear shade lands on the block's
own edge, a radial centres on it — so the fade moves when the text does. They
stack, so a wash from the left and a corner vignette can be on at once.
Darkening the picture keeps the typography clean, which a panel behind every
line does not.

The badge is built out of the **same overlay engine the Studio uses**, not a
second rendering system: it is a stack of ordinary text elements, so it
inherits the title-style presets (Neutral, Or ciné, Pixel CRT, Rouge plein
cadre) — through the very same style picker the Studio's Style tab uses — and
the preview is the export at a smaller size. The style and the words belong to
the **trip**, not to the post: a badge that varies per post stops being the
signature that makes a post recognisable in a feed.

**Nothing is keyed by a file name.** A post records the *day* it tells, never a
filename: exports get renamed and re-graded between tools, and a tracking system
built on names goes stale the first time you touch Capture One. A post does
point at a picture, but only as a hint for re-finding it — lose the file and the
post still holds its day and its badge. Trips live in their own IndexedDB
database and autosave as you edit; a refused write (private window, full disk)
is said out loud rather than swallowed.

**A post is a deck.** The hook is slide one; add as many content pictures after
it as you like, each with its own optional caption, and close on the trip's
**call-to-action card** — headline, sentence, link and a **QR code**, edited
once and appended to every deck that asks for it. A reel or a single photo is
the same model with a deck of one, so a piece can be re-cut into a carousel
without being rebuilt. Export writes the whole deck as numbered PNGs into a
folder you pick (or downloads them one by one where the folder picker is not
available), named so a file listing is already in swipe order. The order is
yours: drag a content slide along the strip, or move it with the Earlier /
Later buttons. Only the middle moves — a hook that opened third and a call to
action that came second would stop being either.

**The hook can leave as a moving clip, not only a still.** When the hook sits
on a video, "Export hook video" burns the animated badge into it through the
**same WebCodecs pipeline the Studio exports with** — cover-cropped into the
post's frame, the scrim and vignette applied per frame, audio copied through,
never re-encoded. The clip starts on the frame you picked with the scrubber, so
the entrance plays on frame one instead of having already happened; a length
slider says how much of the rush goes out, defaulting to the badge's own hold
plus a beat. It reads MP4 and MOV (what the demuxer handles) and says so
plainly for anything else — the PNG export has no such limit.

The QR code is generated **on your machine** — a ~250-line encoder in
`shared/lib/qr.ts` rather than a call to a web service, because a card that
fetched its own QR would be the one place the suite phoned home. Byte mode,
error-correction level M, versions 1 to 10 (213 characters); a link that does
not fit is refused with a reason rather than drawn as a code that scans to half
a URL.

Currently in place: the trip, its days and stages, the grid, day-keyed posts,
the badge — words, temporal line, per-piece styling, animation and picture
treatments — the deck through to its PNGs, and the animated hook burned into a
clip. A portable `.json` export of a trip is the phase that follows.

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

### Online

Deployed via GitHub Pages at `https://costardrouge.github.io/atelier/`.

> Base path: `vite.config.ts` derives the Pages base path from the repository
> name (via `GITHUB_REPOSITORY` in CI, falling back to `atelier` locally), so a
> repo rename can't 404 the assets. Override with the `BASE_PATH` env var — e.g.
> `/` when serving from a custom domain.

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
background"** toggle adds an OpenStreetMap raster layer on demand — the only
thing in the suite that makes a network request, surfaced explicitly because it
reveals the viewed area to the tile server.

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
│   ├── overlay/                # the overlay engine: element model, canvas stage,
│   │                           #   draw/measure/hit-test, fonts, guides, burn-in export,
│   │                           #   animation + scenes (the intro layer, pure), and the
│   │                           #   ElementList/ElementPanel/Timing/Scene/Guides editors
│   ├── lut/                    # WebGL2 LUT renderer, frame grader, picker, built-ins
│   ├── map/track-map.ts        # the one MapLibre track-map: style, line layer, OSM tiles
│   ├── media/                  # metadata, transcode, WebCodecs export, transport/object-URL
│   │                           #   hooks, export-path decision, download/naming
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
│   │   ├── exif-parser.ts      # dependency-free JPEG/TIFF EXIF reader
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
