# Project memory — decisions, reasons, traps

Long-term memory of this repo, read at the start of **every** agent session (imported by `CLAUDE.md`). It holds what the code and `git log` cannot tell you: the choices made and their reasons, what was tried and rejected, the traps that cost time, how the maintainer likes to work.

This file is the **always-loaded index**. The detail lives in `docs/memory/<topic>.md`, one file per area, loaded **on demand**: read the topic file(s) matching the area you are about to touch **before** acting (table at the bottom). Do not `@import` them into `CLAUDE.md` — the split exists to keep the per-session prompt small.

## How to maintain (mandatory — CLAUDE.md rule 2)

- **When**: at the end of every task, before its commit, in the same commit. Writing is the **default**; only skip if there is truly nothing a future agent could use, and say so explicitly in the final message.
- **What**: a design/product decision, a non-obvious technical choice, an explicit rejection ("the maintainer did not want X because Y"), a trap (browser, tooling, framework, hosting) and its remedy, a working preference. Not implementation detail readable in the diff, not what `git log` already says, not history ("this was fixed on…") — once a fix is committed, keep only the rule it taught.
- **Where**: the matching `docs/memory/<topic>.md`; a new file only when no topic fits (kebab-case name, add it to the table below with a "read when"). Cross-cutting rules, working style, decisions-at-a-glance and open items stay in this index.
- **How**: search first and **update** the existing entry rather than adding a near-duplicate; delete what became false. One entry = one short paragraph: *decision → why → how to apply*, dated `YYYY-MM-DD` on first write and on each revision. Say the same thing **once** — cross-reference other files by name instead of repeating.
- **Language**: **English**, dense, factual. No session narration.
- **No test counts.** Write "(pure)" beside a module, never "(pure, 14 specs)": a count rots with every spec added, and the 2026-10-04 audit found fourteen of them wrong at once. The spec file beside the module is the count.
- **The weekly audit** (`.github/workflows/memory-audit.yml`, Sunday) checks these files against the code and opens a `Memory audit <date>` issue listing what drifted; it never edits memory itself. **How to apply**: re-check each finding on the current tree (the issue may be days old), apply the true ones in ONE memory-only commit whose PR closes the issue, and leave an issue open only for what needs his decision.
- Budget: keep this index under ~200 lines and each topic file under ~150; if one outgrows that, split it.

## Working with Steeve Pommier

<!-- Add what you learn about how he validates work, how he phrases requests,
     what he wants when an audit finds problems, what annoys him. -->

