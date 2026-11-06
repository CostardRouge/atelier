/**
 * The carousel's corrections (removal lab, his yes of 2026-11-05): two
 * gestures where there was one. ✕ REMOVES — the carousel holds one fewer,
 * nothing comes in; ⇄ REPLACES — he chooses among the next best for that
 * place. The first correction FREEZES the selection (`carousel.chosen`): the
 * rule no longer reshuffles it until «Let the rule choose again».
 *
 * Pure.
 */

import { MAX_SLIDES, withRecap, type RecapDoc, type RecapPicture } from './recap-doc';
import { MAX_HIGHLIGHTS, carouselPool, carouselReport, factsOf, rankByRules } from './recap-carousel';
import { looksAlike } from '../sources/winnow/picture-rules';
import { byTime, resolveRecap, type ResolvedRecap } from './recap-slots';

/** The carousel's pictures as the person sees them: its flow places' pictures, by key, in their places' order. */
export function flowKeys(resolved: ResolvedRecap): string[] {
  return resolved.slots.flatMap((s) => (s.flow && s.picture ? [s.picture.key] : []));
}

/** True once a correction froze the selection. */
export const isFrozen = (doc: RecapDoc) => doc.carousel.chosen !== null;

/**
 * `keys` with `key` put back at its moment: before the first picture taken
 * after it — the order he set by hand elsewhere untouched.
 */
const atItsMoment = (doc: RecapDoc, keys: readonly string[], key: string): string[] => {
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  const order = new Map(byTime(doc.pictures).map((p, i) => [p.key, i]));
  const rest = keys.filter((k) => k !== key && byKey.has(k));
  const at = rest.findIndex((k) => (order.get(k) ?? 0) > (order.get(key) ?? 0));
  return at < 0 ? [...rest, key] : [...rest.slice(0, at), key, ...rest.slice(at)];
};

/** ✕: the picture leaves the carousel, which holds one fewer; it waits on the bench. */
export function withRemoved(doc: RecapDoc, resolved: ResolvedRecap, key: string, now: number = Date.now()): RecapDoc {
  const chosen = (doc.carousel.chosen ?? flowKeys(resolved)).filter((k) => k !== key);
  return withRecap(doc, { carousel: { ...doc.carousel, chosen, left: [...doc.carousel.left.filter((k) => k !== key), key] } }, now);
}

/** ⇄: `by` takes `key`'s place; `key` waits on the bench. */
export function withReplaced(doc: RecapDoc, resolved: ResolvedRecap, key: string, by: string, now: number = Date.now()): RecapDoc {
  const was = doc.carousel.chosen ?? flowKeys(resolved);
  // In `key`'s place: the order he set stays.
  const chosen = [...new Set(was.map((k) => (k === key ? by : k)))];
  return withRecap(doc, { carousel: { ...doc.carousel, chosen, left: [...doc.carousel.left.filter((k) => k !== key && k !== by), key] } }, now);
}

/** ↺: a removed picture back in the carousel, at its moment. */
export function withRestored(doc: RecapDoc, resolved: ResolvedRecap, key: string, now: number = Date.now()): RecapDoc {
  const chosen = atItsMoment(doc, doc.carousel.chosen ?? flowKeys(resolved), key);
  return withRecap(doc, { carousel: { ...doc.carousel, chosen, left: doc.carousel.left.filter((k) => k !== key) } }, now);
}

/** Two pictures of the carousel trade places (a drag in the tray, or on the stage): the order is his from then on. */
export function withSwappedFlow(doc: RecapDoc, resolved: ResolvedRecap, a: string, b: string, now: number = Date.now()): RecapDoc {
  const was = doc.carousel.chosen ?? flowKeys(resolved);
  const i = was.indexOf(a);
  const j = was.indexOf(b);
  if (i < 0 || j < 0 || i === j) return doc;
  const chosen = was.slice();
  [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  return withRecap(doc, { carousel: { ...doc.carousel, chosen } }, now);
}

/**
 * A picture of the carousel MOVED between two others (a drag dropped on a
 * tile's edge): it leaves its place and lands before `before` — or last when
 * `before` is null; the others keep their order. The selection freezes.
 */
export function withMovedFlow(doc: RecapDoc, resolved: ResolvedRecap, key: string, before: string | null, now: number = Date.now()): RecapDoc {
  const was = doc.carousel.chosen ?? flowKeys(resolved);
  if (!was.includes(key) || key === before) return doc;
  const rest = was.filter((k) => k !== key);
  const at = before === null ? -1 : rest.indexOf(before);
  const chosen = at < 0 ? [...rest, key] : [...rest.slice(0, at), key, ...rest.slice(at)];
  if (chosen.every((k, i) => k === was[i])) return doc;
  return withRecap(doc, { carousel: { ...doc.carousel, chosen } }, now);
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

/** The most pictures the carousel's count may ask: a dump's or sheet's places, else the highlights. */
export const countMax = (doc: RecapDoc) => (doc.template === 'dump' || doc.template === 'sheets' ? Math.min(60, MAX_SLIDES * 4) : MAX_HIGHLIGHTS);

/** How many pictures the carousel holds now: his selection's when frozen, else the count asked. */
export function carouselCount(doc: RecapDoc): number {
  if (doc.carousel.chosen) return doc.carousel.chosen.length;
  return doc.template === 'dump' || doc.template === 'sheets' ? doc.count : doc.carousel.highlights;
}

/**
 * The carousel's NUMBER of pictures set to `n` (his ask, 2026-11-06: «on ne
 * peut plus changer le nombre d'images»). Chosen by the rule, the count
 * changes and the rule spreads again. FROZEN, his selection stays as he made
 * it: more adds the next best of the pool — under the conditions, picks only
 * as asked, never a look-alike of what stays, never one he took out while
 * another is free; then, when the picks run out under «Auto», the other kept
 * pictures — each at its moment; fewer sends the rule's least favourites to
 * the bench, where ↺ brings them back.
 */
export function withCount(doc: RecapDoc, n: number, now: number = Date.now()): RecapDoc {
  const want = Math.max(1, Math.min(countMax(doc), Math.round(n)));
  const places = doc.template === 'dump' || doc.template === 'sheets' ? { count: want } : {};
  const carousel = { ...doc.carousel, ...(doc.template === 'dump' || doc.template === 'sheets' ? {} : { highlights: want }) };
  const chosen = doc.carousel.chosen;
  if (!chosen) return withRecap(doc, { ...places, carousel }, now);
  const rank = rankByRules(doc.carousel.rules.prefer);
  if (want < chosen.length) {
    const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
    const ranked = rank(chosen.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []))).map((p) => p.key);
    const out = new Set(ranked.slice(want));
    return withRecap(doc, { ...places, carousel: { ...carousel, chosen: chosen.filter((k) => !out.has(k)), left: [...carousel.left.filter((k) => !out.has(k)), ...chosen.filter((k) => out.has(k))] } }, now);
  }
  const resolved = resolveRecap(doc);
  let keys = [...chosen];
  for (const key of nextBest(doc, resolved, chosen, want - chosen.length, rank)) keys = atItsMoment(doc, keys, key);
  return withRecap(doc, { ...places, carousel: { ...carousel, chosen: keys, left: carousel.left.filter((k) => !keys.includes(k)) } }, now);
}

