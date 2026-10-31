/**
 * How a TARGET is rebuilt out of the library: its cells measured like the
 * pictures (a 6 × 6 grid each), compared at one level in one space, each
 * cell given the nearest picture — the first of its best three that is not
 * already its left or upper neighbour, when asked. Brute force: 1 300 cells
 * × 10 000 pictures × 27 numbers is a few hundred million multiply-adds, a
 * fraction of a second; an index comes only if a real library proves it
 * slow (`docs/mosaic.md` §4.3).
 *
 * Also here, since the chain modes need them and they are arithmetic: which
 * cell to dive into, which picture to pull back to, and how to force a
 * picture into the cell that resembles it most.
 *
 * Pure and DOM-free. The one DOM step — drawing the target small enough to
 * read — happens in the painter, which hands a raster here.
 */

import type { Raster } from '../media/thumb-metrics';
import { GRID_BYTES, GRID_CELLS, gridOfRect, oklab } from './measure';

/** The cells a stage of `width × height` is cut into for cells `cellPx` wide, the frame's shape. */
export interface GridShape {
  cols: number;
  rows: number;
  /** A cell's width and height in stage units — fractional, so the grid fills the stage exactly. */
  cw: number;
  ch: number;
}

/** A cell's width in stage pixels, bounded as the setting is. */
export const MIN_CELL_PX = 12;
export const MAX_CELL_PX = 160;

/**
 * Cells the shape of the frame: `cols` across from the cell width, the rows
 * then follow from the frame's aspect, both at least 2. A cell zoomed is
 * then exactly the frame, so a chain step ends on the whole picture.
 */
export function gridShape(width: number, height: number, cellPx: number): GridShape {
  const px = Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, cellPx));
  const cols = Math.max(2, Math.round(width / px));
  const cw = width / cols;
  const ch = cw * (height / width);
  const rows = Math.max(2, Math.round(height / ch));
  return { cols, rows, cw, ch: height / rows };
}

/**
 * The target's cells, each a 6 × 6 grid (`cols × rows × 108` bytes, cells
 * row-major), read off a raster of the target at any size — a cell's grid
 * is the box mean of its share of the raster.
 */
export function cellGridsOf(raster: Raster, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows * GRID_BYTES);
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor((j * raster.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * raster.height) / rows));
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor((i * raster.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * raster.width) / cols));
      gridOfRect(raster, x0, y0, x1, y1, out, (j * cols + i) * GRID_BYTES);
    }
  }
  return out;
}

export interface MatchOptions {
  /** Never the same picture as the cell to the left or above (the lab's rule, on by default). */
  distinctNeighbours?: boolean;
  /** Picture indexes that may not be used — not measured, or failed. */
  exclude?: ReadonlySet<number>;
}

export interface Matching {
  /** The picture index each cell shows, row-major; −1 where no picture could be used. */
  ids: Int32Array;
  /** How far the picture is from the cell, as an RMS per number of the descriptor. */
  dist: Float32Array;
}

/**
 * Every cell's picture. `cells` and `pictures` are descriptors of the same
 * `dims` (one level, one space); `cells` has `cols × rows` of them.
 */
export function matchCells(
  cells: Float32Array,
  pictures: Float32Array,
  dims: number,
  cols: number,
  rows: number,
  opts: MatchOptions = {},
): Matching {
  const distinct = opts.distinctNeighbours !== false;
  const exclude = opts.exclude;
  const n = Math.floor(pictures.length / dims);
  const count = cols * rows;
  const ids = new Int32Array(count).fill(-1);
  const dist = new Float32Array(count);
  const b = [-1, -1, -1];
  const bd = [Infinity, Infinity, Infinity];
  for (let c = 0; c < count; c++) {
    b[0] = b[1] = b[2] = -1;
    bd[0] = bd[1] = bd[2] = Infinity;
    const co = c * dims;
    for (let j = 0; j < n; j++) {
      if (exclude && exclude.has(j)) continue;
      const jo = j * dims;
      let d = 0;
      for (let q = 0; q < dims; q++) {
        const e = cells[co + q] - pictures[jo + q];
        d += e * e;
        if (d >= bd[2]) break;
      }
      if (d >= bd[2]) continue;
      if (d < bd[0]) {
        bd[2] = bd[1];
        b[2] = b[1];
        bd[1] = bd[0];
        b[1] = b[0];
        bd[0] = d;
        b[0] = j;
      } else if (d < bd[1]) {
        bd[2] = bd[1];
        b[2] = b[1];
        bd[1] = d;
        b[1] = j;
      } else {
        bd[2] = d;
        b[2] = j;
      }
    }
    let pick = 0;
    if (distinct) {
      const i = c % cols;
      const left = i > 0 ? ids[c - 1] : -1;
      const up = c >= cols ? ids[c - cols] : -1;
      while (pick < 2 && b[pick + 1] >= 0 && (b[pick] === left || b[pick] === up)) pick++;
    }
    ids[c] = b[pick];
    dist[c] = b[pick] >= 0 ? Math.sqrt(bd[pick] / dims) : Infinity;
  }
  return { ids, dist };
}

