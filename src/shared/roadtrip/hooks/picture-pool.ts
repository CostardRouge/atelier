/**
 * The pictures a hook's chooser offers — pure, so the rules are tested and the
 * modal only draws them.
 *
 * The pool is what was SHOT over a span of the trip, wherever it is kept: the
 * Library's photographs (dated by their EXIF, `media-date.ts`) and, when an
 * instance is connected, what it holds for those days. One picture in both —
 * a file already brought in from the instance, or a folder copy of the same
 * capture — is offered once, from the Library, where it costs no request.
 *
 * The chooser starts with EVERYTHING in the span ticked (the maintainer's
 * gesture: take the lot, untick what does not belong), except when the
 * variant already holds a list — then that list is what is ticked, and a
 * picture it never had stays unticked until the span changes.
 */

import type { SavedMediaRef } from '../../projects/project-types';
import type { HookDay, HookPickedPicture, HookStage } from './hook-variant';

export interface PoolCandidate {
  /** Unique within the pool — the React key and the tick's identity. */
  key: string;
  /** How the picture is found again. A Library file's hash is added on confirm. */
  ref: SavedMediaRef;
  /** The day it was shot. */
  date: string;
  /** The capture instant in ms — orders a day's pictures. */
  takenAt: number;
  /** Where it was shot, when the file or the instance says. */
  coords?: { lat: number; lon: number };
  origin: 'library' | 'instance';
}

export interface DateSpan {
  from: string;
  to: string;
}

/** Two refs to one picture: the same source id, the same content, or the same name and size. */
export function sameRef(a: SavedMediaRef, b: SavedMediaRef): boolean {
  if (a.assetId && b.assetId) return a.assetId === b.assetId;
  if (a.hash && b.hash) return a.hash === b.hash;
  return a.name.toLowerCase() === b.name.toLowerCase() && a.size === b.size;
}

/** Pool order: the day, the instant, the name. */
export function sortPool<T extends PoolCandidate>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.takenAt - b.takenAt || a.ref.name.localeCompare(b.ref.name),
  );
}

/**
 * The Library's candidates and the instance's as one list, each picture once:
 * an instance row the Library already holds — by its source id, or by name
 * and size — is dropped in favour of the Library's copy.
 */
export function mergePool<T extends PoolCandidate>(library: readonly T[], instance: readonly T[]): T[] {
  const ids = new Set(library.flatMap((c) => (c.ref.assetId ? [c.ref.assetId] : [])));
  const names = new Set(library.map((c) => `${c.ref.name.toLowerCase()}:${c.ref.size}`));
  const fromInstance = instance.filter(
    (c) =>
      !(c.ref.assetId && ids.has(c.ref.assetId)) &&
      !names.has(`${c.ref.name.toLowerCase()}:${c.ref.size}`),
  );
  return sortPool([...library, ...fromInstance]);
}

/** Only the candidates shot inside `span`, both ends included. */
export function inSpan<T extends PoolCandidate>(items: readonly T[], span: DateSpan): T[] {
  return items.filter((c) => c.date >= span.from && c.date <= span.to);
}

/** The pool in day groups, in calendar order, each with the trip's day for its heading. */
export function groupByDay<T extends PoolCandidate>(
  items: readonly T[],
  calendar: readonly HookDay[],
): { date: string; day: HookDay | undefined; items: T[] }[] {
  const byDate = new Map(calendar.map((day) => [day.date, day]));
  const groups = new Map<string, T[]>();
  for (const item of sortPool(items)) {
    const list = groups.get(item.date);
    if (list) list.push(item);
    else groups.set(item.date, [item]);
  }
  return [...groups].map(([date, list]) => ({ date, day: byDate.get(date), items: list }));
}

/**
 * The trip so far: its first day to this piece's own. What a sweep or a drive
 * can tell — a picture shot later has no place on the tape — and so the span
 * the chooser OPENS on. Null when the piece is dated outside its trip.
 */
export function reachSpan(calendar: readonly HookDay[], date: string): DateSpan | null {
  if (!calendar.length || !calendar.some((day) => day.date === date)) return null;
  return { from: calendar[0].date, to: date };
}

