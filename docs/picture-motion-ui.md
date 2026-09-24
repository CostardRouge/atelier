# Editing a picture's motion — why the needle is hard, and three faces for one storage

**Status: he picked A on 2026-09-24; §6.1–6.3 are BUILT the same day** (the
pure cards, the row in the section, the chip on the stage, the thumbnail on
End — `docs/memory/roadtrip.md`, «Built as cards»); §6.4 (the drawer on the
phone) and §6.5 (the tour on cards) follow; §7's four questions were taken as
recommended for want of his answers. The lab that
carries the three faces — three phones one manipulates (drag, pinch, play), the
diagnosis, the comparison and the recommendation:
<https://claude.ai/artifact/CUaBnL4XxsHYsh8zHVCvG9>. §1 is fact, traced to
`main` 5d06735 (trip v28); §2 is his report and what in the code makes it
true; §3–§6 are the proposal; §7 is his. Read it before touching
`PanZoomSection.tsx`, `TourMap.tsx`, the needle half of `PostEditor.tsx`
(`stageFraming`, `placeFraming`, `placing`, `jumpNeedle`) or the marks
`DeckStrip` draws on a slide's cell.

Written from the maintainer's report, the day after the feature shipped
(*Banc-titre*, `docs/memory/roadtrip.md` «A picture moves in its frame»):
*«Il suffisait de cliquer sur l'option Moves, zoomer, se déplacer sur la
timeline, se redéplacer de nouveau en déplaçant certains éléments comme le
zoom pour que les keyframes soient pris en compte. Ce n'est pas toujours
intuitif. […] Propose-moi ce qu'il y a de plus élégant, plus confortable, sur
mobile notamment. Que je puisse peut-être visualiser la timeline.»*

## 1. What is built (fact)

- **The model.** `motion: FramingMotion | null` on `PostBadge`, `PostSlide` and
  `CollageCell` (v28): keys `{at, scale, x, y}` before the rest, the rest
  being `framing` itself at 1; zoom geometric, `pan / zoom` linear in
  `1 / zoom`; nothing clamps in the module — `shared/media/framing-motion.ts`.
- **Editing at the needle.** The stage is handed each picture's framing AS
  SHOWN at the needle (`stageFraming`, `PostEditor.tsx:920–946`) and ONE
  writer (`placeFraming` → `placeAtNeedle`) sends a drag, a wheel or a pinch
  to the frame the needle is on (snap `KEY_SNAP_SECONDS` = 0.15 s), or places
  a new one. **Paused on the slide's first moment the stage shows the
  COMPOSITION** (the rest), so the hook thumbnail is taken there; the first
  frame is reached `NEEDLE_NUDGE_SECONDS` (0.04 s) in.
- **The band's marks.** `slideMotionMarks` → `DeckStrip.tsx:553`: a 6 px
  accent diamond at the foot of the slide's cell per placed frame; the cell is
  30 px per second on a compact shell (`DeckStrip.tsx:162`), 42 above.
- **Quick moves and the tour.** `applyPreset` writes two frames (a pan across
  the real slack, a push in, a pull out) with a reason under the grid where one
  is refused; `tourMotion` / `tourOf` write and read a tour as ordinary keys
  (a pause = two equal frames, glides sharing the span by distance) at ONE
  zoom (`TourPlan.zoom`); `TourMap` draws the whole picture with each stop's
  window and dots, behind «Plan a tour…».
- **The section.** `PanZoomSection.tsx:144–269`: Moves (a toggle writing a
  ×1.15 starter), Quick move (six buttons), Tour, then — once moving —
  Placing (a sentence), Needle (First ‹ › Rest), Frames (Remove, Keep ends),
  Easing, Steps, Starts. Nine rows for one idea.
- **On a phone.** The whole inspector is a `BottomSheet` over the stage
  (`PanelHost asSheet={compact}`, `PostEditor.tsx:1780`), with its scrim; the
  tab strip is the shell's bottom bar. `PanelHost` already knows a second
  shape, `compactAs: 'drawer'`, that only Develop uses (`frontend.md`).

