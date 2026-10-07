import { describe, expect, it } from 'vitest';
import { EDGE_STEP, EDGE_ZONE, dropIndex, edgeScrollStep } from './list-reorder';

/** Rows 30 px tall, drawn from y = 0: middles 15, 45, 75, 105. */
const MIDS = [15, 45, 75, 105];

describe('dropIndex', () => {
  it('stays put while the pointer is on the held row', () => {
    expect(dropIndex(MIDS, 1, 31)).toBe(1);
    expect(dropIndex(MIDS, 1, 59)).toBe(1);
  });

  it('moves on only past a NEIGHBOUR’s middle', () => {
    expect(dropIndex(MIDS, 1, 74)).toBe(1);
    expect(dropIndex(MIDS, 1, 76)).toBe(2);
    expect(dropIndex(MIDS, 1, 16)).toBe(1);
    expect(dropIndex(MIDS, 1, 14)).toBe(0);
  });

  it('is stable once the list is redrawn in the new order', () => {
    // Held row 1 crossed row 2's middle (75) and is now drawn third: the
    // pointer, still at 76, sits on it — no flicker back.
    expect(dropIndex(MIDS, 1, 76)).toBe(2);
    expect(dropIndex(MIDS, 2, 76)).toBe(2);
  });

  it('clamps to the ends without counting the held row', () => {
    expect(dropIndex(MIDS, 0, -500)).toBe(0);
    expect(dropIndex(MIDS, 0, 5000)).toBe(3);
    expect(dropIndex(MIDS, 3, 5000)).toBe(3);
  });

  it('counts every row when the held one is not drawn', () => {
    expect(dropIndex(MIDS, -1, 5000)).toBe(4);
  });
});

describe('edgeScrollStep', () => {
  const top = 100;
  const bottom = 500;

  it('does nothing in the middle of the box', () => {
    expect(edgeScrollStep(300, top, bottom)).toBe(0);
    expect(edgeScrollStep(top + EDGE_ZONE + 1, top, bottom)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom, faster the deeper', () => {
    const shallow = edgeScrollStep(top + EDGE_ZONE - 4, top, bottom);
    const deep = edgeScrollStep(top + 4, top, bottom);
    expect(shallow).toBeLessThan(0);
    expect(deep).toBeLessThan(shallow);
    expect(edgeScrollStep(bottom - 4, top, bottom)).toBeGreaterThan(0);
  });

  it('is at its most past the edge, never more', () => {
    expect(edgeScrollStep(top - 300, top, bottom)).toBe(-EDGE_STEP);
    expect(edgeScrollStep(bottom + 300, top, bottom)).toBe(EDGE_STEP);
  });

  it('shares a short box between its two bands', () => {
    expect(edgeScrollStep(130, 100, 160)).toBe(0);
    expect(edgeScrollStep(101, 100, 160)).toBeLessThan(0);
    expect(edgeScrollStep(159, 100, 160)).toBeGreaterThan(0);
  });

  it('refuses a box with no height and a pointer it cannot place', () => {
    expect(edgeScrollStep(100, 100, 100)).toBe(0);
    expect(edgeScrollStep(Number.NaN, top, bottom)).toBe(0);
  });
});
