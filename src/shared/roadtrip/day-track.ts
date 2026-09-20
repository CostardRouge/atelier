/**
 * One position per day — the whole input of the itinerary deduction.
 *
 * The premise the feature rests on: a journey's shape is not in its fifty
 * thousand media, it is in ONE POSITION PER DAY. A hundred days of a trip is a
 * few kilobytes, no media byte is fetched, and the volume never enters the
 * arithmetic. What the author then accepts or refuses is a leg — thirty rows,
 * not fifty thousand.
 *
 * A `DayPoint` is deliberately NOT a Winnow row. The instance aggregates
 * (`/api/assets/geo?by=day`) and the client normalises what arrives into this
 * shape at the boundary, exactly as it does for the calendar's bounds — so the
 * segmentation below can be driven by a local folder just as well, the day one
 * exists. This module never fetches.
 *
 * Two rules are made executable here rather than trusted:
 *
 * - **A date is a plain `YYYY-MM-DD` or it is refused**, never sliced from an
 *   instant. A clip shot at 07:00 in Perth is the 12th on the wall behind the
 *   photographer and the 11th in UTC; recomputing walks a third of an
 *   Australian trip back a day (`trip-days.ts` subtracts in UTC by design).
 * - **`inferred` says the day rests only on machine-guessed positions.** Winnow
 *   computes a day that holds at least one measured frame from those alone, so
 *   eight hundred batch-placed Sony frames cannot drown five real iPhone fixes.
 *   Read it, never recompute it, and never let it decide geometry: an inferred
 *   day is a day to bridge OVER, not evidence of where a leg is — it may have
 *   been guessed from a neighbouring folder, and a neighbour can be a day of
 *   driving.
 *
 * Pure and DOM-free.
 */

import { isIsoDate, type IsoDate } from './trip-days';
import type { GeoPoint } from './hooks/geo';

/**
 * Where one calendar day was, and how much that claim is worth. `lat`/`lon`
 * are the MEDIAN of the day's fixes, never the mean — a single frame shot from
 * the plane the evening before drags a centroid and leaves a median alone.
 */
export interface DayPoint extends GeoPoint {
  date: IsoDate;
  /** Media behind the day, whatever their provenance. */
  count: number;
  /** How many of those carried a measured or hand-authored position. */
  measured: number;
  /** The position rests only on batch-inferred fixes. */
  inferred: boolean;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function counted(value: unknown): number {
  const n = finite(value);
  return n !== null && n >= 0 ? Math.round(n) : 0;
}

/**
 * One aggregated row, validated. `null` for anything this module refuses to
 * guess at: a date that is not a calendar day, coordinates that are missing,
 * not finite, or outside the globe.
 *
 * Null Island is refused too (`parsePosition` does the same for a drone cue):
 * `0, 0` is what a camera writes when it has no fix, and one such day would
 * drag a leg into the Gulf of Guinea.
 */
export function readDayPoint(raw: unknown): DayPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const date = typeof row.date === 'string' ? row.date : '';
  if (!isIsoDate(date)) return null;

  const lat = finite(row.lat);
  const lon = finite(row.lon);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;

  const count = counted(row.count);
  const reported = counted(row.measured);
  // An instance that says more measured than it holds is contradicting itself;
  // trust the smaller number rather than the flattering one.
  const measured = count > 0 ? Math.min(reported, count) : reported;

  // `inferred` is the instance's own word. Fall back to the counts only when
  // it is absent — a row that says nothing about provenance and holds no
  // measured fix is, by construction, inferred.
  const inferred =
    typeof row.inferred === 'boolean' ? row.inferred : measured === 0;

  return { date, lat, lon, count, measured, inferred };
}

/**
 * The rows this module will work on: validated, in calendar order, one per
 * day. A repeated date keeps the FIRST row — a duplicate is the instance
 * contradicting itself, and picking the later one silently would make the
 * result depend on the order a page arrived in.
 */
export function dayPointsFrom(rows: readonly unknown[]): DayPoint[] {
  const byDate = new Map<IsoDate, DayPoint>();
  for (const raw of rows) {
    const point = readDayPoint(raw);
    if (point && !byDate.has(point.date)) byDate.set(point.date, point);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
