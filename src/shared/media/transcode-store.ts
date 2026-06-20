/**
 * A tiny, `File`-keyed store for transcode results.
 *
 * Transcoding is expensive, so its outcome must be shared: once a clip is
 * transcoded to H.264, the telemetry gallery, LUT Studio, Overlay Studio and
 * every export should all use the H.264 version — without re-running ffmpeg.
 * Those consumers don't share React state (the gallery works off raw `File`s,
 * the studios off library assets), so the natural key is the source `File`
 * itself. This store dedupes by file identity, tracks progress, caches the
 * result, and notifies subscribers — it's a plain external store so it can be
 * read from anywhere via {@link useTranscode}.
 *
 * The state machine is React-free and dependency-injected (the transcode fn is
 * a parameter), so it's unit-testable in a plain node environment.
 */

import { fileIdentity } from '../library/assets';
import { transcodeToH264 } from './transcode';

export type TranscodeStatus = 'idle' | 'running' | 'done' | 'error';

export interface TranscodeEntry {
  status: TranscodeStatus;
  /** 0..1 while running; null when not measurable / not running. */
  ratio: number | null;
  /** The transcoded H.264 file, once `status === 'done'`. */
  file: File | null;
  /** A human-readable reason, when `status === 'error'`. */
  error: string | null;
}

/** Shared, frozen "nothing here" entry — a stable reference for unknown files. */
export const IDLE_ENTRY: TranscodeEntry = Object.freeze({
  status: 'idle',
  ratio: null,
  file: null,
  error: null,
});

export type TranscodeFn = (
  file: File,
  onProgress: (ratio: number | null) => void,
  signal: AbortSignal,
) => Promise<Blob>;

export interface TranscodeStore {
  /** Current entry for a file (a stable {@link IDLE_ENTRY} when untouched). */
  get(file: File): TranscodeEntry;
  /** Start transcoding `file` (no-op if it's already running or done). */
  request(file: File): void;
  /** Abort an in-flight transcode for `file`; leaves it retryable. */
  cancel(file: File): void;
  /** Forget a file entirely (abort + drop any cached result). */
  forget(file: File): void;
  /** Abort everything and drop every cached result. */
  clear(): void;
  /** Subscribe to any change; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;
}

/** `clip.MP4` → `clip-h264.mp4`. */
function h264Name(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}-h264.mp4`;
}

/** Build a store backed by `transcode`. Exposed for tests; app uses the singleton. */
export function createTranscodeStore(transcode: TranscodeFn): TranscodeStore {
  const entries = new Map<string, TranscodeEntry>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of listeners) l();
  };
  const write = (key: string, entry: TranscodeEntry) => {
    entries.set(key, entry);
    emit();
  };

  const get = (file: File): TranscodeEntry =>
    entries.get(fileIdentity(file)) ?? IDLE_ENTRY;

  const request = (file: File): void => {
    const key = fileIdentity(file);
    const current = entries.get(key);
    if (current && (current.status === 'running' || current.status === 'done')) {
      return;
    }
    const controller = new AbortController();
    controllers.set(key, controller);
    write(key, { status: 'running', ratio: null, file: null, error: null });

    transcode(
      file,
      (ratio) => {
        const e = entries.get(key);
        if (e?.status === 'running') write(key, { ...e, ratio });
      },
      controller.signal,
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        const out = new File([blob], h264Name(file.name), { type: 'video/mp4' });
        write(key, { status: 'done', ratio: 1, file: out, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // cancel() already cleared it
        const message =
          err instanceof Error ? err.message : 'Transcode failed';
        write(key, { status: 'error', ratio: null, file: null, error: message });
      })
      .finally(() => {
        controllers.delete(key);
      });
  };

  const cancel = (file: File): void => {
    const key = fileIdentity(file);
    controllers.get(key)?.abort();
    controllers.delete(key);
    if (entries.delete(key)) emit(); // back to idle so the user can retry
  };

  const forget = (file: File): void => cancel(file);

  const clear = (): void => {
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    if (entries.size > 0) {
      entries.clear();
      emit();
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { get, request, cancel, forget, clear, subscribe };
}

/**
 * The app-wide store, wired to the real ffmpeg.wasm transcoder. Importing this
 * is cheap: `transcode.ts` only pulls the ~31 MB ffmpeg core via a dynamic
 * import the first time a transcode actually runs.
 */
export const transcodeStore: TranscodeStore = createTranscodeStore(transcodeToH264);
