/**
 * Measuring a mosaic's pictures (`docs/mosaic.md` §4.2): the main thread
 * fetches each Winnow thumbnail — the client holds the auth and the retry —
 * six in flight like `thumb-analysis.ts`, and hands the blob to the idlest
 * of a small pool of `measure-worker.ts`; each answer is a 6 × 6 grid and a
 * 160 × 90 tile, both kept on the device (`mosaic-store.ts`) and the grid
 * written onto the document by the caller.
 *
 * Resumable by construction: what the device already holds for a picture is
 * copied in without a request, so a run cancelled at 3 000 of 10 000 keeps
 * the 3 000 and the next run starts there. A thumbnail that will not fetch
 * or decode is reported FAILED and skipped, never the end of the run. The
 * run is one task in the masthead (`shared/tasks`), with a Cancel.
 *
 * Where a worker cannot be made (`workerPossible`), the same measure runs on
 * this thread in small batches with a yield — slower, and the task's detail
 * says so.
 */

import { deviceClass, type DeviceClass } from '../../shared/lib/device-class';
import type { MeasureReply } from '../../shared/mosaic/measure-worker';
import { TILE_H, TILE_W, coverSource, encodeGrid, gridOf } from '../../shared/mosaic/measure';
import type { MosaicTile } from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { startTask } from '../../shared/tasks/tasks';
import { getMeasures, heldTiles, putMeasures, putTiles } from './mosaic-store';

/** How many thumbnails are fetched at once — the instance's and the network's share. */
export const FETCH_CONCURRENCY = 6;
/** Pictures measured on the main thread between two yields, in the fallback. */
const MAIN_BATCH = 8;

/**
 * How many workers the pool spawns: every core but one, two to six — two on
 * a constrained device, whose memory each worker's heap also costs
 * (`device-memory.md`).
 */
export function measurePoolSize(cores: number, klass: DeviceClass): number {
  const cap = klass === 'constrained' ? 2 : 6;
  const n = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) - 1 : 1;
  return Math.max(klass === 'constrained' ? 1 : 2, Math.min(cap, n));
}

/** Whether a worker can measure here at all. */
export function workerPossible(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

export interface MeasureProgress {
  /** Pictures settled — measured, found on the device, or failed. */
  done: number;
  total: number;
  /** Of `done`, how many came from the device without a request. */
  held: number;
  failed: number;
}

export interface MeasureResult {
  /** Every picture's grid in base64, the device's and this run's together. */
  grids: Map<number, string>;
  /** Pictures whose thumbnail would not fetch or decode this run. */
  failed: number[];
  /** Whether the run was cancelled before every picture was settled. */
  cancelled: boolean;
  /** Where the measuring happened. */
  on: 'workers' | 'main';
}

export interface MeasureOptions {
  signal?: AbortSignal;
  onProgress?: (p: MeasureProgress) => void;
  /** The pool's size, for a test or a setting; the device's otherwise. */
  workers?: number;
}

interface Measured {
  grid: Uint8Array;
  tile: Blob;
}

/** One picture measured on this thread — the worker's work, where there is no worker. */
async function measureOnMain(blob: Blob): Promise<Measured> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  try {
    const src = coverSource(bitmap.width, bitmap.height, TILE_W, TILE_H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, TILE_W, TILE_H);
  } finally {
    bitmap.close();
  }
  const raster = ctx.getImageData(0, 0, TILE_W, TILE_H);
  const grid = gridOf({ data: raster.data, width: TILE_W, height: TILE_H });
  const tile = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no tile'))), 'image/jpeg', 0.82),
  );
  return { grid, tile };
}

