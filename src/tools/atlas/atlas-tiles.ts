/**
 * The atlas's OpenStreetMap ground — the suite's tiles exception, used once
 * more under its own rules (`local-first.md`): nothing is fetched until the
 * author turns the map on in this screen, the switch is off every time the
 * atlas opens, the device's consent is the one `osm-tiles.ts` keeps, the
 * tiles go through its fetcher (its IndexedDB cache, its timeout, its
 * fall-back to a parent tile), and the painter writes the credit into every
 * frame drawn over them.
 *
 * The atlas's canvas IS Web Mercator, so a tile is drawn as it comes — one
 * affine `drawImage` per tile — and TONED once when it lands (inverted and
 * greyed for a night look, greyed, or sepia), never per frame: the blend
 * modes that tone it are cheap on one opaque 256 px tile and wrong on a
 * frame with holes in it.
 *
 * While a tile is on its way its nearest loaded ancestor stands in, cut and
 * enlarged, so a zoom never flashes the bare ground.
 */

import { fetchPatch, TILE_WORKERS } from '../../shared/map/osm-tiles';
import type { WorldBox } from './atlas-flight';
import type { Ctx2D, TileLayer } from './atlas-paint';
import type { TileTone } from './atlas-settings';
import type { Affine } from './atlas-view';

const TILE = 256;
const MAX_Z = 19;
/** Tiles kept decoded (~256 kB each as a bitmap, twice with its toned copy). */
const KEEP = 360;
/** The most tiles one frame asks for — a coarser zoom past it. */
const FRAME_TILES = 96;

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Tone an opaque tile in place. */
function toneTile(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, tone: TileTone): void {
  if (tone === 'natural') return;
  const fill = (op: GlobalCompositeOperation, colour: string) => {
    ctx.globalCompositeOperation = op;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, TILE, TILE);
  };
  fill('saturation', '#808080');
  if (tone === 'night') {
    fill('difference', '#ffffff');
    fill('multiply', '#a9a7c4');
  } else if (tone === 'grey') {
    fill('multiply', '#d8d8d8');
  } else {
    fill('color', '#a3814f');
    fill('multiply', '#f4ead6');
  }
  ctx.globalCompositeOperation = 'source-over';
}

interface Entry {
  raw: ImageBitmap | null;
  toned: Canvas | null;
  state: 'pending' | 'ready' | 'failed';
  waiters: (() => void)[];
}

/** The tile zoom whose pixels match the frame's, and the tiles it needs. */
export function tilesFor(box: WorldBox, pxPerWorld: number): { z: number; x0: number; x1: number; y0: number; y1: number } {
  let z = Math.max(0, Math.min(MAX_Z, Math.round(Math.log2(Math.max(1, pxPerWorld) / TILE) + 0.15)));
  for (;;) {
    const n = 2 ** z;
    const x0 = Math.max(0, Math.floor(box.x0 * n));
    const x1 = Math.min(n - 1, Math.floor(box.x1 * n));
    const y0 = Math.max(0, Math.floor(box.y0 * n));
    const y1 = Math.min(n - 1, Math.floor(box.y1 * n));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= FRAME_TILES || z === 0) return { z, x0, x1, y0, y1 };
    z -= 1;
  }
}

export class AtlasTiles implements TileLayer {
  private entries = new Map<string, Entry>();
  private queue: { z: number; x: number; y: number }[] = [];
  private running = 0;
  private tone: TileTone = 'night';
  private controller = new AbortController();
  private disposed = false;

  /** `onLoad` is told a tile landed, so the caller can repaint. */
  constructor(private onLoad: () => void = () => {}) {}

