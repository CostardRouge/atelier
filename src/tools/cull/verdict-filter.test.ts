import { describe, expect, it } from 'vitest';
import type { Verdict, Flag } from '../../shared/library/AssetLibraryContext';
import { isPick, matchesFilter, type CullFilter } from './verdict-filter';

const v = (rating: number, flag: Flag = null): Verdict => ({ rating, flag });

describe('matchesFilter', () => {
  it("'all' matches everything, including an absent verdict", () => {
    expect(matchesFilter(undefined, 'all')).toBe(true);
    expect(matchesFilter(v(0), 'all')).toBe(true);
    expect(matchesFilter(v(5, 'reject'), 'all')).toBe(true);
  });

  it('flag filters match only their flag', () => {
    expect(matchesFilter(v(0, 'pick'), 'picks')).toBe(true);
    expect(matchesFilter(v(5, 'reject'), 'picks')).toBe(false);
    expect(matchesFilter(v(0, 'reject'), 'rejects')).toBe(true);
    expect(matchesFilter(undefined, 'picks')).toBe(false);
  });

  it("'unrated' matches rating 0 (including absent)", () => {
    expect(matchesFilter(undefined, 'unrated')).toBe(true);
    expect(matchesFilter(v(0, 'pick'), 'unrated')).toBe(true);
    expect(matchesFilter(v(1), 'unrated')).toBe(false);
  });

  it('rated thresholds are inclusive minimums', () => {
    expect(matchesFilter(v(2), 'rated2')).toBe(true);
    expect(matchesFilter(v(1), 'rated2')).toBe(false);
    expect(matchesFilter(v(4), 'rated4')).toBe(true);
    expect(matchesFilter(v(3), 'rated4')).toBe(false);
    expect(matchesFilter(v(5), 'rated5')).toBe(true);
  });

  it('covers the full verdict matrix without throwing', () => {
    const filters: CullFilter[] = [
      'all', 'picks', 'rejects', 'unrated', 'rated2', 'rated3', 'rated4', 'rated5',
    ];
    const flags: Flag[] = ['pick', 'reject', null];
    for (let r = 0; r <= 5; r++) {
      for (const f of flags) {
        for (const filter of filters) {
          expect(typeof matchesFilter(v(r, f), filter)).toBe('boolean');
        }
      }
    }
  });
});

describe('isPick', () => {
  it('treats explicit pick or rating>=4 as a keeper', () => {
    expect(isPick(v(0, 'pick'))).toBe(true);
    expect(isPick(v(4))).toBe(true);
    expect(isPick(v(5))).toBe(true);
  });

  it('rejects override a high rating; low ratings are not keepers', () => {
    expect(isPick(v(5, 'reject'))).toBe(false);
    expect(isPick(v(3))).toBe(false);
    expect(isPick(undefined)).toBe(false);
  });
});
