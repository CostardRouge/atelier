/**
 * CURATING a span: the N pictures that TELL it without repeating themselves,
 * and the order to show them in. What a person does by eye over a contact
 * sheet — spread across the day, one of each kind of moment, the best frame
 * of each — made a function so an agent can draft a carousel from a day's
 * forty frames in one call, and say why it picked each.
 *
 * A pick is chosen greedily: the frame with the best QUALITY first (Winnow's
 * own liking, then the thumbnail's sharpness, then the asked orientation),
 * then at each step the frame that adds the most NOVELTY to what is already
 * chosen — far in time, different in look (hash), light, gear, people,
 * colour, shape — weighed against its quality, with a bonus for a stretch of
 * the span nobody tells yet. A frame Winnow rejected is never picked.
 *
 * The picks come back in shooting order, each with its reason, so the agent
 * and the person can argue with one pick without redoing the lot.
 *
 * Pure and DOM-free.
 */

import type { GearKind, Light } from '../sources/winnow/capture-moment';
import type { Verdict } from '../sources/winnow/culling';
import type { HueFamily } from '../media/thumb-metrics';
import { hammingDistance } from '../media/thumb-metrics';
import type { Orientation } from '../sources/winnow/row-facets';

export interface StoryItem {
  id: number;
  /** The capture instant in ms, or null without a date. */
  at: number | null;
  hash: string | null;
  sharpness: number | null;
  light: Light | null;
  /** Faces Winnow found, or null when it has not looked. */
  faces: number | null;
  gear: GearKind | null;
  orientation: Orientation | null;
  colour: HueFamily | null;
  /** The mean hue 0..360, for an order by colour. */
  hue: number | null;
  focal: number | null;
  verdict: Verdict;
  stars: number;
}

export interface StoryOptions {
  count: number;
  /** The frame shape the piece wants; a match scores, the others are not refused. */
  orientation?: Orientation;
}

export interface StoryPick {
  id: number;
  /** Why it was kept, in words: "pick ★4 · golden hour · drone · a new look". */
  reason: string;
  /** Its score at the moment it was picked, for a tie to be argued. */
  score: number;
}

/** How much quality weighs against novelty once the first frame is chosen. */
const QUALITY_WEIGHT = 0.4;
const NOVELTY_WEIGHT = 0.6;
/** A stretch of the span no pick tells yet is worth this much. */
const COVERAGE_BONUS = 0.2;
/** Past this gap two frames are "far" in time. */
const FAR_MS = 2 * 60 * 60_000;

/** 0..1: Winnow's liking, the sharpness against the batch, the asked shape. */
export function quality(item: StoryItem, sharpRank: number, orientation?: Orientation): number {
  let q = 0;
  if (item.verdict === 'pick') q += 0.45;
  q += Math.min(5, item.stars) * 0.07;
  q += sharpRank * 0.2;
  if (orientation && item.orientation === orientation) q += 0.15;
  return Math.min(1, q);
}

/** 0..1: how unlike two frames are — time, look, light, gear, people, colour, shape. */
export function distance(a: StoryItem, b: StoryItem): number {
  let d = 0;
  if (a.at !== null && b.at !== null) d += 0.3 * (1 - Math.exp(-Math.abs(a.at - b.at) / FAR_MS));
  else d += 0.15;
  if (a.hash && b.hash) d += 0.3 * Math.min(1, hammingDistance(a.hash, b.hash) / 32);
  else d += 0.15;
  if (a.light && b.light && a.light !== b.light) d += 0.1;
  if (a.gear && b.gear && a.gear !== b.gear) d += 0.1;
  if (a.faces !== null && b.faces !== null && (a.faces > 0) !== (b.faces > 0)) d += 0.1;
  if (a.colour && b.colour && a.colour !== b.colour) d += 0.05;
  if (a.orientation && b.orientation && a.orientation !== b.orientation) d += 0.05;
  return Math.min(1, d);
}

