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

  // `source` is the instance's own word, and the one it really sends: a day
  // holding any trustworthy fix is placed by those alone and reported
  // "measured", else "inferred". `inferred: boolean` is read too because an
  // older or stubbed instance may say it that way, and the counts are the last
  // resort — a row that says nothing about provenance and holds no measured
  // fix is, by construction, inferred.
  const inferred =
    row.source === 'inferred' ? true
    : row.source === 'measured' ? false
    : typeof row.inferred === 'boolean' ? row.inferred
    : measured === 0;

  return { date, lat, lon, count, measured, inferred };
}

/**
 * The days an instance answered with, split into the two things they are.
 *
 * A day the filters match but that holds NO position is still sent, with null
 * coordinates — the instance calls it a *declared gap*, and it is the reason
 * this feature needs one request rather than two: "no data for this day" and
 * "no media that day" are different answers, and only the first appears here
 * at all. Reading them from the same response is also what keeps the two
 * counts from ever disagreeing.
 *
 * A repeated date keeps the FIRST row — a duplicate is the instance
 * contradicting itself, and picking the later one silently would make the
 * result depend on the order a page arrived in. A row whose date is not a
 * calendar day is dropped entirely: it is neither a position nor a gap.
 */
export interface DayTrack {
  /** Days with a position, in calendar order. */
  points: DayPoint[];
  /** Days holding media and no position at all, in calendar order. */
  blind: IsoDate[];
}

export function readDayTrack(rows: readonly unknown[]): DayTrack {
  const points = new Map<IsoDate, DayPoint>();
  const blind = new Set<IsoDate>();

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const date = (raw as { date?: unknown }).date;
    if (typeof date !== 'string' || !isIsoDate(date)) continue;
    if (points.has(date) || blind.has(date)) continue;

    const point = readDayPoint(raw);
    if (point) points.set(date, point);
    else blind.add(date);
  }

  const byDate = (a: IsoDate, b: IsoDate) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    points: [...points.values()].sort((a, b) => byDate(a.date, b.date)),
    blind: [...blind].sort(byDate),
  };
}
