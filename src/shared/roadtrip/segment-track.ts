/**
 * Days with a position, read as LEGS — the arithmetic of the itinerary
 * deduction (`day-track.ts` is its input, `track-chapters.ts` its output).
 *
 * A leg is **a run of consecutive days whose position stays within a radius of
 * the run so far**. That is the whole of it, and the simplicity is deliberate:
 * the literature's stop-detection (ST-DBSCAN and its relatives) is built for
 * traces sampled at 1 Hz with noise, while this is fed ONE point per day
 * already reduced to a median. At that sampling a threshold on a run is exact,
 * pure, testable and readable, where a clustering library would be a
 * dependency and a black box.
 *
 * ## Blind days do not cut a run, and that is the load-bearing decision
 *
 * Measured on the instance (2026-09-20, over 641 days of the library): 77 % of
 * days carry a position today, 83 % once the batch geotagging has run, and
 * **17 % will stay blind for good** — one day in six, scattered. An algorithm
 * that closed a run on a day without a position would break a ten-day stay at
 * Broome into three legs, and the list of proposals would be unusable.
 *
 * So two treatments, and the difference between them is moral, not technical:
 *
 * - **Bridging** (`bridgeBlind`, on by default) — a blind day whose neighbours
 *   belong to the same run is simply COVERED by the leg. Nothing is invented: a
 *   leg is a SPAN, and saying "the 3rd to the 12th at Broome" claims nothing
 *   about where day 7 was photographed, only that the leg covers it. That is
 *   what a stage already is.
 * - **Interpolating a move** (`interpolateMoves`, off by default) — a blind day
 *   between two DIFFERENT places. Giving it a position is a fabrication, so it
 *   is opt-in, the days it mints are marked `inferred`, and the legs they
 *   produce carry that mark.
 *
 * Every leg reports `bridged`, so a span held up by two fixes a month apart
 * says so and the author judges it. A hole the two ends contradict, or one at
 * the edge of the trace, stays a real gap — counted, named, never filled.
 *
 * Pure and DOM-free.
 */

import type { DayPoint } from './day-track';
import { haversineKm, type GeoPoint } from './hooks/geo';
import { addDays, daysBetween, spanLength, type IsoDate } from './trip-days';
import type { Gap } from './trip-coverage';

export interface SegmentOptions {
  /** Two days within this distance are the same place. */
  radiusKm: number;
  /** Below this many days a leg is a stop on the way, not a halt. */
  minNights: number;
  /** What to do with those: list them (marked), or fold them into the halt. */
  shortLegs: 'list' | 'merge';
  /** Cover a blind day whose neighbours are the same place. */
  bridgeBlind: boolean;
  /** Invent positions across a blind day between two places. */
  interpolateMoves: boolean;
}

export const DEFAULT_SEGMENT: SegmentOptions = {
  radiusKm: 25,
  minNights: 2,
  shortLegs: 'list',
  bridgeBlind: true,
  interpolateMoves: false,
};

export interface TrackLeg {
  startDate: IsoDate;
  endDate: IsoDate;
  /** Where to call it — the median of its own days, not the walking mean. */
  centroid: GeoPoint;
  /** Calendar days the leg spans, bridged ones included. */
  dayCount: number;
  /** Of those, days that carried no position at all. */
  bridged: number;
  /** Media behind the leg. */
  count: number;
  /** Not one of its days carried a measured fix. */
  inferred: boolean;
  /** Shorter than `minNights`. Listed and marked, never dropped. */
  short: boolean;
  /** Days folded in from short runs, in `merge` mode. */
  absorbed: number;
}

export interface TrackSegmentation {
  legs: TrackLeg[];
  /** Runs of days the trace could not place — said, never filled. */
  blind: Gap[];
}

