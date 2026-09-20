import { describe, expect, it } from 'vitest';
import type { GainMapMeta } from './gain-map';
import {
  MPF_SEGMENT_LENGTH,
  gainMapXmp,
  isJpeg,
  jpegSegments,
  makeSegment,
  mpfSegment,
  parseGainMapMeta,
  parseMpf,
  primaryXmp,
  readUltraHdr,
  wrapUltraHdr,
} from './ultra-hdr';

/** A JPEG-shaped byte stream: SOI, a JFIF APP0, a quantisation table, a scan, EOI. */
function fakeJpeg(scanBytes: number, seed = 1): Uint8Array {
  const app0 = makeSegment(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  const dqt = makeSegment(0xdb, new Uint8Array(65).fill(seed));
  const sos = makeSegment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0]));
  const scan = new Uint8Array(scanBytes);
  for (let i = 0; i < scanBytes; i += 1) scan[i] = (i * seed) & 0x7f; // never 0xFF
  const out = new Uint8Array(2 + app0.length + dqt.length + sos.length + scanBytes + 2);
  let at = 0;
  out.set([0xff, 0xd8], at);
  at += 2;
  for (const part of [app0, dqt, sos, scan]) {
    out.set(part, at);
    at += part.length;
  }
  out.set([0xff, 0xd9], at);
  return out;
}

const meta: GainMapMeta = {
  gainMapMin: 0,
  gainMapMax: 2.25,
  gamma: 1,
  offsetSdr: 1 / 64,
  offsetHdr: 1 / 64,
  hdrCapacityMin: 0,
  hdrCapacityMax: 2.25,
};

describe('jpegSegments', () => {
  it('walks the markers up to the scan and refuses what is not a JPEG', () => {
    const segs = jpegSegments(fakeJpeg(40))!;
    expect(segs.map((s) => s.marker)).toEqual([0xe0, 0xdb]);
    expect(segs[0].start).toBe(2);
    expect(segs[1].start).toBe(2 + segs[0].length);
    expect(jpegSegments(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(isJpeg(fakeJpeg(4))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe('the XMP packets', () => {
  it('name the two items and carry the numbers back out', () => {
    const primary = primaryXmp(1234);
    expect(primary).toContain('Item:Semantic="Primary"');
    expect(primary).toContain('Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="1234"');
    expect(primary).toContain('hdrgm:Version="1.0"');
    const map = gainMapXmp(meta);
    expect(map).toContain('hdrgm:GainMapMax="2.25"');
    expect(map).toContain('hdrgm:OffsetSDR="0.015625"');
    expect(parseGainMapMeta(map)).toEqual(meta);
    expect(parseGainMapMeta('<x/>')).toBeNull();
  });
});

describe('mpfSegment', () => {
  it('is a fixed-size big-endian TIFF whose second entry says where the gain map is', () => {
    const seg = mpfSegment(5000, 700, 4990);
    expect(seg.length).toBe(MPF_SEGMENT_LENGTH);
    expect(seg[0]).toBe(0xff);
    expect(seg[1]).toBe(0xe2);
    const parsed = parseMpf(seg.subarray(4));
    expect(parsed).toEqual({ size: 700, offset: 4990, headerAt: 4 });
    expect(parseMpf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
  });
});

describe('wrapUltraHdr / readUltraHdr', () => {
  it('writes a file every decoder reads as the base, and reads the gain map back by its MPF entry', () => {
    const base = fakeJpeg(300, 3);
    const map = fakeJpeg(50, 5);
    const file = wrapUltraHdr(base, map, meta);
    // Starts like the base, and the base's own segments are still in order.
    expect(isJpeg(file)).toBe(true);
    const segs = jpegSegments(file)!;
    expect(segs.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xe2, 0xdb]);
    const parts = readUltraHdr(file)!;
    expect(parts).not.toBeNull();
    expect(parts.foundBy).toBe('mpf');
    expect(parts.meta).toEqual(meta);
    // The gain map is the given one with its XMP inserted after the JFIF.
    const mapSegs = jpegSegments(parts.gainMap)!;
    expect(mapSegs.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xdb]);
    expect(parts.gainMap[parts.gainMap.length - 1]).toBe(0xd9);
    expect(parts.gainMap.length + parts.primary.length).toBe(file.length);
    // The base ends at its own EOI, and the scan bytes are untouched.
    expect(parts.primary[parts.primary.length - 1]).toBe(0xd9);
    expect(parts.primary.length).toBe(base.length + segs[1].length + MPF_SEGMENT_LENGTH);
    expect(Array.from(parts.primary.subarray(parts.primary.length - 12))).toEqual(Array.from(base.subarray(base.length - 12)));
    // The directory's Length is the gain map's real length.
    expect(new TextDecoder().decode(segs[1].data)).toContain(`Item:Length="${parts.gainMap.length}"`);
  });

  it('falls back to the directory Length when the MPF segment is gone, and refuses a plain JPEG', () => {
    const base = fakeJpeg(120, 2);
    const map = fakeJpeg(30, 4);
    const file = wrapUltraHdr(base, map, meta);
    // Strip the MPF segment (a re-save by a tool that drops APP2 would).
    const segs = jpegSegments(file)!;
    const mpf = segs.find((s) => s.marker === 0xe2)!;
    const stripped = new Uint8Array(file.length - mpf.length);
    stripped.set(file.subarray(0, mpf.start), 0);
    stripped.set(file.subarray(mpf.start + mpf.length), mpf.start);
    const parts = readUltraHdr(stripped)!;
    expect(parts.foundBy).toBe('length');
    expect(parts.meta.gainMapMax).toBe(2.25);
    expect(parts.gainMap[0]).toBe(0xff);
    expect(readUltraHdr(base)).toBeNull();
    expect(readUltraHdr(new Uint8Array([0, 1]))).toBeNull();
  });
});