export interface PickOptions {
  /** The picture the mosaic shows — never dived into from itself. */
  target: number;
  /** Pictures lately shown, not chosen again. */
  history?: readonly number[];
  /** The seeded generator (`lib/prng.ts`), so a replay picks the same cells. */
  rnd: () => number;
  /** Among what share of the best-scored cells the pick is drawn (0..1). */
  share?: number;
}

/**
 * The cell a chain dives into: a well-matched one, near the centre, whose
 * picture is neither the target nor lately shown — drawn at random among the
 * best `share` (15 %) so a replay differs by its seed alone. −1 when no cell
 * qualifies.
 */
export function pickCell(m: Matching, cols: number, rows: number, opts: PickOptions): number {
  const history = opts.history ?? [];
  const scored: { c: number; s: number }[] = [];
  for (let c = 0; c < m.ids.length; c++) {
    const id = m.ids[c];
    if (id < 0 || id === opts.target || history.includes(id)) continue;
    const i = c % cols;
    const j = (c - i) / cols;
    const dx = (i + 0.5) / cols - 0.5;
    const dy = (j + 0.5) / rows - 0.5;
    scored.push({ c, s: m.dist[c] + 40 * Math.hypot(dx, dy) });
  }
  if (!scored.length) return -1;
  scored.sort((a, b) => a.s - b.s || a.c - b.c);
  const span = Math.max(1, Math.floor(scored.length * (opts.share ?? 0.15)));
  return scored[Math.min(span - 1, Math.floor(opts.rnd() * span))].c;
}

/**
 * The picture a chain pulls back INTO: among `tries` random pictures, the one
 * whose grid holds the colour closest to the current picture's mean — in
 * OKLab, so the seam reads right. `lab` is every picture's grid in OKLab
 * (`oklabOf`). −1 when the library has no other picture.
 */
export function pickNextTarget(
  lab: Float32Array,
  n: number,
  current: number,
  opts: { history?: readonly number[]; rnd: () => number; tries?: number },
): number {
  if (n < 2) return -1;
  const history = opts.history ?? [];
  const cur = [0, 0, 0];
  for (let c = 0; c < GRID_CELLS; c++) {
    const o = current * GRID_BYTES + c * 3;
    cur[0] += lab[o];
    cur[1] += lab[o + 1];
    cur[2] += lab[o + 2];
  }
  cur[0] /= GRID_CELLS;
  cur[1] /= GRID_CELLS;
  cur[2] /= GRID_CELLS;
  let best = -1;
  let bestD = Infinity;
  const tries = opts.tries ?? 24;
  for (let t = 0; t < tries; t++) {
    const cand = Math.floor(opts.rnd() * n);
    if (cand === current || history.includes(cand)) continue;
    let d = Infinity;
    for (let c = 0; c < GRID_CELLS; c++) {
      const o = cand * GRID_BYTES + c * 3;
      const e0 = lab[o] - cur[0];
      const e1 = lab[o + 1] - cur[1];
      const e2 = lab[o + 2] - cur[2];
      d = Math.min(d, e0 * e0 + e1 * e1 + e2 * e2);
    }
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  if (best >= 0) return best;
  for (let cand = 0; cand < n; cand++) if (cand !== current && !history.includes(cand)) return cand;
  return (current + 1) % n;
}

/**
 * The cell of a matching that resembles picture `picture` most takes it: a
 * new `ids` and the cell changed. The zoom-out's seam — the picture on screen
 * must be a cell of the next target, whatever the library holds.
 */
export function forceInto(
  m: Matching,
  cells: Float32Array,
  pictures: Float32Array,
  dims: number,
  picture: number,
): { ids: Int32Array; cell: number } {
  const po = picture * dims;
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < m.ids.length; c++) {
    let d = 0;
    for (let q = 0; q < dims; q++) {
      const e = cells[c * dims + q] - pictures[po + q];
      d += e * e;
    }
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const ids = new Int32Array(m.ids);
  ids[best] = picture;
  return { ids, cell: best };
}

/** The mean colour of every cell in OKLab × 100 — what the tint veil could be computed from. */
export function cellMeansLab(cellGrids: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let c = 0; c < count; c++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < GRID_CELLS; k++) {
      const o = c * GRID_BYTES + k * 3;
      r += cellGrids[o];
      g += cellGrids[o + 1];
      b += cellGrids[o + 2];
    }
    oklab(r / GRID_CELLS, g / GRID_CELLS, b / GRID_CELLS, out, c * 3);
  }
  return out;
}
