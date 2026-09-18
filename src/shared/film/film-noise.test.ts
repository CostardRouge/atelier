import { describe, expect, it } from 'vitest';
import { grainFrameIndex, grainPhase, makeGrainNoise } from './film-noise';
import { NOISE_SIZE } from './film-texture';

describe('makeGrainNoise', () => {
  it('is deterministic per seed, and two seeds differ', () => {
    const a = makeGrainNoise(5, 32);
    expect(makeGrainNoise(5, 32)).toEqual(a);
    expect(makeGrainNoise(6, 32)).not.toEqual(a);
    expect(a.length).toBe(32 * 32 * 4);
    expect(makeGrainNoise(1).length).toBe(NOISE_SIZE * NOISE_SIZE * 4);
  });

  it('is white: mean near 0.5, variance near 1/12, channels uncorrelated, histogram flat', () => {
    const bytes = makeGrainNoise(11);
    const n = NOISE_SIZE * NOISE_SIZE;
    const ch = [0, 1, 2, 3].map((c) => {
      const v = new Float64Array(n);
      for (let i = 0; i < n; i += 1) v[i] = bytes[i * 4 + c] / 255;
      return v;
    });
    const mean = (v: Float64Array) => v.reduce((s, x) => s + x, 0) / v.length;
    const means = ch.map(mean);
    for (const m of means) expect(Math.abs(m - 0.5)).toBeLessThan(0.01);
    const variance = ch.map((v, c) => v.reduce((s, x) => s + (x - means[c]) ** 2, 0) / n);
    for (const s2 of variance) expect(Math.abs(s2 - 1 / 12)).toBeLessThan(0.005);
    for (let a = 0; a < 4; a += 1) {
      for (let b = a + 1; b < 4; b += 1) {
        let cov = 0;
        for (let i = 0; i < n; i += 1) cov += (ch[a][i] - means[a]) * (ch[b][i] - means[b]);
        const r = cov / n / Math.sqrt(variance[a] * variance[b]);
        expect(Math.abs(r)).toBeLessThan(0.02);
      }
    }
    const bins = new Array(16).fill(0);
    for (let i = 0; i < n; i += 1) bins[bytes[i * 4] >> 4] += 1;
    for (const count of bins) expect(Math.abs(count / (n / 16) - 1)).toBeLessThan(0.05);
  });
});

describe('grainPhase', () => {
  it('is pure in (frame, seed), inside the tile, and consecutive frames land cells apart', () => {
    expect(grainPhase(3, 9)).toEqual(grainPhase(3, 9));
    expect(grainPhase(3, 9)).not.toEqual(grainPhase(4, 9));
    expect(grainPhase(3, 9)).not.toEqual(grainPhase(3, 10));
    const twoCells = 2 / NOISE_SIZE;
    for (let i = 0; i < 2000; i += 1) {
      const a = grainPhase(i, 9);
      const b = grainPhase(i + 1, 9);
      for (const v of [...a, ...b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
      const dx = Math.min(Math.abs(a[0] - b[0]), 1 - Math.abs(a[0] - b[0]));
      const dy = Math.min(Math.abs(a[1] - b[1]), 1 - Math.abs(a[1] - b[1]));
      expect(dx).toBeGreaterThan(twoCells);
      expect(dy).toBeGreaterThan(twoCells);
    }
  });

  it('a negative or fractional frame reads as its floor at zero', () => {
    expect(grainPhase(-2, 1)).toEqual(grainPhase(0, 1));
    expect(grainPhase(2.9, 1)).toEqual(grainPhase(2, 1));
  });
});

describe('grainFrameIndex', () => {
  it('quantises source time to the grain cadence, and freezes at 0 fps', () => {
    expect(grainFrameIndex(0, 24)).toBe(0);
    expect(grainFrameIndex(1, 24)).toBe(24);
    expect(grainFrameIndex(1 / 60, 24)).toBe(0);
    expect(grainFrameIndex(2 / 24 + 1e-9, 24)).toBe(2);
    expect(grainFrameIndex(3.7, 0)).toBe(0);
    expect(grainFrameIndex(-1, 24)).toBe(0);
    expect(grainFrameIndex(Number.NaN, 24)).toBe(0);
  });
});
