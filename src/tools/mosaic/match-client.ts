/**
 * Where a matching runs (`docs/mosaic.md` §4.3): on this thread when the
 * brute force is small — one frame's stall is not worth a round trip — and
 * in a one-off `measure-worker.ts` past `WORKER_PAST_OPS` multiply-adds,
 * the stage keeping its previous mosaic until the new one lands. Without
 * `Worker`, always here.
 */

import { matchCells, type MatchOptions, type Matching } from '../../shared/mosaic/match';
import type { MeasureReply, MeasureRequest } from '../../shared/mosaic/measure-worker';

/** cells × pictures × dims past which the main thread hands the matching to a worker. */
export const WORKER_PAST_OPS = 20_000_000;

/** Whether this matching is big enough for a worker. */
export function matchInWorker(cellCount: number, pictureCount: number, dims: number): boolean {
  return typeof Worker !== 'undefined' && cellCount * pictureCount * dims >= WORKER_PAST_OPS;
}

export async function matchAnywhere(
  cells: Float32Array,
  pictures: Float32Array,
  dims: number,
  cols: number,
  rows: number,
  opts: MatchOptions & { signal?: AbortSignal } = {},
): Promise<Matching & { on: 'main' | 'worker' }> {
  const n = Math.floor(pictures.length / dims);
  if (!matchInWorker(cols * rows, n, dims)) {
    return { ...matchCells(cells, pictures, dims, cols, rows, opts), on: 'main' };
  }
  const worker = new Worker(new URL('../../shared/mosaic/measure-worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise<Matching>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Matching cancelled', 'AbortError'));
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event: MessageEvent<MeasureReply>) => {
        if (event.data.kind !== 'matched') return;
        opts.signal?.removeEventListener('abort', onAbort);
        resolve({ ids: event.data.ids, dist: event.data.dist });
      };
      worker.onerror = (event) => {
        opts.signal?.removeEventListener('abort', onAbort);
        reject(new Error(event.message || 'the matching worker stopped'));
      };
      const req: MeasureRequest = {
        kind: 'match',
        id: 1,
        cells: new Float32Array(cells),
        pictures: new Float32Array(pictures),
        dims,
        cols,
        rows,
        distinct: opts.distinctNeighbours !== false,
        exclude: Int32Array.from(opts.exclude ?? []),
      };
      worker.postMessage(req, [req.cells.buffer, req.pictures.buffer, req.exclude.buffer]);
    });
    return { ...result, on: 'worker' };
  } finally {
    worker.terminate();
  }
}