## 2. Why the needle is hard — six facts

None of these is a bug; each rule has a reason recorded in `roadtrip.md`. Put
end to end they make an interface one DEDUCES rather than reads.

1. **At instant 0 the stage shows the END.** The composition (the rest) is
   what the stage draws on the slide's first moment; the first frame is 0.04 s
   in. The first thing seen after switching Moves on is the arrival, and
   getting back to the start means finding 0.04 s on the band.
2. **A gesture writes a frame without saying so.** Farther than 0.15 s from a
   frame, a drag or a pinch places a new one; nearer, it edits that one. The
   threshold is invisible, and the only sentence that says it — *Placing: A
   new frame at 1.4 s* — is an inspector row, on a phone inside a sheet drawn
   OVER the stage it describes.
3. **The frames are 6 px diamonds.** At 30 px/s a 5 s slide is 150 px wide on
   a phone: a frame cannot be grabbed, retimed or told from its neighbour.
4. **Three ways to write, nine rows, one panel.** A quick move and a tour
   REPLACE the placed frames; the needle REFINES them; the Moves toggle writes
   a zoom nobody asked for. Nothing says in what order they are meant to be
   used.
5. **The whole move is never seen without the deck's ▶**, which loops the
   whole piece by default (the `L` pill restricts it); the section itself has
   no playback, and the only drawing of the path is the tour's map, which
   opens only for a tour.
6. **On the phone the panel is a veiled sheet.** The rule fixed for Develop —
   a panel whose EFFECT you watch is a drawer sharing the column, never a
   sheet with a scrim — applies word for word to framing a picture.

## 3. Three faces for one storage

All three write what the code writes today — frames (pan + zoom) at instants,
the last being the composition. They differ in **what is seen** and in **what a
gesture writes**. Each is a working phone in the lab; the arithmetic under
them reproduces `framing.ts` and `framing-motion.ts` (pan as a fraction of the
frame's long edge, geometric zoom, the tour's time sharing, the six presets and
their refusals) over a drawn 3:2 picture in a 9:16 frame.

### A · Cards (recommended)

A move is a row of **frames one can see** — *Départ*, stops, *Arrivée* — as
54 × 96 thumbnails under the stage, joined by arrows carrying each glide's
seconds, a pause written at a card's foot. Tap a card: the stage shows it and
says so in a chip on the picture; drag and pinch write THAT card, never another.
*+ Arrêt* inserts a copy of what is shown after the selected card; *Retirer*
takes the selected one off (never *Arrivée*, which is the framing); *Immobile*
folds the row to the one composition card with a ghost *+ Départ* before it.
Time is derived: the tour's arithmetic (glides share the span by how far each
travels, one pause per stop, a *Pause* slider), generalised to a zoom per stop.
Quick moves are six chips writing *Départ* and *Arrivée*, with the reason under
them where one is refused. ▶ plays the slide with a progress hairline under the
row and the card being travelled to lit.

