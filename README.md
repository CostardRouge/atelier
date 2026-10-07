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
- **Develop** — gather the photographs and clips you mean to develop into a
  **roll**, kept in this browser or on your Winnow; give each its own light,
  colour, look and (a photograph) crop, and export them — from the proxy or the
  original, a clip as an MP4 graded frame by frame.
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
> nothing — no file, no photograph, no position ever leaves the machine. Three
> *optional* features can make a request, all off by default and all stated
> where you turn them on:
>
> - The **base map** under a flight path, in the Flight Map and the Composer,
>   under the map Trips' openers pick their stops on, and under a trip's map
>   view (whose own coastline ships with the app): turning it on
>   fetches map tiles from OpenStreetMap, which reveals the viewed area to that
>   tile server. The flight path, the stops, the legs and the towns always draw locally;
>   the choice is never remembered past the tab. The same tiles can also be
>   drawn **into** an Itinerary or a Virée — in the preview and in the
>   exported file, credited «© OpenStreetMap contributors» as the licence
>   requires — when a piece asks for them and this device has said yes: the
>   yes is kept on the device, never in the trip, so a trip opened elsewhere
>   fetches nothing until that device says yes too.
> - The **place search** in Trips: looking a stage's place up sends *the words
>   you type* to OpenStreetMap's Nominatim service, and gets a name, a
>   structured address (the county, the state and its code, the country) and
>   coordinates back. Every place can be typed by hand instead, so the
>   feature is a convenience and never a requirement.
> - **Lens profiles** in Develop: looking a lens up fetches the Lensfun
>   database's file for your camera's maker from GitHub
>   (`raw.githubusercontent.com`) — and, only when the lens is not there, the
>   independent lens makers' files for that kind of body. Nothing about your
>   pictures is sent; the request says only which maker's file is wanted. The
>   answer is kept on your device, so each lens is looked up once, and the
>   database itself never ships with the app.
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

**Which file is on the stage.** A clip or a photo fetched from a Winnow opens
on its **proxy** — a 720p H.264, a 2048 px WebP: light, quick to scrub,
decodable everywhere. A chip beside the media's name says so (`Proxy ▾`), and
its menu lists the capture's other files with their pixels and weight — the
rush itself behind a clip, the camera's JPEG behind a still, and the render
inside a RAW the instance paired with it — the same list as Develop's, minus
the sensor. Pick one and it is fetched (the chip shows `↓` and the proxy stays
up meanwhile), kept for the session, and put on the stage at its own
resolution, the playhead and the trim where they were; the chip then names its
type (`MP4`, `JPEG`, `DNG render`). The choice is remembered per media in the
project, so reopening it brings the same file back, and the export delivers
from the file on the stage without fetching it again — *Render from the proxy*
still means the proxy. A rush this browser cannot decode (often HEVC) says so,
with **Back to the proxy** beside the transcode. Picking the proxy again stops
a download still on its way.

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
wipe to the untouched frame, which **A/B** in the sheet's header turns on and
off (one choice for every Develop screen, remembered by the browser; turned on,
it opens on the middle). A clip opens on the frame under the playhead and
**plays there**: ▶ or Space runs it graded while the sliders move, the bar
under it scrubs, the histogram and Auto read the frame it stops on, and where
it is paused is written nowhere — the Studio's own playhead stays put. The
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

**Nothing burns that a slider did not send past the picture's own top.** The
tone sliders — exposure, contrast, highlights, shadows, whites, blacks — used
to clip: contrast +100 made everything above 80 % white, exposure +1 burned
half the picture, and *highlights −100* darkened a sky's three-quarter tones
while leaving its brightest tenth where it was, which read as a burned hole
ringed by the recovery. Since 2026-10-05 the curve works on a luminance scale
that **continues above white** — a logarithm of the stops a RAW's sensor kept
past the displayed white — and ends in a **shoulder**: wherever the sliders
push the displayed white past white, the top of the range is compressed into
it by a smooth cubic that reaches white at zero slope, so a near-white keeps
its order and its detail instead of flattening; a **toe** does the same at
black for a contrast or a blacks slider that used to crush. *Highlights* now
reaches white itself, and on a RAW it is **recovery**: −100 brings the whole
headroom under white with its detail, −50 brings one stop of two. The rolloff
reaches two stops; what is pushed further is a burn, and the clipping view
(**J**) says so. Where a channel still cannot be shown, the pixel keeps its
**hue** whatever happens — a per-channel clip turned a warm highlight yellow,
then white — and trades between its colour and its brightness: a saturated
colour just past white stays its colour and gives up a little brightness, a
colour far past white or close to grey goes to white, and a ramp of one colour
through the clip never darkens on its way there. A picture whose sliders push
nothing past white is bit-identical to before; one with highlights set will
render a touch differently at its top, on purpose.

**A slider step redraws only what it moved.** The stage's render is a chain
of passes — the camera's shading, the repairs, the denoise and defringe, the
develop and the look, the lens and the perspective, the layers, the sharpen,
the vignette — and until 2026-10-06 every step of every slider drew all of it
again, on the stage and on the histogram's small copy. The chain now keeps the
output of the last pass that did not change between two renders and resumes
from there: a drag of the exposure draws the develop and what follows, never
the denoise before it; a sharpen drag draws the sharpen and the vignette; a
blink of a mask draws itself alone. The picture is the same to the bit as a
whole render — the gate holds it so — and the one texture it costs is kept
only for an interactive stage, never for an export or a thumbnail, and never
past a phone's stage size.

**The develop is not in the cube.** A correction's white balance, exposure,
tone curve, luma and channel curves, saturation and vibrance — everything up to
the colour mixer — runs **per pixel**, before the lattice, in the shader and in
every CPU bake alike. It was baked into the cube until 2026-10-05, and
measured: on a RAW with its shadows lifted (+1.5 EV, shadows +80, blacks +30, a
steep curve, a metered gain of ×4) the baked develop was up to 42 codes off the
true maths in dark saturated pixels, 26 on a JPEG through 33³, 9 even for a
mild correction under a conversion look — because the whole displayed picture
below code 8 sits in the FIRST cell of the lattice at that gain, and the tone
stage bends hardest exactly there. The per-pixel head costs a few table reads;
what stays in the cube — the mixer, black and white, the grading wheels, every
look, the output transform — is smooth and interpolates well, and a look under
a develop now keeps its own lattice exactly instead of being resampled.

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
strength, fade) so a title reads over any rush, and **shades** of its own —
the same gradients as in Trips, arriving and leaving with the scene over their
own fade — and can **hold the rest of the
deck back** while it plays, fading the telemetry HUD in when it ends — the HUD
"boots up" after the hook.

**Shades over the whole clip.** The Overlay tab's **Shades** are Trips' shades,
with the same controls: up to four gradients, each coming from an edge, a
corner, or in the centre a radial or a band, with its own colour, strength,
reach, **core**, **falloff** and **invert** — a corner darkened under the
readouts, a sky under a title that stays. They sit under every element and
under the intro's veil, for as long as the footage runs, on a photograph as on
a clip; a clean variant leaves them out with the overlays. A band or a radial
is moved with its sliders or by **Place on the picture**: press or drag where
it should sit, on the clip's shades and the intro's alike. They travel in the
project file and the house style like the intro. A Trips shade can follow its
badge; nothing in the Studio is a badge, so that option is not offered here.

Every element, intro or not, can now be given a **window** (appears at, disappears
at — both settable from the playhead) and an **entrance and exit**: fade, slide
in four directions, scale, typewriter or wipe, each with its own duration and
curve. It can **blend** with the footage under it (multiply, screen, overlay,
soft light, difference, luminosity), and a text or a readout can **mask** it —
the picture seen only through the letters, or the letters cut out of it. Windows count from the clip's **in point**, so trimming the head never
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
included. The export button is pinned at the bottom of the Export tab —
**Export 3 MP4s** renders every variant, and its menu renders one variant alone
or captures the frame under the playhead — so it is never scrolled out of sight
under a long list of rows. While a run goes on, that bar becomes the run on
every tab — a segment per variant, the one in hand with its stage (fetching the
capture, encoding with its percentage, writing), the time left once a variant has
measured it, and a Cancel that keeps what was written — the rows say which variant
waits, which is in hand and what each finished one cost, and the stage wears a
thin progress line. Switch to another clip meanwhile and the bar goes on
following the run, naming the clip it is for. The output and the variants are locked
while it runs; the overlays, the style and the grade are not, and an edit made
meanwhile is named when the run ends, since the files are as the project was at
the click.

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