/** The `k` best pictures not in the carousel yet: the bench last, a look-alike of one staying never, the other kept pictures after the picks under «Auto». */
function nextBest(doc: RecapDoc, resolved: ResolvedRecap, chosen: readonly string[], k: number, rank: (l: readonly RecapPicture[]) => RecapPicture[]): string[] {
  if (k <= 0) return [];
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  const inCarousel = new Set(chosen);
  const shown = new Set(resolved.slots.flatMap((s) => (!s.flow && s.picture ? [s.picture.key] : [])));
  const free = resolved.inScope.filter((p) => !inCarousel.has(p.key) && !shown.has(p.key));
  const bench = new Set(doc.carousel.left);
  const tiers: RecapPicture[][] = [];
  const kept = carouselPool(free, { ...doc.carousel, left: [], picksOnly: false });
  if (doc.carousel.picksOnly !== false) tiers.push(kept.filter((p) => p.picked));
  if (doc.carousel.picksOnly !== true) tiers.push(kept);
  const staying = chosen.flatMap((c) => (byKey.has(c) ? [factsOf(byKey.get(c)!)] : []));
  const out: string[] = [];
  const take = (list: readonly RecapPicture[]) => {
    for (const p of rank(list)) {
      if (out.length >= k) return;
      if (out.includes(p.key)) continue;
      const f = factsOf(p);
      if (staying.some((s) => looksAlike(f, s))) continue;
      out.push(p.key);
      staying.push(f);
    }
  };
  // What he took out comes back only when nothing else is free.
  for (const tier of tiers) take(tier.filter((p) => !bench.has(p.key)));
  for (const tier of tiers) take(tier.filter((p) => bench.has(p.key)));
  return out;
}

/** True when the recap draws a carousel of pictures: a dump, a sheet, or highlights after the first slide. */
export const hasCarouselPictures = (doc: RecapDoc) => doc.template === 'dump' || doc.template === 'sheets' || (doc.carousel.after === 'highlights' && doc.template !== 'wrapped');

/**
 * Pictures he ADDED by hand (the picker's «Add to the recap», his files) JOIN
 * the carousel, each at its moment, the count growing with them — a choice of
 * his, so the selection freezes like any correction. A picture the first page
 * shows, or outside the recap's days, stays in the pool only.
 */
export function withJoined(doc: RecapDoc, keys: readonly string[], now: number = Date.now()): RecapDoc {
  if (!hasCarouselPictures(doc) || !keys.length) return doc;
  const resolved = resolveRecap(doc);
  const inScope = new Set(resolved.inScope.map((p) => p.key));
  const shown = new Set(resolved.slots.flatMap((s) => (!s.flow && s.picture ? [s.picture.key] : [])));
  const was = doc.carousel.chosen ?? flowKeys(resolved);
  let chosen = [...was];
  for (const k of keys) if (inScope.has(k) && !shown.has(k) && !chosen.includes(k)) chosen = atItsMoment(doc, chosen, k);
  // Nothing joined: nothing changes — the selection does not freeze for nothing.
  if (chosen.length === was.length) return doc;
  const sheetOrDump = doc.template === 'dump' || doc.template === 'sheets';
  const n = Math.min(countMax(doc), chosen.length);
  return withRecap(
    doc,
    {
      ...(sheetOrDump ? { count: Math.max(doc.count, n) } : {}),
      carousel: { ...doc.carousel, ...(sheetOrDump ? {} : { highlights: Math.max(doc.carousel.highlights, n) }), chosen, left: doc.carousel.left.filter((k) => !chosen.includes(k)) },
    },
    now,
  );
}
