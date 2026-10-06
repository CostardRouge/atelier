import { describe, expect, it } from 'vitest';
import { latestOf } from './latest-of';

describe('latestOf', () => {
  it('picks the greatest updatedAt, the first of equals, and none of nothing', () => {
    expect(latestOf([])).toBe(null);
    const a = { id: 'a', updatedAt: 10 };
    const b = { id: 'b', updatedAt: 30 };
    const c = { id: 'c', updatedAt: 30 };
    expect(latestOf([a, b, c])).toBe(b);
    expect(latestOf([c, b, a])).toBe(c);
  });

  it('counts a record with no updatedAt as the oldest', () => {
    const old: { id: string; updatedAt?: number } = { id: 'old' };
    const seen = { id: 'seen', updatedAt: 1 };
    expect(latestOf([old, seen])).toBe(seen);
    expect(latestOf([old])).toBe(old);
  });
});
