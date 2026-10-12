/**
 * NEAR-DUPLICATES among a listing — a burst's frames, a shot taken twice, a
 * copy re-encoded — grouped, and the one worth keeping marked. A PROPOSAL the
 * agent looks at (`winnow.sheet {ids}`), never a write: culling is Winnow's.
 *
 * Two frames belong together when they are a BURST (shot within `gapSeconds`
 * of each other on the same body) or TWINS (their thumbnails' hashes within
 * `maxDistance` bits, and shot within half an hour — the same bay at dawn and
 * at noon is two pictures). Links are transitive, so a burst of twelve is one
 * group. `keep` is the member Winnow already liked best (a pick, then stars),
 * else the sharpest; two equals keep the first shot.
 *
 * Pure and DOM-free.
 */

import { hammingDistance } from '../../media/thumb-metrics';
import type { Verdict } from './culling';

export interface DupItem {
  id: number;
  /** The capture instant in ms, or null without a date. */
  at: number | null;
  camera: string | null;
  /** The thumbnail's hash, or null when it was not measured. */
  hash: string | null;
  sharpness: number | null;
  verdict: Verdict;
  stars: number;
}

export interface DupOptions {
  /** Frames this close on one body are a burst. */
  gapSeconds?: number;
  /** Hashes this close (bits) are twins. */
  maxDistance?: number;
}

export const DEFAULT_GAP_SECONDS = 3;
export const DEFAULT_MAX_DISTANCE = 10;
/** Twins by hash must also be shot within this, in ms. */
const TWIN_WINDOW_MS = 30 * 60_000;

export interface DupGroup {
  /** Members in shooting order. */
  ids: number[];
  /** The one to keep, or null when nothing tells them apart (no culling, no measure). */
  keep: number | null;
  /** How they were linked: a burst by time alone, twins by their look, or both. */
  by: 'burst' | 'twins' | 'both';
  /** Seconds between the first and the last shot, or null when a member has no date. */
  spanSeconds: number | null;
}

export function findDuplicates(items: readonly DupItem[], opts: DupOptions = {}): DupGroup[] {
  const gapMs = (opts.gapSeconds ?? DEFAULT_GAP_SECONDS) * 1000;
  const maxDistance = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const sorted = [...items].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.id - b.id);
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byTime = new Set<number>();
  const byHash = new Set<number>();
  const union = (a: number, b: number, how: 'time' | 'hash') => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
    (how === 'time' ? byTime : byHash).add(a).add(b);
  };
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const dt = a.at !== null && b.at !== null ? b.at - a.at : null;
      // Sorted by time: past the twin window nothing later can link to `a`.
      if (dt !== null && dt > TWIN_WINDOW_MS) break;
      if (dt !== null && dt <= gapMs && a.camera !== null && a.camera === b.camera) union(i, j, 'time');
      else if (a.hash && b.hash && dt !== null && hammingDistance(a.hash, b.hash) <= maxDistance) union(i, j, 'hash');
    }
  }
  const groups = new Map<number, number[]>();
  sorted.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const rows = members.map((i) => sorted[i]);
      const time = members.some((i) => byTime.has(i));
      const hash = members.some((i) => byHash.has(i));
      const first = rows[0].at;
      const last = rows[rows.length - 1].at;
      return {
        ids: rows.map((r) => r.id),
        keep: bestOf(rows),
        by: time && hash ? 'both' : time ? 'burst' : 'twins',
        spanSeconds: first !== null && last !== null ? Math.round((last - first) / 100) / 10 : null,
      } satisfies DupGroup;
    });
}

/** Winnow's own liking first (a pick, more stars), then the sharpest; null when nothing tells them apart. */
export function bestOf(rows: readonly DupItem[]): number | null {
  const score = (r: DupItem) => (r.verdict === 'pick' ? 1000 : r.verdict === 'reject' ? -1000 : 0) + r.stars * 100;
  let best: DupItem | null = null;
  let tied = false;
  for (const r of rows) {
    if (!best) {
      best = r;
      continue;
    }
    const d = score(r) - score(best);
    const sharper = (r.sharpness ?? -1) - (best.sharpness ?? -1);
    if (d > 0 || (d === 0 && sharper > 0)) {
      best = r;
      tied = false;
    } else if (d === 0 && sharper === 0) tied = true;
  }
  return best && !tied ? best.id : null;
}
