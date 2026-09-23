import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  FITTED,
  MIN_VIEW_ZOOM,
  clampView,
  containedSize,
  pictureFraction,
  pictureRect,
  INSPECT_MAX_ZOOM,
  onePixelZoom,
  stepViewZoom,
  zoomAbout,
  type Box,
  type Point,
  type View,
} from './pan-zoom';
import { zoomLabel, type ZoomControls } from './stage-zoom';
import { useZoomGestures } from './use-zoom-gestures';

interface PictureZoomOptions {
  /** The picture's own size, or null until it is known — it pans nowhere until then. */
  natural: Box | null;
  /** Anything that changes when another picture is shown: the view goes back to the fit. */
  resetKey?: unknown;
  /**
   * How far the view may go, default `INSPECT_MAX_ZOOM` — 4000 %, which is a
   * DEVELOP's ceiling: there the file itself can be decoded whole under the
   * view (the loupe), so magnifying keeps paying. A surface that only ever
   * shows a bounded PREVIEW raster says a smaller number, because past a few
   * times its own pixels there is nothing more in it to find.
   */
  ceiling?: number;
  /**
   * A single pointer the caller keeps for itself (the develop sheet's wipe),
   * decided from what it landed on: the hook neither pans nor captures it. A
   * second finger landing still makes a pinch of the two, and `onTakeover`
   * tells the caller to let go.
   */
  claim?: (target: EventTarget | null) => boolean;
  onTakeover?: () => void;
}

export interface PictureZoom {
  viewportRef: RefObject<HTMLDivElement>;
  view: View;
  /** For the picture's `style.transform`, about its centre. */
  transform: string;
  /** The last change came from a button: animate it. A finger is followed as is. */
  settling: boolean;
  zoomed: boolean;
  /** A drag is panning the picture right now. */
  panning: boolean;
  /**
   * The scale at which one pixel of the picture covers one device pixel. Above
   * it, what grows is a preview pixel and not detail — which is why it is
   * exposed rather than merely enforced.
   */
  onePixel: number;
  /** The view is past 1:1: a smooth resample is inventing what it draws. */
  magnifying: boolean;
  zoom: ZoomControls;
  /** Where a pointer falls on the picture, as a share of its width and height. */
  fractionAt: (clientX: number, clientY: number) => Point;
  /** Move a zoomed view by a pixel delta — the arrows' way in (`zoom-keys.ts`). */
  pan: (dx: number, dy: number) => void;
  /**
   * Back to the fit AT ONCE, never animated — for when what the picture IS
   * changed under the view (a crop made from it), so there is no journey to
   * show: the new picture at the fit is what was on screen.
   */
  fit: () => void;
  /** Where the picture sits in the viewport, in its pixels. */
  rect: Box & Point;
  /** The viewport's measured size. */
  viewport: Box;
}

/**
 * Looking closely at ONE picture: wheel, trackpad pinch, a two-finger pinch
 * and a drag that pans once zoomed — the lightbox's gestures without its deck.
 *
 * Kept apart from `use-media-viewer.ts` on purpose. That hook pages a deck in
 * every one of its handlers (swipe, sweep, momentum, a page in flight that a
 * gesture must land), and its wheel-latching fixes were paid for one at a
 * time; a surface with a single picture needs none of it. What the two DO
 * share is the reading of the hand — `use-zoom-gestures.ts`, the suite's one
 * pinch/wheel/drag machine — and the arithmetic (`pan-zoom.ts`); this hook
 * only says what the scale is and what to do with a new one.
 *
 * The ceiling is `INSPECT_MAX_ZOOM` — 4000 %, Lightroom's. One pixel of the
 * picture per device pixel (`onePixel`) is no longer the ceiling but a
 * LANDMARK: past it what grows is a preview pixel, and the viewport says so by
 * offering to draw it un-smoothed rather than by refusing to go there.
 */
