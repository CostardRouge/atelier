import { describe, expect, it } from 'vitest';
import { cueFromExif, exifShutter, exifTimestamp } from './exif-cue';
import { formatField } from '../overlay/field-format';
import type { ExifData } from './exif-parser';

describe('exifShutter', () => {
  it('reads sub-second exposures as a fraction, like DJI does', () => {
    expect(exifShutter(0.005)).toBe('1/200');
    expect(exifShutter(1 / 60)).toBe('1/60');
  });

  it('reads long exposures with a unit, where a fraction would mislead', () => {
    expect(exifShutter(1)).toBe('1s');
    expect(exifShutter(2.5)).toBe('2.5s');
  });

  it('refuses a missing or impossible exposure', () => {
    expect(exifShutter(undefined)).toBeUndefined();
    expect(exifShutter(0)).toBeUndefined();
    expect(exifShutter(-1)).toBeUndefined();
    expect(exifShutter(Number.NaN)).toBeUndefined();
  });
});

describe('exifTimestamp', () => {
  it('turns EXIF colons into the separators the time formatter reads', () => {
    expect(exifTimestamp('2026:05:30 05:49:34')).toBe('2026-05-30 05:49:34');
  });

  it('keeps sub-second precision and accepts a dashed source', () => {
    expect(exifTimestamp('2026-05-30T05:49:34.609')).toBe('2026-05-30 05:49:34.609');
  });

  it('refuses a flat clock battery and anything unparseable', () => {
    expect(exifTimestamp('0000:00:00 00:00:00')).toBeNull();
    expect(exifTimestamp('yesterday')).toBeNull();
    expect(exifTimestamp(undefined)).toBeNull();
  });
});

describe('cueFromExif', () => {
  const full: ExifData = {
    make: 'FUJIFILM',
    model: 'X-T5',
    iso: 400,
    exposureTime: 0.005,
    fNumber: 2.8,
    focalLength: 23,
    exposureBias: 0.67,
    gps: { lat: -33.865143, lon: 151.2099 },
    gpsAltitude: 58.2,
    dateTimeOriginal: '2026:05:30 05:49:34',
  };

  it('maps the exposure triplet onto the DJI field names', () => {
    const cue = cueFromExif(full)!;
    expect(cue.data.iso).toBe('400');
    expect(cue.data.shutter).toBe('1/200');
    expect(cue.data.fnum).toBe('2.8');
    expect(cue.data.focal_len).toBe('23');
    expect(cue.data.ev).toBe('+0.67');
  });

  it('maps position and altitude', () => {
    const cue = cueFromExif(full)!;
    expect(cue.data.latitude).toBe('-33.865143');
    expect(cue.data.longitude).toBe('151.209900');
    expect(cue.data.abs_alt).toBe('58.2');
  });

  it('starts at 0 so any playhead resolves it', () => {
    expect(cueFromExif(full)!.start).toBe(0);
  });

  it('invents nothing a photograph cannot answer', () => {
    const cue = cueFromExif(full)!;
    expect(cue.frame).toBeNull();
    expect(cue.derived).toBeUndefined();
    for (const key of ['rel_alt', 'gnd_speed', 'vert_speed', 'heading', 'color_md']) {
      expect(cue.data[key]).toBeUndefined();
    }
  });

  it('is null when the file carries nothing an element could draw', () => {
    expect(cueFromExif({})).toBeNull();
    expect(cueFromExif({ make: 'Apple', model: 'iPhone' })).toBeNull();
  });

  it('is a cue on its timestamp alone — a phone screenshot still dates itself', () => {
    const cue = cueFromExif({ dateTimeOriginal: '2026:05:30 05:49:34' });
    expect(cue?.timestamp).toBe('2026-05-30 05:49:34');
  });

  it('feeds the overlay formatter the way a clip does', () => {
    const cue = cueFromExif(full);
    expect(formatField('shutter', cue)).toBe('1/200');
    expect(formatField('fnum', cue)).toBe('f/2.8');
    expect(formatField('focal_len', cue)).toBe('23 mm');
    expect(formatField('clock', cue)).toBe('05:49:34');
    // Nothing measured a speed here, and nothing pretends to.
    expect(formatField('gnd_speed', cue)).toBe('—');
    expect(formatField('heading', cue)).toBe('—');
  });
});