- What it costs: the time between two cards cannot be set by hand (a drag on
  the band's mark would give it back later, §6.6); a visit of many stops
  scrolls the row.
- What it buys: no invisible state — the number of frames IS the number of
  cards, the frame being edited IS the lit card, and the thumbnail is the
  *Arrivée* card by construction.

### B · Lane (today's needle, made legible)

The model as it is, with what it lacks: a **lane** under the stage the width of
the slide, the placed frames as 14 px diamonds (a 22 px grab), the rest as a
square at the end, a needle with its time, pauses as bars; a **chip on the
stage** that says what the next gesture writes — *Départ · 0,0 s*, *Cadre 2 ·
1,4 s*, *Arrivée · composition*, and in accent with a pulsing dot *Nouveau
cadre à 2,1 s*. A diamond is dragged along the lane to retime; ‹ › step
through arrivals; *+ Cadre ici* places a frame at the needle explicitly. A
switch tries the two rules for a gesture between two frames: it PLACES one
(today) or does NOTHING and the chip says to press +. The needle at 0 shows the
START.

- What it costs: a pause is still two diamonds; the lane shows instants, not
  pictures; on a 390 px phone a diamond is a 22 px target.
- What it buys: retiming at the instant, and the closest thing to what is
  built — three commits.

### C · Map (the whole picture as the surface)

`TourMap` promoted to the main surface: the whole picture 3:2 across the phone,
each stop a **window drawn on it** at its own zoom, a numbered 24 px dot at its
centre, a dotted path between them; the output as a picture-in-picture that a
tap swaps with the map. A tap on the picture appends a stop (the map's rule
today: the last stop is the arrival); a dot is dragged, its window following
and clamped by the edges; a pinch (or the ±, or a *Zoom* slider) tightens the
SELECTED stop's window about its centre — a zoom per stop, which the tour does
not have. The lane under it shows the stops at their derived instants with the
pauses as bars.

- What it costs: precision is on the map, not on the output — a ×2 window is
  73 px wide on a 390 px phone; a portrait picture gives a small map.
- What it buys: the trajectory read at a glance; the natural editor of a
  panorama.

## 4. Comparison

| Criterion | A · Cards | B · Lane | C · Map | Today |
| --- | --- | --- | --- | --- |
| Understood without explanation | yes — a frame is a card one sees | with the chip; the needle must still be read | yes on a panorama, less on a portrait | no (his report) |
| Where the frames are | thumbnails | named diamonds | windows on the picture | 6 px on the band |
| When a gesture writes a frame | never alone: it writes the tapped card, + adds one | either rule, by a switch | at a tap: one tap, one stop | at a gesture, 0.15 s from a frame |
| Precision in time | derived (shared by distance, a pause per stop) | at the instant (a diamond drags) | derived, A's arithmetic | at the instant |
| Precision in the picture | on the real output | on the real output | on the map (73 px at ×2) | on the real output |
| The whole move at a glance | the row | the lane (instants, not pictures) | the path on the picture | no |
| A five-stop visit | 5 cards, the row scrolls | 10 diamonds (a pause is two) | 5 windows | the map, behind «Plan a tour…» |
| The thumb, at 390 px | 64 px per card | 14 px diamond, 22 px grab | 24 px per stop | 6 px |
| The document | unchanged: cards are `tourMotion`'s keys | unchanged | unchanged: a zoom per stop is already a key | v28 |
| Commits to the phone | 4 | 3 | 3, on the map that exists | — |

## 5. Proposal — A as the face, B on the band, C behind «Visite»

The three are not rivals; they are three readings of the same keys. ONE
interface: the row of cards is what the Pan & zoom section shows on every
screen; the deck band keeps its marks and gains, later, the diamond one drags;
the map is the «Visite» view, full width in a sheet opened from the row.

Four rules change:

1. **The stage shows the selected card, never «the composition at 0».** The
   needle at 0 shows the start. The hook thumbnail is taken on the *Arrivée*
   card explicitly (`PostEditor` seeks the rest for the capture) instead of
   being a side effect of the first moment. Revises «paused on the first
   moment the stage shows the composition» (`roadtrip.md`, 2026-09-23): the
   reason — the thumbnail — is kept, the means changes.
2. **A gesture never writes a frame in silence.** It writes the tapped card.
   *+ Arrêt* adds one — a copy of what is shown, after the selected card — and
   that is the card one then frames. Time shares itself by distance with a
   pause per stop: `tourMotion`'s arithmetic generalised to a zoom per stop.
   Revises the «at the needle» half of his D: the storage stays, the gesture
   that PLACES leaves the phone; on the wide screen, question 1.
3. **What a gesture writes is said ON the picture.** A chip at the top of the
   stage — *Départ*, *Arrêt 2*, *Arrivée · composition*, and the time while
   playing — replaces the inspector's *Placing* row. It sits on the surface
   where the gesture happens, at the size of a photo's caption.
4. **On the phone, Image is a drawer, not a sheet.** The Pan & zoom section
   shares the column with the stage (`PanelHost compactAs="drawer"`, the rule
   Develop already follows), the row of cards at its head, the bottom bar left
   uncovered. The scrim leaves the one tab where a picture is framed.

What does not move: the model (v28), the six quick moves and their spoken
refusals, the curve, «after the opener», every export — built and verified, and
untouched by any face. `TourMap` exists: C is its promotion, not a rewrite.

## 6. In commits

1. **The cards, pure** — `shared/media/motion-cards.ts`: keys ↔ cards (stops at
   their own zoom, one pause), insert / remove / select, each card's label,
   which card the thumbnail is taken from; `tourOf` / `tourMotion` take a zoom
   per stop. Tests beside it.
2. **The stage says what it shows** — `PostEditor`: `stageFraming` reads the
   selected card, the thumbnail is captured on *Arrivée*, the chip replaces
   `placing`. The band's needle follows the card (it jumps to its instant),
   never the reverse.
3. **The row in the section** — `MotionCards.tsx` in Pan & zoom: cards,
   + Arrêt, Retirer, Pause, Courbe, the six moves as chips with their reasons,
   in place of Moves / Placing / Needle / Frames. The band keeps its diamonds.
4. **The drawer on the phone** — the Image tab as `drawer` on the compact
   shell, the row at the drawer's head, the stage flexing above. Measured at
   390 × 844 in the lab's mock: stage ≈ 400 px, drawer ≈ 300 (the mock's
   812 px screen is not his Safari's 730; re-measure there).
5. **Visite full width** — C's map in a sheet opened from the row («Voir sur
   l'image»): pinch tightens the stop, the output as a picture-in-picture, the
   lane of instants. `TourMap` gains the zoom per stop and a 24 px grab.
6. **Later, if the wide screen asks** — the band's diamond dragged to retime
   a frame (B). Nothing else asks for it today: sharing by distance covers a
   piece's rhythm.

## 7. His questions

1. **The gesture that places a frame: kept on the wide screen?** B shows both
   positions. Keeping it as an expert gesture (a drag between two cards places
   a stop there) costs one more red chip; dropping it everywhere makes one
   rule. Recommended: drop it.
2. **Cards on the band, or in the section?** The band carries 6 px diamonds.
   The cards could be drawn there (a thumbnail per frame inside the slide's
   cell) — one timeline — at the price of taller cells. Recommended: the
   section first, the band unchanged.
3. **A zoom per stop in the visit?** `TourPlan.zoom` is one zoom for every
   stop. C gives one per stop, which the keys already allow. Recommended: per
   stop, the Zoom slider acting on the selected one.
4. **What does «+ Départ» do on a still picture?** Moves writes a ×1.15 push
   today so that something is seen. With cards, *Départ* can be an exact copy
   of the composition (nothing moves until pinched) or keep the ×1.15.
   Recommended: keep the ×1.15, the card saying «Départ · à cadrer».

## 8. What the lab verified, and what it did not

- The arithmetic of the three faces reproduces the modules' rules over a
  drawn picture (no file loaded): pan in fractions of the long edge, the
  geometric zoom with `pan / zoom` linear, the tour's sharing with the 0.35 s
  glide floor, the six presets and the 2 % refusal — *Monter* and *Descendre*
  are refused at ×1 on a 3:2 in 9:16 with the reason written under the chips.
- Rendered headless at 1320 px (three phones side by side) and at 390 px
  through an iframe harness (one face at a time behind a switch), no console
  error; the gestures were not driven by a script — they are what to try on
  his phone.
- Not measured: the real app, the real heights of a drawer on his Safari, a
  collage cell, a clip, an opener covering the frame. Nothing here changes a
  document.
