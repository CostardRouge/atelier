# Atelier

A local-first **suite of browser tools for your captures** — photo and video,
across devices (DJI, Apple, Sony, …). Everything runs in your browser; files
never leave your machine — no upload, no account, no server.

Today it ships eight tools, converging into a single studio:

- **Studio** — the unified editor the suite is converging on. Opens on your
  **projects** (saved compositions with a baked preview); each project keeps
  its overlays, look and layout, remembers which folder its media lives in,
  and reopens in one click. Edit on one stage — overlays, LUT, export.
- **DJI Telemetry** — view DJI drone flight telemetry in sync with the video it
  was captured with.
- **Telemetry Overlay** — place altitude, GPS and exposure readouts anywhere on
  a DJI clip and export an MP4 with the telemetry burned in.
- **Flight Map** — trace a DJI clip's GPS path on a map and scrub the video to
  walk the aircraft along it (the base map is opt-in — see below).
- **Composer** — combine a clip, its flight map and a draggable telemetry
  readout into one framed composition (aspect, layout, LUT), preview it live,
  and export it to MP4.
- **Photo EXIF** — inspect a photo's metadata (camera, lens, the full exposure
  triplet and GPS location) read straight from the file — the photo counterpart
  to Telemetry.
- **Compare A/B** — lay any two photos or clips under a draggable before/after
  divider, with synced playback when both are clips.
- **LUT Studio** — preview and batch-apply `.cube` colour LUTs to your footage in
  real time, with a before/after wipe.

> **The one network exception.** Everything above runs offline and uploads
> nothing. The single feature that can make a network request is the Flight
> Map's *optional* base map: turning it on fetches map tiles from OpenStreetMap,
> which reveals the viewed area to that tile server. It's off by default — the
> flight path itself always draws locally.

Tools that consume the same kinds of files (photos, videos, DJI clips) share a
single **asset library**: import a folder once and switch tools freely — each
tool sees the subset it can use.

The suite is a tiny shell (`src/app/`) plus self-contained tools (`src/tools/*`)
that share a generic core (`src/shared/*`). The masthead nav and the routes both
derive from one **tool registry** (`src/app/tools.tsx`), so adding a tool is a
single registry entry plus its component. Navigation is hash-based
(`#/telemetry`, `#/lut`), which deep-links cleanly on static hosting.

## Studio tool

The destination of the whole suite: one editor instead of eight pages.

**Projects first.** `#/studio/home` is a gallery of saved projects — thumbnail
(baked at save time, so nothing decodes), aspect badge, duration, element and
file counts. Creating one goes through a small intro modal (name, destination
aspect, start-from-template, optional media folder). Everything you do in the
editor autosaves to IndexedDB, but **media is never copied**: a project stores
the folder's *handle* plus each file's name/size/mtime. Reopening re-lists the
folder after one permission click and reconciles it — found / changed /
missing — and missing media never blocks editing (a banner offers a re-point).
On browsers without the File System Access API (Firefox, Safari) the handle
can't persist, so reopening falls back to the same banner. A project is also a
template: "Use as template" duplicates its portable half (overlays, look,
guides, settings) with no media binding.

**The editor.** Pick a clip, place overlay elements on the canvas stage (drag
to position, anchors keep edge pinning), grade through a `.cube` LUT, scrub
with the shared transport. The inspector is tabbed (Overlay / Style / Grade /
Info / Export); tools run edge-to-edge so a landscape clip finally gets the
width it needs. Clips **without** an `.srt` are accepted: telemetry fields
read “—”, free text and the LUT still work. The stage, element model and
export come from the shared overlay engine (`src/shared/overlay/`) — the same
renderer draws the preview and the export, so what you place is exactly what
burns in. An **A/B** toggle on the transport wipes original against composed
(draggable divider, editor-only), a **shutter** button beside it saves the
frame under the playhead as a JPEG with the look and overlays burned in at
source resolution; the **Info** tab reads the clip's facts and the live
telemetry at the playhead; **project settings** (name, format) stay editable
from the project bar, DaVinci-style. Beyond telemetry fields and free text,
the overlay kit holds a heading arrow (with an optional compass ring),
**viewfinder brackets** for the frame's corners, and **clock/date** fields
read out of the flight log.

