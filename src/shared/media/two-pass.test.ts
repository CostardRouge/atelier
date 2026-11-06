import { describe, expect, it } from 'vitest';
import { MEASURE_QP, twoPassQuantizer } from './two-pass';

describe('two-pass rate control', () => {
  it('moves six quantizer steps per halving of the size', () => {
    expect(twoPassQuantizer(20e6, 10e6)).toBe(MEASURE_QP + 6);
    expect(twoPassQuantizer(10e6, 40e6)).toBe(MEASURE_QP - 12);
    expect(twoPassQuantizer(10e6, 10e6, 30)).toBe(30);
  });

  it('stays where a picture neither wastes bits nor breaks up', () => {
    expect(twoPassQuantizer(1e9, 1e3)).toBe(40);
    expect(twoPassQuantizer(1e3, 1e9)).toBe(12);
    expect(twoPassQuantizer(0, 1e6)).toBe(MEASURE_QP);
  });
});
