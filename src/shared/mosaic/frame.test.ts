import { describe, expect, it } from 'vitest';
import {
  ASPECTS,
  TILE_ASPECT,
  WHOLE,
  aspectRatio,
  cropGrids,
  cropOfRect,
  cropRect,
  gridWindow,
  isAspect,
  isWhole,
  readCrop,
  resampleGrid,
} from './frame';
import { GRID_BYTES } from './measure';

describe('aspects', () => {
  it('reads every listed ratio and falls back on 16:9', () => {
    expect(aspectRatio('1:1')).toBe(1);
    expect(aspectRatio('9:16')).toBeCloseTo(0.5625);
    expect(aspectRatio('21:9')).toBeCloseTo(16 / 9);
    expect(aspectRatio('nope')).toBeCloseTo(16 / 9);
    expect(ASPECTS.every(isAspect)).toBe(true);
    expect(isAspect('2:1')).toBe(false);
  });
});

describe('cropRect / cropOfRect', () => {
  it('the whole frame is the largest rectangle of the aspect, centred', () => {
    expect(cropRect(6000, 4000, 1)).toEqual({ x: 1000, y: 0, w: 4000, h: 4000 });
    expect(cropRect(6000, 4000, 16 / 9)).toEqual({ x: 0, y: (4000 - 6000 / (16 / 9)) / 2, w: 6000, h: 6000 / (16 / 9) });
    expect(cropRect(3000, 4000, 16 / 9).w).toBe(3000);
  });

  it('a centre near the edge is pushed back inside, and a scale shrinks it', () => {
    const r = cropRect(6000, 4000, 1, { cx: 0.98, cy: 0.5, scale: 0.5 });
    expect(r).toEqual({ x: 4000, y: 1000, w: 2000, h: 2000 });
    expect(cropRect(6000, 4000, 1, { cx: 0.5, cy: 0.5, scale: 0.01 }).w).toBe(400);
  });

  it('round-trips through cropOfRect, storing the clamped centre', () => {
    const r = cropRect(6000, 4000, 1, { cx: 0.98, cy: 0.5, scale: 0.5 });
    const c = cropOfRect(6000, 4000, 1, r);
    expect(c.cx).toBeCloseTo(5000 / 6000);
    expect(c.scale).toBeCloseTo(0.5);
    expect(cropRect(6000, 4000, 1, c)).toEqual(r);
  });

  it('keeps the centre and the share when the aspect changes', () => {
    const c = { cx: 0.3, cy: 0.5, scale: 0.6 };
    expect(cropRect(6000, 4000, 1, c).x + cropRect(6000, 4000, 1, c).w / 2).toBeCloseTo(1800);
    expect(cropRect(6000, 4000, 16 / 9, c).x + cropRect(6000, 4000, 16 / 9, c).w / 2).toBeCloseTo(1800);
  });

  it('reads a stored crop and says when it is the whole frame', () => {
    expect(readCrop({ cx: 0.2, cy: 2, scale: 0 })).toEqual({ cx: 0.2, cy: 1, scale: 0.1 });
    expect(readCrop({ cx: 'a', cy: 0, scale: 1 })).toBeUndefined();
    expect(isWhole(undefined)).toBe(true);
    expect(isWhole(WHOLE)).toBe(true);
    expect(isWhole({ cx: 0.5, cy: 0.5, scale: 0.9 })).toBe(false);
  });
});

describe('the grids under another cell shape', () => {
  it('a square cell sees the middle 9/16 of a 16:9 tile', () => {
    const w = gridWindow(TILE_ASPECT, 1);
    expect(w.w).toBeCloseTo(6 * (9 / 16));
    expect(w.x).toBeCloseTo((6 - w.w) / 2);
    expect(w.h).toBe(6);
    const tall = gridWindow(TILE_ASPECT, 21 / 9);
    expect(tall.w).toBe(6);
    expect(tall.h).toBeLessThan(6);
  });

  it('resampling the whole window is the identity, and a half window doubles each column', () => {
    const src = new Uint8Array(GRID_BYTES).map((_, i) => (i * 7) % 256);
    const same = new Float32Array(GRID_BYTES);
    resampleGrid(src, 0, { x: 0, y: 0, w: 6, h: 6 }, same, 0);
    expect(Array.from(same)).toEqual(Array.from(src));
    // A left/right split: the left half window reads all left.
    const split = new Uint8Array(GRID_BYTES);
    for (let c = 0; c < 36; c++) split[c * 3] = c % 6 < 3 ? 200 : 0;
    const left = new Float32Array(GRID_BYTES);
    resampleGrid(split, 0, { x: 0, y: 0, w: 3, h: 6 }, left, 0);
    for (let c = 0; c < 36; c++) expect(left[c * 3]).toBeCloseTo(200);
  });

  it('cropGrids leaves 16:9 alone and narrows a square to the centre', () => {
    const grids = new Uint8Array(2 * GRID_BYTES);
    for (let c = 0; c < 36; c++) {
      // Picture 0: a black left border column, white elsewhere.
      grids[c * 3] = c % 6 === 0 ? 0 : 255;
      grids[GRID_BYTES + c * 3] = 77;
    }
    expect(cropGrids(grids, 2, TILE_ASPECT)).toBe(grids);
    const sq = cropGrids(grids, 2, 1);
    // The border column falls outside the square's window: the crop is all white.
    for (let c = 0; c < 36; c++) expect(sq[c * 3]).toBeCloseTo(255);
    expect(sq[GRID_BYTES]).toBeCloseTo(77);
  });
});
