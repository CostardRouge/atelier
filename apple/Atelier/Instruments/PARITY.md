# Instruments — parity with the web app

The web registry's `group: 'instrument'` pages (`src/app/tools.tsx`) —
`src/tools/{telemetry,overlay,map,composer,exif,compare,lut}/*` and the shared
pieces they compose — against this folder. ✅ built · ⏳ deferred (why, and
what it waits on) · ≠ built differently on purpose (why).

Nothing here was run on a device: this container has no Apple toolchain, so
every view was written against the SDK and compiled by CI alone.

## The shell (`InstrumentTool.swift`, `App/RootView.swift`)

| Web | Native | |
|---|---|---|
| Registry `group: 'editor' \| 'instrument'` | `ToolGroup`, `InstrumentTool.group` | ✅ |
| Label, subtitle and home-card blurb per instrument, in the registry's order | `InstrumentTool.title / subtitle / blurb`, word for word | ✅ |
| The tool menu's grouped list (editors, then instruments) | iPad-regular and the Mac: the sidebar's second section, *Instruments*; a phone: the fifth tab, *More*, a list of the same rows | ✅ |
| Each instrument's `accepts` | `InstrumentTool.accepts`, matched by the kernel's `usableAssets` | ✅ |
| The home page's instrument cards (eyebrow, name, blurb) | `InstrumentsHome` rows (the *More* page) | ✅ |
| Routes `#/telemetry`, `#/map`… | ≠ a sidebar selection or a pushed page; a place change resets its stack | ≠ |

## The Library, as the instruments read it (`InstrumentShelf.swift`, `InstrumentChrome.swift`)

| Web | Native | |
|---|---|---|
| ONE library for every tool, grouped by base name (`buildAssets`) | ONE shelf for the seven instruments, grouped by the kernel's `buildAssets`: a clip opened in DJI Telemetry is on the Flight Map and in the Composer too | ✅ |
| The library's shared focus (`lib.activeId`) | `InstrumentShelf.activeId`; stepping clips in one instrument moves the others | ✅ |
| Add files / a folder (File System Access), drag in | Files / the Finder (`fileImporter`, read in place under a security scope) and Photos (`PhotosPicker`, the original bytes copied into a temporary folder the shelf empties) | ✅ |
| The library's checkbox SELECTION narrows a tool's set | ≠ no selection: every usable file on the shelf is the set; *Remove from the instruments* (context menu) takes one off | ≠ |
| A repeated drop is deduped | same name + size + date ignored | ✅ |
| The library persists folder handles across reloads | ⏳ the shelf is a session's (the web's library of loose files is too); a folder remembered per launch waits on a native Library | ⏳ |
| `‹ 1/3 ›` clip stepper | `ClipStepper`, ⌘← / ⌘→ on the Mac | ✅ |
| Transport: play/pause (Space), position, scrub, length | `InstrumentTransport` | ✅ |
| The HEVC decode failure and its ffmpeg.wasm transcode control | ≠ none: the device decodes HEVC (`Video/VideoSource.swift`); a clip it refuses says the platform's own reason | ≠ |

## DJI Telemetry (`Telemetry/`)