**The export matrix.** One press of Export can produce several deliverables:
each *variant* picks a frame (source or any destination preset — a landscape
master cover-crops into 9:16 with the overlays recomposed for that frame), a
delivery resolution (short-side 1080p/720p, never upscaled) and whether the
overlays burn in. Names follow automatically (`vol-9x16-1080p-clean.mp4` —
suffixes only where a variant departs from the source), the base name is
editable, and the whole matrix persists with the project (templates carry
it). Variants render sequentially with per-variant progress. Files land in
the browser's downloads by default, or — on Chromium — straight into a
**destination folder** you pick once, stills included.

**Title styles.** The Style tab adopts a named look as the project's theme —
*Or ciné* (optical-print gold serif), *Pixel CRT* (terminal red on phosphor),
*Rouge plein cadre* (flat saturated caps), or Neutral — then tweaks it: one
**glow slider** (matte → fluo) drives a four-layer film halation (softened
core, tight bright halo, wide warm-drifting bleed, animated grain — the grain
is phased from the media time, so preview and export are frame-identical),
with each layer hand-tunable in an advanced disclosure. Elements follow the
theme; editing an element's appearance pins just that property as an override
(marked ↺ — one click follows the theme again). Geometry never comes from the
theme: size is a multiplier, positions are untouched, so switching looks never
breaks a layout.

Next phase: the remaining tools become studio panels.

## Telemetry tool

When a DJI drone records, the memory card holds both the video (`.mp4`) and a
same-named `.srt` file. That `.srt` is **not** subtitle text — it's per-frame
flight telemetry (altitude, GPS, camera settings) encoded in the SubRip format.
The tool plays the video and shows the telemetry for the currently displayed
frame, synchronized frame-by-frame.

The `.srt` records *where* the aircraft was, not how fast it was moving, so the
tool reconstructs the missing motion from successive GPS fixes: **ground speed**
(horizontal), **vertical speed** (climb/descent) and **heading** (course over
ground, with a compass point). These appear alongside the raw fields in the
Flight panel and the live gallery readout, and can be burned in with the
Telemetry Overlay tool.

### Usage

1. Open the app (the Telemetry tool is the default).
2. Give it your footage — two ways in, your choice:
   - **Just the files**: a single `.mp4` and its `.srt`. Click the drop zone (or
     "Choose files") and select them.
   - **A whole folder** from your DJI memory card ("choose a folder").
   - Or **drag** either onto the drop zone. Videos are paired with their `.srt`
     siblings automatically.
3. Browse the gallery — each card plays its video inline **with its telemetry
   running live**: an altitude badge on the frame plus a readout (altitude, GPS,
   exposure) that follows playback. No click required to see the data.
4. Click **"Open full view"** on a card for the dedicated single-clip page: the
   large video plus the full Flight and Camera panels, synced to the displayed
   frame.

### Completing incomplete pairs

Loose files are welcome too — a `.mp4` with no `.srt`, or an `.srt` with no
video. Both appear in the gallery:

- A video with no telemetry shows an **"Add telemetry"** action.
- A telemetry file with no video shows an **"Add video"** action (its readout is
  already visible — the `.srt` is readable on its own).

The same actions appear in the full view. When you manually attach a file whose
name doesn't match the card (e.g. you pick `DJI_0099.SRT` for a `DJI_0001`
video), it is **attached anyway** — no friction — but a small, reversible
"names don't match" warning appears so an honest mistake doesn't go unnoticed.
Click **Remove** to undo.

### Choosing files — access paths

All converge on the same client-side pipeline; nothing is ever uploaded.

| Path | When | Browser support |
| --- | --- | --- |
| Individual file picker (`<input multiple>`) | one clip + its `.srt` | all |
| Native directory picker (`showDirectoryPicker`) | a folder, preferred | Chromium |
| `<input webkitdirectory>` folder dialog | a folder, fallback | Firefox, Safari, all |
| Drag-and-drop a folder or files | UX convenience | all |

Listing a folder is **instant even for dozens of multi-GB videos**: a `File` is
a lazy reference to the file on disk, so no video bytes are read just to list
them. The small `.srt` text files are read lazily (per card, as it scrolls into
view) to build the telemetry summary.

## LUT Studio tool

Add a collection of clips, pick a `.cube` look, and preview the grade in real
time on a WebGL canvas — with a Lightroom/Capture One-style before/after wipe.
Batch-export graded copies (H.264 via WebCodecs). The built-in LUTs live in
`public/luts/` and are discovered at build time, grouped by sub-folder
(apple/dji/sony/classic). See [`public/luts/README.md`](./public/luts/README.md)
to add your own — just drop a `.cube` in, no code to edit.

