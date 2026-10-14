# Small targets under a finger, measured, and three faces for one rule

**Status: a proposal awaiting his pick (2026-10-14).** Nothing is built. It
is the pass he asked for after the sliders (`slider-touch.md`, *«autres petits
controls après»*, then *«vas-y … design or artifact first»*). The lab is an
inspector excerpt holding every small control, drawn today and in three faces,
at phone and tablet widths, finger or mouse. It shows each control's hit zone,
marks two zones that overlap, and draws a 44 px finger disc on every press
saying what it touched:
<https://claude.ai/artifact/Ajtamt8u9J3VaA14ihEkQW>.

## 1. What stays small (fact, read in `main` e22b994 + the slider branch)

| Control | Drawn | Grabbed today | Uses |
| --- | --- | --- | --- |
| `Button` · `IconButton` · `Segmented` at `sm` | 28 px tall | 28 px | 355 `size="sm"`, 142 `Segmented` |
| `ToggleField` / `SwitchRow` switch | 36 × 20 | 36 × 20 (the label wraps only the switch and its words) | 115 |
| Raw checkboxes | 15–16 px | 15–16 px, some with no clickable label | 16 |
| `InfoDot` ⓘ | 16 px | 32 px (`after:-inset-2`) | everywhere |
| `TrimBar` handles / head | 3 × 16 bar | 15 × 22 / 17 × 14 | Studio, Trips |
| Curve points (`curve-edit.ts`) | r ≈ 4 | `GRAB_RADIUS` 0.045 of the box, ≈ 9 px, and a tap beside a point ADDS one | Develop |

`useFingerSize()` exists since 2026-10-03 (`press-feedback.md` C5) but only
13 call sites ask for it. The shared components do not grow by themselves,
so every other caller gets the mouse's size under a finger.

## 2. The three faces (measured in the lab at 390 px, finger)

- **A · Grow.** Everything grows where it is drawn: rows to 34 px, the switch
  to 44 × 26, a box to 22, the ⓘ to 22, and the trim handles to 28. **17 of
  19 targets stay under 44**: reaching 44 by drawing alone needs 44 px
  buttons. Rows get longer and the handles hide the clip.
- **B · Halo.** No drawing changes, and every target gets an invisible 44 px
  zone. **All reach 44, and 14 of 19 overlap a neighbour.** A row of icon
  buttons 8 px apart, or two rows 10 px apart, put one control's zone over the
  next, and the finger takes whichever is on top.
- **C · Rows and marks (recommended).** What lives in a ROW (a button, a
  segment, the ⋯) grows to 34 px, and its zone reaches 44 vertically and at
  most half the gap sideways. The gap between icon buttons goes to 10 px under
  a finger. What is an isolated MARK (an ⓘ, a ↺, a swatch, a chevron, a
  handle) keeps its drawing and gets a 44 px zone. An on/off setting is
  touched by its whole LINE, words included (iOS's rule). The trim bar's two
  bands grow AWAY from each other: the handles' zones reach up and outward
  from the kept span, the head's reaches down. **All 19 reach 44, and none
  overlap.**

The mouse is unchanged in all three: the size follows `(pointer: coarse)`,
never the width.

## 3. The rule, if C

- **T1** Under a finger every target is grabbed on 44 px both ways, decided
  inside the component by `(pointer: coarse)`, never by the width and never
  by the caller.
- **T2** A row grows and a mark gets a halo. `sm` controls go 28 → 34 px with
  a zone of 44 in height. ⓘ, ↺, swatches, boxes and handles keep their
  drawing and get an invisible zone.
- **T3** An on/off setting is touched by its line: `ToggleField`/`SwitchRow`'s
  whole row, and a new `CheckRow` replacing the 16 raw checkboxes.
- **T4** Two zones never overlap: a halo stops halfway to its neighbour, and a
  layout sweep checks it.
- **T5** A tap beside something creates nothing. On the curve a point is
  grabbed within 22 px under a finger, and a tap adds a point only beyond
  that.

## 4. Commits, if C

1. Rows: `Button`, `IconButton`, `Segmented`, `OverflowMenu`'s trigger at `sm`
   → 34 px under `pointer-coarse:` with a vertical halo to 44.
2. Marks: a `touch-halo` utility (a 44 px `::after`) on the ⓘ, the bars' ↺,
   swatches and the section chevron.
3. On/off: the whole line of `ToggleField` / `SwitchRow` is the target;
   `CheckRow` for the 16 boxes.
4. Trim: handles and head at 44 px of grab, on their own bands, the drawing
   unchanged.
5. Curve: the grab radius in pixels per hand in `curve-edit.ts` (pure,
   tested), and the tap that adds only beyond it.
6. The guard: a headless sweep at 390 px with touch measuring each target and
   each overlap on a few screens.

## 5. His questions

1. A, B or C? (recommended: C)
2. Under a finger, rows grow from 28 to 34 px *visibly*. Is that fine, or
   should they keep 28 and gain only the invisible zone, at the cost of
   overlaps in tight rows?
3. On the curve, a tap beside a point: does nothing under a finger
   (recommended), or adds a point as the mouse does?
