import { describe, expect, it } from 'vitest';
import { anchorOrigin, hitTest, type ElementBox } from './draw-overlays';

// Geometry only — no canvas. `layoutElement`/`drawOverlays` need a real 2D
// context (font metrics), so they're exercised manually in the browser; the
// pure positioning math that decides *where* things land is tested here.

describe('anchorOrigin', () => {
  const w = 100;
  const h = 40;
  const ax = 500;
  const ay = 300;

  it('places top-left so the anchor point is the box top-left', () => {
    expect(anchorOrigin('top-left', ax, ay, w, h)).toEqual({ x: 500, y: 300 });
  });

  it('places bottom-right so the anchor point is the box bottom-right', () => {
    expect(anchorOrigin('bottom-right', ax, ay, w, h)).toEqual({ x: 400, y: 260 });
  });

  it('centres the box on the anchor point for center', () => {
    expect(anchorOrigin('center', ax, ay, w, h)).toEqual({ x: 450, y: 280 });
  });

  it('handles mixed anchors (top-center, center-right)', () => {
    expect(anchorOrigin('top-center', ax, ay, w, h)).toEqual({ x: 450, y: 300 });
    expect(anchorOrigin('center-right', ax, ay, w, h)).toEqual({ x: 400, y: 280 });
    expect(anchorOrigin('bottom-center', ax, ay, w, h)).toEqual({ x: 450, y: 260 });
  });
});

describe('hitTest', () => {
  const boxes: ElementBox[] = [
    { id: 'a', x: 0, y: 0, w: 100, h: 100 },
    { id: 'b', x: 50, y: 50, w: 100, h: 100 }, // overlaps a, drawn later (on top)
  ];

  it('returns the id of the box under the point', () => {
    expect(hitTest(boxes, 10, 10)).toBe('a');
    expect(hitTest(boxes, 140, 140)).toBe('b');
  });

  it('returns the topmost (last-drawn) box when boxes overlap', () => {
    expect(hitTest(boxes, 60, 60)).toBe('b');
  });

  it('returns null when the point misses every box', () => {
    expect(hitTest(boxes, 300, 300)).toBeNull();
  });

  it('treats box edges as inside (inclusive bounds)', () => {
    expect(hitTest([{ id: 'a', x: 0, y: 0, w: 100, h: 100 }], 100, 100)).toBe('a');
  });

  it('returns null for an empty box list', () => {
    expect(hitTest([], 10, 10)).toBeNull();
  });
});
