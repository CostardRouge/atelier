/**
 * The arithmetic behind a stage's VIEW zoom — how much of the editor's canvas
 * you are looking at, not anything the document remembers.
 *
 * Kept DOM-free so the two consumers (the Studio stage, the Road Trip badge
 * stage) share one feel: the same steps, the same wheel response, and the same
 * rule for keeping the point under the pointer still while the picture grows
 * around it.
 */

/** Below 1 the picture is smaller than its fit — rarely wanted, but harmless. */
export const MIN_STAGE_ZOOM = 0.5;
export const MAX_STAGE_ZOOM = 8;
/** One press of + or −. */
export const STAGE_ZOOM_STEP = 1.25;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_STAGE_ZOOM, Math.max(MIN_STAGE_ZOOM, scale));
}

/**
 * One step in or out. A step that would cross 1 lands ON 1 instead: fit is the
 * value the author keeps coming back to, and a geometric ladder from 1.25
 * never hits it again.
 */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const next = direction === 1 ? scale * STAGE_ZOOM_STEP : scale / STAGE_ZOOM_STEP;
  if ((scale < 1 && next > 1) || (scale > 1 && next < 1)) return 1;
  return clampZoom(next);
}

/**
 * A wheel notch (or a trackpad pinch, which arrives as a ctrl-wheel) as a
 * multiplier. Exponential so the gesture feels the same at every scale, and
 * the same 400-unit divisor the picture's own framing zoom uses.
 */
export function zoomByWheel(scale: number, deltaY: number): number {
  return clampZoom(scale * Math.exp(-deltaY / 400));
}

/** A pinch's finger-distance ratio applied to the scale it started from. */
export function zoomByPinch(startScale: number, ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampZoom(startScale);
  return clampZoom(startScale * ratio);
}

export interface StageScroll {
  left: number;
  top: number;
}

/**
 * Where the scroll box must land so the content under `anchor` (a point in the
 * viewport's own coordinates) stays under it after the scale changes.
 *
 * The content's origin only moves with the scroll once it is larger than the
 * viewport; while it still fits it is centred and the scroll is 0 anyway, which
 * is what the clamp at 0 covers.
 */
export function scrollAfterZoom(
  scroll: StageScroll,
  anchor: { x: number; y: number },
  prevScale: number,
  nextScale: number,
): StageScroll {
  if (prevScale <= 0) return scroll;
  const k = nextScale / prevScale;
  return {
    left: Math.max(0, (scroll.left + anchor.x) * k - anchor.x),
    top: Math.max(0, (scroll.top + anchor.y) * k - anchor.y),
  };
}

/** "100%" — what the control shows between its two buttons. */
export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/**
 * The box a fitted picture may fill at this scale, in PIXELS off the measured
 * viewport — never a percentage. A percentage max-height would resolve against
 * the auto-height wrapper that centres the picture, whose height is what the
 * picture itself decides; the browser drops the constraint and the zoom does
 * nothing. Before the first measurement, plain "fit" is the honest answer.
 */
export function zoomedFit(
  viewport: { width: number; height: number },
  scale: number,
): { maxWidth: string; maxHeight: string } {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { maxWidth: '100%', maxHeight: '100%' };
  }
  return {
    maxWidth: `${viewport.width * scale}px`,
    maxHeight: `${viewport.height * scale}px`,
  };
}
