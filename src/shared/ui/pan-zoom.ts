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
 * DOM-free, tested beside; the hooks do the events — `use-media-viewer.ts` for
 * the lightbox's deck, `use-picture-zoom.ts` for one picture with no deck
 * (the develop sheet).
 */

/** Fit is the floor: a viewer showing less than the whole picture shows nothing. */
export const MIN_VIEW_ZOOM = 1;
export const MAX_VIEW_ZOOM = 8;
/**
 * How far INSPECTING one picture goes — 4000 %, Lightroom's own ceiling.
 *
 * The lightbox keeps 8×, which is a way of LOOKING at a photograph. This is for
 * pixel peeping, and past `onePixelZoom` what is magnified is the PREVIEW's
 * pixels rather than the file's, because the develop stage works to a pixel
 * budget (`media-pipeline.md`). That is worth doing and worth saying: the
 * viewport marks where 1:1 falls, and the rendering can be switched to
 * un-smoothed so a magnified pixel looks like a pixel rather than like detail.
 */
export const INSPECT_MAX_ZOOM = 40;
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

/**
 * The scale held between the fit and a ceiling. Every function that can reach
 * a scale takes the ceiling as its last argument, defaulting to the lightbox's
 * 8×: the develop sheet stops at its preview's own pixels (`pixelCeiling`).
 */
export function clampViewZoom(scale: number, max: number = MAX_VIEW_ZOOM): number {
  if (!Number.isFinite(scale)) return MIN_VIEW_ZOOM;
  return Math.min(Math.max(MIN_VIEW_ZOOM, max), Math.max(MIN_VIEW_ZOOM, scale));
}

export function stepViewZoom(scale: number, direction: 1 | -1, max: number = MAX_VIEW_ZOOM): number {
  return clampViewZoom(direction === 1 ? scale * VIEW_ZOOM_STEP : scale / VIEW_ZOOM_STEP, max);
}

/**
 * The one wheel curve of the suite: a notch of `deltaY` multiplies the scale
 * by `exp(-deltaY / 400)` — exponential, so the gesture feels the same at
 * every scale, and one divisor, so a view and a framing zoom at the same
 * speed under the same hand. Every surface reads it from here: the same
 * constant was once spelled out in four files (`zoom-gestures.ts`).
 */
export const WHEEL_ZOOM_DIVISOR = 400;

export function wheelZoomFactor(deltaY: number): number {
  return Number.isFinite(deltaY) ? Math.exp(-deltaY / WHEEL_ZOOM_DIVISOR) : 1;
}

/** A wheel notch applied to a view scale, held under the ceiling. */
export function zoomByWheelDelta(scale: number, deltaY: number, max: number = MAX_VIEW_ZOOM): number {
  return clampViewZoom(scale * wheelZoomFactor(deltaY), max);
}

/** A pinch's finger-distance ratio applied to the scale it started from. */
export function zoomByPinchRatio(startScale: number, ratio: number, max: number = MAX_VIEW_ZOOM): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return clampViewZoom(startScale, max);
  return clampViewZoom(startScale * ratio, max);
}

/**
 * The deepest zoom that still shows real pixels: one pixel of the picture per
 * device pixel of the screen — past it the preview is only enlarged, and a
 * develop is judged on what is there. Never under 2×, so a picture already
 * near its own size can still be looked into; never over the lightbox's 8×.
 * A size not known yet gets the floor.
 */
export function pixelCeiling(natural: Box | null, contained: Box, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (!natural || !(natural.width > 0) || !(contained.width > 0)) return 2;
  return Math.min(MAX_VIEW_ZOOM, Math.max(2, natural.width / (contained.width * dpr)));
}

/**
 * The scale at which ONE pixel of the picture covers one device pixel — the
 * honest 100 %, and where magnifying stops adding detail.
 *
 * It used to be the CEILING (`pixelCeiling`, still the lightbox's). It is now a
 * landmark: the viewport says when the view crosses it, because past it a
 * smooth resample is inventing a gradient between real pixels.
 */