**Or see it as a map.** One switch in the trip bar, **Calendar · Map**, turns
the middle of the screen from the months to the **route**; everything around it
stays where it is, so the open day and the open leg carry over, and the choice
is remembered by the browser. Each leg is drawn **once, at its place** — halfway
along its path when it holds several — wearing a **dial of its days**, one tick
a day clockwise from the top on the calendar's own rungs, so the holes are as
visible here as on the grid. A day is never pinned inside a leg: a place has no
dates, and a dot for "the 12th" would claim what the trip does not know. The
legs are joined in the order you lived them, the road solid up to the open leg
and pale after it, and **dotted** where the trip cannot account for its days —
days no leg covers, or a leg whose place was typed without a position. Those are
**counted in a corner, never guessed**, each with its verb: *Locate…* opens the
leg where its place is set, *Cover…* makes a leg of exactly those days. Click a
dial to open its leg (the open day moves into it), pick one of its days in the
leg's card, or drag along the year map above to walk the trip a week at a time
while the map follows; the **Pictures** switch puts each told leg's latest hook
on the map instead of its dial. On a phone the leg sits over the foot of the map
with its days in one row and arrows to the leg before and after. The map is
drawn **offline**: the coastline is Natural Earth's world outline shipped with
the app (fetched from this site the first time the map opens, 175 kB) and the
towns come from the same city index as the itinerary's names, read and
sorted in the background so the map never freezes while it arrives; the
OpenStreetMap background is the usual opt-in, off every time. *Natural Earth is
in the public domain; `scripts/gen-coastline.mjs` rebuilds the file.*

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
timeline scaled to days. It opens on the **months on screen**: the one you
have scrolled to and its two neighbours, so the legs of a quarter at a time
get the width a pointer can grab (about nine pixels a day on a year-long
trip) while the map above keeps the whole year in view — scroll the calendar
and the ruler follows. When the legs are too many or too short to read,
**zoom the ruler**: scroll the wheel or pinch the trackpad over it (two
fingers on a touch screen), or press − and + beside the legend. The day under
the pointer stays where it is while the window closes in — down to a single
week across, where every leg says its name and every day its date and
weekday — or opens out to as many days as still leave a leg's edge
grabbable; the percentage between − and + goes back to the three months, and
the zoom is kept as the calendar moves on. A sideways swipe or shift-wheel
travels along the trip at that zoom. The window is **marked on the year map**
by a vermilion bar under the weeks it covers, which shrinks as you zoom in and
grows as you zoom out, and its dates are written beside the legend. Each leg is a bar: drag either edge to change when it began or ended,
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
as a table: one line per place with its number, its name, its state, its
**country** (the code and the name) and how far it lies from the rest of the
stage. The first is where the leg began and the last is where it ended, so a
start and an end are the list itself rather than two more fields to keep in
step; ↑ and ↓ reorder, a click on a line opens its fields under the table. A
place in **another country than the trip's and more than 500 km from the rest
of its stage** — the Exmouth in Devon that a search for "Exmouth" answers
first — is drawn in orange with a ⚠, and **Fix** offers three ways out: the
other towns of that name from the city index that ships with the app,
nearest first (offline), the search, or the fields by hand. A correction
takes the other town whole and keeps the place's dates. Leave the stage's own
name empty and it writes itself from those two ends — "Perth → Cairns" — and
typing a name over it always wins; clearing that name gives the derived one
back rather than a blank. A place is a *point inside* a stage: the stage is
the dated thing a badge counts inside, so "Uluru on the 12th" inside a
nine-day leg still means splitting the leg — which is what "start a stage
here" on that day does. A place may nonetheless carry **its own two dates**,
the day you reached it and the day you left, as a bonus: nothing is drawn
until you add one (**+ date** under the open place), the deduction writes the
days your pictures say (a dashed chip), and a date outside the stage is kept
and shown in orange, never corrected.

**A place keeps what it knows.** Beside its name and position it holds its
state ("Western Australia"), the state's short code, the county or shire, the
country — every field optional, and a name typed alone is still a complete
place. How a place is **written** is a setting: "Kalbarri, WA", "Kalbarri,
Western Australia", "Kalbarri (WA)" or "Kalbarri" alone, chosen in **Trip
settings → Places** once for the badges and the openers (the name alone by
default, so nothing you composed changes) and once for the lists, the legs,
the calendar and the map (the short code by default); a stage, or a single
place under **More…**, can depart from it, the nearest choice winning. The
**short code** comes from the place's own, else the trip's own table, else
what the search gave, else the state's initials — said as such, because
initials are right for New South Wales and wrong for Queensland. No table is
shipped: the trip's table is yours, one line per state, written from a
place's editor (**Keep QLD for Queensland on this trip**) or in Trip settings
→ Places, where every state your places name is listed with the code it
reads today and where that code comes from; a place can still prefer the
search's code or its own over the table. The table travels in the backup.

Each place can carry **coordinates**, and there are two ways to get them: type
the name and leave it at that (a place that is only a name is a complete
place), or use the **optional place search**, which sends the words you type to
OpenStreetMap's Nominatim and fills in the name, the position and the
structured address — the county, the state and its code, the country — never
overwriting a field you typed yourself. That search is **off until you turn it
on**, it says exactly what it will send before it sends anything, and it fires
on Enter or the button — never as you type. It asks **inside the trip's
country first** (the country most of its places carry: two more letters,
`countrycodes=au`, leave with the words), with **Search everywhere** beside the
answers for a trip that crosses a border. Places are only ever typed on a
leg: the New trip dialog asks for the name and the two dates and nothing else,
so a trip starts with no leg at all and a day outside every leg names no place
rather than claiming one.

**Working the itinerary out, instead of typing it.** Drawing a three-month
trip's legs by hand is some three hundred gestures, most of them archaeology
about where you were on a given day — so the legs can be *deduced* instead,
and a picture can place a single day.

**Deduce** (in the trip's bar beside Trip settings, in the calendar and on the
map alike; on a phone, in the Stages sheet; for any connected Winnow) asks the instance
for **one position per day** over the trip's span — a few kilobytes for a
hundred days; no photograph is fetched and nothing is read from your media. A
halt is a run of consecutive days whose position stays inside a radius of the
run so far, and the window then cuts the halts into stages at a **grain** you
choose with one slider: one stage per region, split at long drives (the
default), one per big halt, or one per halt. Three windows show the same
proposals, and you pass from one to the other by tabs or by a hand-off that
carries the chapter you were looking at: **All stages** (the slider, the stages
as cards with the map beside them), **Against mine** (say what you want first —
fill the gaps, enrich your stages, show everything — and read the proposals
under the stages you already drew), **One by one** (one chapter at a time,
answered in one gesture, keys 1 to 4). The keys are listed behind the ⓘ beside
the tabs, and what was read from the instance is one chip — the days placed and
what to check — that opens the details. Each proposal carries the safe verb for
where it falls — the places a stage of yours lacks, only the days none of your
stages covers, or a new stage where nothing is — and you can change it, split
it, correct its name, dates and places, or name a halt the city index could
not. Its places are the same table as a stage's, measured from the halt's own
pictures, and **Fix** chooses another town of the name, a search's answer or a
name typed — for this trip only, never on the instance. On a computer the
window takes most of the screen and the map takes **half** of it, as tall as
the window. The map **moves**: drag it, pinch it, wheel it or pinch the
trackpad, with ± and a button to frame again; and it **flies** to the stage you
edit (and back to the whole route on Done), to the paquet's chapter and to a
place you just chose — framing everything that stage holds, even a town on
another continent, which is then drawn in orange and tied to the pictures it
should be near. It shows the itinerary as it would be **written**: a stage you
skip, a place you leave out (×) and a position Deduce ignored leave the map and
its frame, so skipping what happened abroad brings the map back to the trip.
A line from one stage into the next is the travel between them, drawn faint
and dotted, and left out when one stage is framed. The thresholds (radius, long drive, big halt, blind days, outliers) sit
under *Fine settings*; moving any of them never asks the instance again. What
the instance could not say is said rather than hidden: days without a position,
a day placed far from the days around it (a drone that kept the GPS of home —
left out by default, keepable), halts nobody can name. Nothing is written
before you review exactly what will be, every stage written carries a mark so
the ⋯ menu can take them all out again, a re-run recognises what is already in
the trip, and no piece is ever created.

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

