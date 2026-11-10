# Performance audit — 2026-11-10

His report: Recap's **Trip card** made the whole interface lag. Once that was fixed (PR #459), his ask: «refaire une passe sur les autres instruments … penser que l'application est utilisée sur un téléphone, sur une tablette … qu'on est sur du JS … retenir toutes les leçons et en faire des règles».

Three read-only audits ran over the whole tree: re-renders per frame, resources that outlive their use, and heavy work in render paths. Each finding below was re-checked on disk before it was acted on. The fixes were MEASURED with `scripts/check-perf.mjs` (headless Chromium; `THROTTLE=4` ≈ a phone) or a node benchmark on the shipped data. The rules that came out of it are in `docs/memory/performance.md`, with the checklist for a new instrument.

Status: **fixed** (the commit), **open** (with the fix in one line), **not reproduced** (the audit's claim did not survive a measurement).

## 1. Re-renders per frame

| Where | Finding | Status |
| --- | --- | --- |
| Recap | `OpenerSection` handed an inline `change`, so `OpenerPanel`'s memo broke every frame: the Trip card's panel planned its road and repainted six faces per frame | **fixed** `2b49a38` (#459: the brick reads its host through a ref, `panel-host.ts`) |
| Recap | `setT`/`setPage` in the rAF loop re-rendered the 1 200-line editor 62×/s | **fixed** `369e162` (`PlayClock`, `useClockPaint`, `useClockSelect`): 434 → 46 ms of script/s, root 60 → 0 renders/s |
| Recap | `pictures.still` was a new function every render: the strip repainted every slide and the poster re-armed after any click | **fixed** `b8c3cde` |
| Recap | `FrameBox`'s paint keyed on an inline `frameSource` | **mitigated** by `369e162` (the editor no longer renders per frame); **open**: key it on the source's identity |
| Recap | ~40 command specs rebuilt per render (`use-recap-commands.ts`) | **mitigated** by `369e162`; **open** (cheap) |
| Trips | The piece editor set `still` per frame (`use-deck-transport.ts`) and `playhead` per video frame (`BadgeStage` `onTime`): the 3 000-line `PostEditor` re-rendered 60×/s (`check-perf` trips-viree: root 60.5/s, ~160–250 ms of script/s) | **fixed** in the second pass (the deck's clock; `BadgeStage`'s `live`, the band in `ClockValue`): root 0/s, ×4 p50 33 → 16.7 ms |
| Trips | `normaliseFraming(cell.framing)` fresh per render → every motion card repainted per frame (B2) | **fixed** `599a0d8` (not measured: needs a picture with EXIF) |
| Trips | `readPlateSpec` fresh `fields` → eight camera layout tiles re-laid and repainted per frame (B3) | **fixed** `599a0d8` (same) |
| Trips | `LookTab` hands `layers={[...layers]}` and inline hop callbacks | **covered** by `HookPicker`'s ref and `OpenerPanel`'s own (`2b49a38`) |
| Composer, Map | `useActiveCue` sets state per presented video frame (a DJI SRT has a cue per frame): the whole tool re-renders 30–60×/s while playing | **open**: the cue in a ref for the painter, React state only at ~10 Hz or on what the panels show |
| Develop | The making-of sheet sets `t` per frame; `captions ?? {}` busts its script memo | **open** (cheap: a module-level empty object, the time in a clock) |
| Studio | The whole editor at ~4 Hz (`timeupdate`) | **open**, low |
| Storytelling, Flight Atlas, Mosaic, Develop's picture | Already right: time outside React, the stage paints itself | **the model** |

## 2. Resources that outlive their use

| Where | Finding | Status |
| --- | --- | --- |
| ffmpeg.wasm | Kept for the session (wasm memory never shrinks), files left in its FS on failure, core blob URLs (~31 MB) never revoked, again per cancel | **fixed** `652d955` (`shared/lib/idle-release.ts`, files freed in `finally`, URLs revoked) |
| Converted clips | `transcodeStore` kept every H.264 copy until the Library was cleared | **fixed** `ecafa65` (forgotten with their asset); **open**: a byte ceiling |
| Subject model | MediaPipe worker (wasm, tflite, a GPU delegate's WebGL context, the last picture) kept for the page | **fixed** `732b097` (rests 15 s on a phone, 3 min elsewhere) |
| Flight Atlas | Every log's text held in `sessionLogs` for the tab, stored or not | **fixed** `748f8c9`; **open**: `parsed` grows per `log|name` (an LRU) |
| Storytelling | Map grounds (20–40 MB a key) never evicted, a key per tone or route edit | **fixed** `b4a6803` (2 on a phone, 6 elsewhere) |
| Trips collage | A cell's grader (a WebGL context, ~100 MB at a phone's budget) kept after its cell left | **fixed** `e769e14` (not measured: needs looks per cell) |
| LUT tool | The preview's renderer rebuilt on a React `<canvas>` whose context `dispose()` lost: shaders failed, the preview drew BLACK after a clip switch (from the first clip under StrictMode) | **fixed** `8c2d1fc` (the hook owns its canvas); reproduced and checked headless |
| Composer | Loop drew every frame while paused; a WebGL grader rebuilt per step of the strength slider | **fixed** `43a01f2` + `d782ae3`: paused 125 → 1 ms of script/s |
| Recap clips | One `<video preload="auto">` + blob URL per clip key, kept until the editor closes even when the clip left the recap | **open**: release `held` entries whose key left `keysKey` |
| Storytelling wall and prints | Bitmaps dropped without `close()`; `loadPrints` decodes every id at once; module globals kept after leaving | **open**: close in cleanup and on abort, cap at 6, clear on unmount |
| Flight logs (Winnow picker) | Up to 600 SRT files held, by count | **open**: a byte ceiling (`held-budget.ts`) |
| Audition sheet | Graders keyed by size only (a stale look after a look change), graded URLs kept for every picture visited | **open**: key by look + size, keep ~3 neighbours |
| Mosaic | Evicted bitmaps dropped, never closed (Safari collects late) | **open**: close after a delay, as `use-hook-pictures.ts` does |
| Profiles, calibrations | Per-RAW caches unbounded (~120 KB each; a 500-RAW export ≈ 60 MB) | **open**: an LRU of ~32 |
| Composer export | `map.once('load')` with no timeout: a style that never loads hangs the export and leaks its map | **open**: `deadline()` from `lib/abortable.ts` and listen for `error` |
| Video frame helpers | `video-frames.ts`, `badge-render.ts` wait for `loadedmetadata`/`seeked` with no timeout | **open**: the timeout pattern of `use-hook-pictures.ts`'s `clipFrame` |
| Library covers, bridge, LUT failure paths | A cover URL lost in a race; a `hashchange` listener added per reconnect; a context kept on a shader failure | **open**, small |

## 3. Heavy work in render paths

| Where | Finding | Status |
| --- | --- | --- |
| Trip card faces | `townsWithin` scanned 130 000 towns per stop, six thumbnails per change | **fixed** `2b49a38` (#459): a face pick 1.3–2.2 s → 150–270 ms at CPU ×4 |
| Gazetteer | `nearestCity` (Winnow statistics: up to 20 000 rows; a deduction's legs; a Develop export's pictures) and `homonyms` (every trip edit, two component bodies) scanned the whole index | **fixed** `f8bab48`: 1.28 → 0.012 ms and 22.5 → 0.002 ms a call |
| Recap blurred ground | Re-ranked the pool and ran a full-page `blur` every frame | **fixed** `0162b67`: 25 → 48 fps at CPU ×4 |
| Trips, each edit | Every opener prepared ~2K+3 times per keystroke (`deckSlides`, the rail's thumbnails JSON-stringified, the open slide), each Virée prepare planning the drive and baking its camera | **open** — the largest edit-time cost left: a cache on `variant.prepare` by (variant, options, ctx inputs), `hookStages`/`hookContextFor` by `trip.stages` identity |
| Trips, Virée's pins | `parts()` plans the whole drive per paint | **not reproduced** while playing (pins are drawn at rest); left |
| Recap Layout tab | `hasStyle` → `readRecapDoc` of the whole pool + two `JSON.stringify` per render | **mitigated** by `369e162`; **open**: `useMemo` on `[doc, kept]` |
| Recap look-alike filter | O(n²) per `resolveRecap` (twice), again in `CarouselPanel` | **open**: compare within the `ALIKE_SECONDS` window after a sort; `factsOf` in a `WeakMap` |
| Itinerary, Virée, Trip card painters | Re-fit and re-project the whole road per frame (`mapFit`, `planBounds`, `path.points.map`) | **open**: bounds on the plan, one reused `Float32Array` |
| Vehicles, sea hops | One stop edited invalidates every hop's water reading; uncached `hopTerrain` scans whole coastlines | **open**: key each hop by its own endpoints; give `seaHops` `trip-hops.ts`'s cache |
| Recap painters | `new Map(doc.pictures)` per frame in `paintOpener`; a `Map` of slots per page per frame; cell words measured per frame | **open**: build each map once per doc; cache measurements per (layout, doc) |
| Storytelling badge | Seven looks, a `JSON.stringify` and a column fit per frame | **open**: cache by identity of (hook, look, series) |
| Trips `resolve()` | Walks the Library per render | **open**: a name → file `Map` on `lib.assets` |
| Vitrine riso, Develop roll selection, grouping, picture placing | Per-frame readback; O(selected × pictures); O(n²) grouping | **open**, smaller |
