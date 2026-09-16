import { describe, expect, it } from 'vitest';
import { CURVES, EASING_IDS, INVERTIBLE, clampSteps, curveOf, easeAt, isEasingId } from './easing';

describe('the curve registry', () => {
  it('pins both ends on every curve', () => {
    for (const id of EASING_IDS) {
      const c = CURVES[id];
      expect(c.at(0), id).toBeCloseTo(0, 9);
      expect(c.at(1), id).toBeCloseTo(1, 9);
    }
  });

  it('never goes backwards on a curve that can be inverted', () => {
    for (const id of INVERTIBLE) {
      const c = CURVES[id];
      let last = -1e-9;
      for (let i = 0; i <= 100; i++) {
        const v = c.at(i / 100);
        expect(v, `${id} at ${i}`).toBeGreaterThanOrEqual(last - 1e-12);
        last = v;
      }
    }
  });

  it('round-trips through every closed-form inverse', () => {
    expect(INVERTIBLE.length).toBeGreaterThan(0);
    for (const id of INVERTIBLE) {
      const c = CURVES[id];
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        expect(c.inverse!(c.at(u)), `${id} at ${u}`).toBeCloseTo(u, 9);
      }
    }
  });

  it('keeps the overlay engine\'s four quadratics exactly', () => {
    expect(easeAt('in', 0.5)).toBeCloseTo(0.25);
    expect(easeAt('out', 0.5)).toBeCloseTo(0.75);
    expect(easeAt('in-out', 0.25)).toBeCloseTo(0.125);
    expect(easeAt('in-out', 0.75)).toBeCloseTo(0.875);
    expect(easeAt('linear', 0.3)).toBeCloseTo(0.3);
  });

  it('overshoots on back and spring, and says so', () => {
    for (const id of ['back', 'spring'] as const) {
      expect(CURVES[id].overshoots).toBe(true);
      expect(CURVES[id].inverse).toBeUndefined();
      let max = 0;
      for (let i = 0; i <= 200; i++) max = Math.max(max, CURVES[id].at(i / 200));
      expect(max, id).toBeGreaterThan(1.01);
    }
    expect(INVERTIBLE).not.toContain('back');
  });

  it('moves in whole jumps on steps, and clamps the count', () => {
    expect(easeAt('steps', 0.1, 4)).toBe(0);
    expect(easeAt('steps', 0.26, 4)).toBe(0.25);
    expect(easeAt('steps', 0.99, 4)).toBe(0.75);
    expect(easeAt('steps', 1, 4)).toBe(1);
    expect(easeAt('steps', 0.5)).toBe(0.5); // the default count
    expect(clampSteps(undefined)).toBe(4);
    expect(clampSteps(99)).toBe(12);
    expect(clampSteps(0)).toBe(2);
  });

  it('clamps progress and eases an unknown id linearly', () => {
    expect(easeAt('out', -1)).toBe(0);
    expect(easeAt('out', 7)).toBe(1);
    expect(easeAt('bounce-from-the-future', 0.4)).toBe(0.4);
    expect(curveOf('nope').id).toBe('linear');
    expect(isEasingId('out-cubic')).toBe(true);
    expect(isEasingId('ease-out')).toBe(false);
  });
});