**The credit is composed, not only switched on.** The Content tab's **Camera**
section picks **which facts** — body, lens, the 35 mm-equivalent and the real
focal length, aperture, shutter, ISO, exposure compensation, a drone's height
above take-off — and **in what order**, each listed with the value this picture
records or "not recorded". It sets them in one of **eight layouts**, each shown
with the picture's own numbers: *Line* (the credit as it always read), *Two
tiers* (what took it in small capitals over the numbers), *Plate* (the numbers
large over their labels), *Ledger* (label and value, row by row), *Caption* (an
italic "Shot on…" over the numbers), *Viewfinder* (the exposure as a camera
shows it, with a −2…+2 meter where the camera was argued with), *Edge bar*
(across the top or bottom edge) and *Margin* (a column down one side). It hangs
**under the badge** and moves with it, or sits in **a cell of its own** on the
3×3 grid, at a size of its own. Columns are set in JetBrains Mono, whose fixed
advance is what keeps them from ever running into each other. A DJI still names
its body `FC8482`: the **Body** field names it once for the whole trip ("DJI
Mini 4 Pro"), and the plate's words — "Shot on", each label — are the trip's,
in *Words*, like the rest of the badge. A piece that never opens the section
keeps exactly the line it drew before.

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
from the band under the preview shows the entrance land and the exit leave. A
new hook is on screen for **3 s** — the badge settles in 2, the picture holds
one more — unless the trip remembers another length for that kind of piece.

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

**A picture can move in its frame.** The **Pan & zoom** section of the Picture
tab shows the move as a row of **cards** — the frames the picture rests on,
**Start**, the stops, **End** — each a thumbnail of what the frame will show.
A still picture is its one card, the composition, with a dashed **Start** before
it: tap it and the picture travels over the slide — a slow push in, a glide
along a landscape too wide for a reel, a tour of three spots — like a camera
over a print. There is no second editor: tap a card, and the drag, the wheel
and the pinch that already frame a picture on the stage reframe **that card**
and no other; a word in the picture's corner says which one it is. **End** is
where the picture comes to rest, which is also what the PNG, the rail and the
grid show, and what a slide opens on. **+ Stop** adds a card after the one
picked — a copy pushed a touch closer, for you to frame — and **Remove** takes
one off (never End). The time between cards is not placed by hand: the glides
share the slide by how far each travels, and **Pause** is how long the view
holds on every card; the seconds are written on the arrows. Scrubbing the band
between two cards shows that instant, and a gesture there does nothing but say
so — a frame is never written in silence. **Play** runs the slide from its
first frame. **Quick move** writes Start and End in one tap over your
composition and plays them — **Pan ← → ↑ ↓** from one edge of the picture to
the other at the zoom you chose, **Push in** (from wider onto your framing, or
closer onto its middle when it is already at its widest) and **Pull out** (from
close on the middle back to your framing); a pan with no room to travel is
greyed out, and the reason is written under the buttons. **Plan a tour…** opens
a map of the whole picture with the window each card shows and a dot where it
looks: tap where the view should go to add a card after the last, drag a dot to
move that card, and pinch, scroll or slide to zoom the picked card — each card
at its own zoom. Both are only ways of writing cards — the row shows whatever
the picture already has, however it was written. The zoom is geometric and a point two
cards share stays still on screen, so a push in lands on what you aimed at. On
a hook with an opener that covers the frame (Défilé, Virée), the move can wait
for the opener to finish. It works on a hook, on every picture of a carousel,
on each cell of a collage and on a clip — the clip's frame is re-framed at
every instant of the export. A slide that moves leaves as a video under Auto,
and a still that starts close in fetches the original where its closest frame
would upscale the proxy, not where it rests. The band marks each card's frame
on its slide.

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
can be on at once. The fade itself has a shape: a **core** holds the full
strength over part of the reach before the fade starts — a band at full strength
is then a dark zone, not a dark line — and a **falloff** picks how it clears
(Soft, the classic shape; Linear; Smooth; Held, dark most of the way; Quick). A
band or a free radial can be moved off the middle, with its sliders or by
**placing it on the picture**: while placing, a press or a drag anywhere on the
stage moves the band's line or the radial's centre, and nothing else.
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
located place) is greyed with the reason, never hidden. Switching is never a
loss: the opener you leave keeps everything you gave it — an Itinerary's stops,
Virée's picked pictures, every setting — and switching back finds it exactly as
it was, after a reload too. **Badge** is the plain
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
through its stops, and a cartoon vehicle — the trip's car, a Land Cruiser
Prado or a Renault Kadjar with its wheels turning, or a boat a piece borrows for
a day on the water, leaving a wake — a miniature rendered in the browser,
driving from stop to stop. The stops are the
legs' located places, arriving where this day's leg ends; **your own places**,
put on a map with the very editor the Itinerary uses — any place, on a leg or
not, in your order, each able to hold a picture the car halts to show; or the
**pictures you pick** — each one shot with a position in its EXIF is a stop, in
the order they were shot, a run shot at one spot one stop. Your places follow
you from one opener to the other: the stops picked for an Itinerary are the ones
Virée drives when you switch, and back. At a stop with pictures the car
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
latitude and longitude, a vignette — or, as a third ground, OpenStreetMap's
own map under the road and the car, in the preview and the file, credited
and at a strength that lets the paper show through —, where it sits and how big, dots, the stops'
names, a compass rose, a scale bar, the distance so far in km or miles counting
up as it drives), the motion (the time on the road, the five motions, a hold
first, a beat at the end, whether the camera fits the whole route or follows
the car at a zoom, the badge's place following the car), and the sound: a tick
at every stop on the same voices, deeper where a leg begins, the seat on
arrival, a shutter click as each print lands.

**The car is the trip's, and it has a garage.** One car per journey: every
Virée of a trip drives the same one, and it travels in the trip's backup. Two
models: a Toyota Land Cruiser Prado (the J120, the default) and a Renault
Kadjar (the 2018–2022 facelift). The garage dresses whichever you pick — a
colour from that model's factory range or one of your own, a factory gloss or
a matte coating — and its gear, each a switch. The Prado (Raptor black, matte,
by default) takes a bull bar with two spot lights, a roof basket carrying a
solar panel on the left, an aluminium storage box and three jerry cans across
the rear (water, petrol, water), an awning bag along the side, mud flaps,
window visors, the spare on the tailgate, the door mirrors. The Kadjar (navy
blue, gloss, by default) takes two roof bars across its roof — standing on
their own feet, or on the factory roof rails when you fit those — and its door
mirrors; it is drawn with its own marks: the C of its daytime lights, the
diamond in a chrome-barred grille, black cladding round the arches, a spoiler
over the raked tailgate, two-tone wheels. Picking a model brings that car as
it comes; the one you left keeps what you dressed it in while the garage stays
open. Four boats join them: the **Whitsundays day cruiser**
(a motor catamaran with a shaded upper deck, the ordinary boat out to
Whitehaven), the **Viper** (Airlie Beach's jet boat to the outer reef — six
rows of belted benches, the helm console, two waterjets at the transom), the
**Alison Maree** (the Bremer Bay catamaran that takes you out to the canyon's
orcas — a glass wheelhouse and a big open upper deck) and the **Solar
Whisper** (the Daintree River's silent electric boat to the crocodiles — a long
narrow hull, benches along both edges so every seat has the water, a roof tiled
with solar panels, the croc cam's screen under its front edge, two electric
outboards). Their liveries are guesses you can repaint. A trip can drive a
boat, but a piece usually borrows one: the Virée panel's **Vehicle** row keeps
the trip's car or picks any other model for that piece alone, in a paint of its
own, and a boat leaves a wake that grows as it gets under way and settles when
it halts — long behind the Viper, barely a ripple behind the Solar Whisper. The car turns on a turntable while you dress it (drag
to turn it, the arrow keys turn and tilt it; it stands still if your system
asks for less motion), drawn by the very renderer the map uses, so what the
garage shows is what the opener gets. The garage opens from the opener's own
panel («Configure the car…», with Cancel and Done) and lives in the trip's
settings as its Car section, where every switch writes at once. On a wide
screen both show the car beside its choices, which scroll on their own, so a
switch far down the list is seen on the car the moment it flips.

**Itinerary** is the one you compose yourself (and the editor Virée borrows for
your own places): pick the stops on a map — click to drop one where you like, drag it to move it, take
one of the trip's own places with a click, or find it by name through the same
opt-in place lookup the legs use — and the pen travels them in order, bowing
from stop to stop, waiting at each for as long as you ask. The small map in
the panel is the very projection the export draws, run backwards, so what you
point at is what goes out. To **find** places, **Pick them on a map…** opens a
big one: pan, zoom and pinch it, and every tap is the next stop, joined to the
one before as you go — one, two, three, as many as the trip holds (there is
no cap: a three-digit number simply shrinks to stay inside its dot). A tap near a town takes the town and
its name (a switch turns that off, to drop a stop exactly where you tap), a
hollow ring is one of the trip's own places, a numbered stop is dragged to
move it, a place can be searched for and added, and a stop you dropped with no
name is offered the nearest town's (never given it). The towns come from the
city index the app ships, so the map needs no network; the OpenStreetMap
background is the optional one above, off until you turn it on. Nothing is
written until **Done** — Cancel or Escape leave the stops as they were. Each stop can carry **one
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
the straight-line sum of what it has drawn, never a road distance. **Real
geography** can sit inside the map's box too: switch on its OpenStreetMap
background and the tiles for that region are fetched, laid onto the opener's
own projection (so the stops land on their towns to the pixel) and drawn in
the preview and the exported file, at a strength you choose, with the credit
the licence asks for in the corner. The pen can
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
re-cut into a carousel without being rebuilt. **Export the piece** writes every slide in the
format the deck says it is — a still as a PNG, what moves as an MP4 — into a
folder you pick (or downloads them one by one where the folder picker is not
available), slide after slide in deck order and named so a file listing is
already in swipe order. The button is pinned at the bottom of the Export tab, and
its menu offers every slide as a still, the open slide as a PNG and the hook as a
video; the header's **Export** does the same as the pinned button from any tab. The
looks are taken when you press it: a look changed while a reel encodes waits for
the next export. While it runs the pinned bar becomes the run, and stays on every
tab — a segment per slide, the slide in hand with its stage (Render or Encode,
then Write) and how far an encode has gone, the time left once one slide has
measured it, and a Cancel that keeps what was written — while the deck band
marks each slide waiting, in hand, ✓ or !. Each file is written the moment it is
made. While it runs, the Export tab and the deck's order are locked — the run
follows them — but every slide stays free to retouch, and the run names what was
edited meanwhile when it ends. The order is
yours, and so is the time: under the picture, at every width, the deck is **one
band** — every slide end to end on the piece's clock, a clip as wide as its cut
and a still as wide as the seconds its inspector gives it, slid under a needle
that never moves. Drag the band (or use the arrow keys on it) and the slide under
the needle is the one open; ▶ or `Space` plays **the whole piece**, slide after
slide, on the stage. The open slide's cell carries a **grip at each end**: drag
one to make a picture hold the screen longer or shorter, or to move a clip's in
or out point — the other end stays put, and the change is written once, when you
let go (the Content tab's *On screen* slider is the same number). `⋯` moves the open picture earlier or later, removes it, or
closes the piece on the call to action; `+` adds the active picture. Only the middle moves — a hook that opened third
and a call to action that came second would stop being either.

**Any slide can hold what the hook holds.** Being first is what makes a slide
the hook; what it *carries* is each slide's own. Open a content slide and the
Look tab offers it an **opener** of its own — three legs in one day can be
three itineraries in one carousel, a Virée halfway through is a second reason
to keep swiping — plus its own **shades**, and a **badge**: *Off*, a **chapter
mark** (the piece's badge at about a third of its size, in a corner, its
words rewritable for that slide — `NOON · 12`) or *Full*. The badge keeps the piece's look on
every slide it sits on, so a deck still wears one signature. The Content tab
gives every slide but the closing card free **Text** lines: type, drag one on
the picture, size it, give it its own ink or the trip's. A line can **blend**
with the picture under it (multiply, screen, overlay, soft light, difference,
luminosity) or **mask** it: *Picture in the letters* lays a wash of your
colour and strength over the frame and lets the photograph show only through
the type; *Letters cut out* takes the letters out of the picture down to a
flat ground. A slide's words sit under its badge, so a mask never hides the
signature. On the band, a cell marks what its slide holds — `◆` an opener,
`#` a badge, `T` words. The stage, the rail, the PNGs, the videos and the
Studio bridge all draw a slide from the one function, so what you see is what
leaves.

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
frame (hold the corner chip to see it whole; **A/B** in the header turns the
wipe off and on). A clip slide **plays** in the sheet — ▶ or Space, a bar to
scrub — so a correction is judged moving; the piece behind the sheet does not
play along. The correction bakes into the
same single LUT the grade already goes through, so the stage, the slide rail,
the PNG deck and the hook clip all pick it up with nothing else to do. It
belongs to **that slide**, like its framing: it is never inherited by the next
picture, and ↺ puts it back to as shot. Every luminance move keeps hue and
keeps a grey grey; only temperature and tint tint. Under the curve, the
**colour mixer** moves eight bands of colour on their own — the hue, the
saturation and the luminance of red, orange, yellow, green, aqua, blue,
purple and magenta — so a blue sky can be darkened or a lawn calmed without
touching a face; a grey is never moved, and a hue shift keeps its light.
**Vignette** is Lightroom's post-crop one — Amount, Midpoint, Roundness,
Feather and Highlights (a bright corner keeps its light) — shaped on the
picture AS CROPPED, so it follows a crop that is moved or turned, and the
file gets exactly the vignette on screen. Its
**B&W** switch (or **V** in the Develop tool) turns the picture black and white
and the same eight bands into eight lights in grey — a red filter's dark sky
is blue −100 — while the colour mixer is kept for when colour comes back.
Under it, **colour grading** has Lightroom's wheels: a colour and a light for
the shadows, the midtones, the highlights and the whole picture — drag in a
wheel (the angle is the hue, the distance how strongly it tints; the arrow
keys work too), and **Balance** and **Blending** say where the ranges meet
and how far they overlap. A wheel colours without brightening; only the
**Light** slider under it moves the light. On a JPEG or a Winnow proxy
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
trim, the telemetry elements or your own intro. The piece's **shades** go too,
whole, as the scene's own: the same gradients, arriving and leaving with the
hook. A shade that follows the badge is sent as the shape it draws at that
moment, since nothing in the Studio is a badge to follow. When the piece **closes
with the trip's call to action**, the send also writes that card into the
project's **outro** — the same closing card the carousel export appends as its
last slide, appended here after the footage of the reel — under the same
rules: a resend replaces it, unlinking removes it, and an outro you composed
yourself in the Studio is never overwritten (the panel tells you the card
stayed behind instead). The hook picture's **correction** — its exposure,
tone and colour from the Develop sheet — goes too, onto that media in the
project, so a reel from the Studio wears the correction the badge was composed
over; a resend replaces it, unlinking removes it, and a correction you set on
that media in the Studio is never overwritten. The picture's crop and the
trip's title style stay in Trips, as the panel says.

Currently in place: the trip, its days and stages, the grid, day-keyed posts,
the badge — words, temporal line, per-piece styling, animation and picture
treatments — the deck through to its PNGs, an opener, a badge, shades and
blended or masked text on any slide, clips that play, trim and re-time on any
slide and leave as video, the located places a stage went through, and the
bridge into the Studio.
A portable `.json` export of a trip is the phase that follows.

## Develop tool

The third editor, for photographs — and clips — you mean to **develop** rather
than compose. It opens on your **rolls** — cards grouped by where each is
kept, with the first pictures as a cover and how many are developed — and a
roll is a set of pictures, each keeping its own develop and its own **look**,
applied after its correction.

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
each side, and the band shows the instance's thumbnails meanwhile. It is
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
**band** of its pictures under it (or a column beside it — see *The band*
below), and beside it the same controls as the Develop sheet in
Trips and the Studio — the histogram, the sliders, your presets, the
before/after wipe and zoom, and the picture's **look** (LUTs, output
transform, grain), applied after its correction. With **A/B** off, the
picture at its fitted size **swipes** like the Winnow lightbox: a finger, a
mouse drag or a sideways trackpad sweep slides the picture before or after
in under the hand, a flick or a quarter of the stage turns to it, a shorter
drag settles back, and the roll's two ends resist; it opens on its cell's
still and sharpens as it decodes. Zoomed, the same drag pans, and with A/B
on it places the divider, as ever. The histogram draws the
three channels apart, so a sky whose red alone has gone is seen; **J** — or
a click on its *blacks* / *whites* — paints on the picture what has gone to
white (red) and to black (blue), and the pixel under the pointer is read
under the strip as the file will hold it (`R 212 · G 180 · B 96`, or
*clipped to white*). The Trips and Studio sheets have the same strip and the
same click. Under the colour sliders, **Presence** has Lightroom's three:
**Texture** (local contrast at a small scale — pores, bark, fabric — and a
smoothing below zero), **Clarity** (the same at a large scale, on the
midtones only) and **Dehaze** (the haze read from the darkest channel around
each place, in light, and taken out — or added below zero; a bright sky
darkens with it, as haze removal does). Each looks around the pixel, so its
scale is a share of the picture and the stage shows what the file will get;
they are the Develop tool's, like the Detail tab, and not in the Trips and
Studio sheets. The inspector's sections fold, like Trips' and the Studio's:
click a section's title bar to close or open it; a closed section with
anything set in it keeps a dot beside its name. Levels, the curve, the mixer and
grading start closed. What you fold is remembered while the tab is open — from
one picture to the next, and across a reload — and never written to the roll.
The Crop tab folds the same way (Crop, Borders, Perspective, Lens, and the
Apply-to blocks; Borders starts closed). What a setting does is explained
behind the small **ⓘ** beside its name rather than under it, so the column
holds the controls; what a line says about the picture right now — why it
leaves at this size, the copyright that will be written — stays in the open.
The **Auto** verbs
write numbers from the picture *as shot*, so pressing one twice gives the
same answer: **Auto tone** stretches the range into Levels (a black point, a
white point, a gamma — bent by a stop and a half at most, so a snow field
stays a snow field) and touches no colour; **Auto colour** neutralises the
average cast as temperature and tint — the wrong answer on a sunset, which is
why it is its own button, and **Pick grey** asks you for a neutral instead;
**Auto bands** compresses the ends where the picture leans — a tenth of it
against black lifts Shadows, a tenth against white pulls Highlights down —
part of the way, so a picture dark on purpose keeps its character, and says
when a band runs out before its target. Two more live where their sliders
are: **Auto detail** (the Detail tab) sets the noise reduction from the ISO
the file says — nothing under ISO 800 for luminance, each stop above adding
more and holding the sharpen off the strong edges — and the sharpening from
what the picture is developed from: the most on the sensor's own data, less
on the camera's JPEG, none on a proxy, said; the radius and Detail are yours.
**Auto upright** (the Perspective fold) reads the lines that stand and lie —
a building's edges, a wall's courses — and where they converge writes the
Vertical and Horizontal that make them parallel, with the Zoom that hides
the corners it empties; lines that do not agree on one vanishing point are
refused rather than guessed at. Each is a **switch**: a second click
puts back what its own sliders held before it and leaves the others alone, so
of Auto tone and Auto colour you keep the one that helped. A lit switch still
holds its answer, a dashed one found nothing to change, a half-lit one has
been moved by hand since; ⌘Z lights and dims them by itself. Auto colour and
Pick grey share the white balance — the newer replaces the older, and turning
it off gives back the balance from before either. The switches remember
their clicks for the session only: after a reload they are off and the values
stay. And one **Auto**, first in the row, runs your recipe: the steps ticked
in Settings › Automatic (tone, bands and detail until you say otherwise;
colour, level and upright when you tick them), in a fixed order, each
through its own switch — so any one can be taken back alone afterwards, and
a second click on Auto takes them all back. With *When a picture opens →
Auto*, an untouched photograph gets it the first time it opens, once per
session; one undo takes it back, and the making-of says which steps were
Auto's. Every setting belongs to the
picture it was made on — the develop, the look, the crop, the masks — so the
next picture keeps its own; **Apply look to N other pictures** (or to the
marked ones) is how one look dresses several. There is no Done: what you set is saved on
the roll as you go. **←/→** move along the strip, **\\** held shows the picture
as shot, **Z** goes closer and back, **⌘C** copies everything done to the
picture on screen — no dialog — and **⌘V** pastes it onto the picture on
screen, or onto every picture marked in the band when some are. What a paste
carries is a standing choice, ticked in the **▾** beside the paste glyph:
**sections** — develop, look, crop, border, perspective, lens, detail,
vignette, repair, layers. A section the copied picture never touched is never
pasted, so a target keeps its own. The keys hold while a slider has the focus,
and there is no ⇧ chord to collide with a browser's (Arc copies the page's URL
on ⌘⇧C). **Shift-click** marks a range of the strip and **⌘/Ctrl-click** one
picture, and the batch verbs then read the marks. The ⚙ glyph above the
picture opens the same sections as a sheet, like Lightroom's Copy Settings,
for the deliberate gestures: *Apply to N selected / N other pictures* writes
them across the roll, its **Copy** also carries a section left as shot (so the
paste resets it), and **Reset** puts the ticked sections of
the picture on screen back to as shot — its look and its layers included —
one ⌘Z away. **Every glyph answers the hand that presses it, a finger
included**: it goes down a pixel at the touch and stays there a beat after
the lift; a verb that takes time — a paste re-rendering a RAW, an Auto, an
Apply to — keeps it down while it runs, with a hairline along the picture's
edge, then shows ✓ (or – when it could not) and says a word beside the
glyphs. A grey glyph, tapped, says why it is grey. In the band, the picture
⌘V would paste from wears a copy mark, and the pictures a paste or an Apply
to just wrote tick. Under a finger the glyphs take a finger's 34 px whatever
the screen's width — a tablet too. Trips' and the Studio's Develop sheets,
Trips' deck and the Studio's transport answer the same way. A **preset** saved here can carry the picture's look too (tick
*+ look* when naming it): the chip then dresses a picture in both. In the
Trips and Studio sheets, where a look lives elsewhere, the same chip applies
the numbers alone and says so. **⌘Z** undoes across the whole roll, and an
undo that reaches another picture than the one on screen opens that picture,
so what changed is what you see. The develop, the look, the lens and the
detail are ticked to start — what a roll shot with one body shares — and the
ticks are remembered. A picture's file, its RAW base, its title and caption and
whether it leaves are never carried. A cell of the band shows the
picture as it was last seen in the editor — developed and cropped — and its
pill says what is developed. On a phone the picture and the band share the
screen and the three tabs open from the bottom bar.

