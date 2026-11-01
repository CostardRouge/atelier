import { describe, expect, it } from 'vitest';
import { pictureFor, readWallGrid, wallCells, wallLayout, WALL_DEFAULTS } from './wall-grid';

describe('wallLayout', () => {
  it('lays the default exactly as the wall was first drawn: 11 × 19 cells of 108 px, its centre on the frame’s', () => {
    const { rects, cellW, cellH } = wallLayout();
    expect(cellW).toBe(108);
    expect(cellH).toBe(108);
    expect(rects).toHaveLength(11 * 19);
    expect(rects[0]).toMatchObject({ x: -54, y: -66, w: 108, h: 108 });
    const centre = rects.filter((r) => r.centre);
    expect(centre).toHaveLength(1);
    expect(centre[0].x + centre[0].w / 2).toBe(540);
    expect(centre[0].y + centre[0].h / 2).toBe(960);
    expect(centre[0].d).toBe(0);
  });

  it('covers the frame whatever the columns and rows', () => {
    for (const given of [{ cols: 3 }, { cols: 16 }, { cols: 7, rows: 9 }, { cols: 12, rows: 30 }]) {
      const { rects } = wallLayout(given);
      const xs = rects.map((r) => r.x), ys = rects.map((r) => r.y);
      expect(Math.min(...xs)).toBeLessThanOrEqual(0);
      expect(Math.max(...rects.map((r) => r.x + r.w))).toBeGreaterThanOrEqual(1080);
      expect(Math.min(...ys)).toBeLessThanOrEqual(0);
      expect(Math.max(...rects.map((r) => r.y + r.h))).toBeGreaterThanOrEqual(1920);
    }
    expect(wallLayout({ cols: 6, rows: 8 }).cellH).toBe(240);
  });

  it('gives big pictures 2 × 2 cells, never over the centre, and keeps every cell covered once', () => {
    const plain = wallLayout({ cols: 8 });
    const { rects, cellW } = wallLayout({ cols: 8, big: 0.3 });
    const bigs = rects.filter((r) => r.w === 2 * cellW);
    expect(bigs.length).toBeGreaterThan(0);
    const area = (list: typeof rects) => list.reduce((n, r) => n + r.w * r.h, 0);
    expect(area(rects)).toBeCloseTo(area(plain.rects));
    expect(rects.length).toBe(plain.rects.length - 3 * bigs.length);
    expect(rects.filter((r) => r.centre)).toHaveLength(1);
    expect(wallLayout({ cols: 8, big: 0.3 })).toBe(wallLayout({ cols: 8, big: 0.3 }));
  });

  it('orders the places along the rows, down the columns or out from the centre', () => {
    const cols = wallLayout({ cols: 5, order: 'columns' }).rects;
    expect(cols[1].x).toBe(cols[0].x);
    expect(cols[1].y).toBeGreaterThan(cols[0].y);
    const centre = wallLayout({ cols: 5, order: 'centre' }).rects;
    expect(centre[0].centre).toBe(true);
    expect(centre.every((r, i) => i === 0 || r.d >= centre[i - 1].d)).toBe(true);
    const shuffled = wallLayout({ cols: 5, order: 'shuffle' }).rects;
    expect(shuffled).toHaveLength(wallCells({ cols: 5 }));
  });
});

describe('pictureFor', () => {
  it('spreads the pictures over the places in day order', () => {
    expect([0, 1, 2, 3].map((i) => pictureFor(i, 4, 2))).toEqual([0, 0, 1, 1]);
    expect([0, 1].map((i) => pictureFor(i, 2, 10))).toEqual([0, 5]);
    expect(pictureFor(0, 4, 0)).toBe(-1);
  });
});

describe('readWallGrid', () => {
  it('keeps what is well formed, inside its bounds', () => {
    expect(readWallGrid({ cols: 40, rows: -1, gap: 3, order: 'spiral', big: 2, zoom: 'x' })).toEqual({ cols: 16, rows: 0, gap: 3, big: 0.5 });
    expect(readWallGrid('nope')).toBeUndefined();
    expect(readWallGrid({})).toBeUndefined();
    expect(WALL_DEFAULTS.cols).toBe(10);
  });
});
