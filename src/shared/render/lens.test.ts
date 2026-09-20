import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LENS,
  chromaScales,
  describeLens,
  distortionTerms,
  isDefaultLens,
  lensOrNull,
  lensSampleRadius,
  normaliseLens,
  sameLens,
  vignetteEncoded,
  vignetteGain,
  vignetteTerms,
  type LensCorrection,
} from './lens';
import { fromLinear, toLinear } from '../lut/transfer';

const lens = (over: Partial<LensCorrection>): LensCorrection => ({ ...DEFAULT_LENS, ...over });

describe('lensSampleRadius', () => {
  it('holds the CENTRE still, whatever the coefficients', () => {
    // The property that makes a correction pivot on the middle of the picture
    // rather than sliding it: r = 0 is a fixed point by construction.
    for (const [k1, k2] of [[0.25, 0.12], [-0.25, -0.12], [0.1, -0.05]]) {
      expect(lensSampleRadius(0, k1, k2)).toBe(0);
    }
  });

  it('is the identity when nothing is set', () => {
    for (let r = 0; r <= 1.0001; r += 0.05) {
      expect(lensSampleRadius(r, 0, 0)).toBeCloseTo(r, 12);
    }
  });

  it('samples FURTHER out to undo pincushion and closer in to undo barrel', () => {
    const { k1: pin } = distortionTerms(lens({ distortion: 100 }));
    const { k1: bar } = distortionTerms(lens({ distortion: -100 }));
    expect(lensSampleRadius(1, pin, 0)).toBeGreaterThan(1);
    expect(lensSampleRadius(1, bar, 0)).toBeLessThan(1);
  });

  it('stays MONOTONE across the frame at the strongest settings', () => {
    // A radius map that turned back on itself would fold the picture over —
    // the same failure the tone curve's tangent clamp exists to prevent.
    for (const d of [-100, -50, 50, 100]) {
      for (const d2 of [-100, 0, 100]) {
        const { k1, k2 } = distortionTerms(lens({ distortion: d, distortion2: d2 }));
        let previous = -1;
        for (let r = 0; r <= 1.0001; r += 0.01) {
          const out = lensSampleRadius(r, k1, k2);
          expect(out).toBeGreaterThanOrEqual(previous - 1e-12);
          previous = out;
        }
      }
    }
  });

  it('moves a corner by a sane amount, not off the planet', () => {
    const { k1, k2 } = distortionTerms(lens({ distortion: 100, distortion2: 100 }));
    const corner = lensSampleRadius(1, k1, k2);
    expect(corner).toBeGreaterThan(1);
    expect(corner).toBeLessThan(1.5);
  });
});

describe('chromaScales', () => {
  it('leaves GREEN alone and moves red and blue against it', () => {
    // Green is the reference: a fringe is red and blue landing at the wrong
    // size, so those are what get resized.
    const s = chromaScales(lens({ chromaRed: 100, chromaBlue: -100 }));
    expect(s.red).toBeGreaterThan(1);
    expect(s.blue).toBeLessThan(1);
    // Small: lateral CA is a fraction of a percent of the frame, not a percent.
    expect(s.red).toBeLessThan(1.02);
  });

  it('is exactly 1 for both when unset', () => {
    expect(chromaScales(DEFAULT_LENS)).toEqual({ red: 1, blue: 1 });
  });
});

describe('vignetteGain', () => {
  it('never touches the centre', () => {
    for (const amount of [-100, -30, 30, 100]) {
      expect(vignetteGain(0, amount, 50)).toBe(1);
    }
  });

  it('lifts the corners for a positive amount and sinks them for a negative one', () => {
    expect(vignetteGain(1, 100, 50)).toBeGreaterThan(1);
    expect(vignetteGain(1, -100, 50)).toBeLessThan(1);
  });

  it('starts biting only past the midpoint, and comes on gently', () => {
    expect(vignetteGain(0.4, 100, 50)).toBe(1);
    expect(vignetteGain(0.5, 100, 50)).toBe(1);
    const justPast = vignetteGain(0.55, 100, 50);
    const further = vignetteGain(0.8, 100, 50);
    expect(justPast).toBeGreaterThan(1);
    // Squared, so there is no visible ring where it begins.
    expect(justPast - 1).toBeLessThan((further - 1) / 4);
  });

  it('is 1 everywhere when the amount is 0, midpoint notwithstanding', () => {
    for (const r of [0, 0.5, 1]) for (const mid of [0, 50, 100]) {
      expect(vignetteGain(r, 0, mid)).toBe(1);
    }
  });

  it('handles a midpoint at the very edge without dividing by zero', () => {
    expect(Number.isFinite(vignetteGain(1, 100, 100))).toBe(true);
    expect(vignetteGain(0.99, 100, 100)).toBe(1);
  });

  it('hands the shader the SAME two numbers it works from itself', () => {
    // The one duplication that would let the GPU drift from the pure module is
    // the reach constant, so the shader is given it rather than told it.
    for (const [amount, mid] of [[100, 50], [-40, 20], [30, 0]]) {
      const l = lens({ vignette: amount, vignetteMidpoint: mid });
      const { amount: a, start } = vignetteTerms(l);
      for (const r of [0.2, 0.5, 0.8, 1]) {
        const t = r <= start ? 0 : (r - start) / (1 - start);
        expect(1 + a * t * t).toBeCloseTo(vignetteGain(r, amount, mid), 12);
      }
    }
  });
});

