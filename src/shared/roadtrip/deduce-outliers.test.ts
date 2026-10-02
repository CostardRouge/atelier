import { describe, expect, it } from 'vitest';
import type { DayPoint } from './day-track';
import { findOutliers, withoutOutliers } from './deduce-outliers';
import { segmentTrack } from './segment-track';

const PERTH = { lat: -31.95, lon: 115.86 };
const BROOME = { lat: -17.96, lon: 122.24 };
const DERBY = { lat: -17.3, lon: 123.63 };

const day = (date: string, at: { lat: number; lon: number }, jitter = 0): DayPoint => ({
  date,
  lat: at.lat + jitter,
  lon: at.lon,
  count: 100,
  measured: 50,
  inferred: false,
});

/** A week in Broome with one day's pictures placed at home, in Perth. */
const WEEK = [
  day('2025-11-02', BROOME),
  day('2025-11-03', BROOME, 0.01),
  day('2025-11-04', PERTH),
  day('2025-11-05', BROOME, -0.01),
  day('2025-11-06', BROOME),
];

describe('findOutliers', () => {
  it('finds the day placed far from both its neighbours, which sit together', () => {
    const [found, ...rest] = findOutliers(WEEK);
    expect(rest).toEqual([]);
    expect(found.point.date).toBe('2025-11-04');
    expect(found.fromPrevious).toBeGreaterThan(1500);
    expect(found.fromNext).toBeGreaterThan(1500);
    expect(found.neighbours).toBeLessThan(5);
  });

  it('never convicts a day on the road: its neighbours are far apart too', () => {
    const road = [day('2025-11-02', PERTH), day('2025-11-03', { lat: -25, lon: 119 }), day('2025-11-04', BROOME)];
    expect(findOutliers(road)).toEqual([]);
  });

  it('never convicts the first or the last day — one neighbour is no alibi', () => {
    expect(findOutliers([day('2025-11-02', PERTH), day('2025-11-03', BROOME)])).toEqual([]);
    expect(findOutliers([day('2025-11-02', PERTH), day('2025-11-03', BROOME), day('2025-11-04', DERBY)])).toEqual([]);
  });

  it('reads its two thresholds from the caller', () => {
    expect(findOutliers(WEEK, { farKm: 3000 })).toEqual([]);
    expect(findOutliers(WEEK, { nearKm: 1 })).toEqual([]);
  });
});

describe('withoutOutliers', () => {
  it('drops the days found, and segmentation then reads one halt where it read three', () => {
    const outliers = findOutliers(WEEK);
    expect(segmentTrack(WEEK).legs).toHaveLength(3);
    const cleaned = withoutOutliers(WEEK, outliers);
    expect(cleaned.map((p) => p.date)).toEqual(['2025-11-02', '2025-11-03', '2025-11-05', '2025-11-06']);
    const { legs } = segmentTrack(cleaned);
    expect(legs).toHaveLength(1);
    // The day is covered as a blind one: the leg spans it without placing it.
    expect(legs[0]).toMatchObject({ startDate: '2025-11-02', endDate: '2025-11-06', bridged: 1 });
  });
});
