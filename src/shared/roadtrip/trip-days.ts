/**
 * Calendar arithmetic for road trips — the foundation the whole tool derives
 * from: "Australie, jour 27/310" is this module answering two subtractions.
 *
 * A trip day is a CALENDAR DATE, not an instant: `2025-03-14` is the same day
 * whether you read it in Perth or in Brest. So dates travel as `YYYY-MM-DD`
 * strings and every subtraction runs in **UTC** (`Date.UTC` / `getUTC*`),
 * never through a local `Date` — the same rule `telemetry/time-format.ts`
 * follows, and for the same reason: parsing locally would let the *reading*
 * machine's timezone move a value, so a trip planned in France and reviewed in
 * Australia would disagree about which day a photo belongs to. UTC has no DST,
 * so stepping a day is exactly one constant.
 *
 * Pure and DOM-free.
 */

export type IsoDate = string;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Weekday names of the grid, Monday first (the European week). */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * UTC midnight of an `YYYY-MM-DD` string, or null when it is not a real date.
 * Rejects the calendar impossibilities `Date.UTC` would silently roll over
 * (`2025-02-30` → 2 March), because a trip whose end date silently moved is
 * worse than one that refuses to be created.
 */
export function parseIsoDate(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

export function isIsoDate(iso: string): boolean {
  return parseIsoDate(iso) !== null;
}

/** UTC milliseconds back to `YYYY-MM-DD`. */
export function toIsoDate(utcMs: number): IsoDate {
  const d = new Date(utcMs);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today as the user's own calendar reads it. "Today" is the one place a LOCAL
 * reading is correct — it is the date on the wall behind the person, not an
 * instant — so the local fields are read and then frozen into an `IsoDate`,
 * after which every comparison is UTC like the rest of the module.
 */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** `iso` shifted by whole days; null when `iso` is not a date. */
export function addDays(iso: IsoDate, days: number): IsoDate | null {
  const ms = parseIsoDate(iso);
  return ms === null ? null : toIsoDate(ms + days * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * The 1-based day number of `iso` inside a span starting at `start` — the "27"
 * of "jour 27/310". Days before the start count backwards (0, -1, …) rather
 * than being refused: a photo shot the day before departure is a real thing to
 * hold, and the caller decides whether to show it. Null only for a bad date.
 */
export function dayNumber(start: IsoDate, iso: IsoDate): number | null {
  const delta = daysBetween(start, iso);
  return delta === null ? null : delta + 1;
}

/**
 * Whole years elapsed from `from` to `to` — the "1" of "one year ago today".
 * Counted on the calendar, not by dividing days: the anniversary of 29 February
 * falls on 1 March in common years, and 365.25 would put it either side by
 * turns. Negative when `to` precedes `from`; null for a bad date.
 */
export function yearsBetween(from: IsoDate, to: IsoDate): number | null {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (a === null || b === null) return null;
  const da = new Date(a);
  const db = new Date(b);
  let years = db.getUTCFullYear() - da.getUTCFullYear();
  const monthDelta = db.getUTCMonth() - da.getUTCMonth();
  const dayDelta = db.getUTCDate() - da.getUTCDate();
  // The anniversary has not come round yet this year.
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) years -= 1;
  return years;
}

/** Inclusive length of a span in days ("310"); null for a bad or reversed span. */
export function spanLength(start: IsoDate, end: IsoDate): number | null {
  const delta = daysBetween(start, end);
  if (delta === null || delta < 0) return null;
  return delta + 1;
}

/** Whether `iso` falls inside `[start, end]`, both ends included. */
export function isWithin(start: IsoDate, end: IsoDate, iso: IsoDate): boolean {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  const x = parseIsoDate(iso);
  if (a === null || b === null || x === null) return false;
  return x >= a && x <= b;
}

/** Every date of `[start, end]`, in order. Empty for a reversed or bad span. */
export function enumerateDays(start: IsoDate, end: IsoDate): IsoDate[] {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  if (a === null || b === null || b < a) return [];
  const out: IsoDate[] = [];
  for (let ms = a; ms <= b; ms += DAY_MS) out.push(toIsoDate(ms));
  return out;
}

/** 0 = Monday … 6 = Sunday. Null for a bad date. */
export function weekdayIndex(iso: IsoDate): number | null {
  const ms = parseIsoDate(iso);
  if (ms === null) return null;
  // getUTCDay is 0 = Sunday; rotate so Monday leads the week.
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/**
 * The trip laid out as a GitHub-style contribution grid: one column per
 * calendar week, seven rows Monday→Sunday. Cells outside the trip are `null`
 * so the first and last weeks keep their real shape — a trip starting on a
 * Thursday must start three cells down, or the whole grid reads as the wrong
 * weekday and the "I never post on Sundays" pattern the grid exists to reveal
 * would be a lie.
 */
export function heatmapWeeks(start: IsoDate, end: IsoDate): (IsoDate | null)[][] {
  const days = enumerateDays(start, end);
  if (!days.length) return [];
  const lead = weekdayIndex(days[0]) ?? 0;
  const cells: (IsoDate | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Which column each month starts in, for the labels above the grid. A month is
 * labelled on the first week that CONTAINS its first day present in the grid,
 * and the first month is labelled at column 0 even when the trip joins it
 * mid-month — an unlabelled leading column reads as "no month".
 */
export function monthLabels(
  weeks: (IsoDate | null)[][],
): { column: number; label: string }[] {
  const out: { column: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, column) => {
    for (const iso of week) {
      if (!iso) continue;
      const ms = parseIsoDate(iso);
      if (ms === null) continue;
      const month = new Date(ms).getUTCMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        out.push({ column, label: MONTHS[month] });
      }
      break;
    }
  });
  return out;
}

/** `14 Mar 2025` — a date read by a human, never parsed back. */
export function formatIsoDate(iso: IsoDate): string {
  const ms = parseIsoDate(iso);
  if (ms === null) return iso;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
