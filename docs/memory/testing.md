# Testing

Read before writing tests, or before deciding where a piece of new logic should live.

## Vitest in a plain node environment — no jsdom (2026-08-20)

**Decision.** `vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/*.test.ts']`. There is no React plugin and no DOM emulation. **Why**: the suite tests the *pure* layer only; the React/canvas/WebGL glue is verified in the browser instead. **How to apply**: a `.test.tsx` or a test that needs `document` will not run under this config — that is a signal the logic under test is in the wrong module, not that the config needs changing. Extract the pure half (see `architecture.md`).

## Specs sit beside their source; `tests/` holds only fixtures (2026-08-20)

**Fact.** Every spec lives next to the module it covers (`src/**/<name>.test.ts`). The root `tests/` directory contains a single shared fixture, `tests/fixtures/sample.srt`, referenced by the telemetry and overlay specs through a `new URL(..., import.meta.url)` path. **How to apply**: do not read the near-empty `tests/` directory as "this project has no tests" — there are ~22 spec files under `src/`. New shared sample data goes in `tests/fixtures/`; new specs go beside their module.

## What is worth testing here (2026-08-20)

**Decision.** The tested surface is parsing and maths: SRT parsing, cue lookup, file pairing, reconstructed motion, EXIF parsing and formatting, `.cube` parsing, asset grouping, capability matching, export planning, verdict filtering, flight-path extraction, scope maths, compose layout, the readout model, overlay drawing and the export pipeline's plumbing. **Why**: these are the parts where a silent wrong number or a dropped file is invisible in the UI until much later. **How to apply**: new pure logic ships with its spec in the same commit. Anti-regression tests are used deliberately — the double-bracket telemetry field (`[rel_alt: … abs_alt: …]`) has one because the naive "one bracket = one field" reading looked right and was wrong.

## A screen over a remote source is checked against a stub, in the scratchpad (2026-09-06)

**Recipe that works in this container**, so it is not re-derived: `npm run dev -- --host 127.0.0.1 --port 5173` (base is `/atelier/`), `playwright-core` installed in the SCRATCHPAD (never the repo), launched with `executablePath: /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` — the full `chrome` binary refuses Playwright's old headless mode and exits. Seed a connection with `page.addInitScript` writing `atelier.sources.winnow.v1` (capabilities included, `media.timeline: true` for the timeline screens), stub the instance with `page.route('https://winnow.example/**')` answering JSON **with** `access-control-allow-origin: http://127.0.0.1:5173` and `access-control-allow-credentials: true` (the client sends `credentials: 'include'`, so a stub without them is a CORS failure that looks like "unreachable"), and assert on roles and visible text. `Failed to load resource` for Google Fonts is this container's network, not the app.

## Test fixtures can be hand-built binaries (2026-08-20)

**Fact.** The EXIF parser is tested against a hand-built TIFF fixture constructed in the spec, alongside the GPS DMS→decimal conversion. **How to apply**: a binary parser does not need a real camera file to be tested — build the minimal structure in the test.
