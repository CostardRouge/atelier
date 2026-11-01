/**
 * The mosaic's FRAME (his ask, 2026-11-01: «changer l'aspect ratio … la
 * zone de la photo concernée … que le centre de l'image en carré»): the
 * shape of the rebuilt picture, and which part of the target it rebuilds.
 *
 * - The ASPECT is a setting of the document; the stage, its cells (the
 *   frame's shape, `match.ts`) and every export follow it.
 * - The CROP is where on the target that frame sits: a centre and a scale,
 *   both 0..1 of the target, the scale 1 being the largest frame of that
 *   aspect the picture holds. Aspect-free on purpose — changing the aspect
 *   keeps the centre and the share, never a stale rectangle.
 * - A tile is measured as a 16:9 crop (`TILE_W × TILE_H`); a cell of
 *   another shape shows only part of it, so its 6 × 6 grid is RESAMPLED to
 *   that part (`cropGrids`) — a square cell is compared on its square.
 *
 * Pure and DOM-free.
 */

import { GRID, GRID_BYTES, TILE_H, TILE_W } from './measure';

export const ASPECTS = ['16:9', '3:2', '4:3', '1:1', '4:5', '9:16'] as const;
export type AspectId = (typeof ASPECTS)[number];
export const DEFAULT_ASPECT: AspectId = '16:9';

/** The tile's own shape — what every grid was measured on. */
export const TILE_ASPECT = TILE_W / TILE_H;

/** `16:9` → 1.777…; an unknown id reads as the default. */
export function aspectRatio(id: string): number {
  const m = /^(\d+):(\d+)$/.exec(id);
  if (!m || !(ASPECTS as readonly string[]).includes(id)) return 16 / 9;
  return Number(m[1]) / Number(m[2]);
}

export function isAspect(v: unknown): v is AspectId {
  return typeof v === 'string' && (ASPECTS as readonly string[]).includes(v);
}

/** Where the frame sits on the target: its centre and its share, all 0..1. */
export interface Crop {
  cx: number;
  cy: number;
  /** 1 = the largest frame of the aspect the picture holds; down to `MIN_CROP_SCALE`. */
  scale: number;
}

export const MIN_CROP_SCALE = 0.1;
export const WHOLE: Crop = { cx: 0.5, cy: 0.5, scale: 1 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The frame's rectangle on a `W × H` picture, in its pixels, inside it: the
 * largest rectangle of `aspect` the picture holds, scaled, centred on the
 * crop's centre and pushed back in where it would overhang.
 */
export function cropRect(W: number, H: number, aspect: number, crop: Crop = WHOLE): Rect {
  if (!(W > 0 && H > 0 && aspect > 0)) return { x: 0, y: 0, w: Math.max(1, W), h: Math.max(1, H) };
  const maxW = Math.min(W, H * aspect);
  const scale = clamp(Number.isFinite(crop.scale) ? crop.scale : 1, MIN_CROP_SCALE, 1);
  const w = maxW * scale;
  const h = w / aspect;
  const cx = (Number.isFinite(crop.cx) ? crop.cx : 0.5) * W;
  const cy = (Number.isFinite(crop.cy) ? crop.cy : 0.5) * H;
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
}

/** The crop that names `rect` exactly — what is stored once a drag ends (the clamped centre). */
export function cropOfRect(W: number, H: number, aspect: number, rect: Rect): Crop {
  const maxW = Math.min(W, H * aspect);
  return {
    cx: clamp((rect.x + rect.w / 2) / W, 0, 1),
    cy: clamp((rect.y + rect.h / 2) / H, 0, 1),
    scale: clamp(maxW > 0 ? rect.w / maxW : 1, MIN_CROP_SCALE, 1),
  };
}

/** A stored crop read back: three finite numbers in range, or undefined. */
export function readCrop(raw: unknown): Crop | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!ok(r.cx) || !ok(r.cy) || !ok(r.scale)) return undefined;
  return { cx: clamp(r.cx as number, 0, 1), cy: clamp(r.cy as number, 0, 1), scale: clamp(r.scale as number, MIN_CROP_SCALE, 1) };
}

/** Whether a crop is the whole frame — what need not be stored. */
export function isWhole(crop: Crop | undefined): boolean {
  return !crop || (Math.abs(crop.cx - 0.5) < 1e-4 && Math.abs(crop.cy - 0.5) < 1e-4 && crop.scale >= 1 - 1e-4);
}

/**
 * The part of a 6 × 6 grid measured on a `srcAspect` picture that a
 * `dstAspect` cell shows (its centre cover crop), in grid units 0..6.
 */
export function gridWindow(srcAspect: number, dstAspect: number): Rect {
  if (dstAspect < srcAspect) {
    const w = (GRID * dstAspect) / srcAspect;
    return { x: (GRID - w) / 2, y: 0, w, h: GRID };
  }
  const h = (GRID * srcAspect) / dstAspect;
  return { x: 0, y: (GRID - h) / 2, w: GRID, h };
}

/**
 * One 6 × 6 grid resampled to `win` (grid units), area-weighted: each output
 * cell is the mean of the source cells it overlaps, each by the share it
 * covers. Written at `out[outOffset…]`.
 */
export function resampleGrid(src: ArrayLike<number>, srcOffset: number, win: Rect, out: { [i: number]: number }, outOffset: number): void {
  const sw = win.w / GRID;
  const sh = win.h / GRID;
  for (let gy = 0; gy < GRID; gy++) {
    const y0 = win.y + gy * sh;
    const y1 = y0 + sh;
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = win.x + gx * sw;
      const x1 = x0 + sw;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let j = Math.max(0, Math.floor(y0)); j < Math.min(GRID, Math.ceil(y1)); j++) {
        const wy = Math.min(y1, j + 1) - Math.max(y0, j);
        if (wy <= 0) continue;
        for (let i = Math.max(0, Math.floor(x0)); i < Math.min(GRID, Math.ceil(x1)); i++) {
          const wx = Math.min(x1, i + 1) - Math.max(x0, i);
          if (wx <= 0) continue;
          const w = wx * wy;
          const o = srcOffset + (j * GRID + i) * 3;
          r += src[o] * w;
          g += src[o + 1] * w;
          b += src[o + 2] * w;
          wsum += w;
        }
      }
      const o = outOffset + (gy * GRID + gx) * 3;
      const inv = wsum > 0 ? 1 / wsum : 0;
      out[o] = r * inv;
      out[o + 1] = g * inv;
      out[o + 2] = b * inv;
    }
  }
}

/**
 * `n` grids measured on 16:9 tiles, as a `dstAspect` cell shows them. The
 * same array back when the aspect is the tile's own.
 */
export function cropGrids(grids: ArrayLike<number>, n: number, dstAspect: number, srcAspect = TILE_ASPECT): ArrayLike<number> {
  if (Math.abs(dstAspect - srcAspect) < 1e-3) return grids;
  const win = gridWindow(srcAspect, dstAspect);
  const out = new Float32Array(n * GRID_BYTES);
  for (let i = 0; i < n; i++) resampleGrid(grids, i * GRID_BYTES, win, out, i * GRID_BYTES);
  return out;
}
