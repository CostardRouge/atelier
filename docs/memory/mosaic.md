# Mosaic — a picture made of all the others

Read before touching `src/shared/mosaic/` (the pure core) or
`src/tools/mosaic/` (the instrument, not yet built). The brief, his four
decisions and the plan M1–M9 are `docs/mosaic.md`; this file holds the rules
the code fixed.

## The measure is bytes, the comparison is derived (2026-10-31, M1)

**Decision.** A picture's measure is its 6 × 6 grid of mean sRGB colours as
108 BYTES (`measure.ts`, `gridOf`), base64 in the document (144 characters,
`encodeGrid` / `decodeGrid`, refused unless it decodes to exactly 108 bytes);
everything a matching compares — the level (1 × 1, 2 × 2, 3 × 3) and the
space (OKLab × 100 or RGB) — is derived from the bytes on load
(`descriptorsOf`), never stored. **Why**: his pick («Grille 6×6»), and a
stored derivative would rot the moment a level or a space is added. **How to
apply**: a new way to compare pictures is a new derivation over the same
bytes; the bytes never change shape without a document version.

## A cell has the FRAME's shape, so the grid is square in count (2026-10-31, M1)

`gridShape(width, height, cellPx)` cuts `cols = round(width / cellPx)` and a
cell `cw × cw·(H/W)`, so `rows = cols` on any frame (24 × 24 at 960 × 540 and
40 px). **Why**: a cell zoomed is then exactly the frame, which is what lets a
chain step end on the whole next picture; the cell SIZE is in stage pixels
(his pick), so a 4K export has more cells, not bigger ones. The target's
cells are read with the same arithmetic as a picture (`cellGridsOf` over
`gridOfRect`), so like is compared with like.

## One decode, two products; the device first; a miss is skipped (2026-10-31, M2)

**Decision.** `shared/mosaic/measure-worker.ts` (a module worker, Vite's ES
format like `jxl-worker.ts`) decodes a Winnow thumbnail ONCE and makes the
160 × 90 JPEG tile a cell draws AND the 6 × 6 grid, the grid read off the
tile's own cover crop (`coverSource`) so a portrait or a panorama is
measured as it will be drawn. `tools/mosaic/measure-pool.ts` fetches on the
MAIN thread (the client holds the auth and the retry; six in flight) and
hands blobs to the idlest worker (`measurePoolSize`: cores − 1, two to six,
one or two on a constrained device); without `Worker`/`OffscreenCanvas` the
same measure runs here in batches of eight with a yield. **Rules**: before
any request, the document's grids and the device's `measures` are copied in
and only a picture with no grid OR no kept tile is fetched — a run
cancelled keeps what landed (grids and tiles are flushed to
`atelier-mosaic` every 48 pictures and at the end), the next run starts
there; a thumbnail that 404s or will not decode is `failed` and SKIPPED,
never the end of the run; the fetches in flight at a cancel are the only
ones repeated. `runMeasure` wraps it as one masthead task with a Cancel.
Driven headless against a stub (300 pictures, cancelled at 150: 148 kept,
the resumed run fetched the other 152 and the two failures; the fallback on
100 more; the tiles 160 × 90 JPEG ~850 B each).

## The shell is the atlas's, minus the sync until M8 (2026-10-31, M3)

