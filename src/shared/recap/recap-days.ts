/**
 * The calendar a recap reads — days, never instants (Trips' rule: «calendar
 * days, never file names»). A recap asks "which pictures were taken ON this
 * day", so everything here is an `YYYY-MM-DD` read off the capture's own wall
 * clock, compared in UTC like `trip-days.ts`, which it builds on.
 *
 * Pure and DOM-free.
 */

import { addDays, parseIsoDate, toIsoDate, weekdayIndex, type IsoDate } from '../roadtrip/trip-days';

export type { IsoDate };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** `YYYY-MM-01` of the month `iso` falls in; null for a bad date. */
export function monthStart(iso: IsoDate): IsoDate | null {
  return parseIsoDate(iso) === null ? null : `${iso.slice(0, 7)}-01`;
}

/** How many days the month of `iso` has. */
export function daysInMonth(iso: IsoDate): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every day of the month `iso` falls in, in order. */
export function monthDays(iso: IsoDate): IsoDate[] {
  const start = monthStart(iso);
  if (!start) return [];
  const n = daysInMonth(start);
  const out: IsoDate[] = [];
  for (let d = 1; d <= n; d++) out.push(`${start.slice(0, 8)}${String(d).padStart(2, '0')}`);
  return out;
}

/**
 * The first day of the week `iso` falls in: a Monday when `weekStart` is 1,
 * a Sunday when it is 0.
 */
export function weekStartOf(iso: IsoDate, weekStart: 0 | 1 = 1): IsoDate | null {
  const wd = weekdayIndex(iso);
  if (wd === null) return null;
  const back = weekStart === 1 ? wd : (wd + 1) % 7;
  return addDays(iso, -back);
}

/** The seven days of the week starting on `start`. */
export function weekDays(start: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (d) out.push(d);
  }
  return out;
}

/** Where the 1st of the month sits in a row of seven: 0 = the first column. */
export function monthLead(iso: IsoDate, weekStart: 0 | 1 = 1): number {
  const start = monthStart(iso);
  const wd = start ? weekdayIndex(start) : null;
  if (wd === null) return 0;
  return weekStart === 1 ? wd : (wd + 1) % 7;
}

/** The column headers of a week, in the order the week is drawn. */
export function weekdayHeaders(weekStart: 0 | 1 = 1): string[] {
  return weekStart === 1 ? WEEKDAY_NAMES.slice() : [WEEKDAY_NAMES[6], ...WEEKDAY_NAMES.slice(0, 6)];
}

/**
 * A step back in time — `1y`, `6m`, `2w`, `0d` — as a recap's "on this day"
 * ladder names it.
 */
export type AgoUnit = 'd' | 'w' | 'm' | 'y';
export interface Ago {
  n: number;
  unit: AgoUnit;
}

const AGO = /^(\d{1,3})([dwmy])$/;

export function parseAgo(text: string): Ago | null {
  const m = AGO.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 100) return null;
  return { n, unit: m[2] as AgoUnit };
}

export function agoKey(a: Ago): string {
  return `${a.n}${a.unit}`;
}

/**
 * The day `ago` before `iso`. A month or a year back keeps the day of the
 * month and falls on the last day when that month is shorter: 31 March one
 * month back is 28 (or 29) February, never 3 March — "on this day" must stay
 * in the month it names.
 */
export function dayAgo(iso: IsoDate, ago: Ago): IsoDate | null {
  const ms = parseIsoDate(iso);
  if (ms === null) return null;
  if (ago.unit === 'd') return addDays(iso, -ago.n);
  if (ago.unit === 'w') return addDays(iso, -7 * ago.n);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const months = ago.unit === 'm' ? ago.n : ago.n * 12;
  const total = y * 12 + m - months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  if (ty < 1) return null;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return toIsoDate(Date.UTC(ty, tm, Math.min(d, last)));
}

/** "1 year ago", "3 months ago", "Today". */
export function agoLabel(a: Ago): string {
  if (a.n === 0) return 'Today';
  const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[a.unit];
  return `${a.n} ${unit}${a.n === 1 ? '' : 's'} ago`;
}

export function monthName(iso: IsoDate): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? '';
}

/** "4 Nov 2025". */
export function shortDate(iso: IsoDate): string {
  const ms = parseIsoDate(iso);
  if (ms === null) return iso;
  return `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** "4 November". */
export function dayMonth(iso: IsoDate): string {
  return `${Number(iso.slice(8, 10))} ${monthName(iso)}`;
}

/** ISO week number of `iso` (Monday weeks, the week holding the year's first Thursday is 1). */
export function isoWeek(iso: IsoDate): number {
  const ms = parseIsoDate(iso);
  if (ms === null) return 0;
  const wd = (new Date(ms).getUTCDay() + 6) % 7;
  const thursday = ms + (3 - wd) * 86400000;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return 1 + Math.floor((thursday - yearStart) / (7 * 86400000));
}

/**
 * The calendar day a capture was taken on, from what a source says: an EXIF
 * `DateTimeOriginal` (`2025:11:04 18:42:07`), an ISO date or instant
 * (`2025-11-04`, `2025-11-04T18:42:07`). The capture's OWN wall clock — a
 * time zone suffix is ignored on purpose, the day is the one the person lived.
 */
export function captureDay(text: string | null | undefined): IsoDate | null {
  if (!text) return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return parseIsoDate(iso) === null ? null : iso;
}

/** Minutes since the day began, from the same texts — orders a day's pictures; null when unsaid. */
export function captureMinute(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\d{4}[:-]\d{2}[:-]\d{2}[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60;
}

/** Seconds into the day of a capture instant, when the text says them (`2026:10:12 18:42:07`) — what tells a burst. */
export function captureSecond(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\d{4}[:-]\d{2}[:-]\d{2}[T ](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * A day hidden in a camera's file name, when nothing else says it: DJI's
 * `DJI_20251104184207_0001`, a phone's `IMG_20251104_184207`, `PXL_20251104…`.
 */
export function dayFromName(name: string): { day: string; minute: number | null } | null {
  const m = /(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})?(\d{2})?/.exec(name);
  if (!m) return null;
  const day = captureDay(`${m[1]}-${m[2]}-${m[3]}`);
  if (!day) return null;
  const minute = m[4] && m[5] && Number(m[4]) < 24 && Number(m[5]) < 60 ? Number(m[4]) * 60 + Number(m[5]) : null;
  return { day, minute };
}
