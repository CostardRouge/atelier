import { describe, expect, it } from 'vitest';
import { ALL_META, META_GROUPS, META_PRESETS, filterExif, keepsCapture, keepsWholeBlock, presetOf, readMetaChoice } from './meta-groups';

describe('the metadata choice', () => {
  it('reads an older roll as All, and anything but a stored false as kept', () => {
    expect(readMetaChoice(undefined)).toEqual(ALL_META);
    expect(readMetaChoice({ position: false, camera: 'no' })).toEqual({ ...ALL_META, position: false });
  });

  it('names its preset, or none for a combination of its own', () => {
    for (const p of META_PRESETS) expect(presetOf({ ...p.choice })).toBe(p.id);
    expect(presetOf({ ...ALL_META, exposure: false })).toBeNull();
  });

  it('keeps the block whole only while every capture group and the maker notes stay', () => {
    expect(keepsWholeBlock(ALL_META)).toBe(true);
    expect(keepsWholeBlock({ ...ALL_META, rights: false, words: false })).toBe(true);
    for (const g of ['camera', 'exposure', 'time', 'position', 'makerNotes'] as const) {
      expect(keepsWholeBlock({ ...ALL_META, [g]: false })).toBe(false);
    }
    expect(keepsCapture(META_PRESETS.find((p) => p.id === 'minimal')!.choice)).toBe(false);
  });

  it('drops exactly the groups left out, and never what describes the file', () => {
    const exif = { make: 'DJI', iso: 100, dateTimeOriginal: 'x', gps: { lat: 1, lon: 2 }, relativeAltitude: 50, software: 'S', pixelWidth: 10, artist: 'A' };
    expect(filterExif(exif, { ...ALL_META, position: false })).toEqual({ make: 'DJI', iso: 100, dateTimeOriginal: 'x', software: 'S', pixelWidth: 10, artist: 'A' });
    expect(filterExif(exif, META_PRESETS.find((p) => p.id === 'minimal')!.choice)).toEqual({ software: 'S', pixelWidth: 10, artist: 'A' });
    expect(META_GROUPS.map((g) => g.id)).toEqual(Object.keys(ALL_META));
  });
});
