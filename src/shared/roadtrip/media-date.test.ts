import { describe, expect, it } from 'vitest';
import { isoFromExifDateTime, isoFromTimestamp } from './media-date';

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