/** A run being built: its days, and the mean that decides what joins it. */
interface Run {
  points: DayPoint[];
  mean: GeoPoint;
  /** Blind days already covered inside this run. */
  bridged: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function extend(run: Run, point: DayPoint): void {
  run.points.push(point);
  const n = run.points.length;
  run.mean = {
    lat: run.mean.lat + (point.lat - run.mean.lat) / n,
    lon: run.mean.lon + (point.lon - run.mean.lon) / n,
  };
}

function open(point: DayPoint): Run {
  return { points: [point], mean: { lat: point.lat, lon: point.lon }, bridged: 0 };
}

function close(run: Run, minNights: number): TrackLeg {
  const startDate = run.points[0].date;
  const endDate = run.points[run.points.length - 1].date;
  const dayCount = spanLength(startDate, endDate) ?? run.points.length;
  return {
    startDate,
    endDate,
    // The WALK needs an online estimate, so it uses the running mean; the PLACE
    // is named from a robust one, because a single travel day that slipped into
    // the run must not move the name.
    centroid: {
      lat: median(run.points.map((p) => p.lat)),
      lon: median(run.points.map((p) => p.lon)),
    },
    dayCount,
    bridged: run.bridged,
    count: run.points.reduce((sum, p) => sum + p.count, 0),
    inferred: run.points.every((p) => p.inferred),
    short: dayCount < minNights,
    absorbed: 0,
  };
}

/**
 * The days between two points, as positions walked in a straight line. Only
 * reached with `interpolateMoves` on; every day it mints is `inferred`, holds
 * no media of its own, and is therefore a claim the panel marks.
 */
function walkBetween(from: DayPoint, to: DayPoint, holeDays: number): DayPoint[] {
  const made: DayPoint[] = [];
  for (let i = 1; i <= holeDays; i++) {
    const date = addDays(from.date, i);
    if (!date) break;
    const t = i / (holeDays + 1);
    made.push({
      date,
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
      count: 0,
      measured: 0,
      inferred: true,
    });
  }
  return made;
}

/**
 * Fold a short leg into the halt it was on the way to — the NEXT one, because
 * that is where you were going; the previous one when it is the last leg.
 *
 * It only ever folds into an ADJACENT leg. Merging across a blind gap would
 * make the halt claim days nothing supports, which is the one thing bridging
 * is careful not to do.
 */
function mergeShort(legs: TrackLeg[]): TrackLeg[] {
  const out: TrackLeg[] = [];
  const pending: TrackLeg[] = [];

  const adjacent = (before: TrackLeg, after: TrackLeg) =>
    addDays(before.endDate, 1) === after.startDate;

  for (const leg of legs) {
    if (leg.short) {
      pending.push(leg);
      continue;
    }
    let target = leg;
    while (pending.length) {
      const last = pending[pending.length - 1];
      if (!adjacent(last, target)) break;
      pending.pop();
      target = {
        ...target,
        startDate: last.startDate,
        dayCount: target.dayCount + last.dayCount,
        bridged: target.bridged + last.bridged,
        count: target.count + last.count,
        inferred: target.inferred && last.inferred,
        absorbed: target.absorbed + last.dayCount,
      };
    }
    out.push(...pending.splice(0));
    out.push(target);
  }

  // What is still pending had no halt after it: give it to the one before.
  while (pending.length) {
    const first = pending.shift()!;
    const last = out[out.length - 1];
    if (last && !last.short && adjacent(last, first)) {
      out[out.length - 1] = {
        ...last,
        endDate: first.endDate,
        dayCount: last.dayCount + first.dayCount,
        bridged: last.bridged + first.bridged,
        count: last.count + first.count,
        inferred: last.inferred && first.inferred,
        absorbed: last.absorbed + first.dayCount,
      };
    } else {
      out.push(first);
    }
  }

  return out.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
}

export function segmentTrack(
  points: readonly DayPoint[],
  options: Partial<SegmentOptions> = {},
): TrackSegmentation {
  const opts = { ...DEFAULT_SEGMENT, ...options };
  const legs: TrackLeg[] = [];
  const blind: Gap[] = [];
  if (!points.length) return { legs, blind };

  const joins = (run: Run, point: GeoPoint) =>
    haversineKm(run.mean, point) <= opts.radiusKm;

  let run = open(points[0]);

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    const step = daysBetween(previous.date, point.date);
    const holeDays = step === null ? 0 : step - 1;

    if (holeDays > 0) {
      // One predicate decides both questions: a hole is bridged exactly when
      // the day after it would have joined the run anyway. Anything else lets
      // a hole be "inside one place" while its far end starts a new leg, and
      // then the hole belongs to neither.
      if (opts.bridgeBlind && joins(run, point)) {
        run.bridged += holeDays;
        extend(run, point);
        continue;
      }

      if (opts.interpolateMoves) {
        for (const made of walkBetween(previous, point, holeDays)) {
          if (joins(run, made)) extend(run, made);
          else {
            legs.push(close(run, opts.minNights));
            run = open(made);
          }
        }
      } else {
        const start = addDays(previous.date, 1);
        const end = addDays(point.date, -1);
        if (start && end) blind.push({ start, end, length: holeDays });
        legs.push(close(run, opts.minNights));
        run = open(point);
        continue;
      }
    }

    if (joins(run, point)) extend(run, point);
    else {
      legs.push(close(run, opts.minNights));
      run = open(point);
    }
  }

  legs.push(close(run, opts.minNights));

  return { legs: opts.shortLegs === 'merge' ? mergeShort(legs) : legs, blind };
}
