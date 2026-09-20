import { describe, expect, it } from 'vitest';
import { buildExifBlock, toDegreesMinutesSeconds, toRational } from './exif-build';
import { parseExif, type ExifData } from './exif-parser';

/** What the builder wrote, read back by the reader that has always been here. */
function roundTrip(exif: ExifData, options?: Parameters<typeof buildExifBlock>[1]): ExifData {
  const block = buildExifBlock(exif, options);
  return parseExif(block.buffer);
}

const full: ExifData = {
  make: 'DJI',
  model: 'FC8482',
  lensMake: 'DJI',
  lensModel: '24mm f/1.7',
  artist: 'Steeve Pommier',
  iso: 100,
  exposureTime: 0.005,
  fNumber: 1.7,
  focalLength: 6.72,
  focalLength35: 24,
  exposureBias: -0.67,
  exposureProgram: 2,
  meteringMode: 5,
  whiteBalance: 0,
  flash: 16,
  dateTimeOriginal: '2026:07:14 18:32:05',
  gps: { lat: 64.1466, lon: -21.9426 },
  gpsAltitude: 128.4,
};

describe('toRational', () => {
  it('finds the fraction a camera wrote, not a decimal blown up', () => {
    expect(toRational(0.005)).toEqual([1, 200]);
    expect(toRational(1 / 8000)).toEqual([1, 8000]);
    expect(toRational(2.5)).toEqual([5, 2]);
    expect(toRational(4)).toEqual([4, 1]);
    expect(toRational(0)).toEqual([0, 1]);
  });

  it('stays inside the denominator it is given, and keeps the sign', () => {
    const [n, d] = toRational(-0.6666666, 100);
    expect(d).toBeLessThanOrEqual(100);
    expect(n / d).toBeCloseTo(-0.6666666, 4);
  });
});

describe('toDegreesMinutesSeconds', () => {
  it('splits degrees the way EXIF stores them, unsigned', () => {
    const [d, dd, m, md, s, sd] = toDegreesMinutesSeconds(-21.9426);
    expect([d, dd, m, md]).toEqual([21, 1, 56, 1]);
    expect(s / sd).toBeCloseTo(33.36, 2);
  });
});

describe('buildExifBlock', () => {
  it('writes a block our own reader reads back field for field', () => {
    const read = roundTrip(full);
    expect(read.make).toBe('DJI');
    expect(read.model).toBe('FC8482');
    expect(read.lensModel).toBe('24mm f/1.7');
    expect(read.artist).toBe('Steeve Pommier');
    expect(read.iso).toBe(100);
    expect(read.exposureTime).toBeCloseTo(0.005, 9);
    expect(read.fNumber).toBeCloseTo(1.7, 6);
    expect(read.focalLength).toBeCloseTo(6.72, 6);
    expect(read.focalLength35).toBe(24);
    expect(read.exposureBias).toBeCloseTo(-0.67, 4);
    expect(read.exposureProgram).toBe(2);
    expect(read.meteringMode).toBe(5);
    expect(read.flash).toBe(16);
    expect(read.dateTimeOriginal).toBe('2026:07:14 18:32:05');
  });

  it('carries the position, hemispheres and all, and the altitude with its sign', () => {
    const read = roundTrip(full);
    expect(read.gps?.lat).toBeCloseTo(64.1466, 6);
    expect(read.gps?.lon).toBeCloseTo(-21.9426, 6);
    expect(read.gpsAltitude).toBeCloseTo(128.4, 3);
    const below = roundTrip({ gps: { lat: -33.8, lon: 151.2 }, gpsAltitude: -12.5 });
    expect(below.gps?.lat).toBeCloseTo(-33.8, 6);
    expect(below.gps?.lon).toBeCloseTo(151.2, 6);
    expect(below.gpsAltitude).toBeCloseTo(-12.5, 3);
  });

  it('says the picture is the way up it was delivered, at the size it was delivered', () => {
    // The original's own orientation would turn an already-turned picture twice.
    const read = roundTrip({ ...full, orientation: 6, pixelWidth: 8064, pixelHeight: 6048 }, {
      pixelWidth: 1920,
      pixelHeight: 1440,
      software: 'Atelier',
    });
    expect(read.orientation).toBe(1);
    expect(read.pixelWidth).toBe(1920);
    expect(read.pixelHeight).toBe(1440);
    expect(read.software).toBe('Atelier');
  });

  it('writes a block for a picture that knows nothing, and reads back as empty but for what it states', () => {
    const read = roundTrip({});
    expect(read.orientation).toBe(1);
    expect(read.gps).toBeUndefined();
    expect(read.make).toBeUndefined();
  });

  it('leaves out what it is not given rather than writing a zero', () => {
    const read = roundTrip({ iso: 400 });
    expect(read.iso).toBe(400);
    expect(read.fNumber).toBeUndefined();
    expect(read.exposureTime).toBeUndefined();
    expect(read.focalLength).toBeUndefined();
  });

  it('stays a sane size — a block is one APP1 segment, never a file', () => {
    expect(buildExifBlock(full).length).toBeLessThan(1024);
  });
});
