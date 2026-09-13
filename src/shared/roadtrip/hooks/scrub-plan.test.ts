import { describe, expect, it } from 'vitest';
import type { HookDay } from './hook-variant';
import {
  SCRUB_DEFAULTS,
  sampleEvenly,
  scrubOptions,
  scrubPlan,
  scrubScore,
  scrubStopDays,
  stopFraction,
  tapeFraction,
  tapeTicks,
  type ScrubOptions,
} from './scrub-plan';

/** A trip of `total` days starting 2025-03-01, told on the given day numbers. */
function calendar(total: number, told: number[] = [], legs: number[] = [1]): HookDay[] {
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(2025, 2, 1 + i));
    return {
      date: d.toISOString().slice(0, 10),
      dayNumber: i + 1,
      told: told.includes(i + 1),
      legStart: legs.includes(i + 1),
    };
  });
}

const dateOf = (cal: HookDay[], n: number) => cal[n - 1].date;
const opts = (patch: Partial<ScrubOptions> = {}): ScrubOptions => ({ ...SCRUB_DEFAULTS, ...patch });

describe('scrubOptions', () => {
  it('fills what a document never stored', () => {
    expect(scrubOptions({})).toEqual(SCRUB_DEFAULTS);
  });

  it('clamps what it did store, and refuses what it cannot read', () => {
    const o = scrubOptions({ maxStops: 400, sweepSeconds: -2, runUpDays: 'lots', mode: 'sideways', tape: 7 });
    expect(o.maxStops).toBe(16);
    expect(o.sweepSeconds).toBe(0.8);
    expect(o.runUpDays).toBe(2);
    expect(o.mode).toBe('from-start');
    expect(o.tape).toBe('bottom');
  });
});

describe('sampleEvenly', () => {
  it('keeps the first and the last', () => {
    const out = sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(10);
    expect(out).toHaveLength(4);
  });

  it('never repeats an item to reach a count', () => {
    expect(sampleEvenly([1, 2, 3], 8)).toEqual([1, 2, 3]);
  });
});

describe('stopFraction', () => {
  it('starts at zero and lands at the end', () => {
    expect(stopFraction(0, 12)).toBe(0);
    expect(stopFraction(11, 12)).toBe(1);
  });

  it('decelerates: every gap between stops is longer than the one before', () => {
    const times = Array.from({ length: 12 }, (_, i) => stopFraction(i, 12));
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });
});

describe('scrubStopDays', () => {
  it('sweeps from day 1 to the hero through told days only', () => {
    const cal = calendar(30, [3, 8, 14, 20]);
    const days = scrubStopDays(cal, dateOf(cal, 27), opts())!;
    expect(days.map((d) => d.dayNumber)).toEqual([1, 3, 8, 14, 20, 27]);
    // Day 1 is visited because the sweep STARTS there, not because it was told.
    expect(days[0].told).toBe(false);
  });

  it('caps the stops, keeping the start and the hero', () => {
    const cal = calendar(100, Array.from({ length: 60 }, (_, i) => i + 2));
    const days = scrubStopDays(cal, dateOf(cal, 90), opts({ maxStops: 8 }))!;
    expect(days).toHaveLength(8);
    expect(days[0].dayNumber).toBe(1);
    expect(days[days.length - 1].dayNumber).toBe(90);
  });

  it('runs up through the last told days before the hero', () => {
    const cal = calendar(40, [2, 5, 9, 12, 15, 18, 21, 24]);
    const days = scrubStopDays(cal, dateOf(cal, 30), opts({ mode: 'run-up', runUpDays: 3 }))!;
    expect(days.map((d) => d.dayNumber)).toEqual([18, 21, 24, 30]);
  });

  it('still sweeps a trip nothing has been told from, flashing nothing', () => {
    const cal = calendar(20);
    const days = scrubStopDays(cal, dateOf(cal, 15), opts())!;
    expect(days[0].dayNumber).toBe(1);
    expect(days[days.length - 1].dayNumber).toBe(15);
    expect(days.slice(0, -1).every((d) => !d.told)).toBe(true);
    expect(days.length).toBeGreaterThan(2);
  });

  it('refuses a day that is not a day of the trip', () => {
    expect(scrubStopDays(calendar(10), '2031-01-01', opts())).toBeNull();
  });
});