- 2026-08-20 — Observed from history, not yet confirmed in conversation: work lands as focused, self-describing commits (one tool or one fix per commit, prose imperative titles, a body explaining the *why*), and most agent work reaches `main` through a pull request (`(#NN)` merge titles) rather than a direct push. Assume a PR is expected for anything non-trivial in a cloud session.
- 2026-09-09 — **Never size work in human developer days.** The agent writes the code, in this session; the maintainer's words: *"you are going to do as you did all of my development across multiple of my repos during the last four months — this is not going to take days, it could be done tonight if I instruct you right"*. A "one week" estimate on a feature reads as a refusal to start. **How to apply**: size a plan in COMMITS and passes (one commit = one task, CLAUDE.md rule 1), name what each one delivers and what verifies it, and let him stop the run wherever he wants. The scarce resource is his instruction and his review, never engineering time.
- 2026-10-02 — **He measures an interface against twenty UI/UX laws** (Hick, Fitts, Jakob, proximity, Miller, Doherty, Von Restorff, target distance, serial position, peak-end, Zeigarnik, Prägnanz, similarity, uniform connectedness, Tesler, Postel, Parkinson, Occam, Pareto — his list, read in `docs/deduce-ux-laws.md`), and a window that makes him READ is a defect («très encombrée … beaucoup de texte partout»). **How to apply**: before adding a control or a sentence to a screen, say which law it serves and what it replaces; standing prose goes behind an ⓘ or a tooltip, a fact said twice is said once, and English labels name what a thing does rather than a lab's codename.
- 2026-10-12 — **When he asks for a design of ONE part, draw only that part** (*«juste la partie sélecteur d'opener … pas besoin de gaspiller des tokens»*) and leave what he did not ask to change exactly as it is — a first lab that restyled the opener picker as a band read as a proposal he never made. **How to apply**: a lab for a part shows today's beside the proposal and says what stays.
- 2026-08-20 — Documentation is kept current with the code: the README describes every tool, its trade-offs and its browser caveats, and a commit that changed the tool line-up also refreshed the README (`aade8e2`). Treat a user-visible feature as unfinished until the README says the same thing as the code.

## Direction in five lines

- **Local-first, no server, no account**: files are read in the browser and never uploaded. Every feature must hold this line; the documented exception is the opt-in OpenStreetMap base layer under a flight path (Flight Map and Composer alike) and, since 2026-09-28, under Trips' big picking map and INSIDE an Itinerary or a Virée (preview and export, credited, when the piece asks and this device allows), off by default and surfaced explicitly (README, "The network exceptions"). The full list of requests the app actually makes is in `local-first.md` — it is longer than that callout.
- **A suite converging into one Studio**: a thin shell (`src/app/`) plus self-contained tools (`src/tools/*`) over a generic core (`src/shared/*`), all listed in one registry (`src/app/tools.tsx`) — and, since 2026-08-20, an agreed plan to merge the tools into a single `/studio` editor (phases and decisions in `studio.md`).
- **Capture-oriented**: photo and video across devices (DJI, Apple, Sony), with DJI flight telemetry as the founding case.
- **The browser is the runtime today, not forever**: pure logic is kept DOM-free so a native shell (Tauri, bundled ffmpeg) can reuse it — `shared/sources/file-sources.ts` is meant to be the only brick that changes.
- **Visual identity is deliberate**: "Studio Papier" — ink on warm cream, one vermilion accent, monospace numerals (`src/index.css` tokens).

## Decisions at a glance (one line per area; the full entries are in each topic file)

Since 2026-10-22 the long entries that stood here live verbatim under « Moved from the MEMORY.md index » at the foot of the topic file named; a new cross-cutting decision gets one short line here and its text there.

- **Shell and architecture**: one tool registry (nav, routes, library), each tool its own lazy chunk; `shared/` never imports `tools/`, pure logic DOM-free and tested; one asset library; a tool is also an element the others use (Develop as a modal); one tab edits a document (Web Lock); undo is a stack of whole documents; a document belongs to ONE source; Atelier is a client, never a host; the Winnow client writes only through the document bucket with `If-Match`; `#/sources` connects and manages; `MediaActions`, capture-instant dates, the healing thumbnail — `architecture.md`.
- **Network and storage**: fonts from our own origin; three opt-in network exceptions (OSM tiles, Nominatim place search, Lensfun profiles); a Winnow is written in three places only — `local-first.md`, `lens-profiles.md`.
- **UI rules**: a slider is one bar; every target grabbed on 44 px under a finger; a phone editor may take the whole screen; three named shell layouts and a measured screen height (`--app-h`); the library docked or a sheet; sheet vs drawer; menus portalled, a toolbar never inserts a control; Space belongs to the transport; status pills, one `PageBar`, full-screen modals under 820 px; a picker asked at the click; press feedback on the button; settings as glyph panels; Winnow's recipes; one zoom reading for Looking and Placing; the committed PNG icon set, standalone — `frontend.md`.
- **Media pipeline**: one WebCodecs export, a clip's sound copied and a made bed encoded to AAC; HEVC through an opt-in ffmpeg.wasm; fps resampled on a grid; a stage pixel budget and stills decoded at their use; HEIF and JPEG XL decoders shipped; the LUT vault and its two hashes; tetrahedral lookup and the Rec.709 output transform; a look born at 40 %; `colr` already right; no CI sees a broken shader; no HDR in video; a film stock is a look layer — `media-pipeline.md`.
- **Render core and passes**: a float16 multi-pass graph with the cube as two nodes; float cube textures; the 8-bit canvas dithered; renders resume after the last unchanged pass; bands on a phone; detail, repair, film grain/halation as passes; Ultra HDR JPEG for stills — `render-core.md`, `render-detail.md`, `render-repair.md`, `render-film.md`, `hdr.md`.
- **RAW**: the base ladder of four rungs; the sensor developed through libraw-wasm with a measured gain; the camera render read first; ProRAW in JPEG XL without LibRaw; the two halves turned by two hands; a phone's memory (bands, tiles, budgets) — `raw.md`, `device-memory.md`, `camera-profiles.md`.
- **Develop blocks**: the develop is the cube's first stage, its head per pixel; the tone curve rolls off; a RAW's base curve; half size under the hand; the grader lives with its source; before → after left to right; the stage swipes with A/B off; Auto verbs are switches; automation writes the record, never pixels; a picture says its pixels; the Develop tool is the third editor — `develop.md`.
- **Develop tool and roll**: clips in a roll; a classic crop and a border; a roll finds its own pictures; `opensOn`; RAW originals from the render inside only when it beats the proxy; delivered names are the original's, EXIF carried, signed `Atelier`; 16-bit PNG target; ⌘C/⌘V a whole picture; ↶ ↷ over one record; an edit TAKEN by Trips and the Studio; device settings; his style learned locally (*My own*) — `develop-roll.md`, `develop-media.md`, `roll-choice.md`, `develop-output.md`, `training.md`.
- **Renditions**: which pixels a still leaves from lives on the picture; a RAW yields to its sidecar JPEG and stays a rendition — `renditions-build.md`, `renditions.md`, `architecture.md`.
- **Masks and layers**: masks computed from the whole list, a subject subtracted, taken back and refined — `subject-picking.md`, `subject-model.md`, `mask-ui.md`.
- **Studio**: overlay elements from a preview palette; course over ground and lead motion; container queries; a time shift, no zone picker; trims per clip; `.atelier.json` the portable half (four places); the intro a scene, the outro a card; stills on the same stage, read as one telemetry cue; a source vouches for dropped EXIF; id → hash → name; proxies to preview; stage renditions; a project kept on a Winnow — `studio.md`.
- **Trips, the model**: calendar days, never file names; `.roadtrip.json` a backup; `sourceId`; local now, remote on idle; one settings sheet; a stage is a leg of ordered places; a place keeps what it knows and says its country; Polarsteps in Deduce; a timeline chapter is a stage; clone and house style — `roadtrip.md`.
- **Trips, the pieces**: a deck of FREE slides; a slide's length is parts with an owner; four tabs over one stage; the badge from overlay text, its look the trip's, camera plate, temporal line, odometer; three grade rungs; shades engine-level; framing and motion as cards; collages; `MediaIntake`; everything in the hash; Trips briefs the Studio — `roadtrip.md`.
- **Openers and the road**: hook variants from a registry; the Itinerary; Virée's software 3D, fleet and ferries; Vitrine; stops found on a big map; OSM tiles inside openers, streamed and cached; the road's drive styles — `roadtrip.md`, `showcase.md`, `trip-road.md`, `trip-road-drive.md`.
- **Trips overview**: a calendar of months; Calendar · Map · List; the stage ruler and its one gesture surface — `roadtrip.md`.
- **Elsewhere**: one Winnow picker — `winnow-picker.md`; a wait inside a run is never bare — `tasks.md`; agents drive the suite through commands — `agent-commands.md`.
- **Build, release, portfolio**: the base path from `GITHUB_REPOSITORY`; built-in LUTs discovered; Dependabot (C20); versions (C13); the portfolio standard (C14–C19) and the public page; the Registry block (CLAUDE.md rule 3) — `deployment.md`, `public-page.md`.

## Open items (dated; remove when done)

One line each; the detail is under « Moved from the MEMORY.md index » in the file named, or in that file's own sections.

- 2026-10-17 — The backfilled releases 0.1.0–0.12.0 wait on `second-brain`'s "Backfill releases" workflow — `deployment.md`.
- 2026-08-20 — `scripts/gen-luts.mjs` points at a path and a manual list that no longer exist (stale comment) — `deployment.md`.
- 2026-08-20 — `tests/` holds only a fixture; every spec lives beside its source in `src/**` — `testing.md`.
- 2026-08-21 — HLG footage is flattened to SDR silently; only a notice is open, real HDR is ruled out — `media-pipeline.md`.
- 2026-08-22 — A lane under the TrimBar for element timing, not started — `studio.md`.
- 2026-08-22 — A pre-roll / freeze-frame intro, deferred not rejected — `studio.md`.
- 2026-08-25 — Free element placement on the outro's own card stage, agreed and deferred — `studio.md`.
- 2026-09-02 — Winnow's entry points into Atelier ("Edit in Atelier") are undesigned, deliberately — `architecture.md`.
- 2026-09-03 (rev. 2026-09-06) — Winnow's timeline: the read path is checked, the upload's two fields are still assumed — `roadtrip.md`.
- 2026-09-06 (rev. 2026-09-20) — A piece takes the day's pictures from the Library's instance tab; multi-instance deferred — `architecture.md`.
- 2026-09-07 — The Library's instance tab is a VIEW of the tool's span; a stage/leg span is next — `architecture.md`.
- 2026-09-09 (rev. 2026-09-13) — Trips' video exports P1–P5 built; the combined reel and the `hookSeconds` clamp open — `roadtrip.md`.
- 2026-09-20 (rev. 2026-10-02) — A full-density export costs GPU memory; bands on a phone, his Mac's stripes uncaused — `render-core.md`.
- 2026-09-09 (rev. 2026-09-28) — A big photograph at full density is still expensive; measure on his iPhone — `media-pipeline.md`.
- 2026-09-13 — The interface audit is built; the legacy pill constants and a phone measurement remain — `frontend.md`.
- 2026-09-13 — The photo editor (`docs/photo-develop.md`): P1–P4 built, his decisions on the rest — `develop.md`.
- 2026-09-15 (rev. 2026-09-20) — Delivering a still from its original: O1 + O2 built, O3 open — `renditions.md`.
- 2026-09-16 — Collage slides and staggered motion built; clips in cells and per-cell entrances deferred — `roadtrip.md`.
- 2026-09-16 (rev. 2026-09-28) — Any slide may hold an opener, a badge, shades and masked text; five calls his — `roadtrip.md`.
- 2026-09-17 — The photo editor brief (`docs/photo-editor.md`): the fourteen phases built, two questions left — `develop.md`.
- 2026-09-20 — Film simulation built; the taste pass on the six stocks is his — `render-film.md`.
- 2026-09-19 (rev. 2026-09-21) — Purchased LUT packs built; the sync unverified against a real instance — `media-pipeline.md`.
- 2026-09-20 — Deducing the itinerary is built; never run against the deployed pair — `roadtrip.md`.
- 2026-09-20 (rev. 2026-10-07) — A DJI DNG carries no usable render; "RAW by default" is his call — `raw.md`.
- 2026-09-21 — `Vary: Origin` on Winnow's derivative routes is the root fix, his to make in Winnow — `architecture.md`.
- 2026-09-21 — Capture renditions (a RAW as a separate file): the plan is built, five decisions his — `renditions.md`.
- 2026-09-21 — Progress and Cancel suite-wide: T1 → T5 built — `tasks.md`.
- 2026-09-22 — The trip overview on a phone: direction B built, four of §9's questions his — `roadtrip.md`.
- 2026-09-22 — The optimisation pass: what the four audits found and deliberately left — `architecture.md`.
- 2026-09-23 — Develop against Lightroom / Capture One (`docs/lightroom-gaps.md`): five passes done, his answers recorded — `develop-roll.md`.
- 2026-09-23 (rev. 2026-09-24) — Picture motion: edited as cards (face A), not driven on his phone — `roadtrip.md`.
- 2026-09-23 — Shades' falloff and the camera plate built; free plate drag and a plate elsewhere left open — `roadtrip.md`.
- 2026-09-28 — Develop's Export tab redesign built, not driven on his phone — `develop-roll.md`.
- 2026-09-29 — The same export grammar in Trips and the Studio; the Studio's H.264 path not encoded here — `tasks.md`.
- 2026-10-01 — The look picker workbench built; two questions his, a LUT naming pass on request — `frontend.md`.
- 2026-09-29 — The overview's map view built; "where the pictures were" and the replay left open — `roadtrip.md`.
- 2026-09-30 — A picture's making-of video built; the H.264 and AAC encode unmeasured here — `develop-roll.md`.
- 2026-10-01 — The one Winnow picker built; drive it against his real instance, Winnow #277 — `winnow-picker.md`.
- 2026-10-02 — Develop's band (face D) built, driven headless only — `develop-roll.md`.
- 2026-10-02 — Automating the develop: heuristics built, the training collection under way, the LLM closed — `develop.md`.
- 2026-10-02 — The mask UI and a subject that takes back built; a SAM-family model only if needed — `mask-ui.md`.
- 2026-10-02 — The project audit (`docs/audit-2026-10-02.md`): DATA-01, PERF-03, A11Y-01, A11Y-03 the highest open — `architecture.md`.
- 2026-10-03 — Press feedback (face E) built; drive it on his iPad and phone — `frontend.md`.
- 2026-10-05 — Render fidelity audit: four compromises built, the HIF's 10 bits wait on one file of his — `render-core.md`.
- 2026-10-06 — Develop on a phone: P1–P5 and P3 built, P6 next, two calls his — `develop.md`.
- 2026-10-06 — The phone layout audit: steps 1–3 built, the Studio clip header (B-01) next — `frontend.md`.
- 2026-10-07 — The map openers' round built, not seen on his Mac or phone — `roadtrip.md`.
- 2026-10-07 — Streamed OSM tiles under a following camera, unseen against the real tile server — `roadtrip.md`.
- 2026-10-07 — Camera colour profiles: C1–C8 built, C9 waits on one ARW of his — `camera-profiles.md`.
- 2026-10-08 (rev. 2026-10-17) — Vehicles per stage, the water switch and the Trajet band built; unseen in the real editor — `roadtrip.md`.
- 2026-10-21 — Adding pictures as slides built, driven headless only — `roadtrip.md`.
- 2026-10-13 — The openers' inspector redesign built; see the pins and the drawer on his phone — `roadtrip.md`.
- 2026-10-08 — The Vitrine opener built, rendered headless only — `showcase.md`.
- 2026-10-12 (rev. 2026-10-22) — Learning his style: the adaptive `.cube` run on his Mac and PAUSED (`training/FINDINGS.md`); DevelopNet next, on a few hundred developed pictures — `training.md`.
- 2026-10-13 — Flights from Winnow: stub-driven; the dead `.srt` rows are his calls in Winnow — `winnow-picker.md`.
- 2026-10-12 — Flight Atlas is an experiment; whether it stays is his call — `flight-atlas.md`.
- 2026-10-13 — The road's drive styles: defaults set on synthetic roads, check on his real trip — `trip-road-drive.md`.
- 2026-10-13 — Sliders as one bar and 44 px targets built; not seen on his devices — `frontend.md`.
- 2026-10-13 — A slide's length (face B) built; left: see it on his Mac and phone — `roadtrip.md`.
- 2026-10-24 — One render RECIPE from a record to its passes (the stage still builds its chain by hand beside `picturePasses`): agreed direction, R1–R5 not started — `render-core.md`.
- 2026-10-24 — Hiding a slider or group for a moment: his pick is the dot as a switch + a menu + a pill, the held press refused, and hiding is an EDIT the export follows, built by parking the value (`docs/slider-peek.md` §6–§7, lab 2 https://claude.ai/artifact/X2kx8KnNDWqw8WmfkynF3S); P1–P5 built (model, switches, menu, pill, layers), driven headless only; see it on his devices, and whether the pill also lists a layer's is his call — `briefs.md`.
- 2026-10-24 — The A/B divider kept across pictures (B of the lab) and moved as a clipped layer; per-picture (C) or detents (D) are his call — `develop-roll.md`.
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
| `docs/memory/roadtrip.md` | the Road Trip tool, trip/day/post model, day badges, publishing cadence and strategy |
| `docs/memory/develop.md` | `src/shared/develop/` (the workbench blocks), the Develop modal in Trips or the Studio, the decision to make the Develop tool |
| `docs/memory/develop-media.md` | where a Develop roll's picture BYTES come from — the roll's own fetch from Winnow, local files, anything that would make a roll fetch or keep media |
| `docs/memory/develop-roll.md` | the Develop tool (`src/tools/develop/`), the roll document, the personal preset book, the editor's rules |
| `docs/memory/render-core.md` | `src/shared/render/` (the float16 multi-pass graph), `lut-gl.ts`, the graders |
| `docs/memory/render-geometry.md` | the lens, the keystone, `picture-geometry.ts` — anything that MOVES a pixel, and the `imageUv` rule |
| `docs/memory/render-layers.md` | masks and adjustment layers (`render/mask.ts`, `layer-pass.ts`, `develop/layer.ts`) |
| `docs/memory/raw.md` | `src/shared/raw/` (libraw-wasm), `DevelopSettings.base` / `rawGain`, the graph's half-float source — which BYTES a picture is developed from |
| `docs/memory/camera-profiles.md` | how camera RGB becomes the picture's colour — LibRaw's `rgb_cam`, a DNG's `ColorMatrix`/`ForwardMatrix`/profile tables (`exif/dng-profile.ts`, `raw/dng-color.ts`), a `.dcp` or an input `.icc` |
| `docs/memory/camera-profiles-build.md` | the rules C4 → C6 fixed in the RAW decoder — `applyCameraMatrix`, `decodeProfileOf` on every decode, the hue/sat map and look table passes (`hue-sat-map.ts`, `compiledHueSat`), what the decode cache keys on |
| `docs/memory/device-memory.md` | `lib/device-class.ts`, `raw/raw-budget.ts`, `raw/decoded-cache.ts`, `sources/held-budget.ts`, the decoder's lifecycle — anything that allocates by the megabyte on a phone, and what a RAW costs there |
| `docs/memory/renditions.md` | `shared/media/renditions.ts`, `MediaOrigin.companion`, `materialize.ts`, `AssetParts` — which FILE of a capture a tool works from, and what each one can give |
| `docs/memory/roll-choice.md` | `RollDoc.opensOn`, `roll-choice.ts` / `roll-choice-source.ts` — which file a picture opens on when the ROLL decides, the menu's foot and the line a pick offers |
| `docs/memory/renditions-build.md` | the rules each renditions phase fixed (R1b → R5): `sensor-source.ts`, `run-plan.ts`, `DevelopBase.tsx`, `deliveryFor` / `useDeliveryRow`, `RollPicture.rendition`, the *Delivers* row's words |
| `docs/memory/render-gain-map.md` | `render/gain-map.ts`, `gain-map-pass.ts` — a DNG's own shading correction, and any gain that is a GRID rather than a radius |
| `docs/memory/render-detail.md` | `render/detail.ts`, `detail-pass.ts`, the Detail tab — denoise, defringe, sharpen, any pass reading a NEIGHBOURHOOD |
| `docs/memory/mask-parts.md` | a layer's combined masks (`AdjustLayer.parts`, `combineMask`), the colour range and its sample (`sampleColour`) |
| `docs/memory/develop-output.md` | what a Develop export WRITES: `RollExport.targets` (v6), size modes, screen sharpening, sub-folders — pass 4 of `docs/lightroom-gaps.md` |
| `docs/memory/lens-profiles.md` | `src/shared/lens/` (Lensfun: reading, matching, interpolating, converting units, fetching), `LensProfileTerms`, the profile half of the lens pass |
| `docs/memory/subject-picking.md` | the Subject mask on the stage (`use-subject-masks.ts`), `AdjustLayer.except`, the mask's outline/fill view, the blink, and a subject reaching the EXPORT (`subject-rasters.ts`) |
| `docs/memory/subject-model.md` | what the subject model ANSWERS and what is made of it — `segmenter.ts`'s confidence map, `subject-refine.ts`, `SubjectMask.minus` and its refine settings, Remove, Tolerance, islands, Grow / Shrink, the edge (Soft, Snap) |
| `docs/memory/mask-ui.md` | the Layers tab's face — `LayersPanel.tsx`, `MaskPanel.tsx`, the one palette of kinds (`KindPalette.tsx`, `kind-palette.ts`), the list's rows, Mask \| Adjust, the recipe, the mask view |
| `docs/memory/render-repair.md` | `render/repair.ts`, `repair-pass.ts`, `RollPicture.repair`, the Repair section — heal, clone, dust, anything that COPIES pixels from one place to another |
| `docs/memory/render-film.md` | `render/film-pass.ts`, `shared/film/film-texture.ts` / `film-noise.ts` / `film-grain.ts` — grain, halation, `RenderPass.prepare`, any spatial effect belonging to a LOOK |
| `docs/memory/hdr.md` | `src/shared/hdr/` (the gain map, the Ultra HDR container, the display probe), `RollExport.hdr`, any claim about HDR on a still |
| `docs/memory/winnow-picker.md` | `shared/sources/winnow/picker/` (the one modal behind the Library's *browse all* and Develop's *Add a day*), its rail, `DayPicker`, anything that lists an instance's day or folder for a person to tick |
| `docs/memory/agent-commands.md` | `src/shared/commands/` (the command registry, `window.atelier`), `useRegisterCommands` in a tool, `scripts/atelier-mcp.mjs` — anything an agent or a script drives |
| `docs/memory/showcase.md` | the Vitrine opener (`shared/roadtrip/hooks/showcase*`) — its places, endings, entrances, the configurator lab |
| `docs/memory/trip-road.md` | a trip's ROAD — `road-track.ts`'s modes and detail, `TripDoc.road`, the Road section, Deduce's road, GPX, the points placed by hand |
| `docs/memory/trip-road-drive.md` | how the openers DRIVE and DRAW the road — a hop on it (`roadHops`), steering (`steerRoad`, `TripRoad.steer`), the counted km (`roadKms`), the vehicle's heading, the Itinerary and the overview's map |
| `docs/memory/training.md` | `training/` (the local Python workspace that learns his editing style: uv, PyTorch/MLX, FiveK, his groups of pairs, the `.cube` export, `training/PLAN.md`) |
| `docs/memory/flight-atlas.md` | the experimental Flight Atlas instrument (`src/tools/atlas/`) — every flight on one map, its choreography, painter, camera and tiles |
| `docs/memory/tasks.md` | `src/shared/tasks/`, `TaskEdge`, `TaskPill` — progress, a cancel, a spinner, a "please wait" anywhere |
| `docs/memory/public-page.md` | the head of `index.html` (canonical, OpenGraph), `public/robots.txt`, `public/sitemap.xml`, the social card and its generator, the legal notice (`#/legal`) and what it must say when measurement, a network exception or what the browser keeps changes |
| `docs/memory/briefs.md` | starting new work: the long-form briefs, audits and plans under `docs/`, their status and when to read each |
