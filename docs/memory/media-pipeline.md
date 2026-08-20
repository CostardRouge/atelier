# Media pipeline — decode, grade, composite, encode

Read before touching video decode/encode, any export, the transcode fallback, LUT rendering, or canvas compositing (`src/shared/media/*`, `src/shared/lut/*`, `src/tools/lut/*`, `src/tools/overlay/*`, `src/tools/composer/*`).

## One shared WebCodecs pipeline, parameterised by a frame processor (2026-08-20)

**Decision.** `shared/media/webcodecs-export.ts` owns the whole demux → decode → transform → encode → mux machinery (mp4box.js → `VideoDecoder` → processor → `VideoEncoder` H.264 → mp4-muxer). Tools supply only a `FrameProcessor`. **Why**: the machinery is subtle and was being duplicated per export path. **How to apply**: a new export is a new processor, not a new pipeline. The processor **must not** close the frame it is given — the pipeline closes it after `draw` returns. Audio is **remuxed, never re-encoded**, so it stays bit-for-bit identical.

## `bakeRotation` when anything is drawn at fixed coordinates (2026-08-20)

**Decision.** Exports that draw something positioned (overlays, compositions) set `bakeRotation`, rotating each decoded frame into display orientation in pixels and emitting `rotation: 0`, instead of relying on the container rotation flag. **Why**: with a rotation flag, burned-in elements land in coded coordinates and no longer match the on-screen preview — this was a real bug (`a989ce6`). Default is off because it is cheaper and fine for orientation-independent passes. **How to apply**: drawing anything at specific coordinates → bake. Using `outputSize` (compositions) forces muxer rotation to 0 and makes the processor responsible for orienting the frame itself.

## HEVC: transcode in-browser rather than refuse or upload (2026-08-20)

**Decision.** Clips the browser cannot decode get an opt-in "Transcode to H.264" action backed by ffmpeg.wasm (`shared/media/transcode.ts`), run entirely on the user's machine. **Why**: recent DJI drones record HEVC/H.265, which Chrome decodes inconsistently; the alternative would have been uploading or telling the user to leave the app. **How to apply**: constraints that shaped the module and must survive edits — the **single-threaded** core is used because GitHub Pages is not cross-origin isolated, so `SharedArrayBuffer` (multithreaded core) is unavailable; the core version is pinned so the runtime fetch cannot drift; runs are serialised through a promise chain (one wasm instance at a time) and the chain is kept alive on rejection so the queue never wedges; a hard cancel terminates the worker and resets, since that is the only way to stop ffmpeg mid-run; output is copied into a fresh `ArrayBuffer`-backed view because the wasm FS may hand back a `SharedArrayBuffer`-backed one, which is not a valid `BlobPart`.

## Transcode results are shared through a `File`-keyed store (2026-08-20)

**Decision.** `transcode-store.ts` dedupes by source `File` identity, tracks progress, caches the result and notifies subscribers; consumers read it through `useTranscode`. **Why**: the gallery works off raw `File`s while the studios work off library assets — they share no React state, so the `File` itself is the only natural key, and re-running a multi-minute ffmpeg pass per consumer is unacceptable. **How to apply**: the store is React-free with the transcode function injected, which is what makes it unit-testable in node — keep that shape.

## A codec-agnostic seek fallback exists for overlay export (2026-08-20)

**Decision.** `overlay/export-overlay-seek.ts` decodes via a `<video>` element (seek frame-by-frame, draw to canvas, feed the same encoder) when WebCodecs cannot decode the source; `export-overlay.ts` chooses the path and falls back on a late decode failure. **Why**: some browsers *play* HEVC in a `<video>` element while WebCodecs refuses it. **How to apply**: know the trade-offs before extending it — every seek decodes from the prior keyframe (far slower than realtime) and frame timing is approximate (`currentTime = i/fps` lands on the nearest decoded frame ≤ t). Composer export has **no** seek fallback yet: undecodable HEVC there surfaces a clear message instead.

## Grading happens in exactly one place (2026-08-20)

**Decision.** `lut/lut-gl.ts` is a framework-free WebGL2 renderer (frame as 2D texture, `sampler3D` LUT with hardware trilinear interpolation); `frame-grader.ts` wraps it for the exporters so preview and export grade identically. **Why**: two grading implementations would diverge visibly. **How to apply**: LUT texel sampling is mapped onto texel centres (`scale = (N-1)/N`, `offset = 0.5/N`) so cube edges are not clipped — do not "simplify" that. Intensity above 1 extrapolates past the look and the 8-bit canvas clamps the overshoot. Without WebGL2 the grader degrades to pass-through so an export produces un-graded output rather than failing.

## Composer composites on a single canvas, with a snapshotted map (2026-08-20)

**Decision.** The Composer draws the (graded) video and the map's WebGL canvas into computed panes, then the readout, per frame. For export, the map is built once at full resolution, framed to the whole track, rendered and **snapshotted**; each frame draws that snapshot and places the aircraft marker via `map.project()`. **Why**: the per-frame draw in the export pipeline is synchronous, so MapLibre cannot be re-rendered per frame. **How to apply**: the compositing map needs `preserveDrawingBuffer` (otherwise its canvas cannot be `drawImage`d) and the marker must be a GL layer — a DOM marker is not captured. Panes are drawn with a cover-fit rect so a resize never stretches the map.
