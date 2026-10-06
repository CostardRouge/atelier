import { describe, expect, it } from 'vitest';
import { chromaWords, jpegChroma } from './jpeg-chroma';

/** A JPEG head: SOI, an APP0 of `app` bytes, a frame header with these (h, v) factors, then a scan. */
function head(factors: [number, number][], { marker = 0xc0, app = 14, fill = false } = {}): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  out.push(0xff, 0xe0, 0, app + 2, ...new Array<number>(app).fill(0x4a));
  if (fill) out.push(0xff);
  const sof = [8, 0, 16, 0, 16, factors.length];
  factors.forEach(([h, v], k) => sof.push(k + 1, (h << 4) | v, k === 0 ? 0 : 1));
  out.push(0xff, marker, 0, sof.length + 2, ...sof);
  out.push(0xff, 0xda, 0, 2);
  return new Uint8Array(out);
}

describe('jpegChroma', () => {
  it('reads the four samplings a camera or a browser writes', () => {
    expect(jpegChroma(head([[1, 1], [1, 1], [1, 1]]))).toBe('4:4:4');
    expect(jpegChroma(head([[2, 1], [1, 1], [1, 1]]))).toBe('4:2:2');
    expect(jpegChroma(head([[2, 2], [1, 1], [1, 1]]))).toBe('4:2:0');
    expect(jpegChroma(head([[1, 2], [1, 1], [1, 1]]))).toBe('4:4:0');
    expect(jpegChroma(head([[4, 1], [1, 1], [1, 1]]))).toBe('4:1:1');
  });

  it('reads a progressive frame, a grey one, and skips fill bytes', () => {
    expect(jpegChroma(head([[2, 2], [1, 1], [1, 1]], { marker: 0xc2 }))).toBe('4:2:0');
    expect(jpegChroma(head([[1, 1]]))).toBe('grey');
    expect(jpegChroma(head([[1, 1], [1, 1], [1, 1]], { fill: true }))).toBe('4:4:4');
  });

  it('reads the ratio, not the numbers: (2,2) chroma under (2,2) luma is full colour', () => {
    expect(jpegChroma(head([[2, 2], [2, 2], [2, 2]]))).toBe('4:4:4');
  });

  it('says other when the two colour planes disagree', () => {
    expect(jpegChroma(head([[2, 2], [1, 1], [2, 1]]))).toBe('other');
  });

  it('is null for what is not a JPEG, or a scan with no frame before it', () => {
    expect(jpegChroma(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegChroma(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(jpegChroma(head([[1, 1], [1, 1], [1, 1]]).slice(0, 24))).toBeNull();
  });

  it('says it in words', () => {
    expect(chromaWords('4:4:4')).toBe('full colour');
    expect(chromaWords('4:2:0')).toBe('a quarter of the colour');
  });
});