`tools/mosaic/MosaicTool.tsx` copies `AtlasTool.tsx`'s shape — `/mosaic/home`
the gallery, `/mosaic/<slug>-<id8>` the editor (`mosaic-route.ts` over the
trips' `tripRef`), a 600 ms debounced local save, ONE tab editing under the
Web Lock (`LockedKind` gained `mosaic`) — without `useDocumentSync`: no
instance lists the kind `mosaic` in its bucket yet, so `MosaicGallery`'s
`useDocumentGallery` driver carries remote stubs that are never called
(`documentSourcesFor('mosaic')` yields the device alone) and `deleteMosaic`
prunes `tiles` and `measures` to what the remaining mosaics reference.
**Registry**: an `editor` under `wip` (Q1 answered by the brief's
recommendation — it has documents and a gallery; the badge is what keeps it
discreet), `accepts: []` since the picker, not the Library, is its door.
**Trap**: `src/app/llms.test.ts` holds `public/llms.txt` to the registry —
a new tool fails CI until that file lists it under its group. The
`.mosaic.json` (`mosaic-file.ts`, kind `atelier/mosaic`) carries the grids
and never a tile; an import makes new ids. Driven headless: new → rename →
export → import (a second mosaic) → delete → reload → reopen by route; no
horizontal scroll at 390 px.

## The instance is a field of its own, and an add is references then a run (2026-11-01, M4)

`MosaicDoc.sourceId` is where the DOCUMENT is kept (the galleries' meaning:
this device, an instance for M8); `MosaicDoc.instance` is the Winnow its
PICTURES come from — the connection's id, set by the first add
(`withPictures`), never changed, and the key the tiles and measures are
filed under. **Why**: a tile's id means nothing on another instance, and a
mosaic kept on instance A may draw instance B's pictures. **How to apply**:
`MosaicPicker.tsx` (the shared picker in SPAN scope on `doc.span`, `all`
ticks, photos and clips — a clip is the still of its poster, `tileOfRow`)
adds REFERENCES only and the editor starts `runMeasure` right after (and
on open when grids are missing: a cancelled run or an import resumes by
itself); a mosaic whose `instance` is not the connected one shows
«pictures from <host>» in place of the door. The band's one verb is
*Measure N* / *Measure again* (the skipped ones), its status the count or
«measuring d / t…»; the Library sidebar is NOT its door (`accepts: []`,
«0 usable by Mosaic» is expected). Driven headless against the stub: 44
rows → *Add 44 to the mosaic* → 44 grids on the document, 9 clips, the
tiles held, a reload refetching nothing, the same span reopened with every
row «in this mosaic».

## The stage: one painted canvas, a scene rebuilt by its inputs (2026-11-01, M5)

`use-mosaic-scene.ts` rebuilds the mosaic when the target, the measured
library, a matching setting (`cellPx`, `level`, `space`, `tint`,
`distinctNeighbours`) or the stage's size changes: the target's PROXY
fetched (a clip's thumbnail; the last four targets held as bitmaps), its
cells read off a cover crop at the stage's shape (`targetCellsOf`), matched
on this thread or — past 20 M multiply-adds, `match-client.ts` — in a
one-off `measure-worker.ts` (its second message kind), the tiles' bitmaps
read from the device (`tile-bitmaps.ts`, an LRU of 2 000 / 600 on a phone,
a missing tile fetched from the thumbnail and kept again), the mosaic
painted ONCE (`paintMosaic`); the previous scene stays on screen until the
new one lands. The cell count follows the stage's CSS width (D2), the paint
is at `dpr`. **Traps**: the room is measured on the WORKBENCH mounted with
the pictures (`MosaicWorkbench`) — a size hook on the editor measured a box
that did not exist yet and the canvas stayed 1 × 1; `SliderBar`'s range
input is named by its `name` prop in lower case (`getByRole('slider', {
name: /^cell$/i })`). The ghost and the grid are the screen's (`StageView`),
never the document's; the gallery's poster is the scene's own canvas scaled
to 640 × 360 after 2 s still (`use-mosaic-cover.ts`); a click on a cell
makes its picture the target; *Draw a target* picks one from the seed. The
gallery's «winnow.example does not keep mosaics» line is `AbsentSourceNotes`
being honest until M8. Driven headless: 400 synthetic pictures, 18 × 18
cells matched in 6 ms here, a click retargeting (one proxy fetched each),
Zones + 12 px → 58 × 58 cells matched in 65 ms in the background, the ghost
changing the pixels, the poster written, no overflow at 390 px.

## The player prepares a step ahead, and a Stop keeps what is seen (2026-11-01, M6)

`mosaic-player.ts` plays the animated modes over `scene-builder.ts` (the
Single stage's pipeline extracted so the player shares its caches: targets,
tiles, memoised descriptors, the library in OKLab). **Rules**: the moment a
step starts, the NEXT step is prepared (its picture picked from the seed,
its proxy fetched, its scene built — a pull-back's scene is the next
picture's with the current one FORCED into a cell) while the current one
plays, and a step that ends first waits on its last frame («waiting for the
next picture»); every frame is `cameraAt` of the time since the step began
(nothing accumulates); the player draws into the stage's canvas and the
stage keeps its hands off while `playing`; a mode or a dial changed under a
run stops it. **The picture on screen is the target when a run ends**
(Stop, Escape, Space, a pull-back once done): the editor writes
`player.current` to the document on the playing → stopped edge, and a
pull-back says `current = next` from its resolve on, so a Stop during the
hold keeps the picture seen. Space plays and stops (the transport's key),
Escape stops; the Screen button is the browser's fullscreen on the stage's
box (`[&:fullscreen]:` arbitrary variants — Tailwind has no `fullscreen:`).
**Trap**: React's development double-mount disposes a memoised builder once
before using it — the tile cache is made lazily (`tileCache()`), never in
the constructor. Driven headless: Chain dive (frames change, step 2 after
~8 s, Escape writes the target), Chain pull out (Space, the target is the
picture seen), Pull back once (ends by itself, the target written), Reveal
and Drift (frames change), fullscreen granted.

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

## The matching comes in lots, painted as they land (2026-11-01, F3)

His ask («une propagation ludique des cellules au fur et à mesure des
résultats … une barre de progression dans la bordure du canvas … garder
"matching…"»). **Rules**: `planLots` (`perf.ts`, pure) cuts the cells into
lots in a PROPAGATION order — rows, from a point (the cell clicked, else the
centre), a spiral, random from the seed, or one block; `matchLot`
(`match.ts`) matches one lot reading the cells already decided (`known`)
for the neighbour rule; the lots run over `MatchPool` (`tools/mosaic/
match-pool.ts`, N persistent `measure-worker.ts` holding the library by
TOKEN, re-sent only when the descriptors change) in as many lanes as
workers; `SceneBuilder.build` paints each lot into the SAME canvas, which
starts from the previous scene's pixels when the size matches (so a
retarget replaces cells rather than blanking), records `arrivals` and
`progress`, and `MosaicStage` animates the cells younger than `ms` from
`scene.before` (fade, appear, flip) and shows a 2 px `role="progressbar"`
hairline at the bottom while `progress < 1`. **Honesty**: with several
lanes two lots in flight do not see each other, so a neighbour rule may
differ from a one-block match at lot edges — exact only with one worker
and `rows`; the panel says so. **Traps** (both hung the pool): a lot
cancelled while a worker ran it must still decrement that worker's `busy`
when its reply lands (the job carries a `gone` flag), and a waiter whose
signal aborts must wake the NEXT waiter when a worker is free and leave
the queue, else every later `take` waits forever. Driven headless: 1 500
pictures, 37 × 37 cells, 22 lots at 9 ms a lot on the pool, the frames
distinct as they land, a click propagating from its cell.

## Performance is the device's panel, never the document's (2026-11-01, F4)

His ask («tout un panel pour gérer la performance et les animations ou le
worker … au peigne fin, tous les paramètres du premier artefact»). **Rules**:
`PerfPrefs` (`perf.ts`) live in `localStorage` `atelier.mosaic.perf`
(`use-mosaic-perf.ts`, bounded on read by `sanitizePerf`) — a `.mosaic.json`
opened on a phone must not impose six workers; the document keeps what the
mosaic IS, the device how it is computed and shown. The section sits at the
inspector's foot, closed by default: workers (Auto · N here, 1–8), where the
measure runs (pool, one worker, this thread), the lot (a row, 64, 256,
1 024), the propagation, *Show each lot as it lands*, the cell animation and
its ms, tiles in memory, scenes ahead, the zoom's meaning (F6), motion; a
measured line «last matching · N lots · ms a lot · where · fps» under them.
`workers: 0` is auto (`workersFor`: cores − 1, two to six, one or two
constrained); the pool is remade on that number; `measure()` reads the pref
at call time. **How to apply**: a new knob is a field with a default and a
bound in `sanitizePerf`, read through the hook, never a new store.

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

## A zoom on the Still stage is a crop; the view is held until the rebuild lands (2026-11-01, F6)

His ask («zoomer sur toute la viewport … ça change le crop, et ça nous permet
de réadapter en fonction de la taille de cellule»). **Rules**:
`shared/mosaic/stage-view.ts` (pure) holds the view `{s, ox, oy}` over the
painted mosaic — zoomed about the hand, clamped to the stage (`viewBounds`:
out until the frame is the whole picture, in until the crop would be
`MIN_CROP_SCALE`) — and `cropFromView` maps the window in view through the
scene's `targetRect` onto the target as a crop; `tools/mosaic/use-stage-zoom.ts`
reads the hand through the suite's `useZoomGestures` (`wheel: 'any'` — the
stage has nothing else to do with the wheel; a drag pans only past ×1, at
the fit it stays a click on a cell) and COMMITS on release — the wheel quiet
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

## Loading in three bounded depths (2026-11-01, F7)

Lab 2's «charger avec élégance»: the band's thumbnails are the device's
tiles through object URLs (free, F5); the player prepares `perf.ahead`
(1–3) scenes past the one playing — `pendings`, a Map by step index, each
chained on the one before since its picture is where the next starts, a
played step DELETED so a chain of thousands never holds every scene it
drew; and as a step starts it WARMS the proxies of the two queued pictures
past the scenes ahead (`warm`), which only the queue can name — a drawn
step is unknown until its turn. `SceneBuilder.targetBitmap` shares a fetch
in flight (`fetching`) and holds eight targets, so the warm and the build
ask the instance once. Measured headless with 250 ms proxies: one proxy a
step either way; one scene ahead waited on the next picture three times in
seven steps, three ahead never. Nothing for the eleventh: it waits to be
the ninth.

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

## A bitmap a scene may draw is never `close()`d (2026-11-01)

His report: «The image source is detached». Three evictions CLOSED bitmaps
a scene still drew: the tiles' LRU (a mosaic of more than 2 000 distinct
pictures closed the first ones before the paint), the builder's last-four
targets (a chain closed the playing step's target) and `dispose` (React's
development double-mount). **Rule**: caches DROP their references and let
the collector free them; only a bitmap made and used inside one function
(`cropToTile`, the measure worker) is closed. Checked headless: 2 600
pictures, 58 × 58 cells (3 364, matched in the background), a chain of six
steps, no page error.

## The chain is a clock, the picks are seeded (2026-10-31, M1)

`chain.ts` gives a step's phase and camera as a FUNCTION of the time since
the step began (`stepStateAt`, `cameraAt`: zoom in log space, the centre
gliding to the cell, the focus cell's crisp picture fading in from ×1.6 to
×3.2, the target fading over the mosaic in the hold, dissolve and resolve) —
the atlas rule, so the stage and an MP4 draw the same frames. The picks
(`pickCell`, `pickNextTarget`) take the document's seeded generator
(`lib/prng.ts`) and a HISTORY, and `forceInto` returns a new `ids` rather
than mutating the matching. **How to apply**: never read `Math.random()` or
accumulate a camera in the frame loop; a replay must only depend on the seed
and the same sequence of picks.
