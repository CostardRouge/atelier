import { describe, expect, it } from 'vitest';
import { paceTable, pacedAt, readRoutePace } from './route-pace';

// A route of three equal legs: the second driven in one day, the first and third over ten days each.
const cum = [0, 100, 200, 300];
const day = 86_400;
const times = [0, 10 * day, 11 * day, 21 * day];
const reach = [0, 1 / 3, 2 / 3, 1];

describe('the route’s pace', () => {
  it('draws by distance when asked nothing', () => {
    const t = paceTable(cum, times, reach, {});
    expect(pacedAt(t, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('gives the days lived their share: the one-day leg flies by', () => {
    const t = paceTable(cum, times, reach, { days: 1 });
    // At half the drawing (10.5 days of 21) the route is in the middle of the fast leg.
    expect(pacedAt(t, 0.5)).toBeCloseTo(0.5, 2);
    expect(pacedAt(t, 10 / 21)).toBeCloseTo(1 / 3, 2);
    expect(pacedAt(t, 11 / 21)).toBeCloseTo(2 / 3, 2);
    // Monotone from start to end.
    let last = -1;
    for (let k = 0; k <= 50; k++) {
      const f = pacedAt(t, k / 50);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(pacedAt(t, 1)).toBeCloseTo(1, 5);
  });

  it('holds at the inner stops for the share asked', () => {
    const t = paceTable(cum, null, reach, { dwell: 0.3 });
    // Two inner stops, 15 % each: the route stands still at the first for a while.
    // Travel shares 70 %: the first stop is reached at x = 0.7 / 3 ≈ 0.233 and held to ≈ 0.383.
    const held = [0.25, 0.3, 0.35, 0.38].map((x) => pacedAt(t, x));
    expect(Math.max(...held) - Math.min(...held)).toBeLessThan(0.02);
    expect(pacedAt(t, 0)).toBe(0);
    expect(pacedAt(t, 1)).toBeCloseTo(1, 5);
  });

  it('keeps the settings in their bounds', () => {
    expect(readRoutePace({ days: 3, dwell: -1, head: 'arrow' })).toEqual({ days: 1, dwell: 0, head: 'arrow' });
    expect(readRoutePace({ head: 'car' })).toBeUndefined();
  });
});
