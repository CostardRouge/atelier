import { describe, expect, it } from 'vitest';
import { coverWindow, framedDraw, isDefaultFrame, panFrame, readFrame, rotateFrame, sourceRect, zoomFrame } from './recap-frame';

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

  it('turns a picture without ever leaving a corner empty', () => {
    for (const rotate of [-45, -12.5, 3, 30, 45]) {
      for (const [x, y] of [[0, 0], [0.5, 0.5], [1, 1]]) {
        const box = { x: 10, y: 20, w: 300, h: 500 };
        const d = framedDraw(1600, 900, box, { x, y, zoom: 1, rotate });
        const k = d.win.sw / d.w;
        for (const [px, py] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
          // The box's corner in the turned rectangle's own axes, then in the source.
          const rx = px - d.cx;
          const ry = py - d.cy;
          const ux = rx * Math.cos(-d.angle) - ry * Math.sin(-d.angle);
          const uy = rx * Math.sin(-d.angle) + ry * Math.cos(-d.angle);
          const sx = d.win.sx + (ux + d.w / 2) * k;
          const sy = d.win.sy + (uy + d.h / 2) * k;
          expect(sx).toBeGreaterThanOrEqual(-1e-6);
          expect(sy).toBeGreaterThanOrEqual(-1e-6);
          expect(sx).toBeLessThanOrEqual(1600 + 1e-6);
          expect(sy).toBeLessThanOrEqual(900 + 1e-6);
        }
      }
    }
  });

  it('reads, keeps and drops a turn', () => {
    expect(readFrame({ x: 0.5, y: 0.5, zoom: 1, rotate: 3.14159 })).toEqual({ x: 0.5, y: 0.5, zoom: 1, rotate: 3.1 });
    expect(readFrame({ x: 0.5, y: 0.5, zoom: 1, rotate: 0 })).toBeUndefined();
    expect(rotateFrame({ x: 0.5, y: 0.5, zoom: 2, rotate: 5 }, 90).rotate).toBe(45);
    expect(rotateFrame({ x: 0.5, y: 0.5, zoom: 2, rotate: 5 }, 0)).toEqual({ x: 0.5, y: 0.5, zoom: 2 });
    // A drag keeps the turn.
    expect(panFrame({ x: 0.5, y: 0.5, zoom: 2, rotate: 10 }, 20, 0, 1600, 900, 1080, 1920).rotate).toBe(10);
  });
});
