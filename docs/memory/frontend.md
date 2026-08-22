# Frontend — layout, styling, MapLibre, fonts

Read before touching UI, layout, the design tokens, or any MapLibre pane.

## "Studio Papier" is the design system, expressed as Tailwind v4 tokens (2026-08-20)

**Decision.** `src/index.css` declares the palette and typography in an `@theme` block — warm paper surfaces (never pure white), ink text, **one** desaturated vermilion accent (`--color-accent: #d9442a`), a near-black `--color-frame` behind video, plus `Space Grotesk` (sans), `Instrument Serif` (serif) and `JetBrains Mono` (numerals), paper radii/shadows and an `--ease-paper` curve. Everything else is Tailwind utilities in the components. **Why**: one accent and one surface family is what makes the suite read as a single studio rather than nine tools. **How to apply**: use the tokens; do not introduce a second accent colour or a raw hex in a component. Numeric readouts use the mono face.

## A control row wraps; the shell clips — nothing scrolls the page sideways (2026-08-22)

**Trap, measured.** The studio's transport was one flex row of `flex-none` chips (play, clock, trim rail, duration, loop, shutter, preview speed, A/B). Each feature added one more, and on a 390 px phone the last one landed at x=437: the whole **document** gained a horizontal scrollbar and the interface drifted into the margin. Nothing was clipped, so nothing looked broken — it just scrolled sideways.

**The shape to keep.** The row is **two groups** inside a `flex-wrap` container: the *rail* (play, timecode, trim, duration) with `grow shrink basis-[15rem] min-w-0`, and the *tools*, itself `flex-wrap max-w-full`. Flex breaks lines before it shrinks, so the tools drop to a line of their own instead of pushing the last chip off the edge — and if even they cannot share one line, they stack. **How to apply**: a new transport control goes in the tools group and costs nothing; a new *row* of controls anywhere follows the same two-group shape.

**The net, and where it actually works.** The tool shell (`src/app/App.tsx`) clips on desktop but switched to `overflow-visible` under 820 px, which is what let the overflow reach the document. It is now `overflow-x-clip` + `overflow-y-visible` there: sideways it clips, vertically the page still scrolls normally (verified: a 2 000 px child no longer moves `window.scrollX`, a 2 000 px-tall one still scrolls). `clip`, not `hidden` — it establishes no scroll container, so sticky positioning inside the page keeps working, and `position: fixed` modals still cover the viewport (verified at 390 and 1400). **Do not** put this on `html`: Chromium computes it there but does not propagate it to the viewport, so the page scrolls anyway — measured, and the reason the rule sits on the shell.

## MapLibre's own CSS can collapse its container (2026-08-20)

**Trap.** MapLibre adds `.maplibregl-map` to its container, and that stylesheet — loaded *after* Tailwind — sets `position: relative`, overriding an `absolute inset-0` container and dropping it to `height: 0`. The symptom is a black map with the overlays still visible. **Remedy**: give the map container a real height as a flex child (`flex-1 min-h-0`), never rely on absolute positioning, and call `map.resize()` once the style loads as insurance against a 0-size measurement during the async (dynamic-import) mount.

## MapLibre is dynamically imported, JS *and* CSS (2026-08-20)

**Decision.** `use-flight-map.ts` and `use-composer-map.ts` import MapLibre lazily. **Why**: it is a heavy dependency and only two tools use it; static import would put it in the main bundle for everyone. **How to apply**: keep the import inside the hook, and keep the "map failed to load" state — the caller shows a fallback instead of a broken pane. The live-position marker uses inline styles so it never depends on the CSS scanner picking up dynamically-built class names.

## Canvas text needs fonts explicitly loaded (2026-08-20)

**Trap.** `fillText`/`measureText` only render and measure correctly with faces the document has actually loaded; the brand fonts arrive asynchronously, so an overlay drawn too early measures against a fallback and exports mis-sized text. **Remedy**: `overlay/fonts.ts` calls `document.fonts.load(...)` for each used face and awaits `document.fonts.ready` before the first measured draw and before export. System fonts (Arial/Georgia/Courier) need no loading. Any new canvas text path must go through the same helper.

## The file picker must listen to `cancel`, not guess (2026-08-20)

