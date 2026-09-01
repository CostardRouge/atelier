/**
 * Month arithmetic for the Winnow browser's calendar, on `YYYY-MM-DD` strings
 * and in UTC — the same rule Road Trip's `trip-days.ts` follows, because a
 * local-time subtraction across a DST edge is how a day goes missing.
 */

export interface MonthSpan {
  /** `YYYY-MM`. */
  key: string;
  /** First and last day, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Every day of the month, in order. */
  days: string[];
  /** 0 = Monday … 6 = Sunday, of the first day — where the grid starts. */
  leading: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function monthSpan(key: string): MonthSpan {
  const [y, m] = key.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: count }, (_, i) => `${key}-${pad(i + 1)}`);
  // getUTCDay: 0 = Sunday. Shift so Monday leads, like the Road Trip grid.
  const leading = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  return { key, from: days[0], to: days[count - 1], days, leading };
}

export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** `2025-07` → `July 2025`, in the viewer's language. */
export function monthLabel(key: string, locale?: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface YearOptions {
  year: string;
  /** Oldest first inside a year — a picker reads January to December. */
  months: { key: string; label: string }[];
}

/**
 * Every month between two dates, grouped by year for a `<select>` with one
 * `<optgroup>` per year — newest year first, so the recent trip is at the top.
 * Empty when the bounds are inverted.
 */
export function monthOptions(minIso: string, maxIso: string, locale?: string): YearOptions[] {
  const first = monthKeyOf(minIso);
  const last = monthKeyOf(maxIso);
  if (first > last) return [];
  const byYear = new Map<string, { key: string; label: string }[]>();
  for (let key = first; key <= last; key = shiftMonth(key, 1)) {
    const year = key.slice(0, 4);
    const [, m] = key.split('-').map(Number);
    const label = new Date(Date.UTC(Number(year), m - 1, 1)).toLocaleDateString(locale, {
      month: 'long',
      timeZone: 'UTC',
    });
    const bucket = byYear.get(year) ?? [];
    bucket.push({ key, label });
    byYear.set(year, bucket);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([year, months]) => ({ year, months }));
}
