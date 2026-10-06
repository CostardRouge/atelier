# Phone layout audit — 2026-10-06

The maintainer's question after PR #234 (the "ghost zone" and Develop's contact
sheet running off the screen): *what is left to do so this never happens again
in the project?* This audit answers it for the three families of fault he
reported, across every tool. It is read-only: nothing here is built yet.

- **A — the page moves under the app**: something scrolls a locked page or a
  clipping box by code, or iOS zooms/lifts it, and leaves a band of nothing.
- **B — controls past the right edge**: a row that cannot wrap holds more
  than a phone's width.
- **C — no breathing room at the bottom (or top)**: padding outside a
  scroller, a last row flush against the bottom bar, a safe area unpaid.

## 1. What is already in place (main, after #234)

- The shell frame is `overflow-clip` (a programmatic scroll is refused) and
  `use-pinned-document.ts` returns the locked document to 0,0.
- `scrollIntoView` has **zero** call sites; `revealInScroller` (`reveal.ts`)
  replaced all eleven.
- `--app-h` is measured (`use-app-height.ts`), re-read on the first touch of
  every gesture; the full-screen phone sheets read it, never `dvh`.
- A global rule raises text fields to 16px on a phone (`index.css:543`) so
  iOS does not zoom on focus.
- `page-scroll.ts` puts a column's bottom room INSIDE its scroller.

## 2. Method

- **A headless sweep** (`sweep.mjs`, kept in the session scratchpad, not the
  repo) driving the dev server at **390×844 and 360×740, touch**, over 52
  states: Home, Sources, Develop (gallery, roll, every bottom-bar section, the
  zoom menu, the sections sheet, the contact sheet), Trips (gallery,
  overview, the day, the map, a photo piece and a carousel with every
  section), the Studio (gallery, an empty project) and the seven legacy
  tools. In each state it lists every control cut by the screen or by a box
  that does not scroll, every clipping box left scrolled, and any horizontal
  overflow of the document; a screenshot of each.
- **A code read** of `src/` for the patterns behind each family, every finding
  traced to a line; the top ones re-read by hand.

Not covered: a real iPhone (no Safari toolbar, keyboard or visual-viewport
zoom exists headless), a Studio project WITH clips (no H.264 here), Develop's
Layers/Crop/Export contents in depth.

## 3. Findings

### Measured by the sweep

- **0 clipping box left scrolled, 0 document overflow**, in all 52 states at
  both widths. The #234 defences hold on everything the sweep reached.
- **Develop fits at 360 and 390** since #234 (stage bar, band header, contact
  sheet).
- **TRIP-01 · the trip overview's header is the one surface still cut**
  (`TripOverview.tsx:1082`). At 390 the trip's name truncates to
  "Australia sw…", at 360 to "Australi…": three icon groups (undo/redo,
  Calendar/Map, Cards/Pictures) take the row. The summary line under it is
  `truncate`, and the link it ends on — "N days of silence at most", which
  JUMPS to that gap — is cut off the right edge at both widths: an action
  only reachable on a wide screen.

### From the code read (verified by reading)

