import { describe, expect, it } from 'vitest';
import { EDGE_WIDTH, edgeGap, edgeLeft, edgePaint } from './slider-edge';

// A 36 px bar: a name from 12 to 90, a value from 340 to 390, both 14 px tall
// around the middle.
const name = { left: 12, right: 90, top: 11, bottom: 25 };
const value = { left: 340, right: 390, top: 12, bottom: 24 };

describe('edgeLeft', () => {
  it('centres the line on the value', () => {
    expect(edgeLeft(0.5, 400)).toBe(200 - EDGE_WIDTH / 2);
  });

  it('keeps the line inside the bar at both ends', () => {
    expect(edgeLeft(0, 400)).toBe(0);
    expect(edgeLeft(1, 400)).toBe(400 - EDGE_WIDTH);
  });
});

describe('edgeGap', () => {
  it('leaves the line whole where it crosses no piece', () => {
    expect(edgeGap(edgeLeft(0.5, 400), [name, value], 36)).toBeNull();
  });

  it('opens it over the height of the piece it crosses, plus the clearance', () => {
    expect(edgeGap(50, [name, value], 36)).toEqual({ from: 8 / 36, to: 28 / 36 });
    expect(edgeGap(edgeLeft(0.9, 400), [name, value], 36)).toEqual({ from: 9 / 36, to: 27 / 36 });
  });

  it('opens it already within the clearance beside a piece, and not beyond', () => {
    expect(edgeGap(91, [name], 36)).not.toBeNull();
    expect(edgeGap(93, [name], 36)).toBeNull();
    expect(edgeGap(8, [name], 36)).not.toBeNull();
    expect(edgeGap(7, [name], 36)).toBeNull();
  });

  it('takes the union in height of every piece the line crosses', () => {
    const dot = { left: 4, right: 10, top: 15, bottom: 21 };
    const swatch = { left: 8, right: 14, top: 6, bottom: 30 };
    expect(edgeGap(8, [dot, swatch, name], 36)).toEqual({ from: 3 / 36, to: 33 / 36 });
  });

  it('clips the gap to the bar and ignores empty boxes', () => {
    expect(edgeGap(20, [{ left: 10, right: 30, top: -4, bottom: 40 }], 36)).toEqual({ from: 0, to: 1 });
    expect(edgeGap(20, [{ left: 0, right: 0, top: 0, bottom: 0 }], 36)).toBeNull();
    expect(edgeGap(20, [name], 0)).toBeNull();
  });
});

describe('edgePaint', () => {
  it('paints a whole line solid', () => {
    expect(edgePaint(null)).toBe('var(--color-accent)');
  });

  it('paints an open line as a gradient with a transparent band', () => {
    expect(edgePaint({ from: 0.25, to: 0.75 })).toBe(
      'linear-gradient(to bottom, var(--color-accent) 0 25%, transparent 25% 75%, var(--color-accent) 75%)',
    );
  });
});
