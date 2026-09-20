import { describe, expect, it } from 'vitest';
import {
  GRAIN_GAIN,
  MAX_HALATION_TAPS,
  OCTAVE_WEIGHT,
  applyGrain,
  blurSeparable,
  combineOctaves,
  extractHighlight,
  gaussianKernel,
  grainSampleFrom,
  grainWeight,
  halationTaps,
  screenHalation,
  type GrainSample,
} from './film-grain';
import { TEXTURE_RANGES, halationBuffer, DEFAULT_FILM_TEXTURE } from './film-texture';

describe('grainWeight — the shape, never the values', () => {
  it('vanishes at crushed black and blown white, peaks in the lower midtones', () => {
    expect(grainWeight(0)).toBe(0);
    expect(grainWeight(1)).toBe(0);
    expect(grainWeight(-1)).toBe(0);
    expect(grainWeight(2)).toBe(0);
    let peakAt = 0;
    let peak = 0;
    for (let i = 0; i <= 200; i += 1) {
      const w = grainWeight(i / 200);
      if (w > peak) {
        peak = w;
        peakAt = i / 200;
      }
    }
    expect(peakAt).toBeGreaterThan(0.35);
    expect(peakAt).toBeLessThan(0.5);
    expect(peak).toBeLessThanOrEqual(1);
    // Monotone either side of the peak.
    for (let i = 1; i <= 200; i += 1) {
      const prev = grainWeight((i - 1) / 200);
      const cur = grainWeight(i / 200);
      if (i / 200 <= peakAt) expect(cur).toBeGreaterThanOrEqual(prev);
      else expect(cur).toBeLessThanOrEqual(prev);
    }
    // A broad plateau, not a spike: the midtones are broadly grainy.
    expect(grainWeight(0.25)).toBeGreaterThan(0.7);
    expect(grainWeight(0.65)).toBeGreaterThan(0.6);
  });
});

describe('applyGrain', () => {
  const grey: [number, number, number] = [0.4, 0.4, 0.4];

  it('is the identity at amount 0, at fade 0, and on a noise of zero', () => {
    const zero: GrainSample = [0, 0, 0, 0];
    const loud: GrainSample = [0.5, -0.5, 0.5, -0.5];
    expect(applyGrain(grey, loud, 0, 0.5)).toEqual(grey);
    expect(applyGrain(grey, loud, 1, 0.5, 0)).toEqual(grey);
    expect(applyGrain(grey, zero, 1, 0.5)).toEqual(grey);
  });

  it('at chroma 0 every channel moves by the luma field; at 1 each by its own', () => {
    const noise: GrainSample = [0.5, -0.5, 0.2, 0];
    const k = grainWeight(0.4) * GRAIN_GAIN;
    const luma = applyGrain(grey, noise, 1, 0);
    expect(luma[0]).toBeCloseTo(0.4 + k * 0.5, 9);
    expect(luma[1]).toBeCloseTo(luma[0], 9);
    expect(luma[2]).toBeCloseTo(luma[0], 9);
    const chroma = applyGrain(grey, noise, 1, 1);
    expect(chroma[0]).toBeCloseTo(0.4 - k * 0.5, 9);
    expect(chroma[1]).toBeCloseTo(0.4 + k * 0.2, 9);
    expect(chroma[2]).toBeCloseTo(0.4, 9);
  });

  it('never leaves [0,1], and black and white are untouched', () => {
    const loud: GrainSample = [0.5, 0.5, 0.5, 0.5];
    expect(applyGrain([0, 0, 0], loud, 1, 0)).toEqual([0, 0, 0]);
    expect(applyGrain([1, 1, 1], loud, 1, 0)).toEqual([1, 1, 1]);
    const near = applyGrain([0.99, 0.99, 0.99], loud, 1, 0);
    for (const v of near) expect(v).toBeLessThanOrEqual(1);
  });

  it('reads a texel of the tile as luma in alpha, channels in rgb', () => {
    const bytes = new Uint8Array([255, 0, 128, 255, 0, 0, 0, 0]);
    const first = grainSampleFrom(bytes, 0);
    expect(first[0]).toBeCloseTo(0.5, 9);
    expect(first[1]).toBeCloseTo(0.5, 9);
    expect(first[2]).toBeCloseTo(-0.5, 9);
    expect(first[3]).toBeCloseTo(128 / 255 - 0.5, 9);
    expect(grainSampleFrom(bytes, 1)).toEqual([-0.5, -0.5, -0.5, -0.5]);
  });
});

describe('combineOctaves', () => {
  it('keeps the variance a single octave has, so a second one is not a louder grain', () => {
    // Two independent draws: the combined field's variance must be the base's.
    let base = 0;
    let both = 0;
    const n = 4000;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    for (let i = 0; i < n; i += 1) {
      const a: GrainSample = [rnd(), rnd(), rnd(), rnd()];
      const b: GrainSample = [rnd(), rnd(), rnd(), rnd()];
      base += a[0] * a[0];
      both += combineOctaves(a, b)[0] ** 2;
    }
    expect(both / n).toBeCloseTo(base / n, 2);
  });

  it('is the base alone at weight 0, and carries the octave otherwise', () => {
    const a: GrainSample = [0.1, 0.2, -0.3, 0.4];
    const b: GrainSample = [-0.5, 0.5, 0.1, 0];
    expect(combineOctaves(a, b, 0)).toEqual([0.1, 0.2, -0.3, 0.4]);
    const mixed = combineOctaves(a, b);
    const norm = 1 / Math.sqrt(1 + OCTAVE_WEIGHT * OCTAVE_WEIGHT);
    expect(mixed[0]).toBeCloseTo((0.1 + OCTAVE_WEIGHT * -0.5) * norm, 12);
  });
});