**Trap.** The old "did the user cancel?" heuristic (focus + timeout) raced the `change` event: when the page was busy — a video playing in LUT Studio — the timeout fired first and a real selection was silently discarded. **Remedy**: `shared/sources/file-sources.ts` uses the native `cancel` event (Chrome 113+, Firefox, Safari 16.4+), so a successful pick always resolves through `change` no matter how busy the page is. The transient `<input>` is attached to the document but kept out of layout so events fire reliably across browsers.

## Keyboard shortcuts live in the shared hook, and yield to the focused element (2026-08-21)

**Decision.** Space plays/pauses, and the binding sits in `shared/media/use-video-transport.ts` (opt out with `spaceToggles: false`), so Studio, Grade, Compare, Composer and the legacy Overlay all get it from the one transport instead of five copies. It listens on `window`, not on the stage: in most tools the element that actually plays is a 1px off-screen `<video>` feeding a canvas, so there is nothing meaningful to focus. **Why the guard matters**: space is also the browser's activation key for buttons and a character in every field, so `transport-keys.ts` (pure, tested) decides whether the focused element has the stronger claim — fields, contenteditable, `BUTTON`/`SUMMARY`/`VIDEO`/`AUDIO`, and the ARIA widget roles — and when it does the handler returns *without* `preventDefault`, or the play button would stop working the moment it has focus. **How to apply**: a new global key goes through the same predicate, and any new one must also skip `e.repeat` (a held key would toggle forever) and modified presses. Tools whose `<video controls>` is the visible player (Telemetry, Flight Map) deliberately keep the browser's native space handling — Telemetry shows several cards at once, so a global key would have no obvious target.

**Trap.** The listener is mounted once (deps `[spaceToggles]`) and calls `togglePlay` through a ref refreshed on every render. Re-wiring it on `resetKey` like the media listeners looked equivalent and is not: Compare's `togglePlay` closes over `aIsVideo`/`bIsVideo` state, and a stale closure would toggle the wrong pair after a swap.

## Library thumbnails "stand up" for portrait media; the kind chip moved to the frame (2026-08-22)

**Decision.** `AssetSidebar.tsx`'s `AssetRow` thumbnail is a fixed 56px-tall box whose **width** now follows the asset's real aspect ratio instead of a hardcoded 80px: landscape/square (or not-yet-measured) assets keep the original 80×56 `object-cover` box untouched, but a portrait asset (`meta.width < meta.height`) narrows the box (`thumbWidth()`, clamped to a 32px floor) and switches the `<img>` to `object-contain`, so it visibly "stands up" (width < height) inside its own unchanged row height — no cropping, letterboxed by the existing `bg-frame` background where the computed width doesn't exactly match the true ratio. **Why**: the maintainer had to click every asset to find which one was portrait — a wall of identical 80×56 landscape-cropped boxes gave no visual signal. **How to apply**: don't grow row height for portrait — the whole point is the freed *width* goes to the name/facts column; a new corner scrim must avoid the existing corners (see below) and stay legible at the 32px floor.

The kind chip (`video+srt`, `video`, `photo`, …) moved off the text row and onto the thumbnail's **bottom-right** corner as a 3-letter, colour-coded scrim (`kindShort()`/`kindScrimClass()`, colours reused from `chipClass()`) — this resolves the "32px facts column" trap once documented here: with the chip and its `gap-2.5` gone from the text row, the name/facts column gained roughly 60–90px on a typical 288px sidebar, enough for a filename plus the resolution to actually render instead of eliding to nothing. Corners in use, clockwise from top-left: cadence tag (`top-left`, conditional), *free* (`top-right`), kind (`bottom-right`, always on), fps (`bottom-left`, conditional). On an extreme-portrait clip at the 32px floor with both cadence and fps present, badges can visually crowd/overlap — accepted, since `overflow-hidden` clips gracefully and the full kind/cadence text is still in the row's `title` tooltip. **Verified** by screenshotting the compiled Tailwind output (`dist/assets/*.css`) against a static harness of landscape/portrait/square rows in headless Chromium — no real decoded video was needed since the layout is a pure function of `meta.width`/`meta.height`.

## Tools own full height; only the inner list scrolls (2026-08-20)

**Decision.** The shell gives each tool a full-height frame and the tool's own gallery scrolls inside it (`349ea08`). **Why**: a page-level scroll fought the stage/preview layouts. **How to apply**: a new tool that needs a scrolling list scrolls it internally rather than growing the page.
