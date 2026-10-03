# Feedback on a touch screen, measured, and six faces for Develop's verbs

**Status: he chose the recommendations the same day (2026-10-03, *«commence
l'implémentation avec les recommandations et n'oublie pas d'appliquer à peu
près la même chose sur Trips et Studio»*): E, and §5 answered by its own
recommendations. Being built, commit by commit — §6 says what is in.** The lab,
a Develop mock you press with the six faces and a timeline measuring what the
finger saw: <https://claude.ai/artifact/2Ew4j2xFPm1xa7ceRxGxa8>. §1 is fact,
read in `main` 26bf5de; §2–§4 are the proposal; §5 his answers; §6 the build. Read it before touching
`Button.tsx`, `IconButton.tsx`, `Segmented.tsx`, `DevelopActionsGroup`
(`shared/develop/DevelopSections.tsx`) or any verb that takes time.

Written from his ask: *«dans l'interface développe, il faudrait que l'on ait un
peu plus de feedback … les boutons copier-coller, paste, réglage. Sur la
tablette et sur un écran tactile, on n'a pas le feedback. Et vu que les actions
peuvent prendre du temps … un feedback de changement de couleur ou de bouton
actif. Peut-être un décalage d'un pixel, une bordure … un artefact avec
plusieurs variantes de design»*.

## 1. Why nothing answers today (fact)

1. **The press is 0.56 px.** `Button`'s only pressed state is
   `active:scale-[0.98]` (`Button.tsx:27`): on the well's 28 px glyph, 0.28 px a
   side. Tailwind v4 writes it as the `scale` property, which is NOT in the
   recipe's `transition-[…transform…]` list, so it snaps; and it lasts as long
   as the finger is down, which is exactly when the finger covers the glyph.
2. **A hover does not exist under a finger.** Tailwind v4 wraps every `hover:`
   in `@media (hover: hover)` (checked by compiling `hover:bg-…` with the
   repo's tailwindcss 4.3.0): on an iPad without a trackpad none of the washes
   that say "live" to a mouse ever appear. The suite's only other press signal
   is gone with it.
3. **The answer is written far, small, and does not change.** Copy and paste
   answer through `RollEditor`'s `setNotice` (`copied develop, look`,
   `RollEditor.tsx:907`), a 10.5 px mono clause in the status line under the
   picture — the opposite side of the stage from the well — that never clears:
   copying twice writes the same sentence, and nothing on screen moves.
4. **A render the author caused is not a task.** `startTask` covers opening a
   file, the RAW decode and the loupe (`use-develop-picture.ts:836`, `:1717`);
   a paste, a reset, an Auto or a slider re-grades with no task, and a task is
   hidden for 400 ms anyway (`SHOW_AFTER_MS`, `tasks.md`). Between the tap and
   the new picture: nothing.
