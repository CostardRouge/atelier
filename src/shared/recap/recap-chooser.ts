/**
 * Choosing a picture among the recap's OWN days (lab 17, part II, his yes of
 * 2026-11-10): the Pictures tab follows the slide on the stage, and under the
 * place in hand it offers the period day by day — a month of days shaded by
 * how many shots they hold, then that day's photos, all of them, best first.
 *
 * Before it, a highlight's grid said «2 300 that day» and showed the whole
 * period's best 60: the place carried its picture's day, the candidates were
 * the period's. Here a day is a day.
 *
 * Pure: what the chooser lists and what a gesture writes. The panel is
 * `DayChooser.tsx`.
 */

import type { IsoDate } from '../roadtrip/trip-days';
import type { RecapDoc, RecapPicture } from './recap-doc';
import type { RecapLayout } from './recap-layout';
import { rankPictures, resolveRecap, type ResolvedRecap } from './recap-slots';
import { withJoined, withMovedFlow } from './recap-selection';

/** What a day's photos are narrowed to: Winnow's ♥, its picks, or every one. */
export type DayFilter = 'fav' | 'picks' | 'all';

/** A month as the chooser draws it: its first day's place in a week, and its days. */
export interface ChooserMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Empty places before the 1st, for a week starting on `weekStart`. */
  lead: number;
  days: IsoDate[];
}

/** The pictures a day offers: the template's own (`inScope`), never a loose clip (the background's). */
function ownPictures(resolved: ResolvedRecap): RecapPicture[] {
  return resolved.inScope.filter((p) => !p.loose && p.day);
}

/** How many pictures each day of the recap holds. */
export function dayCounts(resolved: ResolvedRecap): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  for (const p of ownPictures(resolved)) out.set(p.day!, (out.get(p.day!) ?? 0) + 1);
  return out;
}

const keeps = (p: RecapPicture, filter: DayFilter) => (filter === 'fav' ? Boolean(p.fav) : filter === 'picks' ? Boolean(p.picked) : true);

/** A day's pictures through `filter`, best first (♥, pick, stars, a photo, near midday — `rankPictures`). */
export function dayPictures(resolved: ResolvedRecap, day: IsoDate, filter: DayFilter = 'all'): RecapPicture[] {
  return rankPictures(ownPictures(resolved).filter((p) => p.day === day && keeps(p, filter)));
}

/** How many of a day's pictures each filter keeps. */
export function filterCounts(resolved: ResolvedRecap, day: IsoDate): Record<DayFilter, number> {
  const out: Record<DayFilter, number> = { fav: 0, picks: 0, all: 0 };
  for (const p of ownPictures(resolved)) {
    if (p.day !== day) continue;
    out.all++;
    if (p.fav) out.fav++;
    if (p.picked) out.picks++;
  }
  return out;
}

/** The months that hold a picture, oldest first, each laid out as a calendar month. */
export function chooserMonths(counts: ReadonlyMap<IsoDate, number>, weekStart: 0 | 1): ChooserMonth[] {
  const months = [...new Set([...counts.keys()].map((d) => d.slice(0, 7)))].sort();
  return months.map((month) => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      month,
      lead: (first - weekStart + 7) % 7,
      days: Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}` as IsoDate),
    };
  });
}

/** Where a picture already shows: a place of the template's own page(s), or a carousel place — and on which slide. */
export interface PictureWhere {
  slot: string;
  flow: boolean;
  /** 0-based page of the layout that first shows its place. */
  page: number;
}

/** Every picture a place of the recap shows, by key. */
export function whereIs(resolved: ResolvedRecap, layout: RecapLayout): Map<string, PictureWhere> {
  const pageOf = new Map<string, number>();
  layout.pages.forEach((p, i) => {
    for (const part of p.parts) if (part.kind === 'cell' && !pageOf.has(part.id)) pageOf.set(part.id, i);
  });
  const out = new Map<string, PictureWhere>();
  for (const s of resolved.slots) if (s.picture && !out.has(s.picture.key)) out.set(s.picture.key, { slot: s.id, flow: Boolean(s.flow), page: pageOf.get(s.id) ?? 0 });
  return out;
}

/**
 * «+»: `key` joins the carousel right AFTER `after` (the picture in hand),
 * not at its moment — he puts it where he wants it (Q7). With no `after`, or
 * one the carousel does not hold, it joins at its moment (`withJoined`). The
 * selection freezes, as any correction does; a picture the carousel cannot
 * take (another day's, one on the first page, one it already holds) changes
 * nothing.
 */
export function withJoinedAfter(doc: RecapDoc, key: string, after: string | null, now: number = Date.now()): RecapDoc {
  const joined = withJoined(doc, [key], now);
  if (joined === doc || after === null) return joined;
  const rest = (joined.carousel.chosen ?? []).filter((k) => k !== key);
  const at = rest.indexOf(after);
  if (at < 0) return joined;
  return withMovedFlow(joined, resolveRecap(joined), key, rest[at + 1] ?? null, now);
}

/** The label of a carousel place as the person sees it: «Slide 3 · 2 of 4» — its slide, its rank on it. */
export function slideLabel(layout: RecapLayout, slot: string): string | null {
  for (let i = 0; i < layout.pages.length; i++) {
    const cells = layout.pages[i].parts.filter((p) => p.kind === 'cell');
    const at = cells.findIndex((p) => p.id === slot);
    if (at >= 0) return cells.length > 1 ? `Slide ${i + 1} · ${at + 1} of ${cells.length}` : `Slide ${i + 1}`;
  }
  return null;
}
