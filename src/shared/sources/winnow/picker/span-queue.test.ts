import { describe, expect, it } from 'vitest';
import { nextParts, partOf } from './span-queue';

describe('nextParts', () => {
  it('starts what is wanted first, in its order, up to the limit', () => {
    expect(nextParts(['idle', 'idle', 'idle', 'idle'], [3, 1, 0])).toEqual({ start: [3, 1], abort: [] });
  });
  it('fills the rest in order, one at a time, when nothing wanted waits', () => {
    expect(nextParts(['done', 'idle', 'idle'], [0])).toEqual({ start: [1], abort: [] });
    expect(nextParts(['done', 'loading', 'idle'], [])).toEqual({ start: [], abort: [] });
  });
  it('aborts a part nobody looks at for one somebody jumped to', () => {
    expect(nextParts(['loading', 'loading', 'idle', 'idle'], [3, 1])).toEqual({ start: [3], abort: [0] });
  });
  it('never aborts what is still wanted, and asks a failed part again only when wanted', () => {
    expect(nextParts(['loading', 'loading', 'idle'], [0, 1, 2])).toEqual({ start: [], abort: [] });
    expect(nextParts(['failed', 'done'], [])).toEqual({ start: [], abort: [] });
    expect(nextParts(['failed', 'done'], [0])).toEqual({ start: [0], abort: [] });
  });
  it('ignores what is out of range or done', () => {
    expect(nextParts(['done', 'done'], [0, 1, 7])).toEqual({ start: [], abort: [] });
  });
});

describe('partOf', () => {
  it('finds the part holding a day', () => {
    const parts = [
      { from: '2025-01-01', to: '2025-03-10' },
      { from: '2025-03-11', to: '2025-12-31' },
    ];
    expect(partOf(parts, '2025-03-10')).toBe(0);
    expect(partOf(parts, '2025-03-11')).toBe(1);
    expect(partOf(parts, '2026-01-01')).toBe(-1);
  });
});