/** A pool of measure workers, one job in flight per worker, handed out to the idlest. */
class WorkerPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private waiting: Array<() => void> = [];
  private jobs = new Map<number, { resolve: (m: Measured) => void; reject: (e: Error) => void }>();

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../../shared/mosaic/measure-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (event: MessageEvent<MeasureReply>) => {
        const job = this.jobs.get(event.data.id);
        if (!job) return;
        this.jobs.delete(event.data.id);
        if (event.data.kind === 'measured') job.resolve({ grid: event.data.grid, tile: event.data.tile });
        else job.reject(new Error(event.data.error));
        this.busy[i] -= 1;
        this.waiting.shift()?.();
      };
      w.onerror = (event) => {
        for (const [id, job] of this.jobs) {
          job.reject(new Error(event.message || 'the measure worker stopped'));
          this.jobs.delete(id);
        }
        this.busy[i] = 0;
        while (this.waiting.length) this.waiting.shift()?.();
      };
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  private async idlest(): Promise<number> {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.workers.length; i++) if (this.busy[i] === 0 && (best < 0 || this.busy[i] < this.busy[best])) best = i;
      if (best >= 0) return best;
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
  }

  async measure(id: number, blob: Blob): Promise<Measured> {
    const i = await this.idlest();
    this.busy[i] += 1;
    return new Promise<Measured>((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.workers[i].postMessage({ kind: 'measure', id, blob });
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The grids of `tiles` on `sourceId`: the device's first, the rest fetched
 * and measured. Writes the grids and tiles to the store as they land. Never
 * throws for one picture; throws only when the client is unusable at all.
 */
export async function measureTiles(
  client: WinnowClient,
  sourceId: string,
  tiles: readonly MosaicTile[],
  opts: MeasureOptions = {},
): Promise<MeasureResult> {
  const signal = opts.signal;
  const ids = tiles.map((t) => t.id);
  const total = ids.length;
  const grids = new Map<number, string>();
  const failed: number[] = [];
  // What the document already carries needs nothing — unless its tile is not here.
  for (const t of tiles) if (t.grid) grids.set(t.id, t.grid);
  const stored = await getMeasures(sourceId, ids.filter((id) => !grids.has(id)));
  for (const [id, grid] of stored) grids.set(id, grid);
  const withTile = await heldTiles(sourceId, ids);
  const todo = ids.filter((id) => !grids.has(id) || !withTile.has(id));
  const held = total - todo.length;
  let done = held;
  const report = () => opts.onProgress?.({ done, total, held, failed: failed.length });
  report();
  if (!todo.length || signal?.aborted) return { grids, failed, cancelled: Boolean(signal?.aborted), on: 'workers' };

  const useWorkers = workerPossible() && (opts.workers === undefined || opts.workers > 0);
  const pool = useWorkers
    ? new WorkerPool(opts.workers ?? measurePoolSize(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2, deviceClass()))
    : null;
  const pendingGrids = new Map<number, string>();
  const pendingTiles = new Map<number, Blob>();
  const flush = async () => {
    if (!pendingGrids.size && !pendingTiles.size) return;
    const g = new Map(pendingGrids);
    const t = new Map(pendingTiles);
    pendingGrids.clear();
    pendingTiles.clear();
    await Promise.all([putMeasures(sourceId, g), putTiles(sourceId, t)]);
  };

  let next = 0;
  let sinceFlush = 0;
  const settle = (id: number, m: Measured | null) => {
    if (m) {
      const grid = encodeGrid(m.grid);
      grids.set(id, grid);
      pendingGrids.set(id, grid);
      pendingTiles.set(id, m.tile);
    } else failed.push(id);
    done += 1;
    sinceFlush += 1;
    report();
  };
  const fetchOne = async (id: number): Promise<Blob | null> => {
    try {
      return await client.fetchFile(client.thumbUrl(id), `${id}.jpg`, 'image/jpeg', 0, signal ? { signal } : {});
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
  };

  try {
    if (pool) {
      const lane = async () => {
        while (next < todo.length && !signal?.aborted) {
          const id = todo[next++];
          const blob = await fetchOne(id);
          if (!blob) {
            settle(id, null);
            continue;
          }
          let m: Measured | null = null;
          try {
            m = await pool.measure(id, blob);
          } catch {
            m = null;
          }
          settle(id, m);
          if (sinceFlush >= 48) {
            sinceFlush = 0;
            await flush();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, todo.length) }, lane));
    } else {
      while (next < todo.length && !signal?.aborted) {
        const batch = todo.slice(next, next + MAIN_BATCH);
        next += batch.length;
        const blobs = await Promise.all(batch.map(fetchOne));
        for (let i = 0; i < batch.length; i++) {
          if (signal?.aborted) break;
          const blob = blobs[i];
          let m: Measured | null = null;
          if (blob) {
            try {
              m = await measureOnMain(blob);
            } catch {
              m = null;
            }
          }
          settle(batch[i], m);
        }
        await flush();
        await yieldToMain();
      }
    }
  } catch (e) {
    if (!signal?.aborted) throw e;
  } finally {
    pool?.dispose();
    await flush();
  }
  return { grids, failed, cancelled: Boolean(signal?.aborted), on: pool ? 'workers' : 'main' };
}

/**
 * `measureTiles` as ONE task in the masthead — «Measuring N pictures», a bar,
 * a detail with the count and where it runs, a Cancel. Resolves with the
 * result, cancelled or not; the caller writes the grids onto the document
 * (`withMeasures`) either way.
 */
export async function runMeasure(
  client: WinnowClient,
  sourceId: string,
  tiles: readonly MosaicTile[],
  opts: { signal?: AbortSignal; onProgress?: (p: MeasureProgress) => void } = {},
): Promise<MeasureResult> {
  const controller = new AbortController();
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const on = workerPossible() ? 'in the background' : 'on this thread';
  const task = startTask({
    label: `Measuring ${tiles.length.toLocaleString()} ${tiles.length === 1 ? 'picture' : 'pictures'}`,
    progress: 0,
    detail: `Reading each picture’s colours ${on}`,
    cancel: () => controller.abort(),
  });
  try {
    return await measureTiles(client, sourceId, tiles, {
      signal: controller.signal,
      onProgress: (p) => {
        task.update({
          progress: p.total ? p.done / p.total : 1,
          detail: `${p.done.toLocaleString()} of ${p.total.toLocaleString()}${p.held ? ` · ${p.held.toLocaleString()} already here` : ''}${p.failed ? ` · ${p.failed} skipped` : ''}`,
        });
        opts.onProgress?.(p);
      },
    });
  } finally {
    task.done();
  }
}
