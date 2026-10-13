/**
 * The picker's SPAN scope, pure — several days of an instance listed as one
 * scope, where Day and Folder each hold one.
 *
 * A trip, a month of flights or a season is not one day and not one Winnow
 * session, and picking it a day at a time was the picker's one real limit.
 * A span is two `YYYY-MM-DD` (inclusive, camera-local like Winnow's own
 * `capture_date`); the request is the Day scope's own with two different
 * ends. What a span adds is said here: its presets, its words, and the day
 * each row is grouped under in the grid.
 */

import type { DaySpan } from '../../scope-override';
import type { WinnowAssetRow } from '../client';
import {
  addDays,
  daysBetween,
  formatDayMonth,
  formatIsoDate,
  isIsoDate,
  WEEKDAYS,
  weekdayIndex,
  type IsoDate,
} from '../../../roadtrip/trip-days';

/** The two ends in order, or null when either is not a date. */
export function normalSpan(from: string, to: string): DaySpan | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** How many days a span covers, both ends counted. */
export function spanDays(span: DaySpan): number {
  return (daysBetween(span.from, span.to) ?? 0) + 1;
}

/** `12 Sep → 3 Oct 2026`, `12 → 30 Sep 2026`, `3 Oct 2026` — a span read by a person. */
export function spanLabel(span: DaySpan): string {
  if (span.from === span.to) return formatIsoDate(span.from);
  const [fy, fm] = span.from.split('-');
  const [ty, tm] = span.to.split('-');
  if (fy !== ty) return `${formatIsoDate(span.from)} → ${formatIsoDate(span.to)}`;
  if (fm === tm) return `${Number(span.from.slice(8))} → ${formatIsoDate(span.to)}`;
  return `${formatDayMonth(span.from)} → ${formatIsoDate(span.to)}`;
}

/** `Sat 12 Sep 2026` — a day heading in the grid. */
export function dayHeading(iso: IsoDate): string {
  const w = weekdayIndex(iso);
  return w === null ? iso : `${WEEKDAYS[w]} ${formatIsoDate(iso)}`;
}

export interface SpanPreset {
  id: string;
  label: string;
  span: DaySpan;
}

/**
 * The spans one click away: the host's own (its leg, its day — the anchor it
 * already marks in the month), then the last week, the last 30 days, this
 * month and this year, each ending today. A host span that repeats a later
 * one is listed once, under the host's word.
 */
export function spanPresets(
  today: IsoDate,
  host: readonly { label: string; span: DaySpan }[] = [],
): SpanPreset[] {
  const back = (n: number) => addDays(today, -(n - 1)) ?? today;
  const out: SpanPreset[] = host.flatMap((h, i) => {
    const span = normalSpan(h.span.from, h.span.to);
    return span ? [{ id: `host-${i}`, label: h.label, span }] : [];
  });
  const fixed: SpanPreset[] = [
    { id: 'week', label: 'Last 7 days', span: { from: back(7), to: today } },
    { id: 'thirty', label: 'Last 30 days', span: { from: back(30), to: today } },
    { id: 'month', label: 'This month', span: { from: `${today.slice(0, 7)}-01`, to: today } },
    { id: 'year', label: `${today.slice(0, 4)}`, span: { from: `${today.slice(0, 4)}-01-01`, to: today } },
  ];
  for (const p of fixed) {
    if (!out.some((o) => o.span.from === p.span.from && o.span.to === p.span.to)) out.push(p);
  }
  return out;
}

/**
 * Where Span opens when nothing says better: the span the host names, else
 * the last one used on this instance, else the month around the host's day —
 * up to today, when that month is the one under way.
 */
export function openingSpan(
  day: IsoDate,
  today: IsoDate,
  hostSpan?: DaySpan | null,
  remembered?: DaySpan | null,
): DaySpan {
  for (const s of [hostSpan, remembered]) {
    const span = s ? normalSpan(s.from, s.to) : null;
    if (span) return span;
  }
  const first = `${day.slice(0, 7)}-01`;
  const next = addDays(`${day.slice(0, 7)}-28`, 4) ?? day;
  const last = addDays(`${next.slice(0, 7)}-01`, -1) ?? day;
  return { from: first, to: first <= today && today < last ? today : last };
}

/** The day a row is filed under: Winnow's camera-local `capture_date`, else its instant's date. */
export function rowDay(row: WinnowAssetRow): IsoDate | null {
  if (row.capture_date && isIsoDate(row.capture_date.slice(0, 10))) return row.capture_date.slice(0, 10);
  if (row.captured_at && isIsoDate(row.captured_at.slice(0, 10))) return row.captured_at.slice(0, 10);
  return null;
}

/**
 * Consecutive runs of the same day, in the list's own order — never regrouped,
 * so the grid draws exactly the order the verbs, a ⇧-click and the lightbox
 * walk. A row with no date runs under `null`.
 */
export function dayRuns<T>(items: readonly T[], dayOf: (item: T) => IsoDate | null): { day: IsoDate | null; items: T[] }[] {
  const out: { day: IsoDate | null; items: T[] }[] = [];
  for (const it of items) {
    const day = dayOf(it);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}
