import { describe, expect, it } from 'vitest';
import { thumbWindowStep } from './thumb-window';

describe('thumbWindowStep', () => {
  it('reads everything the first time', () => {
    expect(thumbWindowStep([], ['a', 'b'])).toEqual({ missing: ['a', 'b'], dropped: [] });
  });

  it('moving a window by one month reads only the month that came in', () => {
    const held = ['jan1', 'jan2', 'feb1', 'mar1'];
    const wanted = ['feb1', 'mar1', 'apr1', 'apr2'];
    expect(thumbWindowStep(held, wanted)).toEqual({ missing: ['apr1', 'apr2'], dropped: ['jan1', 'jan2'] });
  });

  it('the same window reads nothing and drops nothing', () => {
    expect(thumbWindowStep(['a', 'b'], ['b', 'a'])).toEqual({ missing: [], dropped: [] });
  });

  it('an empty window lets everything go', () => {
    expect(thumbWindowStep(['a', 'b'], [])).toEqual({ missing: [], dropped: ['a', 'b'] });
  });

  it('a repeated id is read once', () => {
    expect(thumbWindowStep([], ['a', 'a'])).toEqual({ missing: ['a'], dropped: [] });
  });
});
