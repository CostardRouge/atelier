import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readPngSamples } from './png-read';

/** A PNG written here, each row under the next of the five filters in turn — so every un-filter is exercised. */
function png(width: number, height: number, colorType: number, bitDepth: number, samples: number[]): Uint8Array {
  const stored = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const bpp = (stored * bitDepth) / 8;
  const stride = width * bpp;
  const plain = new Uint8Array(height * stride);
  samples.forEach((v, i) => {
    if (bitDepth === 16) {
      plain[i * 2] = v >> 8;
      plain[i * 2 + 1] = v & 0xff;
    } else plain[i] = v;
  });
  const filtered = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const f = y % 5;
    filtered[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i += 1) {
      const x = plain[y * stride + i];
      const a = i >= bpp ? plain[y * stride + i - bpp] : 0;
      const b = y > 0 ? plain[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? plain[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      filtered[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    [...type].forEach((ch, i) => (out[4 + i] = ch.charCodeAt(0)));
    out.set(body, 8);
    return out; // CRC left zero: the reader does not check it
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const z = new Uint8Array(deflateSync(filtered));
  // Split the stream over two IDAT chunks, as encoders do.
  const half = Math.floor(z.length / 2);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', z.subarray(0, half)),
    chunk('IDAT', z.subarray(half)),
    chunk('IEND', new Uint8Array()),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('readPngSamples', () => {
  it('reads 16-bit RGB back exactly, through every row filter', async () => {
    const w = 7;
    const h = 11;
    const samples = Array.from({ length: w * h * 3 }, (_, i) => (i * 7919 + 13) % 65536);
    const read = await readPngSamples(png(w, h, 2, 16, samples));
    expect(read).toMatchObject({ width: w, height: h, channels: 3, bitDepth: 16 });
    expect(Array.from(read.data)).toEqual(samples);
  });

  it('drops alpha and reads 8-bit RGBA', async () => {
    const samples = [10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0, 1, 2, 3, 4];
    const read = await readPngSamples(png(2, 2, 6, 8, samples));
    expect(read.channels).toBe(3);
    expect(Array.from(read.data)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 2, 3]);
  });

  it('reads 16-bit grey', async () => {
    const samples = [0, 65535, 1234, 40000, 7, 9];
    const read = await readPngSamples(png(3, 2, 0, 16, samples));
    expect(read.channels).toBe(1);
    expect(Array.from(read.data)).toEqual(samples);
  });

  it('refuses what is not a PNG', async () => {
    await expect(readPngSamples(new Uint8Array(40))).rejects.toThrow('not a PNG');
  });
});
