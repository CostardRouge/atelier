# Testing

Read before writing tests, or before deciding where a piece of new logic should live.

## Vitest in a plain node environment — no jsdom (2026-08-20)

**Decision.** `vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/*.test.ts']`. There is no React plugin and no DOM emulation. **Why**: the suite tests the *pure* layer only; the React/canvas/WebGL glue is verified in the browser instead. **How to apply**: a `.test.tsx` or a test that needs `document` will not run under this config — that is a signal the logic under test is in the wrong module, not that the config needs changing. Extract the pure half (see `architecture.md`).

## What a pass BINDS is checkable in node, through a recording WebGL2 (2026-09-28)

The WebGL glue above is not all out of reach: a pass's `setUniforms(gl, program)` only calls methods, so a `Proxy` answering every UPPER_CASE key with a number (`TEXTUREn` as `TEXTURE0 + n`), recording `activeTexture` and `texImage2D`, and returning `{}` / `null` / the name for `createTexture` / `getExtension` / `getUniformLocation` shows which texels each unit receives (`recordingGl` in `develop/layer-render.test.ts`). **Why**: two builds of one shader that differ only in an uploaded map look identical to every other assertion — that is how a painted layer left every exported file blank while the render gate, which builds its passes itself, stayed green (`render-layers.md`). **How to apply**: when a caller hands a pass data the pass could also compute, pin the upload, and hold the delivery's upload to the stage's. Compare big maps with a loop, never `toEqual`, which took 8 s on one 700 000-texel map.

## Specs sit beside their source; `tests/` holds only fixtures (2026-08-20)

**Fact.** Every spec lives next to the module it covers (`src/**/<name>.test.ts`). The root `tests/` directory contains a single shared fixture, `tests/fixtures/sample.srt`, referenced by the telemetry and overlay specs through a `new URL(..., import.meta.url)` path. **How to apply**: do not read the near-empty `tests/` directory as "this project has no tests" — there are ~22 spec files under `src/`. New shared sample data goes in `tests/fixtures/`; new specs go beside their module.

## What is worth testing here (2026-08-20)

**Decision.** The tested surface is parsing and maths: SRT parsing, cue lookup, file pairing, reconstructed motion, EXIF parsing and formatting, `.cube` parsing, asset grouping, capability matching, export planning, verdict filtering, flight-path extraction, scope maths, compose layout, the readout model, overlay drawing and the export pipeline's plumbing. **Why**: these are the parts where a silent wrong number or a dropped file is invisible in the UI until much later. **How to apply**: new pure logic ships with its spec in the same commit. Anti-regression tests are used deliberately — the double-bracket telemetry field (`[rel_alt: … abs_alt: …]`) has one because the naive "one bracket = one field" reading looked right and was wrong.

## A screen over a remote source is checked against a stub, in the scratchpad (2026-09-06)

**Recipe that works in this container**, so it is not re-derived: `npm run dev -- --host 127.0.0.1 --port 5173` (base is `/atelier/`), `playwright-core` installed in the SCRATCHPAD (never the repo), launched with `executablePath: /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` — the full `chrome` binary refuses Playwright's old headless mode and exits. Seed a connection with `page.addInitScript` writing `atelier.sources.winnow.v1` (capabilities included, `media.timeline: true` for the timeline screens), stub the instance with `page.route('https://winnow.example/**')` answering JSON **with** `access-control-allow-origin: http://127.0.0.1:5173` and `access-control-allow-credentials: true` (the client sends `credentials: 'include'`, so a stub without them is a CORS failure that looks like "unreachable"), and assert on roles and visible text. `Failed to load resource` for Google Fonts is this container's network, not the app.

**Clips for a stub, and the Studio over one (2026-09-29).** This Chromium plays VP8 but has no H.264, so a stand-in proxy and rush are WebM. Playwright's own ffmpeg (`/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`) has no pipe protocol and no lavfi, only an MJPEG decoder and libvpx: draw the frames on a canvas in the headless browser (`toDataURL('image/jpeg')`), concatenate them into ONE `.mjpeg` file, then `-f image2pipe -c:v mjpeg -framerate 25 -i frames.mjpeg -c:v libvpx out.webm` — a clip with a real duration, where a `MediaRecorder` one says `Infinity`. Answer the instance with `context.route` (the CORS headers above; `OPTIONS` → 204), `/api/assets` with the rows, `/api/assets/<id>/{proxy,download,thumb}` with the files. Into the Studio: New project → Create project → `[title^="Look at <filename>"]` → *Add to library* → Escape. A Studio project does not re-fetch its Winnow media after a reload — re-add it from the tab. `mp4box`'s `[BoxParser] Invalid box type` on a WebM is the container probe, not the app.

