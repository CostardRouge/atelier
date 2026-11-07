/**
 * The selection RULE: which picture each place of a recap shows.
 *
 * A template names its SLOTS — the days of a month or a week, the steps back
 * of "on this day", the N places of a grid or a dump — and the rule fills
 * each from the pool: the pictures of that day (or the period), through the
 * recap's filter (devices, photos or clips), the best one first. The author
 * corrects by hand: a picture PINNED on a slot wins over the rule, a slot
 * EMPTIED stays empty (Storytelling's wall rule: «chosen by rules, corrected
 * by hand»).
 *
 * Pure and DOM-free.
 */

import { addDays, enumerateDays, type IsoDate } from '../roadtrip/trip-days';
import { mulberry32 } from '../lib/prng';
import { agoLabel, dayAgo, isoWeek, monthDays, monthName, parseAgo, shortDate, weekDays, dayMonth } from './recap-days';
import { GRID_SHAPES, MAX_SLIDES, type RecapDoc, type RecapPicture } from './recap-doc';
import { carouselPool, rankByRules } from './recap-carousel';
import { WRAPPED_STATS, statPictures, wrappedStats, type WrappedStatKey, type WrappedStats } from './recap-wrapped';
import { PIN, placeName, placeWords, routeLine } from './recap-places';

export interface RecapSlot {
  /** What a pick, a caption or a clearing names: a day (`2026-10-14`), a step back (`ago:1y`), a place (`n:3`). */
  id: string;
  /** The day it is about, for a day slot. */
  day: IsoDate | null;
  /** Its label in the editor: "14 October", "1 year ago", "Picture 4". */
  label: string;
  /** The picture it shows, or null. */
  picture: RecapPicture | null;
  /** Shown because the author pinned it. */
  pinned: boolean;
  /** Emptied by hand. */
  cleared: boolean;
  /** Every picture the rule could show there, best first. */
  candidates: RecapPicture[];
  /** A highlight (`h:3`): a slide after the first, not a place of the template's own page. */
  flow?: boolean;
}

/** The slots of the template's own page — every slot but the highlights that follow it. */
export function ownSlots(resolved: ResolvedRecap): RecapSlot[] {
  return resolved.slots.filter((s) => !s.flow);
}

export interface ResolvedRecap {
  slots: RecapSlot[];
  /** The pictures the template reads (its days or its period), through the filter. */
  inScope: RecapPicture[];
  /** Distinct days among them. */
  days: number;
  /** The words a heading can count (`fillText`). */
  vars: Record<string, string>;
  /** A Wrapped's numbers (`recap-wrapped.ts`). */
  wrapped?: WrappedStats;
}

/** A Wrapped's stat slots, as the inspector names them. */
export const WRAPPED_LABEL: Record<WrappedStatKey, string> = { busiest: 'The busiest day', camera: 'The camera', place: 'The place', best: 'The best picture' };
/** The most pictures a Wrapped's closing collage holds. */
export const WRAPPED_COLLAGE_MAX = 12;

/** The device's own name for a camera model, when the person gave one (`Sony`, `Drone`). */
export type DeviceAliases = Readonly<Record<string, string>>;

export function deviceLabel(model: string | undefined, aliases: DeviceAliases = {}): string {
  if (!model) return 'Unknown device';
  return aliases[model] || model;
}

/** Every device of the pool, the most used first. */
export function poolDevices(pictures: readonly RecapPicture[]): { device: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of pictures) if (p.device && !p.loose) counts.set(p.device, (counts.get(p.device) ?? 0) + 1);
  return [...counts].map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count || a.device.localeCompare(b.device));
}

export function passesFilter(p: RecapPicture, filter: RecapDoc['filter']): boolean {
  if (p.loose) return false;
  if (filter.kinds !== 'all' && p.kind !== filter.kinds) return false;
  if (filter.devices.length && (!p.device || !filter.devices.includes(p.device))) return false;
  return true;
}

/**
 * Best first: Winnow's pick, then its stars, then a photograph over a clip
 * (unless clips are what is asked), then the one nearest the middle of the
 * day — a deterministic "the day's picture" with nothing to rank on.
 */
