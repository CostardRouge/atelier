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

## Compare A/B (`Compare/`, kernel `Tools/ComparePair.swift`)

| Web (`CompareTool.tsx`, `compare.ts`) | Native | |
|---|---|---|
| Accepts photos and clips (a clip wins over a picture on one asset — `resolveSide`) | ✅ | ✅ |
| Empty bar: "Select two photos or clips in the Library to compare." | "Open two photos or clips to compare." | ✅ |
| `A` · side select · ⇄ Swap A and B · side select · `B` | ✅ (`Picker`s, the swap disabled until both sides exist) | ✅ |
| The pair kept valid as the set changes: a lone item in A, the two sides never one (`reconcilePair`) | the kernel's port, its spec case for case | ✅ |
| Stage: A under, B over clipped to the RIGHT of the divider — before left, after right | ✅ a mask at the divider (`insetForSplit` ported for the record; the native stage masks by the fraction itself) | ✅ |
| The divider follows the pointer (`clamp01`) | a drag moves it on every device; on a Mac it also follows the hover, as the web's does | ✅ |
| Divider line + round grip, `A · name` / `B · name` labels | ✅ | ✅ |
| "Pick a second asset (B) to compare." | ✅ | ✅ |
| "Select two assets in the Library." / "Choose A and B above." | "Open two photos or clips." / "Choose A and B above." | ✅ |
| A clip that cannot decode (HEVC) / a RAW that cannot preview | "This clip can't be played on this device." / "This file can't be previewed on this device." — HEVC and a RAW's render both draw here | ≠ |
| Both clips muted | ✅ | ✅ |
| "synced playback": one transport drives both, B follows A's clock | `InstrumentTransport` over both players; B is seeked back when it drifts past 0.1 s | ✅ |
| — | NATIVE: a SYNCED zoom — both sides share one view (`UI/PanZoom.swift`): a pinch or a double tap looks closer at the same place of both; a drag that starts on the divider moves it, elsewhere it pans once zoomed; the zoom said in a chip | ✅ |
| Only the two compared files are decoded | ✅ a picture at the stage's budget (2560 px long edge) | ✅ |

## LUT Studio (`Lut/`, `InstrumentLook.swift`, `StageFrames.swift`)

