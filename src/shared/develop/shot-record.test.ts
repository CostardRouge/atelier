import { describe, expect, it } from 'vitest';
import { readShotRecord, shotExifOf, shotsPref } from './shot-record';

describe('shotExifOf', () => {
  it('keeps the camera and the exposure, never the place or the words', () => {
    const out = shotExifOf({
      make: 'SONY',
      model: 'ILCE-7CM2',
      lensModel: 'FE 35mm F1.8',
      iso: 640.4,
      exposureTime: 1 / 250,
      fNumber: 2.8,
      focalLength: 35,
      focalLength35: 35,
      exposureBias: -0.3,
      whiteBalance: 0,
      dateTimeOriginal: '2026:02:14 07:12:03',
      gps: { lat: -33.8, lon: 151.2 },
      gpsAltitude: 12,
      artist: 'S.',
      imageDescription: 'a caption',
      copyright: '©',
    });
    expect(out).toEqual({
      make: 'SONY',
      model: 'ILCE-7CM2',
      lens: 'FE 35mm F1.8',
      iso: 640,
      exposureTime: 1 / 250,
      fNumber: 2.8,
      focalLength: 35,
      focalLength35: 35,
      exposureBias: -0.3,
      whiteBalance: 0,
      dateTimeOriginal: '2026:02:14 07:12:03',
    });
    expect(out).not.toHaveProperty('gps');
    expect(out).not.toHaveProperty('artist');
  });

  it('falls back from the lens model to its maker, and drops blank and junk fields', () => {
    expect(shotExifOf({ lensMake: ' Sigma ', iso: 0, fNumber: NaN, model: '  ' })).toEqual({ lens: 'Sigma' });
  });

  it('is null when the file said nothing', () => {
    expect(shotExifOf(null)).toBeNull();
    expect(shotExifOf({})).toBeNull();
    expect(shotExifOf({ iso: -1, make: '' })).toBeNull();
  });
});

describe('readShotRecord', () => {
  const stats = { bins: [1, 2, 3], total: 6, linearMean: [0.2, 0.3, 0.4], counted: 6 };

  it('reads a stored record back, defaulting what a junk value left', () => {
    const vignette = new Blob(['x'], { type: 'image/jpeg' });
    const rec = readShotRecord({
      id: 'p1',
      rollId: 'r1',
      vignette,
      aspect: -2,
      natural: { width: 6000, height: 4000 },
      stats: { ...stats, bins: [1, 'x', 3], counted: 'no' },
      exif: { iso: 100 },
      viaRawPreview: 'yes',
      updatedAt: 5,
    });
    expect(rec).toMatchObject({
      id: 'p1',
      rollId: 'r1',
      aspect: 1,
      natural: { width: 6000, height: 4000 },
      stats: { bins: [1, 0, 3], total: 6, linearMean: [0.2, 0.3, 0.4], counted: 0 },
      exif: { iso: 100 },
      viaRawPreview: false,
      updatedAt: 5,
    });
    expect(rec?.vignette).toBe(vignette);
  });

  it('refuses a record with no vignette, no stats or no ids', () => {
    expect(readShotRecord(null)).toBeNull();
    expect(readShotRecord({ id: 'p', rollId: 'r', stats })).toBeNull();
    expect(readShotRecord({ id: 'p', rollId: 'r', vignette: new Blob(['x']) })).toBeNull();
    expect(readShotRecord({ id: 'p', vignette: new Blob(['x']), stats })).toBeNull();
  });
});

describe('shotsPref', () => {
  it('is on unless the device said no', () => {
    expect(shotsPref.get()).toBe(true);
    shotsPref.set(false);
    expect(shotsPref.get()).toBe(false);
    shotsPref.set(true);
    expect(shotsPref.get()).toBe(true);
  });
});
