/**
 * A day whose position is far from both its neighbours while they sit close
 * to each other — the one shape a library's flaw takes that no radius can
 * absorb.
 *
 * Measured case, the maintainer's own: a drone that kept the GPS of home
 * puts ONE day in Perth in the middle of a week in Broome. `segmentTrack`
 * does what it must with such a day — it closes Broome, opens a one-day
 * halt two thousand kilometres away, and opens Broome again — and the
 * deduction then proposes three stages where there was one. Nothing in the
 * arithmetic is wrong; the day is.
 *
 * So the day is SAID rather than silently swallowed: it is found here, the
 * window lists it with its distances, and the deduction runs over the
 * other days by default. The author can keep it — a real day trip by plane
 * exists — and then it becomes a halt of its own like any other. Nothing
 * is invented: an ignored day is treated as a day with no position, which
 * is what a wrong position amounts to, and bridging covers it the way it
 * covers a blind one.
 *
 * The test is deliberately strict — far from BOTH neighbours, which are
 * NEAR each other — so a day on the road between two distant halts is never
 * an outlier: its neighbours are far apart too.
 *
 * Pure and DOM-free.
 */

import type { DayPoint } from './day-track';
import { haversineKm } from './hooks/geo';

export interface OutlierOptions {
  /** Further than this from each neighbour. */
  farKm: number;
  /** While the two neighbours lie closer than this to each other. */
  nearKm: number;
}

export const DEFAULT_OUTLIERS: OutlierOptions = { farKm: 1500, nearKm: 150 };

export interface Outlier {
  point: DayPoint;
  /** Its distance to the placed day before and after it, in km. */
  fromPrevious: number;
  fromNext: number;
  /** How far the two neighbours are from each other. */
  neighbours: number;
}

/**
 * The outliers of a track, each with the three distances that convicted it,
 * in calendar order. The first and last placed days can never be one: they
 * have one neighbour, and one neighbour is no alibi.
 */
export function findOutliers(
  points: readonly DayPoint[],
  options: Partial<OutlierOptions> = {},
): Outlier[] {
  const { farKm, nearKm } = { ...DEFAULT_OUTLIERS, ...options };
  const out: Outlier[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    const next = points[i + 1];
    const fromPrevious = haversineKm(point, previous);
    const fromNext = haversineKm(point, next);
    const neighbours = haversineKm(previous, next);
    if (fromPrevious > farKm && fromNext > farKm && neighbours < nearKm) {
      out.push({ point, fromPrevious, fromNext, neighbours });
    }
  }
  return out;
}

/** The track without those days — what the deduction runs over by default. */
export function withoutOutliers(
  points: readonly DayPoint[],
  outliers: readonly Outlier[],
): DayPoint[] {
  const dates = new Set(outliers.map((o) => o.point.date));
  return points.filter((p) => !dates.has(p.date));
}
