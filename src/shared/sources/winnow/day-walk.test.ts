import { describe, expect, it } from 'vitest';
import {
  deckEntry,
  firstWindow,
  nearestMediaDay,
  pageDirection,
  restWindow,
} from './day-walk';

const day = { from: '2025-03-25', to: '2025-03-25' };
const span = { from: '2025-03-25', to: '2025-03-27' };
const today = '2026-09-13';

describe('nearestMediaDay', () => {
  const days = [
    { date: '2025-03-30', count: 2 },
    { date: '2025-03-20', count: 3 },
    { date: '2025-03-26', count: 6 },
    { date: '2025-03-24', count: 0 },
    { date: '2025-03-22', count: 1 },
  ];

  it('takes the closest day with media on the side asked, in any order', () => {
    expect(nearestMediaDay(days, day, 'after')).toEqual({ date: '2025-03-26', count: 6 });
    expect(nearestMediaDay(days, day, 'before')).toEqual({ date: '2025-03-22', count: 1 });
  });

  it('skips days inside the span and days that hold nothing', () => {
    expect(nearestMediaDay(days, span, 'after')).toEqual({ date: '2025-03-30', count: 2 });
    expect(nearestMediaDay([{ date: '2025-03-24', count: 0 }], day, 'before')).toBeNull();
  });
});

describe('firstWindow', () => {
  it('reaches two months out from the edge of the span', () => {
    expect(firstWindow(span, 'after', today)).toEqual({ from: '2025-03-28', to: '2025-05-28' });
    expect(firstWindow(span, 'before', today)).toEqual({ from: '2025-01-22', to: '2025-03-24' });
  });

  it('stops at today, and is null when there is no later day to look at', () => {
    expect(firstWindow({ from: '2026-09-01', to: '2026-09-01' }, 'after', today)).toEqual({
      from: '2026-09-02',
      to: today,
    });
    expect(firstWindow({ from: today, to: today }, 'after', today)).toBeNull();
  });
});

describe('restWindow', () => {
  const bounds = { min: '2019-06-01', max: '2026-08-30' };

  it('asks the rest of the way to the edge of the library', () => {
    expect(restWindow({ from: '2025-03-28', to: '2025-05-28' }, 'after', bounds, today)).toEqual({
      from: '2025-05-29',
      to: '2026-08-30',
    });
    expect(restWindow({ from: '2025-01-22', to: '2025-03-24' }, 'before', bounds, today)).toEqual({
      from: '2019-06-01',
      to: '2025-01-21',
    });
  });

  it('is null once the first window already reached the edge, or with no bounds', () => {
    expect(restWindow({ from: '2026-07-01', to: '2026-08-31' }, 'after', bounds, today)).toBeNull();
    expect(restWindow({ from: '2019-05-01', to: '2019-07-01' }, 'before', bounds, today)).toBeNull();
    expect(restWindow({ from: '2025-03-28', to: '2025-05-28' }, 'after', null, today)).toBeNull();
  });
});

describe('deckEntry', () => {
  it('reads [before, ...body, after]', () => {
    expect(deckEntry(0, 3)).toEqual({ kind: 'edge', side: 'before' });
    expect(deckEntry(1, 3)).toEqual({ kind: 'body', index: 0 });
    expect(deckEntry(3, 3)).toEqual({ kind: 'body', index: 2 });
    expect(deckEntry(4, 3)).toEqual({ kind: 'edge', side: 'after' });
  });
});

describe('pageDirection', () => {
  it('tells forward from back, across the wrap', () => {
    expect(pageDirection(1, 2, 5)).toBe(1);
    expect(pageDirection(2, 1, 5)).toBe(-1);
    expect(pageDirection(4, 0, 5)).toBe(1);
    expect(pageDirection(0, 4, 5)).toBe(-1);
    expect(pageDirection(1, 2, 3)).toBe(1);
    expect(pageDirection(0, 2, 3)).toBe(-1);
  });
});