| Web (`TelemetryTool.tsx`, `Gallery.tsx`, `VideoCard.tsx`, `DetailView.tsx`, `TelemetryPlayer.tsx`, `shared/telemetry/telemetry-view.tsx`) | Native | |
|---|---|---|
| Empty state: "Add your footage in the Library… Videos pair with their .srt siblings automatically." | the same sentence, the Library being the Open menu; From Files… / From Photos… | ✅ |
| Gallery: a grid of cards, `minmax(300px, 1fr)`, gap 24 | `LazyVGrid(.adaptive(minimum: 300))`, spacing 24 | ✅ |
| Card: `NO. 01` chip, the live `rel_alt` chip, name (ellipsis, title on hover), weight · length | ✅ — the length reads `…` until the container answers | ✅ |
| Card: the clip plays inline, the readout follows it | ≠ the card shows the clip's POSTER and the opening cue; playback is the full view's (a grid of players is what the web's "never hold 50 URLs open" rule was about) | ≠ |
| Card: no video → "No video for this telemetry yet." + Add video | ✅ | ✅ |
| Card: no `.srt` → "No .srt — telemetry unavailable." + Add telemetry | ✅ | ✅ |
| Card: live readout (Altitude headline, Speed · heading, GPS, Exposure) | `LiveTelemetryReadout` | ✅ |
| Card: "Reading telemetry…" / "Telemetry unreadable." | ✅ | ✅ |
| Card: frames · altitude range · colour profile line | ✅ plus the cadence tag of a conformed clip (`timeScaleTag`) | ✅ |
| Card verb: Open full view / Open telemetry / Open video | ✅ | ✅ |
| Name-mismatch notices ("⚠ Video name doesn't match … Remove") | ≠ unreachable on the web too: the library pairs by name, so a mismatched pair cannot be built | ≠ |
| Full view: ← Back to gallery | the navigation bar's back | ✅ |
| Full view: the file's name as a serif title | `Brand.display(34)` | ✅ |
| Full view: "No video for this telemetry yet. Add video" / "No telemetry for this video yet. Add telemetry (.srt)" | ✅ | ✅ |
| Full view: `<video controls>` | `VideoPlayer` (the system's controls) | ✅ |
| Full view: "Select a video file to begin." | ✅ | ✅ |
| Full view: the video failed to play (HEVC) + transcode | the platform's reason, then "The telemetry below still works if the SRT loaded." | ≠ |
| Full view: "No telemetry loaded yet — select the matching .srt file." | ✅ once the log is read and empty; "Telemetry unreadable." when it could not be read | ✅ |
| Flight panel: Rel. altitude (highlighted), Abs. altitude, Ground speed, Vertical speed, Heading, Latitude, Longitude, FrameCnt, Timestamp | ✅ — motion from the kernel's `motionAt` (measured backward, the opening window forward) | ✅ |
| Camera panel: ISO, Shutter, Aperture, EV, Focal length, Color profile, Color temp. | ✅ | ✅ |
| A missing value reads `—` | ✅ | ✅ |
| The cue under the playhead (`useActiveCue` → `cueAt`) | the kernel's `cueAt` at the player's clock, ~30 reads a second | ✅ |
| — | NATIVE: the log's summary line (frames · altitude range · profile · start fix) and its CADENCE said (`measureTimeScale`: "120 → 30 fps · 4× slow motion — speeds read per second of capture") | ✅ |
| — | NATIVE: a chart of the whole flight (Altitude · Speed · V/S, Swift Charts), the playhead drawn on it, a tap or drag seeks the clip; thinned to ≤ 600 real points, never interpolated | ✅ |
| — | NATIVE: every cue as a table (a `Table` with ten columns where there is room, a three-column list on a phone); picking a row seeks the clip | ✅ |
| Export CSV / GPX | the web has none, so neither does this page | — |

## Flight Map (`Map/`, kernel `Tools/TrackCamera.swift`)

| Web (`MapTool.tsx`, `use-flight-map.ts`, `shared/map/track-map.ts`) | Native | |
|---|---|---|
| Accepts `video+telemetry` and a loose `telemetry` | ✅ | ✅ |
| Empty bar: "Select a DJI clip (or a loose .srt) in the Library to map its flight." | "Open a DJI clip (or a loose .srt) to map its flight." — the Open menu is the Library | ✅ |
| Clip stepper, the clip's name, the active clip reflected back to the library | ✅ (the shelf's shared focus) | ✅ |
| The path from the `.srt` alone (`extractTrack`) | the kernel's `extractTrack` | ✅ |
| A tiles-free map by DEFAULT: paper `#e8e2d4`, the accent line 3 px round at 90 %, the aircraft a 14 px accent dot ringed in white | `TrackPainter` on a blank `Canvas`, the same fixed colours (a map is a picture, never themed) | ✅ |
| `fitBounds` with 48 px of padding up to zoom 17, a lone fix at zoom 16 | the kernel's `fitTrackCamera` (MapLibre's zoom scale, a 512 px world), specced | ✅ |
| MapLibre's NavigationControl (zoom in/out), drag to pan, wheel/pinch zoom | `+` / `−`, a pinch about the fingers, a drag once zoomed, a double tap to fit again — the kernel's `zoomAbout` / `clampView`, to 32× | ✅ |
| "Load map background" / "Map background: on" — OpenStreetMap tiles, OFF by default, per visit, the one network exception | the same chip and words, MapKit's tiles from Apple, OFF by default and never stored; the hint says "Loads map tiles from Apple — a network request, made only once you turn this on" | ≠ |
| "© OpenStreetMap contributors" while tiles are on | MapKit draws Apple's own legal mark | ≠ |
| "Offline · no tiles loaded" while off | ✅ | ✅ |
| The aircraft on the live cue's fix, else the path's start, never orphaned | ✅ | ✅ |
| "No GPS fixes in this clip's telemetry." | ✅ | ✅ |
| "The map library couldn't load." | ≠ nothing to load: the blank map is drawn by the app | ≠ |
| Live readout bottom-left: `lat, lon` to six decimals, `alt m · speed · heading` | ✅ | ✅ |
| The clip beneath with controls; scrubbing walks the aircraft | `VideoPlayer`; the cue under the playhead moves the dot | ✅ |
| "Telemetry only — add this clip's video to scrub along the path." | ✅ | ✅ |
| macOS sandbox | `com.apple.security.network.client` (already there for Sources) now names the map too — without it MapKit draws an empty grid | ✅ |

