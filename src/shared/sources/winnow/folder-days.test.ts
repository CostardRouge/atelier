import { describe, expect, it } from 'vitest';
import { folderDays, folderDaysLabel, folderOverlaps } from './folder-days';

const folder = (min: string | null, max: string | null) => ({ captured_at_min: min, captured_at_max: max });

describe('folderDays', () => {
  it('reads the instants in the given zone, not as UTC days', () => {
    // A Melbourne morning on 22 November is still the 21st in UTC.
    const s = folder('2026-11-21T22:30:00.000Z', '2026-11-22T01:10:00.000Z');
    expect(folderDays(s, 'Australia/Melbourne')).toEqual({ from: '2026-11-22', to: '2026-11-22' });
    expect(folderDays(s, 'UTC')).toEqual({ from: '2026-11-21', to: '2026-11-22' });
  });

  it('spans two days when the shoot crosses a local midnight', () => {
    const s = folder('2026-11-13T10:00:00.000Z', '2026-11-14T02:00:00.000Z');
    expect(folderDaysLabel(folderDays(s, 'Europe/Paris'))).toBe('2026-11-13 → 2026-11-14');
  });

  it('takes the one instant it has for both ends, and a dash for none', () => {
    expect(folderDays(folder(null, '2026-11-20T08:00:00Z'), 'UTC')).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(folderDays(folder(null, null), 'UTC')).toEqual({ from: null, to: null });
    expect(folderDays(folder('not a date', null), 'UTC')).toEqual({ from: null, to: null });
    expect(folderDaysLabel({ from: null, to: null })).toBe('—');
  });
});

describe('folderOverlaps', () => {
  const days = { from: '2026-11-13', to: '2026-11-14' };
  it('keeps a folder shot on any day of the span', () => {
    expect(folderOverlaps(days, '2026-11-14', null)).toBe(true);
    expect(folderOverlaps(days, null, '2026-11-13')).toBe(true);
    expect(folderOverlaps(days, '2026-11-15', null)).toBe(false);
    expect(folderOverlaps(days, null, '2026-11-12')).toBe(false);
  });
  it('keeps an undated folder only when no span is asked', () => {
    expect(folderOverlaps({ from: null, to: null }, null, null)).toBe(true);
    expect(folderOverlaps({ from: null, to: null }, '2026-11-01', null)).toBe(false);
  });
});
