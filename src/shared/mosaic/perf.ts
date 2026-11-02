/**
 * The PERFORMANCE preferences of the Mosaic instrument (his ask,
 * 2026-11-01: «tout un panel pour gérer la performance et les animations ou
 * le worker … au peigne fin») and the planning of a matching in LOTS.
 *
 * Preferences of the DEVICE, never of the document: a `.mosaic.json` opened
 * on a phone must not impose six workers. Everything here is bounded on
 * read, so a stored value from an older build never breaks a screen.
 *
 * A matching in lots: the cells are cut into groups and matched group by
 * group, in the ORDER of a propagation — top to bottom, from a point
 * outward, in a spiral from the centre, at random, or all at once — so each
 * answer can be painted as it lands. The neighbour rule («no picture twice
 * side by side») reads what is already decided when a lot is matched; with
 * one worker and the top-down order that is exactly what a single block
 * decides, with several workers the lots in flight do not see each other and
 * the result may differ at their edges (said in the panel, by design).
 *
 * Pure and DOM-free.
 */

import { mulberry32 } from '../lib/prng';

export const PROPAGATIONS = ['rows', 'point', 'spiral', 'random', 'none'] as const;
export type Propagation = (typeof PROPAGATIONS)[number];
export const CELL_ANIMATIONS = ['appear', 'fade', 'flip', 'none'] as const;
export type CellAnimation = (typeof CELL_ANIMATIONS)[number];
export const MEASURE_MODES = ['pool', 'one', 'main'] as const;
export type MeasureMode = (typeof MEASURE_MODES)[number];
export const LOT_SIZES = [0, 64, 256, 1024] as const;
export type LotSize = (typeof LOT_SIZES)[number];

export interface PerfPrefs {
  /** 0 = auto (cores − 1, two to six, one or two on a constrained device); else 1..8. */
  workers: number;
  measure: MeasureMode;
  /** Cells per lot; 0 = one row of cells; the matching is one block when `propagation` is `none`. */
  lot: LotSize;
  /** Paint each lot as it lands, or the whole once it is all there. */
  showAsItComes: boolean;
  propagation: Propagation;
  cellAnimation: CellAnimation;
  /** How long a cell's animation lasts, ms. */
  animationMs: number;
  /** Tile bitmaps held at once. */
  tileCache: 600 | 2000 | 4000;
  /** Scenes built ahead in a chain. */
  ahead: 1 | 2 | 3;
  /** Whether the stage's zoom writes the crop (`frame`) or only looks (`look`). */
  zoom: 'frame' | 'look';
  /** A zoom's cells load the instance's thumbnail, then its proxy, as they grow past their tile (lab 4, L4). */
  sharpZoom: boolean;
  /** The veil of the target's colour fades as the stage zooms in, gone at ×3.5 (lab 4, L4). */
  veilFade: boolean;
  /** Follow the system's reduced-motion, or force it on/off. */
  motion: 'system' | 'reduced' | 'full';
}

export const DEFAULT_PERF: PerfPrefs = {
  workers: 0,
  measure: 'pool',
  lot: 64,
  showAsItComes: true,
  propagation: 'point',
  cellAnimation: 'fade',
  animationMs: 160,
  tileCache: 2000,
  ahead: 1,
  zoom: 'frame',
  sharpZoom: true,
  veilFade: true,
  motion: 'system',
};

const oneOf = <T>(v: unknown, all: readonly T[], fallback: T): T => ((all as readonly unknown[]).includes(v) ? (v as T) : fallback);

/** A stored preference read back: every field bounded, a missing one at its default. */
export function sanitizePerf(raw: unknown): PerfPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const workers = typeof r.workers === 'number' && Number.isFinite(r.workers) ? Math.min(8, Math.max(0, Math.round(r.workers))) : DEFAULT_PERF.workers;
  const animationMs = typeof r.animationMs === 'number' && Number.isFinite(r.animationMs) ? Math.min(600, Math.max(0, Math.round(r.animationMs))) : DEFAULT_PERF.animationMs;
  return {
    workers,
    measure: oneOf(r.measure, MEASURE_MODES, DEFAULT_PERF.measure),
    lot: oneOf(r.lot, LOT_SIZES, DEFAULT_PERF.lot),
    showAsItComes: typeof r.showAsItComes === 'boolean' ? r.showAsItComes : DEFAULT_PERF.showAsItComes,
    propagation: oneOf(r.propagation, PROPAGATIONS, DEFAULT_PERF.propagation),
    cellAnimation: oneOf(r.cellAnimation, CELL_ANIMATIONS, DEFAULT_PERF.cellAnimation),
    animationMs,
    tileCache: oneOf(r.tileCache, [600, 2000, 4000] as const, DEFAULT_PERF.tileCache),
    ahead: oneOf(r.ahead, [1, 2, 3] as const, DEFAULT_PERF.ahead),
    zoom: oneOf(r.zoom, ['frame', 'look'] as const, DEFAULT_PERF.zoom),
    sharpZoom: typeof r.sharpZoom === 'boolean' ? r.sharpZoom : DEFAULT_PERF.sharpZoom,
    veilFade: typeof r.veilFade === 'boolean' ? r.veilFade : DEFAULT_PERF.veilFade,
    motion: oneOf(r.motion, ['system', 'reduced', 'full'] as const, DEFAULT_PERF.motion),
  };
}

/** How many workers to spawn for `prefs` on a machine of `cores`, `constrained` or not. */
export function workersFor(prefs: Pick<PerfPrefs, 'workers'>, cores: number, constrained: boolean): number {
  if (prefs.workers > 0) return Math.min(8, prefs.workers);
  const cap = constrained ? 2 : 6;
  const n = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) - 1 : 1;
  return Math.max(constrained ? 1 : 2, Math.min(cap, n));
}

/**
 * The cells of a `cols × rows` grid cut into lots in propagation order. The
 * origin of `point` is a cell (the one clicked, the cursor's, the centre);
 * `random` draws from `seed`. Each lot is a run of cell indexes; together
 * they cover every cell once.
 */
export function planLots(cols: number, rows: number, prefs: { lot: number; propagation: Propagation }, origin: number = -1, seed = 1): Int32Array[] {
  const count = cols * rows;
  if (count <= 0) return [];
  if (prefs.propagation === 'none') return [Int32Array.from({ length: count }, (_, c) => c)];
  const size = prefs.lot === 0 ? cols : Math.max(1, prefs.lot);
  const order = new Int32Array(count);
  if (prefs.propagation === 'rows') {
    for (let c = 0; c < count; c++) order[c] = c;
  } else if (prefs.propagation === 'random') {
    for (let c = 0; c < count; c++) order[c] = c;
    const rnd = mulberry32(seed);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
  } else {
    const oc = origin >= 0 && origin < count ? origin : Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    const oi = oc % cols;
    const oj = (oc - oi) / cols;
    const keyed: { c: number; k: number }[] = [];
    for (let c = 0; c < count; c++) {
      const i = c % cols;
      const j = (c - i) / cols;
      const dx = i - oi;
      const dy = j - oj;
      const d = Math.hypot(dx, dy);
      // A spiral: rings of distance, then the angle around the origin inside each ring.
      const k = prefs.propagation === 'spiral' ? Math.floor(d) * 10 + (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) : d;
      keyed.push({ c, k });
    }
    keyed.sort((a, b) => a.k - b.k || a.c - b.c);
    keyed.forEach((e, i) => (order[i] = e.c));
  }
  const lots: Int32Array[] = [];
  for (let at = 0; at < count; at += size) lots.push(order.subarray(at, Math.min(count, at + size)));
  return lots;
}
