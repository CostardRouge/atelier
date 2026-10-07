import { describe, expect, it } from 'vitest';
import {
  blendHueSat,
  hsvToRgb,
  isIdentityHueSat,
  mapHsv,
  mapSrgbThroughHueSat,
  PROPHOTO_TO_SRGB,
  rgbToHsv,
  SRGB_TO_PROPHOTO,
  type HueSatTable,
} from './hue-sat-map';
import { apply3, mul3 } from './white-balance';

/** A table of `dims` whose every node is `entry(hue, sat, val)`. */
const table = (
  dims: [number, number, number],
  entry: (h: number, s: number, v: number) => [number, number, number],
  srgbValue = false,
): HueSatTable => {
  const [hd, sd, vd] = dims;
  const data = new Float32Array(hd * sd * vd * 3);
  for (let v = 0; v < vd; v += 1)
    for (let h = 0; h < hd; h += 1)
      for (let s = 0; s < sd; s += 1) data.set(entry(h, s, v), ((v * hd + h) * sd + s) * 3);
  return { dims, data, srgbValue };
};
const close = (a: readonly number[], b: readonly number[], eps: number) =>
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));

describe('the SDK’s HSV', () => {
  it('round-trips', () => {
    for (const rgb of [
      [0.9, 0.2, 0.1],
      [0.1, 0.8, 0.3],
      [0.2, 0.3, 0.7],
      [0.5, 0.5, 0.5],
      [0.7, 0.1, 0.6],
    ] as [number, number, number][])
      close(hsvToRgb(...rgbToHsv(...rgb)), rgb, 1e-12);
  });

  it('puts the primaries on whole sextants, a grey at no saturation', () => {
    expect(rgbToHsv(1, 0, 0)).toEqual([0, 1, 1]);
    expect(rgbToHsv(0, 1, 0)).toEqual([2, 1, 1]);
    expect(rgbToHsv(0, 0, 1)).toEqual([4, 1, 1]);
    expect(rgbToHsv(0.4, 0.4, 0.4)).toEqual([0, 0, 0.4]);
  });
});

describe('linear sRGB ↔ linear ProPhoto', () => {
  it('are inverses, white to white', () => {
    close(mul3(PROPHOTO_TO_SRGB, SRGB_TO_PROPHOTO), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-9);
    close(apply3(SRGB_TO_PROPHOTO, [1, 1, 1]), [1, 1, 1], 2e-4);
  });
});

describe('a hue/sat map', () => {
  const identity = table([6, 4, 1], () => [0, 1, 1]);

  it('changes nothing when it is identity', () => {
    expect(isIdentityHueSat(identity)).toBe(true);
    for (const rgb of [
      [0.9, 0.2, 0.1],
      [0.05, 0.6, 0.3],
      [0.3, 0.3, 0.3],
    ] as [number, number, number][]) {
      close(mapHsv(identity, ...rgb), rgb, 1e-6);
      close(mapSrgbThroughHueSat(identity, rgb), rgb, 1e-6);
    }
  });

  it('moves a primary one sextant on a 60° hue shift', () => {
    const shift = table([6, 4, 1], () => [60, 1, 1]);
    expect(isIdentityHueSat(shift)).toBe(false);
    close(mapHsv(shift, 1, 0, 0), [1, 1, 0], 1e-6);
    close(mapHsv(shift, 0, 0, 1), [1, 0, 1], 1e-6);
  });

  it('hits a node exactly, and interpolates between two', () => {
    // Saturation scaled by the hue index: red (node 0) ×1, yellow (node 1) ×0.5.
    const t = table([6, 2, 1], (h) => [0, h === 1 ? 0.5 : 1, 1]);
    close(mapHsv(t, 1, 0, 0), [1, 0, 0], 1e-6);
    const [, s] = rgbToHsv(...mapHsv(t, 1, 1, 0));
    expect(s).toBeCloseTo(0.5, 6);
    // Halfway (orange, hue 0.5): the scale is the average.
    const [, mid] = rgbToHsv(...mapHsv(t, 1, 0.5, 0));
    expect(mid).toBeCloseTo(0.75, 6);
  });

  it('scales the value, and reads a value axis when it has one', () => {
    const darker = table([6, 2, 1], () => [0, 1, 0.5]);
    close(mapHsv(darker, 0.8, 0.4, 0.2), [0.4, 0.2, 0.1], 1e-6);
    // Value axis: the dark node ×1, the bright node ×0.5.
    const layered = table([6, 2, 2], (_h, _s, v) => [0, 1, v ? 0.5 : 1]);
    close(mapHsv(layered, 1, 0, 0), [0.5, 0, 0], 1e-6);
    close(mapHsv(layered, 0, 0, 0.5), [0, 0, 0.375], 1e-6);
  });

  it('holds saturation at one', () => {
    const vivid = table([6, 2, 1], () => [0, 3, 1]);
    const [, s] = rgbToHsv(...mapHsv(vivid, 0.9, 0.5, 0.3));
    expect(s).toBeLessThanOrEqual(1);
  });

  it('blends two illuminants’ tables at the matrices’ weight, and takes none without bytes', () => {
    const a = table([6, 2, 1], () => [10, 1, 1]);
    const b = table([6, 2, 1], () => [30, 1, 1]);
    const map = { dims: a.dims, data: a.data, data2: b.data, srgbValue: false };
    expect(blendHueSat(map, 1)!.data[0]).toBeCloseTo(10, 6);
    expect(blendHueSat(map, 0)!.data[0]).toBeCloseTo(30, 6);
    expect(blendHueSat(map, 0.25)!.data[0]).toBeCloseTo(25, 6);
    expect(blendHueSat({ ...map, data: null }, 0.5)).toBeNull();
    expect(blendHueSat(null, 0.5)).toBeNull();
  });
});
