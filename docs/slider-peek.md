# Seeing the picture without one setting

**Status: his pick is made, not built (2026-10-24) — §6 says what he chose
and what is still his.** Lab 1, the six faces, playable on a retouched test
picture with a Develop column drawn like `SliderBar` and `DevelopFold`:
<https://claude.ai/artifact/QAuPdLzncbaqjV5MFQgY67>. Lab 2, his pick put
together: <https://claude.ai/artifact/X2kx8KnNDWqw8WmfkynF3S> (both labs in
French, his language; the labels are the suite's English). §1 is fact, read
in `main` 20f863b; §2–§4 are the first proposal, §4's recommendation was
NOT followed; §5 its questions.

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

## 6. His pick (2026-10-24) and lab 2

**Chosen: B (the dot becomes a switch) + D (the menu) + a floating pill on
the stage. Refused: the held press (A)** — *«la pression tenue … va prendre
du temps et me saouler»*, even with a shorter delay. Hiding is TEMPORARY
(*«ce qui a été modifié temporairement»*): a view, never written — REVERSED by §7, where hiding became an edit. The
split "without | with" (F) gets its own lab later, at his request.

What lab 2 proposes on that basis:

- **The switch has its own slot**: every bar reserves 26 px at its left
  (the label moves 16 px right, every name still at one x), the switch
  shown only on a bar that departs or is off — lab 1's eye sat on the name.
  Under a finger the slot is the bar's full height; a tap there switches
  instead of placing the minimum. Three glyph options (dot / eye / dot on
  bars + eye on the fold's band) and two off looks (faded / greyed, the
  value struck) — his to pick; he fears an eye per bar gets repetitive.
- **The menu** (right-click a bar or a band, the band's ⋯, or HOLD the
  switch under a finger — the bar's own hold already types the value):
  Reset X (greyed at 0) · Hide / Show X · Show only X · Invert hidden. No
  *Reset all*: the header's *Reset to as shot* exists, and his own call.
- **Show only is reversible**: it pushes the hidden set it replaced; while
  nothing moved since, the same line reads *Show the others again*; the
  pill's ↩ pops one level per press (a whole stack costs what the last one
  does). Invert swaps shown and hidden among the SET settings, naming a
  whole group when all its set bars go off.
- **The pill** (only while something is hidden): one chip per hidden thing
  (a tap shows it again), ↩, ⇄ Invert, Show all; or compact, "3 hidden ·
  List".
- **Not the snapshots**: going back to one is a journaled write ⌘Z undoes
  (`snapshots.ts`); hiding must never enter the history, the clipboard or
  ⌘Z. The state is `hidden: Set` + `back: [{ label, prior, made }]`, pure
  (`hidden-view.ts` in P1), held per picture in memory for the session.

**Commits once the four choices are made**: P1 `hidden-view.ts` (pure,
tested) and `viewDevelop` read by the stage and the histogram; P2 the
`SliderBar` switch (an optional `toggle`, given only by Develop bars that
change pixels) and `DevelopFold`'s; P3 the menu (portalled, the band's
existing `actions` slot); P4 the pill; P5 a layer's sliders.

**Still his**: the glyph; faded or greyed; full or compact pill; the
lifetime (per picture for the session, recommended, or cleared on leaving
the picture); at export with something hidden, the file keeps the whole
edit and the Export panel says so in one line (recommended) or follows the
screen — which would make hiding an edit again.

## 7. His answers (2026-10-24): hiding is an EDIT

He took every recommendation of lab 2 — **a dot on the bars and an eye on a
group's band, greyed when off (the value struck), the detailed pill, the
reversible Show only** — except one: **hiding is an edit, and the export
follows the screen**. *«ça me permet de vraiment exporter ce que je vois …
cocher ou pas et voir comment ça fonctionne visuellement, mais aussi à
l'export»*: a picture that needs a setting or not, a variant made by
switching one off. So the hidden state lives on the picture, survives a
reload, enters the journal and ⌘Z like any write, and the lifetime question
of §6 is gone.

**How, without touching fifty read sites: PARK the value, never flag it.**
A picture's develop is read in ~50 places (stage, export, previews,
thumbnails, the carried edit in Trips and the Studio, the making-of video,
`isDefaultDevelop`, `describeDevelop`…). An `off` flag beside a live value
would have to be honoured in every one, and one missed site is a preview
that is not the export. Instead, hiding MOVES the value aside: the live
field becomes its default (0, or `null` for a curve, mixer, wheels) and the
value waits in `DevelopSettings.parked` (optional, no migration); showing
moves it back. Every reader then renders what is seen with no change, and
only the inspector knows: a parked bar is drawn greyed AT its parked value,
with its dot hollow. Moving a parked bar's slider brings it back at the new
value. A group is off when every set key of it is parked; lighting one bar
of an off group unparks that bar only.

