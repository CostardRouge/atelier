/**
 * The wall's CORRECTIONS by hand, Recap's carousel gestures (removal lab, his
 * yes of 2026-11-06 for the wall): ✕ REMOVES — the wall holds one fewer,
 * nothing comes in, the pictures after it close up; ⇄ REPLACES — he chooses
 * among the next best for that place (nearest in time first, then the best by
 * his rules), which takes the replaced one's place; a DRAG trades two places,
 * or moves one before or after another. The first of them FREEZES the wall:
 * `ScriptSources.wall.order`, the pictures in his order with their days, laid
 * as they are by every counting until «Let the rules choose again» (absent =
 * the rules choose, as before). Pins and removals stay what they were — what
 * the rules read when they choose again. (pure)
 */
import { looksAlike } from '../sources/winnow/picture-rules';
import type { WallPick } from './story-facts';
import { rankBy, type WallCandidate, type WallRules } from './wall-pick';

/** A picture on a frozen wall: its Winnow asset id and its day (ISO). */
export type WallEntry = [number, string];

/** The wall's pictures as `withTiles` keeps them, in his order. */
export const laidPicks = (order: readonly (readonly [number, string])[]): WallPick[] => order.map(([id, day]) => ({ id, day }));

/** ✕: the picture leaves the wall, which holds one fewer; the others keep their order. */
export function wallRemoved(order: readonly WallEntry[], id: number): WallEntry[] {
  return order.filter((e) => e[0] !== id);
}

/** ⇄: `by` takes `id`'s place, the order he set untouched; a `by` already on the wall leaves its own place. */
export function wallReplaced(order: readonly WallEntry[], id: number, by: WallEntry): WallEntry[] {
  if (!order.some((e) => e[0] === id) || by[0] === id) return [...order];
  return order.filter((e) => e[0] !== by[0]).map((e): WallEntry => (e[0] === id ? [by[0], by[1]] : e));
}

/** Two pictures of the wall trade places (a drag onto a picture's middle). */
export function wallSwapped(order: readonly WallEntry[], a: number, b: number): WallEntry[] {
  const i = order.findIndex((e) => e[0] === a);
  const j = order.findIndex((e) => e[0] === b);
  const out = [...order];
  if (i < 0 || j < 0 || i === j) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * A picture MOVED between two others (a drag onto a picture's edge): it lands
 * before `before`, or last when `before` is null; the others keep their order.
 */
export function wallMoved(order: readonly WallEntry[], id: number, before: number | null): WallEntry[] {
  const it = order.find((e) => e[0] === id);
  if (!it || id === before) return [...order];
  const rest = order.filter((e) => e[0] !== id);
  const at = before === null ? -1 : rest.findIndex((e) => e[0] === before);
  return at < 0 ? [...rest, it] : [...rest.slice(0, at), it, ...rest.slice(at)];
}

/** The id a drop on `over`'s edge puts `id` before: `over` itself, or the picture after it (null = last). */
export function beforeOf(order: readonly WallEntry[], id: number, over: number, side: 'before' | 'after'): number | null {
  if (side === 'before') return over;
  const rest = order.filter((e) => e[0] !== id);
  return rest[rest.findIndex((e) => e[0] === over) + 1]?.[0] ?? null;
}

/** True when two orders lay the same pictures in the same places. */
export const sameOrder = (a: readonly WallEntry[], b: readonly WallEntry[]) => a.length === b.length && a.every((e, i) => e[0] === b[i][0]);

/**
 * What ⇄ offers for `id`'s place: the pictures the rules keep (rejects and
 * screens out when they leave them out, one of a burst — and none of a burst
 * already on the wall), never one on the wall or one he removed, never a
 * look-alike of a picture staying; nearest in time first, then the best by
 * his preferences.
 */
export function wallReplaceCandidates(
  candidates: readonly WallCandidate[],
  rules: WallRules,
  order: readonly WallEntry[],
  removed: readonly number[],
  id: number,
  n = 12,
): WallCandidate[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const aim = byId.get(id);
  if (!aim) return [];
  const on = new Set(order.map((e) => e[0]));
  const gone = new Set(removed);
  const leave = (k: keyof WallRules['leave']) => rules.leave[k] !== false;
  const staying = order.flatMap((e) => (e[0] !== id && byId.has(e[0]) ? [byId.get(e[0])!] : []));
  const burstsOn = new Set(staying.flatMap((c) => (c.burst !== null ? [c.burst] : [])));
  const rank = rankBy(rules.prefer);
  let pool = candidates.filter((c) => !on.has(c.id) && !gone.has(c.id));
  if (leave('reject')) pool = pool.filter((c) => !c.reject);
  if (leave('screen')) pool = pool.filter((c) => !c.screen);
  if (leave('burst')) {
    const best = new Map<number, WallCandidate>();
    for (const c of pool) if (c.burst !== null && !burstsOn.has(c.burst) && (!best.has(c.burst) || rank(c, best.get(c.burst)!) < 0)) best.set(c.burst, c);
    pool = pool.filter((c) => c.burst === null || best.get(c.burst) === c);
  }
  pool = pool.filter((c) => !staying.some((k) => looksAlike(c, k)));
  const better = new Map([...pool].sort(rank).map((c, i) => [c.id, i]));
  return pool.sort((a, b) => Math.abs(a.at - aim.at) - Math.abs(b.at - aim.at) || better.get(a.id)! - better.get(b.id)!).slice(0, n);
}

/** A script's `wall.order`, kept when well formed: an id once, an ISO day, `max` at most. */
export function readWallOrder(raw: unknown, max: number): WallEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: WallEntry[] = [];
  for (const e of raw) {
    if (!Array.isArray(e) || e.length !== 2) continue;
    const [id, day] = e as unknown[];
    if (!Number.isInteger(id) || (id as number) <= 0 || seen.has(id as number) || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    seen.add(id as number);
    out.push([id as number, day]);
    if (out.length >= max) break;
  }
  return out;
}
