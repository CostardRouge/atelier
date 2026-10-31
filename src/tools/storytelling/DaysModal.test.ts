import { describe, expect, it } from 'vitest';
import { daysBetween } from './DaysModal';

describe('daysBetween', () => {
  it('lists every day, both ends included, across a month', () => {
    expect(daysBetween('2025-08-30', '2025-09-02')).toEqual(['2025-08-30', '2025-08-31', '2025-09-01', '2025-09-02']);
    expect(daysBetween('2025-09-02', '2025-09-01')).toEqual([]);
  });
});