export function onePixelZoom(natural: Box | null, contained: Box, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (!natural || !(natural.width > 0) || !(contained.width > 0)) return 1;
  return Math.max(MIN_VIEW_ZOOM, natural.width / (contained.width * dpr));
}

/**
 * Where a point of the viewport falls on the picture, as a share of its width
 * and height (0 at the left/top edge, 1 at the right/bottom; outside when the
 * point is off the picture). `anchor` is measured from the viewport's centre,
 * like `zoomAbout`'s.
 */
export function pictureFraction(view: View, anchor: Point, content: Box): Point {
  const scale = view.scale > 0 ? view.scale : 1;
  return {
    x: content.width > 0 ? (anchor.x - view.x) / scale / content.width + 0.5 : 0.5,
    y: content.height > 0 ? (anchor.y - view.y) / scale / content.height + 0.5 : 0.5,
  };
}

/** Where the picture sits in the viewport, in its pixels from the top-left corner. */
export function pictureRect(view: View, viewport: Box, content: Box): Box & Point {
  const width = content.width * view.scale;
  const height = content.height * view.scale;
  return {
    x: viewport.width / 2 + view.x - width / 2,
    y: viewport.height / 2 + view.y - height / 2,
    width,
    height,
  };
}

/** A part of the picture, as shares of its width and height: `x0 ≤ x1`, `y0 ≤ y1`, all in [0, 1]. */
export interface PictureWindow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The part of the picture the viewport shows — the picture's placement
 * (`pictureRect`) cut by the viewport's own box, as shares of the picture. At
 * the fit it is the whole picture; zoomed, what is on screen and nothing else.
 */
export function visibleWindow(rect: Box & Point, viewport: Box): PictureWindow {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  const share = (v: number, from: number, size: number) => Math.min(1, Math.max(0, (v - from) / size));
  return {
    x0: share(0, rect.x, rect.width),
    y0: share(0, rect.y, rect.height),
    x1: share(viewport.width, rect.x, rect.width),
    y1: share(viewport.height, rect.y, rect.height),
  };
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
export function clampView(view: View, viewport: Box, content: Box, max: number = MAX_VIEW_ZOOM): View {
  const scale = clampViewZoom(view.scale, max);
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
  max: number = MAX_VIEW_ZOOM,
): View {
  const scale = clampViewZoom(next, max);
  if (view.scale <= 0) return clampView({ ...view, scale }, viewport, content, max);
  const k = scale / view.scale;
  return clampView(
    {
      scale,
      x: anchor.x - (anchor.x - view.x) * k,
      y: anchor.y - (anchor.y - view.y) * k,
    },
    viewport,
    content,
    max,
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

/** Wheel pixels past which a trackpad sweep is a page, however wide the slot. */
export const SWEEP_COMMIT_PX = 160;

/**
 * Whether a horizontal wheel sweep IN PROGRESS has already earned its page.
 *
 * A wheel stream has no release: after the fingers lift, macOS keeps sending
 * momentum for a second or more, so waiting for quiet (`swipeCommit`) left the
 * title on the old media for that long while the deck showed the new one. The
 * sweep commits the moment it crosses this line instead — a quarter of the
 * slot, capped, because a wide sheet asked for a sweep no trackpad makes —
 * and the momentum that follows is the caller's to swallow.
 */
export function sweepCommit(swept: number, width: number): -1 | 0 | 1 {
  if (!(width > 0)) return 0;
  if (Math.abs(swept) < Math.min(width * SWIPE_DISTANCE, SWEEP_COMMIT_PX)) return 0;
  return swept < 0 ? 1 : -1;
}

/**
 * Whether a wheel event swallowed as a finished sweep's momentum is in fact
 * the START of a new sweep. Momentum only ever decays; fingers landing again
 * push the delta back up, and that must page again rather than wait out the
 * tail of the last one.
 */
export function sweepRestarts(previous: number, next: number): boolean {
  const a = Math.abs(previous);
  const b = Math.abs(next);
  return b >= 8 && (b > a * 2 || (previous !== 0 && Math.sign(previous) !== Math.sign(next)));
}
