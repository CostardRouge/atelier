import { describe, expect, it } from 'vitest';
import { fromHalf, isHalfImage, packHalfImage, toHalf } from './half-image';

describe('toHalf / fromHalf', () => {
  it('round-trips the exact halves and rounds the rest to nearest even', () => {
    for (const v of [0, 1, 0.5, 0.25, -2, 1024, 0.000030517578125, 65504]) {
      expect(fromHalf(toHalf(v))).toBe(v);
    }
    // 1/3 is not a half: the nearest is 0.333251953125 (round down) —
    // the same answer Float16Array gives.
    expect(fromHalf(toHalf(1 / 3))).toBeCloseTo(0.333251953125, 12);
    // A value halfway between two halves goes to the EVEN one.
    const a = fromHalf(0x3c00); // 1.0
    const b = fromHalf(0x3c01); // 1.0009765625
    expect(fromHalf(toHalf((a + b) / 2))).toBe(a);
  });

  it('keeps an sRGB-encoded value to better than an 8-bit code everywhere in [0,1]', () => {
    for (let i = 0; i <= 1000; i += 1) {
      const v = i / 1000;
      expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThan(1 / 255 / 4);
    }
  });

  it('handles the edges: subnormals, overflow, sign, NaN', () => {
    // The smallest half is 2^-24 ≈ 6e-8: 1e-7 lands on a subnormal, 1e-10 on zero.
    expect(Math.abs(fromHalf(toHalf(1e-7)) - 1e-7)).toBeLessThan(2 ** -24);
    expect(toHalf(1e-10)).toBe(0);
    expect(fromHalf(toHalf(1e6))).toBe(Number.POSITIVE_INFINITY);
    expect(toHalf(-0.5) & 0x8000).toBe(0x8000);
    expect(Number.isNaN(fromHalf(toHalf(Number.NaN)))).toBe(true);
  });
});

describe('packHalfImage', () => {
  it('packs three floats per pixel, top row first, and says what it is', () => {
    const img = packHalfImage([0, 0.5, 1, 1, 0.5, 0], 2, 1);
    expect(isHalfImage(img)).toBe(true);
    expect(img.width).toBe(2);
    expect(img.data.length).toBe(6);
    expect([...img.data].map(fromHalf)).toEqual([0, 0.5, 1, 1, 0.5, 0]);
    expect(isHalfImage({ kind: 'half', data: [] })).toBe(false);
    expect(isHalfImage(null)).toBe(false);
  });
});
