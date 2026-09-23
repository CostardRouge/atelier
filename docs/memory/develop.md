# Develop — the workbench, its hosts, and the Develop tool

Read when you touch `src/shared/develop/`, the Develop modal in Trips or the
Studio, or the Develop tool. The engine (the develop stage in the cube) is in
`media-pipeline.md`; each host's storage rules are in `roadtrip.md` and
`studio.md`; the tool's plan is `docs/develop-tool.md`; delivering from an
original is `docs/develop-originals.md`. The roll document, the preset book,
the tool's shell and its editor are in `develop-roll.md`.

## The Develop tool is the third editor, over a roll (2026-09-15)

**Decision (maintainer).** A third official tool beside the Studio and Trips,
"with about the same interface as the modal". Four choices, all his: it opens
a **roll** (a document of pictures, each with its develop, crop and — since
roll v5, 2026-09-23 — its own look, plus the roll's export — not a Library view, which would lose its numbers on
reload, and not a hash-keyed catalogue, which would break never-inherit);
**presets are one personal book** shared by the tool and both modals, synced
like a document, trips' lists merged in once and never written again; **v1**
has crop · straighten · flip, JPEG export + send home, filmstrip + batch, a
histogram; and **the shared foundations were built first**, the per-tool
document plumbing left for the roll's own phase (the third copy is where it
gets extracted). It reverses `photo-develop.md` §7.5 ("no ninth tool") and is
NOT the photo studio `studio.md` rejected in August. Plan, seams and phases:
`docs/develop-tool.md`.

## The workbench is shared blocks, and the modal is one layout of them (2026-09-15)

**Decision.** The maintainer wants a third official tool for developing
photographs "with the same interface as the modal", and asked that what the
two share be built once, before the tool exists. So `DevelopSheet.tsx` is now
a dialog that LAYS OUT blocks, and every block is usable by a full-screen
host:

- `use-develop-draft.ts` — `useDevelopDraft(value, stack)`: the numbers, riding
  the host's stack (`stack.setDevelop`) while mounted and put back on unmount;
  `result()` is null when as shot. `useTold()` is the fleeting status line.
- `use-develop-picture.ts` — `useDevelopPicture({file, videoTimeSeconds, cube})`:
  decode within the stage budget, ONE held grader, the paint with the split,
  `usePictureZoom`, and the wipe gesture as `handlers`. State only.
- `DevelopViewport.tsx` — draws that state; the HOST sizes it (`className`) and
  says what an empty frame means (`emptyText`). `DevelopCaption` is the line
  under it.
- `DevelopSliders.tsx` — Light · Tone · Colour and `DevelopSlider`.
- `DevelopSections.tsx` — `DevelopClipboardActions`, `DevelopPresetsSection`
  (owns its naming field, reports it through `onNaming` so Enter belongs to the
  field), `DevelopApplySection`, `DevelopLookSection`. Each reports what it did
  through `onTold`.
- `develop-host.ts` — the host contracts `DevelopPresets` (with `keptOn`, said
  in the ⓘ, and an optional `place`: where the list is kept and the move) and
  `DevelopApplyVerb`.

**Why**: the sheet held Trips' wording ("tick one in the Library", "kept on the
trip") and a tool would otherwise have copied 700 lines including the grader
lifetime and gesture traps. **How to apply**: a change to how a picture is
developed goes into a block, never into `DevelopSheet.tsx`; host words come in
as props; a host that shows another picture under a mounted workbench remounts
the draft with a `key` per picture (`value` is read once — the never-inherit
rule). Verified in the Browser pane on Trips after the split: eleven sliders,
the wipe, the zoom pill, Save current as… with Enter kept by the field, a
preset applied after As shot, Copy enabling Paste, Done writing `+0.7 EV` to
the Picture tab row.

## The inspector row is one component too (2026-09-15)

`DevelopSection.tsx` is the settled row every host draws (sentence · `↺` ·
`Develop…`); Trips' Picture tab and the Studio's Grade tab carried the same
markup twice and differed only in the id, the ⓘ and what opening does. A third
host (the tool's inspector, a lightbox verb) draws it rather than a copy.

## Writers that do not belong to a tool (2026-09-15)

The list rules for presets (a taken name replaced in place keeping id and
position; a blank name or an as-shot develop saves nothing and hands back the
SAME list; a name is taken whatever its casing, and the new spelling is kept)
are `develop-presets.ts`'s `savePresetIn` / `removePresetFrom`, and the book
(`preset-book.ts`) goes through them. The Studio's per-media map goes through
ONE writer, `media-develop.ts`'s `writeDevelop` (Done and the batch verb had
each a copy).