**The band.** The roll's pictures run under the photograph as cells at their
own shapes — a portrait narrow, a panorama wide — one row scrolling sideways
at the band's smallest. Pull the **handle** above it and the band grows into a
grid of two or three rows, justified like a photo site's; pull it down past
its header and it folds to a **rail** (one line: where you are in the roll,
the filter, *Select*, the sheet and the band's ⋯ menu), **B** does the same
from the keyboard and a double-click on the handle too. The ⋯ opens a small
panel of glyphs — a choice applies and closes it — that sets the
rows, lets the band's **height follow the roll** (it takes the room the roll's
typical picture leaves under itself, so stepping to a portrait moves
nothing), makes the thumbnails smaller or larger (**−** / **=**), and says
**where the band sits on this screen**: under the picture, or a **column** at
its left or right — the same cells in one, two or three columns, the handle
on its edge, the rail a thin strip when folded. All of that is remembered
per device in the browser and never written to the roll; a phone keeps the
band under the picture. The band draws only the cells near what you see and
lays itself out from the shape each thumbnail was kept with, so a roll of
hundreds opens on a dozen cells and decodes nothing to measure them; and
**←/→** land on a picture already decoded — the two beside the open one are
decoded ahead in the background, and the last few are kept for the session
(three on a phone, eight on a computer). A
**filter** chip opens a panel of glyphed rows, each with how many pictures it
would show: the roll whole or only the
pictures *edited*, *to export*, *held back*, *ignored* — or by your Winnow's
culling (*picks*, *rejected*, starred), when the roll came from one — and the
switch that hides the ignored ones or shows them dimmed. A cell
is calm: a small pill reads its state (**●** edited, **↑** leaves at export,
**–** held back, **⊘** ignored, its variant number, **▶** a clip, **!** not
reachable), Winnow's mark sits in the other corner, the name is written under
it once the cells are large enough, and nothing on it is a button. What you
DO to a picture is in its **menu** — ⋯ under the pointer, or a right-click
anywhere on the cell: open, send ↔ hold, back to the rule, ignore, a variant,
take it off the roll. For several at once, **Select** (or **S**, a
**Shift / ⌘-click**, or on a phone a **finger held** on a cell) turns the
**selection** on: a click now marks a cell instead of opening it, **⌘A**
marks every picture the band shows, and the band's header becomes a bar of
verbs for the marked pictures — *Send*, *Hold*, *Ignore* / *Bring back*,
*Apply ‹the open picture›'s develop*, and under *More* back to the rule,
paste settings, a variant of each, take them off the roll. *Done*, **S** or
**Esc** leaves it. The **contact sheet** (**G**, or the ▦ button) lays the
whole roll large over the picture — every name written, the same filter, the
same selection and bar, the cells in four sizes from its ⋯ panel or with
**−** / **=** — to sort and to
act on many; it covers the picture and the band and leaves the inspector, so
the numbers you are about to apply stay in view, and a click on a picture
opens it and closes the sheet (on a phone it is the whole screen). **Focus**
(**F**, or the ⤢ button above the picture) puts the band, the inspector and
the page bar away and leaves the photograph alone; **←/→** still step, and
**F**, ⤢ or **Esc** brings everything back.

