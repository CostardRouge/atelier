import { describe, expect, it } from 'vitest';
import {
  dedupeNames,
  numberedName,
  splitName,
  uniqueName,
  uniqueNameAsync,
  UNIQUE_NAME_LIMIT,
} from './unique-name';

describe('splitName', () => {
  it('splits on the LAST dot and keeps a leading one in the base', () => {
    expect(splitName('DJI_0101.jpg')).toEqual({ base: 'DJI_0101', ext: '.jpg' });
    expect(splitName('a.b.jpg')).toEqual({ base: 'a.b', ext: '.jpg' });
    expect(splitName('README')).toEqual({ base: 'README', ext: '' });
    expect(splitName('.gitignore')).toEqual({ base: '.gitignore', ext: '' });
  });
});

describe('numberedName', () => {
  it('numbers before the extension', () => {
    expect(numberedName('DJI_0101.jpg', 1)).toBe('DJI_0101-1.jpg');
    expect(numberedName('DJI_0101.jpg', 12)).toBe('DJI_0101-12.jpg');
    expect(numberedName('README', 2)).toBe('README-2');
    expect(numberedName('DJI_0101.jpg', 0)).toBe('DJI_0101.jpg');
  });
});

describe('uniqueName', () => {
  it('gives the name back when nothing has it', () => {
    expect(uniqueName('DJI_0101.jpg', () => false)).toBe('DJI_0101.jpg');
  });

  it('walks up to the first free number', () => {
    const held = new Set(['dji_0101.jpg', 'dji_0101-1.jpg']);
    expect(uniqueName('DJI_0101.jpg', (c) => held.has(c.toLowerCase()))).toBe('DJI_0101-2.jpg');
  });

  it('gives up rather than looping when everything is taken', () => {
    expect(() => uniqueName('x.jpg', () => true)).toThrow(String(UNIQUE_NAME_LIMIT));
  });
});

describe('uniqueNameAsync', () => {
  it('answers like its sync twin when the question has to be asked of the disk', async () => {
    const held = new Set(['dji_0101.jpg', 'dji_0101-1.jpg']);
    const taken = (c: string) => Promise.resolve(held.has(c.toLowerCase()));
    await expect(uniqueNameAsync('DJI_0101.jpg', taken)).resolves.toBe('DJI_0101-2.jpg');
    await expect(uniqueNameAsync('other.jpg', taken)).resolves.toBe('other.jpg');
    await expect(uniqueNameAsync('x.jpg', () => Promise.resolve(true))).rejects.toThrow(String(UNIQUE_NAME_LIMIT));
  });
});

describe('dedupeNames', () => {
  it('numbers the repeats and leaves the first plain', () => {
    expect(dedupeNames(['a.jpg', 'b.jpg', 'a.jpg', 'a.jpg'])).toEqual(['a.jpg', 'b.jpg', 'a-1.jpg', 'a-2.jpg']);
  });

  it('reads two spellings of one name as the same, like the volume will', () => {
    expect(dedupeNames(['A.jpg', 'a.JPG'])).toEqual(['A.jpg', 'a-1.JPG']);
  });

  it('does not collide with a numbered name the caller already asked for', () => {
    expect(dedupeNames(['a.jpg', 'a-1.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a-1.jpg', 'a-2.jpg']);
  });
});
