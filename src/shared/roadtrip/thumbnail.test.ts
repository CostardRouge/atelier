import { describe, expect, it } from 'vitest';
import { THUMB_LONG_EDGE, thumbSize } from './thumbnail';

describe('thumbSize', () => {
  it('fits the longest edge, keeping the shape', () => {
    expect(thumbSize(720, 900, 224)).toEqual({ w: 179, h: 224 });
    expect(thumbSize(900, 720, 224)).toEqual({ w: 224, h: 179 });
  });

  it('never upscales — a small preview stays small', () => {
    expect(thumbSize(120, 150, 224)).toEqual({ w: 120, h: 150 });
  });

  it('keeps a square square', () => {
    expect(thumbSize(600, 600)).toEqual({ w: THUMB_LONG_EDGE, h: THUMB_LONG_EDGE });
  });

  it('never returns a zero side for a very wide source', () => {
    const { w, h } = thumbSize(4000, 20, 224);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('is nothing at all for an empty canvas', () => {
    expect(thumbSize(0, 0)).toEqual({ w: 0, h: 0 });
  });
});