**Clips.** A roll takes a video the way it takes a photograph: from a folder
or a drop (the clip alone — its `.srt` flight log stays the Studio's), from
the ticked Library, or from your Winnow, where the picker (below) lists
its clips beside its photographs. A clip's cell in the band is a frame a
second in, marked ▶. On the stage it **plays**: a transport under the picture,
**Space** to play and pause, the develop and the look following every frame,
the before/after divider live while it moves. What a clip takes is the
**global** develop and the look — the sliders, curves, levels, mixer, black
and white, grading, presets, LUTs, output transform and grain — and a
**crop**: one zone held still over every frame, drawn on the same Crop tab
as a photograph's (format, straighten, flips, *Apply crop to…*), with the
transport under the crop stage so the zone is judged on the frames that
matter. So its inspector has three tabs, **Adjust**, **Crop** and
**Export**: a border, perspective, lens, detail, repair and layers are passes
over one still frame and never land on a clip, whichever door they come from
(a paste of sections, an *Apply to N other pictures*, a reset — a clip takes
the develop, the look and the crop out of them and nothing else). Clips are
usable in the Library bar when Develop is open, like photographs; they are
no longer greyed out. A clip from your Winnow opens on the
instance's small proxy, and the name above the picture is the same menu it
is for a photograph: pick the **rush** — `DJI_0007.MP4 · 3840 × 2160 ·
1.2 GB` — and it is fetched once, kept for the session, the playhead where it
was, the choice stored on the picture so the roll shows the same file on
another device; pick *Proxy* again and the fetch stops. A clip **exports as
an MP4** under the capture's exact name: every frame developed under its
look, cut to its crop at the clip's own density (a 1:1 out of 1080p is 1080
× 1080, never blown up) and encoded to H.264 at the first target's size (a
ceiling read against the cropped frame, never an upscale), its sound copied
as recorded. The rush is what leaves — the file you chose, else fetched
where the first target's frame asks for more than the proxy's zone holds,
exactly as a photograph's original is — unless *Proxies only, for this run*
is on. Quality, borders, HDR, the watermark and the metadata groups are a
photograph's and do not reach a clip; the run says so once. Not built,
deliberately: a crop that moves or a per-frame mask on a clip, and a second
target for one.

**HDR.** A photograph developed on its RAW can leave as an **Ultra HDR
JPEG** — an ordinary JPEG every viewer shows, carrying a small *gain map*
that a phone or a browser on an HDR screen lifts the highlights with. The
map is measured, never invented: the sensor is developed again, the stops
you ask darker, and where the file ran out at white the map holds what the
sensor kept above it; the file is read back and its map checked before the
run calls it Ultra HDR. **Look at it on this screen**, in the Export tab's
HDR section, shows that very file before it is written: the picture as the
stage renders it, twice, wrapped the way the export wraps it and handed to
an image the browser lights where it can — Chrome, Edge and Safari on an
HDR display — with a *Base · HDR* switch and the measured line (how far
above white, how far it read back). On an SDR screen both views look the
same, and the sheet says so rather than pretending; a picture not on its
sensor shows the base and why.

**A 16-bit master.** A target's **Format** is JPEG or **PNG 16-bit**: the
graded picture read off the render chain's own float buffers — never the
8-bit canvas — cut in float to the crop the stage shows, bordered, marked
and written with 16 bits a channel, carrying the same EXIF, XMP packet and
sRGB profile a JPEG does, as PNG chunks. It is the file to keep or to edit
again: a correction made on it later has sixteen bits of room where a JPEG
has eight. It takes no quality and no screen sharpening (a master is not
sharpened for a screen) and no gain map; a blur border is blurred from the
8-bit render, as the thumbnail is. Several times a JPEG's weight. Not on a
phone — a 48-megapixel picture read back whole is more than a tab holds
there — where the target writes its JPEG and the run says so. The *Master ·
16-bit PNG* preset adds one.

