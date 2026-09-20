import { describe, expect, it } from 'vitest';
import { parseCube, type CubeLut } from '../lib/cube-parser';
import { decodeLattice, encodeLattice, encodedBytes, sha256Hex } from './pack-codec';

function makeLut(
  size: number,
  fn: (r: number, g: number, b: number) => [number, number, number],
  domainMin: [number, number, number] = [0, 0, 0],
  domainMax: [number, number, number] = [1, 1, 1],
): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  for (let bi = 0; bi < size; bi += 1)
    for (let gi = 0; gi < size; gi += 1)
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = fn(ri / last, gi / last, bi / last);
        const o = (ri + gi * size + bi * size * size) * 3;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      }
  return { size, data, domainMin, domainMax };
}

function maxError(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('encodeLattice / decodeLattice', () => {
  it('round-trips a lattice inside one 16-bit step', () => {
    const lut = makeLut(17, (r, g, b) => [r ** 2.2, g * 0.8 + 0.1, Math.sqrt(b)]);
    const back = decodeLattice(encodeLattice(lut))!;
    expect(back.size).toBe(17);
    // The range is [0,1], so a step is 1/65535 — the rounding is half of it.
    expect(maxError(lut.data, back.data)).toBeLessThanOrEqual(0.5 / 65535);
  });

  it('is far finer than the 8-bit picture it ends up in', () => {
    const lut = makeLut(33, (r, g, b) => [r, g, b]);
    const back = decodeLattice(encodeLattice(lut))!;
    expect(maxError(lut.data, back.data)).toBeLessThan(1 / 255 / 100);
  });

  it('keeps highlights that run past 1, like the shipped DJI cube', () => {
    const lut = makeLut(9, (r, g, b) => [r * 1.4, g, b - 0.05]);
    const back = decodeLattice(encodeLattice(lut))!;
    expect(Math.max(...back.data)).toBeGreaterThan(1.39);
    expect(Math.min(...back.data)).toBeLessThan(0);
    expect(maxError(lut.data, back.data)).toBeLessThanOrEqual(0.5 * (1.45 / 65535));
  });

  it('reproduces the extremes exactly', () => {
    const lut = makeLut(5, (r, g, b) => [r, g, b]);
    const back = decodeLattice(encodeLattice(lut))!;
    expect(back.data[0]).toBe(0);
    expect(back.data[back.data.length - 1]).toBe(1);
  });

  it('keeps a lattice whose samples are all the same', () => {
    const lut = makeLut(3, () => [0.5, 0.5, 0.5]);
    const back = decodeLattice(encodeLattice(lut))!;
    expect(maxError(lut.data, back.data)).toBe(0);
  });

  it('carries the domain, which the shader reads', () => {
    const lut = makeLut(5, (r, g, b) => [r, g, b], [0, 0, 0], [2, 2, 2]);
    const back = decodeLattice(encodeLattice(lut))!;
    expect(back.domainMin).toEqual([0, 0, 0]);
    expect(back.domainMax).toEqual([2, 2, 2]);
  });

  it('takes the title from the caller, never from the bytes', () => {
    const lut = makeLut(3, (r, g, b) => [r, g, b]);
    expect(decodeLattice(encodeLattice(lut))!.title).toBeUndefined();
    expect(decodeLattice(encodeLattice(lut), 'D-Log')!.title).toBe('D-Log');
  });

  it('is a quarter of the text it replaces', () => {
    // The pack's own numbers: a 65³ `.cube` is 3.6–6.9 MB of text.
    expect(encodedBytes(65)).toBe(40 + 65 ** 3 * 3 * 2);
    expect(encodedBytes(65)).toBeLessThan(1.7 * 1024 * 1024);
    expect(encodedBytes(33)).toBeLessThan(220 * 1024);
  });

  it('refuses what it cannot read rather than grading wrongly', () => {
    const good = encodeLattice(makeLut(3, (r, g, b) => [r, g, b]));
    expect(decodeLattice(new Uint8Array(10))).toBeNull();
    expect(decodeLattice(good.slice(0, good.length - 2))).toBeNull();

    const foreign = good.slice();
    foreign[0] = 0x42;
    expect(decodeLattice(foreign)).toBeNull();

    const future = good.slice();
    future[4] = 9;
    expect(decodeLattice(future)).toBeNull();
  });

  it('refuses a lattice it cannot hold', () => {
    const broken: CubeLut = {
      size: 4,
      data: new Float32Array(3),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    };
    expect(() => encodeLattice(broken)).toThrow(/size³/);
    expect(() => encodeLattice({ ...broken, size: 1 })).toThrow(/not one this format can hold/);
  });

  it('reads from a view into a larger buffer', () => {
    const lut = makeLut(5, (r, g, b) => [r, g, b]);
    const encoded = encodeLattice(lut);
    // A fetched body sliced at an odd offset: the samples are no longer
    // 2-byte aligned, which a Uint16Array over the same memory would refuse.
    const padded = new Uint8Array(encoded.length + 1);
    padded.set(encoded, 1);
    const back = decodeLattice(padded.subarray(1))!;
    expect(maxError(lut.data, back.data)).toBeLessThanOrEqual(0.5 / 65535);
  });

  it('takes a real .cube through the parser and back', () => {
    const text = [
      'TITLE "tiny"',
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 1 1 1',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\n');
    const parsed = parseCube(text)!;
    const back = decodeLattice(encodeLattice(parsed), parsed.title)!;
    expect(back.title).toBe('tiny');
    expect([...back.data]).toEqual([...parsed.data]);
  });
});

describe('sha256Hex', () => {
  it('answers the known digest of an empty input', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes the view, not the buffer it sits in', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const alone = new Uint8Array([3, 4]);
    expect(await sha256Hex(body.subarray(2, 4))).toBe(await sha256Hex(alone));
  });

  it('separates two files that differ by one byte', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
  });
});