export function rankPictures(list: readonly RecapPicture[], preferClips = false): RecapPicture[] {
  const mids = list.map((p) => (p.minute === undefined ? 720 : Math.abs(p.minute - 780)));
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      // The ♥ first (Winnow's «show this»), then the pick.
      const fv = Number(Boolean(b.p.fav)) - Number(Boolean(a.p.fav));
      if (fv) return fv;
      const pk = Number(Boolean(b.p.picked)) - Number(Boolean(a.p.picked));
      if (pk) return pk;
      const st = (b.p.stars ?? 0) - (a.p.stars ?? 0);
      if (st) return st;
      const kind = preferClips ? Number(b.p.kind === 'video') - Number(a.p.kind === 'video') : Number(a.p.kind === 'video') - Number(b.p.kind === 'video');
      if (kind) return kind;
      return mids[a.i] - mids[b.i] || a.i - b.i;
    })
    .map((x) => x.p);
}

/** Chronological: by day, then the time of day, then the pool's order. */
export function byTime(list: readonly RecapPicture[]): RecapPicture[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.day ?? '').localeCompare(b.p.day ?? '') || (a.p.minute ?? 0) - (b.p.minute ?? 0) || a.i - b.i)
    .map((x) => x.p);
}

/** The template's day slots, before anything fills them. */
function daySlots(doc: RecapDoc): { id: string; day: IsoDate | null; label: string }[] {
  if (doc.template === 'month') return monthDays(doc.anchor).map((d) => ({ id: d, day: d, label: dayMonth(d) }));
  if (doc.template === 'week') return weekDays(doc.anchor).map((d) => ({ id: d, day: d, label: dayMonth(d) }));
  // One second a day: every day of its period, the days with nothing skipped when it is laid out.
  if (doc.template === 'second') return doc.range ? enumerateDays(doc.range.from, doc.range.to).slice(0, 400).map((d) => ({ id: d, day: d, label: dayMonth(d) })) : [];
  if (doc.template === 'onThisDay') {
    return doc.rungs.flatMap((r) => {
      const ago = parseAgo(r);
      if (!ago) return [];
      return [{ id: `ago:${r}`, day: dayAgo(doc.anchor, ago), label: agoLabel(ago) }];
    });
  }
  return [];
}

/** How many places a grid, a single picture or a dump has. */
export function placeCount(doc: RecapDoc): number {
  if (doc.template === 'single') return 1;
  if (doc.template === 'grid') return GRID_SHAPES[doc.grid].count;
  if (doc.template === 'dump' || doc.template === 'sheets') return Math.min(doc.count, MAX_SLIDES * 4);
  if (doc.template === 'wrapped') return Math.min(doc.count, WRAPPED_COLLAGE_MAX);
  return 0;
}

/** The days a template reads — what a fill from an instance asks for. */
export function templateDays(doc: RecapDoc): IsoDate[] {
  const days = daySlots(doc).flatMap((s) => (s.day ? [s.day] : []));
  if (days.length) return days;
  if (doc.range) return enumerateDays(doc.range.from, doc.range.to).slice(0, 400);
  return [];
}

/**
 * `n` pictures spread over `list` (chronological): the ranked ones first —
 * Winnow's picks and stars — then evenly spaced through the rest, so a dump
 * of a month does not hold ten shots of its first afternoon. Returned in
 * time order.
 */
export function spreadPick(list: readonly RecapPicture[], n: number, rank: (l: readonly RecapPicture[]) => RecapPicture[] = (l) => rankPictures(l)): RecapPicture[] {
  if (n <= 0 || !list.length) return [];
  if (list.length <= n) return byTime(list);
  const ranked = list.filter((p) => p.fav || p.picked || (p.stars ?? 0) >= 3);
  const chosen = new Set<RecapPicture>(rank(ranked).slice(0, n));
  const rest = byTime(list.filter((p) => !chosen.has(p)));
  const need = n - chosen.size;
  for (let i = 0; i < need && rest.length; i++) {
    chosen.add(rest[Math.min(rest.length - 1, Math.floor(((i + 0.5) * rest.length) / need))]);
  }
  return byTime([...chosen]);
}

/**
 * `n` pictures of `pool` that HOLD when some are left out: the spread is made
 * as if nothing were (`whole`), then each picture now missing is replaced by
 * the nearest one in time still free — so leaving one out changes one place,
 * not the whole selection's spacing.
 */
