import { describe, expect, it } from 'vitest';
import { MAX_STAGE_PIXELS } from '../overlay/stage-size';
import { CONSTRAINED_STAGE_PIXELS, fitStill, stageBudgetFor } from './still-fit';

describe('fitStill', () => {
  it('never enlarges, and answers the picture itself when every bound holds', () => {
    expect(fitStill({ width: 1600, height: 1200 }, { maxEdge: 3840 })).toEqual({ width: 1600, height: 1200 });
    expect(fitStill({ width: 1600, height: 1200 }, { budgetPixels: MAX_STAGE_PIXELS })).toEqual({ width: 1600, height: 1200 });
    expect(fitStill({ width: 1600, height: 1200 }, {})).toEqual({ width: 1600, height: 1200 });
    expect(fitStill({ width: 1600, height: 1200 }, null)).toEqual({ width: 1600, height: 1200 });
  });

  it('bounds the long edge, the width and the area, the tightest winning', () => {
    // A 48 MP still, 8064 × 6048.
    const big = { width: 8064, height: 6048 };
    expect(fitStill(big, { maxEdge: 640 })).toEqual({ width: 640, height: 480 });
    expect(fitStill({ width: 6048, height: 8064 }, { maxEdge: 640 })).toEqual({ width: 480, height: 640 });
    expect(fitStill({ width: 6048, height: 8064 }, { maxWidth: 512 })).toEqual({ width: 512, height: 683 });
    const staged = fitStill(big, { budgetPixels: MAX_STAGE_PIXELS });
    expect(staged.width * staged.height).toBeLessThanOrEqual(MAX_STAGE_PIXELS * 1.001);
    expect(staged.width / staged.height).toBeCloseTo(8064 / 6048, 2);
    // Both: the edge is tighter here.
    expect(fitStill(big, { budgetPixels: MAX_STAGE_PIXELS, maxEdge: 2000 })).toEqual({ width: 2000, height: 1500 });
  });

  it('ignores a bound that is not a number, and a picture with no size is nothing', () => {
    expect(fitStill({ width: 4000, height: 3000 }, { maxEdge: Number.POSITIVE_INFINITY })).toEqual({ width: 4000, height: 3000 });
    expect(fitStill({ width: 4000, height: 3000 }, { maxEdge: 0, budgetPixels: -1 })).toEqual({ width: 4000, height: 3000 });
    expect(fitStill({ width: 0, height: 3000 }, { maxEdge: 10 })).toEqual({ width: 0, height: 0 });
    expect(fitStill({ width: 100000, height: 1 }, { maxEdge: 10 })).toEqual({ width: 10, height: 1 });
  });
});

describe('the stage budget per device', () => {
  it('keeps a computer at 4K and puts a phone just above its own screen', () => {
    expect(stageBudgetFor('roomy')).toBe(MAX_STAGE_PIXELS);
    expect(stageBudgetFor('constrained')).toBe(CONSTRAINED_STAGE_PIXELS);
    expect(CONSTRAINED_STAGE_PIXELS).toBeGreaterThan(2796 * 1290);
    expect(CONSTRAINED_STAGE_PIXELS).toBeLessThan(MAX_STAGE_PIXELS / 2);
  });
});
