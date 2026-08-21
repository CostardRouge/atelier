# Project memory — decisions, reasons, traps

Long-term memory of this repo, read at the start of **every** agent session (imported by `CLAUDE.md`). It holds what the code and `git log` cannot tell you: the choices made and their reasons, what was tried and rejected, the traps that cost time, how the maintainer likes to work.

This file is the **always-loaded index**. The detail lives in `docs/memory/<topic>.md`, one file per area, loaded **on demand**: read the topic file(s) matching the area you are about to touch **before** acting (table at the bottom). Do not `@import` them into `CLAUDE.md` — the split exists to keep the per-session prompt small.

## How to maintain (mandatory — CLAUDE.md rule 2)

- **When**: at the end of every task, before its commit, in the same commit. Writing is the **default**; only skip if there is truly nothing a future agent could use, and say so explicitly in the final message.
- **What**: a design/product decision, a non-obvious technical choice, an explicit rejection ("the maintainer did not want X because Y"), a trap (browser, tooling, framework, hosting) and its remedy, a working preference. Not implementation detail readable in the diff, not what `git log` already says, not history ("this was fixed on…") — once a fix is committed, keep only the rule it taught.
- **Where**: the matching `docs/memory/<topic>.md`; a new file only when no topic fits (kebab-case name, add it to the table below with a "read when"). Cross-cutting rules, working style, decisions-at-a-glance and open items stay in this index.
- **How**: search first and **update** the existing entry rather than adding a near-duplicate; delete what became false. One entry = one short paragraph: *decision → why → how to apply*, dated `YYYY-MM-DD` on first write and on each revision. Say the same thing **once** — cross-reference other files by name instead of repeating.
- **Language**: **English**, dense, factual. No session narration.
- Budget: keep this index under ~200 lines and each topic file under ~150; if one outgrows that, split it.

## Working with Steeve Pommier

<!-- Add what you learn about how he validates work, how he phrases requests,
     what he wants when an audit finds problems, what annoys him. -->

- 2026-08-20 — Observed from history, not yet confirmed in conversation: work lands as focused, self-describing commits (one tool or one fix per commit, prose imperative titles, a body explaining the *why*), and most agent work reaches `main` through a pull request (`(#NN)` merge titles) rather than a direct push. Assume a PR is expected for anything non-trivial in a cloud session.
- 2026-08-20 — Documentation is kept current with the code: the README describes every tool, its trade-offs and its browser caveats, and a commit that changed the tool line-up also refreshed the README (`aade8e2`). Treat a user-visible feature as unfinished until the README says the same thing as the code.

## Direction in five lines

- **Local-first, no server, no account**: files are read in the browser and never uploaded. Every feature must hold this line; the documented exception is the Flight Map's opt-in OpenStreetMap base layer, off by default and surfaced explicitly (README, "The one network exception"). The full list of requests the app actually makes is in `local-first.md` — it is longer than that callout.
- **A suite converging into one Studio**: a thin shell (`src/app/`) plus self-contained tools (`src/tools/*`) over a generic core (`src/shared/*`), all listed in one registry (`src/app/tools.tsx`) — and, since 2026-08-20, an agreed plan to merge the tools into a single `/studio` editor (phases and decisions in `studio.md`).
- **Capture-oriented**: photo and video across devices (DJI, Apple, Sony), with DJI flight telemetry as the founding case.
- **The browser is the runtime today, not forever**: pure logic is kept DOM-free so a native shell (Tauri, bundled ffmpeg) can reuse it — `shared/sources/file-sources.ts` is meant to be the only brick that changes.
- **Visual identity is deliberate**: "Studio Papier" — ink on warm cream, one vermilion accent, monospace numerals (`src/index.css` tokens).

## Decisions at a glance (details in the topic files)

