/**
 * What a ZOOM on the still stage draws (lab 4, L4, his yes to both): the
 * cells in view, each from a picture as sharp as its size on screen needs,
 * and the veil of the target's colour fading as the hand zooms in, so a
 * close look shows the photographs as they are.
 *
 * The level follows the cell's size in DEVICE pixels, not the zoom alone: a
 * 160 × 90 tile holds until a cell is wider than it on screen, the
 * instance's thumbnail (~400 px) until it is wider than that, the proxy
 * past it. That bounds the cost by itself — the bigger a cell, the fewer in
 * view, so a thumbnail is asked for at most a hundred or so cells and a
 * proxy for a handful. Pure and DOM-free; `zoom-cells.ts` paints with it.
 */

import type { GridShape } from './match';
import type { StageView } from './stage-view';

export type DetailLevel = 'tile' | 'thumb' | 'proxy';

/** Device pixels a cell may cover before its 160-px tile looks soft. */
export const TILE_UP_TO = 150;
/** … and before the instance's ~400-px thumbnail does. */
export const THUMB_UP_TO = 420;
/** The zoom over which the veil has gone. */
export const VEIL_GONE_AT = 3.5;

/** The picture a cell `cellDevicePx` wide on screen needs; always the tile when sharp photos are off. */
export function detailLevel(cellDevicePx: number, sharp: boolean): DetailLevel {
  if (!sharp || !(cellDevicePx > TILE_UP_TO)) return 'tile';
  return cellDevicePx > THUMB_UP_TO ? 'proxy' : 'thumb';
}

/** The veil at zoom `s`: the mosaic's own at ×1, nothing from `VEIL_GONE_AT` on — or the mosaic's own throughout. */
export function veilAt(tint: number, s: number, fade: boolean): number {
  if (!fade || !(s > 1)) return tint;
  return tint * Math.max(0, 1 - (s - 1) / (VEIL_GONE_AT - 1));
}

/** Whether a zoom must draw its cells one by one rather than the painted mosaic enlarged. */
export function needsCellPass(s: number, cellDevicePx: number, tint: number, sharp: boolean, fade: boolean): boolean {
  if (!(s > 1.001)) return false;
  return detailLevel(cellDevicePx, sharp) !== 'tile' || (fade && tint > 0);
}

/** The cells a view shows, as a column and row range (end excluded), on a `stageW × stageH` mosaic. */
export function visibleCells(view: StageView, shape: GridShape, stageW: number, stageH: number): { i0: number; i1: number; j0: number; j1: number } {
  const x0 = -view.ox / view.s;
  const y0 = -view.oy / view.s;
  const x1 = x0 + stageW / view.s;
  const y1 = y0 + stageH / view.s;
  const clampI = (v: number) => Math.min(shape.cols, Math.max(0, v));
  const clampJ = (v: number) => Math.min(shape.rows, Math.max(0, v));
  return { i0: clampI(Math.floor(x0 / shape.cw)), i1: clampI(Math.ceil(x1 / shape.cw)), j0: clampJ(Math.floor(y0 / shape.ch)), j1: clampJ(Math.ceil(y1 / shape.ch)) };
}
