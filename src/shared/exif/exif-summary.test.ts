import { describe, expect, it } from 'vitest';
import { cameraName, exposureSummary } from './exif-summary';

describe('cameraName', () => {
  it('does not repeat a maker the model already carries', () => {
    expect(cameraName({ make: 'DJI', model: 'DJI Mini 4 Pro' })).toBe('DJI Mini 4 Pro');
    expect(cameraName({ make: 'SONY', model: 'ILCE-7M4' })).toBe('SONY ILCE-7M4');
  });

  it('answers with whichever half exists, or nothing', () => {
    expect(cameraName({ model: 'X100V' })).toBe('X100V');
    expect(cameraName({ make: 'FUJIFILM' })).toBe('FUJIFILM');
    expect(cameraName({})).toBeUndefined();
  });
});

describe('exposureSummary', () => {
  it('reads body, lens, focal length, aperture, shutter and ISO', () => {
    expect(
      exposureSummary({
        make: 'SONY',
        model: 'ILCE-7M4',
        lensModel: 'FE 24-70mm F2.8 GM II',
        focalLength: 35,
        fNumber: 2.8,
        exposureTime: 1 / 250,
        iso: 400,
      }),
    ).toBe('SONY ILCE-7M4 · FE 24-70mm F2.8 GM II · 35 mm · ƒ/2.8 · 1/250 · ISO 400');
  });

  it('leaves out what the picture does not say', () => {
    expect(exposureSummary({ iso: 100 })).toBe('ISO 100');
    expect(exposureSummary({})).toBe('');
    expect(exposureSummary(null)).toBe('');
  });

  it('prefers the label the source keeps over the EXIF model', () => {
    expect(exposureSummary({ model: 'FC8482', iso: 100 }, 'DJI Mini 4 Pro')).toBe(
      'DJI Mini 4 Pro · ISO 100',
    );
    // …and still answers with it when there is no EXIF at all.
    expect(exposureSummary(null, 'DJI Mini 4 Pro')).toBe('DJI Mini 4 Pro');
  });

  it('drops a lens that only repeats the body', () => {
    expect(exposureSummary({ model: 'X100V', lensModel: 'X100V' })).toBe('X100V');
  });

  it('trims trailing zeros and refuses a nonsense reading', () => {
    expect(exposureSummary({ focalLength: 24.0, fNumber: 1.7 })).toBe('24 mm · ƒ/1.7');
    expect(exposureSummary({ focalLength: 0, fNumber: -1, iso: 0, exposureTime: 0 })).toBe('');
  });

  it('says a long exposure in seconds and a short one as a fraction', () => {
    expect(exposureSummary({ exposureTime: 2.5 })).toBe('2.5s');
    expect(exposureSummary({ exposureTime: 1 / 240 })).toBe('1/240');
  });
});
