import { describe, expect, it } from 'vitest';
import { registerMediaIdentity } from '../projects/media-identity';
import { isoFromExifDateTime, isoFromTimestamp, readCaptureDate } from './media-date';

describe('isoFromExifDateTime', () => {
  it('reads the day out of the camera’s own format', () => {
    expect(isoFromExifDateTime('2025:11:17 08:42:13')).toBe('2025-11-17');
  });

  it('takes the date as written, never converted', () => {
    // 23:59 local is still that day — a UTC conversion would move it, and the
    // day a picture belongs to is the day it was where it was taken.
    expect(isoFromExifDateTime('2025:03:27 23:59:59')).toBe('2025-03-27');
  });

  it('accepts the dashed spelling some writers use', () => {
    expect(isoFromExifDateTime('2025-11-17 08:42:13')).toBe('2025-11-17');
  });

  it('refuses a camera with a flat clock rather than inventing a day', () => {
    expect(isoFromExifDateTime('0000:00:00 00:00:00')).toBeNull();
  });

  it('refuses a day that does not exist', () => {
    expect(isoFromExifDateTime('2025:02:30 10:00:00')).toBeNull();
  });

  it('is null for nothing at all', () => {
    expect(isoFromExifDateTime(undefined)).toBeNull();
    expect(isoFromExifDateTime('')).toBeNull();
    expect(isoFromExifDateTime('not a date')).toBeNull();
  });
});

describe('isoFromTimestamp', () => {
  it('gives the calendar day the instant fell on', () => {
    const noon = new Date(2026, 6, 14, 12, 0, 0).getTime();
    expect(isoFromTimestamp(noon)).toBe('2026-07-14');
  });

  it('pads a single-digit month and day', () => {
    expect(isoFromTimestamp(new Date(2026, 0, 5, 9).getTime())).toBe('2026-01-05');
  });

  it('is null when there is no timestamp', () => {
    expect(isoFromTimestamp(0)).toBeNull();
    expect(isoFromTimestamp(NaN)).toBeNull();
  });
});

describe('readCaptureDate', () => {
  // A Winnow photo proxy: a re-encode with no EXIF of its own, whose file
  // timestamp is the capture instant read in the READER's timezone — so the
  // fallback can name the wrong calendar day, and calls it a weak guess even
  // when it lands on the right one.
  const proxy = () =>
    new File([new Uint8Array(64)], 'DJI_0042.webp', {
      type: 'image/webp',
      lastModified: Date.parse('2025-11-17T23:30:00Z'),
    });

  it('takes the day the source read at ingest when the file carries no EXIF', async () => {
    const file = proxy();
    registerMediaIdentity(file, {
      assetId: 'winnow.example/42',
      origin: {
        sourceId: 'winnow.example',
        fidelity: 'proxy',
        width: 4000,
        height: 3000,
        exif: { dateTimeOriginal: '2025:11:17 23:30:00' },
      },
    });
    expect(await readCaptureDate(file)).toEqual({
      date: '2025-11-17',
      source: 'source',
      via: 'winnow.example',
    });
  });

  it('falls through to the file’s own date when no source vouched for it', async () => {
    // A different name, so it is a different `fileIdentity` from the one above
    // — the vouched map is keyed on name + size + lastModified.
    const alone = new File([new Uint8Array(64)], 'DJI_0043.webp', {
      type: 'image/webp',
      lastModified: Date.parse('2025-11-17T23:30:00Z'),
    });
    const day = isoFromTimestamp(Date.parse('2025-11-17T23:30:00Z'));
    expect(await readCaptureDate(alone)).toEqual({ date: day, source: 'file' });
  });
});
