import { describe, expect, it } from 'vitest';
import {
  STAGE_TINTS,
  dayAtOffset,
  dayOffset,
  laneCount,
  rulerBars,
  rulerGaps,
  rulerMonths,
  stageTint,
} from './stage-ruler';
import { createTripStage, type TripStage } from './trip-types';

const stage = (start: string, end: string, name = ''): TripStage =>
  createTripStage(name, '', start, end);

const trip = (stages: TripStage[]) => ({
  startDate: '2025-01-28',
  endDate: '2025-02-10',
  stages,
});

describe('rulerBars', () => {
  it('places each stage by its day offset and length inside the trip', () => {
    const bars = rulerBars(trip([stage('2025-01-28', '2025-01-30'), stage('2025-02-01', '2025-02-10')]));
    expect(bars.map((b) => [b.from, b.length, b.lane])).toEqual([
      [0, 3, 0],
      [4, 10, 0],
    ]);
  });

  it('clips a stage that reaches outside the trip without rewriting it', () => {
    const s = stage('2025-01-20', '2025-02-01');
    const [bar] = rulerBars(trip([s]));
    expect(bar.from).toBe(0);
    expect(bar.length).toBe(5);
    expect(bar.stage).toBe(s);
  });

  it('draws nothing for a stage entirely outside, reversed, or malformed', () => {
    expect(
      rulerBars(
        trip([stage('2025-03-01', '2025-03-04'), stage('2025-02-05', '2025-02-01'), stage('nope', '2025-02-01')]),
      ),
    ).toEqual([]);
  });

  it('stacks overlapping stages into lanes in list order', () => {
    const bars = rulerBars(
      trip([
        stage('2025-01-28', '2025-02-02'),
        stage('2025-02-02', '2025-02-06'), // shares the travel day
        stage('2025-02-07', '2025-02-10'), // clear of the first, lane 0 again
      ]),
    );
    expect(bars.map((b) => b.lane)).toEqual([0, 1, 0]);
    expect(laneCount(bars)).toBe(2);
  });

  it('keeps the stage index so the tint follows the list, not the bar', () => {
    const bars = rulerBars(trip([stage('2025-03-01', '2025-03-02'), stage('2025-02-01', '2025-02-02')]));
    expect(bars.map((b) => b.index)).toEqual([1]);
  });

  it('is empty for a trip with no usable span', () => {
    expect(rulerBars({ startDate: '2025-02-10', endDate: '2025-01-28', stages: [stage('2025-02-01', '2025-02-02')] })).toEqual([]);
  });
});

describe('rulerGaps', () => {
  it('lists the uncovered runs with their dates', () => {
    const t = trip([stage('2025-01-30', '2025-02-01'), stage('2025-02-05', '2025-02-08')]);
    expect(rulerGaps(t, rulerBars(t))).toEqual([
      { from: 0, length: 2, startDate: '2025-01-28', endDate: '2025-01-29' },
      { from: 5, length: 3, startDate: '2025-02-02', endDate: '2025-02-04' },
      { from: 12, length: 2, startDate: '2025-02-09', endDate: '2025-02-10' },
    ]);
  });

  it('is the whole trip with no stages, and empty when fully covered', () => {
    const empty = trip([]);
    expect(rulerGaps(empty, [])).toEqual([
      { from: 0, length: 14, startDate: '2025-01-28', endDate: '2025-02-10' },
    ]);
    const full = trip([stage('2025-01-28', '2025-02-10')]);
    expect(rulerGaps(full, rulerBars(full))).toEqual([]);
  });
});

describe('rulerMonths', () => {
  it('labels the first day and every first of a month', () => {
    expect(rulerMonths(trip([]))).toEqual([
      { offset: 0, label: 'Jan' },
      { offset: 4, label: 'Feb' },
    ]);
  });

  it('does not double-label a trip that starts on the first', () => {
    expect(rulerMonths({ startDate: '2025-02-01', endDate: '2025-02-03' })).toEqual([
      { offset: 0, label: 'Feb' },
    ]);
  });
});

describe('dayAtOffset / dayOffset', () => {
  it('maps an offset to the day and clamps to the trip', () => {
    const t = trip([]);
    expect(dayAtOffset(t, 0)).toBe('2025-01-28');
    expect(dayAtOffset(t, 4.9)).toBe('2025-02-01');
    expect(dayAtOffset(t, -3)).toBe('2025-01-28');
    expect(dayAtOffset(t, 99)).toBe('2025-02-10');
  });

  it('inverts for a day inside the trip and refuses one outside', () => {
    const t = trip([]);
    expect(dayOffset(t, '2025-02-01')).toBe(4);
    expect(dayOffset(t, '2025-01-27')).toBeNull();
    expect(dayOffset(t, '2025-02-11')).toBeNull();
  });
});

describe('stageTint', () => {
  it('cycles through the tints and never shares one between neighbours', () => {
    expect(stageTint(0)).toBe(STAGE_TINTS[0]);
    expect(stageTint(STAGE_TINTS.length)).toBe(STAGE_TINTS[0]);
    for (let i = 0; i < 8; i += 1) expect(stageTint(i)).not.toBe(stageTint(i + 1));
  });
});
