import { describe, expect, it } from 'vitest';
import {
  overrideTo,
  relativeToAnchor,
  shiftDay,
  stepOut,
  viewedSpan,
  type DaySpan,
} from './scope-override';

const day: DaySpan = { from: '2025-03-25', to: '2025-03-25' };
const span: DaySpan = { from: '2025-03-25', to: '2025-03-27' };

describe('viewedSpan', () => {
  it('follows the published span when nothing overrides it', () => {
    expect(viewedSpan(span, null, '2026-09-13')).toEqual({ ...span, anchor: span, overridden: false });
  });

  it('shows the override while its anchor is still what is published', () => {
    const o = { anchor: day, day: '2025-03-26' };
    expect(viewedSpan(day, o, '2026-09-13')).toEqual({
      from: '2025-03-26',
      to: '2025-03-26',
      anchor: day,
      overridden: true,
    });
  });

  it('drops an override taken from another span — another piece, another day of the overview', () => {
    const o = { anchor: day, day: '2025-03-26' };
    const next = { from: '2025-04-02', to: '2025-04-02' };
    expect(viewedSpan(next, o, '2026-09-13')).toEqual({ ...next, anchor: next, overridden: false });
  });

  it('uses the day picked by hand when no tool publishes', () => {
    const o = { anchor: day, day: '2025-03-26' };
    expect(viewedSpan(null, o, '2026-09-13')).toEqual({
      from: '2026-09-13',
      to: '2026-09-13',
      anchor: null,
      overridden: false,
    });
  });
});

describe('stepOut', () => {
  it('steps to the neighbour of a single day', () => {
    expect(stepOut(day, -1)).toBe('2025-03-24');
    expect(stepOut(day, 1)).toBe('2025-03-26');
  });

  it('steps out of a span from its edges, never by its length', () => {
    expect(stepOut(span, -1)).toBe('2025-03-24');
    expect(stepOut(span, 1)).toBe('2025-03-28');
  });

  it('crosses a month and a leap day in UTC', () => {
    expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDay('2025-03-31', 1)).toBe('2025-04-01');
  });

  it('refuses what is not a date', () => {
    expect(shiftDay('25/03/2025', 1)).toBeNull();
  });
});

describe('overrideTo', () => {
  it('returns to following when stepping back onto a single-day anchor', () => {
    expect(overrideTo(day, '2025-03-25')).toBeNull();
  });

  it('overrides for any other day, and for a day inside a span', () => {
    expect(overrideTo(day, '2025-03-24')).toEqual({ anchor: day, day: '2025-03-24' });
    expect(overrideTo(span, '2025-03-26')).toEqual({ anchor: span, day: '2025-03-26' });
  });
});

describe('relativeToAnchor', () => {
  it('counts from the anchor, not from today', () => {
    expect(relativeToAnchor('2025-03-24', day)).toBe('the day before');
    expect(relativeToAnchor('2025-03-22', day)).toBe('3 days before');
    expect(relativeToAnchor('2025-03-26', day)).toBe('the day after');
    expect(relativeToAnchor('2025-03-25', day)).toBe('the same day');
  });

  it('counts past a span from its edges, and inside it by day number', () => {
    expect(relativeToAnchor('2025-03-28', span)).toBe('the day after');
    expect(relativeToAnchor('2025-03-24', span)).toBe('the day before');
    expect(relativeToAnchor('2025-03-26', span)).toBe('day 2 of 3');
  });

  it('is null for a bad date', () => {
    expect(relativeToAnchor('nope', day)).toBeNull();
  });
});
