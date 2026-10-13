# Sliders under a finger, measured, and three faces for one rule

**Status: he chose B the same day (2026-10-13, *«option b start the dev et
autres petits controls après»*) — built, §6 says what is in.** The
lab, the real rows (Trips' *On screen*, the Shades, a Develop slider) drawn
today and in the three faces at four panel widths, finger or mouse, with the
track's travel, the pixels per step and the grab height measured live:
<https://claude.ai/artifact/BKMC8hS5Re6pFr3B59em3r>. §1 is fact, read in
`main` e22b994; §2–§4 are the proposal; §5 his questions.

Written from his ask with two screenshots of *On screen* (a 1.0 s slide whose
track was a thumb and nothing else, and a 25.7 s one): *«les sliders … sont
difficiles à sélectionner … mériteraient d'être souvent sur une seule ligne …
une règle uniforme pour qu'ils puissent avoir vraiment la longueur du
conteneur … même sur desktop»*, and *«regarde si le reste de l'interface est
cliquable»*.

## 1. Why a track can be 30 px (fact)

- **`FieldRow` puts the slider on the label's line** (`shared/ui/Inspector.tsx`:
  a 5.75rem label column, then `RangeField`'s track `flex-1`, its value
  `min-w-[3.25rem]`, and whatever else the caller puts in the same flex row).
  In a 390 px phone sheet the control column is ~254 px; every sibling takes
  its width first and the track takes the rest.
- **Five `RangeField`s share their line** (of 135 in 32 files):
  `roadtrip/panels/SlideDelivery.tsx` (the owner pill `Auto · Virée` /
  `Set by you`, `whitespace-nowrap`, plus the `Auto` button — measured in the
  lab at 75 px of travel with the pill alone, ~35 px with both, for 119 steps
  of 0.5 s: < 1 px a step), `develop/ExportTargets.tsx` (Max),
  `develop/BorderSection.tsx` (link glyph), `atlas/AtlasInspector.tsx` (Jitter's
  re-roll), `overlay/StylePanel.tsx` (reset glyph when overridden). The other
  130 are alone in their row but still lose 104 px to the label column.
- **The grab is 16 px tall**: `.range-fill` (`index.css`) is a 3 px track and
  a 14 px thumb with no `(pointer: coarse)` rule; Apple asks 44 pt, Material
  48 dp. The thumb size is hard-coded in the fill's `calc` (14 px / 7 px).
