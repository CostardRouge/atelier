/**
 * How closely the crop STAGE looks at the picture — inspection only, never
 * the zone. A pinch, the wheel, the ± pill and `Z` move it; the crop stored
 * on the roll is exactly what it was.
 *
 * The arithmetic is the develop viewport's (`shared/ui/pan-zoom.ts`): the
 * quarter-turned picture, fitted once inside the stage with room for the
 * handles, is the CONTENT; the stage is the viewport; the view is a scale
 * about the stage's centre plus an offset, held so the picture never leaves
 * the middle of the stage. Sharing it is what makes a zoom here feel like a
 * zoom on the Develop tab — the same hand, the same ceiling shape, the same
 * anchor.
 *
 * **Clamped when it is WRITTEN, never only when it is drawn.** The first
 * crop stage clamped the pan at paint time and stored whatever the gesture
 * produced: the drawn origin and the stored one then disagreed the moment a
 * pan hit its limit, and the next notch anchored from an origin that was not
 * on screen — the picture drifted under a still pointer. `useCropZone`'s
 * `setView` runs every write through `clampCropView`, so what is stored is
 * what is drawn.
 */

import { clampView, zoomAbout, type Box, type Point, type View } from '../../shared/ui/pan-zoom';
import { splitRotation, type PictureDims } from '../../shared/develop/crop-rect';

/** `zoom` 1 = the picture fitted; `x`/`y` pan the view in CSS px, about the stage's centre. */
export interface CropView {
  zoom: number;
  x: number;
  y: number;
}

export const CROP_VIEW_FIT: CropView = { zoom: 1, x: 0, y: 0 };
/** Eight times the fit — a crop is aimed, not pixel-peeped (that is the Develop tab's 4000 %). */
export const CROP_VIEW_MAX = 8;
/** Room kept round the fitted picture for the handles, in CSS px. */
export const CROP_PAD = 28;

export interface StageBox {
  w: number;
  h: number;
}

/** The picture's size once quarter-turned — a fine angle never refits it. */
export function quarterTurned(src: PictureDims, rotation: number): Box {
  const { quarter } = splitRotation(rotation);
  const odd = Math.abs(quarter) % 180 === 90;
  return odd ? { width: src.height, height: src.width } : { width: src.width, height: src.height };
}

/** Source px → stage px at the fit, with the handles' room kept. */
export function cropFitScale(box: StageBox, src: PictureDims, rotation: number): number {
  const q = quarterTurned(src, rotation);
  return Math.max(0.0001, Math.min((box.w - 2 * CROP_PAD) / q.width, (box.h - 2 * CROP_PAD) / q.height));
}

/** The fitted picture's size on the stage — the content the view moves. */
export function cropContent(box: StageBox, src: PictureDims, rotation: number): Box {
  const q = quarterTurned(src, rotation);
  const k = cropFitScale(box, src, rotation);
  return { width: q.width * k, height: q.height * k };
}

const toView = (v: CropView): View => ({ scale: v.zoom, x: v.x, y: v.y });
const fromView = (v: View): CropView => ({ zoom: v.scale, x: v.x, y: v.y });
const viewportOf = (box: StageBox): Box => ({ width: box.w, height: box.h });

/**
 * The view held inside its limits: the zoom between the fit and the
 * ceiling, the pan to half of what the scaled picture has over the stage.
 * Back at the fit the offsets are zero, so `Z` and the pill land exactly
 * where the stage first opened.
 */
export function clampCropView(view: CropView, box: StageBox | null, src: PictureDims | null, rotation: number): CropView {
  if (!box || !src) return { zoom: Math.min(CROP_VIEW_MAX, Math.max(1, view.zoom)), x: view.x, y: view.y };
  const held = fromView(clampView(toView(view), viewportOf(box), cropContent(box, src, rotation), CROP_VIEW_MAX));
  return held.zoom <= 1 ? CROP_VIEW_FIT : held;
}

/**
 * The view at `zoom` with the point under `anchor` — stage px from its
 * top-left corner — kept still: the wheel's pointer, a pinch's live centre.
 */
export function zoomCropViewAbout(
  view: CropView,
  zoom: number,
  anchor: Point,
  box: StageBox,
  src: PictureDims,
  rotation: number,
): CropView {
  const centred = { x: anchor.x - box.w / 2, y: anchor.y - box.h / 2 };
  const next = fromView(zoomAbout(toView(view), zoom, centred, viewportOf(box), cropContent(box, src, rotation), CROP_VIEW_MAX));
  return next.zoom <= 1 ? CROP_VIEW_FIT : next;
}

/** Where the fitted, zoomed picture's origin and scale land on the stage — what the painter draws with. */
export function cropStageTransform(box: StageBox, src: PictureDims, rotation: number, view: CropView) {
  const k = cropFitScale(box, src, rotation) * view.zoom;
  return { k, ox: box.w / 2 + view.x, oy: box.h / 2 + view.y };
}
