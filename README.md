# DJI SRT Telemetry Viewer

A 100% client-side web tool to view DJI drone flight telemetry alongside the
video it was captured with.

When a DJI drone records, the memory card holds both the video (`.mp4`) and a
same-named `.srt` file. That `.srt` is **not** subtitle text — it's per-frame
flight telemetry (altitude, GPS, camera settings) encoded in the SubRip format.
This tool plays the video and shows the telemetry for the currently displayed
frame, synchronized frame-by-frame.

**Everything runs in your browser. Files never leave your machine — there is no
upload, no server.**

## Usage

1. Open the app.
2. Select a `.mp4` video file.
3. Select the matching `.srt` telemetry file.
4. Play the video — the Flight and Camera panels update in sync with the
   displayed frame.

### Online

Deployed via GitHub Pages at
`https://costardrouge.github.io/dji-flight-data/`.

### Local development

```bash
npm install
npm run dev        # start the dev server
npm test           # run the parser/cue-search unit tests
npm run typecheck  # type-check without emitting
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Known limitation — HEVC / H.265 codec

Recent DJI drones often record in **HEVC / H.265**, which not every browser
decodes natively (Chrome's support is inconsistent depending on the OS; Safari
handles it best). **If the telemetry loads but the video stays black, that's the
codec, not a bug.** Options:

- Try a different browser (Safari is the most reliable for HEVC).
- Transcode the clip to H.264, e.g. `ffmpeg -i in.mp4 -c:v libx264 out.mp4`.

The app shows a notice if video playback fails.

## Architecture

The SRT parser is a **pure, dependency-free, DOM-free module** so it can be
reused as-is in other contexts (Node, a worker, a Next.js project). All business
logic (parsing, cue lookup) is decoupled from React and the DOM.

```
src/
├── lib/
│   ├── srt-parser.ts   # pure SRT → Cue[] parser, zero deps, zero DOM
│   ├── find-cue.ts     # binary search for the active cue at time t
│   └── *.test.ts       # unit tests (Vitest)
├── components/
│   └── TelemetryPlayer.tsx   # <video> + frame sync + telemetry panels
├── App.tsx             # file inputs + assembly
└── main.tsx
```

### Notable implementation details

- **Parsing the double-bracket field.** Most fields are one bracket each
  (`[iso: 100]`), but altitude packs two pairs into one bracket
  (`[rel_alt: 35.200 abs_alt: 80.196]`). Rather than assume "one bracket = one
  field", the parser extracts the inner content of *all* brackets, joins it, and
  sweeps with a global `key: value` regex — handling both shapes uniformly.
  This is covered by an anti-regression test.
- **Frame-accurate sync.** Uses `video.requestVideoFrameCallback()` and reads
  `metadata.mediaTime` (the exact presentation time of the displayed frame),
  falling back to the `timeupdate` event + `video.currentTime` on browsers that
  don't support it.
- **Efficient cue lookup.** A 5-minute 60 fps clip is ~18 000 cues, so lookups
  use binary search (last cue with `start <= t`), never a linear scan.
- **Minimal re-renders.** React state updates only when the active cue actually
  changes, not on every frame.
- **No memory leaks.** Object URLs created for the video are revoked when the
  file changes or the component unmounts.

### Other telemetry formats

Only the modern DJI "bracket" format is supported today. Older models (Mavic,
etc.) use a different layout (`GPS(...)`, `BAROMETER:...`). The parser keeps
format detection explicit so additional formats can be plugged in later without
rewriting the entry point.
