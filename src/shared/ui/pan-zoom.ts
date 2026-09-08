/**
 * The arithmetic behind looking at ONE picture closely and sliding to the
 * next — the lightbox's gestures, not an editor stage's.
 *
 * Kept apart from `stage-zoom.ts` on purpose: a stage zooms by LAYOUT size
 * inside a scroll box, so panning is the browser's own scrolling. A viewer
 * cannot do that. Its deck has to follow the finger pixel for pixel, including
 * past the edges of the picture, so the picture is moved by a TRANSFORM and
 * every limit here is arithmetic we own.
 *
 * DOM-free, tested beside; the hook (`use-media-viewer.ts`) does the events.
 */

/** Fit is the floor: a viewer showing less than the whole picture shows nothing. */
export const MIN_VIEW_ZOOM = 1;
export const MAX_VIEW_ZOOM = 8;
/** One press of + or −. Coarser than a stage's: there is no document to aim at. */
export const VIEW_ZOOM_STEP = 1.5;

export interface Box {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * How the picture sits in its slot: scaled about its own centre, then moved by
 * `x`/`y` pixels. `scale: 1, x: 0, y: 0` is the contained fit.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const FITTED: View = { scale: 1, x: 0, y: 0 };

export function clampViewZoom(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_VIEW_ZOOM;
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, scale));
}

export function stepViewZoom(scale: number, direction: 1 | -1): number {
  return clampViewZoom(direction === 1 ? scale * VIEW_ZOOM_STEP : scale / VIEW_ZOOM_STEP);
}

/**
 * A wheel notch as a multiplier — exponential, so the gesture feels the same
 * at every scale, on the same 400-unit divisor the stages use.
 */
export function zoomByWheelDelta(scale: number, deltaY: number): number {
  return clampViewZoom(scale * Math.exp(-deltaY / 400));
}

/** A pinch's finger-distance ratio applied to the scale it started from. */
export function zoomByPinchRatio(startScale: number, ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampViewZoom(startScale);
  return clampViewZoom(startScale * ratio);
}

/**
 * What `object-contain` really draws: the picture's own size, fitted into the
 * box without cropping it. The pan limits are measured off THIS, never off the
 * viewport — a panorama in a tall box has slack the box's own width cannot say.
 *
 * Nothing measured yet (a picture whose size we do not know) contains to the
 * box itself, which gives no slack and so pans nowhere: honest until it loads.
 */
export function containedSize(natural: Box | null, viewport: Box): Box {
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) return viewport;
  if (!(viewport.width > 0) || !(viewport.height > 0)) return viewport;
  const k = Math.min(viewport.width / natural.width, viewport.height / natural.height);
  return { width: natural.width * k, height: natural.height * k };
}

/**
 * How far the picture may be moved off centre before an edge would come into
 * the box: half of whatever the scaled picture has over the viewport.
 */
export function panLimit(viewport: Box, content: Box, scale: number): Point {
  return {
    x: Math.max(0, (content.width * scale - viewport.width) / 2),
    y: Math.max(0, (content.height * scale - viewport.height) / 2),
  };
}

/** The same view with its offsets held inside those limits. */
export function clampView(view: View, viewport: Box, content: Box): View {
  const scale = clampViewZoom(view.scale);
  const limit = panLimit(viewport, content, scale);
  return {
    scale,
    // `|| 0` only to spell −0 as 0: it reaches a `translate()` either way, but
    // an offset that compares unequal to the fit makes "is this view at rest?"
    // lie, and the deck asks exactly that.
    x: Math.min(limit.x, Math.max(-limit.x, view.x)) || 0,
    y: Math.min(limit.y, Math.max(-limit.y, view.y)) || 0,
  };
}

/**
 * Zoom to `next` while keeping the point under `anchor` still.
 *
 * `anchor` is in the viewport's own coordinates, measured from its CENTRE —
 * which is where the transform's origin is. A point of the picture sits at
 * `c * scale + offset`; asking that it still sit at `anchor` afterwards gives
 * `offset' = anchor - (anchor - offset) * next / scale`.
 */
export function zoomAbout(
  view: View,
  next: number,
  anchor: Point,
  viewport: Box,
  content: Box,
): View {
  const scale = clampViewZoom(next);
  if (view.scale <= 0) return clampView({ ...view, scale }, viewport, content);
  const k = scale / view.scale;
  return clampView(
    {
      scale,
      x: anchor.x - (anchor.x - view.x) * k,
      y: anchor.y - (anchor.y - view.y) * k,
    },
    viewport,
    content,
  );
}

/**
 * Resistance past an end of the deck — the iOS curve, asymptotic to about half
 * the width, so a drag that has nowhere to go still moves and still says so.
 */
export function rubberBand(distance: number, dimension: number): number {
  if (!(dimension > 0)) return 0;
  const c = 0.55;
  const pull = Math.abs(distance);
  return Math.sign(distance) * (1 - 1 / (pull / (dimension * c) + 1)) * dimension * c;
}

/** Fractions of the slot width, and px per ms, at which a drag becomes a page. */
export const SWIPE_DISTANCE = 0.25;
export const SWIPE_VELOCITY = 0.5;

/**
 * What a released drag does: `1` next, `-1` previous, `0` snap back.
 *
 * Either far enough or fast enough — a flick that never crossed a quarter of
 * the slot is still a page, which is the whole feel of the gesture; but a
 * flick whose speed disagrees with where the fingers ended up is a hesitation,
 * not a page.
 */
export function swipeCommit(dx: number, width: number, velocity: number): -1 | 0 | 1 {
  if (!(width > 0) || dx === 0) return 0;
  const flick = Math.abs(velocity) > SWIPE_VELOCITY && Math.sign(velocity) === Math.sign(dx);
  if (!flick && Math.abs(dx) < width * SWIPE_DISTANCE) return 0;
  return dx < 0 ? 1 : -1;
}
