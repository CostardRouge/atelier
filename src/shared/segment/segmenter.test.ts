import { describe, expect, it } from 'vitest';
import { SEGMENT_INPUT_LONG_EDGE, unionMasks } from './segmenter';
import { BRUSH_RASTER_LONG_EDGE } from '../render/brush-raster';
import { fitRenderSize } from '../render/render-size';

const raster = (w: number, h: number, on: number[]) => {
  const data = new Uint8Array(w * h);
  for (const i of on) data[i] = 255;
  return { data, width: w, height: h };
};

describe('unionMasks', () => {
  it('adds a second point to the subject rather than replacing it', () => {
    const a = raster(2, 2, [0]);
    const b = raster(2, 2, [3]);
    const out = unionMasks(a, b)!;
    expect([...out.data]).toEqual([255, 0, 0, 255]);
    // Neither operand is touched.
    expect([...a.data]).toEqual([255, 0, 0, 0]);
    expect([...b.data]).toEqual([0, 0, 0, 255]);
  });

  it('copies a lone operand and refuses a mask of another size', () => {
    const a = raster(2, 2, [1]);
    const alone = unionMasks(null, a)!;
    expect(alone).not.toBe(a);
    expect([...alone.data]).toEqual([...a.data]);
    expect(unionMasks(a, null)!.data).not.toBe(a.data);
    const stale = raster(3, 1, [0, 1, 2]);
    expect([...unionMasks(a, stale)!.data]).toEqual([...a.data]);
    expect(unionMasks(null, null)).toBeNull();
  });
});

describe('the model is shown a bounded picture', () => {
  it('at the painted mask density, so the two rasters sample alike', () => {
    expect(SEGMENT_INPUT_LONG_EDGE).toBe(BRUSH_RASTER_LONG_EDGE);
    expect(fitRenderSize(3840, 2160, SEGMENT_INPUT_LONG_EDGE)).toEqual({ width: 1024, height: 576 });
    expect(fitRenderSize(800, 600, SEGMENT_INPUT_LONG_EDGE)).toEqual({ width: 800, height: 600 });
  });
});
