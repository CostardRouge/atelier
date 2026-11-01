# Mosaic — writing it out

Read before touching what a mosaic WRITES: `use-mosaic-export.ts`,
`MosaicExportPanel.tsx`, `export-size.ts`, `MosaicPlayer.film`,
`MosaicSettings.export`. What plays is `mosaic-motion.md`; the core is
`mosaic.md`.

## A file is the stage's shape on a short side; a bigger file has more cells (2026-11-01, M7)

**Decision**: the size is named by its SHORT side (720 / 1080 / 1440 / 4K)
in the stage's shape, both sides even (H.264 refuses odd); the cells default
to `pixels` — `cellPx` kept in the file's pixels, D2 of `docs/mosaic.md`, so
4K holds four times the pictures of 1080p — and `screen` keeps the stage's
column count, each cell drawn bigger, capped at `MAX_CELL_PX` (160, a tile's
own width: past it a cell only enlarges its tile). **Why**: a file that
shows the same reading as the stage at any size is his D2; a 4K PNG of 40 px
cells is the poster he can print. **How to apply**: `settings.export` is
additive to doc v3 (`sanitizeExport`, no version bump); the panel's line
(`w × h · cols × rows cells`) and the export read the same pure
`export-size.ts`, so they never disagree.

## A film is a player of its own, prepared in time order, never writing (2026-11-01, M7)

**Decision**: `MosaicPlayer.film(opts, steps, size, signal)` returns a length
known up front (`filmParts`: the opening, then each step's own departure; a
recipe in `ONCE` films one step) and a `draw(t, ctx)` the encoder calls in
time order; it prepares the step being drawn and the next ONLY, lets those
two behind go, and keeps 3 scenes instead of `SCENES_HELD` above 4 MP (a 4K
scene is tens of megabytes). It paints through `paintStepFrame`, the stage's
own painter, from the document's seed, and gets a READ-ONLY copy of the
chain's queue (no `onDraw` / `onPick`): a film never changes the document it
films. A chain that runs out holds its last frame to the end. 30 fps, no
sound (a screen saver), H.264 through `encodeFrames`. **Why**: the same seed
and queue make the file what Play shows; a stage left playing is untouched
because the film never shares its player. **How to apply**: Still refuses
the film in words (the button is `aria-disabled`, so a tap still says why);
a browser without WebCodecs refuses it the same way and the PNG still saves.

## The container's Chromium DOES encode H.264 (2026-11-01, M7)

The brief assumed no H.264 here; `VideoEncoder.isConfigSupported`
(`avc1.640028`) is true in this container's Chromium, and a Mosaics film of
6 steps at 720p encoded headless (1 194 frames, 39.8 s, ffprobe'd) — only AAC
is missing (`storytelling.md`). **How to apply**: drive the film headless and
probe the file (`ffprobe`, a contact sheet with `ffmpeg -vf tile`) before
calling M7-like work verified; his Mac remains the judge of a real library.

## Six cells on a phone's bar: a short word, the drawer keeps the title (2026-11-01, M7)

Export made the bottom bar six cells (the shell's Library + five), and
"Performance" no longer fit at 390 px. `SETTINGS_TABS` carries `label` (the
cell: *Device* — the section is this device's) and `title` (the drawer's
heading: *Performance*). **How to apply**: a new tab gives a word of six
letters or fewer, or the bar truncates; Export sits before Performance so
the panel stays at the inspector's foot (his lab 2 answer).
