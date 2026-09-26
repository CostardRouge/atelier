import { describe, expect, it } from 'vitest';
import { sniffStillFormat } from './still-format';

function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  const b = new Uint8Array(Math.max(size, 32));
  new DataView(b.buffer).setUint32(0, size);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  put(4, 'ftyp');
  put(8, major);
  compatible.forEach((c, i) => put(16 + i * 4, c));
  return b;
}

describe('sniffStillFormat', () => {
  it('reads a bare JPEG XL codestream and the container signature', () => {
    expect(sniffStillFormat(new Uint8Array([0xff, 0x0a, 0x7a, 0x3e]))).toBe('jxl');
    expect(
      sniffStillFormat(new Uint8Array([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0, 0, 0, 0x14])),
    ).toBe('jxl');
  });

  it('reads a HEIC as written by an iPhone or libheif', () => {
    // The head of a file libheif wrote: `ftyp heic`, compatible mif1 heic miaf.
    expect(sniffStillFormat(ftyp('heic', 'mif1', 'heic', 'miaf'))).toBe('heif');
    expect(sniffStillFormat(ftyp('mif1', 'mif1', 'heic'))).toBe('heif');
  });

  it("reads a Sony or Canon HIF, whose major brand may be the generic one", () => {
    expect(sniffStillFormat(ftyp('heix', 'mif1', 'heix'))).toBe('heif');
    expect(sniffStillFormat(ftyp('mif1', 'mif1', 'hevc', 'heix'))).toBe('heif');
  });

  it('leaves an AVIF to the browser, which decodes it itself', () => {
    expect(sniffStillFormat(ftyp('avif', 'mif1', 'avif', 'miaf'))).toBeNull();
    expect(sniffStillFormat(ftyp('mif1', 'mif1', 'miaf', 'avif'))).toBeNull();
  });

  it('answers null for a JPEG, a PNG, a video or too few bytes', () => {
    expect(sniffStillFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBeNull();
    expect(sniffStillFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(sniffStillFormat(ftyp('isom', 'isom', 'mp41'))).toBeNull();
    expect(sniffStillFormat(new Uint8Array([0xff]))).toBeNull();
  });
});