| Id | Family | Where | What | Severity |
| --- | --- | --- | --- | --- |
| A-01 | A | `index.css:543` | The 16px field rule is `(max-width: 820px) and (pointer: coarse)`: a phone **in landscape** (844–932 CSS px on every iPhone since the 12) and an iPad get no floor, and ~70 fields are under 16px — iOS zooms on focus and does not zoom back: the ghost zone by another road. Fix: `(pointer: coarse)` alone. | high |
| A-02 | A | `DayPicker.tsx:538, 543` in `AssetSidebar.tsx:624` | The day picker's month popover sits inside the Library's `overflow-hidden` frame; arrow keys walk days with a plain `focus()`, which scrolls that clipping frame — the ghost band, inside the Library. Fix: `focus({ preventScroll: true })` + the frame `overflow-clip`. | medium |
| A-03 | A | `LutGalleryModal.tsx:509` | A plain `focus()` right before `revealInScroller`: the focus has already scrolled every ancestor. Fix: `preventScroll`. | medium |
| A-04 | A | 15 `focus()` calls without `preventScroll`, 3 `autoFocus` | Low one by one (their target is on screen), but each is a way back for the class. | low |
| A-05 | A | `StudioEditor.tsx:2601` (`45dvh`), `BadgeStage.tsx:1617` (`62vh`) | Viewport units inside the locked page, where a stale `dvh` is never corrected (iPad portrait). Fix: `calc(var(--app-h)*…)`. | medium |
| A-06 | A | 17 desktop dialog caps `90dvh` / `min(90dvh,…)` | Wrong on an iPad whose `dvh` is stale; three modals (`NewProjectModal`, `ProjectSettingsModal`, `TripDetailsModal`) have no other cap on a phone. Fix: `calc(var(--app-h)*0.9)`. | low |
| A-07 | A | 10 structural `overflow-hidden` panel shells (`DockedDrawer:183`, `BottomSheet:236`, `MediaLightbox:330`, `DevelopSheet:214`, `WinnowPicker:496`, …) | Each can be scrolled by a focus the day its content outgrows it (a phone on its side is ~350 px tall). Fix: `overflow-clip` where no sticky child relies on them. | low |
| B-01 | B | `StudioEditor.tsx:2249` | The clip header is one unwrappable line: switcher + name + rendition + `3840×2160 · H.264 · 29.97 fps` + the telemetry chip ≈ 435 px of `flex-none`. Not reachable by the sweep (no clips here), likely past 360. Fix: wrap, or truncate the detail. | medium |
| B-02 | B | `PageBar.tsx:92` | The trailing group of every screen's bar is `flex` with no wrap: whatever a tool puts there is one row however wide. Root of TRIP-01. | medium |
| C-01 | C | `BottomSheet.tsx:248` | With `bodyScrolls`, the safe-area spacer is OUTSIDE the scroller — paper the last row clips against. | low |
| C-02 | C | `ComposerTool.tsx:380` | A full-screen scroller with no bottom padding: the last block sits on the bottom bar. | low |
| C-03 | C | 12 full-screen phone sheets (`DevelopSheet`, `MediaLightbox`, `WinnowPicker`, `TripSettingsModal`, …) | No `safe-area-inset-top` (only 4 of 16 pay it). Likely 0 in portrait with the current status-bar style; inconsistent, and wrong in a standalone launch with a translucent bar. | low |
| G-01 | all | `eslint.config.js`, `ci.yml` | **No guard exists**: nothing in lint, tests or CI would catch a new `scrollIntoView`, a plain `focus()`, a `dvh` on a locked screen, or a control past the edge. #234 fixed instances; only a guard fixes the class. | high |

## 4. What makes it never come back — the guards

1. **Lint the patterns** (`eslint.config.js`, `no-restricted-syntax`, the
   way arbitrary sizes and paper rgba already are): `scrollIntoView`
   (locks today's zero); `.focus()` with no argument (must say
   `preventScroll`); `autoFocus`; class strings matching
   `(h|min-h|max-h)-(screen|dvh|svh|lvh)` or `\d+d?vh\]` outside the
   documented `var(--app-h,100dvh)` fallback. Cheap, immediate, catches A
   at the keyboard.
2. **A layout sweep in CI**: the scratchpad sweep turned into
   `scripts/check-layout.mjs` — every tool's screens at 360 and 390, touch;
   fail on a control cut by a non-scrolling box, a scrolled clipping box or
   a document wider than the screen. Needs `playwright` as a devDependency
   and Chromium in CI — **the same decision as TEST-01 in
   `audit-2026-10-02.md`**, still his; one job would then run the render
   gates and this one.
3. **Two shared rules in code, not per screen**: the 16px rule on
   `(pointer: coarse)` (A-01), and `PageBar`'s trailing group allowed to
   wrap (B-02) — the two places where one line fixes every screen.
4. **The memory rules** that name the class (`frontend.md`, «A locked page
   can still be SCROLLED BY CODE», and the gutter rule) — already written.

## 5. Proposed order, in commits

1. **BUILT (2026-10-06)** **Guards first** — the lint rules, with the existing offenders fixed in
   the same commit (A-02, A-03, A-04's plain focuses, the three `autoFocus`,
   A-05). Verified by `npm run lint` going red on a planted
   `scrollIntoView` and green on the tree.
2. **BUILT (2026-10-06)** **The 16px rule on every coarse pointer** (A-01) — one media query;
   checked headless with an iPad and a landscape-phone viewport.
3. **BUILT (2026-10-06)** **The page bar's trailing group, and the trip overview's header**
   (B-02, TRIP-01): the trailing group wraps; on a phone the overview's two
   view switches fold into one ⋯ (or under the title, the PageBar rule), and
   the "days of silence" link leaves the truncated line for a chip of its
   own. Swept at 360 and 390. Built with the ⋯ (his pick): the name whole
   at 360, the chip "N days silent" inside the screen, the menu switching
   both views.
4. **The Studio clip header** (B-01) — needs a WebM clip in the sweep to see.
5. **`overflow-clip` on the structural shells and the dvh caps** (A-06,
   A-07), each shell checked for a sticky child first.
6. **Bottom and top rooms** (C-01 … C-03).
7. **The CI layout sweep** — when he answers TEST-01.

## 6. His to decide

- `playwright` as a devDependency and a browser job in CI (TEST-01 again,
  now carrying the layout sweep too).
- ~~On a phone, where the trip overview's two view switches go~~ — a ⋯ menu,
  his answer (2026-10-06).
- A real-device pass: the only test of the iOS-only half (toolbar, keyboard,
  zoom) is his iPhone. The sweep cannot see it; the guards stop the causes.
