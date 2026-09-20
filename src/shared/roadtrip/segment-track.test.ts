import { describe, expect, it } from 'vitest';
import type { DayPoint } from './day-track';
import { segmentTrack } from './segment-track';

/** Perth, and Kalbarri ~470 km north of it — far past any sane radius. */
const PERTH = -31.95;
const KALBARRI = -27.71;
const BETWEEN = -29.8;
const LON = 115.86;

const day = (date: string, lat: number, extra: Partial<DayPoint> = {}): DayPoint => ({
  date,
  lat,
  lon: LON,
  count: 100,
  measured: 50,
  inferred: false,
  ...extra,
});

const spans = (legs: { startDate: string; endDate: string }[]) =>
  legs.map((l) => `${l.startDate}→${l.endDate}`);

describe('segmentTrack', () => {
  it('has nothing to say about an empty trace', () => {
    expect(segmentTrack([])).toEqual({ legs: [], blind: [] });
  });

  it('reads a run of days at one place as one leg', () => {
    const { legs, blind } = segmentTrack([
      day('2025-11-02', PERTH),
      day('2025-11-03', PERTH + 0.01),
      day('2025-11-04', PERTH - 0.02),
      day('2025-11-05', PERTH),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      startDate: '2025-11-02',
      endDate: '2025-11-05',
      dayCount: 4,
      bridged: 0,
      count: 400,
      short: false,
    });
    expect(blind).toEqual([]);
  });

  it('cuts where the day moved further than the radius', () => {
    const { legs } = segmentTrack([
      day('2025-11-02', PERTH),
      day('2025-11-03', PERTH),
      day('2025-11-04', KALBARRI),
      day('2025-11-05', KALBARRI),
    ]);
    expect(spans(legs)).toEqual(['2025-11-02→2025-11-03', '2025-11-04→2025-11-05']);
  });

  it('folds the same two halts into one when the radius grows', () => {
    const trace = [
      day('2025-11-02', PERTH),
      day('2025-11-03', PERTH),
      day('2025-11-04', KALBARRI),
      day('2025-11-05', KALBARRI),
    ];
    expect(segmentTrack(trace, { radiusKm: 600 }).legs).toHaveLength(1);
  });

  it('names the leg from the MEDIAN, so one stray day cannot move it', () => {
    const { legs } = segmentTrack([
      day('2025-11-02', PERTH),
      day('2025-11-03', PERTH + 0.01),
      day('2025-11-04', PERTH + 0.2),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0].centroid.lat).toBeCloseTo(PERTH + 0.01, 6);
    // The running mean the walk uses would have landed elsewhere.
    expect(legs[0].centroid.lat).not.toBeCloseTo(PERTH + 0.07, 3);
  });
});

