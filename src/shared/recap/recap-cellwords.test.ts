import { describe, expect, it } from 'vitest';
import type { RecapPicture } from './recap-doc';
import { arrangeBits, exifBits, fitText, readExifParts } from './recap-cellwords';

// A monospace measure: 10 px a character.
const mono = (s: string) => s.length * 10;
const pic: RecapPicture = { key: 'k', origin: 'local', name: 'a.jpg', kind: 'photo', day: null, device: 'ILCE-7M4', lens: 'FE 35mm F1.8', focal: 35, fNumber: 1.8, shutter: '1/250', iso: 100 };

describe('a cell’s camera words', () => {
  it('says the settings chosen, in their own order', () => {
    expect(exifBits(pic, ['iso', 'device'], () => 'Sony')).toEqual(['Sony', 'ISO 100']);
    expect(exifBits(pic, ['lens', 'aperture'])).toEqual(['FE 35mm F1.8', 'f/1.8']);
    expect(readExifParts(['iso', 'nope', 'device', 'iso'])).toEqual(['device', 'iso']);
    expect(readExifParts('iso')).toBeNull();
  });

  it('packs into lines that fit, stacks in a tall cell, holds one line when asked', () => {
    const bits = ['Sony', '35 mm', 'f/1.8', '1/250', 'ISO 100'];
    expect(arrangeBits(bits, 'auto', 140, mono, false)).toEqual(['Sony · 35 mm', 'f/1.8 · 1/250', 'ISO 100']);
    expect(arrangeBits(bits, 'auto', 140, mono, true)).toEqual(bits);
    expect(arrangeBits(bits, 'line', 140, mono, false)).toEqual(['Sony · 35 mm · f/1.8 · 1/250 · ISO 100']);
    expect(arrangeBits(bits, 'stack', 999, mono, false, 2)).toEqual(['Sony', '35 mm']);
  });

  it('never runs past the cell: shrinks a little, then cuts', () => {
    expect(fitText('abcdef', 60, mono)).toEqual({ text: 'abcdef', scale: 1 });
    expect(fitText('abcdefgh', 70, mono).scale).toBeCloseTo(0.875);
    const cut = fitText('abcdefghijklmnopqrst', 60, mono);
    expect(cut.text.endsWith('…')).toBe(true);
    expect(mono(cut.text) * cut.scale).toBeLessThanOrEqual(60);
  });
});
