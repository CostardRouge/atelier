import { describe, expect, it } from 'vitest';
import { coverWindow, isDefaultFrame, panFrame, readFrame, sourceRect, zoomFrame } from './recap-frame';

describe('recap framing', () => {
  it('covers the box, centred, by default', () => {
    // A 1600×900 clip behind a 9:16 page: its middle strip.
    const w = coverWindow(1600, 900, 1080, 1920);
    expect(w.sh).toBeCloseTo(900);
    expect(w.sw).toBeCloseTo(506.25);
    expect(w.sx).toBeCloseTo((1600 - 506.25) / 2);
  });

  it('keeps the focus in view, and never shows past the source', () => {
    const left = coverWindow(1600, 900, 1080, 1920, { x: 0.1, y: 0.5, zoom: 1 });
    // The focus at 160 px wants a window from −93 px: held at the source's edge.
    expect(left.sx).toBe(0);
    const edge = coverWindow(1600, 900, 1080, 1920, { x: 0, y: 0, zoom: 2 });
    expect(edge.sx).toBe(0);
    expect(edge.sy).toBe(0);
    expect(edge.sh).toBeCloseTo(450);
  });

  it('pans with the pointer and re-centres on what is shown', () => {
    const f = panFrame({ x: 0.5, y: 0.5, zoom: 1 }, 100, 0, 1600, 900, 1080, 1920);
    expect(f.x).toBeLessThan(0.5);
    // Dragged far past the left edge: the focus is the edge's, not beyond it.
    const far = panFrame({ x: 0.5, y: 0.5, zoom: 1 }, 99999, 0, 1600, 900, 1080, 1920);
    expect(far.x).toBeCloseTo(506.25 / 2 / 1600);
    expect(zoomFrame(f, 9).zoom).toBe(4);
  });

  it('reads untrusted frames and stores none for the default', () => {
    expect(readFrame({ x: 2, y: -1, zoom: 0 })).toEqual({ x: 1, y: 0, zoom: 1 });
    expect(readFrame({ x: 0.5, y: 0.5, zoom: 1 })).toBeUndefined();
    expect(readFrame('nope')).toBeUndefined();
    expect(isDefaultFrame(undefined)).toBe(true);
  });

  it('places the whole source around the window it shows', () => {
    // A 2:1 picture in a square cell at 100,100 of side 200, centred: the picture is 400 wide, 100 out each side.
    const r = sourceRect(2000, 1000, { x: 100, y: 100, w: 200, h: 200 });
    expect(r.w).toBeCloseTo(400);
    expect(r.h).toBeCloseTo(200);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(100);
    // Zoomed ×2 on its left edge: the cell shows the picture's left quarter.
    const z = sourceRect(2000, 1000, { x: 100, y: 100, w: 200, h: 200 }, { x: 0, y: 0.5, zoom: 2 });
    expect(z.x).toBeCloseTo(100);
    expect(z.w).toBeCloseTo(800);
  });
});
