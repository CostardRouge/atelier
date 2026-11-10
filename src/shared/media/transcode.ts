/**
 * In-browser HEVC/H.265 → H.264 transcode, via ffmpeg.wasm.
 *
 * The WebCodecs pipeline (and most browsers' `<video>`) can't decode HEVC, so
 * DJI footage often shows as a black clip. This module is the escape hatch that
 * doesn't need a native app: it runs a real ffmpeg, compiled to WebAssembly,
 * entirely on the user's machine — nothing uploads. The result is a plain H.264
 * MP4 every browser plays and every export path decodes.
 *
 * ffmpeg.wasm is heavy (~31 MB of core `.wasm`), so it's loaded lazily — only
 * when a transcode is first requested — and the single-threaded core is fetched
 * from a CDN (GitHub Pages isn't cross-origin isolated, so the multithreaded
 * core's `SharedArrayBuffer` isn't available). The `@ffmpeg/ffmpeg` wrapper runs
 * the core in its own worker, so the main thread stays responsive.
 *
 * Only one transcode runs at a time (a single wasm instance is heavy, like the
 * WebCodecs encoder); requests are serialised through a promise chain.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { deviceClass } from '../lib/device-class';
import { idleRelease } from '../lib/idle-release';

// Single-threaded core — needs no cross-origin isolation, so it works on plain
// static hosting (GitHub Pages). Pinned so the runtime fetch can't drift.
const CORE_VERSION = '0.12.10';
// The ESM build: `@ffmpeg/ffmpeg` always starts a MODULE worker (and the build emits ES workers), where
// `importScripts` does not exist — it then `import()`s the core and needs its default export, which the UMD
// build does not have («failed to import ffmpeg-core.js», measured 2026-11-05).
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let instance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
// Serialises runs: a single wasm core can only transcode one clip at a time.
let chain: Promise<unknown> = Promise.resolve();

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Fetch a remote script/wasm and wrap it in a same-origin blob URL. */
async function toBlobURL(url: string, mimeType: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Could not load ffmpeg core (${resp.status}).`);
  const buffer = await resp.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

/** Load the wasm core once and cache the instance; re-tries on a failed load. */
function loadFFmpeg(): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  if (!loadPromise) {
    loadPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const ffmpeg = new FFmpeg();
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      try {
        await ffmpeg.load({ coreURL, wasmURL });
      } finally {
        // The worker has read both; a blob URL kept is ~31 MB kept, once per load (and a cancel loads again).
        URL.revokeObjectURL(coreURL);
        URL.revokeObjectURL(wasmURL);
      }
      instance = ffmpeg;
      return ffmpeg;
    })().catch((err) => {
      loadPromise = null; // allow a later retry
      throw err;
    });
  }
  return loadPromise;
}

/**
 * The core rests, then goes (`idle-release.ts`): wasm memory never shrinks, and one clip
 * transcoded leaves its size in it. 8 s on a phone or a tablet, a minute elsewhere.
 */
const rest = idleRelease({
  restMs: () => (deviceClass() === 'constrained' ? 8_000 : 60_000),
  release: () => resetFFmpeg(),
});

/** Tear down the worker (after a hard cancel, or once it rested) so the next run reloads cleanly. */
function resetFFmpeg(): void {
  try {
    instance?.terminate();
  } catch {
    /* already gone */
  }
  instance = null;
  loadPromise = null;
}

/** The input filename ffmpeg sees, preserving the source extension for probing. */
function inputName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'mp4';
  return `input.${ext || 'mp4'}`;
}

/** The suite's default conversion: the whole clip, H.264 + AAC, fast. */
function wholeClipArgs(inName: string, outName: string): string[] {
  // Re-encode video to broadly-compatible H.264; re-encode audio to AAC so the
  // output is uniform regardless of the source's audio codec. `+faststart`
  // moves the moov atom up front so the result streams/seeks immediately.
  return [
    '-i', inName,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outName,
  ];
}

async function runTranscode(
  file: File,
  onProgress?: (ratio: number | null) => void,
  signal?: AbortSignal,
  makeArgs: (inName: string, outName: string) => string[] = wholeClipArgs,
): Promise<Blob> {
  if (signal?.aborted) {
    throw new DOMException('Transcode cancelled', 'AbortError');
  }

  rest.busy();
  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await loadFFmpeg();
  } catch (err) {
    rest.settled();
    throw err;
  }
  const inName = inputName(file.name);
  const outName = 'output.mp4';

  const onProg = (e: { progress: number }) => onProgress?.(clamp01(e.progress));
  // A hard cancel: terminating the worker is the only way to stop ffmpeg
  // mid-run; we then reset so the next request reloads a fresh instance.
  const onAbort = () => resetFFmpeg();
  ffmpeg.on('progress', onProg);
  signal?.addEventListener('abort', onAbort);

  try {
    await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    if (signal?.aborted) throw new DOMException('Transcode cancelled', 'AbortError');

    let code: number;
    try {
      code = await ffmpeg.exec(makeArgs(inName, outName));
    } catch (err) {
      if (signal?.aborted) throw new DOMException('Transcode cancelled', 'AbortError');
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (signal?.aborted) throw new DOMException('Transcode cancelled', 'AbortError');
    if (code !== 0) throw new Error('ffmpeg could not transcode this clip.');

    const data = await ffmpeg.readFile(outName);
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    // Copy into a fresh ArrayBuffer-backed view (the wasm FS may hand back a
    // SharedArrayBuffer-backed one, which isn't a valid BlobPart).
    const bytes = new Uint8Array(raw);
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', onProg);
    signal?.removeEventListener('abort', onAbort);
    // On EVERY path: a failed or refused clip left its copy (and a partial output) in the in-memory FS,
    // under a name per extension, so two kinds of clip piled up. A cancelled instance is already gone.
    if (instance === ffmpeg) {
      await ffmpeg.deleteFile(inName).catch(() => {});
      await ffmpeg.deleteFile(outName).catch(() => {});
    }
    rest.settled();
  }
}

/**
 * Transcode `file` to an H.264 MP4 Blob, entirely in the browser. `onProgress`
 * reports a 0..1 ratio; pass an `AbortSignal` to cancel. Runs are serialised, so
 * a request may wait for an in-flight transcode before it starts.
 */
export function transcodeToH264(
  file: File,
  onProgress?: (ratio: number | null) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const run = chain.then(() => runTranscode(file, onProgress, signal));
  // Keep the chain alive even when this run rejects, so the queue never wedges.
  chain = run.catch(() => {});
  return run;
}

/**
 * The same conversion with the caller's own ffmpeg arguments (`(inName,
 * outName) => args`) — a window of the clip, a scale, another quality — on
 * the same core, queue and hard cancel (Recap's backgrounds,
 * `recap-transcode.ts`). The output is read as an MP4.
 */
export function transcodeWith(
  file: File,
  makeArgs: (inName: string, outName: string) => string[],
  onProgress?: (ratio: number | null) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const run = chain.then(() => runTranscode(file, onProgress, signal, makeArgs));
  chain = run.catch(() => {});
  return run;
}

