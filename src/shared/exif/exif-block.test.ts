import { describe, expect, it } from 'vitest';
import { buildExifBlock } from './exif-build';
import { EXIF_BLOCK_MAX, readExifBlock, retagExifBlock, withExifBlock } from './exif-block';
import { parseExif } from './exif-parser';

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/** A JPEG with no metadata at all — what a canvas hands over. */
function bareJpeg(pixels = [0x01, 0x02, 0x03]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, ...pixels, 0xff, 0xd9]);
}

/** A JPEG opening on a JFIF `APP0`, the way Safari writes one. */
function jfifJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, 0xda, 0x00, 0x02, 0x11, 0x22,
    0xff, 0xd9,
  ]);
}

/** A JPEG that already carries an EXIF segment, to be replaced. */
function jpegWithExif(block: Uint8Array): Uint8Array {
  return withExifBlock(bareJpeg(), block);
}

/** Find an IFD0 entry's value slot, for the tests that need to forge one. */
function entrySlot(block: Uint8Array, tag: number): number | null {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const ifd0 = view.getUint32(4, true);
  const count = view.getUint16(ifd0, true);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (view.getUint16(entry, true) === tag) return entry + 8;
  }
  return null;
}

const sample = buildExifBlock({
  make: 'DJI',
  model: 'FC8482',
  iso: 100,
  gps: { lat: 64.1466, lon: -21.9426 },
  dateTimeOriginal: '2026:07:14 18:32:05',
});

describe('readExifBlock', () => {
  it('finds nothing in a canvas JPEG', () => {
    expect(readExifBlock(bareJpeg())).toBeNull();
    expect(readExifBlock(jfifJpeg())).toBeNull();
    expect(readExifBlock(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });

  it('gives back exactly the block that was put in', () => {
    const read = readExifBlock(jpegWithExif(sample));
    expect(read).not.toBeNull();
    expect([...read!]).toEqual([...sample]);
  });
});

describe('withExifBlock', () => {
  it('puts the segment right after the SOI and leaves the rest of the file alone', () => {
    const bare = bareJpeg();
    const out = withExifBlock(bare, sample);
    expect([...out.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...out.subarray(2, 4)]).toEqual([0xff, 0xe1]);
    // The length counts itself, the identifier and the block.
    expect([...out.subarray(4, 6)]).toEqual([(sample.length + 8) >> 8, (sample.length + 8) & 0xff]);
    expect([...out.subarray(6, 12)]).toEqual(EXIF_ID);
    expect([...out.subarray(2 + 10 + sample.length)]).toEqual([...bare.subarray(2)]);
  });

  it('goes AFTER a JFIF APP0, which the format keeps first', () => {
    const out = withExifBlock(jfifJpeg(), sample);
    expect([...out.subarray(2, 4)]).toEqual([0xff, 0xe0]);
    expect([...out.subarray(10, 12)]).toEqual([0xff, 0xe1]);
    expect(parseExif(out.slice().buffer).make).toBe('DJI');
  });

  it('replaces an EXIF segment rather than adding a second one', () => {
    const once = jpegWithExif(sample);
    const other = buildExifBlock({ make: 'Apple', model: 'iPhone 17 Pro' });
    const twice = withExifBlock(once, other);
    expect(parseExif(twice.slice().buffer).make).toBe('Apple');
    // One segment, so the file grew only by the difference between the blocks.
    expect(twice.length).toBe(once.length - sample.length + other.length);
  });

  it('is read back by the parser that reads a camera file', () => {
    const read = parseExif(jpegWithExif(sample).slice().buffer);
    expect(read.model).toBe('FC8482');
    expect(read.iso).toBe(100);
    expect(read.gps?.lat).toBeCloseTo(64.1466, 6);
    expect(read.dateTimeOriginal).toBe('2026:07:14 18:32:05');
  });

  it('refuses a block no segment could hold rather than writing an unreadable file', () => {
    expect(() => withExifBlock(bareJpeg(), new Uint8Array(EXIF_BLOCK_MAX + 1))).toThrow(/segment holds/);
    expect(() => withExifBlock(new Uint8Array([1, 2, 3]), sample)).toThrow(/not a JPEG/);
  });
});

describe('retagExifBlock', () => {
  it('resets an orientation the development has already applied', () => {
    const turned = sample.slice();
    const slot = entrySlot(turned, 0x0112);
    expect(slot).not.toBeNull();
    new DataView(turned.buffer).setUint16(slot!, 6, true);
    expect(parseExif(turned.buffer).orientation).toBe(6);
    expect(parseExif(retagExifBlock(turned).buffer).orientation).toBe(1);
  });

  it('corrects the dimensions to the ones delivered', () => {
    const block = buildExifBlock({ make: 'DJI', pixelWidth: 8064, pixelHeight: 6048 });
    const read = parseExif(retagExifBlock(block, { pixelWidth: 1920, pixelHeight: 1440 }).buffer);
    expect(read.pixelWidth).toBe(1920);
    expect(read.pixelHeight).toBe(1440);
    expect(read.make).toBe('DJI');
  });

  it('cuts the thumbnail’s directory loose', () => {
    const withThumb = sample.slice();
    const view = new DataView(withThumb.buffer);
    const ifd0 = view.getUint32(4, true);
    const next = ifd0 + 2 + view.getUint16(ifd0, true) * 12;
    view.setUint32(next, 4242, true);
    const out = retagExifBlock(withThumb);
    expect(new DataView(out.buffer).getUint32(next, true)).toBe(0);
  });

  it('gives a block it cannot read back unchanged', () => {
    const junk = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect([...retagExifBlock(junk)]).toEqual([...junk]);
    expect([...retagExifBlock(new Uint8Array(3))]).toEqual([0, 0, 0]);
  });

  it('does not touch what it was not asked about', () => {
    const read = parseExif(retagExifBlock(sample).buffer);
    expect(read.make).toBe('DJI');
    expect(read.gps?.lon).toBeCloseTo(-21.9426, 6);
    expect(read.dateTimeOriginal).toBe('2026:07:14 18:32:05');
  });
});
