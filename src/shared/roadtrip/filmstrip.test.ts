import { describe, expect, it } from 'vitest';
import {
  filmstripTimes,
  fractionOfTime,
  keyStep,
  stripCount,
  timeFromPointer,
} from './filmstrip';

describe('filmstripTimes', () => {
  it('samples the middle of each slice, not its edge', () => {
    // The left edge would put the first cell on frame zero — a drone clip's
    // props spinning up on the ground — and never show the last slice.
    expect(filmstripTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
  });

  it('spreads across the whole clip', () => {
    const times = filmstripTimes(60, 12);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(60);
    expect(times[times.length - 1]).toBeGreaterThan(55);
  });

  it('always gives exactly the asked-for number of cells', () => {
    for (const n of [1, 6, 16]) expect(filmstripTimes(23.7, n)).toHaveLength(n);
  });

  it('is all zeros for a clip with no duration yet, rather than NaN', () => {
    expect(filmstripTimes(0, 4)).toEqual([0, 0, 0, 0]);
    expect(filmstripTimes(Number.NaN, 3).every((t) => t === 0)).toBe(true);
  });

  it('never returns an empty strip', () => {
    expect(filmstripTimes(10, 0)).toHaveLength(1);
    expect(filmstripTimes(10, -4)).toHaveLength(1);
  });
});

describe('stripCount', () => {
  it('grows with the width, within bounds', () => {
    expect(stripCount(680)).toBe(10);
    expect(stripCount(4000)).toBe(16);
    expect(stripCount(50)).toBe(6);
  });

  it('is sane before the strip has been measured', () => {
    expect(stripCount(0)).toBe(6);
    expect(stripCount(Number.NaN)).toBe(6);
  });
});

describe('fractionOfTime', () => {
  it('places a time along the strip', () => {
    expect(fractionOfTime(5, 10)).toBe(0.5);
    expect(fractionOfTime(0, 10)).toBe(0);
  });

  it('clamps rather than running off either end', () => {
    expect(fractionOfTime(-2, 10)).toBe(0);
    expect(fractionOfTime(99, 10)).toBe(1);
  });

  it('is the start when there is no duration', () => {
    expect(fractionOfTime(5, 0)).toBe(0);
  });
});

describe('timeFromPointer', () => {
  const rect = { left: 100, width: 400 };

  it('reads a position along the strip', () => {
    expect(timeFromPointer(300, rect, 10)).toBeCloseTo(5, 6);
  });

  it('clamps a drag that leaves the strip', () => {
    expect(timeFromPointer(0, rect, 10)).toBe(0);
    expect(timeFromPointer(9999, rect, 10)).toBeCloseTo(9.95, 6);
  });

  it('stops a hair short of the end', () => {
    // A seek past the last frame never fires `seeked`, so the preview would
    // simply stop updating.
    expect(timeFromPointer(9999, rect, 10)).toBeLessThan(10);
  });

  it('survives a strip that has not been laid out', () => {
    expect(timeFromPointer(200, { left: 0, width: 0 }, 10)).toBe(0);
  });
});

describe('keyStep', () => {
  it('is fine but never imperceptible', () => {
    expect(keyStep(300)).toBeGreaterThanOrEqual(1 / 30);
    expect(keyStep(0.5)).toBeGreaterThanOrEqual(1 / 30);
  });

  it('is bigger with a modifier', () => {
    expect(keyStep(300, true)).toBeGreaterThan(keyStep(300));
  });
});
