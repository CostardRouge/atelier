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
- The clip's opening window carries the same motion measured **forward** (`Cue.lead`, read through `motionAt`), so the instruments are alive on frame one; it never covers a real reading, never reaches past that window, and invents nothing — `studio.md`.
- Tool layouts split on **container** queries, not viewport ones: the Library sidebar eats 288px the viewport query cannot see — `studio.md`.
- Time elements: presentation per badge, capture-time **shift** per project; no timezone picker — the log has no zone to convert from — `studio.md`.
- Conversion LUTs target a Rec.709 reference display (~gamma 2.4) while the canvas is sRGB (~2.2); an optional output transform closes that gap, baked into the composed LUT, off by default — `media-pipeline.md`.
- LUT lattice lookup is tetrahedral by default (neutrals stay neutral), trilinear on request; the mode is a localStorage render pref and must be used by the bake AND the shader — `media-pipeline.md`.
- Exports **already** carry a correct `colr` bt709 tag, via encoder metadata mp4-muxer turns into the box — measured; do not "add" tagging, and a guard drops any colour space the muxer would mis-encode — `media-pipeline.md`.
- **No CI gate can see a broken shader** — GLSL is a template literal nothing compiles, and failure degrades silently to un-graded exports. Run `node scripts/check-shader.mjs` after touching `lut-gl.ts` — `media-pipeline.md`.
- HDR (HLG/PQ) is not handled and deliberately will not be: the pipeline is 8-bit SDR by construction and a browser cannot reasonably do better — `media-pipeline.md`.
- In/out trimming is **per clip** (bound half of the project, keyed by media name and guarded by duration) and the export cuts inside the one WebCodecs pipeline — `studio.md`, `media-pipeline.md`.
- A project's settings export to / import from `.atelier.json` — the portable half exactly, media and trims never; export + overwrite-this-project live in the settings modal, import-as-new-project in the gallery — `studio.md`.
- A trip exports to / imports from `.roadtrip.json`, and it is a **backup, not a template**: the whole document minus the trip id, the timestamps and each post's `projectId`; media refs travel because their hash is what finds the pictures elsewhere; import always makes a new trip — `roadtrip.md`.
- Conformed footage (slow motion, time-lapse) is corrected by ONE measured number — capture seconds per media second — applied in `attachMotion`; physics runs on capture seconds, aesthetics on timeline seconds — `studio.md`.
- The intro is a **scene** (a shared window + optional scrim + solo) over ordinary elements that gained a `window` and an `animation`, not a second class of element; it plays over the running footage and the export stays 1:1 with the source — `studio.md`.
- The DJI video `.srt` carries no battery level (Mini 4 Pro included): the gauge takes an authored value or a named telemetry key, and draws empty rather than inventing one — `studio.md`.
- Road Trip tracks a journey by **calendar day, never by file name** (exports get renamed and re-graded); days are derived from the trip's two dates, and trip dates are `YYYY-MM-DD` with every subtraction in UTC — `roadtrip.md`.
- A second durable store follows the studio's hand-rolled IndexedDB pattern in its own database; Dexie and SQLite were both weighed and declined for a one-document-per-trip model — `roadtrip.md`.
- The Road Trip day badge is built from ordinary overlay `text` elements handed to `drawOverlays`, never a second renderer — it inherits the title-style presets, and preview and export are the same code at two sizes — `roadtrip.md`.
- A badge's look belongs to the TRIP, not the post (a signature that varies per post is not one), and defaults to `neutral`: flat vermilion measurably vanishes over warm footage — `roadtrip.md`.
- Badge copy is English by default and every word is an editable field on the trip; a per-piece override that is emptied returns the computed value, never a blank — `roadtrip.md`.
- A badge piece departs from the theme by writing its own value AND pinning that key in `styleOverrides`; casing is applied to the string, never to the element's flag — `roadtrip.md`.
- `StylePanel` is engine-level (`shared/overlay/`) since Road Trip became its second consumer — a tool never reaches into another tool — `architecture.md`, `roadtrip.md`.
- `LegibilityStyle` gained a corner radius and an outline, drawn by one shared helper; the radius defaults to what the four call sites used to hard-code, so no stored document changes shape — `roadtrip.md`.
- A badge's temporal line ("515 days ago") is a MODE and a PIECE of its own, drawn under the place — it never displaces the trip's name; `anniversary` fires only on the real anniversary, and the reference day is an input, never `Date.now()` — `roadtrip.md`.
- Every mode in a Road Trip panel shows the line it would really draw for the post in hand, or the reason it cannot: a fabricated example, and a silent fallback, both read as a broken feature — `roadtrip.md`.
- The day a piece tells is measured from the picture (EXIF, else the file's date, labelled as such) and offered, never applied on its own; a picture dated outside the trip is called out — `roadtrip.md`.
- `exif-parser.ts` is engine-level (`shared/exif/`) since Road Trip became its second consumer — `architecture.md`, `roadtrip.md`.
- An overlay EXIT animation needs its window to have an END, or it never plays — the badge's hook duration is what supplies one — `roadtrip.md`.
- A glyph drawn on canvas must survive a font stack we do not control: an emoji default drew nothing at all where no colour-emoji font existed — `roadtrip.md`.
- A Road Trip post is a DECK (hook → content → call to action); a reel or a photo is the same model with one slide, and the closing card lives on the TRIP — `roadtrip.md`.
- The QR code is encoded locally (`shared/lib/qr.ts`) rather than fetched, and is verified by decoding the rendered canvas with a decoder installed in the scratchpad, never in the repo — `roadtrip.md`.
- `drawOverlays` draws one line and never wraps: a sentence is wrapped onto a character budget first (`shared/lib/wrap-text.ts`) — `roadtrip.md`.
- An animated hook burns into a clip through the Studio's own `exportVariantVideo`, trimmed to START on the chosen frame so `originSeconds` puts the entrance on frame one; the scrim reaches the frame through a new `paintUnderOverlays` hook — `roadtrip.md`, `media-pipeline.md`.
- Only a deck's content slides reorder; the hook and the call to action are structural — `roadtrip.md`.
- Vignette and scrim are ONE stack of shades (direction × reach × strength × colour × invert × follow-the-hook); a middle band must run edge-to-edge with the peak in the centre, or a canvas gradient blacks out the far half — `roadtrip.md`.
- In an async paint, read the canvas's size AFTER the last await: a stale render that read it before drew a miniature over a resized stage — `roadtrip.md`.
- A clip's frame picker SEEKS the open video element (`BadgeSource.seek`) and never re-decodes; the paint waits on a `frameSeq` bumped when the seek lands — `roadtrip.md`.
- A hook's frame is chosen by dragging a filmstrip; cells sample the middle of their slice, frames stream in as they decode, and the drag is throttled to one change per animation frame — `roadtrip.md`.
- Road Trip addresses everything in the hash (`#/roadtrip/<trip>/<day>/<piece>`), so Back lands on the day you were on and a day is linkable — `roadtrip.md`.
- A control about the PIECE (its name, its Studio link, the trip's defaults) must never be rendered inside the hook-only branch: on a carousel's second slide it vanishes and reads as missing — `roadtrip.md`.
- Road Trip briefs the STUDIO: a piece links a project and the badge is sent in as a `roadtrip-hook` scene, so one export carries grade + telemetry + hook; a send replaces the last, and the shades' shape does not cross over — `roadtrip.md`.
- `#/studio/open/<id>` hands a project between tools and rewrites itself on arrival; neither tool reaches into the other's state — `architecture.md`, `roadtrip.md`.
- A trip remembers the look it gives a new piece of each kind; what belongs to one day is never inherited — `roadtrip.md`.
- Road Trip's grid draws its own hover card (fixed-positioned, pointer-transparent) because the native `title` is far too slow to sweep a calendar with — `roadtrip.md`.
- Each post keeps a small JPEG of its HOOK in a second IndexedDB store, taken from the preview canvas, drawn at the piece's own orientation, and pruned on delete — `roadtrip.md`.
- The Studio edits **stills on the same stage as clips** — a photo is a media a project holds beside its rushes, never a second kind of project — `studio.md`.
- A photograph is read as the **one telemetry cue it is worth** (`shared/exif/exif-cue.ts`), so the exposure, position and time elements work over it; what a still cannot answer (speed, heading, relative altitude) stays `—` — `studio.md`.
- A still has **no clock**: the deck is settled (`settleForStill`) before it reaches the renderer, or an entrance draws mid-slide and a later window draws nothing — `studio.md`.
- An `ImageBitmap` on the stage is released **one commit after** it is replaced, never where the new one is decoded: painting a detached bitmap throws inside rAF and kills the render loop — `studio.md`.
- A RAW yields its image slot to a sidecar JPEG of the same base name — the decodable half is what every tool wants to show, and listing order must not decide it — `architecture.md`, `studio.md`.
- A project is **intro · footage · closing card**: `ProjectDoc.outro` is a flat card of overlay elements (+ optional QR) the export keeps encoding after the footage — appended, never over it; audio ends with the footage; clean variants ship without it — `studio.md`.
- Road Trip's call to action crosses the bridge into that outro slot, same rules as the hook (prefix, replace, unlink); an outro the author composed themselves is never overwritten — `roadtrip.md`, `studio.md`.
- Anything added to a project's portable half must land in FOUR places: `ProjectPortable`, `toProjectFile`, `parseProjectFile` and `applyProjectFile` — the last was forgotten once and the gallery import silently dropped intros — `studio.md`.
- A tool that redirects from a route effect must first check the path is its own (`isWithinRoute`): a mounted tool still observes the hash after it has changed to another tool's, and redirecting then makes the switcher do nothing — `architecture.md`.
- A **source** is where projects, state and (later) scheduled work live — not a media pool. `local` is source #1 (File System Access + IndexedDB), a Winnow instance is its peer, and **a project belongs to exactly one source**: that limit is what removes sync and merge entirely. Built since phase 0.5: `shared/sources/source.ts`, `ProjectDoc.sourceId` (v14, bound half — never in the portable file), and the gallery groups by source even with one group — `architecture.md`, `docs/winnow-bridge.md`.
- **Atelier is a client, never a host** — no backend, no database; persistent state lives in the browser or on a server the user owns. That is what makes multi-device, and later proactive features, possible without becoming a cloud — `docs/winnow-bridge.md`.
- Topology is **configuration, not a decision**: `SameSite` is judged on the SITE, so `atelier.steeve.website` ↔ `winnow.steeve.website` is cross-origin but *same-site* and the cookie travels with a CORS allowlist. A Bearer credential is only needed for a genuinely foreign instance — `docs/winnow-bridge.md`.
- Media identity resolves **id → hash → name**, and the hash is Winnow's `content_hash` recomputed locally (`shared/lib/partial-hash.ts`, fixtures pinned to Winnow) — so a project survives a rename and resolves the same file from a folder or from an instance — `studio.md`, `docs/winnow-bridge.md`.
- Winnow media previews on the **proxies** (H.264/AAC/faststart, so no ffmpeg.wasm; WebP for a RAW) and the Studio export **fetches the capture before the first variant**, with a checkbox to render from the proxy instead; a variant never upscales, so the panel states what it will really deliver — `studio.md`, `docs/winnow-bridge.md`.
- A Winnow asset enters the library **fetched and wrapped as a `File`** (proxy by default, original on request, `.srt` alongside), vouched for with the original's hash — never streamed by URL, never hashed on its own bytes; connecting is the user's click on `#/connect`, and nothing runs at boot — `architecture.md`, `local-first.md`.

## Open items (dated; remove when done)

- 2026-08-20 — `scripts/gen-luts.mjs` tells the reader to add an entry to `src/lut/builtin-luts.ts` after regenerating. That path does not exist (it is `src/shared/lut/builtin-luts.ts` since phase 0) and the manual list it describes is gone — `builtin-luts.ts` now just reads the `virtual:luts` manifest. The comment is stale in both halves.
- 2026-08-20 — `index.html` loads Space Grotesk, Instrument Serif, JetBrains Mono and VT323 (added for the Pixel CRT title style) from Google Fonts on every page load, unconditionally, while the README's "one network exception" callout names only the opt-in map tiles. Either self-host the three faces (making the offline claim literal) or widen the callout — a maintainer call, since it is a product statement.
- 2026-08-20 — `tests/` holds only `fixtures/sample.srt`; all specs live beside their source in `src/**`. Fine as is, but a future agent should not read the empty-looking `tests/` directory as "there are no tests".
- 2026-08-21 — HLG footage is silently flattened to SDR instead of being flagged. The honest, cheap version is a notice, not a feature: `telemetry-summary.colorProfile` already carries the SRT's `color_md`, so the studio could say "this clip is HLG; we work in SDR" the way the battery gauge draws "—" rather than inventing a level. The maintainer has ruled out real HDR support (see `media-pipeline.md`); only the notice is open.
- 2026-08-21 — One latent defect left of the four surveyed: the 8-bit LUT fallback clamps LUT *output* to [0,1], destroying the shipped DJI cube's `#Not-Clipped.` highlight rolloff on a GPU without `OES_texture_float_linear`. **Measured on the maintainer's machine: the extension is present**, so this is dead code for him and the float path is always taken — do not re-propose it as a fix for his setup. It would also now be cheap, since the tetrahedral path uses `texelFetch` and needs no linear filtering; the cost is a second texture-format branch in `lut-gl.ts`, the file least visible to CI. The other three (shader ignoring `DOMAIN_MIN`/`DOMAIN_MAX`, mp4-muxer's silent matrix=0, the bake blocking the strength slider) are fixed — see `media-pipeline.md`.
- 2026-08-22 — Element timing is edited with number fields ("appears at / disappears at", plus From-playhead buttons). The natural follow-up the maintainer will want is a **lane under the TrimBar**, one draggable bar per timed element — the first thing that would make the studio feel like a timeline. Not started; the constraint to respect is that the bar splits into bands, never z-index (`studio.md`).
- 2026-08-22 — A **pre-roll / freeze-frame intro** (output longer than the source) was explicitly deferred, not rejected: the maintainer chose "over the images" for now. Half the mechanism exists since 2026-08-25 — the outro's appended tail (`export-tail.ts`) proves the encoder seam; what remains for a PRE-roll is the timestamp shift every existing frame would need.
- 2026-08-25 — The outro edits its lines as text inputs; **free element placement on a card stage of its own** (full intro parity: drag, style, animate on the card) is the agreed next step, deferred. The stage cannot scrub past the clip, so it needs a stage mode, not a longer timeline.
- 2026-09-01 — Phase 1 of the bridge is built on both sides but **not yet proven end to end**: Winnow's `CORS_ALLOWED_ORIGINS` must be set to `https://atelier.steeve.website` on the Optiplex and that image deployed, then a real connect + add tried from the deployed Atelier (the dev server on `localhost` is cross-SITE to `winnow.steeve.website`, so the cookie cannot travel from it — a local test needs a `winnow.localhost`-style same-site setup or the deployed pair). The export-from-original switch (§3.2 of the brief) is not built: today the browser chooses proxy or original at add time.
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

Not a memory file, but read it before touching anything about media sources or
document storage: **`docs/winnow-bridge.md`** — the agreed design for connecting
Atelier to Winnow (the maintainer's media-triage project), the two adapter seams
it rests on, and the phases. Verified 2026-08-29 against the Winnow repository
itself (`~/Documents/GitHub/winnow`, `CostardRouge/winnow`), so its claims about
both sides carry paths and can be re-checked; rewritten 2026-08-31 around the
source model, with several instances and scheduling marked *later* but designed
for. Nothing in it is built yet.
