import { describe, expect, it } from 'vitest';
import { fromHalf } from '../render/half-image';
import { fromLinear, toLinear } from '../lut/transfer';
import {
  autoBrightGain,
  autoBrightGainFromLibRaw,
  boxDownscale,
  boxLinearRows,
  boxedSize,
  bt709Table,
  bt709ToLinear,
  byteTableFromLibRaw,
  bytesFromLinear,
  countBrightness,
  encodeLinearRows,
  gainFromHistogram,
  halfImageFromLinear,
  halfTableFromLibRaw,
  linearFromLibRaw,
  linearToBt709,
  makeGainHistogram,
  packBytePixels,
  packHalfSamples,
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

describe('the fused paths agree with the two-step ones to the bit', () => {
  // A 16-bit decode with every kind of value in it: a ramp, noise, a clipped
  // patch — 9×7 so a box factor of 2 drops an edge row and column.
  const W = 9;
  const H = 7;
  const rgb16 = new Uint16Array(W * H * 3);
  for (let i = 0; i < rgb16.length; i += 1) {
    const seed = (i * 2654435761) >>> 0;
    rgb16[i] = i % 11 === 0 ? 65535 : i % 7 === 0 ? 0 : (seed >>> 16) & 0xffff;
  }
  const table = bt709Table();

  it('boxLinearRows writes what boxDownscale(linearFromLibRaw()) computes, band by band', () => {
    for (const factor of [2, 3]) {
      const expected = boxDownscale(linearFromLibRaw(rgb16, W, H), factor);
      const { width, height } = boxedSize(W, H, factor);
      expect({ width, height }).toEqual({ width: expected.width, height: expected.height });
      const out = new Float32Array(width * height * 3);
      // Two bands, an odd split, so a row boundary inside the picture is exercised.
      boxLinearRows(rgb16, W, factor, table, out, width, 0, 1);
      boxLinearRows(rgb16, W, factor, table, out, width, 1, height);
      expect(Array.from(out)).toEqual(Array.from(expected.data));
    }
  });

  it('the whole-picture tables give the same half-floats and bytes as the linear picture would', () => {
    const linear = linearFromLibRaw(rgb16, W, H, table);
    const half = halfImageFromLinear(linear);
    const halfTable = halfTableFromLibRaw(table);
    const packed = new Uint16Array(rgb16.length);
    packHalfSamples(rgb16, halfTable, packed, 0, 10);
    packHalfSamples(rgb16, halfTable, packed, 10, rgb16.length);
    expect(Array.from(packed)).toEqual(Array.from(half.data));

    const gain = autoBrightGain(linear, 0.01, 1);
    expect(autoBrightGainFromLibRaw(rgb16, W, H, table, 0.01, 1)).toBe(gain);
    expect(autoBrightGainFromLibRaw(rgb16, W, H, table)).toBe(autoBrightGain(linear));
    const bytes = bytesFromLinear(linear, gain);
    const byteTable = byteTableFromLibRaw(table, gain);
    const out = new Uint8ClampedArray(W * H * 4);
    packBytePixels(rgb16, byteTable, out, 0, 20);
    packBytePixels(rgb16, byteTable, out, 20, W * H);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('a band of the plane decoded on its own writes the same boxes, half-floats, bytes and gain as the whole', () => {
    // The plane cut as a tile would be: rows 2..5 of the 9×7 picture, with a
    // margin row above and below that LibRaw would decode and we discard.
    const skip = 1;
    const from = 2;
    const to = 5;
    const band = rgb16.subarray((from - skip) * W * 3, (to + skip) * W * 3);
    // The boxed rows a factor-2 cut covers: plane rows 2..4 are boxed rows 1..2.
    const factor = 2;
    const expected = boxDownscale(linearFromLibRaw(rgb16, W, H), factor);
    const { width } = boxedSize(W, H, factor);
    const out = new Float32Array(expected.data.length);
    boxLinearRows(rgb16, W, factor, table, out, width, 0, 1);
    boxLinearRows(band, W, factor, table, out, width, 1, 2, from - skip);
    boxLinearRows(rgb16, W, factor, table, out, width, 2, expected.height);
    expect(Array.from(out)).toEqual(Array.from(expected.data));
    // A piece with a side margin too — a region's tile. The region is plane
    // rows 2..3 and columns 2..7 (one boxed row, three boxed columns, the
    // whole picture's boxed row 1 and columns 1..3); the piece LibRaw hands
    // back holds a margin column on the left (plane column 1) and rows 2..5.
    // Coordinates are the REGION's own: its row 0 is plane row 2, its column
    // 0 plane column 2, and the piece starts one column before it.
    const piece = new Uint16Array(4 * 8 * 3);
    for (let r = 0; r < 4; r += 1) piece.set(rgb16.subarray(((2 + r) * W + 1) * 3, ((2 + r) * W + 9) * 3), r * 8 * 3);
    const region = new Float32Array(3 * 3);
    boxLinearRows(piece, 8, factor, table, region, 3, 0, 1, 0, -1);
    expect(Array.from(region)).toEqual(Array.from(expected.data.slice((1 * width + 1) * 3, (1 * width + 4) * 3)));

    const halfTable = halfTableFromLibRaw(table);
    const whole = new Uint16Array(rgb16.length);
    packHalfSamples(rgb16, halfTable, whole, 0, rgb16.length);
    const tiled = new Uint16Array(rgb16.length);
    packHalfSamples(rgb16, halfTable, tiled, 0, from * W * 3);
    packHalfSamples(band, halfTable, tiled, from * W * 3, to * W * 3, skip * W * 3 - from * W * 3);
    packHalfSamples(rgb16, halfTable, tiled, to * W * 3, rgb16.length);
    expect(Array.from(tiled)).toEqual(Array.from(whole));

    const gain = 1.7;
    const byteTable = byteTableFromLibRaw(table, gain);
    const wholeBytes = new Uint8ClampedArray(W * H * 4);
    packBytePixels(rgb16, byteTable, wholeBytes, 0, W * H);
    const tiledBytes = new Uint8ClampedArray(W * H * 4);
    packBytePixels(rgb16, byteTable, tiledBytes, 0, from * W);
    packBytePixels(band, byteTable, tiledBytes, from * W, to * W, skip * W - from * W);
    packBytePixels(rgb16, byteTable, tiledBytes, to * W, W * H);
    expect(Array.from(tiledBytes)).toEqual(Array.from(wholeBytes));

    // The exposure counted band by band, by absolute pixel index, is the whole plane's measurement.
    const hist = makeGainHistogram();
    countBrightness(rgb16, table, hist, 0, from * W);
    countBrightness(band, table, hist, from * W, to * W, 4, skip * W - from * W);
    countBrightness(rgb16, table, hist, to * W, W * H);
    expect(gainFromHistogram(hist)).toBe(autoBrightGainFromLibRaw(rgb16, W, H, table));
    expect(hist.counted).toBe(Math.ceil((W * H) / 4));
  });

  it('halfImageFromLinear still encodes every sample as the packed float picture did', () => {
    // The old path: an encoded Float32 picture, then packed. Pinned so the
    // fused encode cannot drift from it by a rounding step.
    const linear = linearFromLibRaw(rgb16, W, H, table);
    const encoded = new Float32Array(linear.data.length);
    for (let i = 0; i < encoded.length; i += 1) {
      const v = linear.data[i];
      encoded[i] = v <= 0 ? 0 : v >= 1 ? 1 : fromLinear(v, 'srgb');
    }
    const half = halfImageFromLinear(linear);
    for (let i = 0; i < encoded.length; i += 1) {
      expect(Math.abs(fromHalf(half.data[i]) - encoded[i])).toBeLessThan(0.002);
    }
  });
});

describe('the fused encode over a linear picture', () => {
  it('writes the very half-floats and bytes the two single-output functions do, band by band', () => {
    const w = 7;
    const h = 5;
    const data = new Float32Array(w * h * 3);
    for (let i = 0; i < data.length; i += 1) data[i] = ((i * 37) % 101) / 80; // 0..1.26, headroom included
    const linear = { width: w, height: h, data };
    const gain = 1.37;
    const half = new Uint16Array(data.length);
    const bytes = new Uint8ClampedArray(w * h * 4);
    encodeLinearRows(linear, gain, half, bytes, 0, 9);
    encodeLinearRows(linear, gain, half, bytes, 9, w * h);
    expect(Array.from(half)).toEqual(Array.from(halfImageFromLinear(linear).data));
    expect(Array.from(bytes)).toEqual(Array.from(bytesFromLinear(linear, gain)));
    // Asked for the half-floats alone, it touches no bytes.
    const halfOnly = new Uint16Array(data.length);
    encodeLinearRows(linear, gain, halfOnly, null, 0, w * h);
    expect(Array.from(halfOnly)).toEqual(Array.from(half));
  });

  it('shares its tables between calls and never hands out a different one', () => {
    expect(bt709Table()).toBe(bt709Table());
    expect(halfTableFromLibRaw(bt709Table())).toBe(halfTableFromLibRaw(bt709Table()));
  });
});
