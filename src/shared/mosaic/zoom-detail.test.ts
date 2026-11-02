import { describe, expect, it } from 'vitest';
import { gridShape } from './match';
import { IDENTITY_VIEW } from './stage-view';
import { THUMB_UP_TO, TILE_UP_TO, VEIL_GONE_AT, detailLevel, needsCellPass, veilAt, visibleCells } from './zoom-detail';

describe('what a zoom draws', () => {
  it('asks for a sharper picture as a cell grows on screen, only when sharp photos are on', () => {
    expect(detailLevel(TILE_UP_TO, true)).toBe('tile');
    expect(detailLevel(TILE_UP_TO + 1, true)).toBe('thumb');
    expect(detailLevel(THUMB_UP_TO + 1, true)).toBe('proxy');
    expect(detailLevel(2000, false)).toBe('tile');
    expect(detailLevel(Number.NaN, true)).toBe('tile');
  });

  it('fades the veil from the mosaic’s own at ×1 to nothing, or keeps it', () => {
    expect(veilAt(0.25, 1, true)).toBe(0.25);
    expect(veilAt(0.25, (1 + VEIL_GONE_AT) / 2, true)).toBeCloseTo(0.125);
    expect(veilAt(0.25, VEIL_GONE_AT, true)).toBe(0);
    expect(veilAt(0.25, 10, true)).toBe(0);
    expect(veilAt(0.25, 4, false)).toBe(0.25);
  });

  it('draws cells one by one only when zoomed and it changes something', () => {
    expect(needsCellPass(1, 500, 0.25, true, true)).toBe(false);
    expect(needsCellPass(2, 100, 0, true, true)).toBe(false);
    expect(needsCellPass(2, 100, 0.25, true, true)).toBe(true);
    expect(needsCellPass(2, 300, 0, true, false)).toBe(true);
    expect(needsCellPass(2, 300, 0.25, false, false)).toBe(false);
  });

  it('names the cells in view, clamped to the grid', () => {
    const shape = gridShape(960, 540, 40);
    expect(visibleCells(IDENTITY_VIEW, shape, 960, 540)).toEqual({ i0: 0, i1: shape.cols, j0: 0, j1: shape.rows });
    const v = visibleCells({ s: 4, ox: -960 * 1.5, oy: -540 * 1.5 }, shape, 960, 540);
    expect(v.i1 - v.i0).toBeLessThanOrEqual(Math.ceil(shape.cols / 4) + 1);
    expect(v.i0).toBeGreaterThan(0);
    // A window past the mosaic (Auto-frame's slide) yields an empty or partial range, never out of the grid.
    const off = visibleCells({ s: 1, ox: 2000, oy: 0 }, shape, 960, 540);
    expect(off.i0).toBe(0);
    expect(off.i1).toBe(0);
  });
});
