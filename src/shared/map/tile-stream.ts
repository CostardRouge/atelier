/**
 * A STREAMED map ground: a following camera's tile pyramid (`tile-strip.ts`)
 * fetched AHEAD as compressed blobs, and decoded into bitmaps only AROUND THE
 * PLAYHEAD (2026-10-07, after his «build the tile streaming for long drives»).
 *
 * Why: full detail over a long, tight drive is thousands of tiles — 2 000 to
 * 3 700 over the 2 100 km fixture at a 35 km view — and a decoded tile is a
 * 256 kB bitmap, so holding them all is half a gigabyte and more. Their
 * blobs are 20–40 kB. So the whole pyramid is downloaded once, before a
 * frame is recorded (the export waits for it — `useHookPictures().ready`),
 * and a bounded window of bitmaps follows the time being drawn:
 *
 * - `ready(tiles)` — an EXPORT, before it draws a frame: the frame's tiles
 *   (and the next second's, so decoding overlaps encoding) are PINNED and
 *   decoded, and awaited. A recorded frame never draws a tile still on its
 *   way.
 * - `request(tiles)` — the PREVIEW, from inside a synchronous paint: the
 *   missing ones are decoded in the background and the stage told when they
 *   land; meanwhile the paint draws the nearest decoded ANCESTOR, then the
 *   wide raster — softer for a moment, never a hole.
 *
 * Least recently used bitmaps are closed past `cap`, never a pinned one. A
 * tile the server refuses was fetched from its parent instead
 * (`fetchPatch`) and is decoded cut out of it; one that never came is a
 * count, and the coarser ground stands in.
 *
 * The fetching and decoding are injected (`StreamIO`), so the window's rules
 * are tested in node; the module's registry hands one stream per pyramid to
 * the shell that fills it and to the painters that read it, as the blob
 * cache in `osm-tiles.ts` is module state.
 */

import { useSyncExternalStore } from 'react';
import { TILE_WORKERS, decodePatch, decodedBudget, fetchPatch } from './osm-tiles';
import { tileBox, type PyramidTile } from './tile-strip';

export interface StreamProgress {
  total: number;
  /** Tiles whose blob is in (their own, or an ancestor's). */
  fetched: number;
  /** Of those, the ones that came from a coarser zoom. */
  coarser: number;
  /** Tiles that could not be fetched at all. */
  failed: number;
  /** Whether every tile has been asked for and answered. */
  done: boolean;
  /** Bitmaps decoded right now. */
  decoded: number;
}

export interface StreamIO<B> {
  fetch(tile: PyramidTile, signal: AbortSignal): Promise<{ blob: Blob; zoom: number }>;
  decode(blob: Blob, zoom: number, tile: PyramidTile): Promise<B>;
  close(bitmap: B): void;
}

/** Decodes running side by side: a tile's decode is a few draws on the main thread. */
const DECODE_LANES = 3;

export class TileStream<B = ImageBitmap> {
  readonly key: string;
  readonly tiles: readonly PyramidTile[];
  private readonly cap: number;
  private readonly io: StreamIO<B>;
  private readonly workers: number;
  private readonly byKey = new Map<string, number>();
  private readonly blobs: ({ blob: Blob; zoom: number } | null | undefined)[];
  /** Decoded bitmaps, least recently used first. */
  private readonly decoded = new Map<number, B>();
  private readonly decoding = new Map<number, Promise<void>>();
  private pinned = new Set<number>();
  /** Tiles a paint asked for before their blob was in — decoded the moment it lands. */
  private awaiting = new Set<number>();
  /** What the latest preview paint asked for: a queued decode outside it (and the pins) is dropped. */
  private wanted = new Set<number>();
  /** Decodes an export awaits (`ready`): never dropped, whatever the preview asks since. */
  private required = new Set<number>();
  private readonly queue: (() => void)[] = [];
  private lanes = 0;
  private readonly listeners = new Set<() => void>();
  private fetching: Promise<void> | null = null;
  private readonly stop = new AbortController();
  private counts = { fetched: 0, coarser: 0, failed: 0, answered: 0 };
  private snapshot: StreamProgress;
  private disposed = false;

  constructor(key: string, tiles: readonly PyramidTile[], cap: number, io: StreamIO<B>, workers = TILE_WORKERS) {
    this.key = key;
    this.tiles = tiles;
    this.cap = Math.max(1, cap);
    this.io = io;
    this.workers = Math.max(1, workers);
    this.blobs = tiles.map(() => undefined);
    tiles.forEach((t, i) => this.byKey.set(`${t.z}/${t.x}/${t.y}`, i));
    this.snapshot = this.measure();
  }

