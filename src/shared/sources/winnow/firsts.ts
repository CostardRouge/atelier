/**
 * Finds in TIME over a library's rows, pure: the same calendar day across
 * the years, and the FIRST frame of each kind of thing — the first in a
 * country, the first with the drone, the first on a body. What a person
 * digs for on an anniversary, and what a trip's badge can count from.
 *
 * Pure and DOM-free.
 */

export interface DayCount {
  date: string;
  count: number;
}

/**
 * The days of other years that fall on the same `MM-DD` as `date`, oldest
 * first, with their counts — the day itself left out. February 29 matches
 * only another February 29: nothing is moved.
 */
export function sameDayAcrossYears(days: readonly DayCount[], date: string): DayCount[] {
  const md = date.slice(5);
  return days
    .filter((d) => d.date !== date && d.date.slice(5) === md && d.count > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface KeyedItem {
  id: number;
  /** The capture instant, ISO, or null — an undated frame is never a first. */
  at: string | null;
  /** What it is a first OF (a country, a body, a kind of gear), or null when the row cannot say. */
  key: string | null;
}

export interface First {
  key: string;
  id: number;
  at: string;
  /** How many frames carry this key in the rows looked at. */
  count: number;
}

/** The earliest frame per key, in the order the keys were first met. */
export function firstsBy(items: readonly KeyedItem[]): First[] {
  const dated = items.filter((i): i is KeyedItem & { at: string; key: string } => i.at !== null && i.key !== null);
  dated.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  const firsts = new Map<string, First>();
  for (const i of dated) {
    const have = firsts.get(i.key);
    if (have) have.count++;
    else firsts.set(i.key, { key: i.key, id: i.id, at: i.at, count: 1 });
  }
  return [...firsts.values()];
}
