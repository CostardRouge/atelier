import { describe, expect, it } from 'vitest';
import { QR_MAX_BYTES, encodeQr, qrFits, rsEncode } from './qr';

const dark = (m: NonNullable<ReturnType<typeof encodeQr>>, r: number, c: number) =>
  m.modules[r * m.size + c];

describe('rsEncode', () => {
  it('matches the standard’s worked example', () => {
    // ISO/IEC 18004's own 1-M example, "01234567" in numeric mode: the data
    // codewords below must produce exactly these ten error-correction bytes.
    // This is the one part of the encoder with a published expected answer,
    // so it is checked against the number rather than against itself.
    const data = Uint8Array.from([
      0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
      0xec, 0x11, 0xec, 0x11,
    ]);
    expect([...rsEncode(data, 10)]).toEqual([
      0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55,
    ]);
  });

  it('returns exactly the number of codewords asked for', () => {
    for (const n of [10, 16, 18, 22, 24, 26]) {
      expect(rsEncode(Uint8Array.from([1, 2, 3, 4]), n)).toHaveLength(n);
    }
  });

  it('is deterministic', () => {
    const data = Uint8Array.from([9, 8, 7, 6, 5]);
    expect([...rsEncode(data, 16)]).toEqual([...rsEncode(data, 16)]);
  });
});

describe('encodeQr — the frame', () => {
  const m = encodeQr('https://costardrouge.github.io/atelier/')!;

  it('sizes the matrix as 4·version + 17', () => {
    expect(m.size).toBe(m.version * 4 + 17);
    expect(m.modules).toHaveLength(m.size * m.size);
  });

  it('puts a finder eye in three corners and none in the fourth', () => {
    const eye = (r0: number, c0: number) =>
      dark(m, r0 + 0, c0 + 0) &&
      dark(m, r0 + 3, c0 + 3) &&
      !dark(m, r0 + 1, c0 + 1) &&
      dark(m, r0 + 6, c0 + 6);
    expect(eye(0, 0)).toBe(true);
    expect(eye(0, m.size - 7)).toBe(true);
    expect(eye(m.size - 7, 0)).toBe(true);
    // The bottom-right corner is data, and a fourth eye there would break
    // every decoder's orientation.
    expect(dark(m, m.size - 1, m.size - 1) && dark(m, m.size - 4, m.size - 4)).toBe(
      false,
    );
  });

  it('separates each finder with a quiet ring', () => {
    for (let i = 0; i <= 7; i++) {
      expect(dark(m, 7, i)).toBe(false);
      expect(dark(m, i, 7)).toBe(false);
    }
  });

  it('alternates the timing lines', () => {
    for (let i = 8; i < m.size - 8; i++) {
      expect(dark(m, 6, i)).toBe(i % 2 === 0);
      expect(dark(m, i, 6)).toBe(i % 2 === 0);
    }
  });

  it('always sets the dark module', () => {
    expect(dark(m, m.size - 8, 8)).toBe(true);
  });

  it('writes the format strip twice, saying the same thing', () => {
    // Copy 1 sits around the top-left finder, copy 2 splits between the other
    // two; a decoder reads whichever is legible, so they must agree.
    const one = [
      ...Array.from({ length: 6 }, (_, i) => dark(m, i, 8)),
      dark(m, 7, 8),
      dark(m, 8, 8),
      dark(m, 8, 7),
      ...Array.from({ length: 6 }, (_, k) => dark(m, 8, 14 - (9 + k))),
    ];
    const two = [
      ...Array.from({ length: 8 }, (_, i) => dark(m, 8, m.size - 1 - i)),
      ...Array.from({ length: 7 }, (_, k) => dark(m, m.size - 15 + (8 + k), 8)),
    ];
    expect(one).toEqual(two);
  });
});

describe('encodeQr — versions', () => {
  it('picks the smallest version that holds the payload', () => {
    expect(encodeQr('A')!.version).toBe(1);
    expect(encodeQr('x'.repeat(14))!.version).toBe(1);
    expect(encodeQr('x'.repeat(15))!.version).toBe(2);
    expect(encodeQr('x'.repeat(QR_MAX_BYTES))!.version).toBe(10);
  });

  it('counts UTF-8 BYTES, not characters', () => {
    // An em dash is three bytes; a version chosen on character count would
    // overflow and produce a code that decodes to nothing.
    expect(encodeQr('—'.repeat(5))!.version).toBe(encodeQr('x'.repeat(15))!.version);
  });

  it('draws alignment patterns from version 2 on', () => {
    const v2 = encodeQr('x'.repeat(15))!;
    // The centre of the one alignment pattern at (18,18).
    expect(dark(v2, 18, 18)).toBe(true);
    expect(dark(v2, 17, 18)).toBe(false);
  });

  it('refuses a payload no version holds, rather than truncating it', () => {
    // A QR that scans to half a URL is worse than no QR.
    expect(encodeQr('x'.repeat(QR_MAX_BYTES + 1))).toBeNull();
    expect(qrFits('x'.repeat(QR_MAX_BYTES))).toBe(true);
    expect(qrFits('x'.repeat(QR_MAX_BYTES + 1))).toBe(false);
  });

  it('has nothing to encode for an empty string', () => {
    expect(encodeQr('')).toBeNull();
  });
});

describe('encodeQr — the result is a real code', () => {
  it('is stable for the same input', () => {
    const a = encodeQr('https://example.com/a')!;
    const b = encodeQr('https://example.com/a')!;
    expect(a.modules).toEqual(b.modules);
  });

  it('differs for different input', () => {
    const a = encodeQr('https://example.com/a')!;
    const b = encodeQr('https://example.com/b')!;
    expect(a.modules).not.toEqual(b.modules);
  });

  it('keeps the dark share near half, which is what masking is for', () => {
    for (const text of [
      'A',
      'x'.repeat(60),
      'https://costardrouge.github.io/atelier/',
      '0'.repeat(200),
    ]) {
      const m = encodeQr(text)!;
      const share = m.modules.filter(Boolean).length / m.modules.length;
      expect(share).toBeGreaterThan(0.35);
      expect(share).toBeLessThan(0.65);
    }
  });
});
