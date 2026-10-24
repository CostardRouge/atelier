# Seeing the picture without one setting

**Status: designed, not built (2026-10-24).** Six faces, playable on a
retouched test picture with a Develop column drawn like `SliderBar` and
`DevelopFold`: <https://claude.ai/artifact/QAuPdLzncbaqjV5MFQgY67> (the lab
is in French, his language; the labels are the suite's English). §1 is fact,
read in `main` 20f863b; §2–§4 are the proposal; §5 his questions.

Written from his ask: *«temporairement désactiver l'effet d'un slider … aussi
sur le groupe … le petit œil des masques … j'ai peur que ce petit œil prenne
de la place … peut-être un menu contextuel, un raccourci, ou le survol»*.

## 1. What exists (fact)

- **A slider goes back, never away.** `SliderBar` draws a dot (in the bar's
  left padding) and a ↺ only while the value departs from `reset`; a
  double-click or the ↺ writes `reset`. To judge ONE setting today: ↺ then
  ⌘Z — two gestures, one history entry, and the comparison is made from
  memory.
- **"Before" is all or nothing.** Holding the stage 350 ms
  (`hold-before.ts`) or `\` shows the picture as shot.
- **A group is a `DevelopFold`** whose `marked` dot says something in it
  departs; its header band is empty after the ⓘ.
- **A layer's eye is an EDIT**: `AdjustLayer.enabled` is stored on the
  record, and `layer.ts` drops a disabled layer from the render and the
  export alike.

## 2. Is it worth it

Yes. Settings stack and cancel each other out (Vibrance against Saturation,
Shadows against Contrast, Temperature against a look); knowing which one
carries the effect is the most frequent question when editing. And it can
cost **no pixel**: the ↺ and the dot exist exactly when the setting departs
from 0, which is exactly when "without it" means anything. Prior art, as far
as known: Capture One (click the tool's reset = reset, HOLD it = view without
that tool), Lightroom / Camera Raw (an eye on a panel's header, press and
hold; Classic's panel switches stay off and export so), Photoshop (a layer's
eye, ⌥-click = solo), Resolve (⌘D a node, ⇧D the whole grade).

Not every slider of the suite: only those that change pixels (Develop, its
layers, the look, film). A slide's length or an export's quality gets
nothing.

## 3. The six faces

| | Face | Pixels | Stays off | Group | Risk |
| --- | --- | --- | --- | --- | --- |
| A | Hold the ↺ (Capture One) | 0 | no | hold the fold's dot | a release before 350 ms resets — ⌘Z, and a ring that fills while arming |
| B | The dot becomes an eye | 0 in width | yes | the fold's eye | a 44 px finger zone eats the bar's left end (tap-to-place at the minimum); an eye forgotten off |
| C | ⌥ + hover, sweeping the column | 0 | no | hover the band | mouse only; invisible unless the ⓘ and the shortcuts sheet say it |
| D | A menu (right-click, the fold's ⋯) | 0 | yes | ⋯ | three gestures a comparison; a long press on a bar already TYPES the value |
| E | An eye in the fold's band (Lightroom) | 26 px in an empty band | yes | it is the group | no per-slider grain |
| F | The A/B split as "without X \| with" | 0 in the panel | while A/B is on | toggle | a mode to switch on; which setting is out must be labelled |

Hover WITHOUT a modifier was refused: the picture would flicker each time the
pointer crosses the column.

## 4. The recommendation

One rule: **a press that is held is a LOOK** (writes nothing, no undo entry,
the export never sees it); **an eye that stays off is an EDIT** (on the
record, followed by ⌘Z and the export — as a layer's eye already is). Then:

- **A wherever a setting departs**: hold a bar's ↺, hold a fold's dot; ⌥ +
  hold = this one alone. Same 350 ms hold as the stage's before.
- **C on a computer**: ⌥ held, sweep the column.
- **E for what stays off, at the GROUP level only**: the eye takes the dot's
  place in the band; hold = look, tap = off, ⌥ + hold = solo. A per-slider
  eye that stays (B) would show a value that does not apply — a trap for the
  export, the presets and the clipboard; ↺ already serves that need.
- D and F later or never.

**Commits if chosen.** P1 `develop-peek.ts` (pure, tested):
`peekDevelop(settings, target)` → the settings without a key, without a
group, or with that group alone (0 for a number, `null` for a curve, mixer,
wheels); the stage takes `peekDevelop(draft, peek)` as it takes the split —
view state; `SliderBar` gains an optional `onPeek` (the ↺'s hold, only when
given), `DevelopFold` the dot's. A look costs one drag step (the render
resumes after the last unchanged pass). P2 ⌥ + hover and its shortcuts line.
P3 the fold's eye, an `off` field read by the render, the export,
`describeDevelop`, the clipboard and presets. P4 the same look on a layer's
sliders. Verify headless: the stage's pixels during a hold, and an exported
file byte-identical before and after a look.

## 5. His questions

1. The group's eye that stays: an edit stored and exported like a layer's
   eye (recommended), or a look cleared when the picture changes?
2. Per slider: the held look only (recommended), or also an eye that stays (B)?
3. ⌥ + hover on a computer?
4. Does the histogram follow what is looked at during a hold (recommended:
   yes, it describes the picture on screen)?
5. The "without | with" split: later, or never?
