import { describe, expect, it } from 'vitest';
import { instantOf, orderPicks } from './pick-order';

const picks = [
  { key: 'c', at: 300 },
  { key: 'x', at: null },
  { key: 'a', at: 100 },
  { key: 'b', at: 200 },
];

describe('orderPicks', () => {
  it('keeps the tick order unless asked for time', () => {
    expect(orderPicks(picks, false)).toEqual(['c', 'x', 'a', 'b']);
  });

  it('sorts by the time taken, the undated after the dated in tick order', () => {
    expect(orderPicks(picks, true)).toEqual(['a', 'b', 'c', 'x']);
    expect(orderPicks([{ key: 'p', at: null }, { key: 'q', at: null }], true)).toEqual(['p', 'q']);
  });

  it('breaks a tie by the tick order', () => {
    expect(orderPicks([{ key: 'm', at: 5 }, { key: 'n', at: 5 }], true)).toEqual(['m', 'n']);
  });
});

describe('instantOf', () => {
  it('reads a date and refuses nothing', () => {
    expect(instantOf('2026-01-03T10:00:00Z')).toBe(Date.parse('2026-01-03T10:00:00Z'));
    expect(instantOf(null)).toBeNull();
    expect(instantOf('not a date')).toBeNull();
  });
});
