/**
 * The carousel's corrections (removal lab, his yes of 2026-11-05): two
 * gestures where there was one. ✕ REMOVES — the carousel holds one fewer,
 * nothing comes in; ⇄ REPLACES — he chooses among the next best for that
 * place. The first correction FREEZES the selection (`carousel.chosen`): the
 * rule no longer reshuffles it until «Let the rule choose again».
 *
 * Pure.
 */

import { withRecap, type RecapDoc, type RecapPicture } from './recap-doc';
import { carouselPool, carouselReport, factsOf, rankByRules } from './recap-carousel';
import { looksAlike } from '../sources/winnow/picture-rules';
import { byTime, type ResolvedRecap } from './recap-slots';

/** The carousel's pictures as the person sees them: its flow places' pictures, by key, in time order. */
export function flowKeys(resolved: ResolvedRecap): string[] {
  return byTime(resolved.slots.flatMap((s) => (s.flow && s.picture ? [s.picture] : []))).map((p) => p.key);
}

/** True once a correction froze the selection. */
export const isFrozen = (doc: RecapDoc) => doc.carousel.chosen !== null;

const timed = (doc: RecapDoc, keys: readonly string[]) => {
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  return byTime([...new Set(keys)].flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []))).map((p) => p.key);
};

/** ✕: the picture leaves the carousel, which holds one fewer; it waits on the bench. */
export function withRemoved(doc: RecapDoc, resolved: ResolvedRecap, key: string, now: number = Date.now()): RecapDoc {
  const chosen = (doc.carousel.chosen ?? flowKeys(resolved)).filter((k) => k !== key);
  return withRecap(doc, { carousel: { ...doc.carousel, chosen, left: [...doc.carousel.left.filter((k) => k !== key), key] } }, now);
}

/** ⇄: `by` takes `key`'s place; `key` waits on the bench. */
export function withReplaced(doc: RecapDoc, resolved: ResolvedRecap, key: string, by: string, now: number = Date.now()): RecapDoc {
  const was = doc.carousel.chosen ?? flowKeys(resolved);
  const chosen = timed(
    doc,
    was.map((k) => (k === key ? by : k)),
  );
  return withRecap(doc, { carousel: { ...doc.carousel, chosen, left: [...doc.carousel.left.filter((k) => k !== key && k !== by), key] } }, now);
}

/** ↺: a removed picture back in the carousel, at its moment. */
export function withRestored(doc: RecapDoc, resolved: ResolvedRecap, key: string, now: number = Date.now()): RecapDoc {
  const chosen = timed(doc, [...(doc.carousel.chosen ?? flowKeys(resolved)), key]);
  return withRecap(doc, { carousel: { ...doc.carousel, chosen, left: doc.carousel.left.filter((k) => k !== key) } }, now);
}

/** «Let the rule choose again»: the selection unfrozen, the bench emptied. */
export function withRuleAgain(doc: RecapDoc, now: number = Date.now()): RecapDoc {
  return withRecap(doc, { carousel: { ...doc.carousel, chosen: null, left: [] } }, now);
}

/**
 * What ⇄ offers for `key`'s place: the pool under the carousel's conditions
 * (the bench and the carousel itself out), nothing that looks like a picture
 * staying, nearest in time first, then the best.
 */
export function replaceCandidates(doc: RecapDoc, resolved: ResolvedRecap, key: string, n = 8): RecapPicture[] {
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  const aim = byKey.get(key);
  if (!aim) return [];
  const inCarousel = new Set(doc.carousel.chosen ?? flowKeys(resolved));
  // The first page's own pictures (a month's days) are no highlight's candidates.
  const shown = new Set(resolved.slots.flatMap((s) => (!s.flow && s.picture ? [s.picture.key] : [])));
  const staying = [...inCarousel].filter((k) => k !== key).flatMap((k) => (byKey.has(k) ? [factsOf(byKey.get(k)!)] : []));
  // Picks only when the carousel draws from them (set, or by itself over the whole period).
  const picksOnly = carouselReport(
    resolved.inScope.filter((p) => !shown.has(p.key)),
    { ...doc.carousel, left: [] },
    inCarousel.size,
  ).picksOnly;
  const pool = carouselPool(
    resolved.inScope.filter((p) => !inCarousel.has(p.key) && !shown.has(p.key)),
    { ...doc.carousel, picksOnly },
  ).filter((p) => !staying.some((k) => looksAlike(factsOf(p), k)));
  const at = factsOf(aim).at;
  const rank = rankByRules(doc.carousel.rules.prefer);
  const order = new Map(rank(pool).map((p, i) => [p.key, i]));
  return [...pool].sort((a, b) => Math.abs(factsOf(a).at - at) - Math.abs(factsOf(b).at - at) || order.get(a.key)! - order.get(b.key)!).slice(0, n);
}
