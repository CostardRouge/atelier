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
  /** `YYYY-MM`, the block's stable key and its anchor id. */
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
 * where the eye rests while a list scrolls, and the last one whose top is
 * above it. `tops` are the blocks' offsets in the scroller, ascending. -1 with
 * no blocks.
 */
export function visibleBlock(tops: readonly number[], scrollTop: number, viewport: number): number {
  if (!tops.length) return -1;
  const eye = scrollTop + viewport / 3;
  let at = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= eye) at = i;
    else break;
  }
  return at;
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
