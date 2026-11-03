import { describe, expect, it } from 'vitest';
import { CAPTION_LOOK_DEFAULTS, captionEdges, captionLook, layCaption, readCaptionLook } from './caption-layout';

/** Half an em a letter, as the tests measure text. */
const measure = (w: string, size: number) => w.length * size * 0.5;
const BASE = { x: 90, baseline: 1450, size: 58, lineHeight: 1.22 };

describe('caption layout', () => {
  it('draws a short caption exactly as before', () => {
    const laid = layCaption('One trip, a hundred thousand pictures.', measure, captionLook(), BASE);
    expect(laid.size).toBe(58);
    expect(laid.baseline).toBe(1450);
    expect(laid.lines.length).toBeLessThanOrEqual(2);
  });
  it('shrinks a long one to its line limit, or lets it grow when asked', () => {
    const long = 'word '.repeat(24).trim();
    const shrunk = layCaption(long, measure, captionLook(), BASE);
    expect(shrunk.lines.length).toBeLessThanOrEqual(3);
    expect(shrunk.size).toBeLessThan(58);
    const free = layCaption(long, measure, captionLook({ long: 'grow' }), BASE);
    expect(free.size).toBe(58);
    expect(free.lines.length).toBeGreaterThan(3);
    expect(free.top).toBeLessThan(shrunk.top);
  });
  it('stops at the floor rather than vanish', () => {
    const laid = layCaption('word '.repeat(400).trim(), measure, captionLook(), BASE);
    expect(laid.size).toBeCloseTo(58 * 0.6);
    expect(laid.lines.length).toBeGreaterThan(3);
  });
  it('keeps clear of the buttons: the action column and the caption band, moved or not', () => {
    const e = captionEdges('all');
    expect(e.right).toBeCloseTo(0.84 * 1080 - 16);
    expect(e.bottom).toBeCloseTo(0.78 * 1920 - 16);
    expect(captionEdges('none').bottom).toBe(Infinity);
    const wide = layCaption('word '.repeat(10).trim(), measure, captionLook({ column: 0.92 }), BASE);
    for (const L of wide.lines) expect(L.reduce((s, w) => s + w.ww, 0) + (L.length - 1) * measure(' ', wide.size)).toBeLessThanOrEqual(e.right - 90 + 1e-6);
    const moved = layCaption('A caption', measure, captionLook(), BASE, 200);
    expect(moved.baseline + 200 + moved.size * 0.25).toBeLessThanOrEqual(e.bottom + 1e-6);
  });
  it('reads a script leniently', () => {
    expect(readCaptionLook({ column: 2, maxLines: 0, long: 'x', edge: 'reels' })).toEqual({ column: 0.92, maxLines: 1, edge: 'reels' });
    expect(captionLook(undefined)).toEqual(CAPTION_LOOK_DEFAULTS);
  });
});
