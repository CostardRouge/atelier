import { describe, expect, it } from 'vitest';
import { MIN_DAY } from './stage-ruler';
import {
  MIN_LOUPE_DAYS,
  baseDays,
  centreLoupe,
  clampLoupe,
  createLoupeStore,
  holdDay,
  loupeLimits,
  loupeScale,
  loupeSpan,
  monthsAround,
  zoomLoupe,
} from './loupe';

describe('loupeLimits', () => {
  it('goes from a week to as many days as fit at the ruler floor', () => {
    expect(loupeLimits(345, 900)).toEqual({ min: MIN_LOUPE_DAYS, max: 900 / MIN_DAY });
  });
  it('never shows more than the trip, nor asks for more days than it has', () => {
    expect(loupeLimits(40, 900)).toEqual({ min: MIN_LOUPE_DAYS, max: 40 });
    expect(loupeLimits(5, 900)).toEqual({ min: 5, max: 5 });
  });
  it('limits nothing but the trip while the box is unmeasured', () => {
    expect(loupeLimits(345, 0)).toEqual({ min: MIN_LOUPE_DAYS, max: 345 });
  });
});

describe('zoomLoupe', () => {
  const limits = loupeLimits(345, 900);

  it('keeps the day under the hand where it was', () => {
    const before = { from: 100, days: 90 };
    for (const at of [0, 0.25, 0.5, 0.9, 1]) {
      const after = zoomLoupe(345, before, 30, at, limits);
      expect(after.days).toBe(30);
      expect(after.from + at * after.days).toBeCloseTo(before.from + at * before.days, 9);
    }
  });

  it('holds the anchor across a whole burst of small notches, in and back out', () => {
    let loupe = { from: 120, days: 92 };
    const under = loupe.from + 0.4 * loupe.days;
    for (let i = 0; i < 60; i += 1) loupe = zoomLoupe(345, loupe, loupe.days * 0.97, 0.4, limits);
    for (let i = 0; i < 60; i += 1) loupe = zoomLoupe(345, loupe, loupe.days / 0.97, 0.4, limits);
    expect(loupe.from + 0.4 * loupe.days).toBeCloseTo(under, 6);
  });

  it('stops at a week and at the floor, never past', () => {
    expect(zoomLoupe(345, { from: 0, days: 10 }, 2, 0.5, limits).days).toBe(MIN_LOUPE_DAYS);
    expect(zoomLoupe(345, { from: 0, days: 100 }, 400, 0.5, limits).days).toBe(limits.max);
  });

  it('slides back inside the trip at its edges rather than showing days it does not have', () => {
    const out = zoomLoupe(345, { from: 300, days: 45 }, 120, 1, limits);
    expect(out.from + out.days).toBe(345);
    expect(zoomLoupe(345, { from: 0, days: 20 }, 80, 0, limits).from).toBe(0);
  });
});

describe('clampLoupe and centreLoupe', () => {
  const limits = loupeLimits(100, 900);
  it('slides a window back in rather than shrinking it', () => {
    expect(clampLoupe(100, { from: 90, days: 30 }, limits)).toEqual({ from: 70, days: 30 });
    expect(clampLoupe(100, { from: -5, days: 30 }, limits)).toEqual({ from: 0, days: 30 });
  });
  it('centres on a day offset, inside the trip', () => {
    expect(centreLoupe(100, 20, 50, limits)).toEqual({ from: 40, days: 20 });
    expect(centreLoupe(100, 20, 2, limits)).toEqual({ from: 0, days: 20 });
  });
});

describe('holdDay', () => {
  it('leaves a window that already shows the day', () => {
    const loupe = { from: 10, days: 14 };
    expect(holdDay(100, loupe, 10)).toBe(loupe);
    expect(holdDay(100, loupe, 23)).toBe(loupe);
  });
  it('slides the shortest way, a day of room kept beyond it', () => {
    expect(holdDay(100, { from: 10, days: 14 }, 30)).toEqual({ from: 18, days: 14 });
    expect(holdDay(100, { from: 10, days: 14 }, 4)).toEqual({ from: 3, days: 14 });
  });
  it('never leaves the trip, and ignores a day off it', () => {
    expect(holdDay(100, { from: 50, days: 14 }, 99)).toEqual({ from: 86, days: 14 });
    const loupe = { from: 50, days: 14 };
    expect(holdDay(100, loupe, 120)).toBe(loupe);
  });
});

describe('monthsAround and baseDays', () => {
  it('is the month before, the month and the month after, from the trip start', () => {
    // 2025-07-10 → June 1 … August 31: 30 + 31 + 31 days.
    expect(monthsAround('2025-06-15', '2025-07-10')).toEqual({ from: -14, days: 92 });
  });
  it('crosses a year', () => {
    expect(monthsAround('2025-01-01', '2025-01-20')).toEqual({ from: -31, days: 90 });
  });
  it('calls 100% the three months, or the trip, or what fits', () => {
    const around = { from: 0, days: 92 };
    expect(baseDays(345, around, loupeLimits(345, 900))).toBe(92);
    expect(baseDays(40, around, loupeLimits(40, 900))).toBe(40);
    expect(baseDays(345, around, loupeLimits(345, 480))).toBe(80);
    expect(baseDays(20, null, loupeLimits(20, 900))).toBe(20);
  });
  it('reads the scale against it', () => {
    expect(loupeScale(92, 46)).toBe(2);
    expect(loupeScale(92, 92)).toBe(1);
  });
});

describe('loupeSpan', () => {
  it('names every day the window shows even in part', () => {
    expect(loupeSpan(100, { from: 10, days: 14 })).toEqual({ first: 10, last: 23 });
    expect(loupeSpan(100, { from: 10.5, days: 14 })).toEqual({ first: 10, last: 24 });
    expect(loupeSpan(100, { from: 90, days: 30 })).toEqual({ first: 90, last: 99 });
  });
});

describe('createLoupeStore', () => {
  it('tells its listeners of a real change only', () => {
    const store = createLoupeStore();
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    store.set({ from: 1, days: 10 });
    store.set({ from: 1, days: 10 });
    expect(calls).toBe(1);
    expect(store.get()).toEqual({ from: 1, days: 10 });
    store.set(null);
    expect(calls).toBe(2);
    stop();
    store.set({ from: 2, days: 10 });
    expect(calls).toBe(2);
  });
});
