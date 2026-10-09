/**
 * What an agent asks for when it fills a roll from a Winnow day: the rows of
 * a span narrowed by the instance's own culling (`culling.ts` — read, never
 * written here) and by kind. Pure.
 */

import { CommandError } from '../commands/registry';
import { cullingFromRow, type Verdict } from '../sources/winnow/culling';

export interface RowFilter {
  /** Only rows Winnow gave this verdict. */
  verdict?: Verdict;
  /** Only rows with at least this many stars, 0..5. */
  minStars?: number;
  /** `photo`, `video`, or both when absent. */
  media?: 'photo' | 'video';
}

export const VERDICTS: readonly Verdict[] = ['pick', 'reject', 'skip', 'unrated'];

/** A `YYYY-MM-DD` day, or refused. */
export function readDay(path: string, raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new CommandError('invalid', `${path} must be a day as YYYY-MM-DD`);
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) throw new CommandError('invalid', `${path} is not a calendar day: ${raw}`);
  return raw;
}

/** The rows that pass, in the order they came. A row with no culling passes a verdict filter only for `unrated`. */
export function filterRows<T extends { media_type: 'photo' | 'video'; verdict?: unknown; star?: unknown; color_label?: unknown }>(
  rows: readonly T[],
  filter: RowFilter,
): T[] {
  return rows.filter((row) => {
    if (filter.media && row.media_type !== filter.media) return false;
    const c = cullingFromRow(row) ?? { verdict: 'unrated' as Verdict, star: 0, color: null };
    if (filter.verdict && c.verdict !== filter.verdict) return false;
    if (filter.minStars !== undefined && c.star < filter.minStars) return false;
    return true;
  });
}