/**
 * The whole trip, first day to last: how far the chooser's dates may be moved.
 * Wider than `reachSpan` on purpose (2026-09-15) — the maintainer sometimes
 * wants a picture from past this piece's day, and an itinerary keeps one. A
 * variant that cannot tell it says so on the tile (`laterLeftOff`), rather
 * than the chooser refusing to show it.
 */
export function tripSpan(calendar: readonly HookDay[]): DateSpan | null {
  if (!calendar.length) return null;
  return { from: calendar[0].date, to: calendar[calendar.length - 1].date };
}

/**
 * The span the chooser opens on. With a list already held, the days it covers
 * (inside the trip, so a picture kept from past this piece reopens where it
 * can be seen and is not dropped on confirm); with none, the trip up to the day
 * BEFORE this one — the days a sweep runs through — or this day alone on the
 * trip's first.
 *
 * `includeThisDay` moves that edge to the piece's own day, for a variant whose
 * pictures are not a run-up to it: an itinerary's stops are as often the day
 * being told as the days before it, and opening on a span that hides today's
 * photographs reads as "there are none".
 */
export function defaultSpan(
  calendar: readonly HookDay[],
  date: string,
  selected: readonly HookPickedPicture[],
  includeThisDay = false,
): DateSpan | null {
  const reach = reachSpan(calendar, date);
  const trip = tripSpan(calendar);
  if (!reach || !trip) return null;
  const held = selected.map((p) => p.date).filter((d) => d >= trip.from && d <= trip.to).sort();
  if (held.length) return { from: held[0], to: held[held.length - 1] };
  if (includeThisDay) return reach;
  const heroIndex = calendar.findIndex((day) => day.date === date);
  return { from: reach.from, to: heroIndex > 0 ? calendar[heroIndex - 1].date : date };
}

/**
 * Whether a candidate is shot after this piece's day and the variant will
 * leave it off — a sweep and a drive tell the trip up to the piece, never
 * past it (`partitionPicked`). Offered all the same, and marked.
 */
export function laterLeftOff(candidateDate: string, pieceDate: string, keepsLater: boolean): boolean {
  return !keepsLater && candidateDate > pieceDate;
}

export interface QuickSpan extends DateSpan {
  id: 'whole' | 'trip' | 'leg' | 'week' | 'day';
  label: string;
}

/**
 * One-click spans, widest first: the whole trip, the trip so far, this leg so
 * far, the last seven days, this day alone. A span that would say the same as
 * an earlier one is left out.
 */
export function quickSpans(
  calendar: readonly HookDay[],
  date: string,
  stages: readonly HookStage[] = [],
): QuickSpan[] {
  const reach = reachSpan(calendar, date);
  const trip = tripSpan(calendar);
  if (!reach || !trip) return [];
  const heroIndex = calendar.findIndex((day) => day.date === date);
  const before = heroIndex > 0 ? calendar[heroIndex - 1].date : date;
  const out: QuickSpan[] = [
    { id: 'whole', label: 'Whole trip', from: trip.from, to: trip.to },
    { id: 'trip', label: 'Trip so far', from: reach.from, to: before },
  ];
  const leg = stages.find((stage) => stage.startDate <= date && date <= stage.endDate);
  if (leg && leg.startDate > reach.from && leg.startDate < date) {
    out.push({ id: 'leg', label: 'This leg', from: leg.startDate, to: before });
  }
  const weekStart = calendar[Math.max(0, heroIndex - 7)].date;
  if (heroIndex > 7) out.push({ id: 'week', label: 'Last 7 days', from: weekStart, to: before });
  out.push({ id: 'day', label: 'This day', from: date, to: date });
  return out.filter(
    (span, i) => !out.slice(0, i).some((earlier) => earlier.from === span.from && earlier.to === span.to),
  );
}

/**
 * Which candidates start unticked. Nothing, when the variant holds no list —
 * everything in the span is taken. With a list, every candidate it does not
 * name.
 */
export function initialExclusions(
  candidates: readonly PoolCandidate[],
  selected: readonly HookPickedPicture[],
): Set<string> {
  if (!selected.length) return new Set();
  return new Set(
    candidates.filter((c) => !selected.some((p) => sameRef(p.ref, c.ref))).map((c) => c.key),
  );
}