describe('segmentTrack — blind days', () => {
  it('bridges a blind day whose neighbours are the same place, and counts it', () => {
    const { legs, blind } = segmentTrack([
      day('2025-11-02', PERTH),
      day('2025-11-03', PERTH),
      // 2025-11-04 carries no position at all.
      day('2025-11-05', PERTH - 0.01),
    ]);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      startDate: '2025-11-02',
      endDate: '2025-11-05',
      dayCount: 4,
      bridged: 1,
    });
    expect(blind).toEqual([]);
  });

  it('cuts on that same day when bridging is turned off', () => {
    const { legs, blind } = segmentTrack(
      [day('2025-11-02', PERTH), day('2025-11-03', PERTH), day('2025-11-05', PERTH)],
      { bridgeBlind: false },
    );
    expect(spans(legs)).toEqual(['2025-11-02→2025-11-03', '2025-11-05→2025-11-05']);
    expect(blind).toEqual([{ start: '2025-11-04', end: '2025-11-04', length: 1 }]);
  });

  it('never bridges a hole whose two ends contradict each other', () => {
    const { legs, blind } = segmentTrack([
      day('2025-11-02', PERTH),
      day('2025-11-03', PERTH),
      // 2025-11-04 blind, and the trace resumes 470 km away.
      day('2025-11-05', KALBARRI),
    ]);
    expect(spans(legs)).toEqual(['2025-11-02→2025-11-03', '2025-11-05→2025-11-05']);
    expect(blind).toEqual([{ start: '2025-11-04', end: '2025-11-04', length: 1 }]);
  });

  it('invents the days of a move only when asked, and marks what it invented', () => {
    const { legs, blind } = segmentTrack(
      [day('2025-11-02', PERTH), day('2025-11-03', PERTH), day('2025-11-05', KALBARRI)],
      { interpolateMoves: true },
    );
    expect(spans(legs)).toEqual([
      '2025-11-02→2025-11-03',
      '2025-11-04→2025-11-04',
      '2025-11-05→2025-11-05',
    ]);
    expect(legs[1]).toMatchObject({ inferred: true, count: 0 });
    expect(legs[0].inferred).toBe(false);
    expect(blind).toEqual([]);
  });

  it('calls a leg inferred only when not one of its days was measured', () => {
    const allGuessed = segmentTrack([
      day('2025-11-02', PERTH, { inferred: true, measured: 0 }),
      day('2025-11-03', PERTH, { inferred: true, measured: 0 }),
    ]);
    expect(allGuessed.legs[0].inferred).toBe(true);

    const oneReal = segmentTrack([
      day('2025-11-02', PERTH, { inferred: true, measured: 0 }),
      day('2025-11-03', PERTH),
    ]);
    expect(oneReal.legs[0].inferred).toBe(false);
  });
});

describe('segmentTrack — short halts', () => {
  const stopover = [
    day('2025-11-02', PERTH),
    day('2025-11-03', PERTH),
    day('2025-11-04', PERTH),
    day('2025-11-05', BETWEEN),
    day('2025-11-06', KALBARRI),
    day('2025-11-07', KALBARRI),
    day('2025-11-08', KALBARRI),
  ];

  it('lists a short halt and marks it, rather than hiding it', () => {
    const { legs } = segmentTrack(stopover);
    expect(legs).toHaveLength(3);
    expect(legs[1]).toMatchObject({ startDate: '2025-11-05', dayCount: 1, short: true });
    expect(legs.filter((l) => l.short)).toHaveLength(1);
  });

  it('folds it into the halt it was on the way to, when asked', () => {
    const { legs } = segmentTrack(stopover, { shortLegs: 'merge' });
    expect(spans(legs)).toEqual(['2025-11-02→2025-11-04', '2025-11-05→2025-11-08']);
    expect(legs[1]).toMatchObject({ dayCount: 4, absorbed: 1, short: false });
  });

  it('gives a trailing short halt to the one before it', () => {
    const { legs } = segmentTrack(
      [
        day('2025-11-02', PERTH),
        day('2025-11-03', PERTH),
        day('2025-11-04', PERTH),
        day('2025-11-05', KALBARRI),
      ],
      { shortLegs: 'merge' },
    );
    expect(spans(legs)).toEqual(['2025-11-02→2025-11-05']);
    expect(legs[0]).toMatchObject({ absorbed: 1, dayCount: 4 });
  });

  it('refuses to fold across a blind gap, which would claim days nothing supports', () => {
    const { legs, blind } = segmentTrack(
      [
        day('2025-11-02', PERTH),
        day('2025-11-03', PERTH),
        day('2025-11-04', PERTH),
        day('2025-11-05', BETWEEN),
        // 2025-11-06 is blind, and the trace resumes elsewhere.
        day('2025-11-07', KALBARRI),
        day('2025-11-08', KALBARRI),
      ],
      { shortLegs: 'merge' },
    );
    expect(blind).toEqual([{ start: '2025-11-06', end: '2025-11-06', length: 1 }]);
    expect(spans(legs)).toEqual([
      '2025-11-02→2025-11-04',
      '2025-11-05→2025-11-05',
      '2025-11-07→2025-11-08',
    ]);
    expect(legs[1].short).toBe(true);
  });

  it('takes the halt threshold from the caller', () => {
    const { legs } = segmentTrack(stopover, { minNights: 4 });
    expect(legs.map((l) => l.short)).toEqual([true, true, true]);
  });
});