## A RAW can be FAKED well enough to drive the UI (2026-09-20)

**Recipe, on top of the Playwright one above.** The RAW paths — the probe, the
embedded-render decode, the fidelity chip, the *Delivers* row — need no file of
the maintainer's: a RAW is a TIFF, and `probeRaw` reads IFDs, not pixels. Build
one in the page: little-endian header, IFD0 carrying only SubIFDs (tag 330) to
two offsets, a **sensor** SubIFD stating width/height plus compression 1 and
photometric **32803** (nothing has to be there — no pixel of it is ever read),
a **render** SubIFD stating its own width/height, compression 7, photometric 6
and `StripOffsets`/`StripByteCounts` pointing at a real canvas JPEG appended to
the buffer. `new File([buf], 'DJI_0101.DNG', { type: '' })` — the empty type is
what a RAW off a disk really has, and it is the case `pictureFidelity` tests
for. Stating an 8064 × 4536 sensor and a 960 × 540 render reproduces the
maintainer's own DJI measurement exactly, at 16 KB.

**Getting it in**: the library rail is COLLAPSED on a tool's gallery — click
`Expand asset library` (its `aria-label`) before looking for *Add files*, or
the locator simply times out. `page.addInitScript` takes a STRING as script
CONTENT, so a patch written as `() => {…}` is evaluated and never runs: wrap it
`(() => {…})()`. A synthetic `DragEvent` drop is NOT a substitute — the drop
path reads `webkitGetAsEntry`, which a hand-built `DataTransfer` does not
have; patch `HTMLInputElement.prototype.click` instead. Inside the editor, →
steps to the next picture once the rail is out of the way.

**A RAW LibRaw really DECODES can be built in the page too (2026-09-23)** —
for the sensor rung, the loupe and the export, where the probe's empty
sensor plane is not enough. IFD0 a 16 × 9 uncompressed RGB thumbnail with
the DNG identity (`DNGVersion` 1.4.0.0, `UniqueCameraModel`, `ColorMatrix1`
as nine SRATIONALs — sRGB's inverse ×10000 does —, `AsShotNeutral` 1/1 ×3,
`CalibrationIlluminant1` 21) and `SubIFDs` (330) to two IFDs: the SENSOR
(`NewSubfileType` 0, 16 bits, compression 1, photometric 32803,
`CFARepeatPatternDim` 2×2, `CFAPattern` 0 1 1 2, `CFAPlaneColor`,
`CFALayout` 1, `BlackLevel` 4096, `WhiteLevel` 65472, one strip of real
`Uint16` samples — a gradient with a clipped patch is enough) and the
RENDER (compression 7, photometric 6, a canvas JPEG). libraw-wasm 1.6 opens
it and hands back 16-bit RGB; 6000 × 4000 is 48 MB and decodes at half in a
couple of seconds under SwiftShader. Force the device class through
`localStorage['atelier.device']` in `addInitScript` to drive the phone path;
`page.workers().length` is how the decoder's lifecycle is read; a
`showDirectoryPicker` stub that keeps the blobs catches the export. The
rung menu is the button `What this picture is developed from`, its items
are named `DJI_0101.DNG → Gain` and the like, and the chip is uppercase on
screen — match `/16-bit/i`, not the source string.

## The deployed pair is NOT required: two localhosts are same-site (2026-09-07)

**Fact, measured.** `docs/roadtrip-persistence.md` §10 and several memory entries said the remote-document flow could only be exercised on `atelier.steeve.website` ↔ `winnow.steeve.website`, because `localhost` is cross-site to the deployed Winnow. True of THAT pair, and it hid the obvious: run **both** locally and the problem disappears. A cookie is scoped to a HOST, not an origin, so `127.0.0.1:5199` → `127.0.0.1:3000` is cross-origin but same-site, and Winnow's session cookie travels. Verified: `POST /api/auth/login` from the Atelier page, then `credentials: 'include'` on every bucket call, all the way to a 201.

