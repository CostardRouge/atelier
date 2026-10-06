import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import { toHalf, type HalfImage } from '../render/half-image';
import { codes16FromBytes, compositeBytesOver, halfToCode16, resampleHalfInto, snapRect } from './deliver-half';

function half(width: number, height: number, at: (x: number, y: number) => [number, number, number]): HalfImage {
  const data = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y);
      data.set([toHalf(r), toHalf(g), toHalf(b)], (y * width + x) * 3);
    }
  }
  return { kind: 'half', width, height, data };
}

describe('halfToCode16', () => {
  it('maps the encoded [0,1] onto 16-bit codes, clamped', () => {
    expect(halfToCode16(toHalf(0))).toBe(0);
    expect(halfToCode16(toHalf(1))).toBe(65535);
    expect(halfToCode16(toHalf(1.7))).toBe(65535);
    expect(halfToCode16(toHalf(-0.2))).toBe(0);
    expect(halfToCode16(toHalf(0.5))).toBe(32768);
  });
});

describe('snapRect', () => {
  it('snaps a layout to whole pixels inside the canvas', () => {
    expect(snapRect({ x: 2.4, y: 1.6, pw: 10.2, ph: 5.1 }, 20, 10)).toEqual({ x0: 2, y0: 2, x1: 13, y1: 7 });
    expect(snapRect({ x: -1, y: 0, pw: 50, ph: 50 }, 20, 10)).toEqual({ x0: 0, y0: 0, x1: 20, y1: 10 });
  });
});

describe('resampleHalfInto', () => {
  it('returns the picture itself at 1:1 under the default framing', () => {
    const w = 12;
    const h = 8;
    const src = half(w, h, (x, y) => [x / (w - 1), y / (h - 1), 0.25]);
    const out = new Uint16Array(w * h * 3);
    resampleHalfInto(out, w, { x0: 0, y0: 0, x1: w, y1: h }, src, DEFAULT_FRAMING);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 3;
        // Within the half-float's own precision of a code.
        expect(Math.abs(out[o] - (x / (w - 1)) * 65535)).toBeLessThan(40);
        expect(Math.abs(out[o + 1] - (y / (h - 1)) * 65535)).toBeLessThan(40);
        expect(Math.abs(out[o + 2] - 0.25 * 65535)).toBeLessThan(40);
      }
    }
  });

  it('averages a downscale rather than skipping — a fine checkerboard comes out mid grey', () => {
    const src = half(64, 64, (x, y) => ((x + y) & 1 ? [1, 1, 1] : [0, 0, 0]));
    const w = 16;
    const h = 16;
    const out = new Uint16Array(w * h * 3);
    resampleHalfInto(out, w, { x0: 0, y0: 0, x1: w, y1: h }, src, DEFAULT_FRAMING);
    for (let i = 0; i < out.length; i += 1) expect(Math.abs(out[i] - 32768)).toBeLessThan(2000);
  });

  it('leaves the border outside the rectangle alone, and mirrors a flipped framing', () => {
    const w = 10;
    const h = 6;
    const src = half(w, h, (x) => [x / (w - 1), 0, 0]);
    const out = new Uint16Array(w * h * 3).fill(12345);
    const rect = { x0: 2, y0: 1, x1: 8, y1: 5 };
    resampleHalfInto(out, w, rect, src, { ...DEFAULT_FRAMING, flipX: true });
    // Outside: untouched.
    expect(out[0]).toBe(12345);
    expect(out[(5 * w + 9) * 3]).toBe(12345);
    // Inside: red runs DOWN across the rectangle, since the picture is mirrored.
    const left = out[(2 * w + rect.x0) * 3];
    const right = out[(2 * w + rect.x1 - 1) * 3];
    expect(left).toBeGreaterThan(right);
  });

  it('paints the bars black where a contain framing shows none of the picture', () => {
    // A 2:1 picture into a square rectangle under `contain`: bands above and below.
    const src = half(20, 10, () => [1, 1, 1]);
    const w = 10;
    const h = 10;
    const out = new Uint16Array(w * h * 3);
    resampleHalfInto(out, w, { x0: 0, y0: 0, x1: w, y1: h }, src, { ...DEFAULT_FRAMING, fit: 'contain' });
    expect(out[0]).toBe(0);
    expect(out[(5 * w + 5) * 3]).toBe(65535);
    expect(out[(9 * w + 5) * 3]).toBe(0);
  });
});

describe('codes16FromBytes and compositeBytesOver', () => {
  it('widens 8-bit codes by 257 and lays an alpha picture over them', () => {
    const bytes = new Uint8ClampedArray([255, 128, 0, 255, 10, 20, 30, 255]);
    const codes = codes16FromBytes(bytes, 2, 1);
    expect(Array.from(codes)).toEqual([65535, 32896, 0, 2570, 5140, 7710]);
    const over = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 128]);
    compositeBytesOver(codes, 2, 1, over);
    expect(codes[0]).toBe(65535);
    expect(codes[3]).toBe(Math.round(2570 * (1 - 128 / 255) + 65535 * (128 / 255)));
  });
});
