/**
 * The main thread's side of `segment-worker.ts`: one worker, loaded on the
 * first ask, shown a picture once per source and asked one point at a time.
 * Answers come back as the model's confidence map, a byte per pixel, the
 * buffer transferred — never copied twice.
 *
 * Null from `start()` means no worker here (no `Worker`, no `OffscreenCanvas`,
 * or the model failed to load in it): `segmenter.ts` then runs the model on
 * the main thread as it always did.
 */

import type { BrushRaster } from '../render/brush-raster';
import type { WorkerReply, WorkerRequest } from './segment-worker';

export interface SegmentWorker {
  /** Which delegate the worker's model runs on. */
  delegate: 'GPU' | 'CPU';
  /**
   * One point's confidence on `source`, or null when the model refused or
   * did not answer within `timeoutMs`. The source is uploaded to the worker
   * once per identity; a point on the same source costs no copy.
   */
  segment(source: TexImageSource, point: { x: number; y: number }, timeoutMs: number): Promise<BrushRaster | null>;
  /** Let the worker and its model go. */
  dispose(): void;
}

interface Pending {
  resolve: (mask: BrushRaster | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Whether a worker can run the model here at all. */
export function workerPossible(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

/** Start the worker and load the model in it; null where that cannot be done. */
export async function startSegmentWorker(base: string): Promise<SegmentWorker | null> {
  if (!workerPossible()) return null;
  let worker: Worker;
  try {
    // A CLASSIC worker, not a module one: MediaPipe loads its wasm glue with
    // `importScripts`, which a module worker has not got (it then reaches for
    // `document.createElement('script')` and fails). The worker file has no
    // static import of its own, so it runs as a classic script in dev and
    // bundles as one (`vite.config.ts` leaves the worker format at `iife`).
    worker = new Worker(new URL('./segment-worker.ts', import.meta.url));
  } catch {
    return null;
  }
  const pending = new Map<number, Pending>();
  let seq = 0;
  let token = 0;
  let shownSource: TexImageSource | null = null;
  let shownToken = 0;
  let showing: Promise<number> | null = null;
  let alive = true;

  const fail = (reason: string) => {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve(null);
      pending.delete(id);
    }
    if (alive) console.warn(`[segment] the worker stopped: ${reason}`);
  };

  const loaded = new Promise<WorkerReply & { kind: 'loaded' }>((resolve) => {
    const onMessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply.kind === 'loaded') {
        resolve(reply);
        return;
      }
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      clearTimeout(p.timer);
      p.resolve(reply.ok ? { data: reply.data, width: reply.width, height: reply.height } : null);
    };
    worker.onmessage = onMessage;
    worker.onerror = (event) => {
      fail(event.message || 'an error in the worker');
      resolve({ kind: 'loaded', ok: false, error: event.message });
    };
  });
  const send = (msg: WorkerRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
  send({ kind: 'load', base });
  const answer = await loaded;
  if (!answer.ok) {
    alive = false;
    worker.terminate();
    return null;
  }

  const show = (source: TexImageSource): Promise<number> => {
    if (source === shownSource && !showing) return Promise.resolve(shownToken);
    if (source === shownSource && showing) return showing;
    shownSource = source;
    const mine = ++token;
    showing = (async () => {
      // A copy the worker can own: an ImageBitmap is transferred, never
      // shared, and the caller keeps its source.
      const bitmap = await createImageBitmap(source as ImageBitmapSource);
      send({ kind: 'show', token: mine, bitmap }, [bitmap]);
      shownToken = mine;
      if (token === mine) showing = null;
      return mine;
    })();
    return showing;
  };

  return {
    delegate: answer.delegate ?? 'GPU',
    async segment(source, point, timeoutMs) {
      const t = await show(source);
      const id = ++seq;
      return new Promise<BrushRaster | null>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          console.warn(`[segment] the worker did not answer within ${timeoutMs} ms; the point is dropped`);
          resolve(null);
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        send({ kind: 'segment', id, token: t, x: point.x, y: point.y });
      });
    },
    dispose() {
      alive = false;
      fail('disposed');
      send({ kind: 'dispose' });
      worker.terminate();
    },
  };
}
