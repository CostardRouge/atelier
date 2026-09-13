import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOUPE_DAYS,
  MIN_LOUPE_DAYS,
  defaultLoupe,
  loupeContaining,
  loupeIsWhole,
  loupeLength,
  moveLoupe,
  resizeLoupe,
} from './loupe';

const year = { startDate: '2025-01-01', endDate: '2025-12-31' };
const week = { startDate: '2026-09-01', endDate: '2026-09-08' };

describe('defaultLoupe', () => {
  it('opens eight weeks holding the focus, with context before it', () => {
    const l = defaultLoupe(year, '2025-08-02');
    expect(loupeLength(l)).toBe(DEFAULT_LOUPE_DAYS);
    expect(l.start <= '2025-08-02' && l.end >= '2025-08-02').toBe(true);
    // Two weeks before, pulled back to that Monday.
    expect(l.start).toBe('2025-07-14');
  });
  it('starts at the trip when the focus is near its start, and never leaves the trip at its end', () => {
    expect(defaultLoupe(year, '2025-01-03').start).toBe('2025-01-01');
    const late = defaultLoupe(year, '2025-12-30');
    expect(late.end).toBe('2025-12-31');
    expect(loupeLength(late)).toBe(DEFAULT_LOUPE_DAYS);
  });
  it('is the whole trip when the trip is shorter than the window', () => {
    const l = defaultLoupe(week, '2026-09-03');
    expect(l).toEqual({ start: week.startDate, end: week.endDate });
    expect(loupeIsWhole(week, l)).toBe(true);
  });
  it('falls back to the trip start for a focus outside the trip', () => {
    expect(defaultLoupe(year, '2030-01-01').start).toBe('2025-01-01');
  });
});

describe('moveLoupe', () => {
  const l = { start: '2025-03-01', end: '2025-04-25' };
  it('keeps its width and stops at the trip edges', () => {
    const moved = moveLoupe(year, l, 10);
    expect(loupeLength(moved)).toBe(loupeLength(l));
    expect(moved.start).toBe('2025-03-11');
    expect(moveLoupe(year, l, -100).start).toBe('2025-01-01');
    expect(moveLoupe(year, l, 1000).end).toBe('2025-12-31');
  });
});

describe('resizeLoupe', () => {
  const l = { start: '2025-03-01', end: '2025-04-25' };
  it('moves one edge and clamps it to the trip', () => {
    expect(resizeLoupe(year, l, 'start', '2025-03-10').start).toBe('2025-03-10');
    expect(resizeLoupe(year, l, 'end', '2026-06-01').end).toBe('2025-12-31');
  });
  it('never shrinks under the minimum', () => {
    const narrow = resizeLoupe(year, l, 'start', '2025-04-25');
    expect(loupeLength(narrow)).toBe(MIN_LOUPE_DAYS);
    const narrowEnd = resizeLoupe(year, l, 'end', '2025-03-01');
    expect(loupeLength(narrowEnd)).toBe(MIN_LOUPE_DAYS);
  });
});

describe('loupeContaining', () => {
  const l = { start: '2025-03-01', end: '2025-04-25' };
  it('is unchanged while the date is inside', () => {
    expect(loupeContaining(year, l, '2025-04-01')).toBe(l);
  });
  it('slides the shortest way to hold a date outside, keeping its width', () => {
    const later = loupeContaining(year, l, '2025-05-10');
    expect(later.end).toBe('2025-05-10');
    expect(loupeLength(later)).toBe(loupeLength(l));
    const earlier = loupeContaining(year, l, '2025-02-01');
    expect(earlier.start).toBe('2025-02-01');
  });
  it('ignores a date off the trip', () => {
    expect(loupeContaining(year, l, '2030-01-01')).toBe(l);
  });
});