**Layers.** The **Layers** tab (**L**) adds a develop that applies only
somewhere: a *linear* or *radial* gradient, a *shade*, a band of
*brightness*, a *colour* range, a mask *painted* by hand, a *subject* found by
a model from a point you tap, or the *whole picture*. One **+ Layer** opens
a palette of those kinds, grouped by what you do — *Point at it* (subject,
colour, brightness), *Draw it* (linear, radial, shade, painted) and
*Everywhere* — each with its glyph and a line of use (a sheet on a phone).
The same palette changes a layer's kind, from the chip beside **Mask**, and
combines a term into its mask. Each row of the list shows a thumbnail of the
layer's real mask (its terms combined, the subject it takes out cut away),
its name beside its kind (double-click to rename), chips of what it changes
and its opacity as a slim bar; drag its grip, or press **⌥↑ / ⌥↓**, to
reorder, and **⋯** holds Rename, Duplicate, Move up and down, Invert, Change
type… and Delete. The open layer is named in its own head, beside the chip of
its kind, and splits into **Mask · where** and **Adjust · what**, so its
sliders are one tap away. Every Develop slider works inside a layer, and layers add up
from the bottom of the list to the top. A **shade** is the very shape a Trips
shade draws, picked with the same controls: where it comes from on the 3×3
grid (an edge, a quarter circle from a corner, or in the centre a radial and
the two middle bands), its reach, a **core** held at full effect before the
fade, the **falloff** curve, and its own **invert** (clear at the anchor, full
at the far end). Where Trips paints a colour, the layer's develop is what
lands, and its opacity is the strength. A band or a radial can be moved:
**Place on the picture** (or **P**), then press or drag where it should sit. A new Subject layer starts with
**Pick** on (**P**): tap the thing you mean and the model finds it at once —
a ring turns while it thinks, then what the tap added blinks twice — tap
again to add to it, tap a marker to take it off. When the model takes in too
much — the bench the person leans on — switch the picture's **+ Add | −
Remove** to Remove, or hold **⌥** for one tap, and tap the part you do not
want: the model finds that object as well and it is taken **out** of the
subject, its region blinking in ink, its pin an ink disc with a `−`. Under
the points, **Refine what it found** works on the model's answer, which is
how SURE it is pixel by pixel: **Tolerance** moves the cut (higher takes in
what it was less sure of, lower keeps the core; 50 % is the model's own
answer), **only what touches my + points** drops a region the model returned
nowhere near your taps, and **Grow / Shrink** moves the edge by up to 24
pixels of the 1024 px picture the model is shown. **Edge** is made last: *As
found*, *Soft* (feathered), or *Snap to edges*, which pulls an edge the model
drew a few pixels off onto the picture's own (a guided filter over what the
model was shown) — it refines an edge, and cannot bring back a part the model
left out. A removed region is cut at the same tolerance and taken out after
the rest, and no knob asks the model again.
The mask view is
one glyph in the picture's bar, beside **A/B** (and **M**): *Hidden*, its
*Outline* or a red *Fill*. Hidden, its outline still shows by itself while you
pick or paint; Outline or Fill keep it shown, on the Layers tab only. Any layer
can take a subject **out** of itself (*Except › The subject*): darken the
whole picture except the person, and the person's own layer alone decides
them. The model (17 MB) is served from this site and loads the first time a
subject is asked for, in a worker of its own so the page stays live while it
thinks; an export segments the same points on the picture it delivers.

**Combining masks.** A layer's mask can be combined with up to four more,
the way Lightroom does it, and the mask reads as a **recipe** of them — a
tile per term with its own small map, the operator between two (a click on it
cycles **+**, **−**, **∩**) — and the recipe's **+** opens the palette with
**Add**, **Subtract** or **Intersect** at its head, then the kind. *Add* takes in the new shape too, *Subtract*
takes it out (a sky minus the mountain you paint over), *Intersect* keeps only
where both are (the shadows, but only inside an ellipse). The parts apply in
order, each with its own invert. The list at the top of the mask panel opens
one at a time: its sliders show below it, and Paint or Pick act on it. A
**colour range** is picked by tapping the picture. Every pixel near that
colour is in the mask, wherever it is. Tap again to add up to five colours,
tap a marker to remove one, and **Refine** widens or narrows the range. The
colour is read from the picture as the layer sees it (the layers below it,
not its own change) and stored, so the mask does not move when a slider
does. A subject is not offered as a part: a Subject layer can carry parts of
its own, and *Except* takes a subject out of any other layer.

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
horizon, and **Auto** finds that line by itself — the strongest straight edge
within 15° of level, a horizon or a wall, read off the picture as shot — or
says that the picture holds none it can trust and turns nothing. **Crop to
subject** draws the zone around the subject — what your Subject layers point
at, else what the model finds at the centre of the picture, and the line says
which — with room around it, in the format chosen, slid inside the picture
rather than shrunk; a speck and a subject that is the whole picture are
refused with the reason. Both are **switches** like the Adjust tab's Auto
row: a second click puts back the crop from before that verb — so Auto level,
then Crop to subject, then the crop turned off gives back the levelled
picture. The quarter
turns take the zone with the picture, and the two flips
mirror what the frame shows. A pinch, the wheel or the ± pill looks closer at
the picture without touching the crop. The crop belongs to the picture, is
saved as you go, and is never inherited by the next one.

**Lens profiles.** The **Lens** section of the Crop tab corrects distortion,
fringing and vignetting by eye, and — once you allow it — from a **measured
profile** out of [Lensfun](https://lensfun.github.io/), the open database of
lens calibrations (CC BY-SA 3.0). The lens a picture's EXIF names is looked up
the first time it is met and the answer is kept on your device (see "The
network exceptions" above). A picture developed from its **sensor** gets the
profile by itself; a camera's own JPEG, or the render inside a RAW, is only
*offered* it (**Apply to this render**), because the body has often corrected
it already and correcting it twice bends it the other way. The profile is
worked out for the picture's own focal length and aperture, the way Lensfun
itself interpolates, and stored on the picture, so the export, another device
and a `.roll.json` draw exactly what you saw. It is calibration, not an edit: it
is not copied to another picture, not cleared by Reset, and the sliders correct
what it leaves. A DNG that carries its own lens correction keeps it, and the
profile stands aside.

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
Sharpen has Lightroom's four: **Amount**, **Radius**, **Detail** (how much of
a strong edge is sharpened — held back low, where a halo is born, while fine
texture keeps its gain; 100 is the plain unsharp mask, and a picture
sharpened before the slider existed reads 100 so it does not change) and
**Masking** (sharpen only where the picture changes steeply, so a sky's noise
and a cheek are left alone). **Show the mask** paints the picture white where
it is sharpened and black where it is not, on the Detail tab only; it never
reaches a thumbnail or an export.

**Which file.** A chip above the photograph says what it is developed from
(`JPEG · 8-bit`, `RAW · camera render · 960 × 540`…) and opens the
capture's files in three groups: *Quick* (the proxy your Winnow made), *The
camera's file* (its JPEG, or the render written inside a RAW) and *The
sensor*. Each file shows its megapixels, its size, its bits and how far it
falls short of the capture's biggest picture (`960 × 540 · 8.4× short`).
Under the sensor, one control picks how much of the camera's own calibration
to apply (*Gain*, *Gain map*, *+ Warp*, read from the DNG and offered only
where the file carries it). A file that is not here is fetched from its
instance and held for the session, its weight said before the click (`↓ 72
MB`); a DNG
beside a JPEG in a folder is the sensor with no fetch at all. The choice is
saved on the picture, so another device shows the same one, and the export
follows it. **For the whole roll**, a switch at the top of the same menu turns
*This picture* into *Whole roll* — *Proxy*, *Camera render* or *Sensor (RAW)*
— and choosing a file
on one picture offers *Use Camera render for the whole roll* right beside its
name (also asked when the roll is created). Every picture with no choice of
its own then opens on that file, the ones added later too: the roll holds one
choice, not a copy per picture, and one ⌘Z takes it back. A picture you chose
by hand keeps its own file and wears `≠` in the filmstrip. The camera's file
is taken only where it has more pixels than the proxy — the 960 × 540 render
inside a DJI DNG is not, so that picture stays on its proxy and its menu says
why — and a picture whose numbers were set on the render is never moved onto
its sensor by the roll. Each file is fetched when its picture opens, never the
whole roll at once; a clip never follows. **On a phone or a tablet** the sensor is decoded to what the
device can hold — 2560 px on the stage, 4096 px in an export, and the export
says when a picture left under its sensor's pixels — the decoder is let go
between pictures, and a picture you come back to is not decoded twice; the
loupe, which decodes the file whole on a computer, says *as close as this
device goes* instead — for every picture, not only a RAW. A big sensor is
decoded in **tiles**: LibRaw is asked for one band of the sensor at a time,
and pays its own buffers for that band alone, so a 36-megapixel sensor on a
phone never grows the decoder's heap past its first 256 MB — each tile costs
the file read again, cheap for a DNG, a moment for a compressed ARW, and
lands bit for bit where the whole decode would put it (a computer cuts only
past 24 megapixels). The sensor's white is white, whatever the picture
holds: the decoder no longer scales a frame by its own brightest pixel, so a
RAW metered before 2026-09-25 may open a touch dark under its stored
exposure — *Meter the exposure again*, in the rung menu, measures it anew.
A RAW is always
shown from the render its camera wrote inside it, never from the browser's own
decode of the whole file (Safari has one, and on an iPhone it was what closed
the tab on a zoom). **Every photograph is decoded at the size it is used**,
never whole and shrunk afterwards: its size is read from the file's header and
the browser is asked for exactly the pixels a stage, a filmstrip cell or an
export needs. A phone's stage works to 2560 × 1440 (a computer's to 4K), and a
phone exports a big JPEG at 4096 px on the long edge, like a RAW, and says so
in the run's summary; a computer still exports every pixel. A Studio export
of a photograph decodes only what its largest variant draws: a 1080 × 1350
post from a 48-megapixel still is decoded at 1800 px — often the picture
already on the stage — instead of the whole file, which on a computer took an
export of that post from thirteen seconds to under one. A browser cannot
ask a phone how much memory a tab may take, so the rule is coarse: iPhone,
iPad and Android count as phones, and *Device class* in Develop's settings
(below) overrides it. On a phone a big picture — a
full-size export, anything past 12 megapixels — is also graded in **bands**:
the graphics card holds a slice of the picture at a time rather than two full
copies of it, which on a 48-megapixel still is a few hundred megabytes instead
of three quarters of a gigabyte — with exactly the same pixels (a film stock's
halation still needs the whole picture at once). A computer draws it whole: it
has the memory, and the one Mac measured drew the loupe's bands striped. The
rule is a preference of this browser, **Big pictures** in Develop's settings
and under the Look panel's Interpolation — *Auto* (bands on a phone, whole on a computer, and it says
which this one is), *Whole*, *In bands* — and the loupe redraws the moment it
changes, so a striped loupe is one click from a whole one.

