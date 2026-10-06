import { describe, expect, it } from 'vitest';
import { makeBorrowedCache } from './borrowed-cache';

function cache(ceiling: number) {
  const disposed: string[] = [];
  const c = makeBorrowedCache<string>({ ceiling: () => ceiling, dispose: (v) => disposed.push(v) });
  return { c, disposed };
}

describe('makeBorrowedCache', () => {
  it('lends what it is given, and never evicts a value someone holds', () => {
    const { c, disposed } = cache(100);
    const a = c.give('a', 'A', 60);
    c.keep('b', 'B', 60);
    // `a` is borrowed: over the ceiling, it is `b` — free, and not the newest once `c` lands — that goes.
    c.keep('c', 'C', 30);
    expect(c.keys().sort()).toEqual(['a', 'c']);
    expect(disposed).toEqual(['B']);
    expect(c.borrow('b')).toBe(null);
    // Handed back, `a` is free and the oldest, so the next arrival lets it go.
    a.release();
    a.release();
    c.keep('d', 'D', 30);
    expect(c.keys().sort()).toEqual(['c', 'd']);
    expect(disposed).toEqual(['B', 'A']);
    expect(c.size()).toBe(60);
  });

  it('keeps the newest free value even alone over the ceiling', () => {
    const { c, disposed } = cache(10);
    c.keep('big', 'BIG', 50);
    expect(c.has('big')).toBe(true);
    c.keep('bigger', 'BIGGER', 60);
    expect(c.keys()).toEqual(['bigger']);
    expect(disposed).toEqual(['BIG']);
  });

  it('lets the first value under a key win, disposing a second unless it is the same', () => {
    const { c, disposed } = cache(1000);
    const first = c.give('p', 'ONE', 10);
    const second = c.give('p', 'TWO', 10);
    expect(second.value).toBe('ONE');
    expect(disposed).toEqual(['TWO']);
    c.keep('p', 'ONE', 10);
    expect(disposed).toEqual(['TWO']);
    expect(c.size()).toBe(10);
    first.release();
    second.release();
    expect(c.has('p')).toBe(true);
  });

  it('clears the free values now and a borrowed one on its last release', () => {
    const { c, disposed } = cache(1000);
    const one = c.borrow('x');
    expect(one).toBe(null);
    const held = c.give('x', 'X', 10);
    const again = c.borrow('x');
    c.keep('y', 'Y', 10);
    c.clear();
    expect(disposed).toEqual(['Y']);
    expect(c.keys()).toEqual([]);
    held.release();
    expect(disposed).toEqual(['Y']);
    again?.release();
    expect(disposed).toEqual(['Y', 'X']);
    // A value given after the clear is a fresh entry under the same key.
    c.give('x', 'X2', 10);
    expect(c.has('x')).toBe(true);
    expect(c.size()).toBe(10);
  });
});
