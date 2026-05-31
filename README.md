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
codec, not a bug.** In the gallery this surfaces as:

- A "playback unavailable (codec not supported)" placeholder instead of the
  inline video.
- "duration unavailable" on the card.
- **Telemetry still works fully** — the `.srt` is plain text, so the summary and
  the detailed synced view are unaffected even when the video can't decode.

Options: try a different browser (Safari is the most reliable for HEVC), or
transcode to H.264, e.g. `ffmpeg -i in.mp4 -c:v libx264 out.mp4`.

Guaranteed decoding (and real thumbnails) will come with a future native app
(Tauri) bundling ffmpeg — at which point only the file-access layer changes.

## Architecture

All business logic lives in `lib/` as **pure, dependency-free, DOM-free
modules** so it can be reused as-is in other contexts (Node, a worker, a Next.js
project, a future native app). The **only** brick that changes for a native
shell is `sources/file-sources.ts` — everything else is reused unchanged.

```
src/
├── lib/                       # pure: zero DOM, zero React
│   ├── srt-parser.ts          # SRT → Cue[] parser
│   ├── find-cue.ts            # binary search for the active cue at time t
│   ├── pair-files.ts          # pair videos with their .srt siblings
│   ├── telemetry-summary.ts   # summary (cue count, alt range, …) from Cue[]
│   ├── format.ts              # byte/duration formatting
│   └── *.test.ts              # unit tests (Vitest)
├── sources/
│   └── file-sources.ts        # access paths (files, folder, drop) → Promise<File[]>
├── hooks/
│   └── use-active-cue.ts      # follow the displayed frame → active Cue (shared)
├── components/
│   ├── telemetry-view.tsx     # shared readout: TelemetryPanels + LiveTelemetry
│   ├── TelemetryPlayer.tsx    # <video> + useActiveCue + full panels (detail page)
│   ├── Gallery.tsx            # grid of cards
│   ├── VideoCard.tsx          # one card: inline <video> + live telemetry readout
│   ├── DetailView.tsx         # one pair → object URL + parsed cues → player
│   └── FolderDrop.tsx         # files / folder picker + drag-and-drop UI
├── App.tsx                    # gallery ⇄ detail orchestration
└── main.tsx
```

The frame-sync logic lives in exactly one place — the `useActiveCue` hook — and
the telemetry readout UI in `telemetry-view.tsx`. Both the inline gallery cards
and the full detail player consume them, so the live-telemetry feature is the
same engine whether you are scanning the gallery or studying one clip.

### Notable implementation details

- **Parsing the double-bracket field.** Most fields are one bracket each
  (`[iso: 100]`), but altitude packs two pairs into one bracket
  (`[rel_alt: 35.200 abs_alt: 80.196]`). Rather than assume "one bracket = one
  field", the parser extracts the inner content of *all* brackets, joins it, and
  sweeps with a global `key: value` regex — handling both shapes uniformly.
  This is covered by an anti-regression test.
- **Frame-accurate sync, shared once.** The `useActiveCue` hook uses
  `video.requestVideoFrameCallback()` and reads `metadata.mediaTime` (the exact
  presentation time of the displayed frame), falling back to the `timeupdate`
  event + `video.currentTime` on browsers that don't support it. Both the gallery
  cards and the detail player use this one hook — the live readout is identical
  everywhere.
- **Efficient cue lookup.** A 5-minute 60 fps clip is ~18 000 cues, so lookups
  use binary search (last cue with `start <= t`), never a linear scan.
- **Minimal re-renders.** React state updates only when the active cue actually
  changes, not on every frame.
- **No memory leaks.** Object URLs created for the video are revoked when the
  file changes or the component unmounts — never 50 URLs held open at once.
- **Lazy gallery, live telemetry.** Each card uses an `IntersectionObserver`;
  the video object URL, duration, and SRT parse only happen once the card scrolls
  into view. The initial render shows just the instant fields (name, size). Once
  visible, the parsed cues feed the inline live readout — and
  `requestVideoFrameCallback` only fires while a video is actually playing, so
  idle cards cost nothing.
- **Pairing is pure and tested.** `pairFiles` groups by base name
  case-insensitively, includes videos without an SRT (`srt: null`), drops orphan
  SRTs, and ignores junk (`.LRF`, `.THM`, hidden files).

### Other telemetry formats

Only the modern DJI "bracket" format is supported today. Older models (Mavic,
etc.) use a different layout (`GPS(...)`, `BAROMETER:...`). The parser keeps
format detection explicit so additional formats can be plugged in later without
rewriting the entry point.