describe('halationTaps', () => {
  it('covers ±3σ, is odd, and the widest radius still fits the shader`s array', () => {
    expect(halationTaps(1) % 2).toBe(1);
    expect(halationTaps(2.6)).toBe(2 * Math.ceil(7.8) + 1);
    // The cap is MEASURED over the whole slider, not assumed: the buffer's
    // height comes from the radius alone, so the sigma does too.
    let widest = 0;
    const { min, max, step } = TEXTURE_RANGES.halationRadius;
    for (let r = min; r <= max + 1e-9; r += step) {
      const buffer = halationBuffer(
        { ...DEFAULT_FILM_TEXTURE, halation: 1, halationRadius: r },
        1600,
        1000,
      );
      widest = Math.max(widest, halationTaps(buffer!.sigma));
      expect(buffer!.sigma).toBeLessThanOrEqual(12.8 + 1e-9);
    }
    expect(widest).toBe(MAX_HALATION_TAPS);
  });
});

describe('screenHalation and extractHighlight', () => {
  const tint: [number, number, number] = [1, 0.45, 0.2];

  it('a halo of zero, or an amount of zero, is the identity', () => {
    expect(screenHalation([0.3, 0.5, 0.7], 0, tint, 1)).toEqual([0.3, 0.5, 0.7]);
    expect(screenHalation([0.3, 0.5, 0.7], 1, tint, 0)).toEqual([0.3, 0.5, 0.7]);
    expect(screenHalation([0.3, 0.5, 0.7], [0, 0, 0], tint, 1)).toEqual([0.3, 0.5, 0.7]);
  });

  it('takes a halo per channel — what the node hands it — and a scalar is the three equal', () => {
    const p: [number, number, number] = [0.2, 0.25, 0.3];
    expect(screenHalation(p, [0.4, 0.4, 0.4], tint, 1)).toEqual(screenHalation(p, 0.4, tint, 1));
    // A warm halo bleeds warmer than a neutral one of the same energy.
    const warm = screenHalation(p, [0.6, 0.4, 0.2], tint, 1);
    const flat = screenHalation(p, [0.4, 0.4, 0.4], tint, 1);
    expect(warm[0]).toBeGreaterThan(flat[0]);
    expect(warm[2]).toBeLessThan(flat[2]);
  });

  it('screens: never darkens, never passes white, monotone in the halo', () => {
    const p: [number, number, number] = [0.3, 0.5, 0.7];
    let prev = screenHalation(p, 0, tint, 1);
    for (let h = 0.1; h <= 1.0001; h += 0.1) {
      const cur = screenHalation(p, h, tint, 1);
      for (let c = 0; c < 3; c += 1) {
        expect(cur[c]).toBeGreaterThanOrEqual(prev[c]);
        expect(cur[c]).toBeLessThanOrEqual(1);
      }
      prev = cur;
    }
    // The tint decides the bleed's colour: red rises most, blue least.
    const full = screenHalation([0.2, 0.2, 0.2], 1, tint, 1);
    expect(full[0]).toBeGreaterThan(full[1]);
    expect(full[1]).toBeGreaterThan(full[2]);
  });

  it('extracts only what is above the threshold, keeping the colour', () => {
    expect(extractHighlight([0.5, 0.5, 0.5], 0.8)).toEqual([0, 0, 0]);
    expect(extractHighlight([1, 1, 1], 0.8)).toEqual([1, 1, 1]);
    const warm = extractHighlight([1, 0.9, 0.7], 0.8);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(warm[0]).toBeLessThanOrEqual(1);
  });
});

describe('gaussianKernel and blurSeparable', () => {
  it('is symmetric, sums to one, and peaks at the centre', () => {
    for (const [sigma, taps] of [
      [2.6, 13],
      [5.1, 13],
      [1, 7],
    ]) {
      const k = gaussianKernel(sigma, taps);
      expect(k.length).toBe(taps);
      expect(k.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
      for (let i = 0; i < taps; i += 1) expect(k[i]).toBeCloseTo(k[taps - 1 - i], 12);
      expect(Math.max(...k)).toBe(k[(taps - 1) / 2]);
    }
    expect(gaussianKernel(3, 12).length).toBe(13);
  });

  it('a flat field blurs to itself, an impulse spreads to the kernel and keeps its energy', () => {
    const w = 9;
    const h = 7;
    const k = gaussianKernel(1.2, 5);
    const flat = new Float32Array(w * h).fill(0.6);
    for (const v of blurSeparable(flat, w, h, k)) expect(v).toBeCloseTo(0.6, 5);
    const impulse = new Float32Array(w * h);
    impulse[3 * w + 4] = 1;
    const out = blurSeparable(impulse, w, h, k);
    expect(out[3 * w + 4]).toBeCloseTo(k[2] * k[2], 6);
    expect(out[3 * w + 5]).toBeCloseTo(k[2] * k[3], 6);
    expect(out[4 * w + 4]).toBeCloseTo(k[3] * k[2], 6);
    let sum = 0;
    for (const v of out) sum += v;
    expect(sum).toBeCloseTo(1, 5);
  });
});