- **Three families**: `RangeField` (one line), Develop's `RangeSlider`
  (`shared/develop/DevelopSliders.tsx` — ALREADY two storeys: label · value ·
  reset above, a full-width native range below, ~40 call sites), and 21 raw
  `<input type="range">` (six in `ComposerTool.tsx` at `w-20`–`w-32`, the rest
  `flex-1`/`w-full`; `RoadSettingsPanel`, `LutPicker`, `OverlayStudio`,
  `CompareTool`, `LutStudio`, `TimelapseSheet`, `LayersPanel`, Deduce's two).
- **A native range jumps where it is touched** in Chromium on Android, and
  nothing in the suite keeps a vertical scroll of a sheet from moving one.

## 2. The rule, whatever the face

- **R1** The track never shares its line: the full width of its panel, under
  the label included. The value, the owner pill and the verbs go on the line
  of words.
- **R2** A 44 px grab band under a finger, 28 px under a mouse, decided by
  `(pointer: coarse)` and never by width (the C5 rule of `press-feedback.md`);
  thumb 24 / 16 px, track 4 px; the fill's `calc` reads the thumb's size.
- **R3** Tap to place, drag to adjust (his answer to §5.2, 2026-10-13: *«si
  je clique au début ou à la fin, ça aurait dû me mettre au minimum ou au
  maximum»*). Under a finger, a TAP — lifted before 6 px of travel — places
  the value where it landed, the ends included; a DRAG, from anywhere in the
  band, is relative: the thumb follows the movement and never jumps under the
  finger, which keeps the precision. A scroll still changes nothing, having
  moved past 6 px before its lift. A mouse keeps today's click and drag.
- **R4** A vertical gesture scrolls the panel: the slider claims the pointer
  only after 6 px of horizontal travel (`touch-action: pan-y`), the rule
  `frontend.md` already states for drag surfaces in a scroll box.
- **R5** The value is typed: a tap on it opens a decimal field (16 px).
- **R6** ONE component: double-click to the default, Shift + arrows for ten
  steps, keyboard and screen reader through the native input; a lint rule then
  refuses `type="range"` outside it.

## 3. Three faces

- **A · Two storeys** — words on top (label, changed dot, value, `trailing`
  pills and verbs), the track across the whole width below. Costs ~18 px of
  height per slider. Develop's `RangeSlider` already IS this, so the three
  families become one. **Recommended, desktop included** (he said it would be
  welcome there too, and a rule that changes with the width is not uniform).
- **B · The bar** — the whole row is a 36–44 px bar, the fill is the value,
  label and value written inside, drag anywhere. Most compact, but a control
  no other part of the suite resembles, a label whose contrast changes as the
  fill crosses it, and the keyboard and accessibility rebuilt.
- **C · One line when it fits** — a container query keeps today's line while
  the track would get ≥ 160 px (~470 px of row), else A. Two drawings of one
  control; the grid jumps as a panel resizes.

## 4. If A: commits

1. `SliderRow` in `Inspector.tsx` + the R2 sizes in `index.css`.
2. `slider-drag.ts` (axis intent, relative grab, step, bounds), pure, tested,
   driving the native input.
3. The typed value (R5); double-click and Shift + arrows everywhere.
4. Shared panels: shades, overlay (style, timing, scene, knockout), grade and
   film, Trips' opener rows.
5. Tools: Trips (*On screen* first), Develop (`RangeSlider` becomes it),
   Atlas, the Studio, Develop's export and border.
6. The 21 raw ranges, and the lint rule.

Each verified by typecheck, lint, test, build, and the gesture replayed
headless at 390 px with touch.

**The rest of the interface** (asked at the same time): the main verbs
already grow under a finger (`useFingerSize`, 34 px), but the shared kit does
not grow BY ITSELF — `Button`/`IconButton`/`Segmented` `sm` stay 28 px in
almost every inspector row, `ToggleField` is 36 × 20, raw checkboxes 15–16 px
(`AssetSidebar`, Deduce's `FineSettings` and `CalqueWindow`, `CameraPanel`,
`LutPackImportModal`), `TrimBar` handles 15 × 22, curve points a ~9 px grab
radius (`curve-edit.ts` `GRAB_RADIUS`). Proposed as a pass right after the
sliders: `sm` → `md` under `(pointer: coarse)` inside the components, a 44 px
hit zone for the switch and the boxes without changing their drawing, wider
grabs for the trim handles and curve points. Nothing changes under a mouse.

## 5. His questions

1. A, B or C (recommended: A, desktop included)? **He chose B.**
2. ~~Under a finger, a tap on the track: does nothing, or places the value?~~
   **Answered 2026-10-13: it places the value** (R3); the lab does so.
3. The typed value: everywhere, or only on long ranges (durations, km)?
   **Left to the build: everywhere** — but opened by a 500 ms HOLD or Enter,
   not by a tap on the number, since in B the number sits inside the bar and
   a tap there must place the maximum (R3).
4. The other small targets: a pass right after the sliders, or later?
   **After** («autres petits controls après»).

## 6. Built (face B)

- `shared/ui/slider-gesture.ts` (pure, tested): snap, tap, relative drag,
  intent, the fill's origin, the typed value's unit.
- `shared/ui/SliderBar.tsx`: the bar — 36 px, 44 px under a coarse pointer,
  name inside at the left, value at the right, a wash filled from the reset
  value (0 on a bipolar range), a 2 px accent edge, a dot and a ↺ once it
  departs, double-click to reset, Shift + arrows, Enter or a hold to type.
  The native range stays inside, transparent, for the keyboard and a reader.
- `SliderRow` in `Inspector.tsx`: the bar, then `trailing` (pills, verbs) on
  its own line, then the hint. `RangeField` and `.range-fill` are deleted.
- 127 rows migrated by a codemod over the TypeScript tree (a `FieldRow`
  holding one `RangeField`, plus any verb after it as `trailing`), the rest
  by hand: *On screen*, the Shades' centre (two full-width bars under the
  *Place on the picture* row, back to the middle at 50 %), the camera's
  turning, the grouping distance, Atlas's `Slider` and Jitter. Develop's
  `RangeSlider` is a `SliderBar` too, so every Develop slider follows.
- Driven headless at 390 px with CDP touches in Atlas's Style tab: taps at
  both ends and the middle, a relative drag from the left edge (51 → 66 %),
  a vertical swipe (no change), a hold then `30` + Enter (→ 30 %).
- Left as native ranges on purpose: the PLAYHEADS (Develop's transport, the
  overlay page, LUT Studio, Compare, the making-of preview, the Composer's
  seek) — a position in a clip, not a setting.
- Next: the remaining raw setting ranges (look strength in the gallery and
  the LUT picker, a layer's opacity, Deduce's grain and fine settings, the
  road settings, the Composer's toolbar) and a lint rule; then the other
  small targets of §4.