export function holdingPick(whole: readonly RecapPicture[], pool: readonly RecapPicture[], n: number, rank: (l: readonly RecapPicture[]) => RecapPicture[] = (l) => rankPictures(l)): RecapPicture[] {
  const base = spreadPick(whole, n, rank);
  const inPool = new Set(pool.map((p) => p.key));
  const used = new Set(base.filter((p) => inPool.has(p.key)).map((p) => p.key));
  const timeline = byTime(pool);
  const at = (p: RecapPicture) => (p.day ? Date.parse(`${p.day}T00:00:00Z`) / 60000 : 0) + (p.second !== undefined ? p.second / 60 : (p.minute ?? 720));
  const out: RecapPicture[] = [];
  for (const p of base) {
    if (inPool.has(p.key)) {
      out.push(p);
      continue;
    }
    let best: RecapPicture | null = null;
    for (const q of timeline) if (!used.has(q.key) && (!best || Math.abs(at(q) - at(p)) < Math.abs(at(best) - at(p)))) best = q;
    if (best) {
      used.add(best.key);
      out.push(best);
    }
  }
  // Fewer than asked when the bench emptied what was spread: the rest of the pool, best first.
  for (const q of rank(pool)) if (out.length < n && !used.has(q.key) && !out.includes(q)) out.push(q);
  return byTime(out);
}

/** A frozen selection's pictures, those still in the pool, in HIS order (a drag in the tray sets it). */
function frozenPictures(keys: readonly string[], byKey: ReadonlyMap<string, RecapPicture>): RecapPicture[] {
  return keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
}

export function resolveRecap(doc: RecapDoc): ResolvedRecap {
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  const pool = doc.pictures.filter((p) => passesFilter(p, doc.filter));
  // A day's second is its clip first (a Live Photo's motion is one), then a still.
  const preferClips = doc.filter.kinds === 'video' || doc.template === 'second';
  const cleared = new Set(doc.cleared);
  const pinnedKeys = new Set(Object.values(doc.picks));
  const days = daySlots(doc);
  let slots: RecapSlot[];
  let inScope: RecapPicture[];
  let wrapped: WrappedStats | undefined;
  if (doc.template === 'wrapped') {
    inScope = doc.range ? pool.filter((p) => p.day !== null && p.day >= doc.range!.from && p.day <= doc.range!.to) : pool;
    wrapped = wrappedStats(inScope);
    slots = wrappedSlots(doc, inScope, wrapped, byKey, cleared, pinnedKeys);
  } else if (days.length) {
    const byDay = new Map<IsoDate, RecapPicture[]>();
    for (const p of pool) {
      if (!p.day) continue;
      const list = byDay.get(p.day);
      if (list) list.push(p);
      else byDay.set(p.day, [p]);
    }
    inScope = days.flatMap((s) => (s.day ? (byDay.get(s.day) ?? []) : []));
    slots = days.map((s) => {
      const ranked = rankPictures(s.day ? (byDay.get(s.day) ?? []) : [], preferClips);
      // A day's second is a moving one whenever the day has one: its clips first, then the stills, each best first.
      const candidates = doc.template === 'second' ? [...ranked.filter((p) => p.kind === 'video'), ...ranked.filter((p) => p.kind !== 'video')] : ranked;
      const pinKey = doc.picks[s.id];
      const pinned = pinKey ? (byKey.get(pinKey) ?? null) : null;
      const isCleared = cleared.has(s.id);
      // A picture pinned elsewhere is not the rule's choice here: the same picture twice reads as a mistake.
      const auto = candidates.find((p) => !pinnedKeys.has(p.key)) ?? null;
      return {
        id: s.id,
        day: s.day,
        label: s.label,
        picture: isCleared ? null : (pinned ?? auto),
        pinned: Boolean(pinned) && !isCleared,
        cleared: isCleared,
        candidates,
      };
    });
  } else {
    inScope = doc.range ? pool.filter((p) => p.day !== null && p.day >= doc.range!.from && p.day <= doc.range!.to) : pool;
    const carousel = doc.template === 'dump' || doc.template === 'sheets';
    const ranked = rankPictures(inScope, preferClips);
    const frozen = carousel ? doc.carousel.chosen : null;
    if (frozen) {
      // His selection, frozen by a correction (removal lab): exactly these, in his order — none added, none taken.
      slots = frozenPictures(frozen, byKey).map((picture, i) => ({ id: `n:${i}`, day: picture.day, label: `Picture ${i + 1}`, picture, pinned: false, cleared: false, candidates: ranked, flow: true }));
    } else {
      const n = placeCount(doc);
      // A dump and a sheet ARE highlights: the shared conditions, picks only when they fill the places.
      const rank = rankByRules(doc.carousel.rules.prefer);
      const free = carouselPool(inScope, doc.carousel, n).filter((p) => !pinnedKeys.has(p.key));
      const whole = carouselPool(inScope, { ...doc.carousel, left: [] }, n).filter((p) => !pinnedKeys.has(p.key));
      const auto = holdingPick(whole, free, n, rank);
      let next = 0;
      slots = Array.from({ length: n }, (_, i) => {
        const id = `n:${i}`;
        const pinKey = doc.picks[id];
        const pinned = pinKey ? (byKey.get(pinKey) ?? null) : null;
        const isCleared = cleared.has(id);
        const picture = isCleared ? null : (pinned ?? auto[next++] ?? null);
        return { id, day: picture?.day ?? null, label: `Picture ${i + 1}`, picture, pinned: Boolean(pinned) && !isCleared, cleared: isCleared, candidates: ranked, ...(carousel ? { flow: true } : {}) };
      });
    }
  }
  slots = [...slots, ...highlightSlots(doc, inScope, slots, byKey, cleared, pinnedKeys)];
  const dayCount = new Set(inScope.map((p) => p.day).filter(Boolean)).size;
  return { slots, inScope, days: dayCount, vars: textVars(doc, inScope, dayCount, slots), ...(wrapped ? { wrapped } : {}) };
}