| Web (`LutStudio.tsx`, `use-lut-preview.ts`, `batch-export.ts`, `export-video.ts`, `shared/lut/{LutPicker.tsx,use-lut-selection.ts}`) | Native | |
|---|---|---|
| Accepts clips | clips AND photos — a photo is previewed through the same graph; none is exported here (a photograph is delivered from Develop, and the bar says so) | ≠ |
| Look: "No LUT (original)", the built-in groups, "<name> (uploaded)" | "No LUT (original)" and the uploaded look | ✅ |
| The BUILT-IN looks (`public/luts/`, the `virtual:luts` manifest) | ⏳ not bundled: 29 files, 37 MB (Sony 20 MB, DJI 12 MB, Apple 5.4 MB, classic 160 kB) — a subset, all of it or a fetch on demand is the maintainer's call (`apple/README.md`, the Looks row; the kernel's `BuiltinLuts.swift` is ready for the manifest). The picker SAYS "The built-in looks are not in the app yet — upload your own .cube." | ⏳ |
| The look gallery with a live preview (`LutGalleryModal`) | ⏳ waits on the built-ins it would show | ⏳ |
| Upload .cube — "X isn't a supported 3D .cube LUT (1D LUTs aren't supported)." | Files, parsed by the kernel's `parseCube` off the main actor, the same sentence | ✅ |
| Intensity 0–300 %, the readout, double-click resets to 100 % | a `Slider` 0…3 step 0.01, the readout; a TAP on the readout resets (a slider has no double-click on a phone) | ≠ |
| — (the Studio's `GradePanel`) | Interpolation: Tetrahedral / Trilinear with the web's two hints, a per-DEVICE preference under the web's key (`atelier.lut.interpolation`) | ✅ |
| — (the Studio's `GradePanel`) | Output transform: None · Rec.709 2.4 → sRGB · Rec.709 2.4 → 2.2 · sRGB → Rec.709 2.4, each with its hint (`Transfer.swift`); with one, `composeLutStack` bakes look-then-transform into one cube | ✅ |
| Compare (disabled without a look; turning it on shows the grade) | ✅ | ✅ |
| Original / Graded segmented switch ("Pick a LUT first") | `LutSourceSwitch`, the web's titles as help | ✅ |
| Clip stepper, the clip's name, `1920×1080 · codec · fps` | ✅ size · codec (four characters) · cadence, read by `VideoSource.open` | ✅ |
| The graded preview: WebGL, per presented video frame (`requestVideoFrameCallback`) | the render graph (`FrameGrader` + `CubePass`, tetrahedral by default), an `AVPlayerItemVideoOutput` read ~60×/s and graded only on a NEW frame, off the main actor, the latest request winning; the codes the export's reader sees (BGRA, labelled, non-709 brought to 709) | ✅ |
| The wipe: a divider following the pointer, `Original` left of it, `Graded` right | a drag (and the hover on a Mac); the composite made in Core Image — original left, grade right | ✅ |
| A click on the stage plays / pauses (Compare off) | a tap | ✅ |
| Transport: play (Space) · position · scrub · length | `InstrumentTransport` | ✅ |
| "Select a video in the Library." / "Select a clip to preview." | "Open a clip or a photo to preview a look on it." | ✅ |
| WebGL2 missing / HEVC decode failure + transcode | ≠ Metal is always there; HEVC decodes; a clip the device refuses says the platform's reason | ≠ |
| Export: every selected clip, sequential, one encoder at a time, a failure reported and skipped | every clip on the shelf, the same loop over the shared pipeline (`exportProcessedVideo`), graded in coded orientation (the rotation flag stands), audio copied | ✅ |
| Each file downloads as it lands, named `<clip>-graded.mp4` | a FOLDER asked for at the click, each file written there as it lands under the same name, numbered if taken (`uniqueName`) | ≠ |
| Results list: ✓ / ✕ / … / · with Queued · NN% · Exported · Failed and the reason | ✅ progress reported at half a percent at most | ✅ |
| `Exporting 2/5` + the run's bar + Cancel | ✅ Esc cancels on a Mac; the run is also a task in the kernel's `TaskRegistry` (label, progress, "2 of 5", Cancel) | ✅ |
| After a Cancel the rows stay as they were | ≠ the clips that never reached the folder leave the list and a note says how many did ("Cancelled — N exported before it stopped.") | ≠ |
| "N exported · M failed" | ✅ | ✅ |
| "Export N MP4s" ("Render graded copies of the selected clips (H.264 MP4)") | ✅ | ✅ |
| "Export needs WebCodecs (try Chrome/Edge)" | ≠ never: AVFoundation encodes | ≠ |

## Composer (`Composer/`, kernel `Tools/ComposerReadout.swift`)

| Web (`ComposerTool.tsx`, `overlay.ts`, `draw-readout.ts`, `export-composition.ts`, `use-composer-map.ts`, `map-shared.ts`, `shared/media/compose-layout.ts`) | Native | |
|---|---|---|
| Accepts `video+telemetry` | ✅ | ✅ |
| "Select a DJI clip (video + .srt) in the Library to compose." | "Open a DJI clip (video + .srt) to compose." + an empty state | ✅ |
| Clip stepper, name, `1080×1920` | ✅ | ✅ |
| Aspect 16:9 · 9:16 · 1:1 · 4:5, HD 1280 · Full HD 1920 (defaults 9:16, Full HD) | ✅ the kernel's `outputSize` | ✅ |
| Layout: Side by side · Stacked · Map inset · Video inset (default Stacked) | ✅ the kernel's `paneRects` | ✅ |
| Split 0.2–0.8 (0.6), or Inset 0.15–0.5 (0.3) + ↖ ↗ ↙ ↘ (↘) | ✅ | ✅ |
| Video cover / contain (`fitRect`) | ✅ | ✅ |
| Map zoom −4…+4 by 0.5 over the fitted camera (40 px padding, zoom ≤ 16, a lone fix at 15) | ✅ the kernel's `fitTrackCamera` + `zoomed(by:)` | ✅ |
| Follow: on / off — the camera centred on the aircraft ("Keep the map centred on the aircraft as the clip plays") | ✅ | ✅ |
| Map: tiles / Map: offline — OpenStreetMap under the path | ⏳ MapKit tiles in the Composer need a snapshot per camera (and, with Follow, per frame) — unmeasured; the map is the blank paper and the pane says "Offline · no tiles loaded". NOTE the web's chip starts ON (`useState(true)`), against the one-exception rule of `local-first.md`, which says tiles are off by default — a web bug the native app does not copy | ⏳ |
| "The map library couldn't load" | ≠ nothing to load | ≠ |
| Look: the shared picker + Upload .cube + Intensity | `InstrumentLookControls` without the render choices, as the web's Composer | ✅ |
| Overlay: shown/hidden, labels ("Show the field label prefixes"), ALT · SPD · V/S · HDG · GPS · ABS | ✅ the kernel's `composerOverlayFields` / `buildReadoutLines`, its spec ported | ✅ |
| Text colour, Bg colour + opacity 0–1 by 0.05, Radius 0–32, Size 0.6–2.2 by 0.1, Font mono · sans · serif | ✅ `ColorPicker`s writing the web's `#rrggbb`; the fonts the web's stacks resolved by `Paint/PaintFonts` | ✅ |
| The card: `max(10, round(h × 0.03))` × size, padding, 1.35 line height, pushed inside the frame, 600 weight | the kernel's `readoutMetrics` / `readoutBox`, painted by `PaintCanvas` (Core Text) — the same arithmetic at the preview's and the file's size | ✅ |
| Drag the card on the preview ("Drag the telemetry readout to reposition it") | ✅ a press on the card picks it up where it was held (`readoutDragPosition`) | ✅ |
| Preview canvas capped at 1440 px, the clip graded at ≤ 1280 px | ✅ | ✅ |
| The composite: black, video pane, map pane (the map FIRST under Video inset), the card on top | `ComposerPainter.composite` — Core Image for the clip, Core Graphics rasters for the map and the card | ✅ |
| The map framed at the preview's apparent scale in the export (`cameraForTrack(previewScale)`) | ✅ the preview's camera scaled by the export's size; the line and the dot scale with it | ✅ |
| The export's map is the whole-track framing, never Follow | ≠ the file follows the aircraft when Follow is on — the same painter as the preview, so preview = export | ≠ |
| The export's marker: `max(4, round(h × 0.008))` | ≠ the preview's dot scaled with the frame (the web's two sizes disagree) | ≠ |
| Transport: play (Space) · scrub · length | ✅ | ✅ |
| Export MP4 → "Rendering…" / NN % → Cancel; downloads `<clip>-composition.mp4` | ✅ the shared pipeline at the output size, the sound copied; the file handed to a move panel under the same name; also a task in the kernel's `TaskRegistry` | ✅ |
| "Couldn't read the video file…", HEVC decode errors, "MP4 export needs WebCodecs" | ≠ the platform's own reason, said under the row | ≠ |
| — | NATIVE: Save frame (PNG) — the frame under the playhead at the OUTPUT's size, through the same painter, `<clip>-composition.png` | ✅ |
