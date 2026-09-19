import { describe, expect, it } from 'vitest';
import { bakeLutPreview, syntheticPreviewSample } from './lut-preview';
import type { CubeLut } from '../lib/cube-parser';

function makeLut(size: number, fn: (r: number, g: number, b: number) => [number, number, number]): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  for (let bi = 0; bi < size; bi += 1)
    for (let gi = 0; gi < size; gi += 1)
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = fn(ri / last, gi / last, bi / last);
        const o = (ri + gi * size + bi * size * size) * 3;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/** Inverts every channel — easy to tell apart from the source in a test. */
const invert = () => makeLut(5, (r, g, b) => [1 - r, 1 - g, 1 - b]);

describe('syntheticPreviewSample', () => {
  it('fills the requested size, fully opaque', () => {
    const sample = syntheticPreviewSample(16);
    expect(sample.width).toBe(16);
    expect(sample.height).toBe(16);
    expect(sample.data.length).toBe(16 * 16 * 4);
    for (let i = 3; i < sample.data.length; i += 4) {
      expect(sample.data[i]).toBe(255);
    }
  });

  it('is not a single flat colour — the whole point is to show several regions', () => {
    const sample = syntheticPreviewSample(32);
    const seen = new Set<string>();
    for (let i = 0; i < sample.data.length; i += 4) {
      seen.add(`${sample.data[i]},${sample.data[i + 1]},${sample.data[i + 2]}`);
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('bakeLutPreview', () => {
  const sample = syntheticPreviewSample(8);

  it('returns the sample unchanged when lut is null', () => {
    const baked = bakeLutPreview(sample, null, 1, 'tetrahedral');
    expect(baked.data).toEqual(sample.data);
    // A distinct array, not the same reference — callers may hold both.
    expect(baked.data).not.toBe(sample.data);
  });

  it('at intensity 0 the LUT has no effect, whatever it does', () => {
    const baked = bakeLutPreview(sample, invert(), 0, 'tetrahedral');
    expect(baked.data).toEqual(sample.data);
  });

  it('at intensity 1 an inverting LUT actually inverts', () => {
    const baked = bakeLutPreview(sample, invert(), 1, 'tetrahedral');
    for (let i = 0; i < sample.data.length; i += 4) {
      expect(baked.data[i]).toBeCloseTo(255 - sample.data[i], -1);
      expect(baked.data[i + 1]).toBeCloseTo(255 - sample.data[i + 1], -1);
      expect(baked.data[i + 2]).toBeCloseTo(255 - sample.data[i + 2], -1);
    }
  });

  it('preserves alpha and dimensions', () => {
    const baked = bakeLutPreview(sample, invert(), 0.5, 'trilinear');
    expect(baked.width).toBe(sample.width);
    expect(baked.height).toBe(sample.height);
    for (let i = 3; i < baked.data.length; i += 4) {
      expect(baked.data[i]).toBe(255);
    }
  });
});