/**
 * A Wrapped's slots: one per stat that has something to say (`w:busiest`…),
 * the best of what it counts — a photograph first, never a picture another
 * slot shows — then the closing collage (`n:i`), the rest of the period spread
 * through it under the carousel's conditions.
 */
function wrappedSlots(doc: RecapDoc, inScope: readonly RecapPicture[], stats: WrappedStats, byKey: ReadonlyMap<string, RecapPicture>, cleared: ReadonlySet<string>, pinnedKeys: ReadonlySet<string>): RecapSlot[] {
  const used = new Set(pinnedKeys);
  const slot = (id: string, label: string, candidates: RecapPicture[], auto: RecapPicture | null): RecapSlot => {
    const pinKey = doc.picks[id];
    const pinned = pinKey ? (byKey.get(pinKey) ?? null) : null;
    const isCleared = cleared.has(id);
    const picture = isCleared ? null : (pinned ?? auto);
    if (picture) used.add(picture.key);
    return { id, day: picture?.day ?? null, label, picture, pinned: Boolean(pinned) && !isCleared, cleared: isCleared, candidates };
  };
  // The best picture of the period chooses first — it must be the best — then each stat among what is left; laid in their own order.
  const filled = new Map<WrappedStatKey, RecapSlot>();
  for (const key of ['best', ...WRAPPED_STATS.filter((k) => k !== 'best')] as WrappedStatKey[]) {
    const among = statPictures(stats, key, inScope);
    if (!among.length) continue;
    const ranked = rankPictures(among);
    filled.set(key, slot(`w:${key}`, WRAPPED_LABEL[key], ranked, ranked.find((p) => !used.has(p.key)) ?? null));
  }
  const out: RecapSlot[] = WRAPPED_STATS.flatMap((k) => (filled.has(k) ? [filled.get(k)!] : []));
  const n = placeCount(doc);
  const rank = rankByRules(doc.carousel.rules.prefer);
  // The pool under the carousel's conditions, the stats' pictures out FIRST: picks only when what is left of them fills the grid.
  const free = carouselPool(inScope.filter((p) => !used.has(p.key)), doc.carousel, n);
  const auto = spreadPick(free, n, rank);
  const ranked = rankPictures(inScope);
  for (let i = 0; i < n; i++) out.push(slot(`n:${i}`, `Picture ${i + 1}`, ranked, auto[i] ?? null));
  return out;
}

/**
 * The highlights after a template's own page (carousel lab, B): the best of
 * its days or period, spread through them, none the page already shows —
 * left-out pictures and a burst's other frames held back, pins and clearings
 * as on any slot (`h:0`, `h:1`…).
 */
