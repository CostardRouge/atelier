import { describe, expect, it } from 'vitest';
import { CELL, GAP, heatmapColumn, heatmapWidth } from './day-grid';

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