**The recipe** (all of it in the scratchpad, nothing in either repo): bring up Winnow with `docker compose -f docker-compose.yml -f docker-compose.dev.yml -f <override> up -d app` — the override exists only to set `CORS_ALLOWED_ORIGINS` to the Atelier dev origin, which is absent from a normal `.env`, and **never edit the user's `.env` for a test**. The stack's own `migrate` service applies the migrations, so `npm run migrate` is genuinely exercised; do not hand-apply the SQL with `psql` first, because migrations are tracked by filename and a half-migrated database then re-runs files that are not all idempotent. `/api/auth/setup` bootstraps the first admin while `users` is empty — a throwaway fixture account, never a real credential. `docker compose down -v` afterwards removes every volume the test created.


## A touch gesture is driven, not guessed (2026-09-16)

**Recipe that works in this container**, on top of the scratchpad Playwright above. A context with `hasTouch: true, isMobile: true, viewport: 390×844`, then `context.newCDPSession(page)` and `Input.dispatchTouchEvent` (`touchStart` / `touchMove` × n with a few ms between them / `touchEnd`, whose `touchPoints` is empty) — Playwright's own `touchscreen` only taps. Add a **vertical drift** to every swipe: a perfectly horizontal finger is the one case a broken pan survives, and reading `event.cancelable` inside a `touchmove` listener tells you whether the browser has taken the gesture (it flips to `false` on the move it claims). `reducedMotion: 'reduce'` on the context is how a throw's absence is checked. **Seed a document without the UI**: `await import('/atelier/src/shared/roadtrip/trip-store.ts')` and its `trip-types.ts` in `page.evaluate`, `putTrip(createTripDoc(…))`, then set `location.hash` — a fresh context has an empty IndexedDB, so this is also how a second context gets the same fixture. Everything is in the scratchpad, nothing in the repo.

## The anchor probe: a picture that says where it is (2026-09-22)