**Defaults taken (say if wrong)**: ⌘C / ⌘V carries `parked` with the develop
(the clipboard copies a whole picture, `develop-roll.md`), so a pasted
picture looks the same AND keeps the same switches; a preset saves what is
SEEN, never what is parked; Auto writing a parked key unparks it; Show only
and Invert are single journaled writes, and the pill's ↩ restores the
parked set before them by a write too (⌘Z works as well).

**Scope by commit.** P1 `parked.ts` (pure, tested): park / unpark a key or
a group, show only, invert, the in-memory ↩ stack. P2 the switch on every
Develop slider whose value lives in `DevelopSettings` — Light, Tone,
Colour, white balance, curve, levels, mixer, grading — and on their folds,
with the greyed look. P3 the menu. P4 the pill. P5 the sections that are
their OWN fields on the picture (Presence and detail, vignette, lens, look,
layers' sliders): the same parking, one field each.

**P1 built (2026-10-24)**: `DevelopSettings.parked` (cloned, compared,
normalised and stored by `develop.ts` like every other field) and
`parked.ts` (pure, tested): park / unpark, a slider's and a group's switch
(`DEVELOP_GROUPS`, one per fold; a group reads `none · on · mixed · off`),
`writeLive` (a value written to a parked field brings it back), show only,
invert, `restoreParked` for the pill's ↩, and `withoutParked`. Wired in the
same commit: a preset saves what is seen (`develop-presets.ts`); a develop
whose every setting is off still STORES (`developOrNull`) and still counts
as an edit (`pictureEdits`), since it draws as shot but holds work; the
clipboard carries `parked` through `cloneDevelop`, and `withoutBase` drops a
parked RAW white balance as it drops the live one. Nothing on screen yet.

**P2 built (2026-10-24)**: the switches on screen. `SliderBar` takes a
`toggle` (`{ off, onToggle }`): the bar keeps a 28 px left pad so every name
of a switchable column starts at one x, the departed dot becomes a button
in a full-height 26 px slot, and off draws the fill `bg-line`, the edge and
↺ grey, the value struck, `aria-valuetext` "…, switched off". `DevelopFold`
takes `switched` (`foldSwitch`): an eye in `InspectorSection`'s new `mark`
slot (in place of the dot, never folding the band); `dimOff` fades a
one-block fold's body (`dimmed`). Wired in the Develop tool and the Trips /
Studio sheet for Light, Tone, Colour, White balance, Levels, Curve, the
mixer (its switch is `mono` while B&W is on) and Colour grading; each
control is given `shownOf` (the waiting value while off). NOT yet: a layer's
sliders (P5), the menu (P3), the pill (P4). Driven headless on a dropped
JPEG: a switch changes the stage and keeps the number, survives a reload,
moving the bar brings it back, the Colour eye goes `mixed` → off, Levels
off returns the stage to the original pixels and fades its body.

**P3 built (2026-10-24)**: the menu. `parkedMenu` / `applyParkedVerb`
(`parked.ts`, pure, tested) say what it holds and what each verb writes;
`ParkedMenu.tsx` is ONE `ParkedProvider` per open develop (the workbench's
render root, the Trips / Studio sheet's portal) holding the steps back for
the visit and drawing the one `AnchoredMenu`. Openers: `SliderBar`'s
`onMenu` (right-click; the menu key or Shift+F10, whose `contextmenu` comes
at 0,0 and hangs it from the bar; the switch held `LONG_PRESS_MS` — a
finger's long press on the bar itself stays the typed value's, so a touch
`contextmenu` is ignored there), `InspectorSection`'s `onBandMenu`, and
`DevelopFold`'s ⋯ (in `actions`, so only while open) and held eye. **Rule**:
only a column that switches gets a menu (`DevelopSliders` checks
`onSwitch`; an object fold needs `switched`) — a layer's sliders sit inside
the picture's provider and their menu would write the picture's develop. A
slider at its default has no menu. Driven headless: right-click → Show only
Vibrance turned Exposure and Saturation off, the line then read "Show the
others again" and put them back; the Colour ⋯, Shift+F10 and a held switch
(nothing switched) all open it.

**P4 built (2026-10-24)**: the pill, `ParkedPill` (`ParkedMenu.tsx`), drawn
only while something is off: a head ("Only Vibrance" while that step
stands, else "N hidden"), one chip per thing off (`hiddenChips`: a fold of
several sliders whose every set one is off is ONE chip named as the fold;
a one-block fold is named by its title), each a tap that unparks it; ↩
while the last Show only / Invert stands (`stepStands`); ⇄ Invert (a step
too); Show all (clears the steps). **Where**: the viewport's bottom-left
corner, under the facts (`DevelopViewport`'s `parked` slot) — except on a
phone's immersive Develop, where that corner lies under the band and the
shell's bar: there it rides in the floating verbs' container, above them
(`verbsPlace === 'float'`). The pill stops its own `pointerdown` so it never
starts the stage's drag, swipe or hold. Driven headless at 1440 and 390 px.
