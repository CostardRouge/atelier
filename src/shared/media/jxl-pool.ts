/**
 * A small pool of JPEG XL decoders in workers (`jxl-worker.ts`), for the
 * tiles of a ProRAW DNG: jxl-oxide decodes on one thread at about a
 * microsecond a pixel, so a 48-megapixel sensor alone is most of a minute —
 * spread over the cores it is a fraction of that, and the page stays live.
 *
 * As many workers as the device can spare — up to four on a computer, two on
 * a phone, whose memory each worker's heap also costs — started on first use
 * and let go after a few idle seconds or on a hidden tab, the rule every
 * decoder here follows (`device-memory.md`). Where a worker cannot be made,
 * the tile is decoded on this thread (`wasm-still.ts`).
 */

import { deviceClass } from '../lib/device-class';
import type { PngSamples } from './png-read';

interface Job {
  resolve: (s: PngSamples) => void;
  reject: (e: Error) => void;
}

const IDLE_MS = 8_000;

let workers: Worker[] = [];
let next = 0;
let seq = 0;
let inflight = 0;
let idle: ReturnType<typeof setTimeout> | null = null;
const jobs = new Map<number, Job>();

/** How many tiles are worth having in flight at once — the pool's size. */
export function jxlPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const cap = deviceClass() === 'constrained' ? 2 : 4;
  return Math.max(1, Math.min(cap, cores - 1));
}

function release() {
  if (inflight > 0) return;
  for (const w of workers) w.terminate();
  workers = [];
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') release();
  });
}

function spawn(): Worker[] {
  if (workers.length) return workers;
  const made: Worker[] = [];
  for (let i = 0; i < jxlPoolSize(); i += 1) {
    const w = new Worker(new URL('./jxl-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<{ id: number; ok: boolean; samples?: PngSamples; error?: string }>) => {
      const job = jobs.get(event.data.id);
      if (!job) return;
      jobs.delete(event.data.id);
      if (event.data.ok && event.data.samples) job.resolve(event.data.samples);
      else job.reject(new Error(event.data.error ?? 'the JPEG XL worker failed'));
    };
    w.onerror = (event) => {
      // A worker that fails to start or dies takes its jobs with it.
      for (const [id, job] of jobs) {
        job.reject(new Error(event.message || 'the JPEG XL worker stopped'));
        jobs.delete(id);
      }
    };
    made.push(w);
  }
  workers = made;
  return workers;
}

/** One JPEG XL codestream's samples, decoded on a worker of the pool. */
export async function decodeJxlTile(bytes: Uint8Array): Promise<PngSamples> {
  if (idle) clearTimeout(idle);
  inflight += 1;
  try {
    let pool: Worker[];
    try {
      pool = spawn();
    } catch {
      const { decodeJxlSamples } = await import('./wasm-still');
      return await decodeJxlSamples(bytes);
    }
    const worker = pool[next++ % pool.length];
    const id = ++seq;
    return await new Promise<PngSamples>((resolve, reject) => {
      jobs.set(id, { resolve, reject });
      worker.postMessage({ id, bytes }, [bytes.buffer]);
    });
  } finally {
    inflight -= 1;
    if (inflight === 0) idle = setTimeout(release, IDLE_MS);
  }
}
