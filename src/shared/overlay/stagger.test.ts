import { describe, expect, it } from 'vitest';
import type { Rect } from '../media/compose-layout';
import { normaliseStagger, staggerDelays, staggerRanks, staggerSettle } from './stagger';

const frame = { w: 1000, h: 2000 };
// A 2 × 2 grid: tl, tr, bl, br.
const grid: Rect[] = [
  { x: 0, y: 0, w: 500, h: 1000 },
  { x: 500, y: 0, w: 500, h: 1000 },
  { x: 0, y: 1000, w: 500, h: 1000 },
  { x: 500, y: 1000, w: 500, h: 1000 },
];

describe('staggerRanks', () => {
  it('counts in sequence and in reverse', () => {
    expect(staggerRanks(grid, frame, 'sequence')).toEqual([0, 1, 2, 3]);
    expect(staggerRanks(grid, frame, 'reverse')).toEqual([3, 2, 1, 0]);
    expect(staggerRanks([], frame, 'rows')).toEqual([]);
  });

  it('lands a whole row, or a whole column, at once', () => {
    expect(staggerRanks(grid, frame, 'rows')).toEqual([0, 0, 1, 1]);
    expect(staggerRanks(grid, frame, 'columns')).toEqual([0, 1, 0, 1]);
  });

  it('ties four equidistant cells from the centre, and orders a hero first', () => {
    expect(staggerRanks(grid, frame, 'center-out')).toEqual([0, 0, 0, 0]);
    const hero: Rect[] = [
      { x: 0, y: 0, w: 1000, h: 1000 },
      { x: 0, y: 1000, w: 500, h: 1000 },
      { x: 500, y: 1000, w: 500, h: 1000 },
    ];
    expect(staggerRanks(hero, frame, 'size')).toEqual([0, 1, 1]);
    expect(staggerRanks(hero, frame, 'center-out')[0]).toBe(0);
    expect(staggerRanks(hero, frame, 'edges-in')[0]).toBe(1);
  });

  it('shuffles the same way for the same seed, and differently for another', () => {
    const a = staggerRanks(grid, frame, 'random', 7);
    const b = staggerRanks(grid, frame, 'random', 7);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => staggerRanks(grid, frame, 'random', s).join()));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('shares a rank within the tie band only', () => {
    const near: Rect[] = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 0, y: 10, w: 100, h: 100 }, // 10px apart: within 2% of 1000
      { x: 0, y: 60, w: 100, h: 100 }, // 60px: past it
    ];
    expect(staggerRanks(near, frame, 'rows')).toEqual([0, 0, 1]);
  });
});

describe('delays and settle', () => {
  it('turns ranks into seconds and settles after the last rank plus the step', () => {
    const delays = staggerDelays(grid, frame, { each: 0.25, order: 'rows' });
    expect(delays).toEqual([0, 0, 0.25, 0.25]);
    expect(staggerSettle(delays, { preset: 'fade', duration: 0.6, easing: 'out' })).toBeCloseTo(0.85);
    expect(staggerSettle(delays, { preset: 'none', duration: 0, easing: 'linear' })).toBe(0.25);
    expect(staggerSettle([], { preset: 'fade', duration: 0.6, easing: 'out' })).toBe(0);
  });

  it('reads a stagger out of junk and clamps it', () => {
    expect(normaliseStagger(undefined)).toEqual({ each: 0.1, order: 'sequence' });
    expect(normaliseStagger({ each: 9, order: 'sideways', seed: 4.6 })).toEqual({
      each: 1,
      order: 'sequence',
      seed: 5,
    });
    expect(normaliseStagger({ each: -1, order: 'rows' })).toEqual({ each: 0, order: 'rows' });
  });
});
