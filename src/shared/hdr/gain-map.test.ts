import { describe, expect, it } from 'vitest';
import {
  applyGainMap,
  describeGainMap,
  downscaleMap,
  encodeGainMap,
  hdrRendition,
  isFlatGainMap,
  linearFromBytes,
  type LinearPicture,
} from './gain-map';

const picture = (w: number, h: number, fill: (x: number, y: number) => number): LinearPicture => {
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = fill(x, y);
      data.set([v, v, v], (y * w + x) * 3);
    }
  }
  return { width: w, height: h, data };
};

describe('linearFromBytes', () => {
  it('decodes sRGB bytes to light: 0 → 0, 255 → 1, 128 → about 0.216', () => {
    const bytes = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]);
    const lin = linearFromBytes(bytes, 3, 1);
    expect(lin.data[0]).toBe(0);
    expect(lin.data[3]).toBeCloseTo(1, 6);
    expect(lin.data[6]).toBeCloseTo(0.2158, 3);
  });
});

describe('hdrRendition', () => {
  it('keeps the SDR where it had room and takes the lifted darker render where it clipped', () => {
    // SDR: a ramp that clips at 1 from x=6 on. The darker render (−2 stops)
    // holds the same ramp divided by 4, and past the clip it still rises.
    const sdr = picture(10, 1, (x) => Math.min(1, x / 5));
    const darker = picture(10, 1, (x) => (x / 5) / 4);
    const hdr = hdrRendition(sdr, darker, 2);
    // Unclipped: identical to the SDR (the lifted darker render agrees).
    expect(hdr.data[3 * 2]).toBeCloseTo(0.4, 6);
    // Clipped in the SDR at x=9: the sensor's own 1.8.
    expect(hdr.data[3 * 9]).toBeCloseTo(1.8, 6);
    // Never darker than the SDR, even where the darker render lost something.
    const dim = picture(10, 1, () => 0);
    expect(hdrRendition(sdr, dim, 2).data[3 * 2]).toBeCloseTo(0.4, 6);
    expect(() => hdrRendition(sdr, picture(4, 1, () => 0), 2)).toThrow();
  });
});

describe('encodeGainMap / applyGainMap', () => {
  it('round-trips: the SDR lifted by the map at full capacity is the HDR rendition', () => {
    const sdr = picture(16, 8, (x) => Math.min(1, x / 10));
    const hdr = picture(16, 8, (x) => x / 10); // up to 1.5 → log2 ratio ≈ 0.58 at the far edge
    const map = encodeGainMap(sdr, hdr);
    expect(map.width).toBe(16);
    expect(map.meta.gainMapMin).toBe(0);
    expect(map.meta.gainMapMax).toBeCloseTo(Math.log2((1.5 + 1 / 64) / (1 + 1 / 64)), 5);
    expect(map.headroom).toBe(map.meta.gainMapMax);
    expect(isFlatGainMap(map)).toBe(false);
    // Where the two agree the code is 0; at the clipped edge it is 255.
    expect(map.codes[3]).toBe(0);
    expect(map.codes[15]).toBe(255);
    const back = applyGainMap(sdr, map, map.meta.hdrCapacityMax);
    for (let x = 0; x < 16; x += 1) {
      expect(back.data[x * 3]).toBeCloseTo(hdr.data[x * 3], 2);
    }
    // A display with no headroom shows the SDR untouched.
    const none = applyGainMap(sdr, map, 0);
    for (let x = 0; x < 16; x += 1) expect(none.data[x * 3]).toBeCloseTo(sdr.data[x * 3], 6);
    // Halfway: half the lift, in stops.
    const half = applyGainMap(sdr, map, map.meta.hdrCapacityMax / 2);
    const fullLift = (hdr.data[15 * 3] + 1 / 64) / (sdr.data[15 * 3] + 1 / 64);
    expect((half.data[15 * 3] + 1 / 64) / (sdr.data[15 * 3] + 1 / 64)).toBeCloseTo(Math.sqrt(fullLift), 2);
  });

  it('is flat when the two renditions agree, and never says a negative lift', () => {
    const sdr = picture(8, 8, (x) => x / 8);
    const same = encodeGainMap(sdr, sdr);
    expect(same.headroom).toBe(0);
    expect(isFlatGainMap(same)).toBe(true);
    expect(describeGainMap(same)).toBe('flat — nothing above white');
    const darker = encodeGainMap(sdr, picture(8, 8, (x) => x / 16));
    expect(darker.headroom).toBe(0);
    expect(describeGainMap({ headroom: 2.34 })).toBe('up to 2.3 stops above white');
  });

  it('caps the lift it will say, and keeps the map at a fraction of the picture on request', () => {
    const sdr = picture(8, 8, () => 1);
    const hdr = picture(8, 8, () => 100);
    const map = encodeGainMap(sdr, hdr, { scale: 4, maxStops: 3 });
    expect(map.headroom).toBe(3);
    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.codes.length).toBe(4);
    expect(map.codes[0]).toBe(255);
    // Applied back through the coarse map, every picture pixel is lifted 3 stops.
    const back = applyGainMap(sdr, map, 3);
    expect(back.data[0]).toBeCloseTo((1 + 1 / 64) * 8 - 1 / 64, 4);
  });

  it('downscales by box average and leaves a factor of 1 alone', () => {
    const values = new Float32Array([0, 2, 4, 6, 1, 3, 5, 7]);
    const small = downscaleMap(values, 4, 2, 2);
    expect(small.width).toBe(2);
    expect(small.height).toBe(1);
    expect(Array.from(small.values)).toEqual([1.5, 5.5]);
    expect(downscaleMap(values, 4, 2, 1).values).toBe(values);
  });
});
