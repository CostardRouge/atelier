import { describe, expect, it } from 'vitest';
import {
  computeHistograms,
  computeVectorscope,
  computeWaveform,
  luma709,
} from './scopes';

/** Build an RGBA buffer from `[r, g, b, a?]` pixels (a defaults to 255). */
function rgba(...pixels: Array<[number, number, number, number?]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a ?? 255;
  });
  return out;
}

describe('luma709', () => {
  it('weights the channels per Rec.709', () => {
    expect(luma709(0, 0, 0)).toBe(0);
    expect(luma709(255, 255, 255)).toBeCloseTo(255, 5);
    expect(luma709(255, 0, 0)).toBeCloseTo(54.21, 2);
  });
});

describe('computeHistograms', () => {
  const h = computeHistograms(rgba([255, 255, 255], [0, 0, 0], [255, 0, 0]));

  it('counts per-channel values', () => {
    expect(h.r[255]).toBe(2); // white + red
    expect(h.r[0]).toBe(1); // black
    expect(h.g[0]).toBe(2); // black + red
    expect(h.g[255]).toBe(1); // white
  });

  it('bins luma and reports the busiest bin', () => {
    expect(h.luma[255]).toBe(1); // white
    expect(h.luma[0]).toBe(1); // black
    expect(h.luma[54]).toBe(1); // red → round(54.21)
    expect(h.max).toBe(2);
  });

  it('skips fully-transparent pixels', () => {
    const t = computeHistograms(rgba([255, 255, 255, 0], [0, 0, 0]));
    expect(t.r[255]).toBe(0);
    expect(t.r[0]).toBe(1);
  });
});

describe('computeWaveform', () => {
  it('bins brightness per image column', () => {
    // Two columns, one row: left white, right black.
    const wf = computeWaveform(rgba([255, 255, 255], [0, 0, 0]), 2, 1);
    expect(wf.width).toBe(2);
    expect(wf.luma[0 * 256 + 255]).toBe(1); // column 0 → white
    expect(wf.luma[1 * 256 + 0]).toBe(1); // column 1 → black
    expect(wf.r[0 * 256 + 255]).toBe(1);
  });
});

describe('computeVectorscope', () => {
  it('plots neutral greys at the exact centre', () => {
    const vs = computeVectorscope(rgba([128, 128, 128], [10, 10, 10]), 256);
    const centre = 128 * 256 + 128;
    expect(vs.data[centre]).toBe(2); // both greys land dead centre
    expect(vs.max).toBe(2);
  });

  it('pushes saturated colour off-centre', () => {
    const vs = computeVectorscope(rgba([255, 0, 0]), 256);
    // Red is above and left of centre (−Cb, +Cr): not the centre cell.
    expect(vs.data[128 * 256 + 128]).toBe(0);
    expect(vs.max).toBe(1);
  });
});