**Recipe, measured in the desktop Browser pane.** To prove a zoom keeps the point under the hand still, use a picture whose pixels ENCODE their position: a 2000×1500 PNG drawn in-page (`R = x / w`, `G = y / h`, `B = 128`), wrapped as a `File` and dropped on the Library's dashed zone through a synthetic `DragEvent` with a `DataTransfer` (the Library's own input is transient, so a drop is the automatable door; the page reloads on some HMR edits and the Library empties — re-drop). Then, on a surface that draws through a 2D canvas (the crop stage, Trips' badge stage), `getImageData` at the probe point gives the source fraction to 1/255 directly, veil and shades aside (`B` says whether a shade tints the sample); on a surface that transforms an element (the viewport's canvas, the lightbox's `<img>`), `getBoundingClientRect()` of the transformed element plus its `object-contain` letterbox gives it to four decimals. Dispatch `WheelEvent`s (with `ctrlKey` for a trackpad pinch) and `PointerEvent`s with `pointerType: 'touch'` on the box the machine listens on — two ids for a pinch, moved in lockstep — and read the fraction before and after every step: it must not move once both axes have slack, and the FIRST step from the fit may move the letterbox axis. Counting undo steps after a burst (click the `(⌘Z)` button until it disables) is how coalescing is checked. What it found and how it reads is in `frontend.md`, «Two uses, one hand».

## Test fixtures can be hand-built binaries (2026-08-20)

**Fact.** The EXIF parser is tested against a hand-built TIFF fixture constructed in the spec, alongside the GPS DMS→decimal conversion. **How to apply**: a binary parser does not need a real camera file to be tested — build the minimal structure in the test.

## Real encodes in the desktop app's Browser pane (2026-09-13)

**Fact, measured.** Unlike the cloud container, the Claude desktop app's Browser pane (Chrome 152) encodes H.264 at 1080p and 4K, decodes HEVC and encodes AAC, so a whole export can be proven there without swapping codecs. **Recipe**, all in-page against `npm run dev`: import the pipeline by URL (`await import('/atelier/src/shared/roadtrip/hook-video-export.ts')`, mp4box from `/atelier/node_modules/.vite/deps/mp4box.js`); generate media with ffmpeg into `node_modules/.cache/<dir>/` (ignored, served by Vite at `/atelier/node_modules/.cache/...`); feed the Library by patching `HTMLInputElement.prototype.click` to set `files` from a `DataTransfer` and fire `change`, then press "Add files"; capture deliveries by replacing `window.showDirectoryPicker` with an object whose `getFileHandle().createWritable()` keeps the blobs (no download, no permission prompt); read results with mp4box (tracks, sample counts) plus a `<video>` seek for pixels and `decodeAudioData` for sound. **Traps**: a parallel session's save makes Vite FULL-RELOAD the tab and the in-memory Library empties — wrap `JSON.parse` to turn `full-reload`/`update` messages into a no-op custom event for the test tab; a test clip must have B-frames (`libx264 -bf 3`, ffmpeg's default) or the composition-delay bugs stay invisible; a luma-coded frame index saturates at both ends of the ramp, so assert on frames in the middle. A `vite preview` on another port starts with an empty IndexedDB (another origin) — not a shortcut. **A clean origin without touching the maintainer's data** (2026-09-13): his own dev server on `localhost:5173` holds his real trips and projects; `http://[::1]:5173/atelier/` is the SAME server under another origin, so it opens on an empty IndexedDB and a throwaway trip can be created, edited and left there. `127.0.0.1` is refused (the dev server binds `localhost` only).

## Drag and drop in the desktop Browser pane (2026-09-16)

**Recipe, measured.** A REAL HTML5 drag happens with `computer` `left_click_drag` (dragstart on the source, dragenter/dragover/drop on the target, types readable) — coordinates in the screenshot frame (800 wide for a 1440 emulated viewport: CSS × 800/innerWidth), and a screenshot must precede it after any navigation. It is a quick gesture: a target that only accepts on `dragover` refuses it (see `roadtrip.md`). To FREEZE a state for a screenshot, dispatch `new DragEvent('dragstart'|'dragover'|'drop'|'dragend', { dataTransfer, clientX, clientY, bubbles: true, cancelable: true })` with one shared `new DataTransfer()` — React's handlers run and `defaultPrevented` tells whether the drop was accepted. **Traps**: any `setDragImage` call makes the synthesized drag never land; a hash navigation to the same URL does not reload, so prototype patches and duplicated HMR modules survive — use `location.reload()`. **A Winnow instance without Winnow**: write a connection to `localStorage['atelier.sources.winnow.v1']` (`{id, baseUrl: 'https://winnow.test', auth: {mode: 'cookie'}, capabilities: null, connectedAt}`) and `atelier.library.tab = 'remote'`, reload, then replace `window.fetch` — `WinnowClient` reads `globalThis.fetch` at call time — answering `/api/assets` (`{assets: [row…], next_cursor: null}`, rows need `sidecars: []`) and `/api/assets/<id>/proxy` (a canvas `toBlob('image/webp')`, delayed to photograph the fetching state); click «ask again». Remove the key afterwards. Thumbnails stay blank (an `<img>` cannot be stubbed this way).

## Measuring a zoom in an ENCODED frame: bars, not a gradient (2026-09-23)

**Trap, measured.** The anchor probe's position-encoded gradient reads a stage exactly, but through H.264 it does not: a source clip that is itself compressed, then a ×2 zoom, leaves ~24 code values across the measured span, and ±2 codes of compression noise read as a zoom error — the SAME static frame measured 0.106 against 0.094, and a moving export looked wrong at 0.5 s and 1 s while every frame was right. Seeking a `<video>` adds its own imprecision on top. **How to apply**: to prove a per-frame framing on a clip, encode a target of two black bars on white (`VideoEncoder` + `mp4-muxer` in-page, as in «Real encodes»), read each frame where the pipeline draws it — a probe `hook` whose `paint(ctx, t)` scans one row for the dark runs, before the encoder — and compare the bars' spacing with `framingAt` at that `t`; a gradient is for a canvas, never for a decoded frame. Use the static-framing export as the control when a number looks off: if the control is off by the same amount, the measure is wrong, not the pipeline.

**Trap: `preview_start` reads the MAIN checkout's `.claude/launch.json`, not a worktree's.** A config added in a worktree is never seen (the tool answered with the main file's port 5173, in use by the maintainer's own server). Add a temporary entry to the main file whose `runtimeArgs` are `["--prefix", "<worktree>", "run", "dev", "--", "--port", "<free>", "--strictPort"]`, and restore that file afterwards — another port is another origin, so it opens on an empty IndexedDB and never touches his trips.

## A shared component mounted alone, over a clip made in the page (2026-09-29)

**Recipe, headless in this container** (the stub recipe's browser and dev
server): load `/atelier/` for the CSS, then in `page.evaluate` import the
component by URL (`/atelier/src/shared/develop/DevelopSheet.tsx`) and React by
the EXACT URL the transformed module imports — fetch the module's text and
read `/atelier/node_modules/.vite/deps/react.js?v=…` out of it; an import
without the `?v=` is a second React and every hook throws. `react-dom_client.js`
is CJS pre-bundled, so `createRoot` may sit on `.default`. Wrap in
`LayoutModeProvider` for the phone layout — without it `useIsCompact()` is
false at any width. There is no ffmpeg here: a clip is a canvas recorded by
`MediaRecorder` (`video/webm;codecs=vp8`), which headless Chromium decodes —
and whose `duration` is `Infinity` until played to its end. Draw something
that says WHEN it is (a bar crossing the frame) and read the stage canvas.

## The subject model runs headless (2026-10-02)

**Fact, measured**: MediaPipe's `InteractiveSegmenter` answers in this container's headless shell — its GPU delegate comes up on SwiftShader (`--enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist`, the console saying `OpenGL error checking is disabled`), a few seconds a point. So a Subject layer CAN be driven end to end here; "it needs a real GPU" was never true. **Recipe**, on the scratchpad Playwright above: `putRoll(createRollDoc(…))`, the hash `#/develop/<rollRef(roll)>`, two canvas-made JPEGs (a disc on grey) dropped on `div.relative.flex.flex-col.flex-1.min-h-0.gap-2`, the picture ids read back with `listRolls().find(…)` (the store has no `getRoll`; Playwright's `waitForFunction` with an ASYNC predicate resolved to `null` — poll with `evaluate`), the `Layers` tab, `+ Subject`, a click on the disc. A BLINK is read by sampling the 2D stage canvas `[aria-label="The picture, corrected"]` every 15 ms for R > 120 over a blue disc (the flash cube is 0.94/0.34/0.22 at 0.7); the picture is letterboxed in that canvas AND the canvas is `object-contain` in its box, so a mapping by `min(w/W, h/H)` alone is right at one window size and wrong at another (a tap at y 0.29 landed at 0.13 in a 1500 px window) — find the picture's rect by its PIXELS (everything brighter than the frame), then map canvas → client by the box's own contain scale (`bench.mjs` in the session scratchpad did both). The model's CALLS are counted by wrapping the singleton: `(await import('/atelier/src/shared/segment/segmenter.ts')).loadSegmenter()` and replacing `task.segment` on the instance — after the first tap, once it is loaded. The roll is SAVED on a debounce, so a value set through the panel is read back by polling `listRolls()` until it is the value set, never once (a single read after 600 ms returned the knob's state two changes earlier). A range slider is set with Playwright's `fill('0.95')` on `input[aria-label=…]`. An export's subject is checked without encoding: import `subject-rasters.ts` in the page and call `resolveSubjectRasters` on the roll's layers and a canvas of the scene — with a develop on the layer, since a delivery segments only subjects something DRAWS with.

## Clips through the Develop tool, and an export encoded here (2026-09-30)

**Recipe, headless in this container.** The SYSTEM `ffmpeg` (`/usr/bin/ffmpeg`, unlike Playwright's) has `lavfi` and `libvpx-vp9`: `-f lavfi -i testsrc2=size=640x360:rate=25:duration=4 -c:v libvpx proxy.webm` for a stand-in proxy, and `-c:v libvpx-vp9 -pix_fmt yuv420p -c:a aac -movflags +faststart rush.mp4` for a RUSH that mp4box demuxes and WebCodecs decodes here (VP9 in MP4), so the roll's clip export runs end to end — with the ENCODER swapped for the run: this Chromium has no H.264 encoder, so `webcodecs-export.ts` was patched locally to `codec: 'vp9'` on the muxer and `'vp09.00.10.08'` in place of `pickAvcCodec`, and reverted with `git checkout` before the commit. Seed the roll without the UI (`putRoll(addPictures(createRollDoc(…), [rowMediaRef(host, row)]))` through `/atelier/src/...` imports), stub `/api/assets/7`, `/proxy`, `/download`, `/thumb` with `context.route` and the CORS headers of the stub recipe, deliver into OPFS (`window.showDirectoryPicker = () => navigator.storage.getDirectory()`), and read the file back with a `<video>` for its frame, then `drawImage` at 1 s for a luminance against the source. A LOCAL clip is dropped by dispatching `dragover` + `drop` with a `DataTransfer` on any element inside the roll editor (the event bubbles to its root). Read the stage's luminance off the 2D canvas `[aria-label="The picture, corrected"]`; with A/B on, half of it is as shot, so a grade reads smaller there than in the file. The lone-file name is TEXT (`[title=name]`), a capture with rows is a `button[title=name]`. The crop stage's canvas has no label of its own: it is `div[aria-label^="Crop:"] canvas`; the Format segments are `[aria-label="Format"] button` pressed by text (`1:1`); the pinned export verb reads `Export this picture` or `Export N pictures`, so match `/^Export (1 |this )/`.
