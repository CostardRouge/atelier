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
