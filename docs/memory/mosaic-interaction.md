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