- One tool registry drives nav, routes and the asset sidebar; adding a tool is one entry plus a component — `architecture.md`.
- `shared/` never imports `tools/`; pure logic lives in DOM-free modules with unit tests beside them — `architecture.md`, `testing.md`.
- One global asset library keyed by base name feeds every tool through capability matching — `architecture.md`.
- Video export is one shared WebCodecs pipeline (`exportProcessedVideo`) parameterised by a per-frame processor; audio is copied, never re-encoded — `media-pipeline.md`.
- HEVC that the browser cannot decode is handled by an opt-in, in-browser ffmpeg.wasm transcode to H.264, not by uploading or by dropping the clip — `media-pipeline.md`.
- Export frame rate is a per-variant resample onto a `1/fps` grid — duration kept, frames dropped or duplicated, never interpolated; asking for the source rate stays an exact pass-through — `media-pipeline.md`, `studio.md`.
- The GitHub Pages base path is derived from `GITHUB_REPOSITORY`, never hardcoded — `deployment.md`.
- Built-in LUTs are discovered by a Vite virtual module scanning `public/luts/` — no manual list — `deployment.md`.
- MapLibre is dynamically imported (JS + CSS) so it stays out of the main bundle — `frontend.md`.
- The overlay engine (element model, stage, burn-in export, editing panels) is shared (`shared/overlay/`), consumed by both the Studio and the legacy overlay page — `architecture.md`, `studio.md`.
- Overlay elements are added from a foldable preview palette, never a dropdown; a preview shows the real value or nothing, never a fabricated one — `studio.md`.
- Canvas trap: a shadow is dropped when drawing under a `destination-*` composite mode — build masks in their own buffer first — `studio.md`.
- The heading is course over ground (no compass in the log) and vanishes while hovering or yawing; smoothing is a pure `(cues, time)` function, never a per-frame accumulator — `studio.md`.
- Tool layouts split on **container** queries, not viewport ones: the Library sidebar eats 288px the viewport query cannot see — `studio.md`.
- Time elements: presentation per badge, capture-time **shift** per project; no timezone picker — the log has no zone to convert from — `studio.md`.
- Conversion LUTs target a Rec.709 reference display (~gamma 2.4) while the canvas is sRGB (~2.2); an optional output transform closes that gap, baked into the composed LUT, off by default — `media-pipeline.md`.
- LUT lattice lookup is tetrahedral by default (neutrals stay neutral), trilinear on request; the mode is a localStorage render pref and must be used by the bake AND the shader — `media-pipeline.md`.
- The DJI video `.srt` carries no battery level (Mini 4 Pro included): the gauge takes an authored value or a named telemetry key, and draws empty rather than inventing one — `studio.md`.

## Open items (dated; remove when done)

- 2026-08-20 — `src/app/site.ts` still points `REPO_URL` at `https://github.com/CostardRouge/dji-flight-data`, the pre-rename repository name, while `vite.config.ts` falls back to `atelier` and the README links `costardrouge.github.io/atelier/`. The masthead/footer source links are therefore stale. Needs a maintainer decision only in that it is a user-visible link; the fix itself is one constant.
- 2026-08-20 — `scripts/gen-luts.mjs` tells the reader to add an entry to `src/lut/builtin-luts.ts` after regenerating. That path does not exist (it is `src/shared/lut/builtin-luts.ts` since phase 0) and the manual list it describes is gone — `builtin-luts.ts` now just reads the `virtual:luts` manifest. The comment is stale in both halves.
- 2026-08-20 — `index.html` loads Space Grotesk, Instrument Serif, JetBrains Mono and VT323 (added for the Pixel CRT title style) from Google Fonts on every page load, unconditionally, while the README's "one network exception" callout names only the opt-in map tiles. Either self-host the three faces (making the offline claim literal) or widen the callout — a maintainer call, since it is a product statement.
- 2026-08-20 — `tests/` holds only `fixtures/sample.srt`; all specs live beside their source in `src/**`. Fine as is, but a future agent should not read the empty-looking `tests/` directory as "there are no tests".
- No secret has ever been tracked in this repository (checked 2026-08-20 across the working tree), so there is nothing to rotate.

## Topic files — read before touching the area

| File | Read when you touch… |
| --- | --- |
| `docs/memory/architecture.md` | the shell, the tool registry, the asset library, adding or removing a tool |
| `docs/memory/media-pipeline.md` | video decode/encode, exports, transcoding, LUT rendering, canvas compositing |
| `docs/memory/frontend.md` | UI, layout, styling, MapLibre panes, the design tokens |
| `docs/memory/deployment.md` | `vite.config.ts`, CI, GitHub Pages, `public/luts/`, anything about how the site is built |
| `docs/memory/testing.md` | tests, what is testable, how to keep new logic testable |
| `docs/memory/local-first.md` | anything that could touch the network, read files, or persist data |
| `docs/memory/studio.md` | the Studio tool, the tool-merge plan, project persistence, title styles, retiring a legacy tool |
