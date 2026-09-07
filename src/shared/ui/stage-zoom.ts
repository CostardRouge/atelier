/**
 * The arithmetic behind a stage's VIEW zoom — how much of the editor's canvas
 * you are looking at, not anything the document remembers.
 *
 * Kept DOM-free so the two consumers (the Studio stage, the Road Trip badge
 * stage) share one feel: the same steps, the same wheel response, and the same
 * rule for keeping the point under the pointer still while the picture grows
 * around it.
 */

/**
 * Below 1 the content is smaller than its fit — which is how a 600-day grid
 * gets onto one screen; above it, how a single day gets big enough to aim at.
 * The zone itself sets the real floor when it has one (the ruler will not draw
 * a day under 6px, the grid a cell under 4).
 */
export const MIN_STAGE_ZOOM = 0.25;
export const MAX_STAGE_ZOOM = 16;
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
  /**
   * Pixels of content before the part that scales — the day grid's weekday
   * rail, which keeps its width at every zoom. Without it the correction
   * treats the rail as if it grew too, and the day under the pointer slides by
   * the rail's width times the zoom.
   */
  fixed: { x?: number; y?: number } = {},
): StageScroll {
  if (prevScale <= 0) return scroll;
  const k = nextScale / prevScale;
  const fx = fixed.x ?? 0;
  const fy = fixed.y ?? 0;
  return {
    left: Math.max(0, fx + (scroll.left + anchor.x - fx) * k - anchor.x),
    top: Math.max(0, fy + (scroll.top + anchor.y - fy) * k - anchor.y),
  };
}

/**
 * What a bare wheel means over a zone.
 *
 * `modifier` — only ⌘/ctrl (and the trackpad pinch that arrives as one) zooms;
 * a bare wheel is left to the page, or to whatever the zone already does with
 * it (the badge stage frames its picture).
 * `any` — a bare wheel zooms too, for a zone that has nothing else to do with
 * it: the trip's day grid and its stage ruler are day-sized things you zoom far
 * more often than you scroll the page from.
 */
export type WheelZoom = 'modifier' | 'any';

/** The bits of a wheel event the decision needs. */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether this wheel event zooms. ⌘/ctrl always does. Under `any`, a bare
 * vertical wheel does too — but a shift-wheel and a sideways trackpad swipe
 * stay the browser's horizontal scroll, which is how a zoomed-in track is
 * panned in the first place.
 */
export function wheelZooms(e: WheelLike, mode: WheelZoom): boolean {
  if (e.ctrlKey || e.metaKey) return true;
  if (mode === 'modifier' || e.shiftKey) return false;
  return Math.abs(e.deltaY) > Math.abs(e.deltaX);
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
