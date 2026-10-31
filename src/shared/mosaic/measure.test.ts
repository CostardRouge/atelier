import { describe, expect, it } from 'vitest';
import type { Raster } from '../media/thumb-metrics';
import { GRID, GRID_BYTES, decodeGrid, descriptorsOf, dimsOf, encodeGrid, gridOf, gridOfRect, levelOf, meanOf, oklab, oklabOf } from './measure';

/** A raster painted by a function of (x, y) → [r, g, b]. */
function raster(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('gridOf', () => {
  it('reads a flat picture as 36 copies of its colour', () => {
    const grid = gridOf(raster(24, 24, () => [10, 20, 30]));
    expect(grid.length).toBe(GRID_BYTES);
    for (let c = 0; c < 36; c++) expect([grid[c * 3], grid[c * 3 + 1], grid[c * 3 + 2]]).toEqual([10, 20, 30]);
  });

  it('keeps a left/right split in the grid columns, whatever the raster size', () => {
    for (const size of [12, 24, 97]) {
      const grid = gridOf(raster(size, size, (x) => (x < size / 2 ? [255, 0, 0] : [0, 0, 255])));
      for (let gy = 0; gy < GRID; gy++) {
        expect(grid[(gy * GRID + 0) * 3]).toBe(255);
        expect(grid[(gy * GRID + 5) * 3 + 2]).toBe(255);
        expect(grid[(gy * GRID + 5) * 3]).toBe(0);
      }
    }
  });

  it('averages inside a cell (a 2-pixel cell with white and black reads mid grey)', () => {
    const grid = gridOf(raster(12, 6, (x) => (x % 2 === 0 ? [255, 255, 255] : [0, 0, 0])));
    for (let c = 0; c < 36; c++) expect(grid[c * 3]).toBe(128);
  });

  it('survives a raster smaller than the grid', () => {
    const grid = gridOf(raster(2, 3, (x, y) => [x * 100, y * 50, 7]));
    expect(grid.length).toBe(GRID_BYTES);
    expect(grid[0]).toBe(0);
    expect(grid[(5 * GRID + 5) * 3]).toBe(100);
  });

  it('gridOfRect reads only its rectangle', () => {
    const r = raster(20, 10, (x) => (x < 10 ? [200, 0, 0] : [0, 200, 0]));
    const left = gridOfRect(r, 0, 0, 10, 10) as Uint8Array;
    const right = gridOfRect(r, 10, 0, 20, 10) as Uint8Array;
    expect(left[0]).toBe(200);
    expect(left[1]).toBe(0);
    expect(right[0]).toBe(0);
    expect(right[1]).toBe(200);
  });
});

describe('encodeGrid / decodeGrid', () => {
  it('round-trips every byte in 144 characters', () => {
    const grid = new Uint8Array(GRID_BYTES).map((_, i) => (i * 37) % 256);
    const text = encodeGrid(grid);
    expect(text.length).toBe(144);
    expect(Array.from(decodeGrid(text)!)).toEqual(Array.from(grid));
  });

  it('refuses what is not a grid', () => {
    expect(decodeGrid(undefined)).toBeNull();
    expect(decodeGrid('')).toBeNull();
    expect(decodeGrid('a'.repeat(143))).toBeNull();
    expect(decodeGrid('!'.repeat(144))).toBeNull();
    expect(decodeGrid('A'.repeat(142) + '==')).toBeNull();
  });
});

describe('levels', () => {
  it('dimsOf counts three numbers per block', () => {
    expect([dimsOf(1), dimsOf(2), dimsOf(3)]).toEqual([3, 12, 27]);
  });

  it('level 1 is the mean colour, level 2 the quarters', () => {
    const grid = gridOf(raster(24, 24, (x, y) => (x < 12 ? (y < 12 ? [255, 0, 0] : [0, 255, 0]) : y < 12 ? [0, 0, 255] : [255, 255, 255])));
    const l1 = levelOf(grid, 1, 1);
    expect(Array.from(l1).map(Math.round)).toEqual([128, 128, 128]);
    expect(meanOf(grid)).toEqual([128, 128, 128]);
    const l2 = levelOf(grid, 1, 2);
    expect(Array.from(l2.slice(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(l2.slice(3, 6))).toEqual([0, 0, 255]);
    expect(Array.from(l2.slice(6, 9))).toEqual([0, 255, 0]);
    expect(Array.from(l2.slice(9, 12))).toEqual([255, 255, 255]);
  });

  it('level 3 keeps a horizontal stripe in its middle row', () => {
    const grid = gridOf(raster(18, 18, (_x, y) => (y >= 6 && y < 12 ? [0, 0, 0] : [255, 255, 255])));
    const l3 = levelOf(grid, 1, 3);
    expect(l3[0]).toBe(255);
    expect(l3[(1 * 3 + 1) * 3]).toBe(0);
    expect(l3[(2 * 3 + 2) * 3]).toBe(255);
  });

  it('folds several grids at once', () => {
    const grids = new Uint8Array(GRID_BYTES * 2);
    grids.fill(10, 0, GRID_BYTES);
    grids.fill(200, GRID_BYTES);
    const l1 = levelOf(grids, 2, 1);
    expect(Array.from(l1)).toEqual([10, 10, 10, 200, 200, 200]);
  });
});

describe('oklab', () => {
  it('puts white at L 100 and black at L 0, both neutral', () => {
    const out = new Float32Array(6);
    oklab(255, 255, 255, out, 0);
    oklab(0, 0, 0, out, 3);
    expect(out[0]).toBeCloseTo(100, 0);
    expect(Math.abs(out[1])).toBeLessThan(0.1);
    expect(Math.abs(out[2])).toBeLessThan(0.1);
    expect(out[3]).toBeCloseTo(0, 1);
  });

  it('separates a dark blue from a dark green more than RGB does, relative to their lightness', () => {
    const rgb = new Uint8Array([0, 0, 40, 0, 40, 0]);
    const lab = oklabOf(rgb, 2);
    const dRgb = Math.hypot(0, -40, 40);
    const dLab = Math.hypot(lab[0] - lab[3], lab[1] - lab[4], lab[2] - lab[5]);
    expect(lab[2]).toBeLessThan(0);
    expect(lab[4]).toBeLessThan(0);
    expect(dLab).toBeGreaterThan(dRgb * 0.3);
  });

  it('descriptorsOf picks the space and the level', () => {
    const grid = gridOf(raster(12, 12, () => [255, 255, 255]));
    expect(Array.from(descriptorsOf(grid, 1, 1, 'rgb'))).toEqual([255, 255, 255]);
    const lab = descriptorsOf(grid, 1, 1, 'oklab');
    expect(lab.length).toBe(3);
    expect(lab[0]).toBeCloseTo(100, 0);
  });
});
