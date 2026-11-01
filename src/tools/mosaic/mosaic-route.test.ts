import { describe, expect, it } from 'vitest';
import { MOSAIC_HOME, mosaicFromRef, mosaicPath, mosaicRef, parseMosaicPath } from './mosaic-route';

describe('mosaic routes', () => {
  const doc = { id: '0123abcd-ef00-4000-8000-000000000000', title: 'Sydney 2025' };

  it('makes a readable reference and finds the mosaic back from it', () => {
    const ref = mosaicRef(doc);
    expect(ref).toMatch(/^sydney-2025-[0-9a-f]{8}$/);
    expect(mosaicFromRef(ref, [{ id: 'other' }, doc])).toBe(doc);
    expect(mosaicFromRef('sydney-renamed-0123abcd', [doc])).toBe(doc);
  });

  it('parses the gallery, a mosaic and nothing else', () => {
    expect(parseMosaicPath('/mosaic')).toBeNull();
    expect(parseMosaicPath('/mosaic/home')).toBeNull();
    expect(parseMosaicPath('/mosaic/sydney-2025-0123abcd?x=1')).toBe('sydney-2025-0123abcd');
    expect(parseMosaicPath('/atlas/sydney')).toBeNull();
    expect(mosaicPath(null)).toBe(MOSAIC_HOME);
    expect(mosaicPath('a b')).toBe('/mosaic/a%20b');
    expect(parseMosaicPath(mosaicPath('a b'))).toBe('a b');
  });
});
