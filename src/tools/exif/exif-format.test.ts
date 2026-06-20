import { describe, expect, it } from 'vitest';
import {
  cameraLine,
  exposureLine,
  flashLabel,
  formatAltitude,
  formatAperture,
  formatCoord,
  formatExposureBias,
  formatFocal,
  formatIso,
  formatShutter,
  mapsUrl,
  orientationLabel,
} from './exif-format';

describe('formatShutter', () => {
  it('renders sub-second as a fraction', () => {
    expect(formatShutter(0.005)).toBe('1/200 s');
    expect(formatShutter(0.5)).toBe('1/2 s');
  });

  it('renders whole/long exposures in seconds', () => {
    expect(formatShutter(2)).toBe('2 s');
    expect(formatShutter(1.3)).toBe('1.3 s');
  });

  it('returns undefined for missing/invalid input', () => {
    expect(formatShutter(undefined)).toBeUndefined();
    expect(formatShutter(0)).toBeUndefined();
    expect(formatShutter(-1)).toBeUndefined();
  });
});

describe('formatAperture / formatFocal / formatIso', () => {
  it('formats with the right unit, trimming trailing zeros', () => {
    expect(formatAperture(2.8)).toBe('f/2.8');
    expect(formatAperture(8)).toBe('f/8');
    expect(formatFocal(24)).toBe('24 mm');
    expect(formatFocal(35.5)).toBe('35.5 mm');
    expect(formatIso(400)).toBe('ISO 400');
  });

  it('returns undefined for missing values', () => {
    expect(formatAperture(undefined)).toBeUndefined();
    expect(formatFocal(0)).toBeUndefined();
    expect(formatIso(undefined)).toBeUndefined();
  });
});

describe('formatExposureBias', () => {
  it('is always signed', () => {
    expect(formatExposureBias(0)).toBe('0 EV');
    expect(formatExposureBias(1)).toBe('+1 EV');
    expect(formatExposureBias(0.67)).toBe('+0.67 EV');
    expect(formatExposureBias(-1)).toBe('-1 EV');
  });
});

describe('GPS formatting', () => {
  it('formats a coordinate to 6 decimals', () => {
    expect(formatCoord({ lat: 37.7749, lon: -122.4194 })).toBe(
      '37.774900, -122.419400',
    );
    expect(formatCoord(undefined)).toBeUndefined();
  });

  it('formats altitude with a metre suffix', () => {
    expect(formatAltitude(80.2)).toBe('80.2 m');
    expect(formatAltitude(-5)).toBe('-5 m');
  });

  it('builds an OpenStreetMap link from a coordinate', () => {
    const url = mapsUrl({ lat: 37.7749, lon: -122.4194 });
    expect(url).toContain('openstreetmap.org');
    expect(url).toContain('mlat=37.7749');
    expect(url).toContain('mlon=-122.4194');
  });
});

describe('coded-value labels', () => {
  it('maps known codes and ignores unknown ones', () => {
    expect(orientationLabel(6)).toBe('Rotated 90° CW');
    expect(orientationLabel(1)).toBe('Normal');
    expect(orientationLabel(99)).toBeUndefined();
    expect(orientationLabel(undefined)).toBeUndefined();
  });

  it('reads the flash "fired" bit', () => {
    expect(flashLabel(0)).toBe('Did not fire');
    expect(flashLabel(1)).toBe('Fired');
    expect(flashLabel(0x19)).toBe('Fired'); // fired + auto mode bits set
    expect(flashLabel(undefined)).toBeUndefined();
  });
});

describe('summary lines', () => {
  it('joins camera body and exposure triplet', () => {
    expect(cameraLine({ make: 'SONY', model: 'ILCE-7M3' })).toBe('SONY ILCE-7M3');
    expect(exposureLine({ exposureTime: 0.005, fNumber: 2.8, iso: 400 })).toBe(
      '1/200 s  ·  f/2.8  ·  ISO 400',
    );
  });

  it('returns undefined when nothing is present', () => {
    expect(cameraLine({})).toBeUndefined();
    expect(exposureLine({})).toBeUndefined();
  });
});
