/**
 * A POOL of matching workers kept alive while a mosaic is open (`docs/mosaic.md`
 * labo 2, R8–R9): the library's descriptors are sent ONCE per worker under
 * a token, then each lot of cells is a small message — the cells'
 * descriptors, the lot's indexes and what is decided so far — answered by
 * that lot's pictures. Lots are handed to the idlest worker, up to the
 * pool's size in flight, so a propagation paints as answers land.
 *
 * Without `Worker` the pool runs every lot on this thread, one per task
 * turn, so the propagation still shows. `resize` applies the Performance
 * panel's count on the next library.
 */

import { matchLot, type Matching } from '../../shared/mosaic/match';
import type { MeasureReply, MeasureRequest } from '../../shared/mosaic/measure-worker';

interface Job {
  resolve: (m: Matching) => void;
  reject: (e: Error) => void;
  /** Cancelled before the worker answered: the answer frees the worker and is dropped. */
  gone: boolean;
}

export class MatchPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private waiting: Array<() => void> = [];
  private jobs = new Map<number, Job>();
  private seq = 0;
  private token = 0;
  /** The library each worker holds, by worker index. */
  private held: number[] = [];
  private library: { token: number; pictures: Float32Array; dims: number } | null = null;

  constructor(private size: number) {}

  /** How many workers answer at once: the pool's size, or 1 on this thread. */
  get lanes(): number {
    return typeof Worker === 'undefined' || this.size <= 0 ? 1 : this.size;
  }

  get onWorkers(): boolean {
    return typeof Worker !== 'undefined' && this.size > 0;
  }

  /** A new count: the workers are made again on the next library. */
  resize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.dispose();
  }

  private spawn(): Worker[] {
    if (this.workers.length || !this.onWorkers) return this.workers;
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL('../../shared/mosaic/measure-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (event: MessageEvent<MeasureReply>) => {
        const reply = event.data;
        if (reply.kind !== 'lot' && reply.kind !== 'failed') return;
        const job = this.jobs.get(reply.id);
        if (!job) return;
        this.jobs.delete(reply.id);
        // The worker is free again whatever became of the asker — a cancelled lot must not pin it.
        this.busy[i] -= 1;
        this.waiting.shift()?.();
        if (job.gone) return;
        if (reply.kind === 'lot') job.resolve({ ids: reply.ids, dist: reply.dist });
        else job.reject(new Error(reply.error));
      };
      w.onerror = (event) => {
        for (const [id, job] of this.jobs) {
          job.reject(new Error(event.message || 'the matching worker stopped'));
          this.jobs.delete(id);
        }
        this.busy[i] = 0;
        while (this.waiting.length) this.waiting.shift()?.();
      };
      this.workers.push(w);
      this.busy.push(0);
      this.held.push(-1);
    }
    return this.workers;
  }

  /** The library every lot is matched against from now on; sent to each worker once. */
  setLibrary(pictures: Float32Array, dims: number): void {
    this.token += 1;
    this.library = { token: this.token, pictures, dims };
  }

  private freeWorker(): number {
    for (let i = 0; i < this.workers.length; i++) if (this.busy[i] === 0) return i;
    return -1;
  }

  /** A free worker's index, taken (its busy count raised) — waited for when none is. */
  private async take(signal?: AbortSignal): Promise<number> {
    for (;;) {
      const i = this.freeWorker();
      if (i >= 0) {
        this.busy[i] += 1;
        // Another worker may be free too: the next waiter must not sleep on it.
        if (this.freeWorker() >= 0) this.waiting.shift()?.();
        if (signal?.aborted) {
          this.busy[i] -= 1;
          this.waiting.shift()?.();
          throw new DOMException('Matching cancelled', 'AbortError');
        }
        return i;
      }
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        // A cancelled asker leaves the queue: it would otherwise swallow a wake-up meant for a live one.
        signal?.addEventListener(
          'abort',
          () => {
            const at = this.waiting.indexOf(resolve);
            if (at >= 0) this.waiting.splice(at, 1);
            resolve();
          },
          { once: true },
        );
      });
      if (signal?.aborted) throw new DOMException('Matching cancelled', 'AbortError');
    }
  }

  /** One lot matched: `known` is the grid's decisions so far (−1 undecided). */
  async matchLot(cells: Float32Array, cols: number, lot: Int32Array, known: Int32Array, distinct: boolean, signal?: AbortSignal): Promise<Matching> {
    const lib = this.library;
    if (!lib) throw new Error('No library to match against.');
    if (!this.onWorkers) {
      // On this thread, a turn at a time, so the propagation still paints between lots.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new DOMException('Matching cancelled', 'AbortError');
      return matchLot(cells, lib.pictures, lib.dims, cols, lot, known, { distinctNeighbours: distinct });
    }
    const workers = this.spawn();
    const i = await this.take(signal);
    const w = workers[i];
    if (this.held[i] !== lib.token) {
      // A copy per worker: the array stays here for the next worker and the main-thread fallback.
      const req: MeasureRequest = { kind: 'library', token: lib.token, pictures: new Float32Array(lib.pictures), dims: lib.dims };
      w.postMessage(req, [req.pictures.buffer]);
      this.held[i] = lib.token;
    }
    const id = ++this.seq;
    return new Promise<Matching>((resolve, reject) => {
      const job: Job = {
        resolve: (m) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(m);
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
        gone: false,
      };
      const onAbort = () => {
        // The job stays until the worker answers, so its busy count comes back down.
        job.gone = true;
        reject(new DOMException('Matching cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.jobs.set(id, job);
      // The cells travel every lot (a lot's share of them would need an index map); the lot and `known` are copies.
      const req: MeasureRequest = { kind: 'lot', id, token: lib.token, cells, cols, lot: new Int32Array(lot), known: new Int32Array(known), distinct };
      w.postMessage(req, [req.lot.buffer, req.known.buffer]);
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.busy = [];
    this.held = [];
    for (const [, job] of this.jobs) job.reject(new DOMException('Pool disposed', 'AbortError'));
    this.jobs.clear();
    while (this.waiting.length) this.waiting.shift()?.();
  }
}
