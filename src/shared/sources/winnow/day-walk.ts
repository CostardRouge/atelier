/**
 * Walking an instance's library a day at a time, past the end of a day's
 * pictures — the arithmetic behind the lightbox's "next day" card.
 *
 * Paging past the last picture of a day should land on the first picture of
 * the NEXT DAY THAT HOLDS ANY, not on an empty Tuesday: a trip has days off,
 * and a lightbox that opens on "nothing here" has stopped being one. So the
 * neighbour is asked of `/api/assets/calendar`, which answers counts per day,
 * in two steps at most — a window of a couple of months first (the common
 * case: the next shoot is days away), then, only if that window was empty, the
 * rest of the way to the edge of what the library holds (`bounds`, which the
 * calendar returns whatever window was asked).
 *
 * The deck itself is `[before, ...pictures, after]`: the two edge cards are
 * ordinary items of the shared lightbox, so its gestures, pager and wrap-around
 * need no change. What that costs is knowing which way a page went, which
 * three items or more make unambiguous.
 *
 * Pure; `use-neighbour-days.ts` is the effect over it.
 */

import { shiftDay, type DaySpan } from '../scope-override';

export type Side = 'before' | 'after';

/** How far the first question reaches, in days. */
export const FIRST_WINDOW_DAYS = 62;

export interface MediaDay {
  date: string;
  count: number;
}

/**
 * The nearest day holding media on one side of `span`, among a calendar's
 * days — which need not be sorted. Days inside the span, or on the wrong side,
 * are ignored. Pure.
 */
export function nearestMediaDay(
  days: readonly MediaDay[],
  span: DaySpan,
  side: Side,
): MediaDay | null {
  let best: MediaDay | null = null;
  for (const d of days) {
    if (d.count <= 0) continue;
    if (side === 'after' ? d.date <= span.to : d.date >= span.from) continue;
    if (!best || (side === 'after' ? d.date < best.date : d.date > best.date)) best = d;
  }
  return best;
}

/**
 * The first window to ask, or null when there is nowhere to look: nothing is
 * shot after `today`. Pure.
 */
export function firstWindow(span: DaySpan, side: Side, today: string): DaySpan | null {
  if (side === 'after') {
    const from = shiftDay(span.to, 1);
    const far = shiftDay(span.to, FIRST_WINDOW_DAYS);
    if (!from || !far || from > today) return null;
    return { from, to: far < today ? far : today };
  }
  const from = shiftDay(span.from, -FIRST_WINDOW_DAYS);
  const to = shiftDay(span.from, -1);
  return from && to ? { from, to } : null;
}

/**
 * Where to look once `asked` came back empty: the rest of the way to the edge
 * of the library, or null when `asked` already reached it (or the instance
 * holds nothing dated at all). Pure.
 */
export function restWindow(
  asked: DaySpan,
  side: Side,
  bounds: { min: string; max: string } | null,
  today: string,
): DaySpan | null {
  if (!bounds) return null;
  if (side === 'after') {
    const edge = bounds.max < today ? bounds.max : today;
    const from = shiftDay(asked.to, 1);
    return from && from <= edge ? { from, to: edge } : null;
  }
  const to = shiftDay(asked.from, -1);
  return to && bounds.min <= to ? { from: bounds.min, to } : null;
}

/** What a deck index is: an edge card, or a picture of the day. */
export type DeckEntry = { kind: 'edge'; side: Side } | { kind: 'body'; index: number };

/**
 * The deck is `[before, ...body, after]`, `bodyLength` ≥ 1 (a day with no
 * picture to show still has its one card saying so). Pure.
 */
export function deckEntry(at: number, bodyLength: number): DeckEntry {
  if (at <= 0) return { kind: 'edge', side: 'before' };
  if (at > bodyLength) return { kind: 'edge', side: 'after' };
  return { kind: 'body', index: at - 1 };
}

/**
 * Which way a page went, from the index it left to the one it landed on, in
 * a deck that wraps. Unambiguous from three items up, which the two edge cards
 * guarantee. Pure.
 */
export function pageDirection(from: number, to: number, count: number): -1 | 1 {
  return (from + 1) % count === to ? 1 : -1;
}
