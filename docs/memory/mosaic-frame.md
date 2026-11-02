# Mosaic — the frame, the zoom, the targets, the phone

Read before touching what the person frames and where they go: `frame.ts`,
`stage-view.ts`, `target-history.ts` (pure), `TargetFrame.tsx`,
`TargetChooser.tsx`, `use-stage-zoom.ts`, `use-target-steps.ts`, and
`MosaicEditor.tsx`'s phone arrangement. The core is `mosaic.md`.

## The frame: a shape for the mosaic, a part of the target (2026-11-01)

His ask after M6: the target chosen explicitly in an image field as wide as
the inspector, a shape for the rebuilt picture, and «la zone de la photo
concernée … que le centre de l'image en carré … tout le reste ignoré».
**Decisions** (`shared/mosaic/frame.ts`, pure): `settings.aspect` is one of
six shapes (16:9 … 9:16) — the stage, its cells (the frame's shape) and the
poster follow; `MosaicDoc.crop` is `{cx, cy, scale}` on the TARGET, scale 1
the largest frame of the shape the picture holds — aspect-free on purpose,
so changing the shape keeps the centre and the share; it belongs to its
target (`withTarget` drops it, the whole frame is stored as none) and the
chain frames every later picture whole. The target's cells are read off
`cropRect` only — the rest is never read. **The library follows the cell's
shape**: a grid was measured on a 16:9 tile, so `cropGrids` resamples each
6 × 6 grid (area-weighted) to the centre window a square or upright cell
shows, memoised per aspect in `SceneBuilder.descriptors`, and `paintMosaic`
cover-crops each tile into its cell (it used to stretch). An upright cell
draws a ~50 × 90 slice of the tile — coarse at big cells, honest at 40 px.
**The UI**: `TargetFrame.tsx` (the picture with the frame dimmed around it,
drag to move, the corner to resize, written on pointer-up so the scene
rebuilds once; a press outside the frame opens the chooser) and
`TargetChooser.tsx` (the measured pictures through `WinnowThumb`, paged by
240, opened on the current target's page) under a *Target* section first in
the inspector, with *Choose…*, *Whole picture* and the shape.

## The shape is the crop's; `original` is the picture's own (2026-11-01, F2)

His rule («je n'ai pas envie que le changement d'aspect ratio déforme
l'image … inspire-toi de la section crop de Develop»). **Rules**: the card
always shows the WHOLE picture; the shape is the FRAME's, posed on it at the
same centre (`frame.ts`, aspect-free crop); the stage is that frame's shape,
letterboxed in the room (`stageIn`), nothing ever stretched. `original`
joins the shapes and is the DEFAULT: the picture's own ratio, learnt from
its bitmap — `useMosaicScene` fetches the target first, sets `own`, and
builds on the next render; until known, 16:9. In a chain the stage keeps
the shape it was attached with and later pictures are framed whole in it
(`cropRect` with the stage's aspect). Driven headless: a 2:3 target gives
a 2:3 stage under Own, 1:1 a square stage and a full-width square frame on
the portrait card, 9:16 a tall one; drawing a landscape target turns the
stage 16:9.

## The target card: three states, the trace inside, grips that stay in (2026-11-01, F1)

His report on the first card (the trace lost against the picture's edge, a
round handle past the card, a radius, the frame shown whole-picture, the
inspector scrolling sideways). **Rules** (`TargetFrame.tsx`): the trace is
drawn INSIDE the rectangle (an inset light line over a dark one, so it
reads on any picture and survives the card's `overflow: hidden`); a frame
is never under 48 px on screen (`resizeFrame`'s `minW`); it is grabbed by
its inside to move and by eight grips (`HANDLES`, pure arithmetic in
`frame.ts`) that are 44 px zones shrunk to a third of the frame on a small
one, so the middle always moves; three states and no more —
`data-frame-state` whole (a faint trace, nothing dimmed, no *Whole picture*
button), cropped, frozen (a run plays: nothing grabbed, no grips). The
card measures ITS OWN box with a `ResizeObserver`. **Trap**: the shared
`InspectorSection`'s chevron carries `-mr-1.5`; an inspector without
`px-1.5` on its content scrolls 6 px sideways — the atlas pads, so does
`MosaicSettings`. Driven headless: `scrollWidth === clientWidth` at 22 rem
and 390 px, a frame dragged to the corner lands at (0, 0) at 48 px wide,
Whole/cropped/frozen read off the attribute.

## A zoom on the Still stage is a crop; the view is held until the rebuild lands (2026-11-01, F6)

His ask («zoomer sur toute la viewport … ça change le crop, et ça nous permet
de réadapter en fonction de la taille de cellule»). **Rules**:
`shared/mosaic/stage-view.ts` (pure) holds the view `{s, ox, oy}` over the
painted mosaic — zoomed about the hand, clamped to the stage (`viewBounds`:
out until the frame is the whole picture, in until the crop would be
`MIN_CROP_SCALE`) — and `cropFromView` maps the window in view through the
scene's `targetRect` onto the target as a crop; `tools/mosaic/use-stage-zoom.ts`
reads the hand through the suite's `useZoomGestures` (`wheel: 'any'` — the
stage has nothing else to do with the wheel; a drag pans whenever there
is somewhere to go — since lab 4's L3, `mosaic-interaction.md`) and COMMITS on release — the wheel quiet
260 ms, the fingers or the drag lifted — under `perf.zoom === 'frame'`, or
keeps the view under `'look'` where *Frame this* on the stage writes it. The
view is HELD until the scene rebuilt for the crop lands, and that build
starts from the same pixels enlarged (`BuildPlan.previousWindow`, the
`carry` the hook hands `useMosaicScene`), so the reset shows no jump and the
lots then replace the enlarged cells with crisp ones. `Z` fits a kept view,
else gives the whole picture; the arrows pan a kept view (`zoom-keys.ts`);
⌘Z is the document's history — `MosaicTool` now runs the suite's
`useHistory` over its one funnel, the pair in the bar. **Trap fixed**:
`cropOfRect` now pushes the centre to where a frame of that size lies inside
the picture, and a frame within `WHOLE_TOLERANCE` (2 ‰) of the largest IS
the largest, `isWhole` reading with the same tolerance — the stage is
floored to whole pixels, so its aspect differs from the picture's by a
pixel's share, and a zoom-out past the whole used to store `scale: 1` with
a centre a hair off, which read as *cropped* though nothing was. Driven
headless: six wheel notches at the corner → the crop's top-left sixth at the
same 11 × 11 cells, a zoom-out past the whole → `WHOLE`, Ctrl+Z → the crop
before, a pinch → a smaller crop, *Looks* keeping the crop until *Frame
this*.

## Auto-frame is a switch in Target, and the stage zooms in every stopped mode (2026-11-01)

His report: «en style et quand je zoome, ça ne me fait pas le reframe
automatiquement … une option pour auto-frame». **Cause found**: the stage
heard the hand only in *Still* — in a stopped *Mosaics* or *Chain* the
stage shows the same target's mosaic, but a trackpad pinch (a ctrl-wheel)
reached the BROWSER, which zoomed the whole page and wrote no crop.
**Rules**: `useStageZoom` is enabled whenever nothing plays, in every mode
(the crop is the target's, the start of any run); the frame-or-look choice
(`PerfPrefs.zoom`, still this device's) is the **Auto-frame on zoom**
switch in the *Target* section, beside the frame it writes — the
Performance panel's *Zoom* row is gone (a fact said once). Off, a zoom is a
look and the stage's pill offers *Frame this*. Driven headless: a 20-step
ctrl-wheel pinch on a stopped Mosaics stage writes a crop and leaves the
page at scale 1; off, a pinch keeps the crop and *Frame this* writes it; a
plain wheel at the corner of Still frames the top-left.

## Previous and next target, as a browser's back and forward (2026-11-01)

His ask («à chaque fois que je clique dans une image je ne peux pas
revenir à l'image précédente … des flèches … dans la barre en haut»).
**Rules**: `shared/mosaic/target-history.ts` (pure) keeps `past` and
`future` steps `{id, crop}`, 50 deep; `useTargetSteps` WATCHES the
document's target — a click, the chooser, a draw, a run that stopped
elsewhere, an undo all count as a visit — and a step it makes itself is
not one; a step carries the crop the picture last wore, so a return lands
on the part framed; a picture removed from the mosaic is skipped. Kept for
the editor's session, never in the document (where he has been is not
what the mosaic is). The pair sits in the bar before ↶ ↷, in the history
pair's look with chevrons (`TargetStepsControl`, `UndoRedo`'s `HALF`): the
two walk different things, pictures vs edits. ← → do the same on the stage
while no zoom view is kept (a kept view pans with them). Driven headless:
three targets, back by the button and by ←, forward by → and the button,
the crop of a target back with it.

## On a phone, the suite's editor arrangement: tabs in the bottom bar, drawers under the stage (2026-11-01)

His report: «l'application n'est pas du tout responsive … tout le système
de réglages … dans le menu qui flotte en bas, avec un tiroir comme on le
fait déjà dans d'autres pages». Measured before: at 390 px the settings
column was stacked OVER the stage and the transport pushed off screen.
**Decision**: the compact shell (`useIsCompact`) is Storytelling's and
Develop's arrangement, not the desktop one squeezed — the masthead goes
(`usePublishShellChrome` immersive, the frame's black behind); ONE
`PhoneHeader` line (back · the title over the count or the measuring
progress · ‹ › · ↶ ↷ · ⋯ with *Choose the target…*, *Full screen* where the
browser allows it, *Draw a target*, *Add from …*, *Measure*, then the
shell's own); the stage takes the column; the chain band; a one-row
transport (the mode as a select, Play, the status word — the chain's
direction lives in the Motion tab); the settings as FOUR tabs of the
shell's floating bottom bar (`usePublishSectionBar`: Target · Cells ·
Motion · Performance, marked only while its drawer is up), each a
`DockedDrawer` through `PanelHost` showing ONE part of `MosaicSettings`
(`only`: the tab's first section bare, a second — Reading under Cells —
with its header, unfolded). A drawer, never a sheet: what is judged is the
mosaic, and a wash would falsify it (Develop's rule). **Rules**: while a
drawer is up the stage is SHOWN smaller but BUILT for the room it had
(`freeRoom`): opening a tab to turn a dial must not rebuild the mosaic at
another cell count — the dial does that, once; the stage's wrapper is
sized to fit the room at any time and the canvas, the clicks and the zoom
all read proportions, so a scaled stage behaves. **Trap**: the phone's
picker is opened from the ⋯ and must sit at ONE place in the tree — drawn
inside the header, it moved from the empty state to the workbench at the
add and mounted again, still open. Driven headless at 390 × 844 and
390 × 664: no page scroll either way, the four drawers, a dial turned in
the Cells drawer rebuilding once, Mosaics playing with the band and the
transport in reach, the ⋯'s verbs; the gallery's storage line wraps whole
figures at 390 px.

## Under 860 px of room the editor is ONE column that scrolls (2026-11-02)

His report, a screenshot at an in-between width (the library docked, or a
window under ~900 px): the stage, its transport and the Target card drawn
over one another. **Cause**: under the container query the editor stacked
its stage column and the inspector in a height-bound flex column; the stage
column (`min-h-0`) was squeezed to ~120 px while its content kept its size
and spilled over the inspector. **Rule**: from 860 px of room, side by side
(the inspector scrolls); under it, one column that scrolls as a WHOLE — the
stage box a height of its own (`55 %` of `--app-h`, never under 200 px),
then the band, the transport, the settings, every part `flex-none`. Driven
headless at eleven widths from 1500 down to 840 and back: nothing overlaps.
