import { describe, expect, it } from 'vitest';
import {
  codeTable,
  developTile,
  JXL_COMPRESSION,
  LINEAR_RAW,
  linearDngColor,
  orientedSize,
  orientPoint,
  readLinearDng,
  storedRect,
} from './linear-dng';
import { apply3 } from './white-balance';

/** A little-endian TIFF: IFD0 (make, orientation, colour) → one SubIFD holding the sensor. */
function dng(opts: { compression?: number; photometric?: number; orientation?: number; tiled?: boolean } = {}): ArrayBuffer {
  const buf = new ArrayBuffer(4096);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  let data = 1024; // out-of-line values go here
  const put = (ifd: number, entries: [number, number, number[]][], next = 0) => {
    v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, values], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true);
      v.setUint16(e + 2, type, true);
      const size = { 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 }[type]!;
      const count = type === 5 || type === 10 ? values.length / 2 : values.length;
      v.setUint32(e + 4, count, true);
      let at = e + 8;
      if (size * count > 4) {
        v.setUint32(e + 8, data, true);
        at = data;
        data += size * count + (size * count) % 2;
      }
      values.forEach((n, k) => {
        if (type === 2) v.setUint8(at + k, n);
        else if (type === 3) v.setUint16(at + k * 2, n, true);
        else if (type === 4 || type === 5) v.setUint32(at + k * 4, n, true);
        else v.setInt32(at + k * 4, n, true);
      });
    });
    v.setUint32(ifd + 2 + entries.length * 12, next, true);
  };
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const rat = (xs: number[]) => xs.flatMap((x) => [Math.round(x * 10000), 10000]);
  put(8, [
    [271, 2, text('Apple')],
    [272, 2, text('iPhone 16 Pro')],
    [274, 3, [opts.orientation ?? 1]],
    [330, 4, [300]],
    [50721, 10, rat([1, 0, 0, 0, 1, 0, 0, 0, 1])],
    [50722, 10, rat([0.5, -0.1, -0.05, -0.4, 1.3, 0.1, -0.1, 0.2, 0.6])],
    [50728, 5, rat([0.5, 1, 0.8])],
    [50778, 3, [17]],
    [50779, 3, [21]],
  ]);
  const tiles = opts.tiled !== false;
  put(300, [
    [254, 4, [0]],
    [256, 4, [300]],
    [257, 4, [200]],
    [258, 3, [16, 16, 16]],
    [259, 3, [opts.compression ?? JXL_COMPRESSION]],
    [262, 3, [opts.photometric ?? LINEAR_RAW]],
    [277, 3, [3]],
    ...(tiles
      ? ([
          [322, 4, [256]],
          [323, 4, [128]],
          [324, 4, [5000, 6000, 7000, 8000]],
          [325, 4, [100, 110, 120, 130]],
        ] as [number, number, number[]][])
      : ([
          [273, 4, [5000, 6000]],
          [278, 4, [100]],
          [279, 4, [100, 110]],
        ] as [number, number, number[]][])),
    [50714, 3, [512, 520, 530]],
    [50717, 4, [65000]],
  ]);
  return buf;
}

describe('readLinearDng', () => {
  it('reads a JPEG XL LinearRaw sensor, its tiles and its colour', () => {
    const info = readLinearDng(dng({ orientation: 6 }))!;
    expect(info).toMatchObject({
      width: 300,
      height: 200,
      tileWidth: 256,
      tileLength: 128,
      across: 2,
      down: 2,
      bitsPerSample: 16,
      black: [512, 520, 530],
      white: 65000,
      orientation: 6,
      make: 'Apple',
      model: 'iPhone 16 Pro',
    });
    expect(info.tiles).toEqual([
      { offset: 5000, length: 100 },
      { offset: 6000, length: 110 },
      { offset: 7000, length: 120 },
      { offset: 8000, length: 130 },
    ]);
    // ColorMatrix2, the one calibrated under D65 (illuminant 21).
    expect(info.colorMatrix![0]).toBeCloseTo(0.5);
    expect(info.asShotNeutral).toEqual([0.5, 1, 0.8]);
  });

  it('reads strips as full-width tiles', () => {
    const info = readLinearDng(dng({ tiled: false }))!;
    expect(info).toMatchObject({ tileWidth: 300, tileLength: 100, across: 1, down: 2 });
  });

  it('answers null for a sensor LibRaw reads itself', () => {
    expect(readLinearDng(dng({ compression: 1 }))).toBeNull();
    expect(readLinearDng(dng({ photometric: 32803 }))).toBeNull();
    expect(readLinearDng(new ArrayBuffer(8))).toBeNull();
  });
});

