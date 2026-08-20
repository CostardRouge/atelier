# Architecture

Read before touching the shell (`src/app/`), the tool registry, the shared asset library, or when adding/removing a tool.

## One registry drives the whole suite (2026-08-20)

**Decision.** `src/app/tools.tsx` exports `TOOLS`, and both the masthead nav and the hash router derive from it. **Why**: the suite grew from two tools to nine; anything duplicated per tool (a nav entry, a route, a sidebar flag) drifts. **How to apply**: adding a tool is one `Tool` entry (`id`, `path`, `label`, `subtitle`, `blurb`, `Component`, optional `accepts`) plus its component under `src/tools/<tool>/`. Never add a route or a nav item by hand elsewhere.

## `shared/` never imports `tools/` (2026-08-20)

**Decision.** Generic building blocks (`src/shared/*`) know nothing about any specific tool; tools are self-contained and may import `shared/`, never each other's internals. **Why**: it is what keeps a tool deletable and the core reusable outside the browser. **How to apply**: if a tool needs something generic, move the generic half into `shared/` (that is how `webcodecs-export.ts` and `frame-grader.ts` came to be) rather than importing across tools.

## Pure logic lives in DOM-free modules (2026-08-20)

**Decision.** Parsing, geometry, planning and maths sit in dependency-free, DOM-free modules (`srt-parser.ts`, `motion.ts`, `find-cue.ts`, `flight-path.ts`, `compose-layout.ts`, `compare.ts`, `exif-parser.ts`, `cube-parser.ts`, …); only the thin React/canvas glue touches the DOM. **Why**: it makes the logic unit-testable in a plain node environment and reusable as-is by a future native shell. **How to apply**: new logic goes in its own module with a `.test.ts` beside it, not inside a component. See `testing.md`.

## One asset library, capability-matched per tool (2026-08-20)

**Decision.** `src/shared/library/` holds a single app-wide pool of `File` handles. `buildAssets` groups raw files into logical *assets* keyed by the lowercased base name (so `DJI_0001.MP4` + `DJI_0001.SRT` is one `video+telemetry` asset, `IMG_8801.RAF` + `IMG_8801.JPG` one `photo` asset), and each tool declares the `AssetKind`s it `accepts`; `capabilities.ts` projects the pool down to those. **Why**: import a folder once and switch tools freely. **How to apply**: the one non-obvious matching rule is that a `video+telemetry` asset satisfies a tool asking only for `video` — keep it when touching `capabilities.ts`. Files the classifier does not recognise (`.LRF`, `.THM`, dotfiles) are ignored, and the first file to claim a slot wins so grouping stays deterministic.

## Only `File` handles are held; nothing is read eagerly (2026-08-20)

**Decision.** The library layer stores handles, never bytes; covers/metadata are built lazily per row (as it scrolls into view) and thumbnails are revoked on remove/clear. **Why**: a `File` is a lazy reference to disk, so listing dozens of multi-GB videos is instant — reading them to list them would not scale. **How to apply**: never read a file just to display a list. Object URLs must be revoked when the source changes or the component unmounts.

## Almost nothing is persisted (rev. 2026-08-21)

**Decision.** Since the Scopes and Cull tools were retired (phase 0 of the studio merge, PR #29), the only stored state is the sidebar collapse flag in `localStorage`; the old `atelier:verdicts:v1` key is actively cleaned up on load in `AssetLibraryContext`. **Why**: Cull was the sole consumer of triage verdicts. **How to apply**: the unified studio's project persistence (phase 2) starts from a blank slate — IndexedDB for project documents, directory handles and thumbnails; `localStorage` stays for UI preferences only. See `studio.md`.

## The overlay engine is shared, not a tool internal (2026-08-21)

**Decision.** Everything that defines, draws, edits and exports overlay elements — `overlay-types`, `field-format`, `draw-overlays`, `guides`, `draw-guides`, `fonts`, `use-overlay-stage`, `export-overlay(-seek)`, and the `ElementList`/`ElementPanel`/`GuidesControl` editing components — lives in `src/shared/overlay/`. `tools/overlay/` keeps only the page (`OverlayStudio.tsx`). **Why**: the unified studio (`tools/studio/`) builds on the same engine, and `shared/` never imports `tools/`, so the engine had to move rather than be reached tool-to-tool. **How to apply**: overlay capabilities (new element kinds, title styles, glow) are engine work under `shared/overlay/`, picked up by both pages for as long as the overlay page survives the transition; page-specific layout stays in each tool.

## Hash routing (2026-08-20)

**Decision.** Navigation is hash-based (`#/telemetry`, `#/lut`) through a minimal `useSyncExternalStore` router. **Why**: the site is served as static files from GitHub Pages, where a history-API path would 404 on deep-link/refresh. **How to apply**: do not introduce a history-API router without solving the static-hosting fallback first.

## A tool crash must not blank the app (2026-08-20)

**Decision.** `ErrorBoundary` wraps the active tool and resets on route change. **Why**: one tool's exception used to take the whole suite down. **How to apply**: errors are logged to the console only — nothing is reported anywhere, by design (see `local-first.md`).
