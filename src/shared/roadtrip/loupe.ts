/**
 * The loupe: the window of the trip the stage ruler details, and its ZOOM.
 *
 * The ruler lays the whole trip along one track and shows a window of it
 * across its box — a day is the box's share of the window. Changing the scale
 * IS changing how many days the window holds: fewer days and every leg widens
 * until its name reads again, which is what a trip with many short legs asks
 * for (the maintainer's report, 2026-09-28); more days and a season fits.
 * Moving it is scrolling the track. The year map draws the same window under
 * its heatmap, so a zoom is SEEN there: the window shrinks as the ruler zooms
 * in and grows as it zooms out.
 *
 * It opens on the calendar's months — the one on screen and its two
 * neighbours, which is what 100% means — and follows the calendar when
 * another month comes on screen, keeping its zoom.
 *
 * Pure and DOM-free, in FRACTIONAL day offsets from the trip's first day (the
 * unit `stage-ruler.ts` lays its bars in): a pinch or a trackpad sweep moves
 * it by less than a day, so nothing snaps under the hand.
 */

import { MIN_DAY } from './stage-ruler';
import { daysBetween, parseIsoDate, toIsoDate, type IsoDate } from './trip-days';

/** A window of the trip: `days` days from offset `from` (both fractional). */
export interface Loupe {
  from: number;
  days: number;
}

/** How few and how many days the window may hold. */
export interface LoupeLimits {
  min: number;
  max: number;
}

/**
 * The deepest zoom: a week across the whole box. Closer than that a leg's
 * name has long been readable, and the track stops reading as a calendar.
 */
export const MIN_LOUPE_DAYS = 7;

/**
 * The window's limits for a trip of `total` days in a box `width` pixels
 * wide. The widest is as many days as fit at `MIN_DAY` — the width under
 * which a leg's edge cannot be grabbed, the ruler's own floor — and never
 * more than the trip. An unmeasured box limits nothing but the trip.
 */
export function loupeLimits(total: number, width: number): LoupeLimits {
  const whole = Math.max(1, total);
  const min = Math.min(MIN_LOUPE_DAYS, whole);
  const fit = width > 0 ? width / MIN_DAY : whole;
  return { min, max: Math.max(min, Math.min(whole, fit)) };
}

export function clampDays(days: number, limits: LoupeLimits): number {
  if (!Number.isFinite(days)) return limits.max;
  return Math.min(limits.max, Math.max(limits.min, days));
}

/** The window held inside the limits and the trip: it slides back in rather than shrinking. */
export function clampLoupe(total: number, loupe: Loupe, limits: LoupeLimits): Loupe {
  const days = clampDays(loupe.days, limits);
  const room = Math.max(0, total - days);
  const from = Number.isFinite(loupe.from) ? Math.min(room, Math.max(0, loupe.from)) : 0;
  return { from, days };
}

/**
 * The window at `days`, the day under `at` — a fraction of the box, 0 its
 * left edge — staying where it is: every zoom in the suite keeps the point
 * under the hand still. Only the trip's own edges can move it, since the
 * window never shows a day outside the trip.
 */
export function zoomLoupe(total: number, loupe: Loupe, days: number, at: number, limits: LoupeLimits): Loupe {
  const next = clampDays(days, limits);
  const a = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : 0.5;
  const under = loupe.from + a * loupe.days;
  return clampLoupe(total, { from: under - a * next, days: next }, limits);
}

/** A window of `days` centred on day offset `centre`. */
export function centreLoupe(total: number, days: number, centre: number, limits: LoupeLimits): Loupe {
  const d = clampDays(days, limits);
  return clampLoupe(total, { from: centre - d / 2, days: d }, limits);
}

/**
 * The window that shows the whole of day `day`: this one if it already does,
 * else slid the shortest way, with up to a day of room beyond it so the open
 * day does not sit flush against the box's edge. A day off the trip is not
 * followed.
 */
export function holdDay(total: number, loupe: Loupe, day: number): Loupe {
  if (!Number.isFinite(day) || day < 0 || day >= total) return loupe;
  if (day >= loupe.from && day + 1 <= loupe.from + loupe.days) return loupe;
  const margin = Math.min(1, Math.max(0, (loupe.days - 1) / 2));
  const from = day < loupe.from ? day - margin : day + 1 + margin - loupe.days;
  return { from: Math.min(Math.max(0, total - loupe.days), Math.max(0, from)), days: loupe.days };
}

/**
 * The three calendar months around the one holding `month` — the one before,
 * it, the one after — as offsets from the trip's first day. Not clamped to
 * the trip: it is where the window is CENTRED and how long it is at 100%,
 * and the window then clamps itself.
 */
export function monthsAround(tripStart: IsoDate, month: IsoDate): Loupe | null {
  const t = parseIsoDate(month);
  if (t === null) return null;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const from = daysBetween(tripStart, toIsoDate(Date.UTC(y, m - 1, 1)));
  const to = daysBetween(tripStart, toIsoDate(Date.UTC(y, m + 2, 0)));
  if (from === null || to === null) return null;
  return { from, days: to - from + 1 };
}

/**
 * How many days 100% shows: the three months around the month on screen, or
 * the whole trip when it is shorter than that (or has no months — a short
 * trip's one block of weeks), held inside the limits so a narrow box calls
 * what it CAN show at the ruler's floor 100%, not 111%.
 */
export function baseDays(total: number, around: Loupe | null, limits: LoupeLimits): number {
  return clampDays(around ? Math.min(total, around.days) : total, limits);
}

/** The zoom the pill says: how much closer than 100% the window is. */
export function loupeScale(base: number, days: number): number {
  return days > 0 && base > 0 ? base / days : 1;
}

/** The first and the last day the window shows, even in part, as offsets inside the trip. */
export function loupeSpan(total: number, loupe: Loupe): { first: number; last: number } {
  const lastDay = Math.max(0, total - 1);
  const first = Math.min(lastDay, Math.max(0, Math.floor(loupe.from + 1e-6)));
  const last = Math.min(lastDay, Math.max(first, Math.ceil(loupe.from + loupe.days - 1e-6) - 1));
  return { first, last };
}

/**
 * Where the window is published for the surfaces that DRAW it without owning
 * it — the year map's bar, the stages header's dates. The ruler writes on
 * every scroll frame, so these read it through a subscription rather than
 * through their common parent: re-rendering the overview per frame is the
 * R8 trap (`roadtrip.md`).
 */
export interface LoupeStore {
  get(): Loupe | null;
  set(next: Loupe | null): void;
  subscribe(listener: () => void): () => void;
}

export function createLoupeStore(): LoupeStore {
  let value: Loupe | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      if (next && value && Math.abs(next.from - value.from) < 1e-6 && Math.abs(next.days - value.days) < 1e-6) return;
      value = next ? { from: next.from, days: next.days } : null;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