5. **Why a glyph is grey lives in a tooltip.** `Nothing copied yet — ⌘C on an
   edited picture` (`RollEditor`'s `pasteTitle`) is the glyph's `title`
   (`DevelopSections.tsx:116`), which a finger never shows, and
   `disabled:pointer-events-none` swallows the tap.
6. **28 px on a tablet.** The well takes `md` (34 px) only on the compact shell
   (`size={compact ? 'md' : 'sm'}`, `PictureWorkbench.tsx:2153`): an iPad in
   landscape is `expanded` and gets 28 px, under the 44 px a finger needs. The
   size follows the WIDTH, never the pointer.

Underneath all six: **the finger hides what it presses.** A fingertip is
≈ 10 mm, about 48 CSS px on an iPad, so a 28 or 34 px glyph is covered whole
while it is pressed. A press state that ends with the lift is never seen; what
is seen is what stays after it, and what is drawn away from the finger —
above it or to its left, the hand coming from below and the right.

## 2. Four axes, six faces

Every face answers four moments of one gesture; the lab can mix them axis by
axis.

| Axis | Options |
| --- | --- |
| **Press** (one frame after the touch) | `scale 0.98` (today) · ink fill · a KEY 1 px down with an inset shadow · a vermilion ring · a ripple |
| **While it works** | nothing (today) · a hairline under the glyph · the key STAYS DOWN with the hairline · the ring turns · a spinner in the glyph |
| **Done** | the status line only (today) · ✓ (or –) in the glyph for 900 ms · ✓ plus one word beside the glyph for 1.6 s |
| **Echo on the target** | none (today) · the stage's hairline at once, a written thumbnail ticks, the copied picture wears a mark while it is held |

Every face but today's holds the press 120 ms AFTER the lift, so it survives
the finger, and keeps a greyed glyph tappable to say why it is grey.

| Face | Press | While | Done | Echo |
| --- | --- | --- | --- | --- |
| Today | scale | nothing | status line | — |
| A · Ink | ink | hairline | ✓ | — |
| B · Key | key | stays down | ✓ | — |
| C · Ring | ring | ring turns | ✓ | — |
| D · Ripple | ripple | spinner | ✓ | — |
| **E · Synthesis** | key | stays down | ✓ + word | yes, and 34 px glyphs |

What the lab measures for a paste on a RAW (900 ms simulated): today, the first
visible sign after the lift comes **never** near the finger and 900 ms pass in
silence; under E, the first sign is at 0 ms and there is no silence.

## 3. The recommendation: E, in five commits

The key that sinks a pixel is his idea and it is the right one under a finger,
because it STAYS down after the lift: the finger hid the press, the key shows
the work. Alone it does not say where a paste landed, so E adds the echo, and
puts the word to the LEFT of the glyph, the side the hand does not cover.

1. **The shared press.** A pressed state set on `pointerdown` and held 120 ms
   after the lift (pure timing, tested), carried by `Button`, `IconButton` and
   `Segmented`, so every screen gets it; `active:scale` goes.
2. **A verb's life on its button.** Down with a hairline while it runs, ✓ or –
   at the end, `aria-busy`, a second tap ignored: copy, paste, Reset, Auto,
   Apply to.
3. **The word beside the glyph.** Develop's answer moves to the left of the
   well, one line, 1.6 s; a tap on a greyed glyph says why, in the same place.
   The status line keeps the full sentence as the log.
4. **The echo.** A render the author asked for draws the stage's `TaskEdge`
   AT ONCE — the 400 ms rule stays for what nobody asked for —, a written cell
   ticks, the copied picture wears a mark while it is held.
5. **Size by pointer.** `(pointer: coarse)` → 34 px glyphs in the well on a
   tablet.

## 4. What a face must not do

- **Tint the picture.** Develop is judged on its colours: the ring (C) puts
  vermilion at the stage's edge, which is why E keeps the press grey and its
  only colour to a 2 px hairline and a ✓.
- **Move on hover.** «Nothing MOVES under the pointer» (`frontend.md`,
  2026-09-21) is about a HOVER: a target that slides away from the pointer. A
  key that sinks 1 px under a press does not escape the finger; the question is
  still his (§5.2).
- **Flash for a fast verb.** A verb under 80 ms skips the "working" state and
  goes straight to ✓, so a JPEG copy never blinks a spinner.
- **Ignore reduced motion.** Under `prefers-reduced-motion` the sweeps become a
  still bar, the ripple goes, the ring stops turning.

## 5. His questions, answered by the recommendations (2026-10-03)

1. Which face? **E**, in Develop, and about the same in Trips and the Studio.
2. Does a 1 px sink on PRESS respect «nothing moves under the pointer»?
   **Yes** — that rule is about a hover.
3. The stage's hairline at once when he asked for the render? **Yes.**
4. 34 px glyphs under a finger on a tablet? **Yes.**

## 6. What is built

- **C1 · the shared press.** `shared/ui/press.ts` (the hold, `PRESS_LOOK`,
  tested) and `press-dom.ts` (one capture listener from `main.tsx` setting
  `data-pressed` on the control under the pointer, held 120 ms after a
  finger's lift, topped up to 120 ms for a quick click, dropped at once on a
  `pointercancel`, flashed for a keyboard activation). Styled by `Button` and
  `IconButton` (every variant has a pressed ground), `Segmented`, a menu row,
  the Develop well's own verbs and the sheet's `developButtonClass` /
  `developLinkClass` — so Develop, Trips and the Studio all press the same.
  `active:scale-[0.98]` is gone from the recipe. Driven headless with a CDP
  touch on a real `Button`: `translate: 0px 1px` and the inset shade while
  down, still there 60 ms after the lift, gone by 210 ms.
