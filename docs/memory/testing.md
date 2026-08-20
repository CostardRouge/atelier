# Testing

Read before writing tests, or before deciding where a piece of new logic should live.

## Vitest in a plain node environment — no jsdom (2026-08-20)

**Decision.** `vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/*.test.ts']`. There is no React plugin and no DOM emulation. **Why**: the suite tests the *pure* layer only; the React/canvas/WebGL glue is verified in the browser instead. **How to apply**: a `.test.tsx` or a test that needs `document` will not run under this config — that is a signal the logic under test is in the wrong module, not that the config needs changing. Extract the pure half (see `architecture.md`).

## Specs sit beside their source; `tests/` holds only fixtures (2026-08-20)

**Fact.** Every spec lives next to the module it covers (`src/**/<name>.test.ts`). The root `tests/` directory contains a single shared fixture, `tests/fixtures/sample.srt`, referenced by the telemetry and overlay specs through a `new URL(..., import.meta.url)` path. **How to apply**: do not read the near-empty `tests/` directory as "this project has no tests" — there are ~22 spec files under `src/`. New shared sample data goes in `tests/fixtures/`; new specs go beside their module.

## What is worth testing here (2026-08-20)

**Decision.** The tested surface is parsing and maths: SRT parsing, cue lookup, file pairing, reconstructed motion, EXIF parsing and formatting, `.cube` parsing, asset grouping, capability matching, export planning, verdict filtering, flight-path extraction, scope maths, compose layout, the readout model, overlay drawing and the export pipeline's plumbing. **Why**: these are the parts where a silent wrong number or a dropped file is invisible in the UI until much later. **How to apply**: new pure logic ships with its spec in the same commit. Anti-regression tests are used deliberately — the double-bracket telemetry field (`[rel_alt: … abs_alt: …]`) has one because the naive "one bracket = one field" reading looked right and was wrong.

## Test fixtures can be hand-built binaries (2026-08-20)

**Fact.** The EXIF parser is tested against a hand-built TIFF fixture constructed in the spec, alongside the GPS DMS→decimal conversion. **How to apply**: a binary parser does not need a real camera file to be tested — build the minimal structure in the test.
