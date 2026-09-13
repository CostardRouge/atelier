import { describe, expect, it } from 'vitest';
import { CELL, GAP, MAX_FIT_CELL, MIN_FIT_CELL, fittedColumn, heatmapColumn, heatmapWidth } from './day-grid';

describe('heatmapColumn', () => {
  it('is the drawn size at 100%', () => {
    expect(heatmapColumn(1)).toEqual({ cellPx: CELL, gapPx: GAP });
  });

  it('rounds to whole pixels', () => {
    expect(heatmapColumn(1.3)).toEqual({ cellPx: 18, gapPx: 4 });
  });

  it('stops shrinking at a cell of 4 and a gutter of 1', () => {
    expect(heatmapColumn(0.25)).toEqual({ cellPx: 4, gapPx: 1 });
    expect(heatmapColumn(0.1)).toEqual({ cellPx: 4, gapPx: 1 });
  });
});

describe('heatmapWidth', () => {
  it('counts the whole lattice, one gutter past the last column', () => {
    expect(heatmapWidth(45, 1)).toBe(45 * (CELL + GAP));
  });

  it('never shrinks as the zoom grows — what the floor search relies on', () => {
    let last = 0;
    for (let s = 0.25; s <= 16; s += 0.05) {
      const w = heatmapWidth(45, s);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });
});

describe('fittedColumn', () => {
  it('gives a year in a 1000px box a cell wide enough to aim at', () => {
    const { cellPx, gapPx } = fittedColumn(1000, 53);
    expect(cellPx).toBeGreaterThanOrEqual(14);
    expect(cellPx + gapPx).toBeLessThanOrEqual(Math.floor((1000 - 34) / 53));
  });
  it('caps a short trip at the largest cell rather than drawing tiles', () => {
    expect(fittedColumn(1000, 5).cellPx).toBe(MAX_FIT_CELL);
  });
  it('floors a very long trip at the smallest cell, so the grid scrolls', () => {
    expect(fittedColumn(600, 200).cellPx).toBe(MIN_FIT_CELL);
  });
  it('falls back to the 100% column with no box to fit', () => {
    expect(fittedColumn(0, 53)).toEqual({ cellPx: CELL, gapPx: GAP });
  });
});