export function usePictureZoom({
  natural,
  resetKey,
  ceiling = INSPECT_MAX_ZOOM,
  claim,
  onTakeover,
}: PictureZoomOptions): PictureZoom {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Box>({ width: 0, height: 0 });
  const [view, setView] = useState<View>(FITTED);
  const [settling, setSettling] = useState(false);
  const [panning, setPanning] = useState(false);

  const content = useMemo(() => containedSize(natural, viewport), [natural, viewport]);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  // Where 1:1 falls, and how far past it the view may go. The ceiling used to
  // BE 1:1, which stopped a develop well short of what a photographer inspects
  // at — 4000 % is Lightroom's, and `onePixel` is what tells the viewport when
  // it has crossed into magnifying preview pixels.
  const onePixel = onePixelZoom(natural, content, dpr);
  // The landmark is always reachable, whatever the ceiling: a picture whose
  // own pixels sit past it would otherwise be un-inspectable at 1:1.
  const max = Math.max(onePixel, ceiling);

  // Read by the native listeners, which are bound once.
  const live = useRef({ view, viewport, content, max, claim, onTakeover });
  live.current = { view, viewport, content, max, claim, onTakeover };

  useEffect(() => {
    setView(FITTED);
    setSettling(false);
  }, [resetKey]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () =>
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A box that shrinks, or a ceiling that drops, under a zoomed picture.
  useEffect(() => {
    setView((v) => clampView(v, viewport, content, max));
  }, [viewport, content, max]);

  const panBy = useCallback((dx: number, dy: number) => {
    const l = live.current;
    setView((v) => clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }, l.viewport, l.content, l.max));
  }, []);

  const zoomTo = useCallback((next: number, anchor: Point = { x: 0, y: 0 }) => {
    const l = live.current;
    setView((v) => zoomAbout(v, next, anchor, l.viewport, l.content, l.max));
  }, []);

  const anchorOf = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left - el.clientWidth / 2, y: clientY - r.top - el.clientHeight / 2 };
  }, []);

  // The one reading of the hand (`zoom-gestures.ts`): this surface only
  // answers what the scale is, what to do with a new one, and which single
  // pointer it lets the machine pan — a zoomed picture's, never the divider's.
  useZoomGestures({
    ref: viewportRef,
    target: {
      scaleAt: () => live.current.view.scale,
      zoomTo: (scale, anchor) => zoomTo(scale, anchorOf(anchor.x, anchor.y)),
      panBy: (dx, dy) => panBy(dx, dy),
      drag: (start) => {
        const l = live.current;
        if (start.pointer && l.claim?.(start.pointer.target)) return null;
        return l.view.scale > MIN_VIEW_ZOOM ? 'pan' : null;
      },
      onTakeover: () => live.current.onTakeover?.(),
      onGesture: () => setSettling(false),
      onDragging: setPanning,
    },
  });

  const byButton = useCallback(
    (next: number) => {
      setSettling(true);
      zoomTo(next);
    },
    [zoomTo],
  );

  const fractionAt = useCallback(
    (clientX: number, clientY: number) =>
      pictureFraction(live.current.view, anchorOf(clientX, clientY), live.current.content),
    [anchorOf],
  );

  return {
    viewportRef,
    view,
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
    settling,
    zoomed: view.scale > MIN_VIEW_ZOOM,
    onePixel,
    magnifying: view.scale > onePixel * 1.001,
    panning,
    zoom: {
      scale: view.scale,
      label: zoomLabel(view.scale),
      canZoomIn: view.scale < max - 1e-6,
      canZoomOut: view.scale > MIN_VIEW_ZOOM,
      zoomIn: () => byButton(stepViewZoom(live.current.view.scale, 1, live.current.max)),
      zoomOut: () => byButton(stepViewZoom(live.current.view.scale, -1, live.current.max)),
      reset: () => byButton(MIN_VIEW_ZOOM),
      // A rung a menu names — 1:1 above all, which is a LANDMARK here and not
      // a step the ladder ever lands on. `zoomAbout` clamps it to the ceiling.
      zoomTo: (scale: number) => byButton(scale),
    },
    fractionAt,
    pan: panBy,
    fit: () => {
      setSettling(false);
      setView(FITTED);
    },
    rect: pictureRect(view, viewport, content),
    viewport,
  };
}
