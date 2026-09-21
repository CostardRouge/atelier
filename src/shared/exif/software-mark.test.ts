import { describe, expect, it } from 'vitest';
import { buildExifBlock } from './exif-build';
import { parseExif } from './exif-parser';
import { ATELIER_SOFTWARE, isAtelierMade } from './software-mark';

describe('isAtelierMade', () => {
  it('recognises the mark, and a later version of it', () => {
    expect(isAtelierMade(ATELIER_SOFTWARE)).toBe(true);
    expect(isAtelierMade('Atelier 2')).toBe(true);
    expect(isAtelierMade('  Atelier\u0000')).toBe(true);
  });

  it('never takes a camera’s or another editor’s software for ours', () => {
    expect(isAtelierMade('ILCE-7CM2 v1.00')).toBe(false);
    expect(isAtelierMade('v01.00.0800')).toBe(false);
    expect(isAtelierMade('Capture One 24 Macintosh')).toBe(false);
    expect(isAtelierMade('Ateliers Photo')).toBe(false);
    expect(isAtelierMade('')).toBe(false);
    expect(isAtelierMade(null)).toBe(false);
    expect(isAtelierMade(undefined)).toBe(false);
  });

  it('reads back through the block writer, the way a delivered file is read', () => {
    const block = buildExifBlock({ make: 'DJI' }, { software: ATELIER_SOFTWARE });
    expect(isAtelierMade(parseExif(block.buffer).software)).toBe(true);
    expect(isAtelierMade(parseExif(buildExifBlock({ make: 'DJI', software: 'v1' }).buffer).software)).toBe(false);
  });
});
