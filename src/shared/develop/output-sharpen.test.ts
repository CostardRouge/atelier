import { describe, expect, it } from 'vitest';
import { OUTPUT_SHARPEN_AMOUNT, sharpenRows } from './output-sharpen';

/** A w × h RGBA picture from a grey level per pixel. */
function grey(w: number, h: number, at: (x: number, y: number) => number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const v = at(x, y);
      d.set([v, v, v, 255], (y * w + x) * 4);
    }
  return d;
}

describe('output sharpening', () => {
  const w = 8;
  const h = 6;
  const edge = grey(w, h, (x) => (x < 4 ? 80 : 160));

  it('adds contrast across an edge, and leaves a flat field alone', () => {
    const out = sharpenRows(edge, w, h, 0, h, OUTPUT_SHARPEN_AMOUNT.standard);
    const at = (x: number, y: number) => out[(y * w + x) * 4];
    expect(at(3, 2)).toBeLessThan(80);
    expect(at(4, 2)).toBeGreaterThan(160);
    expect(at(0, 2)).toBe(80);
    expect(at(7, 2)).toBe(160);
    // Luma is moved, and the three channels together: no colour fringe.
    expect(out[(2 * w + 3) * 4 + 1]).toBe(at(3, 2));
    expect(out[(2 * w + 3) * 4 + 3]).toBe(255);
  });

  it('does more at each level, and nothing when off', () => {
    const lift = (level: keyof typeof OUTPUT_SHARPEN_AMOUNT) => sharpenRows(edge, w, h, 0, h, OUTPUT_SHARPEN_AMOUNT[level])[(2 * w + 4) * 4];
    expect(lift('off')).toBe(160);
    expect(lift('low')).toBeLessThan(lift('standard'));
    expect(lift('standard')).toBeLessThan(lift('high'));
  });

  it('leaves a code of noise nearly alone — the soft threshold', () => {
    const noisy = grey(w, h, (x, y) => 120 + ((x + y) % 2));
    const out = sharpenRows(noisy, w, h, 0, h, OUTPUT_SHARPEN_AMOUNT.high);
    for (let i = 0; i < out.length; i += 4) expect(Math.abs(out[i] - noisy[i])).toBeLessThanOrEqual(1);
  });

  it('gives the same pixels band by band as the whole picture at once', () => {
    const pic = grey(w, h, (x, y) => (x * 37 + y * 53) % 255);
    const whole = sharpenRows(pic, w, h, 0, h, 1);
    // Rows 2..4 from a band read with one row either side.
    const band = pic.slice(1 * w * 4, 5 * w * 4);
    const part = sharpenRows(band, w, 4, 1, 3, 1);
    expect([...part]).toEqual([...whole.slice(2 * w * 4, 4 * w * 4)]);
  });
});
