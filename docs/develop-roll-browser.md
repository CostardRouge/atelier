# The roll's pictures in Develop, measured, and four faces to redraw them

**Status: a proposal (2026-10-02), nothing built.** The lab draws the editor at
its true pixel size on four screens (his 1270 × 1300 window, 1440 × 900,
1920 × 1080, a 390 × 844 phone), with today's band reproduced from its code
beside the four faces as working mocks, and the measured table:
<https://claude.ai/artifact/SKGeL5LXQ7ZAnZ5pH3xrUS>. §1 is fact, traced to
`main` f6ee666; §2 his ask; §3 the measurements; §4–§6 the proposal; §7 is his.
Read it before touching `Filmstrip.tsx`, the band half of `RollEditor.tsx`
(the status line and the strip, lines ~1202–1377), or the selection and key
rules in `shared/develop/roll-editor.ts`.

## 1. What is built (fact)

- **The cell.** A square, `w-[4.5rem]` (72 px) on a desktop and `w-14`
  (56 px) on the compact shell (`Filmstrip.tsx:111`), the picture
  `object-cover` — a 3:2 frame loses a third of its width, a 4:5 a fifth of
  its height. One row, `overflow-x-auto`, gap 6 px.
- **Up to ten marks on it** (`Filmstrip.tsx:199–302`): the open outline, the
  selection check (top-left), Winnow's `CullMark` (top-centre), the
  unreachable `!` (top-right), the `×` remove button (overhanging top-right),
  the variant number and the edited dot (bottom-left), the clip ▶
  (bottom-centre), the DELIVERY badge (bottom-right: click sends ↔ holds,
  right-click or a 550 ms hold ignores), the run's mark (centre). Three of
  them are buttons.
- **On a touch screen the two buttons grow to 28 px** (`pointer-coarse:w-7`):
  on a 56 px cell they cover 1,360 of 3,136 px², **43 %** — a tap that misses
  the centre fires an action.
- **Batch selection exists only through Shift / ⌘-click** (`Filmstrip.tsx:203`,
  D7 in `develop-roll.md`): a finger has no way to select two pictures.
- **No grip, no fold, no key.** The band's height is fixed; its filter
  (Winnow's culling, a `<select>`), the ignored Hide/Show, the selection
  count and Clear all live inside the one status sentence above the strip
  (`RollEditor.tsx:1202–1318`), which wraps to two lines at 390 px.
- **Keys taken** (`editorKeyAction`): ← → \ Z A D L C E X H ? I J V P M U,
  Delete, Escape, ⌘C/V, ⌘⇧C/V, ⌘', ⇧C. **Free**: B, F, G, S, `-`, `=`.

## 2. His ask (2026-10-02)

The thumbnails are too small on a phone and on a computer. Redesign the zone:
horizontal or vertical (*"comme la plupart des logiciels"*), one or several
rows or columns, perhaps a modal to choose pictures in; hide the per-thumbnail
icons (export, ignore, verdict, remove) behind a TWO-STEP gesture — enter a
selection mode, then act in bulk; let the zone grow, shrink and collapse
(*"comme dans d'autres applications"*), on a phone too, with a shortcut on a
computer to see the picture at 100 %. Variants in a lab, then discuss.

## 3. Measured (the lab's geometry is the shell's own constants)

The editor's chrome on a desktop: masthead 52, Library rail 48, tool padding
20, PageBar 40 + 12, inspector 352 + 16, toolbar 28 + 8 — so the stage-and-band
column is **(w − 456) × (h − 180)**; today's band takes 108 of that (gap 8,
status line 14, 4, strip 82). On the phone the column is **366 × 519** and the
band 107. The lab's DOM measures the same numbers.

- **His window is TALLER than wide** for the stage: 814 × 1012 px. A 3:2
  picture is bound by the width (814 × 543) and leaves **469 px of black**
  under and over it — room a band can take for nothing.
- **A 16:9 screen is the opposite**: 1464 × 792 at 1920 × 1080; a 3:2 picture
  is bound by the height, so every row under it costs picture, and a column
  beside it costs nothing.
- Photo area against today, at each face's default size (lab table):

  | face | his window 3:2 / 4:5 | 1440 × 900 3:2 | 1920 × 1080 3:2 / 4:5 | phone 3:2 / 4:5 |
  | --- | --- | --- | --- | --- |
  | A, one row of 100 px | = / −9 % | −14 % | −11 % / −11 % | = / −17 % |
  | B, one column (188 px) | −43 % / −42 % | −27 % | **+13 % / +29 %** | (a band) |
  | C, the rail alone | = / +1 % | +15 % | +17 % / +17 % | = / +23 % |