export function curateStory(items: readonly StoryItem[], opts: StoryOptions): { picks: StoryPick[]; leftOut: number } {
  const pool = items.filter((i) => i.verdict !== 'reject');
  const count = Math.max(0, Math.min(opts.count, pool.length));
  if (count === 0) return { picks: [], leftOut: items.length };
  // Sharpness as a rank 0..1 within the batch: the number means nothing on its own.
  const sharp = pool.map((i) => i.sharpness).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const rankOf = (v: number | null) => (v === null || sharp.length < 2 ? 0.5 : sharp.findIndex((s) => s >= v) / (sharp.length - 1));
  const q = new Map(pool.map((i) => [i.id, quality(i, rankOf(i.sharpness), opts.orientation)]));
  // The span cut into `count` stretches: a pick in an empty one tells more of the day.
  const times = pool.map((i) => i.at).filter((t): t is number => t !== null);
  const t0 = times.length ? Math.min(...times) : null;
  const t1 = times.length ? Math.max(...times) : null;
  const stretchOf = (i: StoryItem) => (i.at === null || t0 === null || t1 === null || t1 === t0 ? -1 : Math.min(count - 1, Math.floor(((i.at - t0) / (t1 - t0)) * count)));
  const chosen: StoryItem[] = [];
  const told = new Set<number>();
  const picks = new Map<number, StoryPick>();
  while (chosen.length < count) {
    let best: { item: StoryItem; score: number; novelty: number } | null = null;
    for (const item of pool) {
      if (picks.has(item.id)) continue;
      const novelty = chosen.length ? Math.min(...chosen.map((c) => distance(item, c))) : 1;
      const stretch = stretchOf(item);
      const coverage = stretch >= 0 && !told.has(stretch) ? COVERAGE_BONUS : 0;
      const score = chosen.length ? QUALITY_WEIGHT * q.get(item.id)! + NOVELTY_WEIGHT * novelty + coverage : q.get(item.id)! + (item.at ?? 0) * 0;
      if (!best || score > best.score || (score === best.score && (item.at ?? Infinity) < (best.item.at ?? Infinity))) best = { item, score, novelty };
    }
    if (!best) break;
    chosen.push(best.item);
    told.add(stretchOf(best.item));
    picks.set(best.item.id, { id: best.item.id, reason: reasonFor(best.item, chosen.length === 1 ? null : best.novelty), score: Math.round(best.score * 1000) / 1000 });
  }
  const ordered = [...chosen].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.id - b.id).map((i) => picks.get(i.id)!);
  return { picks: ordered, leftOut: items.length - ordered.length };
}

const LIGHT_WORDS: Record<Light, string> = { golden: 'golden hour', blue: 'blue hour', day: 'daylight', night: 'night' };

function reasonFor(item: StoryItem, novelty: number | null): string {
  const words: string[] = [];
  const liking = [item.verdict === 'pick' ? 'pick' : null, item.stars > 0 ? `★${item.stars}` : null].filter(Boolean).join(' ');
  if (liking) words.push(liking);
  if (item.light) words.push(LIGHT_WORDS[item.light]);
  if (item.gear) words.push(item.gear);
  if (item.faces !== null) words.push(item.faces === 0 ? 'no one in frame' : item.faces === 1 ? 'one person' : `${item.faces} people`);
  if (item.colour) words.push(item.colour);
  if (novelty === null) words.push('the strongest frame');
  else if (novelty >= 0.6) words.push('a new look');
  else if (novelty >= 0.35) words.push('another moment');
  else words.push('the best of its stretch');
  return words.join(' · ');
}

export type StoryOrder = 'time' | 'colour' | 'focal';
export const STORY_ORDERS: readonly StoryOrder[] = ['time', 'colour', 'focal'];

/**
 * An order to show frames in: by TIME (shooting order), by COLOUR (a walk
 * from hue to its nearest neighbour, starting at the earliest frame, so a
 * carousel drifts rather than jumps; frames with no hue close it) or by FOCAL
 * length, wide to tight (no focal last).
 */
export function orderStory(items: readonly StoryItem[], by: StoryOrder): number[] {
  const byTime = [...items].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.id - b.id);
  if (by === 'time') return byTime.map((i) => i.id);
  if (by === 'focal') return [...byTime].sort((a, b) => (a.focal ?? Infinity) - (b.focal ?? Infinity)).map((i) => i.id);
  const hued = byTime.filter((i) => i.hue !== null);
  const rest = byTime.filter((i) => i.hue === null);
  const walk: StoryItem[] = [];
  let cur = hued.shift();
  while (cur) {
    walk.push(cur);
    let bestI = -1;
    let bestD = Infinity;
    hued.forEach((i, k) => {
      const d = hueGap(cur!.hue!, i.hue!);
      if (d < bestD) {
        bestD = d;
        bestI = k;
      }
    });
    cur = bestI >= 0 ? hued.splice(bestI, 1)[0] : undefined;
  }
  return [...walk, ...rest].map((i) => i.id);
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
