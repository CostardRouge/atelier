import { describe, expect, it } from 'vitest';
import { HISTOGRAM_BINS } from './histogram';
import { DEFAULT_DEVELOP } from './develop';
import { exposureOffset, linearMedian, withExposureOffset } from './match-exposure';

/** Stats whose every pixel sits in the bin of this encoded luminance (0..255). */
function flat(v: number, total = 1000) {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  bins[Math.min(HISTOGRAM_BINS - 1, Math.floor((v / 256) * HISTOGRAM_BINS))] = total;
  return { bins, total };
}

describe('exposureOffset', () => {
  it('finds the stops between two medians, in linear light', () => {
    const mid = flat(128);
    const darker = flat(90);
    const got = exposureOffset(mid, darker)!;
    expect(got.ev).toBeCloseTo(Math.log2(linearMedian(mid) / linearMedian(darker)), 1);
    expect(got.ev).toBeGreaterThan(0.9);
    expect(got.clamped).toBe(false);
    expect(exposureOffset(darker, mid)!.ev).toBeCloseTo(-got.ev, 1);
    expect(exposureOffset(mid, mid)!.ev).toBe(0);
  });

  it('clamps a gap of more than two stops and says so', () => {
    const got = exposureOffset(flat(230), flat(20))!;
    expect(got.ev).toBe(2);
    expect(got.clamped).toBe(true);
  });

  it('answers nothing for an empty sample', () => {
    expect(exposureOffset(flat(128), { bins: [], total: 0 })).toBeNull();
    expect(exposureOffset({ bins: [], total: 0 }, flat(128))).toBeNull();
  });
});

describe('withExposureOffset', () => {
  it('moves the exposure inside its range, from a null record too', () => {
    expect(withExposureOffset(null, 0.5)).toEqual({ ...DEFAULT_DEVELOP, exposure: 0.5 });
    expect(withExposureOffset(null, 0)).toBeNull();
    expect(withExposureOffset({ exposure: 2.8, contrast: 10 } as never, 0.5)).toEqual({ exposure: 3, contrast: 10 });
    expect(withExposureOffset({ exposure: -0.4 } as never, -0.35)).toEqual({ exposure: -0.75 });
  });
});
