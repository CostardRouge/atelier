import { describe, expect, it } from 'vitest';
import { firstsBy, sameDayAcrossYears } from './firsts';

describe('sameDayAcrossYears', () => {
  it('finds the day across the years, oldest first, the day itself left out', () => {
    const days = [
      { date: '2026-09-14', count: 3 },
      { date: '2024-09-14', count: 12 },
      { date: '2025-09-14', count: 0 },
      { date: '2025-09-13', count: 5 },
      { date: '2023-09-14', count: 1 },
    ];
    expect(sameDayAcrossYears(days, '2026-09-14')).toEqual([
      { date: '2023-09-14', count: 1 },
      { date: '2024-09-14', count: 12 },
    ]);
    expect(sameDayAcrossYears([{ date: '2024-02-29', count: 1 }, { date: '2025-03-01', count: 1 }], '2028-02-29')).toEqual([{ date: '2024-02-29', count: 1 }]);
  });
});

describe('firstsBy', () => {
  it('keeps the earliest per key with its count, keys in the order met, the unkeyed and undated left out', () => {
    expect(
      firstsBy([
        { id: 3, at: '2026-01-03T00:00:00Z', key: 'AU' },
        { id: 1, at: '2026-01-01T00:00:00Z', key: 'FR' },
        { id: 2, at: '2026-01-02T00:00:00Z', key: 'AU' },
        { id: 4, at: null, key: 'NZ' },
        { id: 5, at: '2026-01-05T00:00:00Z', key: null },
      ]),
    ).toEqual([
      { key: 'FR', id: 1, at: '2026-01-01T00:00:00Z', count: 1 },
      { key: 'AU', id: 2, at: '2026-01-02T00:00:00Z', count: 2 },
    ]);
  });
});
