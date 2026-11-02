/**
 * The TILES a stage draws, as bitmaps: each picture's 160 × 90 cover crop
 * read from the device's `tiles` store (`mosaic-store.ts`), or — for a
 * picture whose tile was evicted — fetched back from the instance's
 * thumbnail, cut here and kept again. Bounded: a bitmap is ~58 kB, and a
 * stage shows at most a few thousand cells, so the cache keeps the last
 * `limit` (fewer on a constrained device) and lets the oldest go.
 */

import { deviceClass } from '../../shared/lib/device-class';
import { TILE_H, TILE_W, coverSource } from '../../shared/mosaic/measure';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { getTile, putTiles } from './mosaic-store';

/** How many tile bitmaps are held at once: ~115 MB on a computer, ~35 MB on a phone. */
export function tileCacheLimit(): number {
  return deviceClass() === 'constrained' ? 600 : 2000;
}

async function cropToTile(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  try {
    const src = coverSource(bitmap.width, bitmap.height, TILE_W, TILE_H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, TILE_W, TILE_H);
  } finally {
    bitmap.close();
  }
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no tile'))), 'image/jpeg', 0.82));
}

export class TileBitmaps {
  private held = new Map<number, ImageBitmap>();
  private pending = new Map<number, Promise<ImageBitmap | null>>();
  private limit = tileCacheLimit();

  constructor(
    private instance: string,
    private client: WinnowClient | null,
  ) {}

  /** The cache's size from the Performance panel; the oldest go at the next load past it. */
  setLimit(limit: number): void {
    this.limit = Math.max(100, limit);
  }

  /** The bitmap held for picture `id` right now, or null — no fetch, no reordering (a zoom's cells read it). */
  peek(id: number): ImageBitmap | null {
    return this.held.get(id) ?? null;
  }

  /** The bitmap for picture `id`, or null when neither the device nor the instance can give it. */
  get(id: number): Promise<ImageBitmap | null> {
    const have = this.held.get(id);
    if (have) {
      // Most recently used last: a Map iterates in insertion order.
      this.held.delete(id);
      this.held.set(id, have);
      return Promise.resolve(have);
    }
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;
    const p = this.load(id).finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }

  private async load(id: number): Promise<ImageBitmap | null> {
    let blob = await getTile(this.instance, id);
    if (!blob && this.client) {
      try {
        const thumb = await this.client.fetchFile(this.client.thumbUrl(id), `${id}.jpg`, 'image/jpeg', 0);
        blob = await cropToTile(thumb);
        await putTiles(this.instance, new Map([[id, blob]]));
      } catch {
        blob = undefined;
      }
    }
    if (!blob) return null;
    try {
      const bitmap = await createImageBitmap(blob);
      this.held.set(id, bitmap);
      while (this.held.size > this.limit) {
        const oldest = this.held.keys().next().value;
        if (oldest === undefined) break;
        // Dropped, never closed: a mosaic being painted may hold more tiles than the cache.
        this.held.delete(oldest);
      }
      return bitmap;
    } catch {
      return null;
    }
  }

  /** Every bitmap for `ids`, in order; null where one could not be had. */
  all(ids: Iterable<number>, signal?: AbortSignal): Promise<(ImageBitmap | null)[]> {
    const list = [...new Set(ids)];
    return Promise.all(list.map((id) => (signal?.aborted ? Promise.resolve(null) : this.get(id))));
  }

  dispose(): void {
    this.held.clear();
  }
}
