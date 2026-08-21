import { describe, expect, it } from 'vitest';
import {
  OUTPUT_TRANSFORM_OPTIONS,
  applyTransfer,
  fromLinear,
  toLinear,
  transformLabel,
  transformPair,
  type OutputTransform,
  type TransferFn,
} from './transfer';

const FNS: TransferFn[] = ['gamma-2.2', 'gamma-2.4', 'srgb'];
const ALL: OutputTransform[] = [
  'none',
  'rec709-to-srgb',
  'rec709-24-to-22',
  'srgb-to-rec709',
];
/** A ramp that straddles both sRGB knees and both endpoints. */
const RAMP = [0, 0.001, 0.0031308, 0.01, 0.04045, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

describe('toLinear / fromLinear', () => {
  it('round-trips across the ramp for every curve', () => {
    for (const fn of FNS) {
      for (const v of RAMP) {
        expect(fromLinear(toLinear(v, fn), fn)).toBeCloseTo(v, 10);
      }
    }
  });

  it('pins both endpoints for every curve', () => {
    for (const fn of FNS) {
      expect(toLinear(0, fn)).toBe(0);
      expect(toLinear(1, fn)).toBeCloseTo(1, 12);
      expect(fromLinear(0, fn)).toBe(0);
      expect(fromLinear(1, fn)).toBeCloseTo(1, 12);
    }
  });

  it('is continuous at the sRGB knee, in both directions', () => {
    const e = 1e-9;
    // Encoded side: the toe meets the power segment at 0.04045.
    expect(toLinear(0.04045 - e, 'srgb')).toBeCloseTo(toLinear(0.04045 + e, 'srgb'), 7);
    // Linear side: the same join seen from 0.0031308.
    expect(fromLinear(0.0031308 - e, 'srgb')).toBeCloseTo(
      fromLinear(0.0031308 + e, 'srgb'),
      7,
    );
  });

  it('keeps the sRGB toe linear below the knee', () => {
    expect(toLinear(0.0129, 'srgb')).toBeCloseTo(0.0129 / 12.92, 12);
    expect(fromLinear(0.002, 'srgb')).toBeCloseTo(0.002 * 12.92, 12);
  });

  it('clamps out-of-range input instead of returning NaN', () => {
    // Intensity above 100% extrapolates past the look, so the bake can hand us
    // values outside [0,1]; a negative base in Math.pow would be NaN.
    for (const fn of FNS) {
      expect(toLinear(-0.5, fn)).toBe(0);
      expect(toLinear(2, fn)).toBeCloseTo(1, 12);
      expect(fromLinear(-0.5, fn)).toBe(0);
      expect(fromLinear(2, fn)).toBeCloseTo(1, 12);
    }
  });
});

describe('transformPair', () => {
  it('maps every transform, and only `none` to null', () => {
    expect(transformPair('none')).toBeNull();
    for (const t of ALL.filter((t) => t !== 'none')) {
      expect(transformPair(t)).not.toBeNull();
    }
    expect(transformPair('rec709-to-srgb')).toEqual({ from: 'gamma-2.4', to: 'srgb' });
    expect(transformPair('srgb-to-rec709')).toEqual({ from: 'srgb', to: 'gamma-2.4' });
  });
});

describe('applyTransfer', () => {
  it('is the identity for `none`', () => {
    for (const v of RAMP) expect(applyTransfer(v, 'none')).toBe(v);
  });

  it('pins black and white for every transform', () => {
    // This is what guarantees the black and white points never drift — only
    // the shape between them changes.
    for (const t of ALL) {
      expect(applyTransfer(0, t)).toBe(0);
      expect(applyTransfer(1, t)).toBeCloseTo(1, 10);
    }
  });

  it('darkens midtones going from Rec.709 2.4 to a ~2.2 display', () => {
    // The whole point: 2.4-encoded values shown on a 2.2 display come out too
    // bright, so re-encoding for that display must pull them down.
    for (const v of [0.1, 0.25, 0.5, 0.75]) {
      expect(applyTransfer(v, 'rec709-to-srgb')).toBeLessThan(v);
      expect(applyTransfer(v, 'rec709-24-to-22')).toBeLessThan(v);
    }
  });

  it('brightens midtones going the other way', () => {
    for (const v of [0.1, 0.25, 0.5, 0.75]) {
      expect(applyTransfer(v, 'srgb-to-rec709')).toBeGreaterThan(v);
    }
  });

  it('round-trips Rec.709 → sRGB → Rec.709', () => {
    for (const v of RAMP) {
      const there = applyTransfer(v, 'rec709-to-srgb');
      expect(applyTransfer(there, 'srgb-to-rec709')).toBeCloseTo(v, 8);
    }
  });

  it('weights the correction toward the shadows', () => {
    // The error a missing transform causes is huge near black and vanishes at
    // white — that is why the symptom is "lifted, milky blacks", not "brighter
    // image". The correction has to have the same shape.
    const rel = (v: number) => (v - applyTransfer(v, 'rec709-to-srgb')) / v;
    expect(rel(0.1)).toBeGreaterThan(rel(0.25));
    expect(rel(0.25)).toBeGreaterThan(rel(0.5));
    expect(rel(0.5)).toBeGreaterThan(rel(0.75));
  });

  it('preserves the light the source encoding intended', () => {
    // Re-encoding must not change the picture, only the numbers that describe
    // it: the light an sRGB display emits for the output must equal the light
    // a 2.4 display would have emitted for the input.
    for (const v of RAMP) {
      const out = applyTransfer(v, 'rec709-to-srgb');
      expect(toLinear(out, 'srgb')).toBeCloseTo(toLinear(v, 'gamma-2.4'), 9);
    }
  });

  it('stays monotonic, so no tone ever crosses another', () => {
    for (const t of ALL) {
      let prev = -1;
      for (const v of RAMP) {
        const out = applyTransfer(v, t);
        expect(out).toBeGreaterThan(prev);
        prev = out;
      }
    }
  });
});

describe('OUTPUT_TRANSFORM_OPTIONS', () => {
  it('lists every transform exactly once, `none` first', () => {
    expect(OUTPUT_TRANSFORM_OPTIONS.map((o) => o.id)).toEqual(ALL);
  });

  it('gives every option a label and a hint', () => {
    for (const o of OUTPUT_TRANSFORM_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.hint.length).toBeGreaterThan(0);
      expect(transformLabel(o.id)).toBe(o.label);
    }
  });
});
