import { describe, expect, it } from 'vitest';
import { revealDelta } from './reveal';

describe('revealDelta', () => {
  it('moves nothing when the item is already whole in the view', () => {
    expect(revealDelta(120, 180, 100, 300)).toBe(0);
    expect(revealDelta(100, 300, 100, 300)).toBe(0);
  });

  it('scrolls up by the least that shows an item above the view', () => {
    expect(revealDelta(60, 110, 100, 300)).toBe(-40);
  });

  it('scrolls down by the least that shows an item below the view', () => {
    expect(revealDelta(280, 340, 100, 300)).toBe(40);
  });

  it('shows the START of an item longer than the view', () => {
    expect(revealDelta(150, 500, 100, 300)).toBe(50);
    expect(revealDelta(20, 500, 100, 300)).toBe(-80);
  });

  it('keeps a margin between the item and the edge it is revealed against', () => {
    expect(revealDelta(280, 340, 100, 300, 'nearest', 6)).toBe(46);
    expect(revealDelta(60, 110, 100, 300, 'nearest', 6)).toBe(-46);
    expect(revealDelta(110, 290, 100, 300, 'nearest', 6)).toBe(0);
  });

  it('centres and aligns on request', () => {
    expect(revealDelta(400, 440, 100, 300, 'center')).toBe(220);
    expect(revealDelta(400, 440, 100, 300, 'start')).toBe(300);
  });
});
