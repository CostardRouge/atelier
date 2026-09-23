import { describe, expect, it } from 'vitest';
import { readIccProfile, srgbIcc, srgbProfile, withIccProfile } from './icc-srgb';
import { withExifBlock, withXmpPacket } from './exif-block';
import { buildExifBlock } from './exif-build';
import { parseExif } from './exif-parser';

const bare = () => new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);

function markers(jpeg: Uint8Array): number[] {
  const out: number[] = [];
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    out.push(jpeg[at + 1]);
    at += 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
  }
  return out;
}

describe('the sRGB profile', () => {
  it('is a well-formed ICC v4 display profile, the same bytes every time', () => {
    const p = srgbProfile();
    const view = new DataView(p.buffer);
    expect(view.getUint32(0)).toBe(p.length);
    const text = (at: number) => String.fromCharCode(...p.subarray(at, at + 4));
    expect([text(12), text(16), text(20), text(36)]).toEqual(['mntr', 'RGB ', 'XYZ ', 'acsp']);
    expect(view.getUint32(8)).toBe(0x04300000);
    // Ten tags, the three curves sharing one block.
    expect(view.getUint32(128)).toBe(10);
    const offsets = Array.from({ length: 10 }, (_, i) => view.getUint32(132 + i * 12 + 4));
    expect(new Set(offsets.slice(7)).size).toBe(1);
    expect(srgbProfile()).toEqual(p);
    expect(srgbIcc()).toBe(srgbIcc());
  });
});

describe('withIccProfile', () => {
  it('goes after the EXIF and the XMP, and is read back whole', () => {
    const tagged = withIccProfile(withXmpPacket(withExifBlock(bare(), buildExifBlock({ make: 'DJI' })), '<x/>'));
    expect(markers(tagged)).toEqual([0xe1, 0xe1, 0xe2, 0xdb]);
    expect(readIccProfile(tagged)).toEqual(srgbIcc());
    expect(parseExif(tagged.buffer).make).toBe('DJI');
  });

  it('replaces a profile rather than adding a second one, and leaves the scan alone', () => {
    const once = withIccProfile(bare(), new Uint8Array([1, 2, 3]));
    const twice = withIccProfile(once);
    expect(markers(twice).filter((m) => m === 0xe2)).toHaveLength(1);
    expect(readIccProfile(twice)).toEqual(srgbIcc());
    expect(Array.from(twice.subarray(twice.length - 7))).toEqual(Array.from(bare().subarray(bare().length - 7)));
  });

  it('finds nothing in an untagged file', () => {
    expect(readIccProfile(bare())).toBeNull();
  });
});
