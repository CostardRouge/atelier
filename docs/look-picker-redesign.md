# The look picker, measured, and three faces to redraw it

**Status: he picked A, the workbench, on 2026-10-01 — the day the faces were
drawn — and it is BUILT the same day** (`LutGalleryModal.tsx`, the decisions
in `docs/memory/frontend.md` «The look picker is a WORKBENCH on a desktop»).
The lab that carries the dialog as it was, reproduced from its code, beside the
three faces as working mocks at four screen sizes, with the measured table:
<https://claude.ai/artifact/WcwvdZ5zD7Gbnoecdep17R>. §1 is fact, traced to
`main` 0bcbdae; §2 is his report and the ten faults in the code; §3–§5 are the
proposal; §6 what was built; §7 is his. Read it before touching
`LutGalleryModal.tsx`, `LookScene.tsx` or `look-scene.ts`.

Written from his report, with a screenshot of his 1270 × 1300 window (the
screenshot at 1.5× DPR): *«la modal choose a look est très moche, peu
pratique, tout est décalé, follow the best UX/UI practises propose des
variantes de refonte»*, then *«go with recommended option»*.

## 1. What was built (fact, before this)

- **The dialog.** `max-w-[76rem]`, `h-[calc(var(--app-h) - 2rem)]`, a column
  of five bands: header (title + subtitle), the scene band, the "tiles on…"
  row, rail + grid, footer (a sentence + Close) — `LutGalleryModal.tsx:569–940`.
- **The scene band.** `h-[clamp(13rem, calc(var(--app-h) * 0.28), 21rem)]`
  (line 627): the picture fitted WHOLE into a box that takes the band's
  width minus a 21 rem controls column, on a `bg-frame` light table.
- **The controls column** (lines 665–719): the aimed name, a mono file line,
  `Compare` pill + a wipe slider, `STRENGTH` label + slider + `%`, the caution,
  then `mt-auto` → "Use this look" (`default`, `sm`) + "One lattice read — and
  the strength goes with your pick."
- **The "tiles on…" row** (744–757): a sentence saying the state, two ghost
  verbs, the filter at the right.
- **The rail** (793–807): `w-[13.5rem]`, labels from `FILM_GROUP_LABEL`
  (`FILM`), `'Built-in'`, `LUT_GROUPS[].label` (uppercased folders), a pack's
  node labels (its folders).
- **The grid** (875, 1052): `minmax(88px, 1fr)` tracks, `h-[74px]` thumbs,
  one section per shown node with its heading always drawn on a desktop, the
  "No look" tile on a row of its own.
- **The phone branch** (2026-09-21, `frontend.md`): a different arrangement
  of the same parts, measured at six tiles / two rows at 390 × 664. Not at
  issue, and untouched by everything below.

## 2. What the screenshot shows — ten faults, traced

1. **A portrait picture is a sliver on a black table.** The band is 336 px
   tall on his screen; a 9:16 frame is then 189 px wide in an 816 px box, so
   three quarters of the band is the table (line 627).
2. **The controls are a free stack with `mt-auto`**: the verb 250 px under
   the sliders; two sliders of one dress for two different numbers (where the
   wipe sits, how strong the look is), their tracks starting at different x,
   a `%` on one row only (665–719). No label column, no inspector grammar.
3. **Four sentences of standing prose** — the subtitle, "Tiles on their
   reference frames…", "One lattice read…", "Baked from the same lattice…"
   (580, 434, 715, 932) — against `frontend.md`, «Standing prose folds behind
   InfoDot»; the phone branch had removed every one.
4. **Two ways out**: ✕ in the header, Close in the footer, and the footer
   exists to hold the second (594, 935).
5. **Tiles of 96 × 74 px on a 1216 px modal**: `minmax(88px,1fr)` and
   `h-[74px]` were sized for the 56 rem modal of 2026-09-18 and never grew with
   it; FILM was one row of six in a 645 px scroller (875, 1052).
6. **Three casings in one rail**: `★ Favourites`, `FILM`, `Built-in`, `APPLE`
   (`builtin-luts.ts:46`, `gallery-nodes.ts:136,161`); the grid then repeats
   the open family as a heading (836).
7. **The pick gesture is only in the subtitle**: a click aims, a second picks;
   "Use this look" is a `default` button, disabled, at the foot of a side
   column 900 px from the tiles; the arrow keys do nothing (514–523, 372–383).
8. **"Shown on" reads as a sentence with two ghost verbs** where the suite's
   shape for a choice with a state is `Segmented` (744–757).
9. **Nothing says what the stack WEARS now**: the ring moves to the aim, and
   the worn look's accent border reads like a hover (1036–1043).
10. **The width is capped at 76 rem** while the same file's rule of
    2026-09-22 says a listing modal is sized by the screen (573).

## 3. The practice applied

One hero (the picture), one list (the looks), one verb (Use). Alignment on a
label column and proximity: what acts on the picture sits with the picture,
what filters the list sits with the list. Progressive disclosure: the
explanation behind ⓘ, the state said by the control. Fitts: the primary verb
big, in the corner every sheet in the suite puts it, targets ≥ 34 px.
Consistency with the suite's own parts: `Button`, `IconButton`, `Segmented`,
`FieldRow`, `InfoDotButton`, the darkroom tokens, the Develop sheet's `A/B`.
Recognition over recall: the worn look marked, the aim ringed, the second
gesture written on the tile, the arrow keys. And the layout follows the
content: the picture decides its box, the tiles are one size.

