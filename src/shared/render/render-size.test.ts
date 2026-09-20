import { describe, expect, it } from 'vitest';
import { exceedsRenderSize, fitRenderSize } from './render-size';

describe('fitRenderSize', () => {
  it('leaves a picture inside the cap exactly as it is', () => {
    expect(fitRenderSize(8064, 6048, 8192)).toEqual({ width: 8064, height: 6048 });
    expect(fitRenderSize(8192, 100, 8192)).toEqual({ width: 8192, height: 100 });
    expect(exceedsRenderSize(8064, 6048, 8192)).toBe(false);
  });

  it('scales a bigger one down so its LONG edge is the cap, aspect kept', () => {
    // A 61-megapixel still on an 8192 GPU.
    const fitted = fitRenderSize(9504, 6336, 8192);
    expect(fitted.width).toBe(8192);
    expect(fitted.height).toBe(Math.round((6336 * 8192) / 9504));
    expect(exceedsRenderSize(9504, 6336, 8192)).toBe(true);
    // And a portrait, by its height.
    expect(fitRenderSize(6336, 9504, 8192)).toEqual({ width: Math.round((6336 * 8192) / 9504), height: 8192 });
  });

  it('never returns a pixel past the cap nor a zero edge', () => {
    // Rounding must not push the long edge to cap + 1.
    for (const [w, h] of [[16385, 16384], [20001, 3], [3, 20001]]) {
      const f = fitRenderSize(w, h, 16384);
      expect(Math.max(f.width, f.height)).toBe(16384);
      expect(Math.min(f.width, f.height)).toBeGreaterThanOrEqual(1);
    }
  });

  it('treats no cap as no limit', () => {
    expect(fitRenderSize(50000, 40000, Infinity)).toEqual({ width: 50000, height: 40000 });
    expect(fitRenderSize(50000, 40000, 0)).toEqual({ width: 50000, height: 40000 });
    expect(exceedsRenderSize(50000, 40000, Infinity)).toBe(false);
  });
});