describe('vignetteEncoded', () => {
  it('leaves the centre, and everything, alone when there is nothing to do', () => {
    expect(vignetteEncoded(0.3, 0, 100, 50)).toBe(0.3);
    expect(vignetteEncoded(0.3, 1, 0, 50)).toBe(0.3);
    expect(vignetteEncoded(0.3, 0.4, 100, 50)).toBe(0.3);
  });

  it('is the gain applied to LIGHT: doubling the light is not doubling the code', () => {
    // A gain of 2 at the corner: 0.5 encoded is 0.214 linear, ×2 is 0.428
    // linear, which encodes to 0.69 — not 1.0.
    const encoded = 0.5;
    const gain = vignetteGain(1, 100, 50);
    expect(gain).toBeCloseTo(1.8, 12);
    const got = vignetteEncoded(encoded, 1, 100, 50);
    expect(got).toBeCloseTo(fromLinear(toLinear(encoded, 'srgb') * gain, 'srgb'), 12);
    expect(got).toBeLessThan(encoded * gain);
  });

  it('lifts a dark corner and a bright one by the same ratio of LIGHT', () => {
    const ratio = (v: number) =>
      toLinear(vignetteEncoded(v, 1, 60, 20), 'srgb') / toLinear(v, 'srgb');
    expect(ratio(0.2)).toBeCloseTo(ratio(0.6), 6);
    expect(ratio(0.2)).toBeCloseTo(vignetteGain(1, 60, 20), 6);
  });

  it('sinks a corner for a negative amount, never below black', () => {
    expect(vignetteEncoded(0.4, 1, -100, 50)).toBeLessThan(0.4);
    expect(vignetteEncoded(0.4, 1, -100, 50)).toBeGreaterThanOrEqual(0);
  });
});

describe('the record', () => {
  it('reads junk as neutral and clamps to the sliders', () => {
    expect(normaliseLens(null)).toEqual(DEFAULT_LENS);
    expect(normaliseLens({ distortion: 'x' })).toEqual(DEFAULT_LENS);
    expect(normaliseLens({ distortion: -900 }).distortion).toBe(-100);
    expect(normaliseLens({ vignetteMidpoint: 900 }).vignetteMidpoint).toBe(100);
  });

  it('stores nothing for a correction that does nothing — a midpoint alone is not one', () => {
    expect(lensOrNull(null)).toBeNull();
    expect(lensOrNull({})).toBeNull();
    // The midpoint only says WHERE a vignette correction bites; with no amount
    // it corrects nothing, so it must not make the picture look corrected.
    expect(lensOrNull({ vignetteMidpoint: 20 })).toBeNull();
    expect(lensOrNull({ vignette: 20 })?.vignette).toBe(20);
    expect(isDefaultLens(lens({ vignetteMidpoint: 10 }))).toBe(true);
  });

  it('compares by value', () => {
    expect(sameLens(null, DEFAULT_LENS)).toBe(true);
    expect(sameLens(lens({ distortion: -5 }), lens({ distortion: -5 }))).toBe(true);
    expect(sameLens(lens({ distortion: -5 }), null)).toBe(false);
  });

  it('names barrel and pincushion by their own words', () => {
    expect(describeLens(null)).toBe('');
    expect(describeLens(lens({ distortion: -40 }))).toBe('barrel −40');
    expect(describeLens(lens({ distortion: 40 }))).toBe('pincushion +40');
    expect(describeLens(lens({ chromaRed: 12, vignette: 30 }))).toBe(
      'CA red +12 · vignette +30',
    );
  });
});
