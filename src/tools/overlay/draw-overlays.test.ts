import { describe, expect, it } from 'vitest';
import {
  anchorOrigin,
  anchorPoint,
  hitTest,
  type ElementBox,
} from './draw-overlays';
import type { Anchor } from './overlay-types';

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

describe('anchorPoint', () => {
  const w = 100;
  const h = 40;

  it('reads the anchor point back from a box top-left (inverse of anchorOrigin)', () => {
    // Box top-left at (400, 260): its bottom-right anchor point is (500, 300).
    expect(anchorPoint('bottom-right', 400, 260, w, h)).toEqual({ x: 500, y: 300 });
    expect(anchorPoint('top-left', 400, 260, w, h)).toEqual({ x: 400, y: 260 });
    expect(anchorPoint('center', 400, 260, w, h)).toEqual({ x: 450, y: 280 });
  });

  it('round-trips with anchorOrigin for every anchor (re-anchor stays in place)', () => {
    const anchors: Anchor[] = [
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ];
    // A box fixed on screen; switching anchor must keep its top-left identical.
    const topLeft = { x: 123, y: 45 };
    for (const a of anchors) {
      const ap = anchorPoint(a, topLeft.x, topLeft.y, w, h);
      expect(anchorOrigin(a, ap.x, ap.y, w, h)).toEqual(topLeft);
    }
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