## 4. Three faces

| Face | Shape | Buys | Costs |
| --- | --- | --- | --- |
| **A · Workbench** (recommended) | The picture in a column at the left, as tall as the dialog, its card under it; the looks a panel at the right; the verb pinned. The column is as wide as the picture needs, never wider. | A portrait picture three times taller; the controls beside what they change; the grid scrolls alone with the verb in reach; nothing moves between a portrait and a landscape picture; the suite's own editor shape; the phone already is this, stacked. | A landscape picture is the size the band gave it, not larger; the rail is narrower (152 px). |
| **B · Band, set square** | Today's architecture, every fault fixed in place: the band's box takes the picture's aspect, the card fills beside it, the band taller (36 %, ≤ 28 rem). | The smallest diff; a landscape picture wide; eight tiles a row. | A portrait picture still bounded by the band: 252 px wide on his screen; the card beside a portrait box wide and half empty. |
| **C · Lightbox + strip** | The picture fills the dialog, the controls float over its corner, the families as crumbs whose roots open a tree menu, ONE strip of 176 px tiles. | The biggest picture and tiles everywhere; one vocabulary from phone to monitor. | The fewest looks on screen (6–8); a 25-look pack scrolls sideways; the tree becomes a menu — the flat row he refused on 2026-09-21, one level deep. |

**Measured in the lab, on his screen (1270 × 1300), the Built-in family open
(28 looks + the original):**

| Face | Picture drawn, 9:16 | Picture drawn, 16:9 | Tile | Looks on screen (9:16) |
| --- | --- | --- | --- | --- |
| Today | 189 × 336 | 597 × 336 | 148 × 74 | 21 |
| A · Workbench | 565 × 1004 | 594 × 334 | 139 × 97 | 20 |
| B · Band | 252 × 448 | 713 × 401 | 155 × 108 | 17 |
| C · Lightbox | 517 × 919 | 1188 × 668 | 176 × 111 | 6 |

The same table at 1440 × 900, 1280 × 800 and 1920 × 1080 is in the lab, live.

## 5. What every face changes

One way out (✕) and one verb (`Use this look ↵`, primary, pinned beside
Cancel); the prose behind ⓘ; the controls on `FieldRow`; `A/B` for the wipe and
the second slider gone; tiles that scale; one casing in the rail; the worn
look marked and the arrow keys; `Shown on` as a `Segmented`; the width
following the screen.

## 6. Built: A, in one commit

- **The shell**: one header (title · ⓘ · Packs… · ✕), the note under it when
  asked for, the pinned footer (the state · Cancel · Use this look ↵) where
  there is a scene and none where a click is the pick, the width cap
  `min(96vw, 100rem)`.
- **The stage column**: `stageColumnBox` (`look-scene.ts`, pure, tested) from
  the body's size, the card's height and the picture's aspect — a portrait
  frame takes the height, a landscape one half the width and a box only as
  tall as itself, the card right under; measured with a `ResizeObserver` in a
  layout effect. The card on `FieldRow`: Look (name · file · the look alone ·
  a `Conversion` chip), Strength, Compare (`A/B` + what it does), the caution.
- **The looks panel**: filter · `Segmented` Reference / My picture / Photo ·
  `Photo…`; the rail at 9.5 rem on an `expanded` shell, the phone's crumb strip
  on a `medium` one; fixed `8rem` tracks with 92 px thumbnails; headings only
  where they carry something; the ✓ on the worn look; `Use ↵` on the aimed
  tile; ← → ↑ ↓ and Enter; `familyCase` for the rail (`gallery-nodes.ts`).
- **Driven headless** at 1270 × 1300 (9:16 drawn **556 × 988**, three tiles a
  row, 24 of 29 on screen; 16:9 drawn 585 × 329 in a box of its own height),
  1440 × 900 (331 × 588 and six a row; 666 × 375), 1024 × 768 (the crumbs, four
  a row) and 390 × 664 (unchanged: six tiles, two rows) — the aim, the strength
  travelling with the pick, A/B and its divider, the arrows, one pick per
  Enter, the live bake and back, the search, the ⓘ, Escape, the no-picture
  host. Not seen on his Mac.

## 7. His questions

1. **The develop under the scene.** Open since 2026-09-21: the scene shows the
   look alone. The card has the row for a *Develop · on / off* switch; is a
   look judged over the correction or without it?
2. **The wipe's slider.** It was put beside the pill on 2026-09-21 so the wipe
   could be driven without discovering a gesture. The workbench keeps the
   `A/B` pill, a visible divider and a press anywhere on the picture to place
   it; if the slider is wanted back it is one more `FieldRow`.
3. **The rail's width** (9.5 rem): a pack's nested names truncate past about
   fourteen characters, with the full name in the row's title. A wider rail is
   tiles given up.
4. **The built-in looks' names** read off their file names (`Dji Air 3s D Log
   M To Rec709 V1`), which the bigger tiles now show in full; a naming pass is
   one pure function and its test, on request.