**Smooth skies stay smooth.** Between its steps the graphics card works in
half-floats, so a RAW or a picture with a layer, a warp or detail carries
more than 8 bits right up to the screen and the file — which are 8-bit, and
where a plain rounding would cut a pushed sky into flat steps a whole code
apart. That last rounding is **dithered**: a noise under half a code, the same
on the three channels and drawn per 2 × 2 pixels so a JPEG keeps it, turns
each step back into the gradient it was (measured on a ramp of 8 codes: half
a code of error at every step undithered, a fifth of that dithered, still a
fifth after a JPEG at 0.92). An 8-bit picture with no more than its global
develop and look is left exactly as it was — its steps are the file's own —,
a full-size file keeps the dither, and on a computer a smaller target (Web,
Feed) is resized from the picture's floating-point render and rounded **once**,
at its own size — dithered at 90 % and above, rounded plainly below, where a
JPEG measurably erases the dither and leaves only its noise (a phone, short of
memory for the float picture, still resizes the 8-bit render). *Dither the last rounding* in Develop's settings
turns it **Off** on this device: the rounding is then plain, as it was before. **A graphics card that cannot compute in
half-floats** (rare, on an old or a software GPU) falls back to 8 bits between
steps rather than failing, and says so: the chip above the photograph ends in
`· 8-bit GPU`, and the picture's notes say what it costs — a highlight a step
pushes above white is clipped before the next step can bring it back.

