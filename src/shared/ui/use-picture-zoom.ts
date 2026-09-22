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
  zoomByPinchRatio,
  zoomByWheelDelta,
  type Box,
  type Point,
  type View,
} from './pan-zoom';
import { blockNativeZoom } from './native-gestures';
import { zoomLabel, type ZoomControls } from './stage-zoom';

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
   * A single pointer the caller keeps for itself (the develop sheet's wipe):
   * the hook neither pans nor captures it. A second finger landing still
   * makes a pinch of the two, and `onTakeover` tells the caller to let go.
   */
  claim?: (e: PointerEvent) => boolean;
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
  /** Where the picture sits in the viewport, in its pixels. */
  rect: Box & Point;
  /** The viewport's measured size. */
  viewport: Box;
}

/** Wheel and fingers under this, in px, are a tap rather than a pan. */
const PAN_SLOP = 3;

/**
 * Looking closely at ONE picture: wheel, trackpad pinch, a two-finger pinch
 * and a drag that pans once zoomed — the lightbox's gestures without its deck.
 *
 * Kept apart from `use-media-viewer.ts` on purpose. That hook pages a deck in
 * every one of its handlers (swipe, sweep, momentum, a page in flight that a
 * gesture must land), and its wheel-latching fixes were paid for one at a
 * time; a surface with a single picture needs none of it, and teaching the
 * deck an "off" switch would put those fixes at risk for nothing. The
 * arithmetic is the same module (`pan-zoom.ts`).
 *
 * The ceiling is `INSPECT_MAX_ZOOM` — 4000 %, Lightroom's. One pixel of the
 * picture per device pixel (`onePixel`) is no longer the ceiling but a
 * LANDMARK: past it what grows is a preview pixel, and the viewport says so by
 * offering to draw it un-smoothed rather than by refusing to go there.
 *
 * What the gestures mean, the lightbox's grammar: ⌘/ctrl-wheel (a trackpad
 * pinch) and a bare vertical wheel zoom about the pointer; a sideways wheel
 * pans once zoomed; two fingers pinch and pan by their centre. Listeners are
 * native and not passive — React's wheel handler is passive, so the page
 * would zoom instead.
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

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSettling(false);
      const l = live.current;
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (e.ctrlKey || e.metaKey || !sideways) {
        zoomTo(zoomByWheelDelta(l.view.scale, e.deltaY, l.max), anchorOf(e.clientX, e.clientY));
      } else if (l.view.scale > MIN_VIEW_ZOOM) {
        panBy(-e.deltaX, 0);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [anchorOf, panBy, zoomTo]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const touches = new Map<number, Point>();
    let pinch: { spread: number; scale: number } | null = null;
    let drag: { id: number; startX: number; startY: number; lastX: number; lastY: number; moving: boolean } | null =
      null;

    const centre = (): Point => {
      const pts = [...touches.values()];
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      };
    };
    const spread = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const endDrag = () => {
      drag = null;
      setPanning(false);
    };

    const onDown = (e: PointerEvent) => {
      // A control over the picture (hold for before) keeps its own press — but
      // its FINGER is still one of the two a pinch is made of. Counting it only
      // when it lands on bare picture is what made a pinch beginning on the
      // "before" pill do nothing at all, and left the count one short for the
      // rest of the gesture.
      const overControl = Boolean((e.target as Element | null)?.closest?.('button, [data-pan-ignore]'));
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          setSettling(false);
          pinch = { spread: spread(), scale: live.current.view.scale };
          endDrag();
          live.current.onTakeover?.();
          return;
        }
        if (touches.size > 2) return;
      } else if (e.button !== 0) {
        return;
      }
      if (overControl) return;
      setSettling(false);
      const l = live.current;
      if (pinch || l.claim?.(e) || l.view.scale <= MIN_VIEW_ZOOM) return;
      drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moving: false };
      if (e.pointerType !== 'touch') {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* not a live pointer */
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        const before = touches.size === 2 ? centre() : null;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2 && pinch && before) {
          e.preventDefault();
          const after = centre();
          // Pan on the fingers' centre first, so the zoom's own correction is
          // measured from an offset already moved (the lightbox's order).
          panBy(after.x - before.x, after.y - before.y);
          if (pinch.spread > 0) {
            zoomTo(zoomByPinchRatio(pinch.scale, spread() / pinch.spread, live.current.max), anchorOf(after.x, after.y));
          }
          return;
        }
      }
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moving) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < PAN_SLOP) return;
        drag.moving = true;
        setPanning(true);
      }
      e.preventDefault();
      panBy(e.clientX - drag.lastX, e.clientY - drag.lastY);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (pinch && touches.size < 2) {
          pinch = null;
          // One finger of a pinch lifted, the other still on the picture: it
          // takes the pan over, rather than being inert until it is lifted and
          // put back down. Zoomed in, that second half is most of the gesture.
          const [id] = [...touches.keys()];
          const at = id === undefined ? undefined : touches.get(id);
          if (id !== undefined && at && live.current.view.scale > MIN_VIEW_ZOOM) {
            drag = { id, startX: at.x, startY: at.y, lastX: at.x, lastY: at.y, moving: true };
            setPanning(true);
          }
        }
      }
      if (drag && e.pointerId === drag.id) endDrag();
    };

    // The browser's OWN pinch would cancel every pointer above (`native-gestures.ts`).
    const unblock = blockNativeZoom(el);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      unblock();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [anchorOf, panBy, zoomTo]);

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
    },
    fractionAt,
    rect: pictureRect(view, viewport, content),
    viewport,
  };
}
