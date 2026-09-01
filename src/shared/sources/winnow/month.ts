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
