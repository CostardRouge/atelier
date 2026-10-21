import { describe, expect, it } from 'vitest';
import { revealScroll } from './band-reveal';

// A phone's band: 84 px cells 5 px apart after a 6 px pad, 369 px on screen.
const at = (i: number) => 6 + i * 89;
const max = at(23) + 84 + 6 - 369;

describe('revealScroll', () => {
  it('leaves the band still while the open cell is in view', () => {
    expect(revealScroll(at(2), 84, 0, 369, max, 6)).toBeNull();
    expect(revealScroll(at(5), 84, 200, 369, max, 6)).toBeNull();
  });

  it('centres a cell that has left the screen, on either side', () => {
    // Stepping onto the fifth picture from the start: centred, not edged.
    expect(revealScroll(at(4), 84, 0, 369, max, 6)).toBe(Math.round(at(4) + 42 - 184.5));
    expect(revealScroll(at(3), 84, 600, 369, max, 6)).toBe(Math.round(at(3) + 42 - 184.5));
  });

  it('stops at the two ends of the roll', () => {
    expect(revealScroll(at(0), 84, 500, 369, max, 6)).toBe(0);
    expect(revealScroll(at(23), 84, 0, 369, max, 6)).toBe(max);
  });

  it('answers null before the scroller has a size', () => {
    expect(revealScroll(at(9), 84, 0, 0, max, 6)).toBeNull();
  });
});
