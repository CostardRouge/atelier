import { describe, expect, it } from 'vitest';
import { fileKey, makeDecodedCache } from './decoded-cache';

describe('makeDecodedCache', () => {
  it('recalls what it holds, and counts a recall as a use', () => {
    const cache = makeDecodedCache<string>(() => 100);
    cache.remember('a', 'A', 40);
    cache.remember('b', 'B', 40);
    expect(cache.recall('a')).toBe('A');
    // `a` was just used; `c` pushes the total past the ceiling and `b` goes.
    cache.remember('c', 'C', 40);
    expect(cache.keys().sort()).toEqual(['a', 'c']);
    expect(cache.recall('b')).toBe(null);
    expect(cache.size()).toBe(80);
  });

  it('never lets go of the entry used last, even alone over the ceiling', () => {
    const cache = makeDecodedCache<number>(() => 10);
    cache.remember('big', 1, 50);
    expect(cache.recall('big')).toBe(1);
    cache.remember('bigger', 2, 60);
    expect(cache.keys()).toEqual(['bigger']);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('keys a file by name, weight and instant', () => {
    expect(fileKey({ name: 'DJI_0101.DNG', size: 74_000_000, lastModified: 1700000000000 })).toBe('DJI_0101.DNG:74000000:1700000000000');
  });
});
