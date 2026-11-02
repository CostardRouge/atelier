/**
 * The SHARP pictures a zoom shows (lab 4, L4): for cells grown past their
 * 160 × 90 tile on screen, the instance's thumbnail (~400 px), and past that
 * its proxy, fetched only for the cells in view (`zoom-detail.ts` decides
 * which and at what level), four at a time, the newest view first — a view
 * left before its pictures arrived drops what it had not started.
 *
 * Bounded twice: thumbnails and proxies are held in their own LRU (a proxy
 * decoded no wider than 1280 px), fewer on a constrained device. A bitmap is
 * DROPPED from the cache, never closed: the stage may be drawing it. A clip
 * has no picture proxy, its thumbnail (its poster) stands at both levels.
 */

import { deviceClass } from '../../shared/lib/device-class';
import type { DetailLevel } from '../../shared/mosaic/zoom-detail';
import type { WinnowClient } from '../../shared/sources/winnow/client';

/** The widest a proxy is decoded: a cell this wide on screen is already most of it. */
const PROXY_MAX_W = 1280;
const AT_ONCE = 4;

export interface SharpWant {
  id: number;
  kind: 'photo' | 'clip';
  level: Exclude<DetailLevel, 'tile'>;
}

export class SharpPictures {
  private thumbs = new Map<number, ImageBitmap>();
  private proxies = new Map<number, ImageBitmap>();
  private failed = new Set<string>();
  private queue: SharpWant[] = [];
  private running = 0;
  private listeners = new Set<() => void>();
  private closed = true;
  private readonly limits = deviceClass() === 'constrained' ? { thumb: 60, proxy: 6 } : { thumb: 220, proxy: 24 };

  constructor(private client: WinnowClient) {}

  /** The sharpest picture held for `id` up to `level`, or null — never a fetch. */
  get(id: number, level: DetailLevel): ImageBitmap | null {
    if (level === 'tile') return null;
    if (level === 'proxy') {
      const p = this.proxies.get(id);
      if (p) return p;
    }
    return this.thumbs.get(id) ?? null;
  }

  /** Ask for these pictures, the view's own, in its order; what an earlier view asked and was not started is dropped. */
  want(wants: readonly SharpWant[]): void {
    if (this.closed) return;
    this.queue = wants.filter((w) => {
      const level = w.kind === 'clip' ? 'thumb' : w.level;
      const key = `${level}:${w.id}`;
      return !this.failed.has(key) && !(level === 'proxy' ? this.proxies.has(w.id) : this.thumbs.has(w.id));
    });
    this.pump();
  }

  /** Told when a picture lands, so the stage redraws. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Live while a stage holds it: the effect that opens it closes it, and may open it again — React's StrictMode
   * runs an effect's cleanup and the effect once more on the same instance, which a one-way dispose left dead.
   * Closing drops the queue and the pictures; a load in flight lands nowhere.
   */
  open(): () => void {
    this.closed = false;
    return () => {
      this.closed = true;
      this.queue = [];
      this.thumbs.clear();
      this.proxies.clear();
    };
  }

  private pump(): void {
    while (this.running < AT_ONCE && this.queue.length) {
      const w = this.queue.shift();
      if (!w) break;
      this.running += 1;
      void this.load(w).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async load(w: SharpWant): Promise<void> {
    const level = w.kind === 'clip' ? 'thumb' : w.level;
    const key = `${level}:${w.id}`;
    const into = level === 'proxy' ? this.proxies : this.thumbs;
    if (into.has(w.id) || this.failed.has(key)) return;
    try {
      const url = level === 'proxy' ? this.client.proxyUrl(w.id) : this.client.thumbUrl(w.id);
      const file = await this.client.fetchFile(url, `${w.id}.jpg`, 'image/jpeg', 0);
      let bitmap = await createImageBitmap(file);
      if (level === 'proxy' && bitmap.width > PROXY_MAX_W) {
        const smaller = await createImageBitmap(bitmap, { resizeWidth: PROXY_MAX_W, resizeHeight: Math.round((bitmap.height * PROXY_MAX_W) / bitmap.width), resizeQuality: 'high' });
        // Ours alone, never drawn: closed at once.
        bitmap.close();
        bitmap = smaller;
      }
      if (this.closed) return;
      into.set(w.id, bitmap);
      const limit = level === 'proxy' ? this.limits.proxy : this.limits.thumb;
      while (into.size > limit) {
        const oldest = into.keys().next().value;
        if (oldest === undefined) break;
        // Dropped, never closed: the stage may be drawing it this frame.
        into.delete(oldest);
      }
      for (const l of this.listeners) l();
    } catch {
      this.failed.add(key);
    }
  }
}