## The histogram is a strip of what is DELIVERED (2026-09-15, D1)

`histogram.ts` (pure, tested) + `DevelopHistogram.tsx`, read by
`useDevelopPicture` and drawn at the top of the column. Rules: it measures the
GRADED picture whole — never the split or "hold for before", which are ways of
looking, not what goes out — so it is keyed on the source and the cube, not the
wipe. It reads a 160 px copy (`HISTOGRAM_SAMPLE_EDGE`): the shape does not
change with pixel count and a stage-sized read-back would cost tens of MB per
slider step. Luma is Rec.709 on the ENCODED values (what a screen shows); a
pixel is clipped when ANY channel is at 254+, crushed only when ALL are at 1-;
the shape is scaled on the inner bins so a blown sky does not flatten the rest
— the end bins are capped and the marks say the share in words. **Trap**: the
read is scheduled on `requestAnimationFrame` so a slider paints first, but a
page that is not compositing (the desktop app's hidden Browser pane) never
fires rAF even while `visibilityState` says visible — a 120 ms `setTimeout`
races it, whichever comes first. The bars are a fixed light over `bg-frame`,
never a theme token: `paper` is dark in the darkroom. Verified in the Browser
pane on a PNG with a known 6.25 % white block: `whites 6.3 %` at as shot, 28 %
at +1.5 EV (over the hook's stored +0.7), none and `blacks 2.5 %` at −2 EV.

**RGB, the clipping view and the readout (2026-09-23, audit item 15).** The
strip draws R, G and B apart (`channelShapes`, one scale for the three, SVG
`mix-blend-mode: screen` so overlap goes white); `Histogram.bins` (luma) stays
for the curve's backdrop. What counts as clipped is ONE rule,
`render/clipping.ts` (`clipOf`: white if ANY channel ≥ 254, black only if
EVERY one ≤ 1), read by the strip's percentages, by `clip-pass.ts` (its GLSL
twin, tested on the value the canvas WILL round to — ≥ 253.5/255, < 1.5/255)
and by the readout. The view is a PASS after sharpen and under the mask's wash,
asked for only by the stage and the loupe (`graderFrom`'s last argument) — the
histogram, `delivered()`, `snapshot()` and every export pass nothing, so it can
never leave (measured: the percentages do not move with J). The **readout**
reads ONE pixel of the stage canvas per animation frame under a mouse or pen
(never a finger, which pans) and is a STORE (`readout-store.ts`), not state:
as state it re-rendered the whole workbench per mouse move; only
`DevelopHistogram`'s line subscribes. A painted pixel would read as the mark's
own numbers, so the marks are Lightroom's red `255,0,0` and blue `0,128,255`,
each with a channel at 255 — no UNPAINTED pixel within a step of one can exist
(it would be clipped to white and painted), so `readoutOf` decodes a mark back
to *clipped to white* / *crushed to black* exactly. Known limit: the film node
draws LAST, after the pass, so a grained picture's marks carry grain and a
readout over them shows numbers. The view is never remembered past the session
(a red wash met on the next visit reads as the picture). Verified headless on
a PNG with white, black, a red-only clip and a mid grey: every mark where the
rule says, the readout decoding each, J and the end words toggling.

## The curve editor is a workbench block, and its drag taught two rules (2026-09-17, P1)

`DevelopCurve.tsx` (the paint and the pointer plumbing) over `curve-edit.ts`
(pure, 19 specs: `pointAt`, `moveCurvePoint`, `addCurvePoint`,
`removeCurvePoint`, `curvePath`). One square with the picture's own histogram
behind it, the five channel tabs, and the `curves.ts` spline over the identity
diagonal. Drawn by BOTH hosts from the same block — `DevelopSheet` and the
tool's `PictureWorkbench` each gained three lines — and the draft hook grew
`patch(partial)` for a field `set(key, value)` cannot name.

**Two rules the browser found, neither of which any test could have:**

- **A drag must read the value from a REF, not from the render's closure.**
  Pointermove fires far faster than React re-renders, so every move of a drag
  applied to the curve as it was when the pointer went DOWN, and the last write
  won: a drag from the middle of the diagonal stored TWO points instead of
  three, silently throwing away the point the same gesture had just added.
  `liveRef` (the curve) and `grabRef` (the point) advance synchronously on
  every write; the `dragging` state is kept for the PAINT alone. Same family as
  the crop pinch's "two writes in one event" (`develop-roll.md` D8) and the
  roll's one updater — **assume it for any new drag that writes a structure.**
- **`vectorEffect="non-scaling-stroke"` puts `strokeWidth` in SCREEN pixels.**
  With a `0 0 1 1` viewBox a width of 0.008 is then sub-pixel and the curve did
  not appear at all — invisible, with all four gates green and no console
  error. Every stroke in that box now carries the attribute AND a pixel width.
  A drawing whose only failure mode is "nothing is there" has to be looked at.

**Levels have no panel on purpose.** The engine carries them
(`curves.ts`), but a curve whose END points drag is already the black/white
point gesture, so a second control for the same thing would be clutter. The
numeric row arrives with the auto-adjust that computes it (P2 of
`docs/photo-editor.md`), which is what levels are naturally the target of.

Verified in headless Chromium against the real dev server, on a canvas-made
gradient dropped onto a roll: the editor drew with the histogram behind it, a
drag from mid-diagonal to 0.12 stored
`luma: [{0,0},{0.5,0.68},{1,1}]` through the roll's write-through, the stage's
pixels moved (26→49, 89→177, 150→255 on the ramp), the settled row read
`curve luma`, the tab wore its dot, and no page error fired.

## Auto is TWO verbs, measured on the picture as shot (2026-09-17, P2)

`auto-develop.ts` (pure, 20 specs) + the `Auto` and `Levels` sections of
`DevelopAuto.tsx`, drawn by both hosts; `useDevelopPicture` gained `stats`, an
AS-SHOT read keyed on the source alone. Rules a later phase must keep:

- **Tone and colour never share a click.** A tonal stretch is almost always an
  improvement; a white balance is *exactly wrong* on a sunset, a candle-lit
  room or anything warm on purpose. One "Auto" doing both would make the good
  half unusable, so there are two buttons and no menu.
- **Auto measures the SOURCE, never what is displayed**, so it SETS the numbers
  instead of nudging them and a second press is the same answer. Driven in the
  pane: pressing both twice more left every number identical. A read off the
  graded result would compound, which is the whole reason `stats` is a second
  sample and not the histogram.
- **The maths is solved against this suite's own model**, not against a
  textbook: the level's gamma is `ln(m)/ln(target)` because `makeLevel` raises
  to `1/gamma`, and the white balance is solved for `developLinear`'s two
  reaches (`TEMPERATURE_REACH`, `TINT_REACH`, exported for it). So what Auto
  writes lands where it aimed — a spec develops a flat field through the
  numbers and asserts the channels meet.
- **Two traps the numbers hid.** Round the temperature BEFORE solving the
  tint, or green aims at a level red and blue never reach (a slider holds whole
  units). And solve the tint against the temperature actually KEPT: a cast past
  the sliders' reach clamps, and the tint must aim at where red really landed.
- **A clamp is said out loud** (`AutoColour.clamped` → "as far as the sliders
  reach"): two gains with a range cannot neutralise every cast, and a panel
  that quietly hands back a still-cast picture as though it were balanced is
  the fabrication the battery gauge refuses.
- **Clipped and crushed pixels do not vote** for the white balance: a blown sky
  is (255,255,255) whatever it really was, and letting it in drags every
  picture toward neutral.
- **The median is pulled only PART of the way to mid-grey** (0.6 of it), so a
  picture that is dark because it was meant to be keeps its character.

**No Kelvin on an 8-bit picture, and that is deliberate.** Temperature here
is a channel GAIN, and an 8-bit render carries no as-shot white balance to
offset from, so a number in kelvin would be invented. On a RAW it is real since
2026-09-23 (`raw.md`, «White balance in kelvin») — and only there.

`DevelopSliders.tsx` gained `RangeSlider` — the same row with an explicit
label, range and reset — because Levels needed it and a second copy is how two
panels come to disagree about what a slider looks like.

**The eyedropper is the same solve on a different input** (2026-09-17, P2's
second commit). `whiteBalanceFor(linear)` is extracted from `autoColour`, which
now calls it with the picture's mean while *Pick grey* calls it with the pixel
the author said was neutral — one solve, so the button and the dropper can
never disagree. Rules:

- **It reads the picture AS SHOT**, never the graded canvas, or every pick
  would be measured against the last one.
- **It re-renders the ungraded source through the VERY SAME draw branch the
  viewport paints with** (`drawFramed` when a crop is open, else the plain
  `drawImage`) and reads there. That is why no inverse of the framing transform
  has to be derived, and why a crop cannot make the dropper read the wrong
  pixel — the one place a coordinate mapping could have gone quietly wrong.
- **The letterbox is undone by hand, the zoom is not**: the canvas is
  `object-contain`, so the bitmap sits inside the element box, but the box's
  own `getBoundingClientRect` already carries the zoom/pan transform.
- **A 5×5 average, not one pixel**: one pixel of a photograph is noise, and a
  white balance set from noise wanders.
- **While armed the dropper takes the gesture WHOLE** — the viewport's wipe and
  pan handlers are dropped for that click, since they are the same pointer and
  would drag the picture out from under the pick.

Verified in the pane on a picture that is blue on the left and warm grey on the
right: picking each half gave opposite answers (+100/+100 against −84/+36), which
is what proves the mapping reads where the pointer actually is.

Verified in the pane on a deliberately flat, warm JPEG (70..150, 1.18/0.82
cast): Auto tone wrote `black 69 · white 155` and NO colour; Auto colour wrote
temperature −100 (clamped, said) and tint −36; both pressed again changed
nothing.

## A RAW draws today, from the render its camera wrote inside it (2026-09-17, P3)

`shared/exif/raw-probe.ts` (pure, 12 specs) walks a RAW's IFDs through
`exif-parser.ts`'s OWN reader — `parseIfd`, `num`, `nums` are exported for it,
so the suite has one TIFF parser and not two — and `extractRawPreview` slices
the camera's embedded JPEG out. **No decoder, no dependency, no network**: a
DNG or an ARW now opens in Develop, where it used to say "no browser decodes
this". Rules:

- **PHOTOMETRIC is the discriminator, never compression.** A DNG's sensor
  plane is very often compression 7 as well (lossless JPEG), and taking it for
  a preview hands the browser a CFA mosaic. A render says YCbCr or RGB (6, 2,
  1); a sensor plane says 32803 (CFA) or 34892 (LinearRaw).
- **Walk the SubIFDs (tag 330).** A DNG keeps the sensor plane and the
  full-size render there; reading IFD0 alone finds the thumbnail and misses
  both.
- **Do NOT bounds-check the preview pointer inside the probe.** It reads only
  the first megabyte, and a full-size render in a 60 MB DNG sits far past it —
  checking there threw away the one preview worth having. `extractRawPreview`,
  which knows the real file size, is where the pointer is checked. Pinned by a
  spec with a 45 MB offset.
- **The decode falls back in `loadBadgeSource`, not only in `decodePhoto`** —
  that was the first attempt's mistake, and the picture stayed black. Every
  editor stage decodes through `badge-render.ts`; `photo-frame.ts` is the
  export path. Both now try the preview, and both keep the honest refusal for a
  RAW that carries none.
- **The Library's cover comes from the same render** (2026-09-23, the
  maintainer's ask): `loadImageMeta` falls back to `extractRawPreview` for a
  RAW the browser refused, cuts the 200 px cover from it, and lists the
  SENSOR's pixels (`rawSizesFrom`, the head read once and handed to both) —
  never the render's, which on a DJI would caption a 36-megapixel file
  `960×540`. A RAW with no render keeps the type-only box, and the lightbox
  still refuses (an `<img>` over a RAW says where the picture can be seen).
- **`pictureFidelity` tests `isRawImage` BEFORE the media type.** A RAW off a
  disk usually carries an EMPTY type, so asking the type first labelled every
  DNG a clip. The chip reads `RAW · camera render` and the note says it is the
  camera's JPEG and not the sensor data — the picture on screen is a RENDER,
  and letting it pass for the file's own pixels is the fabrication this rule
  exists to stop.

**The spike is ANSWERED for a DJI DNG** (2026-09-20, two of the maintainer's
own files): an uncompressed 16-bit sensor plane, a **960×540** embedded render
against 8064×4536, GainMap + WarpRectilinear opcodes LibRaw ignores, and the
decode timings — all of it in `raw.md`, «What a DJI DNG actually holds». The
`8064×6048 · sensor JPEG XL · preview 4032×3024` line once written here was a
format EXAMPLE and never a measurement; the real files say something else, and
this is why a DNG looks pixelated beside macOS. ProRAW JPEG XL and ARW still
need his files (`docs/photo-editor.md` P3).

Verified in the pane on a synthetic DNG built around a real canvas JPEG: the
probe read `4000×3000 · sensor JPEG · preview 640×480 · 1 opcode list`, the
stage drew the embedded gradient, the chip read `RAW · CAMERA RENDER`, and the
filmstrip cell showed it.

## A picture says its PIXELS, not only its bits (2026-09-20)

**Why.** `pictureFidelity` named the material and never the size, so a DJI
`dji_fly_*.DNG` read `RAW · camera render` — true, and useless against the
report it caused (*"sharp in macOS Preview, pixelated in Atelier"*). The
render inside that file is **960 × 540** against an 8064 × 4536 sensor plane:
0.5 of 36.6 megapixels, 8.4× short on the long edge. The number IS the answer,
and nothing on screen was saying it. `DecodedPhoto.viaRawPreview` had been
returned by `photo-frame.ts` and read by nobody since P3.

**What it is now.** `pictureFidelity(file, base, pixels)` — the chip carries
`· 960 × 540`, the note the megapixels and, when the file's own pixels are
known, the shortfall (`8.4× short on the long edge of its 8064 × 4536`).
`megapixels`, `pixelsLabel` and `shortfallLabel` are pure and tested beside it.
Rules a later agent must keep:

- **Nothing is claimed that was not measured.** With no `pixels` every
  sentence is exactly what it was before; `shortfallLabel` returns null inside
  2 % of the file's own long edge, so rounding is never dressed up as a loss.
- **`usePicturePixels` measures only where the size SURPRISES and the decode
  is cheap** — a source's proxy (2048 px at most) and a RAW (its render is
  small by definition). An ordinary original is NEVER decoded a second time to
  caption it: a 48-megapixel decode is 194 MB, which is the whole reason the
  stage works to a pixel budget. A host that already measured passes `shown`.
- **The file's own pixels come free**: `MediaOrigin.width/height` behind a
  proxy, `rawSizes()` (a megabyte of the head, no decoder) for a RAW's sensor
  plane. `rawSizesFrom` is its pure twin, for a head already fetched.
- **`rawSizes()` reports the pixels as they are SHOWN** (2026-09-22): both
  sizes are transposed where the capture was held on its side, so the chip and
  the *sensor* rendition row stop printing transposes of each other for one
  photograph, and the delivery headroom is measured on the right axis.
  `RawIfd.width/height`, `sensorIfd()` and `describeRaw()` stay the file's own
  UNROTATED statement — the two views are deliberate, do not unify them
  (`media-pipeline.md`, `raw.md`).
- **The sheet says it, not its hosts.** `DevelopSheet` computes the fidelity
  from the file it was given; Trips and the Studio passed two strings each and
  now pass none, so the three Develop screens cannot drift apart. The props
  survive as overrides that nobody uses.
- **`measurePicture` goes through `decodePhotoSource`**, so a RAW is measured
  at all: a bare `createImageBitmap` refuses a DNG, which left the *Delivers*
  row saying `—` for every RAW on a disk while the run cheerfully delivered
  its embedded render.

Verified in the pane on a synthetic DJI-shaped DNG (an 8064 × 4536 CFA SubIFD
and a real 960 × 540 canvas JPEG as the render — the recipe is in
`testing.md`): the chip read `RAW · camera render · 960 × 540`, `I` drew
*"960 × 540 · 0.5 MP, 8.4× short on the long edge of its 8064 × 4536"*, and
the Export tab's row read `Camera render 960 px → 960 · exact` where it used
to read `—`. An ordinary JPEG beside it read `JPEG · 8-bit · 1600 × 1200`.

## The colour mixer is a develop STAGE, last, in every host (2026-09-23, audit item 12)

`mixer.ts` (pure, tested) + `DevelopMixer.tsx`: `DevelopSettings.mixer`, three
arrays of eight (hue · saturation · luminance, −100..100, Lightroom's bands at
0/30/60/120/180/225/270/315°), null for none — optional, so nothing migrated,
and wired into `isDefault`/`clone`/`same`/`normalise`/`developLines` like the
curves. It runs LAST in `developLinear` (after saturation and vibrance, as in
Lightroom), so it bakes into the one cube and reaches the stage, every export,
every layer and the presets/clipboard for nothing. Rules: the bands are a
PARTITION OF UNITY (a raised cosine between neighbouring centres — equal moves
on all bands equal one global move, no hole between two); every move is
weighted by the pixel's HSV saturation on the ENCODED values (0 at grey, full
by 0.5 — `chromaWeight`), so a grey is bit-identical whatever the bands say;
a hue shift (±30°, never past the next band) is rescaled to the luminance it
had, so hue does not double as luminance; luminance is a gain (±1.5 stops at
full colour); headroom above white is read on its colour and scaled back. It
is in the Trips/Studio SHEET too, not only the tool: it is a global number of
the develop record like the curve, and a mixer pasted or preset into a sheet
that could not show it would render with no control to undo it — "the modals
gain rendering, not panels" is about layers, masks and repair. Not built: the
targeted tool (drag on the picture to move the band under the pointer).
Verified headless: blue luminance −100 took a `70,130,220` sky to `43,83,144`
with a red and a grey unmoved; red hue +100 turned `220,60,40` orange at the
same luminance; ⌘Z undid it.

## Black and white takes the mixer's PLACE, and the mixer waits (2026-09-23, audit item 18)

`DevelopSettings.mono` (`MonoMix` in `mixer.ts`): null is colour, `{ mix }`
IS the treatment — a straight conversion at all zeros is NOT as shot
(`isDefaultDevelop` says so, a document stores it). While set, `monoLinear`
replaces `mixLinear` in `developLinear`: the pixel's luminance times the light
of the bands its hue sits in (the mixer's `bandWeights` and `chromaWeight`,
±1.5 stops), so a grey stays its own grey; the colour mixer is KEPT, not
applied (Lightroom's behaviour — switching back finds the colour work), and
grading runs after, so the wheels tint the grey (a split tone). UI: the
Colour / B&W switch heads the mixer section, which then draws the eight
lights; `V` flips it in the Develop tool (⌘V stays paste). Verified headless:
V turned a `70,130,220` sky to `130` grey at its own luminance, red +60 /
blue −100 took it to `84` and a red to `154`, a shadows wheel tinted the
grey, Colour gave the picture back untouched.

## Colour grading is the stage after the mixer, three ranges that sum to 1 (2026-09-23, audit item 14)

`grading.ts` (pure, tested) + `DevelopGrading.tsx`: `DevelopSettings.grading`
— four wheels (shadows · midtones · highlights · global: hue 0..360,
saturation 0..100, luminance −100..100) plus `blending` (0..100, 50) and
`balance` (−100..100) — optional, null for none, wired into the record like
the mixer and run AFTER it in `developLinear` (Lightroom's order), so it bakes
into the cube and reaches both sheets, layers, presets and the clipboard.
Rules: the three ranges are a PARTITION OF UNITY over the encoded luma
(`zoneWeights`: shadows fall from black to a pivot, highlights rise from it,
midtones are the rest and peak AT it; balance moves the pivot ±0.25,
blending is a gamma `2^((50 − b)/50)` on the two ramps); weights are read at
the luma the pixel ENTERS with, so a wheel's own light cannot move it into
another range; a tint is a per-channel gain of luminance 1 (`hueGain`)
pulled by the saturation (×0.25 at 100), and the pixel is brought back to its
own luminance before the zone's stops (±1) apply — a wheel colours and never
brightens, black stays black. Hue is kept while the saturation is 0, so the
colour is found again. Blending and balance with no wheel moved are "none" and
do not survive a reload — they shape nothing. The wheel is a `role="slider"`
div over a CSS conic gradient (0° at the right, clockwise — `wheelPoint` /
`pointOnWheel` are the geometry, in the spec), arrows turn/strengthen it,
double-click clears its colour. Verified headless on a 30/128/230 grey ramp:
shadows 220°·70 gave `27,29,43` with the 128 midtone untouched; highlights
40°·40 by keyboard `238,228,222`; global light +50 lifted all three; ⌘Z
undid the last move.

## The inspector's sections FOLD, for the session (2026-09-23, the maintainer's ask)

Once the Adjust tab passed a dozen blocks, every section holding two
controls or more became an `InspectorSection` — the one fold Trips and the
Studio already use, not a second one — through `DevelopFold`
(`shared/develop/DevelopFold.tsx`, ids `develop.<block>`): Light, Tone,
Colour, Presence, Levels, Curve, the mixer, grading, Presets, Apply to…,
Look on Adjust; Repair, Noise, Sharpen on Detail. **His rules**: the fold
survives changing picture but is NEVER on the document — it lives in
`sessionStorage` (`remember: 'session'`), so a reload keeps it and a new tab
starts from the defaults; Auto is NOT foldable (one row of verbs), nor is
Fringing (one slider) or an Apply-to with one verb — they wear the same
header with no chevron (`foldable: false`). **Mine** (he left it to me):
folded by default are Levels, Curve, the mixer and grading, what a pass over
a picture reaches for last; a folded section with anything set in it keeps
an accent dot after its title (`marked`), or folding would hide an edit. A
layer's sliders and curve fold under their own ids (`foldPrefix="layer."`).
The Develop tool and the Trips/Studio sheet share the ids. The column's
`gap-4` was dropped on Adjust, Detail and in the sheet: a section brings its
own rule and padding, and both was the air twice. **Trap met**:
`shared/develop/DevelopSection.tsx` already exists (the settled row) — a
`cat >` over it erased it; it was restored from git, hence the name
`DevelopFold`.

## Slider reset: a dot, bold and a dimmed ↺ — never hover-only (2026-09-20)

**Decision (maintainer, from an artifact proposal comparing five variants).**
`RangeSlider` (`DevelopSliders.tsx`) draws a changed field with an accent dot
ahead of the label, the label in bold, and a small ↺ button (`Icons.reset`)
that stays visible but dimmed at rest and turns accent-coloured once changed
— never hover-only, since the workbench is used on phones with no hover. The
row's own double-click-to-reset (already shipped) is kept alongside it for
whoever already reaches for it. **Why**: of the five variants drawn (a
hover-revealed icon, this persistent dimmed icon, a label-only double-click,
an appearing "Reset" text link, and this combination), only the persistent
icon and the text link work without a pointer that hovers; the dot+bold pair
beat italic/a tinted label because it reads fastest scanning a column of
eleven sliders at a glance. **Verified**: `RangeSlider` mounted directly
against the real dev server (it takes plain props, so no fixture picture is
needed) and screenshotted at 4×, to check the glyph is the shared
`Icons.reset` and not a hand-drawn one.

## A replaced source is released one commit later (2026-09-21)

`useDevelopPicture` used to release the previous `BadgeSource` in the decode
effect's own cleanup. That is one commit too early whenever another paint
input moves WITH the file — the stage's scale when the delivered file changes
under it (R3a) — because the paint effect then runs once more, in the same
commit, with the state's still-old source and draws a closed bitmap:
`InvalidStateError: The image source is detached`, and the tool's boundary.
The rule the Studio already keeps (`studio.md`) now holds here: a replaced
source is RETIRED and released when `source` next changes, or on unmount.
One subtlety measured against a stub instance: the source the state now holds
can itself be on the retired list — a proxy whose decode landed in the same
commit as the RAW arrived was retired by that commit's cleanup — so the
release skips whatever `source` currently is, and that one waits its turn.
Otherwise the next paint draws a bitmap of width 0 and the cube pass logs
`GL error 0x501` on its first draw.

## A picture is read by its NAME before its type (2026-09-21)

`pictureFidelity` asked `file.type` before anything else, and a JPEG fetched
from an instance carries NO type (`materialize` hands an original over with
`''`), so a delivered original on the stage was captioned `clip · 8-bit`. The
name decides first (`classifyPart`); the type is consulted only where the
name says nothing. The same trap already bit `loadBadgeSource`, which tests
the extension beside the type — keep every "is this a clip?" test on both.