**Develop's settings** (the ⚙ in a roll's bar) gather what belongs to this
device rather than to a roll, and never travel with it, a preset or a paste:
*Encoder* — which code writes a JPEG and, measured, the colour it keeps at
85, 92, 99 and 100 % (the Export tab's *Encoder* line opens it) —,
*Rendering* — the dither, the look interpolation, Big pictures, how a
picture past 1:1 is drawn —, *Device* — the device class (applied on reload)
and where the subject model runs —, *Network* — whether lens profiles are
fetched from Lensfun —, *Automatic* — which steps the one Auto runs, and
whether a picture gets it as it opens —, and *Learning* — whether each
photograph is kept AS SHOT beside its develop (a 256 px picture, its light
and its camera's facts, a few kilobytes on this device, pruned with the
picture, never a position or a word; kept until you say no, and Off drops
them), and the *Training file*: every pair of every roll written into one
JSON file on your click, the records normalised, for a trainer outside the
browser to learn your hand from — nothing leaves by itself. A change reaches
the picture open behind the sheet at once.

**HEIC, HEIF, HIF and JPEG XL open in every browser.** Safari reads them
itself; Chrome and Firefox refuse them, so Atelier ships its own decoders —
libheif for an iPhone's `.HEIC` or a Sony or Canon `.HIF`, jxl-oxide for a
`.jxl` — served from this site like the RAW decoder and loaded only the first
time such a file is met (about 2 MB each, nothing at page load). A picture is
recognised by its bytes, not its name, and opens upright with its rotation
applied, in Develop, Trips, the Studio, the Library's covers and its
lightbox; a HEIF or JPEG XL original can deliver an export too. A small
view of a HEIF — a Library cover, a filmstrip cell — is decoded from the
thumbnail the file carries of itself (an iPhone writes one of about 320 px),
in milliseconds instead of the whole picture. Two limits: for anything
bigger these decoders cannot scale while they decode, so the whole picture
exists once, briefly, before it is shrunk to the size asked for; and a HEIF's colour
profile (an iPhone's Display P3) is not applied, so its colours land a touch
flatter than in Safari. TIFF is still not read.

**ProRAW in JPEG XL.** An iPhone ProRAW saved with JPEG XL compression is a
DNG the RAW decoder cannot read, so Atelier develops it itself: its sensor
data is already demosaiced, its tiles are decoded by the JPEG XL decoder on
several threads at once, and the camera's own colour matrix and white balance
are applied exactly as the RAW decoder would — measured against it on a twin
file, the two agree to a fraction of a code. A zoomed-in view decodes only
the tiles under it. Two honest limits: Apple's own local tone map is not
applied, so a ProRAW looks flatter here than in Photos (the develop is where
you give it its contrast), and it has not yet been tried on a real iPhone
file.

**White balance in kelvin.** On the sensor, the Adjust tab starts with
**White balance**: Lightroom's presets (*As shot*, *Daylight*, *Cloudy*,
*Shade*, *Tungsten*, *Fluorescent*, *Flash*), a **Temperature** in kelvin and a
**Tint**. The camera's own reading is *As shot*, read back through its own
colour matrix, and every value becomes the multipliers the camera would have
used under that light — so a picture shot under tungsten and set to Tungsten
is what the camera saw, and Daylight turns it warm. It exists only on a RAW: a
JPEG has no as-shot white to measure from, and its Temperature and Tint stay
the relative nudge they always were (they also work on top of a kelvin
balance). A white balance belongs to its picture, like the RAW's measured
exposure: copy, paste, presets and *Apply to* leave it where it is.

**Which pictures leave.** Every picture says whether it leaves: by default the
ones you **edited** do, and you decide otherwise per picture — send one you did
not touch, hold back one you did. The **Pictures** table in the Export tab
lists the roll one row per picture (the whole row is the click, with what the
picture would leave from and at what size), filtered by *Edited*, *Leaving* or
*Held*, and a box at its head ticks or unticks every row shown at once — a
filter first makes it a batch (every *Picks*, every *Edited*); a picture's
menu on its cell in the band does the same without leaving the photograph,
and the band's selection bar does it for several at once. **P** sends or holds the picture on the stage, **U**
puts it back on the rule (on the Layers tab, **P** and **M** belong to the
mask instead — Pick and the mask's view). A picture you do not want to work on at all can be
**ignored** (**M**, or its cell's menu): it never
leaves, **←/→** step over it, "apply to the other pictures" leaves it alone,
the band dims it or, from its filter, hides it, and a click still opens it. None of this is a
rating — culling stays Winnow's. Once a picture has been exported, its row
says when (`✓ 14:32`), and says **changed** if you edited it since — its
develop, look, crop, geometry, repairs, layers or words; a new export size or
quality does not count. The *Changed* filter lists the pictures that leave and
were never exported or changed since, the status line counts them, and
**Export N new or changed** delivers just those. The record is kept on this
device beside the roll, not in it, so an export is never an undo step and an
undo never forgets one.

The export buttons stay pinned at the bottom of the Export tab, whatever is
scrolled above them: **Export N pictures** (the ones that leave) is the main
button, and the menu beside it offers this picture, the band's selection
and the new or changed ones. While an export runs, that bar becomes the run
and stays on whichever tab you are working in: a segment per picture (green
when written, red when it could not be), the picture in hand with its stage —
*Fetch*, *Develop*, *Write* — and what it is doing in words, the time left once
a first picture has measured it, and **Cancel**, which stops at the next
picture and keeps what was written. The band is the queue at the same
time: a picture still to go is veiled, the one in hand turns, a written one
shows ✓ and one that could not leave shows !, and a hairline along the band's
top fills as the run goes.

An export works from the roll **as it was when you pressed the button**. While
it runs, the Export tab is locked and dimmed under a line that says so — its
settings, and which pictures leave (the **P** / **U** / **M** keys and the
band's menus answer that they are locked too), would only apply to the next export.
Developing, cropping and every other edit stay free: a picture you change
while the roll leaves is named when the run ends, its row says **changed**,
and **Export new or changed** sends it again.

**Variants.** One frame, developed two ways — cropped square and 4:5, or in
colour and in black and white — is two **variants** of it, Lightroom's virtual
copies and Capture One's variants. **⌘'** (or **Add → a variant of … as
edited**) makes a copy of the picture on the stage with everything done to
it; **Add → … as shot** starts one bare, keeping only what belongs to the
file (the RAW base, the lens profile). Each variant is a picture of its own
on the roll — its develop, crop, look, title and whether it leaves — and the
strip numbers it (`DJI_0101.JPG · 2`); the file is fetched and previewed once
for all of them. A variant leaves into a sub-folder named after it,
`Variant 2/DJI_0101.jpg`, so every delivered file keeps the capture's exact
name (`Web/Variant 2/…` for a second target). Adding the same file to the roll
twice is still refused: a variant is made from a picture already there.

**Adding what you culled in Winnow.** *Add ▾ → A day on your Winnow…* opens
the **Winnow picker**, the same one as the Library's *browse all*: a **day**,
walked with the Library's own stepper and its month (a bar per day, or the
weeks), or a **folder** as Winnow ingested it. Every tile wears Winnow's word —
the pick or reject flag, the stars, a label, a *Gallery* chip when a final
already links to it — and a rail of filters narrows the list: Incoming ·
Gallery · All, the verdict, a star floor, photos or clips, the extension, the
body, Winnow's tags, *no final yet*, *not on the roll*, each with its count.
The grid's ⋯ orders it by capture time or by stars, sets the tiles small,
medium or large, and folds the rail away on a wide screen (both remembered on
this device). A
**culled day opens with its picks ticked**, so taking what you kept is one
click on *Add N to the roll*; an unculled day ticks everything the roll lacks
but the rejects. The bar ticks among what is shown — **All**, **None**,
**Invert**, **⚑ Picks**, **★5**, **★4+**, or `A` `N` `I` `P` `5` `4` `3`, ⇧ to
add rather than replace, ⇧-click for a range — and counts a ticked picture a
filter hides rather than dropping it. A burst shows its cover and every frame
you picked or starred in it, and unfolds under the cover. **Space** looks at a
tile large, **Enter** ticks it there. What the roll holds is drawn *on the
roll* and cannot be ticked twice; adding takes references, and a picture's
bytes are fetched when you open it. The filters are remembered per instance,
shared with *browse all*.

**Winnow's culling, where you edit.** A picture that came from a Winnow
instance wears what you decided about it there — a flag for a **pick** or a
**reject**, its **stars**, and a colour dot if it has a label — on its
filmstrip cell and on its row in the Pictures table. The status line counts
the picks and rejects and **filters the strip** on them: *picks*, *not
rejected*, or *★★★ and up*. A filtered picture leaves the strip (the one on
the stage stays), **←/→** step over it, and "apply to the other pictures"
writes only to the ones still shown, so *show picks* then *Apply to N other
pictures* develops your picks alike. The Pictures table has a *Picks* filter
too. It is **read-only**: nothing here writes to Winnow, and nothing of it is
kept in the roll — it is asked again when you come back to the tab, so a pick
made in Winnow meanwhile shows up, and **Refresh** asks at once. A picture
from this computer has no culling to show, and only *show all* or *not
rejected* keep it in the strip.

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
one blown up to fill its aspect; the **Size** is a ceiling and never upscales
— a long edge, a short edge (a feed that wants 1080 px across), an area in
megapixels, or a share of the picture. One run can write up to four
**targets**: the full picture for the archive and a 2048 px set for the web,
say, each with its own size, quality and **screen sharpening** (applied to
the file after its resize, since a picture brought down to 2048 px is softer
than it was). Each picture is rendered once and cut to every target. The
first target writes into the folder you choose, each other one into a folder
inside it named after the target, and every file keeps its picture's name —
`DJI_0101.jpg` and `Web/DJI_0101.jpg` are the same photograph (a download,
where there is no folder picker, becomes `Web-DJI_0101.jpg`). A new target
starts from a preset — Full size, Max · quality 100, Web · 2048 px, Feed ·
1080 px across, Mail · 2 MP, Half · 50 %. Under a JPEG target's quality, the
panel says how much of the **colour** this browser's encoder keeps at it —
measured by writing a small picture and reading its header, never assumed:
Chrome keeps a quarter of it (4:2:0) below 100 % and all of it (4:4:4) at
100 %, and that halved colour is what draws blocks along a saturated edge and
in a smooth sky. **Max** sets 100 %, a file of Lightroom's weight at its own
100. A target can carry a **watermark**: a line such as
`© {year} {creator}` (the name set under Metadata, the year the picture was
taken, `{title}` its own title) in a corner or along the bottom, sized as a
share of the file's short side and drawn after the sharpening; its style is
the roll's, and each target switches it on, so the web copy is signed and the
archive left clean. A line that names its author before a name is set is not
drawn, and the run says so. Each picture leaves from the file you chose above the
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

**Making-of.** Every write to a picture is also a step of its **journal** —
what changed and the values it left, kept on the picture with the roll, undone
and redone with the edit, coalesced like the undo (a slider drag is one step),
never copied by an apply-to and never counted as an edit. The Export tab's
**Making-of** row (or **Making-of video…** in the export menu) opens that
journal as a short video for a feed: a hook (the finished picture, then the
file as shot and a tease — or the inverse, or the two flashing), then a chapter
per tool in the order you worked, each the picture going from before to after
under a caption that says the difference (`+0.7 EV · highlights −40`, `Crop
4:5 · straighten −2.0°`, `Heal ×3`, `Sky · −0.6 EV`, `Portra 400 · 80 %`), the
camera zooming to where the tool worked (a heal's spot, a mask's box — read in
the step itself, never guessed), the crop's zone growing over the picture, a
heal's rings and a mask's fill drawn, then a before/after at the end (a wipe,
a split or a flicker) with the camera plate and your credit. The sheet plays
it exactly as the file will be, over the picture's own bytes — the sensor's
when you developed it on the RAW — and holds the roll's choices as pills:
9:16, 4:5, 1:1 or 16:9; 10, 15, 30 or 60 s (a longer video keeps more chapters,
the lightest fold into the next); the hook, the reveal, the camera; an
optional **beat** that lands every cut on a half-note grid so a track laid on
the file in the socials app finds its downbeats on them (the file carries no
music); a **sound** — none by default, or one of the openers' tick kits: a tick
where each chapter starts, a deeper one at the tease, the seat at the reveal,
rendered here and encoded to AAC like a hook's ticks; the ground round the
picture; and five switches — captions, the step counter, the tools drawn, the
plate, the credit. The **hook** and the **reveal** take the same choices: a
figure (cut, fade, wipe, split or flicker), which picture comes first, a length,
and a back-and-forth that compares the two three or five times before landing.
The **tease** ("How?") stays for as long as you set, or stays on screen as the
video's title. The **ending** holds the finished picture after the reveal (up
to 8 s, still, pushing in, pulling out or drifting), can **loop** — its last
half-second fades into the first frame so a feed's autoplay replays it with no
seam — and can carry an **end line**, a call to action in the accent, typed or
picked from ready-made ones. The clock is a hairline, story-style bars along
the top, or nothing. A **Style** section dresses every word of the video at once:
the font (VT323 by default, JetBrains Mono, Space Grotesk, Instrument Serif, Georgia), a
size from 70 to 150 %, bold, capitals, a box, a shadow or nothing behind the
words, the box's corners (square to pill) and opacity, and three colours — the
words, the box or shadow, and the accent of the tease. A long line wraps on its
facts and steps down in size rather than leaving the frame. Each chapter's caption can be
rewritten (an emptied one gets the computed line back) and any chapter folded
away — its change still happens, it rides the next one; the order is never
reordered. A picture edited before the journal existed has its steps told in a
standard order and the sheet says so. **Export the making-of** asks for the
folder at the click, grades every state once, encodes at 30 fps (H.264 — a
browser that cannot encode it is told before the click) and writes
`DJI_0101-making-of.mp4` beside your other exports: a suffix, since a video is
not a rendition of the picture and `DJI_0101.mp4` would be paired with its
capture as one. The run shows on the same bar and masthead pill as a roll's
export, with a Cancel; the file lands in the Library like any clip, so it can be
a Trips slide or a Studio rush with nothing more to build. Grain is frozen in
it — every state is graded once, like a painted hook clip.

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

**Where the tool has your picture open, the gallery shows it.** On a desktop
the picture takes a column of its own at the left, as tall as the dialog — a
portrait frame gets the whole height, a landscape one half the width — with
the look you are aiming at drawn on *that* photograph, and its name, its
strength and an A/B wipe in a card under it; the wipe reads before on the
left, after on the right, the way Lightroom and Capture One put it, and a drag
across the picture moves the divider. The looks are a panel at the right: the
filter, what the tiles are shown on (their reference frames, or your picture),
the families, the grid, and the verb pinned in the footer. So the gesture
there is aim, then take: the first click shows the look on your picture, and
the look is yours on the second click, on "Use this look", or on Enter — the
arrow keys walk the tiles. Where no picture is open there is nothing to aim at
and a click is the choice, as it always was. On a phone the picture is a band
over the grid and the verb sits in the thumb's reach.

It costs one lattice — the look under your eye — and that is the point: the
grid keeps its cheap pre-baked tiles, which is also what makes two looks
comparable, since every tile is the same subject. The picture shows the look
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
re-activates. Each tile also wears what you decided in Winnow — a flag for a
pick or a reject, its stars. "Browse all" opens the **Winnow picker** where the
tab is looking — its day and its half — to tick many at once: by day (the
same stepper and month) or by folder, every tile with Winnow's verdict, a rail
of filters with their counts (Incoming · Gallery · All, verdict, stars, type,
extension, body, tags, no final yet, not in the library), tick verbs over what
is shown (*Picks*, *★5*, *★4+*, All, None, Invert, and their keys), **Space**
to look at a tile large. Nothing is ticked when it opens — an add downloads —
and the files come as **proxies**, or as **originals** with their weight shown
first; a Cancel stops the download and keeps what landed. A DJI clip brings its
flight log along either way.

When the Winnow serves its **timeline** (media grouped into legs by place and
date), a trip can be seeded from it: the legs become the trip's stages — span, places, order — and nothing
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
suite's optional network requests (see "The network exceptions" above),
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
Like the Flight Map's, it draws **offline** on a plain backdrop until you press
**"Load map background"**, which adds the same OpenStreetMap tiles (revealing
the viewed area to the tile server); an export burns in whichever of the two
the preview shows.
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
│   │                           #   a photograph read as the one telemetry cue it is worth,
│   │                           #   and camera-facts (a credit's facts, picked à la carte)
│   ├── overlay/                # the overlay engine: element model, canvas stage,
│   │                           #   draw/measure/hit-test, fonts, guides, burn-in export,
│   │                           #   animation + scenes (the intro layer, pure), still-frame
│   │                           #   (a deck settled for a still), camera-plate (a credit's
│   │                           #   eight layouts as text elements), and the
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
