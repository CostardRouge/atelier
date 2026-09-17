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
a **roll** (a document of pictures, each with its develop and crop, plus the
roll's look and export — not a Library view, which would lose its numbers on
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

**No Kelvin, and that is deliberate.** The brief listed a Kelvin readout;
temperature here is a channel GAIN, and an 8-bit render carries no as-shot
white balance to offset from, so a number in kelvin would be invented. It waits
for the RAW path (`AsShotNeutral` and a colour matrix are what make it real) —
`docs/photo-editor.md` P10.

`DevelopSliders.tsx` gained `RangeSlider` — the same row with an explicit
label, range and reset — because Levels needed it and a second copy is how two
panels come to disagree about what a slider looks like.

Verified in the pane on a deliberately flat, warm JPEG (70..150, 1.18/0.82
cast): Auto tone wrote `black 69 · white 155` and NO colour; Auto colour wrote
temperature −100 (clamped, said) and tint −36; both pressed again changed
nothing.
