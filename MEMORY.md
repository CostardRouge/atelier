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
- 2026-09-09 — **Never size work in human developer days.** The agent writes the code, in this session; the maintainer's words: *"you are going to do as you did all of my development across multiple of my repos during the last four months — this is not going to take days, it could be done tonight if I instruct you right"*. A "one week" estimate on a feature reads as a refusal to start. **How to apply**: size a plan in COMMITS and passes (one commit = one task, CLAUDE.md rule 1), name what each one delivers and what verifies it, and let him stop the run wherever he wants. The scarce resource is his instruction and his review, never engineering time.
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
- The SHELL, by contrast, wears three named layouts decided in one DOM-free module and published like a scope — `compact` / `medium` / `expanded`, split at 820 (unchanged, so adoption is additive) and 1180; a tool reads the name to know whether it draws its own tabs or hands its sections to the shell's bar, never to lay out its own columns — `frontend.md`.
- The shell keeps a **definite `h-dvh` at every width**, phones included: giving it up under 820px is what made the suite a vertical stack AND what made every height above a stage indefinite, so one fixed height retires that bug class instead of patching it per tool — `frontend.md`.
- A panel has **three placements and one body**: docked column (`expanded`), `SideDrawer` over the work (`medium` — the 288px library would otherwise starve a tool's own 800px container query), `BottomSheet` (`compact`). A tool's SECTIONS are published to the shell and drawn in the thumb zone on a phone, from the same array its docked tab strip uses; the library is not one of them, because the bar is the tool's and the library is the shell's — `frontend.md`.
- Time elements: presentation per badge, capture-time **shift** per project; no timezone picker — the log has no zone to convert from — `studio.md`.
- Conversion LUTs target a Rec.709 reference display (~gamma 2.4) while the canvas is sRGB (~2.2); an optional output transform closes that gap, baked into the composed LUT, off by default — `media-pipeline.md`.
- LUT lattice lookup is tetrahedral by default (neutrals stay neutral), trilinear on request; the mode is a localStorage render pref and must be used by the bake AND the shader — `media-pipeline.md`.
- The editor stage works to a PIXEL BUDGET (one 4K frame), never the media's own density: a 48-megapixel still put three 194 MB buffers up the moment a LUT was picked, and killed the tab on an iPhone. A preview budget only — every deliverable still composes from the source bitmap — `media-pipeline.md`.
- Exports **already** carry a correct `colr` bt709 tag, via encoder metadata mp4-muxer turns into the box — measured; do not "add" tagging, and a guard drops any colour space the muxer would mis-encode — `media-pipeline.md`.
- **No CI gate can see a broken shader** — GLSL is a template literal nothing compiles, and failure degrades silently to un-graded exports. Run `node scripts/check-shader.mjs` after touching `lut-gl.ts` — `media-pipeline.md`.
- HDR (HLG/PQ) is not handled and deliberately will not be: the pipeline is 8-bit SDR by construction and a browser cannot reasonably do better — `media-pipeline.md`.
- In/out trimming is **per clip** (bound half of the project, keyed by media name and guarded by duration) and the export cuts inside the one WebCodecs pipeline — `studio.md`, `media-pipeline.md`.
- A project's settings export to / import from `.atelier.json` — the portable half exactly, media and trims never; export + overwrite-this-project live in the settings modal, import-as-new-project in the gallery — `studio.md`.
- A trip exports to / imports from `.roadtrip.json`, and it is a **backup, not a template**: the whole document minus the trip id, the timestamps, its `sourceId` and each post's `projectId`; media refs travel because their hash is what finds the pictures elsewhere; import always makes a new trip, on the source that imports it — `roadtrip.md`.
- `TripDoc.sourceId` (v11) names the ONE source a trip is kept in, like `ProjectDoc`'s; the trip gallery groups by source even with one group, and the New-trip "Keep on" picker only appears with a second document-capable source — `roadtrip.md`, `docs/roadtrip-persistence.md`.
- A trip kept on a Winnow saves **local now, remote on idle**: the remote copy is the authority, the IndexedDB copy its mirror, the bookkeeping a reducer beside the document (`shared/sources/doc-sync.ts`, store `sync`), an etag that REFUSES a stale write and a pill that says every state — never a sync engine. The Winnow side (migration 0041 + `/api/apps/:app/docs`) shipped there on 2026-09-07 and the whole flow is confirmed working; a browser that connected BEFORE it shipped hides the feature until `reconnect`, because the capabilities sheet is a snapshot — `roadtrip.md`, `docs/roadtrip-persistence.md`.
- The Winnow client WRITES in exactly one place, the document bucket, with `If-Match`; 404 is `notfound` (never revealing a foreign row), 412 is `conflict` carrying the server's revision — `architecture.md`.
- A Studio project is kept on a Winnow by the same machinery as a trip (`shared/sources/doc-sync.ts` + `SyncPill` + `doc-remote.ts`, `projects/project-remote.ts` the twin of `trip-remote.ts`); its folder handle and thumbnail never travel, the media refs do, and the shell remounts the editor whenever it replaces the document under it — `studio.md`.
- A picture is reframed inside its frame — drag, zoom, rotate — by ONE shared transform (`shared/media/framing.ts`) the preview, the PNG deck and the burned-in clip all draw through; it can never be zoomed out past covering or panned off an edge, and a crop is never inherited by the next piece — `roadtrip.md`, `media-pipeline.md`.
- Conformed footage (slow motion, time-lapse) is corrected by ONE measured number — capture seconds per media second — applied in `attachMotion`; physics runs on capture seconds, aesthetics on timeline seconds — `studio.md`.
- The intro is a **scene** (a shared window + optional scrim + solo) over ordinary elements that gained a `window` and an `animation`, not a second class of element; it plays over the running footage and the export stays 1:1 with the source — `studio.md`.
- The DJI video `.srt` carries no battery level (Mini 4 Pro included): the gauge takes an authored value or a named telemetry key, and draws empty rather than inventing one — `studio.md`.
- A trip's dates and its route are re-edited in the CREATION sheet, which says before saving what a shorter span does to the legs (trimmed, dropped) and never touches a piece; the route writes back into the legs that hold its two ends — `roadtrip.md`.
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
- Road Trip GRADES, through the Studio's engine and never a second one: the trip's `grade` (v10) dresses every piece, a post's `grade: null` follows it, `renderBadge` grades at source density before the crop, and the grader is caller-owned because a WebGL2 context per repaint is never reclaimed — `roadtrip.md`.
- The piece editor is FOUR tabs (Content · Look · Picture · Export) over one stage where a click selects a piece and a drag moves the whole block; the deck is a slide rail beside the picture, everything trip-wide is behind ⚙ Trip, a mode shows the line it really draws with its list one click away, and every standing paragraph folds behind an ⓘ — `roadtrip.md`.
- `GradePanel` is engine-level (`shared/lut/`) since Road Trip became its second consumer, exactly as `StylePanel` — `roadtrip.md`.
- `#/studio/open/<id>` hands a project between tools and rewrites itself on arrival; neither tool reaches into the other's state — `architecture.md`, `roadtrip.md`.
- A trip remembers the look it gives a new piece of each kind; what belongs to one day is never inherited — `roadtrip.md`.
- A Road Trip stage is a LEG carrying an ORDERED list of located places; its start and end are the first and the last, derived and never stored, and a place has no dates of its own — `roadtrip.md`.
- The legs are a horizontal RULER under the calendar grid (drag an edge or a bar, whole days only, one leg open beneath), the grid's cells wear their leg's tint, and a right-click on a day starts/ends/extends a leg by name — "start here" inside a leg is a cut. Geometry and edits are pure (`stage-ruler.ts`, `stage-edit.ts`); every drag has a keyboard twin — `roadtrip.md`.
- On that ruler a drag moves a LEG and nothing else: a day is picked with a click, never a scrub, so a finger is free to scroll a track wider than the screen — `roadtrip.md`.
- A drag surface inside a scroll box claims only the axis it writes (`touch-pan-y`, never `touch-none`), and a surface that is merely pointed at claims nothing: `touch-none` on something that scrolls leaves touch no way in — `frontend.md`.
- Looking a place up online is the suite's SECOND network exception, taken deliberately: opt-in, off by default, consent in `localStorage` and never on an exportable document, and never as-you-type — `roadtrip.md`, `local-first.md`.
- The trip overview's day grid and stage ruler zoom too, multiplying their own unit (cell size, day width) with the editor's pill — `roadtrip.md`.
- Road Trip's grid draws its own hover card (fixed-positioned, pointer-transparent) because the native `title` is far too slow to sweep a calendar with — `roadtrip.md`.
- Each post keeps a small JPEG of its HOOK in a second IndexedDB store, taken from the preview canvas, drawn at the piece's own orientation, and pruned on delete — `roadtrip.md`.
- The Studio edits **stills on the same stage as clips** — a photo is a media a project holds beside its rushes, never a second kind of project — `studio.md`.
- A photograph is read as the **one telemetry cue it is worth** (`shared/exif/exif-cue.ts`), so the exposure, position and time elements work over it; what a still cannot answer (speed, heading) stays `—`, and a DRONE still does know its height above take-off — `studio.md`.
- A source **vouches for the EXIF its proxy dropped** (`MediaOrigin.exif`, merged UNDER the file's own by the one read path, `shared/exif/read-exif.ts`): a re-encoded rendition carries no metadata, so the values Winnow parsed at ingest are what make a drone photo's exposure, position and altitude readable at all, and a panel says which instance vouched — `studio.md`.
- A still has **no clock**: the deck is settled (`settleForStill`) before it reaches the renderer, or an entrance draws mid-slide and a later window draws nothing — `studio.md`.
- An `ImageBitmap` on the stage is released **one commit after** it is replaced, never where the new one is decoded: painting a detached bitmap throws inside rAF and kills the render loop — `studio.md`.
- A RAW yields its image slot to a sidecar JPEG of the same base name — the decodable half is what every tool wants to show, and listing order must not decide it — `architecture.md`, `studio.md`.
- A project is **intro · footage · closing card**: `ProjectDoc.outro` is a flat card of overlay elements (+ optional QR) the export keeps encoding after the footage — appended, never over it; audio ends with the footage; clean variants ship without it — `studio.md`.
- Road Trip's call to action crosses the bridge into that outro slot, same rules as the hook (prefix, replace, unlink); an outro the author composed themselves is never overwritten — `roadtrip.md`, `studio.md`.
- Anything added to a project's portable half must land in FOUR places: `ProjectPortable`, `toProjectFile`, `parseProjectFile` and `applyProjectFile` — the last was forgotten once and the gallery import silently dropped intros — `studio.md`.
- A tool that redirects from a route effect must first check the path is its own (`isWithinRoute`): a mounted tool still observes the hash after it has changed to another tool's, and redirecting then makes the switcher do nothing — `architecture.md`.
- A **source** is where projects, state and (later) scheduled work live — not a media pool. `local` is source #1 (File System Access + IndexedDB), a Winnow instance is its peer, and **a document belongs to exactly one source**: that limit is what removes sync and merge entirely. Built since phase 0.5: `shared/sources/source.ts`, `ProjectDoc.sourceId` (v14) and, since 2026-09-06, `TripDoc.sourceId` (v11) — both bound half, never in the portable file — and the studio gallery groups by source even with one group — `architecture.md`, `roadtrip.md`, `docs/winnow-bridge.md`.
- **Atelier is a client, never a host** — no backend, no database; persistent state lives in the browser or on a server the user owns. That is what makes multi-device, and later proactive features, possible without becoming a cloud — `docs/winnow-bridge.md`.
- **Atelier writes to a Winnow in two places only**: finals going HOME to the instance the media came from, and a document — a trip or a Studio project — kept there on request (the persistence bullets below). The finals go — one button after an export, the files just rendered, `original_asset_id` alongside so the link is exact, refused up front on a viewer account / a foreign clip / a file over the upload limit. Never to a third party, never automatic — `local-first.md`, `architecture.md`.
- Connecting a source and MANAGING it are one screen (`#/sources`, answering on `#/connect` too): a row per source with its health, its capabilities, the documents this browser holds from it, and its verbs, over a connect form. Opening it re-asks each instance and stores the answer, so a stale capabilities sheet is cured by the screen that reports it — `architecture.md`.
- Topology is **configuration, not a decision**: `SameSite` is judged on the SITE, so `atelier.steeve.website` ↔ `winnow.steeve.website` is cross-origin but *same-site* and the cookie travels with a CORS allowlist. A Bearer credential is only needed for a genuinely foreign instance — `docs/winnow-bridge.md`.
- Media identity resolves **id → hash → name**, and the hash is Winnow's `content_hash` recomputed locally (`shared/lib/partial-hash.ts`, fixtures pinned to Winnow) — so a project survives a rename and resolves the same file from a folder or from an instance — `studio.md`, `docs/winnow-bridge.md`.
- Winnow media previews on the **proxies** (H.264/AAC/faststart, so no ffmpeg.wasm; WebP for a RAW) and the Studio export **fetches the capture before the first variant**, with a checkbox to render from the proxy instead; a variant never upscales, so the panel states what it will really deliver — `studio.md`, `docs/winnow-bridge.md`.
- Both editor stages zoom the VIEW through one shared primitive, applied as LAYOUT size inside a scroll box (never a transform); ⌘/ctrl-wheel and a two-finger pinch, while a bare wheel keeps whatever the stage already used it for — and the box that primitive measures must never take its size from the picture inside it, or the zoom measures its own output — `frontend.md`.
- Looking at ONE picture is the OTHER zoom: ONE lightbox for every source (an instance's rows, the Library's own files), its deck a transform and not a scroll box because it must follow a finger past its own edges — fit to 8×, drag pans when zoomed and swipes when not, and a wheel gesture ends on 140ms of quiet — `frontend.md`.
- A modal is a full-screen sheet under 820px showing ONE pane at a time (drill-down, never a stack in a fixed height); `dvh` not `vh`, 16px controls so iOS does not zoom — `frontend.md`.
- A tool PUBLISHES what it can start from a picture (`MediaActions`) and the shell draws those verbs in the sheet showing it large; `run` is called with the media already in the library and ACTIVE, so no verb takes a media and none writes a ref. Road Trip's three are also the day panel's own buttons: one click makes the piece and opens it — `architecture.md`, `roadtrip.md`.
- A fetched file is dated at its **capture instant**, never at the moment it was copied (`captureMtime`): `lastModified` is what every date fallback in the suite reads — `architecture.md`.
- A Winnow asset enters the library **fetched and wrapped as a `File`** (proxy by default, original on request, `.srt` alongside), vouched for with the original's hash — never streamed by URL, never hashed on its own bytes; connecting is the user's click on `#/connect`, and nothing runs at boot — `architecture.md`, `local-first.md`.
- A remote picture lost to a reload is **re-fetched from the ref's own `assetId`**, never cached: a byte cache was offered and declined, and the document already says where its bytes live. Only a connected instance, only when a piece is opened — `architecture.md`, `local-first.md`.
- A Winnow **timeline chapter** and a Road Trip **stage** are the same object reached from two ends, so an import SEEDS stages and never posts, re-running it is a diff the author accepts leg by leg (never a sync), and Atelier writes back in Winnow's nouns only. The arithmetic is built and pure (`shared/roadtrip/timeline-import.ts`): a date that is not a calendar day is refused, never sliced; a title that is only the route stays an empty name; the diff matches id → span → first place so it survives re-clustering. The screens over it (`TimelineImportPanel`) tick adds and changes by default and never a drop; a timeline link names a HOST the shell resolves, never a URL it fetches — `roadtrip.md`, `docs/winnow-timeline.md`.

## Open items (dated; remove when done)

- 2026-08-20 — `scripts/gen-luts.mjs` tells the reader to add an entry to `src/lut/builtin-luts.ts` after regenerating. That path does not exist (it is `src/shared/lut/builtin-luts.ts` since phase 0) and the manual list it describes is gone — `builtin-luts.ts` now just reads the `virtual:luts` manifest. The comment is stale in both halves.
- 2026-08-20 — `index.html` loads Space Grotesk, Instrument Serif, JetBrains Mono and VT323 (added for the Pixel CRT title style) from Google Fonts on every page load, unconditionally, while the README's "one network exception" callout names only the opt-in map tiles. Either self-host the three faces (making the offline claim literal) or widen the callout — a maintainer call, since it is a product statement.
- 2026-08-20 — `tests/` holds only `fixtures/sample.srt`; all specs live beside their source in `src/**`. Fine as is, but a future agent should not read the empty-looking `tests/` directory as "there are no tests".
- 2026-08-21 — HLG footage is silently flattened to SDR instead of being flagged. The honest, cheap version is a notice, not a feature: `telemetry-summary.colorProfile` already carries the SRT's `color_md`, so the studio could say "this clip is HLG; we work in SDR" the way the battery gauge draws "—" rather than inventing a level. The maintainer has ruled out real HDR support (see `media-pipeline.md`); only the notice is open.
- 2026-08-21 — One latent defect left of the four surveyed: the 8-bit LUT fallback clamps LUT *output* to [0,1], destroying the shipped DJI cube's `#Not-Clipped.` highlight rolloff on a GPU without `OES_texture_float_linear`. **Measured on the maintainer's machine: the extension is present**, so this is dead code for him and the float path is always taken — do not re-propose it as a fix for his setup. It would also now be cheap, since the tetrahedral path uses `texelFetch` and needs no linear filtering; the cost is a second texture-format branch in `lut-gl.ts`, the file least visible to CI. The other three (shader ignoring `DOMAIN_MIN`/`DOMAIN_MAX`, mp4-muxer's silent matrix=0, the bake blocking the strength slider) are fixed — see `media-pipeline.md`.
- 2026-08-22 — Element timing is edited with number fields ("appears at / disappears at", plus From-playhead buttons). The natural follow-up the maintainer will want is a **lane under the TrimBar**, one draggable bar per timed element — the first thing that would make the studio feel like a timeline. Not started; the constraint to respect is that the bar splits into bands, never z-index (`studio.md`).
- 2026-08-22 — A **pre-roll / freeze-frame intro** (output longer than the source) was explicitly deferred, not rejected: the maintainer chose "over the images" for now. Half the mechanism exists since 2026-08-25 — the outro's appended tail (`export-tail.ts`) proves the encoder seam; what remains for a PRE-roll is the timestamp shift every existing frame would need.
- 2026-08-25 — The outro edits its lines as text inputs; **free element placement on a card stage of its own** (full intro parity: drag, style, animate on the card) is the agreed next step, deferred. The stage cannot scrub past the clip, so it needs a stage mode, not a longer timeline.
- 2026-09-02 — **Winnow's entry points into Atelier are undesigned.** An "Edit in Atelier" verb on an asset, a selection or a calendar day is the cheap half of the integration and the one that would make the bridge daily rather than merely functional — but the maintainer wants to think about the entry points properly rather than bolt a link on. Deferred deliberately, not forgotten. Note a local dev server cannot exercise any of it: `localhost` is cross-SITE to `winnow.steeve.website`, so the cookie cannot travel — testing needs the deployed pair, or a `winnow.localhost`-style same-site setup.
- 2026-09-03 (rev. 2026-09-06) — **Winnow's timeline has shipped; Atelier's client side of it is built and its READ path is now checked against Winnow's own code.** The brief is `docs/winnow-timeline.md`, whose status block carries the wire mapping key by key. All five phases are built (T0–T4). The first version was written against a GUESS and was wrong in every key — the route is `/api/assets/timeline`, a chapter is keyed `key`, named `name`, spans two INSTANTS with a `tz_offset_hours`, and lists bare place strings ordered by weight — so no chapter survived the boundary while every test passed against the guess, and `chapter_id` (a filter Winnow does not have, on a schema that strips unknown keys) silently listed the whole library instead of a leg. Fixed 2026-09-06: `chapterFromWire`, `localDayOf` and `chapterDays` in `client.ts`, verified in a browser against a stub. **What is still ASSUMED is only the write half**: `original_asset_id` and `chapter_id` in `client.upload`, which Winnow's upload route does not read. Chapters are **derived per request, ids not stable**, so `origin.chapterId` is the weak key and the diff's span/place fallback is the real path; `override_id` tells an authored leg from a computed one. Still Winnow's to do: those two upload fields, the "Make a Road Trip from this leg" verb pointing at `#/roadtrip/new?source=<host>&chapters=<id>`, and — noted 2026-09-09 — a **deep link that opens ONE asset in its viewer**, which no route offers today (the viewer is local state everywhere), so Atelier's "Open in Winnow" can only land on the media's session grid — `architecture.md`. `TripDoc.sourceId` — phase P0 of `docs/roadtrip-persistence.md` — landed here as **v11** (v10 went to the grade the same day); P0's gallery grouping and "Keep on" picker, P1 and P3 landed with the persistence branch (PR #71), P2 **landed on Winnow's `main`, was deployed, and the maintainer confirmed trips persisting on 2026-09-07** — the persistence is DONE end to end and `docs/roadtrip-persistence.md` is now a record, not a plan. Two localhosts are same-site, so the deployed pair was never required to test it: recipe in `testing.md`. The one gotcha that survives: a browser connected before the bucket shipped keeps a stale capabilities snapshot and hides the feature until `reconnect` — `roadtrip.md`.
- 2026-09-06 — **A piece takes the day's pictures straight from the instance** (`DayFromWinnow`, the Picture tab): the post's date is the query, one picture crosses per click, and it lands in the ordinary Library. That closes the two halves of the maintainer's report the re-fetch did not (picking the day by hand, and the pool keeping a day he had moved past). What is still open there: both surfaces take the FIRST connection — through one hook, `winnow/use-connection.ts`, so a second instance becomes reachable in one place, not two. The maintainer deferred multi-instance explicitly ("on verra ça après", 2026-09-07); the shape agreed for it is a tab per instance in the Library rail, with `useWinnowSource(id)` replacing the hook. **Removing a connection is no longer open**: `#/sources` lists, refreshes and forgets them since 2026-09-08 — `architecture.md`.
- 2026-09-07 — **The Library sidebar has two tabs, `Local` and the instance, and the instance's is a VIEW** — the maintainer's own design for what had become one pile: it lists what the instance holds for the span the active tool has open (`shared/sources/media-scope.tsx`: Road Trip publishes its piece's day or the overview's selected day; a `<input type="date">` when no tool says), asked live and re-asked when the span changes, so nothing accumulates and no clean button is needed. What a click fetches is an ordinary pool asset filed under that tab, never under Local (`shared/library/asset-source.ts` splits the pool by `mediaOrigin`). Day granularity for now; a stage/leg span is the next step and needs nothing remote — a stage carries its own two dates — `architecture.md`, `roadtrip.md`.
- 2026-09-09 — **A Road Trip piece whose hook is a PHOTO cannot leave as a video at all**, so an animated badge over a photograph plays only in the editor's transport. Not a regression: no still→video path has ever existed (`exportProcessedVideo` needs decoded samples; the Studio's photo branch delivers a JPEG). The header button removed by `5d11245` was the PNG deck's, not a video's. The analysis, the decision (Road Trip renders its own video through the suite's one pipeline, entry point #2, never a second exporter) and the five phases are in **`docs/roadtrip-export.md`**. The shape is the maintainer's and is settled: **a slide carries its own medium (`auto | image | video`) and its own duration, chosen where the piece is composed**, `deckSlides()` resolves `auto` for everyone, and the export only DELIVERS what the deck says — it keeps a combine tick and an images override, never a format decision. That supersedes an export-mode picker agreed hours earlier: the format belongs upstream because video content slides and animated content slides are both coming, and neither must cost a document change. Also taken: the header carries the piece's PRIMARY export (amending the `5d11245` rule — a tab's buttons are the escapes from it), and a mixed deck ships PNGs and MP4s together in swipe order. The Studio bridge's style loss is diagnosed in §8 and is his stated second step.
- 2026-09-09 — **A big photograph is still expensive everywhere the stage is not.** The stage now works to a pixel budget, but the still export and the frame grab build a grader the size of the whole bitmap (`photo-frame.ts`, `frame-grab.ts`), and the Studio keeps the decoded `ImageBitmap` at full size for as long as the photo is open — 194 MB for a 48-megapixel JPEG, before any export starts. Both are defensible (grading before the crop is a quality decision; the bitmap is what the export composes from) and both are untested on a phone, where the same arithmetic killed the tab. Measure an export on the maintainer's iPhone before deciding; the honest options are grading in bands, or re-decoding from the file at export time so the steady state is small.
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

Not memory files, but read them before starting new work, or before touching
anything about media sources or document storage:

- **`docs/roadmap.md`** — twelve proposed features (2026-09-07), each traced to
  the open item, deferred decision or stated direction it comes from, with its
  constraints, deliverables and size. **A proposal, not a set of decisions**:
  nothing in it has been agreed with the maintainer, so read it to find the next
  piece of work and its rules, never as an authority on what was chosen. It also
  carries a table of ideas deliberately left off, which duplicates no memory
  entry but points at them.
- **`docs/winnow-bridge.md`** — the agreed design for connecting Atelier to
  Winnow (the maintainer's media-triage project), the two adapter seams it rests
  on, and the phases. Verified 2026-08-29 against the Winnow repository itself
  (`~/Documents/GitHub/winnow`, `CostardRouge/winnow`), so its claims about both
  sides carry paths and can be re-checked; rewritten 2026-08-31 around the source
  model, with several instances and scheduling marked *later* but designed for.
  **Phases 0, 0.5 and 1 are built**; 2 (write-back) and 3 (remote documents) are
  not.
- **`docs/roadtrip-editor.md`** — the agreed plan (2026-09-06) to give the Road
  Trip piece editor the Studio's shape: six tabs instead of the 16-section
  accordion, click-to-select and block-drag on the badge stage, and **grading
  from Road Trip through the Studio's own engine** (`useLutStack` +
  `makeFrameGrader` + `exportVariantVideo` — no second exporter, which is what
  the earlier rejection was actually about). Four phases, one commit each.
  **All four phases are built (2026-09-06)**; the decisions they fixed are in
  `roadtrip.md`. Unverified in the container: the hook clip's graded encode
  (no H.264 encoder here) — the PNG deck and the preview were checked.
- **`docs/roadtrip-export.md`** — what a Road Trip piece can and cannot deliver
  (2026-09-09), and the plan to make an animated piece leave as a video from
  Road Trip itself. **A proposal, not a set of decisions**: §2–§3 are traced to
  files and are fact, §4 onwards awaits the maintainer, and §9 lists the four
  choices to make first. Read it before touching `use-post-exports.ts`,
  `deck-export.ts`, `hook-video*.ts` or anything that encodes frames without a
  source clip.
- **`docs/winnow-timeline.md`** — what Winnow's forthcoming timeline (media
  grouped into chapters by place and date) means for Atelier: the chapter ↔ stage
  mapping, ingesting by chapter, seeding and completing a Road Trip, the finals
  going home, and the list of questions to check the spec against. Written
  2026-09-03 from Atelier's side alone, so its Winnow claims are assumptions and
  are marked as such. **All five phases are built on Atelier's side (2026-09-06)**,
  verified against a stubbed instance only. **Winnow's timeline shipped the same
  day** and its chapters turn out to be derived per request (ids are not stable)
  — the brief's status block and §7.1–7.2 record what that changes.
- **`docs/roadtrip-persistence.md`** — the agreed design (2026-09-06) for
  keeping a Road Trip on a connected Winnow so it resumes from another device:
  bridge phase 3 applied to `TripDoc`. Four decisions are fixed there (local
  write unchanged + remote flush on idle with a status pill; a generic
  `kind: trip | project` bucket with trips first; own docs for any signed-in
  role, scoped by `user_id`, foreign rows 404; thumbnails re-baked, never
  uploaded), plus the security answer, the Winnow migration `0041` + route
  pair, and five phases. **All of them shipped, and the maintainer confirmed
  trips persisting on the deployed pair on 2026-09-07** — read it now for the
  four decisions and the security answer, not for a plan. Projects (P4) ride
  the same bucket. Never exercised: a network drop and a 401 mid-edit.
