/**
 * What the Mosaic instrument MEASURES of a picture: a 6 × 6 grid of mean
 * colours (108 bytes, sRGB), read once off a thumbnail and kept — in the
 * device's `measures` store and in the `.mosaic.json` (the maintainer's pick,
 * 2026-10-31: «Grille 6×6»). Everything else derives from it here:
 *
 * - a LEVEL — the grid folded to 1 × 1 (the mean colour), 2 × 2 (quarters)
 *   or 3 × 3 (zones) — is what a cell of the target is compared against;
 * - OKLab, so a distance weighs the shadows the way the eye does;
 * - base64, the grid's shape in a document.
 *
 * The same arithmetic reads the TARGET: a cell of it is a 6 × 6 grid too
 * (`match.ts`), so a picture and a cell are compared like with like.
 *
 * Pure and DOM-free: a raster is RGBA bytes with a size, as `ImageData`
 * hands them (`thumb-metrics.ts`'s `Raster`). `docs/mosaic.md` §3–§4.
 */

import type { Raster } from '../media/thumb-metrics';

/** The grid's side: 6 cells, 36 colours, 108 numbers. */
export const GRID = 6;
export const GRID_CELLS = GRID * GRID;
export const GRID_BYTES = GRID_CELLS * 3;

export type Level = 1 | 2 | 3;
export type Space = 'oklab' | 'rgb';

/** How many numbers a descriptor of `level` holds. */
export function dimsOf(level: Level): number {
  return level * level * 3;
}

/**
 * The mean RGB of the raster inside `[x0, x1) × [y0, y1)`, folded onto a
 * `GRID × GRID` grid, row-major, written at `out[offset…]` as 0..255 values.
 * A rectangle narrower than the grid gives several grid cells the same pixel
 * rather than an empty one.
 */
export function gridOfRect(
  raster: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: { [i: number]: number } = new Uint8Array(GRID_BYTES),
  offset = 0,
): typeof out {
  const { data, width } = raster;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  for (let gy = 0; gy < GRID; gy++) {
    const ya = y0 + Math.floor((gy * h) / GRID);
    const yb = Math.max(ya + 1, y0 + Math.floor(((gy + 1) * h) / GRID));
    for (let gx = 0; gx < GRID; gx++) {
      const xa = x0 + Math.floor((gx * w) / GRID);
      const xb = Math.max(xa + 1, x0 + Math.floor(((gx + 1) * w) / GRID));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = ya; y < yb && y < raster.height; y++) {
        for (let x = xa; x < xb && x < width; x++) {
          const o = (y * width + x) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          n++;
        }
      }
      const o = offset + (gy * GRID + gx) * 3;
      const inv = n ? 1 / n : 0;
      out[o] = Math.round(r * inv);
      out[o + 1] = Math.round(g * inv);
      out[o + 2] = Math.round(b * inv);
    }
  }
  return out;
}

/** The tile a cell draws: a 16:9 cover crop of the picture, kept on the device at this size. */
export const TILE_W = 160;
export const TILE_H = 90;

/**
 * The source rectangle of a `sw × sh` picture that COVERS a `dw × dh` frame,
 * centred — what a cell shows of its picture, and what its grid is measured
 * on, so a portrait and a panorama are read as they will be drawn.
 */
export function coverSource(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return { x: 0, y: 0, w: Math.max(1, sw), h: Math.max(1, sh) };
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale;
  const h = dh / scale;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

/** The whole raster's 6 × 6 grid — a picture's measure. */
export function gridOf(raster: Raster): Uint8Array {
  const out = new Uint8Array(GRID_BYTES);
  gridOfRect(raster, 0, 0, raster.width, raster.height, out, 0);
  return out;
}

/** A grid as a document keeps it: 108 bytes in base64 (144 characters). */
export function encodeGrid(grid: Uint8Array): string {
  let s = '';
  for (let i = 0; i < grid.length; i++) s += String.fromCharCode(grid[i]);
  return btoa(s);
}

/** The grid back from its base64, or null when the text is not one. */
export function decodeGrid(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || text.length !== 144 || !/^[A-Za-z0-9+/]+=*$/.test(text)) return null;
  let s: string;
  try {
    s = atob(text);
  } catch {
    return null;
  }
  if (s.length !== GRID_BYTES) return null;
  const out = new Uint8Array(GRID_BYTES);
  for (let i = 0; i < GRID_BYTES; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The mean colour of a grid, as three 0..255 values. */
export function meanOf(grid: ArrayLike<number>, offset = 0): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let c = 0; c < GRID_CELLS; c++) {
    const o = offset + c * 3;
    r += grid[o];
    g += grid[o + 1];
    b += grid[o + 2];
  }
  return [Math.round(r / GRID_CELLS), Math.round(g / GRID_CELLS), Math.round(b / GRID_CELLS)];
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * sRGB 0..255 to OKLab, each axis × 100 so a distance is in the same order
 * of magnitude as an RGB one (L 0..100, a and b about −40..40).
 */
export function oklab(r: number, g: number, b: number, out: { [i: number]: number }, o = 0): void {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  out[o] = 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
  out[o + 1] = 100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s);
  out[o + 2] = 100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}

/** `n` grids of RGB bytes (`n × 108`) converted colour by colour to OKLab. */
export function oklabOf(grids: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n * GRID_BYTES);
  for (let o = 0; o < n * GRID_BYTES; o += 3) oklab(grids[o], grids[o + 1], grids[o + 2], out, o);
  return out;
}

/**
 * `n` 6 × 6 grids folded to `level × level` blocks by averaging, in whatever
 * space the grids are in: `n × dimsOf(level)` numbers. Level 1 is the mean
 * colour; 2 the quarters (3 × 3 grid cells each); 3 the nine zones (2 × 2).
 */
export function levelOf(grids: ArrayLike<number>, n: number, level: Level): Float32Array {
  const dims = dimsOf(level);
  const out = new Float32Array(n * dims);
  const block = GRID / level;
  const inv = 1 / (block * block);
  for (let i = 0; i < n; i++) {
    for (let ky = 0; ky < level; ky++) {
      for (let kx = 0; kx < level; kx++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let y = ky * block; y < (ky + 1) * block; y++) {
          for (let x = kx * block; x < (kx + 1) * block; x++) {
            const o = i * GRID_BYTES + (y * GRID + x) * 3;
            r += grids[o];
            g += grids[o + 1];
            b += grids[o + 2];
          }
        }
        const o = i * dims + (ky * level + kx) * 3;
        out[o] = r * inv;
        out[o + 1] = g * inv;
        out[o + 2] = b * inv;
      }
    }
  }
  return out;
}

/** The descriptors a matching compares: `n` grids at `level`, in `space`. */
export function descriptorsOf(grids: ArrayLike<number>, n: number, level: Level, space: Space): Float32Array {
  return levelOf(space === 'oklab' ? oklabOf(grids, n) : grids, n, level);
}
