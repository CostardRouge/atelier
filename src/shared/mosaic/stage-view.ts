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
 * The view clamped so the window in view stays inside `area` (stage units;
 * the stage itself by default): zoomed in, the mosaic covers the stage with
 * no gap at an edge; a window larger than the area sits centred on it. Under
 * Auto-frame the area is the whole PICTURE (`pictureArea`), so a drag slides
 * the window past the mosaic built — the frame moving on the target — and a
 * release makes that the crop (lab 4, L3).
 */
export function clampStageView(view: StageView, stageW: number, stageH: number, bounds: { min: number; max: number }, area: Rect = { x: 0, y: 0, w: stageW, h: stageH }): StageView {
  const s = Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(view.s) && view.s > 0 ? view.s : 1));
  const ww = stageW / s;
  const wh = stageH / s;
  const along = (pos: number, size: number, lo: number, span: number) => (size >= span ? lo + (span - size) / 2 : Math.min(lo + span - size, Math.max(lo, pos)));
  const wx = along(-view.ox / s, ww, area.x, area.w);
  const wy = along(-view.oy / s, wh, area.y, area.h);
  // `+ 0` turns a -0 into 0: a view at the corner reads as one.
  return { s, ox: -wx * s + 0, oy: -wy * s + 0 };
}

/**
 * The whole `W × H` picture in stage units, for a stage built on `frameRect`
 * of it (target pixels): where the window may go under Auto-frame.
 */
export function pictureArea(frameRect: Rect, W: number, H: number, stageW: number, stageH: number): Rect {
  const kx = frameRect.w > 0 ? stageW / frameRect.w : 1;
  const ky = frameRect.h > 0 ? stageH / frameRect.h : 1;
  return { x: -frameRect.x * kx, y: -frameRect.y * ky, w: W * kx, h: H * ky };
}

/** Whether the view has somewhere to go inside `area`: zoomed in, or a window smaller than the area. */
export function canPanView(view: StageView, stageW: number, stageH: number, area: Rect = { x: 0, y: 0, w: stageW, h: stageH }): boolean {
  const win = viewWindow(view, stageW, stageH);
  return area.w - win.w > 0.5 || area.h - win.h > 0.5;
}

/** The view at `scale`, the stage point `anchor` staying under the hand — then clamped. */
export function zoomStageView(view: StageView, scale: number, anchor: { x: number; y: number }, stageW: number, stageH: number, bounds: { min: number; max: number }, area?: Rect): StageView {
  const s = Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(scale) && scale > 0 ? scale : view.s));
  const k = s / view.s;
  return clampStageView({ s, ox: anchor.x - (anchor.x - view.ox) * k, oy: anchor.y - (anchor.y - view.oy) * k }, stageW, stageH, bounds, area);
}

/** The view moved by a stage-pixel delta, then clamped. */
export function panStageView(view: StageView, dx: number, dy: number, stageW: number, stageH: number, bounds: { min: number; max: number }, area?: Rect): StageView {
  return clampStageView({ s: view.s, ox: view.ox + dx, oy: view.oy + dy }, stageW, stageH, bounds, area);
}

/** The mosaic point under stage point `p` — through the view, so a click lands on the cell under it at any zoom. */
export function stagePointToMosaic(view: StageView, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s };
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