  /** Fetch every tile's blob, `workers` at a time, coarse levels first (the plan's order). Idempotent. */
  fetchAll(): Promise<void> {
    if (this.fetching) return this.fetching;
    let next = 0;
    const lane = async () => {
      while (!this.disposed) {
        const i = next++;
        if (i >= this.tiles.length) return;
        try {
          const got = await this.io.fetch(this.tiles[i], this.stop.signal);
          if (this.disposed) return;
          this.blobs[i] = got;
          this.counts.fetched += 1;
          if (got.zoom < this.tiles[i].z) this.counts.coarser += 1;
          if (this.awaiting.delete(i)) void this.decode(i);
        } catch {
          if (this.disposed) return;
          this.blobs[i] = null;
          this.counts.failed += 1;
        }
        this.counts.answered += 1;
        this.changed(false);
      }
    };
    this.fetching = Promise.all(Array.from({ length: this.workers }, lane)).then(() => undefined);
    return this.fetching;
  }

  /** The bitmap of tile `i`, if decoded — and marked as just used. */
  get(i: number): B | undefined {
    const bitmap = this.decoded.get(i);
    if (bitmap === undefined) return undefined;
    this.decoded.delete(i);
    this.decoded.set(i, bitmap);
    return bitmap;
  }

  /** The nearest decoded ancestor of tile `i` among the pyramid's, up to `up` zooms coarser. */
  ancestor(i: number, up = 6): number | undefined {
    const t = this.tiles[i];
    if (!t) return undefined;
    for (let k = 1; k <= up && t.z - k >= 0; k++) {
      const at = this.byKey.get(`${t.z - k}/${t.x >> k}/${t.y >> k}`);
      if (at !== undefined && this.decoded.has(at)) return at;
    }
    return undefined;
  }

  /** Decode what is missing among `tiles` in the background; the pins stay as they are. */
  request(tiles: readonly number[]): void {
    const missing = new Set<number>();
    this.wanted = new Set(tiles.slice(0, this.cap));
    for (const i of this.wanted) {
      if (this.decoded.has(i)) continue;
      if (this.blobs[i]) void this.decode(i);
      else if (this.blobs[i] === undefined) missing.add(i);
    }
    this.awaiting = missing;
  }

  /**
   * Pin `tiles` (in order, as many as the window holds — the nearest in time
   * first), decode the missing ones and resolve when every pinned tile that
   * has a blob is decoded. Waits for the fetch first when it is still running.
   */
  async ready(tiles: readonly number[], signal?: AbortSignal): Promise<void> {
    const pins = tiles.slice(0, this.cap);
    this.pinned = new Set(pins);
    if (pins.some((i) => this.blobs[i] === undefined)) await this.fetchAll();
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    await Promise.all(pins.filter((i) => this.blobs[i]).map((i) => this.decode(i, true)));
  }

  progress(): StreamProgress {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.stop.abort();
    for (const bitmap of this.decoded.values()) this.io.close(bitmap);
    this.decoded.clear();
    // Every queued decode is let go, so whoever awaits it (an export's
    // `ready`) is answered rather than left waiting forever.
    for (const job of this.queue.splice(0)) job();
  }

  private decode(i: number, required = false): Promise<void> {
    if (this.decoded.has(i)) return Promise.resolve();
    const got = this.blobs[i];
    if (!got) return Promise.resolve();
    if (required) this.required.add(i);
    const running = this.decoding.get(i);
    if (running) return running;
    const job = new Promise<void>((resolve) => {
      this.queue.push(() => {
        // A preview racing ahead queues faster than tiles decode: one it no
        // longer asks for would only evict one it does (a phone's window is
        // 128), so it leaves the queue undecoded.
        const stale = !this.required.has(i) && !this.pinned.has(i) && !this.wanted.has(i);
        if (this.disposed || stale) {
          this.decoding.delete(i);
          resolve();
          return;
        }
        this.lanes += 1;
        this.io
          .decode(got.blob, got.zoom, this.tiles[i])
          .then(
            (bitmap) => {
              if (this.disposed) {
                this.io.close(bitmap);
                return;
              }
              this.decoded.set(i, bitmap);
              this.evict();
              this.changed(true);
            },
            () => {
              /* a blob that will not decode leaves the coarser ground */
            },
          )
          .finally(() => {
            this.lanes -= 1;
            this.decoding.delete(i);
            this.required.delete(i);
            resolve();
            this.pump();
          });
      });
      this.pump();
    });
    this.decoding.set(i, job);
    return job;
  }

  private pump(): void {
    while (this.lanes < DECODE_LANES && this.queue.length) this.queue.shift()!();
  }