### Online

Deployed via GitHub Pages at `https://costardrouge.github.io/atelier/`.

> Base path: `vite.config.ts` derives the Pages base path from the repository
> name (via `GITHUB_REPOSITORY` in CI, falling back to `atelier` locally), so a
> repo rename can't 404 the assets. Override with the `BASE_PATH` env var — e.g.
> `/` when serving from a custom domain.

### Local development

```bash
npm install
npm run dev        # start the dev server
npm test           # run the unit tests
npm run typecheck  # type-check without emitting
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Photo EXIF tool

The photo counterpart to Telemetry: select photos in the library and read their
embedded metadata — camera body, lens, the exposure triplet (shutter, aperture,
ISO), exposure bias, focal length, and GPS location (with a one-click
OpenStreetMap link, opened only when *you* click it). The gallery shows a
camera/exposure line per photo; the full view lays out Camera, Exposure, Image
and Location panels beside a large preview.

EXIF is read straight from the bytes by a small **dependency-free parser**
(`exif-parser.ts`): it walks the JPEG `APP1` segment, or — since DNG and most
camera RAW begin with a TIFF header — the TIFF IFDs directly, so **RAW files
report their settings even when the browser can't decode a preview**. Only the
first 256 KB of each file is read, lazily as a card scrolls into view, and every
offset is bounds-checked so a truncated read just drops the fields it can't
reach. The parser and the value formatters are pure and unit-tested, including a
hand-built TIFF fixture and the GPS DMS-to-decimal conversion.

## Flight Map tool

Plots a DJI clip's GPS track on a map and moves a marker along it as the video
plays or scrubs — the spatial counterpart to the Telemetry tool, reading the
**same parsed cues**. The marker is driven by the very same `useActiveCue` hook
the Telemetry panels use, so it stays frame-accurate.

The path always draws **offline**: MapLibre renders the track line on a plain
backdrop with no tiles, so nothing leaves the machine. A **"Load map
background"** toggle adds an OpenStreetMap raster layer on demand — the only
thing in the suite that makes a network request, surfaced explicitly because it
reveals the viewed area to the tile server.

MapLibre is a heavier dependency, so it's **dynamically imported** (JS *and*
CSS): it stays out of the main bundle and downloads only when you open this
tool. The cue-to-track extraction (filtering null-island fixes, bounds, line
coordinates) is pure and unit-tested; the map glue lives in `use-flight-map.ts`.

## Composer tool

Brings the suite's pieces together: a DJI clip, its **flight map**, and a
**draggable telemetry readout**, composited into one framed video. Pick the
output **aspect** (16:9, 9:16, 1:1, 4:5) and **resolution**, a **layout** (video
and map side-by-side, stacked, or one inset over the other), per-pane
**object-fit** (cover/contain), and a **LUT** for the footage; drag the readout
anywhere; then **play/pause** to preview the whole assembly in real time.

The map can **fit the whole track** or **follow the aircraft** (centred, panning
with it as the clip plays), with a zoom-offset slider on top of the auto-fit.
The readout is fully configurable — which fields show, label prefixes, text and
background colour/opacity, corner radius, font and size — and can be toggled off.

It's a single `<canvas>` compositor: each frame draws the (LUT-graded) video and
the map's WebGL canvas into their computed panes, then the readout on top. The
map runs as a non-interactive MapLibre instance with `preserveDrawingBuffer` so
its canvas can be composited, and its marker is a GL layer (a DOM marker
wouldn't be captured). The pane/object-fit geometry (`compose-layout.ts`) and the
readout model (`overlay.ts`) are pure and unit-tested.

**MP4 export** reuses the shared WebCodecs pipeline (`exportProcessedVideo`) with
an `outputSize` set to the composition frame, and a processor that draws each
decoded frame's composite exactly as the preview does — the same
`compose-layout`, `draw-readout` and frame-grader. Since that per-frame draw is
synchronous, the map can't be re-rendered per frame: instead a full-resolution
export map is built once, framed to the whole track, rendered, and **snapshotted**;
each frame draws that snapshot and places the aircraft marker via `map.project()`.
Audio is copied through untouched. HEVC that the browser can't decode surfaces a
clear message (no seek fallback yet).

## Compare A/B tool

The LUT before/after wipe, generalised to **two different files**. Pick any two
photos or clips from the library and drag a divider across the stage — A on the
left, B on the right. Where the LUT wipe runs one source through a shader split,
this layers two media and clips the top one with a `clip-path` inset, so it
compares two distinct grades, two takes, or a retouch against its original.

When both sides are clips, a single transport drives them together: play/pause
and scrub seek both, and a light drift-correction keeps the follower locked to
the leader, so two exports of the same shot line up frame-for-frame. Only the
two compared files are ever decoded; nothing uploads. The wipe maths and the
A/B pair reconciliation (keeping a valid pair as the selection changes) are
pure and unit-tested.

## HEVC / H.265 footage

Recent DJI drones often record in **HEVC / H.265**, which not every browser
decodes natively (Chrome's support is inconsistent depending on the OS; Safari
handles it best). When a clip can't be decoded it shows as a black frame with a
**"playback unavailable"** placeholder, and any export that relies on decoding it
would fail.

**The fix is built in.** A **"Transcode to H.264"** button appears on every clip
the browser can't decode — in the gallery, LUT Studio and Telemetry Overlay. It
runs a real ffmpeg, compiled to WebAssembly, **entirely on your machine**
(nothing uploads) and rewrites the clip to H.264. Once it finishes, that clip
plays, grades and exports everywhere like any other. The ~31 MB ffmpeg core is
fetched once, on first use, from a CDN and then cached by the browser;
transcoding is CPU-bound and slower than real time, so it's opt-in per clip.

Notes:

- **Telemetry never needed this** — the `.srt` is plain text, so the summary and
  the synced view work even before (or without) a transcode.
- The alternatives still apply: open the clip in Safari (the most reliable HEVC
  decoder), or transcode on the command line, e.g.
  `ffmpeg -i in.mp4 -c:v libx264 out.mp4`.
- A future native app (Tauri) will bundle ffmpeg for guaranteed decoding and
  real thumbnails without the in-browser download.

## Architecture

The suite is organised so that **`shared/` never imports `tools/`**: generic
building blocks know nothing about any specific tool, and each tool is
self-contained. Pure logic lives in `*/lib`-style modules — **dependency-free,
DOM-free** — so it's reusable as-is (Node, a worker, a future native app). The
**only** brick that changes for a native shell is `shared/sources/file-sources.ts`.

```
src/
├── app/                        # the shell + tool wiring
│   ├── App.tsx                 # masthead + active tool + footer, all from the registry
│   ├── tools.tsx               # the tool registry (nav + routes derive from it)
│   ├── ErrorBoundary.tsx       # a tool crash shows a recoverable panel, not a blank app
│   ├── Home.tsx · ToolSwitcher.tsx · AssetSidebar.tsx
│   ├── use-hash-route.ts       # minimal hash router (useSyncExternalStore)
│   └── site.ts                 # site-wide constants (repo URL)
├── shared/                     # generic, tool-agnostic — never imports tools/
│   ├── lib/                    # pure: format, cube-parser, use-in-viewport (+ tests)
│   ├── library/                # the shared asset library: group files into assets
│   │                           #   (incl. DJI video↔SRT pairing), capability-match per tool
│   ├── telemetry/              # SRT parser, motion, cue lookup, flight-path extraction
│   ├── overlay/                # the overlay engine: element model, canvas stage,
│   │                           #   draw/measure/hit-test, fonts, guides, burn-in export,
│   │                           #   and the ElementList/ElementPanel/GuidesControl editors
│   ├── lut/                    # WebGL2 LUT renderer, frame grader, picker, built-ins
│   ├── map/track-map.ts        # the one MapLibre track-map: style, line layer, OSM tiles
│   ├── media/                  # metadata, transcode, WebCodecs export, transport/object-URL
│   │                           #   hooks, export-path decision, download/naming
│   ├── projects/               # studio project documents: types, media reconciliation,
│   │                           #   IndexedDB store (handles + thumbnails persist; media never)
│   └── sources/                # file-sources (read, incl. persistable directory handles)
│                               #   + write-files (export to folder)
├── tools/
│   ├── studio/                 # the unified editor: project gallery + creation modal +
│   │                           #   autosaving editor (stage, tabbed inspector, export)
│   ├── telemetry/              # DJI flight-log viewer (the original tool)
│   │   └── TelemetryTool.tsx · DetailView.tsx · Gallery.tsx · VideoCard.tsx
│   ├── overlay/                # the Telemetry Overlay page (engine lives in shared/overlay)
│   ├── exif/                   # read photo EXIF (camera, lens, exposure, GPS)
│   │   ├── exif-parser.ts      # dependency-free JPEG/TIFF EXIF reader
│   │   ├── exif-format.ts      # pure value formatters (shutter, f-stop, GPS…)
│   │   ├── use-exif.ts         # lazily read + parse a file's leading bytes
│   │   └── ExifTool.tsx · Gallery.tsx · PhotoCard.tsx · DetailView.tsx
│   ├── compare/                # A/B before/after wipe over two media
│   │   ├── compare.ts          # pure: clamp, clip-path inset, pair reconcile
│   │   └── CompareTool.tsx     # layered stage + divider + synced transport
│   ├── map/                    # GPS flight path on a map (MapLibre)
│   │   ├── use-flight-map.ts   # lazily-imported MapLibre map + marker + tiles
│   │   └── MapTool.tsx         # clip switcher + map stage + synced video
│   ├── composer/               # video + map + telemetry → one composition
│   │   ├── compose-layout.ts   # pure: pane rects, object-fit, output size
│   │   ├── use-composer-map.ts # MapLibre map for compositing (GL marker)
│   │   └── ComposerTool.tsx    # canvas compositor + live preview
│   └── lut/                    # colour grading (generic, multi-device LUTs)
│       ├── LutStudio.tsx
│       ├── export-video.ts · batch-export.ts · clip.ts
│       └── use-lut-preview.ts
├── index.css
└── main.tsx
```

Adding a tool: create `src/tools/<tool>/<Tool>.tsx`, then add one entry to
`TOOLS` in `src/app/tools.tsx`. The nav, the route, and the optional full-height
frame all follow from that entry.

### Notable implementation details (Telemetry)

- **Parsing the double-bracket field.** Most fields are one bracket each
  (`[iso: 100]`), but altitude packs two pairs into one bracket
  (`[rel_alt: 35.200 abs_alt: 80.196]`). Rather than assume "one bracket = one
  field", the parser extracts the inner content of *all* brackets, joins it, and
  sweeps with a global `key: value` regex — handling both shapes uniformly.
  This is covered by an anti-regression test.
- **Reconstructed motion (speed & heading).** Raw telemetry has position but no
  velocity, so `motion.ts` differences each cue against the most recent one at
  least ~1 s older (a binary-search look-back), giving ground speed (haversine
  distance ÷ time), signed vertical speed, and a course-over-ground heading.
  The window matters: GPS only refreshes a few times a second, so differencing
  adjacent 60 fps frames would flicker `0 → 45 → 0`; the window spans several
  fixes for a stable readout. Heading is suppressed while hovering (movement
  below the GPS-noise floor), where "direction of travel" is meaningless. Pure
  and unit-tested, so the same values feed the panels, the gallery and the
  overlay export.
- **Frame-accurate sync, shared once.** The `useActiveCue` hook uses
  `video.requestVideoFrameCallback()` and reads `metadata.mediaTime` (the exact
  presentation time of the displayed frame), falling back to the `timeupdate`
  event + `video.currentTime` on browsers that don't support it. Both the gallery
  cards and the detail player use this one hook — the live readout is identical
  everywhere.
- **Efficient cue lookup.** A 5-minute 60 fps clip is ~18 000 cues, so lookups
  use binary search (last cue with `start <= t`), never a linear scan.
- **No memory leaks.** Object URLs created for the video are revoked when the
  file changes or the component unmounts — never 50 URLs held open at once.
- **Lazy gallery, live telemetry.** Each card uses an `IntersectionObserver`;
  the video object URL, duration, and SRT parse only happen once the card scrolls
  into view.
- **Pairing is pure and tested.** `pairFiles` groups by base name
  case-insensitively and keeps any group that has a video *or* an SRT. Junk
  (`.LRF`, `.THM`, hidden files) is ignored.

### Other telemetry formats

Only the modern DJI "bracket" format is supported today. Older models (Mavic,
etc.) use a different layout (`GPS(...)`, `BAROMETER:...`). The parser keeps
format detection explicit so additional formats can be plugged in later without
rewriting the entry point.