describe('scrubPlan', () => {
  const cal = calendar(30, [3, 8, 14, 20]);
  const plan = scrubPlan(cal, dateOf(cal, 27), opts({ sweepSeconds: 2 }))!;

  it('lands the head exactly on every stop at that stop’s time', () => {
    plan.stops.forEach((stop, i) => {
      expect(plan.stopAt(stop.at)).toBe(i);
      expect(plan.headDayAt(stop.at)).toBeCloseTo(stop.dayNumber, 6);
    });
  });

  it('rests on the hero once the sweep is over', () => {
    expect(plan.stopAt(5)).toBe(plan.stops.length - 1);
    expect(plan.headDayAt(5)).toBe(27);
  });

  it('never flashes the hero, whose picture is already on the frame', () => {
    const hero = plan.stops[plan.stops.length - 1];
    expect(hero.hero).toBe(true);
    expect(hero.told).toBe(false);
    expect(plan.stops.filter((s) => s.told).map((s) => s.dayNumber)).toEqual([3, 8, 14, 20]);
  });

  it('measures the time since the head last landed', () => {
    const second = plan.stops[1];
    expect(plan.sinceStopAt(second.at + 0.01)).toBeCloseTo(0.01, 6);
  });

  it('has nothing to sweep when the hero is the first day', () => {
    const first = scrubPlan(cal, dateOf(cal, 1), opts())!;
    expect(first.sweepSeconds).toBe(0);
    expect(first.stops).toHaveLength(1);
    expect(first.headDayAt(0)).toBe(1);
  });

  it('reads the legs off the calendar', () => {
    const legs = scrubPlan(calendar(30, [], [1, 11, 21]), dateOf(cal, 25), opts())!;
    expect(legs.legStarts).toEqual([1, 11, 21]);
  });
});

describe('the tape', () => {
  it('places the first and the last day at its two ends', () => {
    expect(tapeFraction(1, 104)).toBe(0);
    expect(tapeFraction(104, 104)).toBe(1);
    expect(tapeFraction(1, 1)).toBe(0);
  });

  it('ticks every day while there is room', () => {
    expect(tapeTicks(10, 900, [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('thins out a long trip but keeps its ends and every leg start', () => {
    const ticks = tapeTicks(400, 800, [137, 251]);
    expect(ticks.length).toBeLessThan(400);
    expect(ticks).toContain(1);
    expect(ticks).toContain(400);
    expect(ticks).toContain(137);
    expect(ticks).toContain(251);
  });
});

describe('scrubScore', () => {
  it('lands a sound on every stop, at that stop’s own time', () => {
    const cal = calendar(30, [3, 8, 14, 20], [1, 14]);
    const plan = scrubPlan(cal, dateOf(cal, 27), opts())!;
    const score = scrubScore(plan);
    expect(score.map((e) => e.at)).toEqual(plan.stops.map((s) => s.at));
  });

  it('marks a leg with its own voice and ends on the seat', () => {
    const cal = calendar(30, [3, 8, 14, 20], [1, 14]);
    const plan = scrubPlan(cal, dateOf(cal, 27), opts())!;
    const score = scrubScore(plan);
    const voiceOn = (day: number) => score[plan.stops.findIndex((s) => s.dayNumber === day)].voice;
    expect(voiceOn(14)).toBe('leg');
    expect(voiceOn(8)).toBe('detent');
    expect(score[score.length - 1].voice).toBe('seat');
  });

  it('gets quieter as the mechanism slows, the seat apart', () => {
    const cal = calendar(60, [4, 9, 15, 22, 30, 37], []);
    const plan = scrubPlan(cal, dateOf(cal, 44), opts())!;
    const levels = scrubScore(plan).slice(0, -1).map((e) => e.gain ?? 0);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1]);
  });

  it('is silent when there is nowhere to sweep from', () => {
    const cal = calendar(10, [2]);
    expect(scrubScore(scrubPlan(cal, dateOf(cal, 1), opts())!)).toEqual([]);
  });

  it('reads the sound switch through the defaults', () => {
    expect(scrubOptions({}).sound).toBe(true);
    expect(scrubOptions({ sound: false }).sound).toBe(false);
  });
});