  setTone(tone: TileTone): void {
    if (tone === this.tone) return;
    this.tone = tone;
    for (const e of this.entries.values()) e.toned = null;
  }

  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    for (const e of this.entries.values()) e.raw?.close();
    this.entries.clear();
    this.queue = [];
  }

  draw(ctx: Ctx2D, m: Affine, box: WorldBox, pxPerWorld: number, dim: { colour: string; alpha: number }): boolean {
    const plan = tilesFor(box, pxPerWorld);
    const wanted: { z: number; x: number; y: number }[] = [];
    let drawn = 0;
    for (let y = plan.y0; y <= plan.y1; y++) {
      for (let x = plan.x0; x <= plan.x1; x++) {
        const own = this.toned(plan.z, x, y);
        if (own) {
          this.blit(ctx, m, own, plan.z, x, y, 0, 0, TILE);
          drawn += 1;
          continue;
        }
        const key = `${plan.z}/${x}/${y}`;
        if (this.entries.get(key)?.state !== 'failed') wanted.push({ z: plan.z, x, y });
        // An ancestor stands in, cut to this tile's quarter of it.
        for (let up = 1; up <= 5 && plan.z - up >= 0; up++) {
          const parent = this.toned(plan.z - up, x >> up, y >> up);
          if (!parent) continue;
          const span = TILE / 2 ** up;
          const sx = (x - ((x >> up) << up)) * span;
          const sy = (y - ((y >> up) << up)) * span;
          this.blit(ctx, m, parent, plan.z, x, y, sx, sy, span);
          drawn += 1;
          break;
        }
      }
    }
    this.request(wanted);
    if (drawn > 0 && dim.alpha > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = dim.alpha;
      ctx.fillStyle = dim.colour;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalAlpha = 1;
    }
    return drawn > 0;
  }

  /** Resolves once every tile this frame needs has landed or failed — what an export waits on. */
  ready(box: WorldBox, pxPerWorld: number, timeoutMs = 25_000): Promise<void> {
    const plan = tilesFor(box, pxPerWorld);
    const waits: Promise<void>[] = [];
    const wanted: { z: number; x: number; y: number }[] = [];
    for (let y = plan.y0; y <= plan.y1; y++) {
      for (let x = plan.x0; x <= plan.x1; x++) {
        const key = `${plan.z}/${x}/${y}`;
        const e = this.entries.get(key);
        if (e?.state === 'ready' || e?.state === 'failed') continue;
        wanted.push({ z: plan.z, x, y });
        waits.push(
          new Promise<void>((resolve) => {
            const entry = this.entries.get(key);
            if (entry) entry.waiters.push(resolve);
            else this.entries.set(key, { raw: null, toned: null, state: 'pending', waiters: [resolve] });
          }),
        );
      }
    }
    if (!waits.length) return Promise.resolve();
    this.request(wanted, true);
    return Promise.race([Promise.all(waits).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  }

  private toned(z: number, x: number, y: number): Canvas | null {
    const e = this.entries.get(`${z}/${x}/${y}`);
    if (!e || e.state !== 'ready' || !e.raw) return null;
    if (!e.toned) {
      const c = makeCanvas(TILE, TILE);
      const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (!g) return null;
      g.drawImage(e.raw, 0, 0);
      toneTile(g, this.tone);
      e.toned = c;
    }
    // Recently used: move to the end of the map's order.
    const key = `${z}/${x}/${y}`;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.toned;
  }

  private blit(ctx: Ctx2D, m: Affine, img: Canvas, z: number, x: number, y: number, sx: number, sy: number, span: number): void {
    const k = TILE * 2 ** z; // tile pixels per world unit
    const wx = x / 2 ** z;
    const wy = y / 2 ** z;
    ctx.setTransform(m.a / k, m.b / k, m.c / k, m.d / k, m.a * wx + m.c * wy + m.e, m.b * wx + m.d * wy + m.f);
    // A hair larger than the tile, so the seams of a turned map do not show.
    ctx.drawImage(img, sx, sy, span, span, -0.35, -0.35, TILE + 0.7, TILE + 0.7);
  }

  private request(tiles: { z: number; x: number; y: number }[], keepOthers = false): void {
    if (this.disposed) return;
    const fresh = tiles.filter((t) => {
      const e = this.entries.get(`${t.z}/${t.x}/${t.y}`);
      return !e || (e.state === 'pending' && !e.raw && !this.inFlight.has(`${t.z}/${t.x}/${t.y}`));
    });
    // The view moved: what it no longer shows is not worth the wait.
    this.queue = keepOthers ? [...this.queue, ...fresh] : fresh;
    this.pump();
  }

  private inFlight = new Set<string>();

  private pump(): void {
    while (this.running < TILE_WORKERS + 2 && this.queue.length) {
      const job = this.queue.shift() as { z: number; x: number; y: number };
      const key = `${job.z}/${job.x}/${job.y}`;
      if (this.inFlight.has(key)) continue;
      const existing = this.entries.get(key);
      if (existing && existing.state !== 'pending') continue;
      if (!existing) this.entries.set(key, { raw: null, toned: null, state: 'pending', waiters: [] });
      this.inFlight.add(key);
      this.running += 1;
      void this.load(job, key).finally(() => {
        this.inFlight.delete(key);
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async load(job: { z: number; x: number; y: number }, key: string): Promise<void> {
    const entry = this.entries.get(key) as Entry;
    try {
      const { blob, zoom } = await fetchPatch(job, this.controller.signal);
      const source = await createImageBitmap(blob);
      let raw = source;
      if (zoom !== job.z) {
        // The server gave a parent: cut this tile's part out of it.
        const up = job.z - zoom;
        const span = TILE / 2 ** up;
        const c = makeCanvas(TILE, TILE);
        const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
        g.drawImage(source, (job.x - ((job.x >> up) << up)) * span, (job.y - ((job.y >> up) << up)) * span, span, span, 0, 0, TILE, TILE);
        source.close();
        raw = await createImageBitmap(c);
      }
      if (this.disposed) {
        raw.close();
        return;
      }
      entry.raw = raw;
      entry.state = 'ready';
    } catch {
      entry.state = 'failed';
    }
    for (const w of entry.waiters.splice(0)) w();
    this.evict();
    if (!this.disposed) this.onLoad();
  }

  private evict(): void {
    if (this.entries.size <= KEEP) return;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= KEEP) break;
      if (e.state === 'pending') continue;
      e.raw?.close();
      this.entries.delete(key);
    }
  }
}