function highlightSlots(doc: RecapDoc, inScope: readonly RecapPicture[], own: readonly RecapSlot[], byKey: ReadonlyMap<string, RecapPicture>, cleared: ReadonlySet<string>, pinnedKeys: ReadonlySet<string>): RecapSlot[] {
  // A dump and a sheet ARE their highlights.
  if (doc.template === 'dump' || doc.template === 'sheets' || doc.carousel.after !== 'highlights') return [];
  const ranked0 = rankPictures(inScope);
  if (doc.carousel.chosen) {
    // His selection, frozen by a correction: exactly these.
    return frozenPictures(doc.carousel.chosen, byKey).map((picture, i) => ({ id: `h:${i}`, day: picture.day, label: `Highlight ${i + 1}`, picture, pinned: false, cleared: false, candidates: ranked0, flow: true }));
  }
  const shown = new Set(own.flatMap((s) => (s.picture ? [s.picture.key] : [])));
  const candidates = inScope.filter((p) => !shown.has(p.key) && !pinnedKeys.has(p.key));
  const n = Math.min(doc.carousel.highlights, MAX_SLIDES * 4);
  const pool = carouselPool(candidates, doc.carousel, n);
  const auto = holdingPick(carouselPool(candidates, { ...doc.carousel, left: [] }, n), pool, n, rankByRules(doc.carousel.rules.prefer));
  const ranked = rankPictures(pool);
  let next = 0;
  return Array.from({ length: n }, (_, i) => {
    const id = `h:${i}`;
    const pinKey = doc.picks[id];
    const pinned = pinKey ? (byKey.get(pinKey) ?? null) : null;
    const isCleared = cleared.has(id);
    const picture = isCleared ? null : (pinned ?? auto[next++] ?? null);
    return { id, day: picture?.day ?? null, label: `Highlight ${i + 1}`, picture, pinned: Boolean(pinned) && !isCleared, cleared: isCleared, candidates: ranked, flow: true };
  }).filter((s) => s.picture || s.pinned || s.cleared);
}

function textVars(doc: RecapDoc, inScope: readonly RecapPicture[], days: number, slots: readonly RecapSlot[]): Record<string, string> {
  const count = inScope.length;
  const a = doc.anchor;
  // The places, from the period's pictures — else from the pictures shown (a ladder's steps back lie outside any one period).
  const shown = slots.flatMap((s) => (s.picture ? [s.picture] : []));
  const words = placeWords(inScope.some((p) => placeName(p)) ? inScope : shown);
  const first = slots.find((s) => s.picture)?.picture?.day ?? doc.range?.from ?? a;
  const month = doc.template === 'month' || doc.template === 'week' || doc.template === 'onThisDay' ? a : first;
  const end = doc.template === 'week' ? (addDays(a, 6) ?? a) : (doc.range?.to ?? a);
  const clips = slots.filter((s) => s.picture?.kind === 'video').length;
  return {
    month: monthName(month),
    year: month.slice(0, 4),
    week: String(isoWeek(a)),
    // A single picture's date is the picture's own day; every other template's, the day it is about.
    date: dayMonth(doc.template === 'single' ? (slots[0]?.picture?.day ?? a) : a),
    from: shortDate(doc.template === 'week' ? a : (doc.range?.from ?? a)),
    to: shortDate(end),
    count: count.toLocaleString('en-GB').replace(/,/g, ' '),
    days: String(days),
    videos: `${clips} ${clips === 1 ? 'video' : 'videos'}`,
    // The pin leads the place (lab 11), unless he turned it off; nothing at all when no picture knows its place.
    place: words.place ? `${doc.places.titlePin ? PIN : ''}${words.place}` : '',
    places: routeLine(words.route),
  };
}

/** `{month}` and its kind replaced by what the recap counts; an unknown word is left as typed. */
export function fillText(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);
}

/** The words a heading can hold, for the editor's hint. */
export const TEXT_WORDS = ['month', 'year', 'week', 'date', 'from', 'to', 'count', 'days', 'videos', 'place', 'places'] as const;

/** A seeded shuffle of `0 … n-1` — `random` order, the same every play. */
export function seededOrder(n: number, seed: number): number[] {
  const rnd = mulberry32(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The pictures a blurred ground may soften (his ask, 2026-11-06): the
 * photographs of the recap's own days or period, the best first — or, when he
 * forces it, every photograph of the pool.
 */
export function backgroundChoices(doc: RecapDoc, resolved: ResolvedRecap, everywhere = false): RecapPicture[] {
  const from = everywhere ? doc.pictures.filter((p) => !p.loose) : resolved.inScope;
  const photos = from.filter((p) => p.kind === 'photo');
  return rankByRules(doc.carousel.rules.prefer)(photos.length ? photos : from);
}

/** The picture the blurred ground softens: his, when it is still in the pool, else the best photograph of the period. */
export function backgroundPicture(doc: RecapDoc, resolved: ResolvedRecap): RecapPicture | null {
  const own = doc.background.picture ? doc.pictures.find((p) => p.key === doc.background.picture && !p.loose) : undefined;
  return own ?? backgroundChoices(doc, resolved)[0] ?? resolved.slots.find((s) => s.picture)?.picture ?? null;
}
