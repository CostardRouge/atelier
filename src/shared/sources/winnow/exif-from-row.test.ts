import { describe, expect, it } from 'vitest';
import { exifFromRow, exifTimestampFromIso, parseShutterSeconds } from './exif-from-row';
import { cueFromExif } from '../../exif/exif-cue';
import type { WinnowAssetRow } from './client';

const row = (over: Partial<WinnowAssetRow> = {}): WinnowAssetRow => ({
  id: 1,
  filename: 'DJI_0001.JPG',
  ext: 'jpg',
  media_type: 'photo',
  captured_at: '2025-07-09T08:30:15.000Z',
  capture_date: '2025-07-09',
  width: 8064,
  height: 6048,
  duration_s: null,
  file_size: 12_000_000,
  content_hash: 'abc',
  gps_lat: -25.344428,
  gps_lon: 131.036882,
  camera_model: 'DJI Mini 4 Pro',
  iso: 100,
  shutter: '1/240',
  aperture: 1.7,
  focal_length: 6.7,
  relative_altitude: 84.3,
  absolute_altitude: 612.5,
  derivative_status: 'ready',
  has_telemetry: false,
  sidecars: [],
  ...over,
});

describe('parseShutterSeconds', () => {
  it('reads the fraction a camera writes', () => {
    expect(parseShutterSeconds('1/240')).toBeCloseTo(1 / 240, 10);
    expect(parseShutterSeconds(' 1 / 60 ')).toBeCloseTo(1 / 60, 10);
  });
  it('reads a plain number of seconds, with or without the unit', () => {
    expect(parseShutterSeconds('2.5')).toBe(2.5);
    expect(parseShutterSeconds('2.5s')).toBe(2.5);
    expect(parseShutterSeconds('30 sec')).toBe(30);
  });
  it('refuses what it cannot read rather than guessing', () => {
    for (const bad of [null, undefined, '', 'auto', '1/0', '-3', '0']) {
      expect(parseShutterSeconds(bad)).toBeUndefined();
    }
  });
});

describe('exifTimestampFromIso', () => {
  it('gives back the wall clock the camera wrote, in EXIF form', () => {
    // Winnow puts the zone-less EXIF string in a TIMESTAMPTZ; reading the UTC
    // components undoes that. The hour must survive untouched.
    expect(exifTimestampFromIso('2025-07-09T08:30:15.000Z')).toBe('2025:07:09 08:30:15');
  });
  it('does not drift with an offset the server attached', () => {
    expect(exifTimestampFromIso('2025-07-09T08:30:15+00:00')).toBe('2025:07:09 08:30:15');
  });
  it('refuses a time it cannot parse', () => {
    expect(exifTimestampFromIso(null)).toBeUndefined();
    expect(exifTimestampFromIso('someday')).toBeUndefined();
  });
});

describe('exifFromRow', () => {
  it('carries exposure, position, altitude and time across', () => {
    expect(exifFromRow(row())).toEqual({
      iso: 100,
      exposureTime: 1 / 240,
      fNumber: 1.7,
      focalLength: 6.7,
      gps: { lat: -25.344428, lon: 131.036882 },
      gpsAltitude: 612.5,
      relativeAltitude: 84.3,
      dateTimeOriginal: '2025:07:09 08:30:15',
      pixelWidth: 8064,
      pixelHeight: 6048,
    });
  });

  it('omits what the row does not know, rather than writing zeros', () => {
    const plain = exifFromRow(
      row({ iso: null, shutter: null, aperture: null, focal_length: null,
            relative_altitude: null, absolute_altitude: null }),
    );
    expect(plain).not.toHaveProperty('iso');
    expect(plain).not.toHaveProperty('relativeAltitude');
    expect(plain?.gps).toEqual({ lat: -25.344428, lon: 131.036882 });
  });

  it('needs both halves of a position before claiming one', () => {
    expect(exifFromRow(row({ gps_lon: null }))?.gps).toBeUndefined();
  });

  it('is null when the row knows only how big the picture is', () => {
    expect(
      exifFromRow(
        row({ iso: null, shutter: null, aperture: null, focal_length: null,
              gps_lat: null, gps_lon: null, relative_altitude: null,
              absolute_altitude: null, captured_at: null }),
      ),
    ).toBeNull();
  });

  it('feeds the cue a still is worth — the whole point of the mapping', () => {
    const cue = cueFromExif(exifFromRow(row())!);
    expect(cue?.timestamp).toBe('2025-07-09 08:30:15');
    expect(cue?.data).toMatchObject({
      iso: '100',
      shutter: '1/240',
      fnum: '1.7',
      focal_len: '6.7',
      latitude: '-25.344428',
      longitude: '131.036882',
      abs_alt: '612.5',
      // A drone still knows its height above take-off; an ordinary camera
      // leaves this absent and the element goes on reading "—".
      rel_alt: '84.3',
    });
  });

  it('leaves rel_alt absent for a camera that is not a drone', () => {
    const cue = cueFromExif(exifFromRow(row({ relative_altitude: null }))!);
    expect(cue?.data.rel_alt).toBeUndefined();
  });
});
