import { describe, expect, it } from 'vitest';
import { mergeExif } from './merge-exif';

describe('mergeExif', () => {
  it('returns null when neither side says anything', () => {
    expect(mergeExif(null, null)).toBeNull();
    expect(mergeExif(undefined, undefined)).toBeNull();
  });

  it('uses the source when the file was stripped', () => {
    expect(mergeExif(null, { iso: 100 })).toEqual({ iso: 100 });
  });

  it('uses the file when there is no source', () => {
    expect(mergeExif({ iso: 100 }, null)).toEqual({ iso: 100 });
  });

  it('lets the FILE win where both know — the bytes in hand are this file', () => {
    expect(mergeExif({ iso: 400 }, { iso: 100, fNumber: 2.8 })).toEqual({
      iso: 400,
      fNumber: 2.8,
    });
  });

  it('fills the gaps a re-encode left, keeping what the file still declares', () => {
    // A WebP proxy: it still knows how big it is, and nothing else.
    const proxy = { pixelWidth: 2048, pixelHeight: 1365 };
    const known = { iso: 100, exposureTime: 0.004, gps: { lat: 1, lon: 2 } };
    expect(mergeExif(proxy, known)).toEqual({
      pixelWidth: 2048,
      pixelHeight: 1365,
      iso: 100,
      exposureTime: 0.004,
      gps: { lat: 1, lon: 2 },
    });
  });

  it('does not let an explicitly-undefined field erase what the source knows', () => {
    expect(mergeExif({ iso: undefined }, { iso: 100 })).toEqual({ iso: 100 });
  });

  it('never mutates either side', () => {
    const file = { iso: 400 };
    const source = { fNumber: 2.8 };
    mergeExif(file, source);
    expect(file).toEqual({ iso: 400 });
    expect(source).toEqual({ fNumber: 2.8 });
  });
});
