import { describe, expect, it } from 'vitest';
import { mulberry32 } from './prng';

describe('mulberry32', () => {
  it('draws the same sequence from the same seed, a different one from another', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 8 }, () => a());
    expect(Array.from({ length: 8 }, () => b())).toEqual(seqA);
    expect(Array.from({ length: 8 }, () => c())).not.toEqual(seqA);
  });

  it('stays in [0, 1) and spreads', () => {
    const r = mulberry32(7);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });
});
