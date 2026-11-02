# Mosaic — the transport, the target card, the stage's hand

Read before touching how the person PLAYS with the editor: the transport and
its mode drawer (`MosaicTransport.tsx`, `ModeDrawer.tsx`,
`shared/mosaic/mode-catalog.ts`), the target card while a run plays, the
stage's gestures (`MosaicStage.tsx`, `use-stage-zoom.ts`) and what a zoom
draws. Lab 4 (his four asks after M9, French):
https://claude.ai/artifact/F9JVY7nwTsuVvGgR3Qjpw6 — his answers 2026-11-02:
no window on a click (a click retargets), families in English, sharp photos
and the fading veil on by default.

## The modes are one button and a drawer of previews (2026-11-02, L1)

His ask («ça commence à en faire beaucoup … un tiroir où on verrait des
tuiles»): ten equal buttons made him read ten words (Hick). **Decision**:
*Still* is a button of its own — the editing state, not a way to play —;
the MODE is one button showing the recipe Play plays (its held preview, its
name, a chevron), opening `ModeDrawer`: the eight recipes as tiles in three
families (`MODE_FAMILIES`: Travel — Mosaics, Chain, Pull back, Steer;
Transform — Reveal, Wave; Watch — Drift, Slideshow), each a small preview
painted from the STAGE'S OWN scene (its mirror standing in for "the next
mosaic", cover-cropped into a 16:9 tile so an upright mosaic is never
stretched); the hovered tile and the current one play, reduced motion holds
them all; *Custom…* at the foot sets `custom` and unfolds the Motion section
(a phone: its tab's drawer). A popover over the stage on a computer, a
`BottomSheet` on a phone. **Play from Still** switches to the recipe on the
button (`lastRecipe`, the last mode played or `recipeOf(motion)`) and plays
once the render carries it — the effect is declared AFTER the dials' stop,
which a mode change runs, or the stop would kill the play it just started.
Space does the same. **Trap**: a mirror of a scene still landing its lots
was cached half painted (a black ring in Wave's and Slideshow's tiles) —
`partsOf` re-takes the mirror while `scene.progress` grows, and the tiles
repaint on it. Driven headless: three families of 4 + 2 + 2, a pick, Custom
unfolding Motion, Still then Play playing Mosaics, the sheet at 390 px with
no overflow.

## The target card shows the picture on screen while a run plays (2026-11-02, L2)

His ask («que la section target … se mette à jour … qu'elle montre
véritablement l'image qu'on essayait de montrer»). **Decision**: while
`status.playing`, `TargetFrame` gets `showing` = `status.current` — the
player moves it only when the ARRIVED mosaic is on screen (`f.arrived`), so
during a dive the card still shows the departed picture — and its bitmap
from `MosaicPlayer.pictureOf(id)` (the run's scene's `target`, never
closed), the instance's thumbnail until that scene exists. The card draws
it whole, no frame (a chain takes each picture whole), no grips, a chip
*on screen · #id*, `data-frame-state="playing"`; at Stop the picture on
screen is the target (as before) and the frame returns. **Rejected**: the
start target kept with an "on screen" thumbnail beside it — two pictures
for one question (lab 4's §2). Driven headless: a Slideshow run's card read
#176 → #114 → #148 with no grip, the target 148 after Stop.

## A drag pans, a click picks — at any zoom, in both Auto-frame states (2026-11-02, L3)

His report: with Auto-frame a click worked but a drag never panned (the
view had become a crop at ×1 on release); without it a drag panned but a
click did nothing (picks were refused under a kept view). His pick: both at
once, no window between a click and the target. **Rules**:
`clampStageView` takes an AREA the window stays in — the mosaic built
under `look`, the whole PICTURE under `frame` (`pictureArea`, the target in
stage units through `targetRect`) — so under Auto-frame a drag at ×1 slides
the frame across the target, the stage drawing the picture dimmed past the
mosaic built, and the release commits it like a zoom (`cropFromView`, the
held view, the carry). `useStageZoom.drag` answers `pan` whenever
`canPanView`; under the machine's slop the press stays a click. A click is
mapped through the view (`stagePointToMosaic`) and picks at any zoom, the
view fitting again on the new target; the click a drag's end sends is
swallowed (`justDragged`, 250 ms); the outline follows the hover at any
zoom. **Trap**: `ZoomGestureMachine` captures a MOUSE at pointerdown once a
drag may start, so the browser's click lands on the gestures' box, not the
canvas — `MosaicStage` listens on `clickHost` (the box; clicks bubble to it
otherwise) and checks the point is on the canvas. The shared machine was
left alone (Develop and Trips rely on it). Driven headless: Look — a zoom,
a drag (target kept), a click while zoomed (target changed); Auto-frame — a
zoom framed (scale 0.165), a drag slid the crop (cx 0.50 → 0.55, scale
kept), a click picked another target (crop dropped).
