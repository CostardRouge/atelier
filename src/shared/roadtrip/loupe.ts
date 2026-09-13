/**
 * The loupe: the window of a long trip that the stage ruler details.
 *
 * A year's heatmap shows the whole journey; the ruler under it, at the 6px a
 * day needs to be grabbed, showed five months of it and scrolled for the
 * rest — two views of one calendar that never agreed on where you were. The
 * loupe is a window dragged OVER the heatmap, and the ruler draws exactly
 * that window across its box. It replaces both zoom pills.
 *
 * Pure: a span of whole days, clamped to the trip, that keeps its width when
 * it moves and follows the open day when the day leaves it.
 */

import { addDays, daysBetween, isWithin, spanLength, type IsoDate } from './trip-days';

export interface Loupe {
  start: IsoDate;
  end: IsoDate;
}

type Span = { startDate: IsoDate; endDate: IsoDate };

/** How many days the loupe opens on: eight weeks, a leg or two at a glance. */
export const DEFAULT_LOUPE_DAYS = 56;
/** Narrowest the window may be dragged to. */
export const MIN_LOUPE_DAYS = 7;

/** Days in the window, at least 1. */
export function loupeLength(loupe: Loupe): number {
  return spanLength(loupe.start, loupe.end) ?? 1;
}

/**
 * A window of `days` around `focus`, clamped to the trip: it starts on the
 * Monday of the focus's week when it can, so the window's edges fall where
 * the heatmap's columns do. A trip shorter than the window is the window.
 */
export function defaultLoupe(trip: Span, focus: IsoDate | null, days = DEFAULT_LOUPE_DAYS): Loupe {
  const total = spanLength(trip.startDate, trip.endDate) ?? 1;
  const width = Math.min(days, total);
  const anchor = focus && isWithin(trip.startDate, trip.endDate, focus) ? focus : trip.startDate;
  const from = daysBetween(trip.startDate, anchor) ?? 0;
  // Two weeks before the focus keeps it inside the window with context behind it.
  const wanted = Math.max(0, Math.min(total - width, from - 14));
  return clampLoupe(trip, { start: addDays(trip.startDate, wanted)!, end: addDays(trip.startDate, wanted + width - 1)! });
}

/** Slide the window by whole days, keeping its width, never past the trip. */
export function moveLoupe(trip: Span, loupe: Loupe, deltaDays: number): Loupe {
  const total = spanLength(trip.startDate, trip.endDate) ?? 1;
  const width = loupeLength(loupe);
  const from = daysBetween(trip.startDate, loupe.start) ?? 0;
  const next = Math.max(0, Math.min(total - width, from + deltaDays));
  return { start: addDays(trip.startDate, next)!, end: addDays(trip.startDate, next + width - 1)! };
}

/** Move one edge to a date; the window never shrinks under `MIN_LOUPE_DAYS`. */
export function resizeLoupe(trip: Span, loupe: Loupe, edge: 'start' | 'end', date: IsoDate): Loupe {
  const clamped = clampDate(trip, date);
  if (edge === 'start') {
    const latest = addDays(loupe.end, -(MIN_LOUPE_DAYS - 1))!;
    return { start: clamped <= latest ? clamped : latest, end: loupe.end };
  }
  const earliest = addDays(loupe.start, MIN_LOUPE_DAYS - 1)!;
  return { start: loupe.start, end: clamped >= earliest ? clamped : earliest };
}

/** The window that holds `date`: this one if it already does, else slid the shortest way. */
export function loupeContaining(trip: Span, loupe: Loupe, date: IsoDate): Loupe {
  if (!isWithin(trip.startDate, trip.endDate, date)) return loupe;
  if (date >= loupe.start && date <= loupe.end) return loupe;
  const before = daysBetween(date, loupe.start);
  if (before !== null && before > 0) return moveLoupe(trip, loupe, -before);
  const after = daysBetween(loupe.end, date) ?? 0;
  return moveLoupe(trip, loupe, after);
}

/** Whether the window is the whole trip — nothing to detail, then. */
export function loupeIsWhole(trip: Span, loupe: Loupe): boolean {
  return loupe.start === trip.startDate && loupe.end === trip.endDate;
}

function clampDate(trip: Span, date: IsoDate): IsoDate {
  if (date < trip.startDate) return trip.startDate;
  if (date > trip.endDate) return trip.endDate;
  return date;
}

function clampLoupe(trip: Span, loupe: Loupe): Loupe {
  const start = clampDate(trip, loupe.start);
  const end = clampDate(trip, loupe.end);
  return end < start ? { start, end: start } : { start, end };
}