describe('orientation', () => {
  it('turns a stored pixel as EXIF says, and the shown rectangle maps back', () => {
    // 6: 90° clockwise — the stored top-left lands top-right.
    expect(orientPoint(0, 0, 300, 200, 6)).toEqual([199, 0]);
    expect(orientPoint(0, 0, 300, 200, 8)).toEqual([0, 299]);
    expect(orientedSize(300, 200, 6)).toEqual({ width: 200, height: 300 });
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const shown = orientedSize(300, 200, o);
      const rect = { x: 10, y: 20, w: 30, h: 40 };
      const stored = storedRect(rect, 300, 200, o);
      // Every stored pixel of that rectangle lands inside the shown one, and they are as many.
      let inside = 0;
      for (let y = stored.y; y < stored.y + stored.h; y += 1) {
        for (let x = stored.x; x < stored.x + stored.w; x += 1) {
          const [dx, dy] = orientPoint(x, y, 300, 200, o);
          if (dx >= rect.x && dx < rect.x + rect.w && dy >= rect.y && dy < rect.y + rect.h) inside += 1;
        }
      }
      expect(inside, `orientation ${o}`).toBe(rect.w * rect.h);
      expect(stored.w * stored.h).toBe(rect.w * rect.h);
      expect(shown.width * shown.height).toBe(60000);
    }
  });
});

describe('linearDngColor', () => {
  it('builds rgb_cam as dcraw does: a camera white stays white, and the multipliers clip on the smallest', () => {
    const matrix = [0.5, -0.1, -0.05, -0.4, 1.3, 0.1, -0.1, 0.2, 0.6];
    const c = linearDngColor({ colorMatrix: matrix, asShotNeutral: [0.5, 1, 0.8] });
    expect(c.mul).toEqual([2, 1, 1.25]);
    const white = apply3(c.rgbCam, [1, 1, 1]);
    for (const v of white) expect(v).toBeCloseTo(1, 9);
    expect(c.white!.asShot).toEqual([2, 1, 1.25]);
    expect(c.white!.camXyz).toEqual(matrix);
  });

  it('says nothing about kelvin without a matrix', () => {
    const c = linearDngColor({ colorMatrix: null, asShotNeutral: null });
    expect(c).toEqual({ mul: [1, 1, 1], rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], white: null });
  });
});

describe('developTile', () => {
  const info = { width: 4, height: 2, orientation: 1, black: [0, 0, 0] as [number, number, number], white: 65535, bitsPerSample: 16 };
  const color = { mul: [1, 1, 1] as [number, number, number], rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], white: null };
  // A 4×2 tile padded to 6 wide: sample = x*1000 + y*100 in R, half in G, 0 in B.
  const samples = new Uint16Array(6 * 2 * 3);
  for (let y = 0; y < 2; y += 1)
    for (let x = 0; x < 6; x += 1) {
      samples[(y * 6 + x) * 3] = x * 10000 + y * 1000;
      samples[(y * 6 + x) * 3 + 1] = 30000;
    }
  const tile = { samples, channels: 3, tileWidth: 6, x0: 0, y0: 0, validWidth: 4, validHeight: 2 };

  it('writes the codes LibRaw would, turned into the shown frame', () => {
    const rgb16 = new Uint16Array(2 * 4 * 3);
    const identity = codeTable((x) => x);
    developTile(tile, { info: { ...info, orientation: 6 }, color, region: { x: 0, y: 0, w: 2, h: 4 }, outWidth: 2, outHeight: 4 }, { kind: 'codes', rgb16, codeOf: identity });
    // Stored (3, 1) → shown (0, 3) under a quarter turn clockwise.
    expect(rgb16[(3 * 2 + 0) * 3]).toBe(31000);
    // Stored (0, 0) → shown (1, 0).
    expect(rgb16[(0 * 2 + 1) * 3]).toBe(0);
    expect(rgb16[(0 * 2 + 1) * 3 + 1]).toBe(30000);
  });

  it('sums boxes, and a region leaves the rest untouched', () => {
    const sums = new Float32Array(1 * 1 * 3);
    developTile(tile, { info, color, region: { x: 2, y: 0, w: 2, h: 2 }, outWidth: 1, outHeight: 1 }, { kind: 'sums', sums, factor: 2 });
    // (2,0) (3,0) (2,1) (3,1): R = 20000 + 30000 + 21000 + 31000.
    expect(sums[0] * 65535).toBeCloseTo(102000, 0);
    expect(sums[1] * 65535).toBeCloseTo(120000, 0);
  });

  it('clips each channel at the white after the multipliers, as dcraw -H 0', () => {
    const rgb16 = new Uint16Array(4 * 2 * 3);
    const hot = { mul: [4, 1, 1] as [number, number, number], rgbCam: color.rgbCam, white: null };
    developTile(tile, { info, color: hot, region: { x: 0, y: 0, w: 4, h: 2 }, outWidth: 4, outHeight: 2 }, { kind: 'codes', rgb16, codeOf: codeTable((x) => x) });
    expect(rgb16[3 * 3]).toBe(65535); // 30000 × 4 clipped
    expect(rgb16[1 * 3]).toBe(40000); // 10000 × 4
  });
});
