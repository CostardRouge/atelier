import { describe, expect, it } from 'vitest';
import {
  GRAIN_GAIN,
  applyGrain,
  blurSeparable,
  extractHighlight,
  gaussianKernel,
  grainSampleFrom,
  grainWeight,
  screenHalation,
  type GrainSample,
} from './film-grain';

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

describe('screenHalation and extractHighlight', () => {
  const tint: [number, number, number] = [1, 0.45, 0.2];

  it('a halo of zero, or an amount of zero, is the identity', () => {
    expect(screenHalation([0.3, 0.5, 0.7], 0, tint, 1)).toEqual([0.3, 0.5, 0.7]);
    expect(screenHalation([0.3, 0.5, 0.7], 1, tint, 0)).toEqual([0.3, 0.5, 0.7]);
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
