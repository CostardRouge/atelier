# A slide's length — who decides it, and the plan to make it usable

2026-10-13, from the maintainer's report: *«le système de longueur des slides … incompréhensible … l'opener doit pouvoir négocier son espace»* — the Virée opener (above all with a ferry, whose boarding and landing take time) needs more room than the slide gives it, the controls are a small slider that jumps to one second, play sometimes does not advance, and dragging sometimes does nothing.

Lab (today's controls reproduced with their faults, and three faces on one live Virée with its ferry): <https://claude.ai/artifact/VfSELaC9L6YLJK35e1u27Y>

§1–§2 are fact, traced to lines and measured headless in the real editor (Chromium, a seeded trip, a Melbourne → Devonport → Hobart Virée, the Spirit of Tasmania as the trip's crossing boat). §3 onwards is a proposal awaiting his pick.

## 1. What exists

Rule D of 2026-10-07 (`docs/memory/roadtrip.md`, «a slide's length has an OWNER»; `shared/roadtrip/slide-timing.ts`):

- A slide is **Auto** (`PostBadge.hookAuto`, `PostSlide.auto`) — its opener plus `AUTO_TAIL_SECONDS` (0.5) — or **set by hand** (`hookSeconds` / `seconds`).
- `deckSlides` resolves the length once (`slideTiming`); the band (`DeckStrip`), the transport (`use-deck-transport.ts`), the stage and every export read it.
- **Fit** is an option of the OPENER (`fit` in `DriveOptions` / `MapOptions` / `ScrubOptions`), drawn by each opener's panel as `FitRow`; `fitRender` scales the opener's closure to the slide under a floor (`FIT_FLOOR_SECONDS` 0.35 on the opener's shortest beat).
- The Content tab's *Slide* section draws `SlideDelivery`: *Goes out as* `Auto · Image · Video` (the medium), then *On screen*: a `RangeField` 1–60 s step 0.5, the readout, an owner pill (`Auto · Virée` / `Set by you`), and, once set, an *Auto* button — or, when the set length cuts the opener, a red sentence with *Use N s* and *Fit Virée to N s*.
- The band's OPEN cell wears a grip at each end (10 px beside a mouse, 16 on a phone), hidden while the piece plays. A drag writes the length and `auto: false`.

## 2. The holes

| | Hole | Where | Evidence |
|---|---|---|---|
| H1 | Two different *Auto*s in one section: the file's medium (`Auto · Image · Video`) and the length (`Auto · Virée`, the *Auto* button) | `SlideDelivery.tsx` | read |
| H2 | A 1–60 s slider in the space a label column, a readout and a pill leave: **53 px in Auto, 66 px once set, at 1280 px — 1.1 s per pixel**. A click is a jump; near its left end it is **1 s** | `SlideDelivery.tsx`, `RangeField` | measured: a click at 5 % of the track wrote `hookSeconds: 1` |
| H3 | The row INSERTS controls: the pill changes its word and an *Auto* button appears once set, so the slider moves (53 → 66 px) under the pointer between two clicks — the second click of a measured pair missed the slider entirely. Breaks the suite's rule «a toolbar never inserts a control» (`frontend.md`) | `SlideDelivery.tsx` | measured |
| H4 | Any touch on the length (slider, grip, a clip's cut) silently leaves Auto. From then on the opener no longer negotiates: add the ferry, a stop or the recap counter afterwards and the slide does not grow — the new end is cut | `ContentTab.tsx:308`, `PostEditor.tsx` grip `onChange` | read |
| H5 | In Auto the only adjustable thing is the TOTAL, so wanting "a bit more hold" or "Virée a little faster" means leaving Auto (H4) | `slide-timing.ts` | read |
| H6 | Fit lives in the opener's panel, far from the length; once on, the deck reports the opener's FITTED length (`openerSeconds` comes from the fitted render), so the Slide section says «Virée takes 5.0 s» of a 9.3 s drive, and the *Auto* button's tooltip promises the fitted length plus 0.5 | `deck.ts` (`resolveHook(...).seconds`), `ContentTab.tsx:135` | read |
| H7 | A set length may fall under the opener with no floor tied to it. At **1 s** the transport loops the slide's first second: measured, the clock runs `0.20 → 0.86 → 0.06 → …` and the car never leaves Melbourne — the «play does nothing». The badge's exit also lands on that 1 s | `use-deck-transport.ts`, `slide-timing.ts` | measured |
| H8 | The grips are 10 px, only on the open cell, only while paused; a drag that misses them scrubs the band. The cell does not show what is INSIDE it (the opener's span, the hold), only a hatch once cut | `DeckStrip.tsx` | read |
| H9 | **Fixed in this branch.** The editor memoised `deckSlides` on `[trip, post]` while its openers read the coastline and the town index synchronously: a piece opened before the coastline arrived kept an Auto length timed with NO ferry crossing — measured 6.4 s for a 9.3 s Virée, the crossing cut under Auto | `PostEditor.tsx` | measured before/after |
| H10 | The badge's exit follows any length, including a 1 s one (enter and leave inside a second) | `slide-render.ts`, `hookLife` | read |

H9 is a plain bug and is fixed (commit `Trips: time an Auto slide with the coastline once it lands`). Everything else is the shape of the controls and of the model, and is what the faces below answer.

## 3. The idea all three faces share

**A slide with an opener is made of PARTS: the opener at some pace, then a hold.** The length is their sum, read — never a number typed apart from what is on the slide that can fall out of step with it. The opener «negotiates» by being the part that sets the room: a ferry added to Virée lengthens the slide by itself, whatever pace and hold the author chose.

Three rules hold in every face:

1. **A gesture never changes who owns the length.** The owner is a word the author picks (*Virée decides* · *Fixed*); a grip, a stepper or a slider writes inside the owner chosen. (Closes H4.)
2. **Nothing is CUT unless the author said "cut".** Shortening under the opener speeds it up, down to the floor, where the control stops and says why. Cut is a deliberate answer to one question, on a fixed length only. (Closes H7, and makes a 1 s slide over a 9 s opener impossible by accident.)
3. **Controls never move under the pointer.** Every verb is always drawn, greyed with a reason when it does nothing; the numbers are set with the suite's ONE slider of `docs/slider-touch.md` (rev. 2026-10-13, below) — never a 1–60 s track sharing its line. (Closes H2, H3.)

**Rev. 2026-10-13 — the steppers yield to the suite's slider.** The lab drew ± steppers with a typed field because today's `RangeField` cannot be trusted on a line it shares. A parallel brief, `docs/slider-touch.md` (branch `claude/wizardly-hamilton-76dk6o`), fixes the slider itself for all 135 of them: the track alone on its line across the panel, a 44 px grab under a finger, a tap that places and a drag that stays relative, a vertical gesture left to the scroll, a typed value, ONE component behind a lint rule. With it a stepper would be a second numeric control for one section only. So Hold, Pace and Seconds are three of that component's rows (Hold 0–10 s by 0.1, Pace from the floor to 1×, Seconds 1–60 s with the typed value doing the precise work); the owner `Segmented` and the *If Virée is longer* question stay as drawn. The band's grip is a gesture of its own, not a slider, and keeps §4's two zones; it takes the same coarse-pointer sizing rule (R2).

And the medium stops being a third *Auto*: it becomes a sentence — «Video, because Virée moves» — with one verb to deliver a still instead (the `settled` case). (Closes H1.)

## 4. The faces

**A · Two owners.** Today's model, said in words. *Follows Virée*: one stepper, *Hold after*; the grip on the band drags the hold and stops at Virée's end. *Fixed*: a seconds stepper and, when shorter than Virée, one question — *Speed it up* (default, floored) or *Cut it*. Cheapest (no new pace); but making a slide shorter than its opener means leaving *Follows* first, and Virée's pace is unreachable while it follows.

**B · Negotiated (recommended).** The parts made editable. *Virée decides*: **Pace** (`½× · ¾× · 1×` plus whatever the band set) and **Hold after**, the sum read above them («9.8 s = Virée 9.3 s + hold 0.5 s»). On the band the open cell DRAWS its parts — Virée's span (striped where it sails), the hold, a dashed line at Virée's natural end — and ONE grip has two zones: past the dashed line it drags the hold, inside it Virée's pace, and it stops on a black tick at the floor with a bubble saying so; a magnet holds the natural end. *Fixed* stays for the slide that must last exactly N seconds (a reel cut to music), with A's question. Fit moves from the opener's panel to the slide: it was always the slide's decision.

**C · Lanes.** B's model with the parts on lanes in the inspector (Virée, badge, picture, slide), handles for Virée's end and the slide's end. Shows the badge's exit as a lane end; costs a second timeline beside the band, two places to drag the same thing, and is dense at 22 rem and on a phone.

| Hole | Today | A | B | C |
|---|---|---|---|---|
| H1 two Autos | open | closed | closed | closed |
| H2 the 1 s jump | open | closed | closed | closed |
| H3 controls moving | open | closed | closed | closed |
| H4 silent owner change | open | closed | closed | closed |
| H5 only the total | open | partly | closed | closed |
| H6 Fit far, length misreported | open | closed | closed | closed |
| H7 no floor, the 1 s loop | open | closed | closed | closed |
| H8 grips, the cell's parts | open | partly | closed | partly |
| H9 Auto without the coastline | fixed | fixed | fixed | fixed |
| H10 the badge's 1 s life | open | partly | closed | closed |

## 5. The model B asks for

```ts
// shared/roadtrip/slide-length.ts (pure) — BUILT, commit 2
type SlideLength =
  | { owner: 'opener'; pace: number; hold: number } // pace in [floor, 1], hold ≥ 0
  | { owner: 'fixed'; over: 'fit' | 'cut' };          // the seconds are the slide's own field

interface ResolvedLength {
  seconds: number;        // what the slide lasts
  natural: number;        // what the opener needs at its own pace, NEVER the sped-up one (H6)
  span: number;           // what it occupies on the slide (natural × scale)
  scale: number;          // the pace it runs at; 1 when not sped up
  hold: number;           // the picture after it
  cut: number;            // seconds of the (sped-up) opener the slide's end cuts off
  floored: boolean;       // the pace asked for was faster than the floor
  floor: number;          // the fastest pace this opener may run at
}
```

- **A fixed length's seconds are NOT in the union** (rev. at build): they stay the slide's own `hookSeconds` / `seconds`, the very field the band's grips, a clip's cut and its speed already write. A second copy would be a second truth to keep in step — the class of bug this brief is about.
- **Fixed is fixed.** Under *Speed it up* an opener longer than the slide runs at `seconds / natural`; where that is faster than the floor it runs AT the floor and the slide's end cuts the rest — said as a cut, the length never growing behind the author's back. Under *The opener decides* nothing is cut but by a bound (a clip's end, the 60 s ceiling).
- A slide with no opener lasts its stored seconds whoever owns it (rule D's Auto did the same); a CLIP's length stays its cut (`clipSlice`, unchanged).
- The floor is the opener's own (`shortestBeat` → `FIT_FLOOR_SECONDS`, `paceFloor`), bounded by `MIN_PACE` (a tenth) for an opener that reports no beat; the prepared render will report it (`HookRender.shortestBeat`) so the deck floors a pace without knowing the opener.
- **Migration (v33 — v32 went to the trip's road), every stored slide keeping its length to the frame** (`lengthFromLegacy`, its spec runs every case against rule D's `slideTiming`): `auto: true` → `{ opener, pace: 1, hold: 0.5 }`; set + the opener's `fit: true` → `{ fixed, over: 'fit' }`; set otherwise → `{ fixed, over: 'cut' }`. One case PLAYS differently at the same length: a fit the floor refused used to leave the opener at its own pace and cut it, and now runs it at the floor and cuts later. The opener's `fit` option is read once by the migration and then ignored; `FitRow` leaves the openers' panels.
- `negotiate(total, natural, beat, magnet)` reads the band's one number back as a pace and a hold: past the natural end the hold, inside it the pace down to the floor (`stopped`), a magnet on the natural end; it round-trips through `resolveLength`.
- The scale is applied ONCE, where the opener is resolved (`resolveHook`), so the stage, the deck, every export and the Studio bridge play the same opener — `fitRender` survives as the one way a render is scaled.

## 6. The plan, in commits

Each is one commit, verified by typecheck, lint, the tests and a headless drive of the editor; the order lets him stop anywhere.

1. ~~**The deck timed with the coastline**~~ — built (H9).
*Order against the slider work* (rev. 2026-10-14, his rule): the suite's slider is built and merged in ITS OWN session, with its own direction and conventions — never in this branch, and not as `docs/slider-touch.md`'s first draft described it. Commits 4 onwards WAIT for it: once it is on `main`, this branch is rebased onto it and the Slide section and the band are built with that component and those conventions as they landed. This branch builds no shared control.

2. ~~**`slide-length.ts`, pure, with its spec**~~ — built: the union, `resolveLength`, `negotiate`, `paceFloor`, `lengthFromLegacy`, `readSlideLength`. No caller yet.
3. ~~**v33 and the deck**~~ — built (the agent's verb is `trips.slideLength`, not `trips.pieceSettings`; the interim row and the band were rewired so no gesture changes the owner) — `PostBadge.length` / `PostSlide.length`, the migration, `deckSlides` resolving through it, `DeckSlide.natural` / `.scale` / `.hold` / `.cut`, openers handed their scale instead of reading `fit`, `HookRender.shortestBeat`. The exports, the Studio bridge, `run-edits.ts`, `export-plan.ts` and the agent commands (`trips.piece` reports the parts; `trips.pieceSettings` takes `pace`, `hold`, `seconds`) follow in the same commit, because the field they read changes.
4. ~~**The *Slide* section**~~ — built (2026-10-14) on the slider session's `SliderRow` as it landed: no stepper, the typed value is the bar's own (Enter or a hold); the owner switch keeps the length (`switchOwner`); the medium's one verb is `mediumVerb`. As planned: the sum line, the owner `Segmented`, Pace and Hold (or Seconds + *If Virée is longer*), steppers with a typed field, the medium as a sentence and one verb; `SlideDelivery`'s slider, pill and inserted buttons go, `FitRow` leaves the openers' panels, the Counter's own cut warning reads the new resolution.
5. ~~**The band**~~ — built (2026-10-14): `gripDraft` reads the grip through the slide's owner (hold past the natural end, pace inside it, a 6 px magnet on the natural end, stopped at the FLOOR or at the band's SHORTEST length, said in the cell's label); the open cell draws a white rail — bright under the opener, faint under the hold —, the natural end dashed where sped up, a floor tick while pacing; grips 14 / 20 px; a press on a grip pauses a playing piece. Not built: the *sailing stripe* — the deck knows the opener's length and shortest beat, not when its ferry sails; it needs `HookRender` to report its phases. As planned: the open cell draws its parts (opener span, sailing stripe, hold, the natural end), one grip with two zones, the stop and its bubble at the floor; grips 14 px beside a mouse and 20 on a phone; pressing a grip while playing PAUSES rather than the grip being hidden.
6. **The badge's exit** — lands on the slide's end only while the slide outlasts its entrance plus one second; under that it lands on the hold's start, so a short slide never flashes its badge (H10).
7. **Memory, README** — the rules in `roadtrip.md` (rule D rewritten, not appended), the README's Trips section.

## 7. What is his

1. ~~**A, B or C**~~ — **B, his pick (2026-10-13).**
2. ~~**The default answer when a fixed length is shorter than the opener**~~ — **Speed it up** (his «vas-y avec tes recommandations», 2026-10-13): a slide turned *Fixed* by hand starts on `over: 'fit'`; only a migrated set slide whose opener had no Fit keeps `cut`, its old behaviour.
3. ~~**Pace as three steps or a free value**~~ — **both**: `½× · ¾× · 1×` in the inspector (`PACE_STEPS`), any value between the floor and 1 from the band.
4. ~~**Whether *Fixed* should exist on a slide with an opener**~~ — **kept**, for a reel cut to a beat.
