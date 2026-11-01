# Mosaic — the chain, the step grammar, steering

Read before touching what plays: `motion.ts`, `chain.ts`, `mosaic-doc.ts`'s
queue, `mosaic-player.ts`, `ChainBand.tsx`, `MosaicTransport.tsx`, the
Motion section. Lab 2 (the queue) and lab 3 (the animations) are in
`docs/mosaic.md`'s status; the core is `mosaic.md`.

## The chain is a queue in the document, shown as a band (2026-11-01, F5)

His ask («une bande … l'image de début et l'image de fin … un carrousel de
10 images … une liste infinie qui insère automatiquement les images … le
random reste un paramètre»). **Model** (`mosaic-doc.ts`, doc v2, a v1 body
reads with none): `MosaicDoc.chain = { queue: [{id, by: 'draw' | 'pick'}],
draw }` — the pictures AFTER the target, ten ahead (`QUEUE_AHEAD`), refilled
under five (`QUEUE_REFILL_AT`) by `refillQueue`, pure and deterministic: one
`mulberry32` per draw seeded from the document's seed, the picture before
and the position, so a reopened mosaic and another device fill the same
queue; a dive draws by `pickDive` (a picture whose MEAN sits in a cell of
the one before), a pull-back by `pickNextTarget`. Two neighbours are never
the same picture; a new target drops the DRAWN entries and keeps the picks;
*Shuffle* drops the drawn and turns the seed (`nextSeed`); a run ended
(`chainAdvanced(done, current)`) makes the picture seen the target and
slices the played entries off. **Player**: `QueueSource.next(index)` is
read when a step is PREPARED (so an edit of a later entry is honoured), a
queued picture is forced into the current mosaic's cell it resembles most
(`build`'s `force`, which first keeps a cell the matching already gave it),
`draw` off ends the chain with a note, and a step drawn by the player is
reported back (`onDraw`) so the document carries it. **Band**
(`ChainBand.tsx`, under the stage in Chain and Pull back): the device's
tiles through object URLs (`getTile`, no request), now in vermilion, next
underlined, drawn grey / picked white, press → the chooser in place, × →
remove, + → append, ↻ → shuffle, the *Draw the next ones* switch; while
playing the played entries fall away and the entry being prepared is
locked. **Known limit**: the × is 20 px, under the 44 px rule — a tile is
80 × 44 and a second 44 px target would not fit; his call. **Trap for
drives**: the shell saves 600 ms after an edit — read the store only after
*Saved* shows, or the document read is the one before.

## Lab 3, the animations: the chain measured first (2026-11-01, A1)

His review of the modes (lab 3 <https://claude.ai/artifact/JpM4MT2LF8qdXGJhzFhgjh>:
the four animated modes are one step — photo, mosaic, a camera move, the
next photo — whose parts must become optional; a bug «ça ne passe pas
directement à l'image suivante du carrousel»). **A1's finding**: the bug
does NOT reproduce headless — 600 pictures, proxies slowed to 2 s and
4.5 s, one or three scenes ahead: the player's log shows every step
prepared from the queue's next entry in order, the band's *now* equal to
the picture reached, eight steps in 45 s, only the FIRST step ever
holding (the first proxy). What the stub cannot see is his instance, so the
chain now MEASURES itself: `PlayerStatus.prepMs` (a step's preparation,
from the moment its predecessor was known), `waits` / `waitMs` (turns that
came before their step was ready, past 80 ms), shown in the Performance
panel as «chain · a step ready in N s · N played · held N× for N s», and
the band's *next* tile carries a sliding hairline (`chain-wait`,
`role="progressbar"`) while a later step holds. **Trap for drives**: a
pixel-colour sampler that names the picture on the canvas is unreliable
(the stub's colours collide within any tolerance) — read the player's own
state, never the pixels, to tell which picture is shown. **How to apply**:
when he reports the chain stalling, read that line on his instance first;
a step ready in more than the step's length is hypothesis 1 of the lab.

## A step is a grammar: departure · trajectory · arrival (2026-11-01, A2)

Lab 3's model, built with no visual change. **Rules**: `shared/mosaic/motion.ts`
(pure) holds `Motion` — `depart` (dive · pull · alternate · wave · fade ·
cut), `arrival` (mosaic · photo · reveal), `holdMs`, `moveMs`, `sharpness`
(when a growing cell's true content shows over its tile: early ×1.6, late
×3.2, never), `aim` (queue · best · random · click), `reveal` (toPhoto ·
toMosaic · roundTrip), `cadenceMs` (the hold absorbs what the other parts
leave), `drift` (a held mosaic wanders, ramped in and out over 2 s so every
departure starts still) — and the RECIPES the transport's modes are
(`RECIPE_MOTIONS`: chain, dezoom, reveal, drift as before to the
millisecond, then mosaics, wave, slideshow, steer); a part set by hand makes
`mode` `custom` (`recipeOf`, `motionOf`). The document is v3
(`settings.motion`; a v2 `mode` + `direction` reads as its recipe). The
clock `stepFrameAt` gives, at `t`, which mosaic the camera is over
(`base`), the camera, and what is blended (the aimed cell's true content,
the arrived mosaic crossing in or landing cell by cell, the base's photo
whole or flipped cell by cell) — a dive ends with the cell filling the
frame, which IS the next mosaic whole, and a pull starts there, so the
camera is continuous (B2); the run OPENS on the picture on screen with its
arrival minus the fade-in, nothing before a pull. **Player**: one runner
over the grammar — scenes kept by picture (`sceneOf`, six held), a step's
two mosaics prepared together, the aimed cell found or forced on the scene
in place (`SceneBuilder.forceCell`, the scene carrying its `cells`
descriptors, `means` and `settings`), a wave's order by distance from the
aimed cell, a reveal's order from the seed; `arrived` on a frame is what
sets the band's *now*. **Trap**: `chain.ts` keeps only the shared pieces
(ease, cellRect, logZoom, focusAlpha, revealOrder, driftCamera); the old
`stepStateAt` / `cameraAt` / `revealAt` are gone with their specs — the
motion spec asserts the same numbers.

## Mosaics: from mosaic to mosaic, the default (2026-11-01, A3)

His preference («je préfère qu'on navigue de mosaïque en mosaïque … plutôt
qu'elle se révèle à chaque fois»). **Decision**: the `mosaics` recipe —
dive 4 s, arrival on the next MOSAIC, no sharpening (the enlarged tile
holds until the landing, 300 ms, where the next mosaic crosses in), a 2 s
hold with a drift — is the DEFAULT motion of a new mosaic
(`DEFAULT_SETTINGS.motion`) and the second word of the transport, right
after *Still*. The photo is one recipe's choice (Chain, Pull back, Reveal
keep it), never the step's nature. **How to apply**: an arrival on the
mosaic needs the next scene ready — the player prepares a step's two
mosaics together, and a step whose scene is late holds (A1's measure says
so). Driven headless: four steps in 24 s with the status words never
*the picture* / *appears* / *into its cells*, *landing* seen, the target
moved on; Chain still arrives on the photo and *Both* keeps the chain.

## Wave, Fade, Cut: departures without a camera (2026-11-01, A4)

The three departures that move no camera: `wave` paints the ARRIVED
mosaic's cells over the departed one in the order of their distance from
the aimed cell (`waveOrderFrom`, the player; the lots' `point` order
without the lots), `fade` crosses the arrived mosaic in whole, `cut` takes
no time (its first frame is already the arrival). Recipes: *Wave* (3 s
wave, 3 s hold) and *Slideshow* (cut, cadence 6 s — the hold is the
whole beat), in the transport after Drift. **Rule**: a wave needs the two
mosaics at the same shape, which a run guarantees (one stage size for its
whole length — a resize stops the run, `dialsKey`); a wave's cells are
drawn from the arrived scene's canvas at its own `dpr`, never through the
tile cache again. Driven headless: a wave's frames change through its 3 s
(`the next one spreads`), a slideshow's steps come at 6 s each, Drift says
`fading to the next`.

## The Motion section, the aims, steering by a click (2026-11-01, A5 + A6)

Lab 3's A5 (the reveal's direction and round trip, the drift during holds,
the cadence) was built in A2's clock and verified by A4's drive; what it
still owed was the UI, which is A6's — so the two are ONE commit. **The
section** (`MosaicSettings`, *Motion*, closed by default, after *Reading*):
Departure (select), Arrival (segmented; the Reveal direction row shows
under *Reveal*), Sharpen, Aim, Move and Hold (sliders in tenths of a
second), Cadence (`none` at 0), Drift; `setMotion` bounds the patch
(`sanitizeMotion`) and renames the mode (`recipeOf(motion, mode)`) — so a
part set by hand reads *Custom* in the transport and choosing a mode puts
its recipe back; a line under them says which recipe the parts are.
**Aims**: `queue` takes the chain's entry; `best` and `random` let a DRAWN
entry yield (the player picks the cell and reports the picture back, so
the band shows what will happen), a PICKED entry always wins
(`QueueSource.picked`), and a pull always takes the queue's (its picture
must hold the current one's mean). **Steering**: a click on the stage
while a run plays reaches `MosaicPlayer.steer(cell)`, which acts only
while the ARRIVED mosaic is on screen (`frame.arrived && base === 'to'`):
the picture in that cell becomes the next step's as a pick of the queue
(`onPick`) and the steps prepared ahead are dropped and prepared again
(`replan`); mid-dive a click does nothing — the lab's «le pas en cours si
la plongée n'a pas dépassé la moitié» was refused as a camera re-aim the
pure clock cannot express; the *Steer* recipe is a 4 s hold on each
mosaic to give the click its time. `aim: 'click'` was dropped: steering
works in every recipe. **Trap**: the player reads the queue right after a
steer writes it, before React has rendered — a `docRef` set at render
time still held the old queue and the re-prepared step took the old
entry; the workbench's `change` now writes `docRef.current` the moment
the edit is applied. **Trap for drives**: on the stub's flat colours a
target's own tile fills its uniform region, so a click there names the
picture already on screen and steers nowhere by design — a drive clicks
along a row until a cell holds another picture. Driven headless: Arrival → Photo under Mosaics
reads Custom and back; a reveal there and back says `back into its
cells`; aim *Best match* replaces the drawn head; a click on the held
mosaic makes the next step land on that picture.
