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
}

export interface ResolvedRecap {
  slots: RecapSlot[];
  /** The pictures the template reads (its days or its period), through the filter. */
  inScope: RecapPicture[];
  /** Distinct days among them. */
  days: number;
  /** The words a heading can count (`fillText`). */
  vars: Record<string, string>;
}

/** The device's own name for a camera model, when the person gave one (`Sony`, `Drone`). */
export type DeviceAliases = Readonly<Record<string, string>>;

export function deviceLabel(model: string | undefined, aliases: DeviceAliases = {}): string {
  if (!model) return 'Unknown device';
  return aliases[model] || model;
}

/** Every device of the pool, the most used first. */
export function poolDevices(pictures: readonly RecapPicture[]): { device: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of pictures) if (p.device) counts.set(p.device, (counts.get(p.device) ?? 0) + 1);
  return [...counts].map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count || a.device.localeCompare(b.device));
}

export function passesFilter(p: RecapPicture, filter: RecapDoc['filter']): boolean {
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
  if (doc.template === 'dump') return Math.min(doc.count, MAX_SLIDES * 4);
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
export function spreadPick(list: readonly RecapPicture[], n: number): RecapPicture[] {
  if (n <= 0 || !list.length) return [];
  if (list.length <= n) return byTime(list);
  const ranked = list.filter((p) => p.picked || (p.stars ?? 0) >= 3);
  const chosen = new Set<RecapPicture>(rankPictures(ranked).slice(0, n));
  const rest = byTime(list.filter((p) => !chosen.has(p)));
  const need = n - chosen.size;
  for (let i = 0; i < need && rest.length; i++) {
    chosen.add(rest[Math.min(rest.length - 1, Math.floor(((i + 0.5) * rest.length) / need))]);
  }
  return byTime([...chosen]);
}

export function resolveRecap(doc: RecapDoc): ResolvedRecap {
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  const pool = doc.pictures.filter((p) => passesFilter(p, doc.filter));
  const preferClips = doc.filter.kinds === 'video';
  const cleared = new Set(doc.cleared);
  const pinnedKeys = new Set(Object.values(doc.picks));
  const days = daySlots(doc);
  let slots: RecapSlot[];
  let inScope: RecapPicture[];
  if (days.length) {
    const byDay = new Map<IsoDate, RecapPicture[]>();
    for (const p of pool) {
      if (!p.day) continue;
      const list = byDay.get(p.day);
      if (list) list.push(p);
      else byDay.set(p.day, [p]);
    }
    inScope = days.flatMap((s) => (s.day ? (byDay.get(s.day) ?? []) : []));
    slots = days.map((s) => {
      const candidates = rankPictures(s.day ? (byDay.get(s.day) ?? []) : [], preferClips);
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
    const n = placeCount(doc);
    const free = inScope.filter((p) => !pinnedKeys.has(p.key));
    const auto = spreadPick(free, n);
    const ranked = rankPictures(inScope, preferClips);
    let next = 0;
    slots = Array.from({ length: n }, (_, i) => {
      const id = `n:${i}`;
      const pinKey = doc.picks[id];
      const pinned = pinKey ? (byKey.get(pinKey) ?? null) : null;
      const isCleared = cleared.has(id);
      const picture = isCleared ? null : (pinned ?? auto[next++] ?? null);
      return { id, day: picture?.day ?? null, label: `Picture ${i + 1}`, picture, pinned: Boolean(pinned) && !isCleared, cleared: isCleared, candidates: ranked };
    });
  }
  const dayCount = new Set(inScope.map((p) => p.day).filter(Boolean)).size;
  return { slots, inScope, days: dayCount, vars: textVars(doc, inScope.length, dayCount, slots) };
}

function textVars(doc: RecapDoc, count: number, days: number, slots: readonly RecapSlot[]): Record<string, string> {
  const a = doc.anchor;
  const first = slots.find((s) => s.picture)?.picture?.day ?? doc.range?.from ?? a;
  const month = doc.template === 'month' || doc.template === 'week' || doc.template === 'onThisDay' ? a : first;
  const end = doc.template === 'week' ? (addDays(a, 6) ?? a) : (doc.range?.to ?? a);
  const clips = slots.filter((s) => s.picture?.kind === 'video').length;
  return {
    month: monthName(month),
    year: month.slice(0, 4),
    week: String(isoWeek(a)),
    date: dayMonth(a),
    from: shortDate(doc.template === 'week' ? a : (doc.range?.from ?? a)),
    to: shortDate(end),
    count: count.toLocaleString('en-GB').replace(/,/g, ' '),
    days: String(days),
    videos: `${clips} ${clips === 1 ? 'video' : 'videos'}`,
  };
}

/** `{month}` and its kind replaced by what the recap counts; an unknown word is left as typed. */
export function fillText(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);
}

/** The words a heading can hold, for the editor's hint. */
export const TEXT_WORDS = ['month', 'year', 'week', 'date', 'from', 'to', 'count', 'days', 'videos'] as const;

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
