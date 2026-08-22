import { describe, expect, it } from 'vitest';
import { tipAngle, tipProgress } from './rotate-device';

describe('tipProgress', () => {
  it('starts and ends the cycle upright, so the loop never jumps', () => {
    expect(tipProgress(0, 2)).toBe(0);
    expect(tipProgress(1.999, 2)).toBeCloseTo(0, 2);
  });

  it('reaches a full quarter turn and holds it', () => {
    expect(tipProgress(1, 2)).toBe(1);
    expect(tipProgress(1.3, 2)).toBe(1);
  });

  it('loops', () => {
    expect(tipProgress(1, 2)).toBe(tipProgress(5, 2));
    expect(tipProgress(0.4, 2)).toBeCloseTo(tipProgress(2.4, 2));
  });

  it('never comes back when the return is off', () => {
    expect(tipProgress(1.9, 2, false)).toBe(1);
  });

  it('stays inside 0..1 whatever the time', () => {
    for (const t of [-5, -0.1, 0, 0.37, 3.14, 99]) {
      const v = tipProgress(t, 1.8);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('tipAngle', () => {
  it('turns a quarter, each way', () => {
    expect(tipAngle(1, 2, 'cw')).toBeCloseTo(Math.PI / 2);
    expect(tipAngle(1, 2, 'ccw')).toBeCloseTo(-Math.PI / 2);
  });
});
