import { describe, expect, it } from 'vitest';
import { registerMediaIdentity } from '../projects/media-identity';
import type { ExifData } from './exif-parser';
import { readEffectiveExif, vouchedExif } from './read-exif';

/**
 * A source's editing rendition: bytes that carry no EXIF of their own. Which
 * half wins when BOTH accounts hold a field is `merge-exif.test.ts`'s subject
 * — here the question is only that the source's account is consulted at all,
 * and that a panel can be told where it came from.
 */
function proxy(name: string): File {
  return new File([new Uint8Array(64)], name, { type: 'image/webp' });
}

function vouch(file: File, exif: ExifData): void {
  registerMediaIdentity(file, {
    assetId: 'winnow.example/42',
    origin: {
      sourceId: 'winnow.example',
      fidelity: 'proxy',
      width: 4000,
      height: 3000,
      exif,
    },
  });
}

describe('vouchedExif', () => {
  it('is null for a file nobody handed over', () => {
    expect(vouchedExif(proxy('alone.webp'))).toBeNull();
  });

  it('is null when the source vouched for nothing readable', () => {
    const file = proxy('empty-vouch.webp');
    vouch(file, {});
    expect(vouchedExif(file)).toBeNull();
  });

  it('names the instance that vouched', () => {
    const file = proxy('vouched.webp');
    vouch(file, { iso: 100 });
    expect(vouchedExif(file)).toEqual({ exif: { iso: 100 }, via: 'winnow.example' });
  });
});

describe('readEffectiveExif', () => {
  it('reads what the source knows when the bytes carry nothing', async () => {
    const file = proxy('DJI_0042.webp');
    vouch(file, { iso: 100, dateTimeOriginal: '2025:11:17 23:30:00' });
    const read = await readEffectiveExif(file);
    expect(read.exif.iso).toBe(100);
    expect(read.exif.dateTimeOriginal).toBe('2025:11:17 23:30:00');
    expect(read.via).toBe('winnow.example');
    // And the bytes themselves said nothing: the panel must be able to say so.
    expect(read.file).toEqual({});
  });

  it('is empty, and vouched by nobody, for a file the user opened themselves', async () => {
    const read = await readEffectiveExif(proxy('IMG_1234.webp'));
    expect(read.exif).toEqual({});
    expect(read.via).toBeNull();
  });
});
