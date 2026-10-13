# The openers' inspector — finding one's way among 103 settings

*2026-10-12. A proposal, not a decision. From the maintainer's ask: in Trips, and
above all in the map openers (Virée, Itinerary), "there are so many options it
is hard to know where you are and what you are doing"; he named separators,
numbered options, illustrations like the summary card's faces, and a modal (with
its drawback: the content is hidden). Lab with every face working on a phone and
a computer: https://claude.ai/artifact/VQLNPiLsmu3DE4AeSJC5Mx*

## 1. What the code says (fact)

- **Virée's panel holds 103 controls** (`shared/roadtrip/hooks/drive.tsx`,
  `DrivePanel`), **the Itinerary's 71** (`map.tsx`, `MapPanel`), plus 12 in a
  stop's popover (`stops-editor.tsx`). Counted one per widget that writes a value
  or starts an action; many show only under a condition, so a default Virée
  draws about half.
- **Nine groups in Virée, none folds.** An opener's panel mounts INSIDE the Look
  tab's one `piece.opener` section, so it "cannot open sections of its own"
  (`panel-ui.tsx`): a `Group` is a mono legend with no fold, no number, no ⓘ.
  Road · Pictures · Vehicle · Map · Motion · Camera · Recap · Summary card ·
  Sound. The Itinerary: Stops · Pictures · Frame · Path · Places · Motion ·
  Camera · Extras · Sound.
- **Every hint stands open** under its control: `FoldHints` is used by
  `CrossingsPanel` and Develop, never by an opener.
- **Two settings are drawn**: the summary card's Face (`FaceThumb`, the card's
  own painter over this piece's road) and Look (`card-thumbs.tsx`). Path,
  Ahead, Ground, Names, Where, Shown as, Camera, Preset, Orientation, Pen and the
  easings are words.
- **On a phone the Look tab is a SHEET over the stage** (`PostEditor`,
  `compactAs = 'sheet'`; only Picture is a drawer), and `HookPanelProps` carries
  no `compact`. One sets the scene without seeing it, then closes to look.

## 2. Six faces (the lab draws each, on both devices, over the real lists)

| Face | Idea | Cost |
| --- | --- | --- |
| **A · Sommaire** | The panel opens on a NUMBERED index (1 Stops … 9 Sound), each line its state in words («Curved · Dashed · trail») and a dot where it departs from the default; a tap opens ONE chapter, ‹ › to its neighbours, rows addressed `5.3` | 3 commits |
| **B · Planches** | Today's column with each group a numbered FOLD carrying its summary; every enumerated choice a tile DRAWN by the opener's own painter (cropped to the route for a line's look, the whole frame for a placement); hints behind ⓘ | 2 commits |
| **C · Scène** | Numbered pins ON the stage — the road, the vehicle, a stop, the ground, a print, the camera's corner, the badge; a tap opens that chapter. What has no place on the picture (Motion, Sound) is a chip under it | 2 commits after A |
| **D · Actes** | Settings by MOMENT of the film — Set · Opening · The drive · At each stop · The end; an act moves the stage to its moment | 3 commits |
| **E · Essentiel** | Four drawn recipes, the eight settings that change the picture most, a SEARCH over all of them, the rest by chapter | 3 commits |
| **★ Proposée** | A + B + C + E: the numbered index, entered by reading, pointing at the stage or searching; drawn choices inside a chapter; a DRAWER on the phone | 7 commits |

Rejected in the lab, with reasons: **the modal** — it hides the content, his own
objection; the drawer gives a modal's room and focus without hiding the stage.
**D as the face** — it cuts one object across acts (the camera is set in three);
it may come back as a filter.

## 3. Recommendation: ★, in seven commits

1. **Pure chapters** — each variant declares its chapters (number, title, a
   summary of its options) in a DOM-free module beside a test.
2. **The phone's drawer** — the Look tab a `drawer` on the compact shell like
   Picture; `HookPanelProps` gains `compact`.
3. **Index + chapter** — `ChapterIndex` / `ChapterPane` in `shared/ui`, Virée
   first; the last chapter opened is remembered per opener.
4. **The other openers** — Itinerary, Défilé, Vitrine, the recap card.
5. **Drawn choices** — an optional `HookVariant.thumb(options)` over the
   variant's painter (the `FaceThumb` pattern); Path, Ahead, Ground, Names,
   Where, Shown as, Camera, Pen, Motion first.
6. **Pins on the stage** — an editor-only `parts()` beside `frameBox`; a tap
   opens the chapter, a drag still moves the opener.
7. **Search** — over labels, choices and chapter titles, in the index's head.

## Built (2026-10-12 → 13)

He accepted the recommendations and asked for a compact picker instead of the
lab's band: the six openers are a 3 × 2 grid of their own sketches (PR #304).
Then the seven steps above, one commit each. Two departures from §3, both
recorded in `docs/memory/roadtrip.md`:

- **Step 5's tiles are glyphs, not renders by the painter**: `prepare()`
  computes Virée's whole road on every call, so a tile per choice would run it
  a dozen times per change. Easing curves are plotted from the engine's own
  functions.
- **Step 4 needed nothing of its own**: every opener's groups got their
  chapters in step 1; opening each chapter in a harness found two wrong
  summaries, fixed.

The answers taken for §4: ★ whole; chapters numbered, rows not; the panel
reopens on the last chapter open for that opener on this device; pins while
the opener is selected — and, for Virée, which fills the frame and cannot be
selected on the stage, while the Look tab is open.

## 4. His to decide (answered above)

1. Which face — ★ whole, or part of it (B alone is the cheapest step).
2. How far numbers go — chapters only, or every row (`5.3 Ahead`) so the two of
   us can name a setting.
3. Where the panel opens — always on the index, or on the last chapter opened
   (recommended, with «‹ All» one tap away).
4. When the pins show — only while the opener is selected on the stage
   (recommended), or whenever the Look tab is open.