## 4. The four faces (lab)

- **A · Bande.** Under the picture, a GRIP to drag it: the rail (its own
  header: position, filter, Select), one row (100 px desktop, 80 phone; cells
  at the picture's aspect, clamped 0.56–2), then two, three rows — it becomes
  a justified grid scrolling vertically. Calm cells, a selection mode. Cost:
  height, on a 16:9 screen only.
- **B · Colonne.** The band standing, right of the picture (Capture One's
  Browser) or left, one to three columns by dragging its edge, names under the
  pictures. Free on a 16:9 screen, a third of the picture on his window and on
  a laptop; impossible on a phone, where it is the band again; on the left it
  sits beside the Library — two columns of pictures.
- **C · Planche.** The band folded to its rail; a CONTACT SHEET over the stage
  (`G`): big thumbnails (a size control), names, filters, selection and bulk
  verbs; a click opens and closes it. Full height for the picture, no
  neighbours visible while editing.
- **D · Bande + planche (recommended).** A everywhere, the rail as its folded
  state (`B`), C's sheet a key away (`G`), FOCUS (`F`, and a ⤢ verb in the
  toolbar's well, so a phone reaches it) for the picture alone; B's column
  offered in the band's ⋯ menu as a per-DEVICE preference.

## 5. The cell: read here, act elsewhere

- **What is READ stays**, small: one pill bottom-left (● edited, ↑ leaves,
  – held back, ⊘ ignored, the variant number, ▶ clip), Winnow's verdict
  top-right; once a cell is ≥ 112 px tall (92 on a phone) and always in the
  sheet, all of it moves to a CAPTION under the picture (name, then the
  glyphs). Ignored stays dimmed.
- **What is DONE leaves the cell**: no delivery badge, no `×`. The verbs go to
  (1) the SELECTION MODE — `Select`, `S`, a long press on a phone, or Shift /
  ⌘-click, which still keep `selectionAfterClick`'s rules and now switch the
  mode on — whose bar replaces the band's header: N selected · All · None ·
  ↑ Export · – Hold back · ⊘ Ignore · Apply ‹open›'s develop · More ▾ (rule,
  paste settings, a variant of each, take off the roll…) · Done; (2) the
  picture's MENU (right-click, or a ⋯ under the pointer); (3) `P` `U` `M`,
  which act on the selection while the mode is on; (4) the Export tab's table.
- **Removal** asks in the bar itself (the files stay; what was done goes with
  them) and is undone by the toast.
- **The status sentence** keeps only what asks for a click (fetch failures,
  working previews); the counts, the filter (one chip: All · Edited · To
  export · Held back · Ignored · Winnow picks · ★★★ · Not rejected, plus
  Ignored dimmed/hidden) and the position move into the band's header.

## 6. Proposed commits (D)

1. `shared/develop/roll-strip.ts`, pure and tested: justified rows, columns,
   the size → rows mapping, the rail threshold, "height follows the roll", the
   open cell's scroll.
2. The calm cell (pill, caption, ⋯); the delivery badge and `×` leave it; the
   memo's stable props kept (`develop-roll.md`, «cells are memoised»).
3. The selection mode and its bar; Shift/⌘ unchanged; a long press on touch.
4. The grip, the rail, `B`, a size remembered PER DEVICE in `localStorage`
   (never on the roll); the filter chip; the status sentence trimmed.
5. The contact sheet, `G`, full screen on a phone.
6. Focus, `F` and the ⤢ verb.
7. The column, if §7 Q1 says yes — the same band on the other axis.

## 7. His questions

1. **The column**: a per-screen preference, or not at all? (Recommended: in
   the band's ⋯ menu, remembered per device, the band underneath by default.)
2. **Height that follows the roll** (the band takes the room the roll's
   MEDIAN aspect leaves, so it does not move from one picture to the next) by
   default, or a size he drags and that stays? (Recommended: the dragged size,
   the other as an option — a band that resizes under the pointer surprises.)
   Following the OPEN picture was rejected for that reason.
3. **A long press on a phone**: selects (Google Photos) or opens the menu
   (iOS)? (Recommended: selects — the two-step gesture he described.)
4. **The sheet**: over the stage only, the inspector staying on the open
   picture, or full screen? (Recommended: over the stage.)
5. **Captions**: only when the cells are big, always, never? (Recommended:
   from 112 px, and always in the sheet.)
6. **The delivery badge leaves the cell**: are `P`, the menu and the bulk bar
   enough, against one click on the strip? (Recommended: yes.)
