# Local-first — the network, the filesystem, persistence

Read before adding anything that could touch the network, read files, or persist data. This is the project's defining constraint, not a preference.

## Nothing is uploaded, ever (2026-08-20)

**Decision.** Files are read in the browser through `File` handles and processed locally; there is no backend, no account, and no telemetry. Even the `ErrorBoundary` only logs to the console. **Why**: it is the product's whole premise (README, first paragraph) — the user's footage is private and often huge. **How to apply**: any proposal that sends bytes, filenames, or error reports off the machine is out of scope by default; if it seems unavoidable, ask the maintainer rather than implementing it.

## The network calls that *do* exist, and their status (2026-08-20)

**Fact**, traceable in the code — worth knowing before claiming "the app makes no requests":

- **OpenStreetMap raster tiles** (`tile.openstreetmap.org`, in `map/use-flight-map.ts` and `composer/map-shared.ts`) — the documented exception: off by default, opt-in per session, and it reveals the viewed area to the tile server. The flight path itself always draws on a tiles-free style.
- **ffmpeg.wasm core** (`unpkg.com/@ffmpeg/core`, pinned version, in `shared/media/transcode.ts`) — ~31 MB fetched on first transcode only, then browser-cached. Opt-in per clip.
- **Google Fonts** (`fonts.googleapis.com` / `fonts.gstatic.com`, linked in `index.html`) — fetched on every page load, unconditionally. Not mentioned in the README's "one network exception" callout; self-hosting the three faces would make the offline claim literal. Undecided — see the open item in `MEMORY.md`.
- **An OpenStreetMap map link** built by `exif/exif-format.ts` for a photo's GPS position — a plain `href`, opened only when the user clicks it.

**How to apply**: adding a fourth is a product decision, not an implementation detail. Anything new must be opt-in, off by default, and stated plainly in the UI and the README.

## Three file-access paths, one internal shape (2026-08-20)

**Decision.** `shared/sources/file-sources.ts` is declared the **only** brick that changes for a native shell: the Chromium `showDirectoryPicker`, the `<input webkitdirectory>` fallback (Firefox/Safari), the plain multi-file picker and drag-and-drop all converge on `Promise<File[]>`. **Why**: the rest of the pipeline should not know where files came from, so a Tauri build swaps one module. **How to apply**: keep new access paths behind the same shape; capability detection (`showDirectoryPicker` present?) belongs there, not in components. Writing back to disk uses the same File System Access capability check in `shared/sources/write-files.ts` (`pickWritableDirectory`, salvaged from the retired Cull tool for the studio's export-to-folder path).

## Persistence is deliberately minimal (2026-08-20)

**Decision (rev. 2026-08-21).** Only the sidebar collapse flag is stored (`localStorage`); cull verdicts left with the retired Cull tool. `File` handles are not persisted. **Why**: handles cannot survive a reload, and re-asking for the folder is honest about what the app can access. **How to apply**: storage failures must degrade silently to in-memory rather than throwing. Directory *handles* (unlike `File`s) are structured-cloneable and can persist in IndexedDB — the studio's phase-2 project model relies on this (see `studio.md`).

## A future native shell is an accepted direction, not a plan (2026-08-20)

**Fact.** The README states a future Tauri app would bundle ffmpeg for guaranteed decoding and real thumbnails, and the code is arranged for it (DOM-free logic, one file-access brick). Nothing is scheduled. **How to apply**: keep the arrangement; do not start the native shell without asking.