## Photo EXIF (`Exif/`, kernel `Tools/ExifFormat.swift`)

| Web (`ExifTool.tsx`, `Gallery.tsx`, `PhotoCard.tsx`, `DetailView.tsx`, `exif-view.tsx`, `exif-format.ts`, `use-exif.ts`) | Native | |
|---|---|---|
| Empty state: "Add your photos in the Library… EXIF is read straight from each file — JPEG and most RAW formats carry it" | "Open your photos, then inspect each one here. EXIF is read straight from each file — JPEG and most RAW formats carry it." + From Photos… / From Files… | ✅ |
| Photos pick | the ORIGINAL file (`preferredItemEncoding: .current`), never a re-encode that would drop the EXIF | ✅ |
| Only the head of each file is read (`EXIF_SLICE_BYTES`) | `exifSliceBytes` of the head, parsed by the kernel's `readEffectiveExif` | ✅ |
| A RAW and its JPEG are one photograph | the kernel's `buildAssets`; the full view says `+ DNG` for the other half (`siblingTypes`) | ✅ |
| Card: `NO. 01`, the GPS chip ("Geotagged"), 4:3 cover, name, type · weight | ✅ | ✅ |
| Card: "Reading EXIF…" / "No EXIF metadata." / body, exposure triplet, capture moment (never the file's date) · via the instance | ✅ | ✅ |
| Card: "RAW — preview unavailable (browser can't decode it)" | ≠ a RAW's preview is DRAWN (ImageIO reads the render inside it); "… — preview unavailable on this device" only when even that fails | ≠ |
| Card verb: View metadata | ✅ | ✅ |
| Full view: name as a serif title, type · weight | ✅ | ✅ |
| Full view: large preview beside the panels (one column under 820 px) | side by side where there is room, stacked on a phone | ✅ |
| "No EXIF metadata found in this file. Dimensions (if shown) come from the decoded image." | ✅ | ✅ |
| "This file is X's editing rendition and carries no EXIF of its own…" | ✅ the rule is kept; no source vouches for a file opened here yet, so it never shows | ✅ |
| The decoded size fills the Image panel where the EXIF says none | ✅ the size as SHOWN (a quarter-turn swaps the axes) | ✅ |
| Camera: Make, Model, Lens, Software, Artist | ✅ | ✅ |
| Exposure: Shutter, Aperture, ISO, Exposure bias, Focal length, 35 mm equiv., Program, Metering, White balance, Flash | ✅ — every formatter the kernel's port of `exif-format.ts`, its spec ported case for case | ✅ |
| Image: Dimensions, Orientation, Captured | ✅ | ✅ |
| Location: Coordinates, Altitude, "OpenStreetMap ↗" (a plain link, opened only by a click) | ✅ `Link` — the system opens it on the person's tap | ✅ |
| — | NATIVE: the GPS on a map, behind the SAME opt-in chip as every map (`BaseMapConsent`, off by default) | ✅ |
| — | NATIVE: a RAW panel from the kernel's `probeRaw` / `rawSizesFrom` on the first megabyte: Sensor (as shown), Sensor data (compression), Camera render (or "none embedded"), Calibration (`OpcodeList3`), Opcode lists | ✅ |
