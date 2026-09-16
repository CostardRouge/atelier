/**
 * Spreading several entrances over time from WHERE the things are — a collage's
 * cells, a badge's pieces, an intro scene's titles. Pure and DOM-free.
 *
 * The engine's one stagger primitive is `AnimStep.delay`, typed by hand per
 * element. This derives those delays from boxes instead, so a cascade re-reads
 * itself when a layout changes and no stale delay is ever stored: RANKS come
 * from an order, DELAYS from ranks × `each`, and the settled instant from the
 * last rank plus the step's own length.
 *
 * Ties share a rank: two cells whose centres sit within 2% of the short side
 * of each other on the ordered axis land together, which is what makes `rows`
 * land a whole row at once instead of drizzling it in by sub-pixel offsets.
 * `random` is seeded and the seed is stored, or an export would shuffle
 * differently from the preview that was approved.
 */

import type { Rect } from '../media/compose-layout';
import type { AnimStep } from './animation';

export type StaggerOrder =
  | 'sequence'
  | 'reverse'
  | 'center-out'
  | 'edges-in'
  | 'rows'
  | 'columns'
  | 'size'
  | 'random';

export const STAGGER_ORDERS: readonly { id: StaggerOrder; label: string; hint: string }[] = [
  { id: 'sequence', label: 'Sequence', hint: 'In cell order' },
  { id: 'reverse', label: 'Reverse', hint: 'Last cell first' },
  { id: 'center-out', label: 'Centre out', hint: 'From the middle of the frame outwards' },
  { id: 'edges-in', label: 'Edges in', hint: 'From the edges towards the middle' },
  { id: 'rows', label: 'Rows', hint: 'Top row first, a row at a time' },
  { id: 'columns', label: 'Columns', hint: 'Left column first, a column at a time' },
  { id: 'size', label: 'Big first', hint: 'The largest lands first' },
  { id: 'random', label: 'Random', hint: 'Shuffled once, the same way every time' },
];

export interface Stagger {
  /** Seconds between two ranks. */
  each: number;
  order: StaggerOrder;
  /** `random` only — stored so the export shuffles exactly as the preview did. */
  seed?: number;
}

export const DEFAULT_STAGGER: Stagger = { each: 0.1, order: 'sequence' };
export const MAX_STAGGER_EACH = 1;

export interface Size {
  w: number;
  h: number;
}

/** How close two keys may be, as a share of the short side, and still share a rank. */
const TIE = 0.02;

/** A small deterministic PRNG (mulberry32) — the same seed shuffles the same way everywhere. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The rank of every box, 0 first. Ranks are dense (0, 1, 2…) and ties share
 * one; a `random` order is a permutation with no ties.
 */
export function staggerRanks(
  boxes: readonly Rect[],
  frame: Size,
  order: StaggerOrder,
  seed = 0,
): number[] {
  const n = boxes.length;
  if (n === 0) return [];
  if (order === 'sequence') return boxes.map((_, i) => i);
  if (order === 'reverse') return boxes.map((_, i) => n - 1 - i);
  if (order === 'random') {
    const next = rng(seed);
    const idx = boxes.map((_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const ranks = new Array<number>(n);
    idx.forEach((box, rank) => {
      ranks[box] = rank;
    });
    return ranks;
  }

  const short = Math.min(frame.w, frame.h) || 1;
  const cx = (b: Rect) => b.x + b.w / 2;
  const cy = (b: Rect) => b.y + b.h / 2;
  const dist = (b: Rect) => Math.hypot(cx(b) - frame.w / 2, cy(b) - frame.h / 2);
  let key: (b: Rect) => number;
  let tie = TIE * short;
  switch (order) {
    case 'center-out':
      key = dist;
      break;
    case 'edges-in':
      key = (b) => -dist(b);
      break;
    case 'rows':
      key = cy;
      break;
    case 'columns':
      key = cx;
      break;
    default:
      // 'size': the largest first; a tie is 2% of the short side squared.
      key = (b) => -(b.w * b.h);
      tie = TIE * short * short;
  }
  const sorted = boxes.map((b, i) => ({ i, k: key(b) })).sort((a, b) => a.k - b.k || a.i - b.i);
  const ranks = new Array<number>(n);
  let rank = -1;
  let anchor = -Infinity;
  for (const s of sorted) {
    if (s.k - anchor > tie) {
      rank += 1;
      anchor = s.k;
    }
    ranks[s.i] = rank;
  }
  return ranks;
}

/** Seconds each box waits before its entrance starts. */
export function staggerDelays(boxes: readonly Rect[], frame: Size, stagger: Stagger): number[] {
  const each = Math.max(0, stagger.each);
  return staggerRanks(boxes, frame, stagger.order, stagger.seed ?? 0).map((r) => r * each);
}

/**
 * When the whole cascade is at rest — the last entrance's start plus its own
 * length. What a still is drawn at; 0 with nothing to wait for.
 */
export function staggerSettle(delays: readonly number[], step: AnimStep | null | undefined): number {
  if (!delays.length) return 0;
  const last = Math.max(...delays);
  return last + (step && step.preset !== 'none' ? Math.max(0, step.duration) : 0);
}

/** Read a stagger out of anything — a stored document, an imported file. */
export function normaliseStagger(v: unknown): Stagger {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<Stagger>;
  const each =
    typeof s.each === 'number' && Number.isFinite(s.each)
      ? Math.min(MAX_STAGGER_EACH, Math.max(0, s.each))
      : DEFAULT_STAGGER.each;
  const order = STAGGER_ORDERS.some((o) => o.id === s.order) ? (s.order as StaggerOrder) : 'sequence';
  const out: Stagger = { each, order };
  if (typeof s.seed === 'number' && Number.isFinite(s.seed)) out.seed = Math.round(s.seed);
  return out;
}

/** A fresh seed for `random` — stored on the document the moment it is drawn. */
export function newStaggerSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
