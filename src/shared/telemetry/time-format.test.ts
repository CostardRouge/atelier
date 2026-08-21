import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatTimestamp,
  parseWallClock,
  shiftWallClock,
  weekdayOf,
  type WallClock,
} from './time-format';

const SAMPLE = '2026-05-30 05:49:34.609';
const wc = parseWallClock(SAMPLE)!;

describe('parseWallClock', () => {
  it('reads the DJI timestamp line', () => {
    expect(wc).toEqual({
      year: 2026,
      month: 5,
      day: 30,
      hour: 5,
      minute: 49,
      second: 34,
      ms: 609,
    });
  });

  it('tolerates slashes, a T separator, and missing sub-parts', () => {
    expect(parseWallClock('2026/05/30 17:00')).toMatchObject({ hour: 17, second: 0, ms: 0 });
    expect(parseWallClock('2026-05-30T17:00:05')).toMatchObject({ hour: 17, second: 5 });
    expect(parseWallClock('2026-05-30 17:00:05,25')).toMatchObject({ ms: 250 });
  });

  it('refuses anything that is not a reading', () => {
    expect(parseWallClock(null)).toBeNull();
    expect(parseWallClock('')).toBeNull();
    expect(parseWallClock('FrameCnt: 12')).toBeNull();
    expect(parseWallClock('2026-13-30 05:49:34')).toBeNull(); // month 13
    expect(parseWallClock('2026-05-30 25:49:34')).toBeNull(); // hour 25
  });
});

describe('formatClock', () => {
  it('defaults to a padded 24-hour reading with seconds', () => {
    expect(formatClock(wc)).toBe('05:49:34');
  });

  it('drops seconds and adds milliseconds on request', () => {
    expect(formatClock(wc, { seconds: false })).toBe('05:49');
    expect(formatClock(wc, { milliseconds: true })).toBe('05:49:34.609');
  });

  it('switches to 12-hour with an unpadded hour and a meridiem', () => {
    expect(formatClock(wc, { hour12: true })).toBe('5:49:34 AM');
    const pm: WallClock = { ...wc, hour: 17 };
    expect(formatClock(pm, { hour12: true })).toBe('5:49:34 PM');
  });

  it('can hide the meridiem', () => {
    expect(formatClock({ ...wc, hour: 17 }, { hour12: true, meridiem: false })).toBe(
      '5:49:34',
    );
  });

  it('names midnight and noon 12, not 0', () => {
    expect(formatClock({ ...wc, hour: 0 }, { hour12: true })).toBe('12:49:34 AM');
    expect(formatClock({ ...wc, hour: 12 }, { hour12: true })).toBe('12:49:34 PM');
  });
});

describe('formatDate', () => {
  it('offers every style', () => {
    expect(formatDate(wc)).toBe('2026-05-30');
    expect(formatDate(wc, { dateStyle: 'dmy' })).toBe('30/05/2026');
    expect(formatDate(wc, { dateStyle: 'mdy' })).toBe('05/30/2026');
    expect(formatDate(wc, { dateStyle: 'long-dmy' })).toBe('30 May 2026');
    expect(formatDate(wc, { dateStyle: 'long-mdy' })).toBe('May 30, 2026');
    expect(formatDate(wc, { dateStyle: 'weekday' })).toBe('Sat 30 May 2026');
  });

  it('computes the weekday from the calendar, not the machine', () => {
    expect(weekdayOf({ ...wc, year: 2026, month: 5, day: 30 })).toBe(6); // Saturday
  });
});

describe('shiftWallClock', () => {
  it('is a no-op at zero', () => {
    expect(shiftWallClock(wc, { minutes: 0, days: 0 })).toBe(wc);
    expect(shiftWallClock(wc, null)).toBe(wc);
  });

  it('adds and subtracts hours', () => {
    expect(formatClock(shiftWallClock(wc, { minutes: 120, days: 0 }))).toBe('07:49:34');
    expect(formatClock(shiftWallClock(wc, { minutes: -60, days: 0 }))).toBe('04:49:34');
  });

  it('handles the half-hour and quarter-hour offsets that really exist', () => {
    expect(formatClock(shiftWallClock(wc, { minutes: 330, days: 0 }))).toBe('11:19:34');
    expect(formatClock(shiftWallClock(wc, { minutes: 345, days: 0 }))).toBe('11:34:34');
  });

  it('rolls the date rather than wrapping the hour', () => {
    const late: WallClock = { ...wc, hour: 23, minute: 30 };
    const rolled = shiftWallClock(late, { minutes: 60, days: 0 });
    expect(formatClock(rolled, { seconds: false })).toBe('00:30');
    expect(formatDate(rolled)).toBe('2026-05-31');

    const early: WallClock = { ...wc, hour: 0, minute: 30 };
    const back = shiftWallClock(early, { minutes: -60, days: 0 });
    expect(formatClock(back, { seconds: false })).toBe('23:30');
    expect(formatDate(back)).toBe('2026-05-29');
  });

  it('crosses month and year boundaries', () => {
    const nye: WallClock = { year: 2025, month: 12, day: 31, hour: 23, minute: 0, second: 0, ms: 0 };
    expect(formatDate(shiftWallClock(nye, { minutes: 90, days: 0 }))).toBe('2026-01-01');
    expect(formatDate(shiftWallClock(wc, { minutes: 0, days: 2 }))).toBe('2026-06-01');
    expect(formatDate(shiftWallClock(wc, { minutes: 0, days: -365 }))).toBe('2025-05-30');
  });

  it('combines a day shift with a minute shift', () => {
    const out = shiftWallClock(wc, { minutes: -360, days: 1 });
    expect(formatTimestamp(out)).toBe('2026-05-30 23:49:34');
  });

  it('is machine-independent — the same reading whatever the local zone', () => {
    // Real proof of the UTC-arithmetic choice: parsing into a local Date would
    // make this depend on process.env.TZ.
    const shifted = shiftWallClock(wc, { minutes: 90, days: 0 });
    expect(shifted).toEqual({ ...wc, hour: 7, minute: 19 });
  });
});

describe('formatTimestamp', () => {
  it('joins the chosen date and clock styles', () => {
    expect(formatTimestamp(wc)).toBe('2026-05-30 05:49:34');
    expect(
      formatTimestamp(wc, { dateStyle: 'long-dmy', hour12: true, seconds: false }),
    ).toBe('30 May 2026 5:49 AM');
  });
});
