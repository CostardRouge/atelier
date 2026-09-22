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
