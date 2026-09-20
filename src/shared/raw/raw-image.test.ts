import { describe, expect, it } from 'vitest';
import { fromHalf } from '../render/half-image';
import { fromLinear, toLinear } from '../lut/transfer';
import {
  autoBrightGain,
  boxDownscale,
  bt709ToLinear,
  bytesFromLinear,
  halfImageFromLinear,
  linearFromLibRaw,
  linearToBt709,
  rawBoxFactor,
  type LinearRgb,
} from './raw-image';

const picture = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]): LinearRgb => {
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const [r, g, b] = fill(x, y);
    data.set([r, g, b], (y * w + x) * 3);
  }
  return { width: w, height: h, data };
};

describe('the decoder’s curve', () => {
  it('is BT.709, inverted exactly — the numbers the probe measured', () => {
    // 0.5 of sensor white came back as 0.7059 from LibRaw, whatever `gamm` said.
    expect(linearToBt709(0.5)).toBeCloseTo(0.7059, 3);
    expect(linearToBt709(0.25)).toBeCloseTo(0.4902, 3);
    expect(bt709ToLinear(0.7059)).toBeCloseTo(0.5, 2);
    for (const v of [0, 0.001, 0.01, 0.018, 0.1, 0.5, 0.9, 1]) {
      expect(bt709ToLinear(linearToBt709(v))).toBeCloseTo(v, 9);
    }
  });

  it('turns a 16-bit decode into linear light through the table', () => {
    const rgb16 = new Uint16Array([0, 65535, Math.round(linearToBt709(0.5) * 65535)]);
    const lin = linearFromLibRaw(rgb16, 1, 1);
    expect(lin.data[0]).toBe(0);
    expect(lin.data[1]).toBeCloseTo(1, 6);
    expect(lin.data[2]).toBeCloseTo(0.5, 3);
    expect(() => linearFromLibRaw(rgb16, 2, 1)).toThrow();
  });
});

describe('autoBrightGain', () => {
  it('puts the brightest one per cent at white, and never lifts a picture that reaches it', () => {
    // A ramp from 0 to 0.5: the top 1 % sits at 0.495 → gain ≈ 2.02.
    const ramp = picture(1000, 1, (x) => [x / 1998, x / 1998, x / 1998]);
    const gain = autoBrightGain(ramp, 0.01, 1);
    expect(gain).toBeGreaterThan(1.95);
    expect(gain).toBeLessThan(2.1);
    // A ramp reaching 1 with one per cent of it AT white: gain 1 — the
    // sensor's white is white, and a picture that reaches it is never lifted.
    const full = picture(1000, 1, (x) => (x < 20 ? [1, 1, 1] : [x / 999, x / 999, x / 999]));
    expect(autoBrightGain(full, 0.01, 1)).toBe(1);
    // A ramp reaching 1 with NOTHING at white: the top one per cent sits at
    // 0.99, which is dcraw's rule and lifts by a hair.
    const ramp1 = picture(1000, 1, (x) => [x / 999, x / 999, x / 999]);
    expect(autoBrightGain(ramp1, 0.01, 1)).toBeCloseTo(1.01, 2);
  });

  it('reads the brightest CHANNEL, is bounded, and is rounded to three decimals', () => {
    const red = picture(100, 1, () => [0.4, 0.1, 0.1]);
    expect(autoBrightGain(red, 0.01, 1)).toBeCloseTo(2.5, 2);
    const dark = picture(100, 1, () => [0.001, 0.001, 0.001]);
    expect(autoBrightGain(dark, 0.01, 1)).toBe(16);
    expect(String(autoBrightGain(picture(100, 1, () => [0.3, 0.3, 0.3]), 0.01, 1))).toMatch(/^\d+(\.\d{1,3})?$/);
  });
});

describe('the budget', () => {
  it('picks the first integer box factor that fits', () => {
    expect(rawBoxFactor(4000, 3000, 12_000_000)).toBe(1);
    expect(rawBoxFactor(4000, 3000, 8_000_000)).toBe(2);
    expect(rawBoxFactor(8000, 6000, 8_000_000)).toBe(3);
    expect(rawBoxFactor(8000, 6000, 0)).toBe(1);
  });

  it('box-averages linear light and drops the edge that does not fill a box', () => {
    const p = picture(5, 3, (x, y) => [x, y, x + y]);
    const small = boxDownscale(p, 2);
    expect(small.width).toBe(2);
    expect(small.height).toBe(1);
    // Top-left box: x in {0,1}, y in {0,1} → mean x 0.5, mean y 0.5, mean x+y 1.
    expect([...small.data.slice(0, 3)]).toEqual([0.5, 0.5, 1]);
    expect([...small.data.slice(3, 6)]).toEqual([2.5, 0.5, 3]);
    expect(boxDownscale(p, 1)).toBe(p);
  });
});

describe('what reaches the GPU and the 2D canvas', () => {
  it('encodes linear light to sRGB half-floats, sensor white at 1, headroom past it', () => {
    const p = picture(4, 1, (x) => [[0, 0.18, 1, 2][x], 0.5, 0.001]);
    const half = halfImageFromLinear(p);
    const at = (i: number) => fromHalf(half.data[i]);
    expect(at(0)).toBe(0);
    expect(at(3)).toBeCloseTo(fromLinear(0.18, 'srgb'), 3);
    expect(at(6)).toBe(1);
    // Above white the encode continues: 2.0 linear is past 1.0 encoded.
    expect(at(9)).toBeGreaterThan(1.3);
    expect(at(4)).toBeCloseTo(fromLinear(0.5, 'srgb'), 3);
    expect(toLinear(at(2), 'srgb')).toBeCloseTo(0.001, 4);
  });

  it('draws the as-shot bytes with the measured gain, clipped at white', () => {
    const p = picture(3, 1, (x) => [[0.25, 0.5, 0.05][x], 0.25, 0.25]);
    const bytes = bytesFromLinear(p, 2);
    expect(bytes[0]).toBe(Math.round(fromLinear(0.5, 'srgb') * 255));
    expect(bytes[4]).toBe(255);
    expect(bytes[8]).toBe(Math.round(fromLinear(0.1, 'srgb') * 255));
    expect(bytes[3]).toBe(255);
  });
});