  /** Close the least recently used bitmaps past the cap, never a pinned one. */
  private evict(): void {
    if (this.decoded.size <= this.cap) return;
    for (const [i, bitmap] of this.decoded) {
      if (this.decoded.size <= this.cap) break;
      if (this.pinned.has(i)) continue;
      this.decoded.delete(i);
      this.io.close(bitmap);
    }
  }

  private measure(): StreamProgress {
    return {
      total: this.tiles.length,
      fetched: this.counts.fetched,
      coarser: this.counts.coarser,
      failed: this.counts.failed,
      done: this.counts.answered >= this.tiles.length,
      decoded: this.decoded.size,
    };
  }

  /** Tell the readers of the progress; and, when a bitmap landed, the painters. */
  private changed(landed: boolean): void {
    this.snapshot = this.measure();
    for (const listener of this.listeners) listener();
    announce(landed);
  }
}

// --- the registry ---------------------------------------------------------------

/** How long a stream nobody holds is kept — an export or a re-render may take it back. */
const RELEASE_MS = 4000;

const streams = new Map<string, { stream: TileStream; holders: number; timer: ReturnType<typeof setTimeout> | null }>();

/** The browser's own fetching and decoding. */
const BROWSER_IO: StreamIO<ImageBitmap> = {
  fetch: (tile, signal) => fetchPatch(tile, signal),
  decode: (blob, zoom, tile) => decodePatch(blob, zoom, tile, tileBox(tile.x, tile.y, tile.z)),
  close: (bitmap) => bitmap.close(),
};

/** Hold the stream of a pyramid, made on first use. Pair with `closeStream`. */
export function openStream(key: string, tiles: readonly PyramidTile[]): TileStream {
  let entry = streams.get(key);
  if (!entry) {
    entry = { stream: new TileStream(key, tiles, decodedBudget(), BROWSER_IO), holders: 0, timer: null };
    streams.set(key, entry);
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.holders += 1;
  return entry.stream;
}

/** Let go of a stream; it is disposed a little later if nobody took it back. */
export function closeStream(key: string): void {
  const entry = streams.get(key);
  if (!entry) return;
  entry.holders = Math.max(0, entry.holders - 1);
  if (entry.holders > 0 || entry.timer) return;
  entry.timer = setTimeout(() => {
    if (entry.holders > 0) return;
    entry.stream.dispose();
    streams.delete(key);
  }, RELEASE_MS);
}

/**
 * Hold the stream of `key` while `work` runs, if one is open — an export
 * frame's wait. Between two frames the release timer starts and the next
 * frame takes it back, so an export keeps its ground even when the editor
 * let the stream go (the camera changed under a frozen piece).
 */
export async function holdingStream<T>(key: string, work: (stream: TileStream) => Promise<T>): Promise<T | undefined> {
  const entry = streams.get(key);
  if (!entry) return undefined;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.holders += 1;
  try {
    return await work(entry.stream);
  } finally {
    closeStream(key);
  }
}

/** The stream of a pyramid, if the shell opened one — what a painter reads. */
export function streamFor(key: string | null | undefined): TileStream | undefined {
  return key ? streams.get(key)?.stream : undefined;
}

// --- «something landed» -----------------------------------------------------------

const painters = new Set<() => void>();
const readers = new Set<() => void>();
let announced: ReturnType<typeof setTimeout> | null = null;
let announcedLanded = false;
/** Changes within this are told as one — a stage repaints once for a burst of tiles. */
const ANNOUNCE_MS = 80;

function announce(landed: boolean): void {
  announcedLanded ||= landed;
  if (announced !== null || (!painters.size && !readers.size)) return;
  announced = setTimeout(() => {
    announced = null;
    const toPainters = announcedLanded;
    announcedLanded = false;
    for (const reader of readers) reader();
    if (toPainters) for (const painter of painters) painter();
  }, ANNOUNCE_MS);
}

/** Told when any stream's tiles are DECODED — what makes a paused stage draw them. */
export function onGroundLanded(painter: () => void): () => void {
  painters.add(painter);
  return () => painters.delete(painter);
}

/** Told when any stream's progress moves — blobs fetched, tiles decoded. */
function onStreamProgress(reader: () => void): () => void {
  readers.add(reader);
  return () => readers.delete(reader);
}

/** Where a pyramid's stream stands, as React state — null until the shell opens it. */
export function useStreamProgress(key: string | null | undefined): StreamProgress | null {
  return useSyncExternalStore(
    onStreamProgress,
    () => streamFor(key)?.progress() ?? null,
    () => null,
  );
}
