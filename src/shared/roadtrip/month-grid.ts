/**
 * The trip as a stack of calendar MONTHS — one block per month the trip
 * touches, seven columns Monday → Sunday, the phone's own calendar.
 *
 * It is the answer to a measurement (`docs/roadtrip-overview-mobile.md` §2):
 * the weekday heatmap fitted to a 390px screen gives a 345-day trip a 6px cell,
 * and no floor makes that grid and the day ruler usable on one span — they
 * are inversely coupled. Turning the axis makes the cell fall out of the
 * geometry instead: a seventh of the width, ~46px, a real target with nothing
 * to invent. The weekday pattern the heatmap exists for survives, because the
 * columns ARE the weekdays.
 *
 * Pure and DOM-free: the blocks, the runs a leg ribbon is drawn from and the
 * cell geometry are all arithmetic, so the component only paints.
 */

import {
  addDays,
  enumerateDays,
  parseIsoDate,
  toIsoDate,
  weekdayIndex,
  type IsoDate,
} from './trip-days';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface MonthWeek {
  /** Seven slots, Monday first; `null` where the month has no day. */
  cells: readonly (IsoDate | null)[];
}

export interface MonthBlock {
  /** `YYYY-MM`, the block's stable key and its anchor id — `weeks` for a short trip's one block. */
  key: string;
  year: number;
  /** 0 = January. */
  month: number;
  /** "July", and "July 2025" on the first block and every January — a stack of months needs its year said once per turn. */
  label: string;
  /** The whole calendar month, so a trip joining it mid-way still reads as a month. */
  weeks: readonly MonthWeek[];
  /** The days of this month that belong to the trip, in order. */
  tripDays: readonly IsoDate[];
  /**
   * Where another month begins INSIDE the block — a short trip's one block
   * of weeks runs across a month's edge, and the row holding its 1st says
   * so. Empty on a month block, whose header is the whole answer.
   */
  marks: readonly MonthMark[];
}

/** A month beginning inside a block: the row and column of its first day. */
export interface MonthMark {
  week: number;
  col: number;
  label: string;
}

/**
 * Up to this many days a trip is SHORT: drawn as its own weeks with a week's
 * margin either side and no year map, because a map of one column and a
 * whole month for four days told the maintainer nothing (Normandie, 4 days).
 * The threshold is the old day strip's, kept: a longer trip gets the months.
 */
export const SHORT_TRIP_DAYS = 31;

/** How many whole weeks are drawn before and after a short trip, to situate it. */
export const SHORT_TRIP_MARGIN_WEEKS = 1;

export function isShortTrip(start: IsoDate, end: IsoDate): boolean {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (a === null || b === null || b < a) return false;
  return Math.round((b - a) / 86400000) + 1 <= SHORT_TRIP_DAYS;
}

/**
 * A short trip as ONE block: the weeks it touches, `margin` whole weeks
 * before and after, Monday-first, no padding — the row holding a month's
 * first day carries a mark for it unless it is the header's own month.
 * The header names the month the trip STARTS in (with its year), whatever
 * the margin week before belongs to. Empty for a bad or reversed span.
 */
