import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  captureDay,
  captureMinute,
  dayAgo,
  daysInMonth,
  isoWeek,
  monthDays,
  monthLead,
  parseAgo,
  weekDays,
  weekStartOf,
  weekdayHeaders,
} from './recap-days';

describe('recap days', () => {
  it('lists a month, leap years included', () => {
    expect(monthDays('2026-10-14')).toHaveLength(31);
    expect(monthDays('2024-02-03').slice(-1)[0]).toBe('2024-02-29');
    expect(daysInMonth('2026-02-01')).toBe(28);
    expect(monthDays('nope')).toEqual([]);
  });

  it('places the 1st under its weekday, Monday or Sunday first', () => {
    // 1 October 2026 is a Thursday.
    expect(monthLead('2026-10-01', 1)).toBe(3);
    expect(monthLead('2026-10-01', 0)).toBe(4);
    expect(weekdayHeaders(0)[0]).toBe('Sunday');
  });

  it('finds the week a day falls in', () => {
    expect(weekStartOf('2026-10-29', 1)).toBe('2026-10-26');
    expect(weekStartOf('2026-10-29', 0)).toBe('2026-10-25');
    expect(weekDays('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(isoWeek('2026-10-29')).toBe(44);
  });

  it('steps back in time without leaving the month it names', () => {
    expect(dayAgo('2026-11-04', parseAgo('1y')!)).toBe('2025-11-04');
    expect(dayAgo('2026-03-31', parseAgo('1m')!)).toBe('2026-02-28');
    expect(dayAgo('2024-02-29', parseAgo('1y')!)).toBe('2023-02-28');
    expect(dayAgo('2026-11-04', parseAgo('1w')!)).toBe('2026-10-28');
    expect(dayAgo('2026-11-04', parseAgo('0d')!)).toBe('2026-11-04');
    expect(parseAgo('101y')).toBeNull();
    expect(parseAgo('1x')).toBeNull();
    expect(agoLabel(parseAgo('3m')!)).toBe('3 months ago');
    expect(agoLabel(parseAgo('0d')!)).toBe('Today');
  });

  it('reads the capture day off its own wall clock', () => {
    expect(captureDay('2025:11:04 18:42:07')).toBe('2025-11-04');
    expect(captureDay('2025-11-04T23:59:00+11:00')).toBe('2025-11-04');
    expect(captureDay('2025-02-30')).toBeNull();
    expect(captureDay(null)).toBeNull();
    expect(captureMinute('2025:11:04 18:42:30')).toBeCloseTo(18 * 60 + 42.5);
    expect(captureMinute('2025-11-04')).toBeNull();
  });
});
