# Frontend — layout, styling, MapLibre, fonts

Read before touching UI, layout, the design tokens, or any MapLibre pane.

## "Studio Papier" is the design system, expressed as Tailwind v4 tokens (2026-08-20)

**Decision.** `src/index.css` declares the palette and typography in an `@theme` block — warm paper surfaces (never pure white), ink text, **one** desaturated vermilion accent (`--color-accent: #d9442a`), a near-black `--color-frame` behind video, plus `Space Grotesk` (sans), `Instrument Serif` (serif) and `JetBrains Mono` (numerals), paper radii/shadows and an `--ease-paper` curve. Everything else is Tailwind utilities in the components. **Why**: one accent and one surface family is what makes the suite read as a single studio rather than nine tools. **How to apply**: use the tokens; do not introduce a second accent colour or a raw hex in a component. Numeric readouts use the mono face.

## MapLibre's own CSS can collapse its container (2026-08-20)

**Trap.** MapLibre adds `.maplibregl-map` to its container, and that stylesheet — loaded *after* Tailwind — sets `position: relative`, overriding an `absolute inset-0` container and dropping it to `height: 0`. The symptom is a black map with the overlays still visible. **Remedy**: give the map container a real height as a flex child (`flex-1 min-h-0`), never rely on absolute positioning, and call `map.resize()` once the style loads as insurance against a 0-size measurement during the async (dynamic-import) mount.

## MapLibre is dynamically imported, JS *and* CSS (2026-08-20)

**Decision.** `use-flight-map.ts` and `use-composer-map.ts` import MapLibre lazily. **Why**: it is a heavy dependency and only two tools use it; static import would put it in the main bundle for everyone. **How to apply**: keep the import inside the hook, and keep the "map failed to load" state — the caller shows a fallback instead of a broken pane. The live-position marker uses inline styles so it never depends on the CSS scanner picking up dynamically-built class names.

## Canvas text needs fonts explicitly loaded (2026-08-20)

**Trap.** `fillText`/`measureText` only render and measure correctly with faces the document has actually loaded; the brand fonts arrive asynchronously, so an overlay drawn too early measures against a fallback and exports mis-sized text. **Remedy**: `overlay/fonts.ts` calls `document.fonts.load(...)` for each used face and awaits `document.fonts.ready` before the first measured draw and before export. System fonts (Arial/Georgia/Courier) need no loading. Any new canvas text path must go through the same helper.

## The file picker must listen to `cancel`, not guess (2026-08-20)

**Trap.** The old "did the user cancel?" heuristic (focus + timeout) raced the `change` event: when the page was busy — a video playing in LUT Studio — the timeout fired first and a real selection was silently discarded. **Remedy**: `shared/sources/file-sources.ts` uses the native `cancel` event (Chrome 113+, Firefox, Safari 16.4+), so a successful pick always resolves through `change` no matter how busy the page is. The transient `<input>` is attached to the document but kept out of layout so events fire reliably across browsers.

## Tools own full height; only the inner list scrolls (2026-08-20)

**Decision.** The shell gives each tool a full-height frame and the tool's own gallery scrolls inside it (`349ea08`). **Why**: a page-level scroll fought the stage/preview layouts. **How to apply**: a new tool that needs a scrolling list scrolls it internally rather than growing the page.
