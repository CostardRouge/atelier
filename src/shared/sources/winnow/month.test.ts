import { describe, expect, it } from 'vitest';
import { monthKeyOf, monthLabel, monthOptions, monthSpan, shiftMonth } from './month';

describe('monthSpan', () => {
  it('lists every day and knows where the grid starts (Monday = 0)', () => {
    const july = monthSpan('2025-07');
    expect(july.from).toBe('2025-07-01');
    expect(july.to).toBe('2025-07-31');
    expect(july.days).toHaveLength(31);
    // 1 July 2025 is a Tuesday.
    expect(july.leading).toBe(1);
  });
  it('handles February in a leap year, in UTC', () => {
    expect(monthSpan('2024-02').days).toHaveLength(29);
    expect(monthSpan('2025-02').days).toHaveLength(28);
  });
  it('starts a Sunday-led month at the end of the row', () => {
    // 1 June 2025 is a Sunday.
    expect(monthSpan('2025-06').leading).toBe(6);
  });
});

describe('shiftMonth', () => {
  it('crosses a year boundary both ways', () => {
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2025-01', -1)).toBe('2024-12');
    expect(shiftMonth('2025-07', 0)).toBe('2025-07');
  });
});

describe('monthKeyOf / monthLabel', () => {
  it('keys a date by its month and names it', () => {
    expect(monthKeyOf('2025-07-09')).toBe('2025-07');
    expect(monthLabel('2025-07', 'en-GB')).toBe('July 2025');
  });
});

describe('monthOptions', () => {
  it('groups every month of the span by year, newest year first, months in order', () => {
    const opts = monthOptions('2024-11-05', '2025-02-15', 'en-GB');
    expect(opts.map((o) => o.year)).toEqual(['2025', '2024']);
    expect(opts[0].months.map((m) => m.key)).toEqual(['2025-01', '2025-02']);
    expect(opts[1].months.map((m) => m.label)).toEqual(['November', 'December']);
  });
  it('is empty for inverted bounds', () => {
    expect(monthOptions('2025-02-01', '2025-01-01')).toEqual([]);
  });
  it('covers a single month', () => {
    expect(monthOptions('2025-07-03', '2025-07-20')).toEqual([
      { year: '2025', months: [{ key: '2025-07', label: expect.any(String) }] },
    ]);
  });
});
