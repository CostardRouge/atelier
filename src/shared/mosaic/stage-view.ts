/**
 * The VIEW over the mosaic stage, and how a zoom becomes a crop (lab 2, R7,
 * his ask: «zoomer sur toute la viewport … ça change le crop, et ça nous
 * permet de réadapter en fonction de la taille de cellule»).
 *
 * While the hand moves, the painted mosaic is only enlarged — a canvas
 * already there, free. On release the part of the stage still in view is
 * mapped back onto the TARGET and becomes its crop (`cropFromView`), the
 * frame's shape kept since the view scales both axes alike, pushed back into
 * the picture where it would overhang; the mosaic is then rebuilt for that
 * part with as many cells as before, so a zoom is more detail, never bigger
 * cells. Zooming out past the whole frame stops at the picture
 * (`viewBounds`); zooming in stops where the crop would be smaller than
 * `MIN_CROP_SCALE` of it.
 *
 * Pure and DOM-free.
 */

import { MIN_CROP_SCALE, cropOfRect, type Crop, type Rect } from './frame';

/** The mosaic drawn `s` times its size with its top-left at (`ox`, `oy`), stage pixels. */
export interface StageView {
  s: number;
  ox: number;
  oy: number;
}

export const IDENTITY_VIEW: StageView = { s: 1, ox: 0, oy: 0 };

export function isIdentityView(view: StageView): boolean {
  return Math.abs(view.s - 1) < 1e-4 && Math.abs(view.ox) < 0.5 && Math.abs(view.oy) < 0.5;
}

/**
 * How far the view may go for a crop at `cropScale` (1 = the whole frame):
 * out, until the frame is the whole picture again; in, until the frame would
 * be `MIN_CROP_SCALE` of it.
 */
export function viewBounds(cropScale: number): { min: number; max: number } {
  const c = Math.min(1, Math.max(MIN_CROP_SCALE, Number.isFinite(cropScale) ? cropScale : 1));
  return { min: c, max: c / MIN_CROP_SCALE };
}

/**
 * The view clamped: zoomed in, the mosaic covers the stage with no gap at an
 * edge; zoomed out, it sits centred in the stage.
 */
export function clampStageView(view: StageView, stageW: number, stageH: number, bounds: { min: number; max: number }): StageView {
  const s = Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(view.s) && view.s > 0 ? view.s : 1));
  const w = stageW * s;
  const h = stageH * s;
  const ox = s >= 1 ? Math.min(0, Math.max(stageW - w, view.ox)) : (stageW - w) / 2;
  const oy = s >= 1 ? Math.min(0, Math.max(stageH - h, view.oy)) : (stageH - h) / 2;
  return { s, ox, oy };
}

/** The view at `scale`, the stage point `anchor` staying under the hand — then clamped. */
export function zoomStageView(view: StageView, scale: number, anchor: { x: number; y: number }, stageW: number, stageH: number, bounds: { min: number; max: number }): StageView {
  const s = Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(scale) && scale > 0 ? scale : view.s));
  const k = s / view.s;
  return clampStageView({ s, ox: anchor.x - (anchor.x - view.ox) * k, oy: anchor.y - (anchor.y - view.oy) * k }, stageW, stageH, bounds);
}

/** The view moved by a stage-pixel delta, then clamped. */
export function panStageView(view: StageView, dx: number, dy: number, stageW: number, stageH: number, bounds: { min: number; max: number }): StageView {
  return clampStageView({ s: view.s, ox: view.ox + dx, oy: view.oy + dy }, stageW, stageH, bounds);
}

/** The part of the mosaic in view, in stage units — larger than the stage when zoomed out. */
export function viewWindow(view: StageView, stageW: number, stageH: number): Rect {
  return { x: -view.ox / view.s, y: -view.oy / view.s, w: stageW / view.s, h: stageH / view.s };
}

/**
 * The crop the view names: the window in view mapped onto the target
 * through the frame it was built on (`frameRect`, target pixels), then named
 * as a crop of the `W × H` picture — clamped to it, and to the scale bounds.
 */
export function cropFromView(view: StageView, stageW: number, stageH: number, frameRect: Rect, W: number, H: number, aspect: number): Crop {
  const win = viewWindow(view, stageW, stageH);
  const kx = frameRect.w / stageW;
  const ky = frameRect.h / stageH;
  return cropOfRect(W, H, aspect, { x: frameRect.x + win.x * kx, y: frameRect.y + win.y * ky, w: win.w * kx, h: win.h * ky });
}

/** The view that shows `win` (stage units) filling the stage — the inverse of `viewWindow`. */
export function viewOfWindow(win: Rect, stageW: number): StageView {
  const s = win.w > 0 ? stageW / win.w : 1;
  return { s, ox: -win.x * s, oy: -win.y * s };
}