export function weekBlock(start: IsoDate, end: IsoDate, margin = SHORT_TRIP_MARGIN_WEEKS): MonthBlock[] {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (a === null || b === null || b < a) return [];
  const firstMonday = weekStart(start);
  const lastMonday = weekStart(end);
  if (firstMonday === null || lastMonday === null) return [];
  const from = addDays(firstMonday, -7 * margin);
  const to = addDays(lastMonday, 7 * margin + 6);
  if (from === null || to === null) return [];
  const days = enumerateDays(from, to);
  const weeks: MonthWeek[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push({ cells: days.slice(i, i + 7) });
  const startDay = new Date(a);
  const year = startDay.getUTCFullYear();
  const month = startDay.getUTCMonth();
  const marks: MonthMark[] = [];
  weeks.forEach((week, w) => {
    week.cells.forEach((date, col) => {
      if (!date || date.slice(8, 10) !== '01') return;
      const m = Number(date.slice(5, 7)) - 1;
      const y = Number(date.slice(0, 4));
      if (m === month && y === year) return;
      marks.push({ week: w, col, label: y === year ? MONTH_NAMES[m] : `${MONTH_NAMES[m]} ${y}` });
    });
  });
  return [
    {
      key: 'weeks',
      year,
      month,
      label: `${MONTH_NAMES[month]} ${year}`,
      weeks,
      tripDays: days.filter((d) => d >= start && d <= end),
      marks,
    },
  ];
}

/** The blocks a trip is drawn as: its weeks when short, its months otherwise. */
export function tripBlocks(start: IsoDate, end: IsoDate): MonthBlock[] {
  return isShortTrip(start, end) ? weekBlock(start, end) : monthBlocks(start, end);
}

/**
 * One block per calendar month between `start` and `end`, inclusive — the
 * WHOLE month each time, with the trip's own days listed apart. A month is
 * drawn whole because a week that starts mid-month reads as a mistake, and
 * because a leg or a day chosen at the trip's edge still needs its neighbours
 * to be recognisable as a calendar. Empty for a bad or reversed span.
 */
export function monthBlocks(start: IsoDate, end: IsoDate): MonthBlock[] {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (a === null || b === null || b < a) return [];
  const first = new Date(a);
  const last = new Date(b);
  const blocks: MonthBlock[] = [];
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  const stopYear = last.getUTCFullYear();
  const stopMonth = last.getUTCMonth();
  while (year < stopYear || (year === stopYear && month <= stopMonth)) {
    const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthStart = toIsoDate(Date.UTC(year, month, 1));
    const monthEnd = toIsoDate(Date.UTC(year, month, daysIn));
    const days = enumerateDays(monthStart, monthEnd);
    const lead = weekdayIndex(days[0]) ?? 0;
    const cells: (IsoDate | null)[] = [...Array<null>(lead).fill(null), ...days];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: MonthWeek[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push({ cells: cells.slice(i, i + 7) });
    const tripDays = days.filter((d) => d >= start && d <= end);
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const withYear = blocks.length === 0 || month === 0;
    blocks.push({
      key,
      year,
      month,
      label: withYear ? `${MONTH_NAMES[month]} ${year}` : MONTH_NAMES[month],
      weeks,
      tripDays,
      marks: [],
    });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return blocks;
}

/** A run of consecutive cells in one week that share a value — a leg's ribbon. */
export interface WeekRun<T> {
  /** Column of the first cell, 0..6. */
  from: number;
  /** Column of the last cell, inclusive. */
  to: number;
  value: T;
}

/**
 * The runs of one week: consecutive cells whose `keyOf` answers the same
 * value, split where it changes and broken by a `null` cell or a `null`
 * answer. A leg ribbon is one run per week it covers; two legs that abut are
 * two runs. `same` decides what "the same value" means (`===` by default).
 */
export function weekRuns<T>(
  cells: readonly (IsoDate | null)[],
  keyOf: (date: IsoDate) => T | null,
  same: (a: T, b: T) => boolean = (a, b) => a === b,
): WeekRun<T>[] {
  const runs: WeekRun<T>[] = [];
  let run: WeekRun<T> | null = null;
  cells.forEach((cell, col) => {
    const value = cell === null ? null : keyOf(cell);
    if (value === null) {
      if (run) runs.push(run);
      run = null;
      return;
    }
    if (run && same(run.value, value)) {
      run.to = col;
      return;
    }
    if (run) runs.push(run);
    run = { from: col, to: col, value };
  });
  if (run) runs.push(run);
  return runs;
}

/** The gutter between two cells, at every width. */
export const MONTH_GAP = 4;
/** Narrowest a cell is drawn: below this a day is not a target, and the column should be wider. */
export const MIN_MONTH_CELL = 28;
/** Widest: past this a month stops being a calendar and becomes tiles. */
export const MAX_MONTH_CELL = 56;

/**
 * A cell's side for a box `width` wide: a seventh of what the gutters leave,
 * in whole pixels, clamped. At 358px (a 390px phone less the shell's gutter)
 * that is 47px — the target the design asked for, with nothing to choose.
 * Zero width (unmeasured) answers the minimum, so nothing is drawn at zero.
 */
export function monthCell(width: number): number {
  if (!(width > 0)) return MIN_MONTH_CELL;
  const cell = Math.floor((width - 6 * MONTH_GAP) / 7);
  return Math.max(MIN_MONTH_CELL, Math.min(MAX_MONTH_CELL, cell));
}

/** The width seven cells and six gutters take — what a block is drawn at. */
export function monthWidth(cell: number): number {
  return 7 * cell + 6 * MONTH_GAP;
}

/**
 * Which block is "the one on screen" for a scroller at `scrollTop` showing
 * `viewport` pixels: the block covering the viewport's upper third, which is
 * where the eye rests while a list scrolls — the nearest top above it, and,
 * where several blocks share that top (a row of a wide screen's grid), the
 * FIRST of them: the row is read from its left. `tops` are the blocks'
 * offsets in the scroller, non-decreasing. -1 with no blocks.
 */
export function visibleBlock(tops: readonly number[], scrollTop: number, viewport: number): number {
  if (!tops.length) return -1;
  const eye = scrollTop + viewport / 3;
  let best = tops[0];
  for (const top of tops) {
    if (top <= eye) best = top;
    else break;
  }
  return tops.indexOf(best);
}

/** The first and last trip day of a block, or null for a block the trip only frames. */
export function blockSpan(block: MonthBlock): { start: IsoDate; end: IsoDate } | null {
  if (!block.tripDays.length) return null;
  return { start: block.tripDays[0], end: block.tripDays[block.tripDays.length - 1] };
}

/** The Monday on or before `date` — where a block's row for it begins. Null for a bad date. */
export function weekStart(date: IsoDate): IsoDate | null {
  const wd = weekdayIndex(date);
  return wd === null ? null : addDays(date, -wd);
}

/**
 * A calendar week's index from the trip's first week: 0 for the week the
 * trip starts in, 1 for the next. It is the year map's COLUMN for that week
 * (`heatmapWeeks` lays the map out Monday-first from the same origin), so a
 * calendar row and a map column meet on this one number. Null for a bad date.
 */
export function weekIndexOf(date: IsoDate, tripStart: IsoDate): number | null {
  const monday = weekStart(date);
  const origin = weekStart(tripStart);
  if (monday === null || origin === null) return null;
  const days = Math.round((Date.parse(monday) - Date.parse(origin)) / 86400000);
  return Math.floor(days / 7);
}

/** A week row as the calendar's scroller holds it: where it sits, how tall, which week. */
export interface WeekRow {
  top: number;
  height: number;
  /** Its `weekIndexOf`. A week straddling two months is two rows with the same index. */
  week: number;
}

/** A window of weeks, in FRACTIONAL weeks: `from` inclusive, `to` exclusive. */
export interface WeekSpan {
  from: number;
  to: number;
}

/**
 * The weeks on screen for a scroller at `scrollTop` showing `viewport`
 * pixels — the year map's frame, read from the scroll at the PIXEL: the
 * first row cut by the top edge contributes the fraction of it that is
 * hidden, the last row cut by the bottom edge the fraction that shows, so the
 * frame glides with the thumb instead of jumping a month at a time (the
 * maintainer's ask after the first hands-on). Null with no rows.
 */
export function visibleWeekSpan(rows: readonly WeekRow[], scrollTop: number, viewport: number): WeekSpan | null {
  if (!rows.length) return null;
  const bottom = scrollTop + viewport;
  let first: WeekRow | null = null;
  let last: WeekRow | null = null;
  for (const row of rows) {
    if (row.top + row.height <= scrollTop) continue;
    if (row.top >= bottom) break;
    if (!first) first = row;
    last = row;
  }
  if (!first || !last) {
    // Scrolled past every row (a tail below the blocks): the last week stays framed.
    const end = rows[rows.length - 1];
    return { from: end.week + 1, to: end.week + 1 };
  }
  const part = (row: WeekRow, y: number) => (row.height > 0 ? Math.min(1, Math.max(0, (y - row.top) / row.height)) : 0);
  return { from: first.week + part(first, scrollTop), to: last.week + part(last, bottom) };
}

/**
 * The inverse: the `scrollTop` that puts fractional `week` at the top edge —
 * what a drag on the year map's frame asks for. A week that is two rows
 * (straddling a month) answers with its first; a week off either end clamps
 * to the nearest row. Null with no rows.
 */
export function scrollForWeek(rows: readonly WeekRow[], week: number): number | null {
  if (!rows.length) return null;
  const whole = Math.floor(week);
  const frac = week - whole;
  const row = rows.find((r) => r.week === whole);
  if (row) return row.top + frac * row.height;
  if (whole < rows[0].week) return rows[0].top;
  const end = rows[rows.length - 1];
  return end.top + end.height;
}
