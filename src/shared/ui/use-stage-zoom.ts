/**
 * View zoom for a day-sized zone: its content is drawn bigger or smaller
 * inside a scroll box, and nothing about the document changes.
 *
 * The scale is applied by the CONSUMER, as layout size — the day grid
 * multiplies its cell, the stage ruler its day width — so the scroll extent is
 * the browser's own arithmetic and panning is native scrolling (trackpad,
 * scrollbars, shift-wheel). A CSS transform would have left the scroll box
 * measuring the unscaled element.
 *
 * A media PREVIEW is deliberately not a consumer: a view zoom over one fought
 * the framing gestures the picture itself answers, so both editor stages now
 * just fit their picture into the room they are given (`stage-zoom.ts`).
 *
 * Gestures:
 * - the +/− buttons of `StageZoomControl`, anchored on the viewport's centre;
 * - the wheel, anchored on the pointer — ctrl/⌘ always, which is also what a
 *   trackpad pinch sends, and a bare wheel where the zone asks for it
 *   (`WheelZoom`);
 * - a two-finger pinch on a touchscreen, anchored on the fingers' centre, which
 *   also pans by that centre's movement. Both zones deliberately do NOT claim
 *   the touch (one finger has to scroll a track wider than the screen), which
 *   leaves the browser first refusal on any gesture: the pinch is best-effort
 *   there and `StageZoomControl` is the way in that always answers.
 *
 * While two fingers are down `pinching` is true and the zone's own drag
 * handlers must stand down, or the first finger would drag a leg across the
 * ruler under the gesture.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_STAGE_ZOOM,
  MIN_STAGE_ZOOM,
  clampZoom,
  growthRatio,
  minScaleToFill,
  scrollAfterZoom,
  stepZoom,
  zoomFloor,
  zoomByPinch,
  wheelZooms,
  zoomByWheel,
  zoomLabel,
  type WheelZoom,
  type ZoomControls,
} from './stage-zoom';

export interface StageZoomOptions {
  /**
   * What a bare wheel does. Defaults to `modifier`, which leaves it to the
   * page or to whatever else the zone does with it. Both trip-overview zones
   * pass `any`: nothing else there wants the wheel.
   */
  wheel?: WheelZoom;
  /**
   * Pixels of content that do NOT scale, before the part that does — the day
   * grid's weekday rail. Only affects where the zoom leaves the scroll.
   */
  fixed?: { x?: number; y?: number };
  /**
   * The zone's own content width at a scale, rail excluded. Two things come
   * out of it: the zoom stops going out once the content no longer fills the
   * box (below that the browser has no scroll to give, so nothing can hold the
   * thing under the pointer), and the scroll correction learns how much the
   * content REALLY grew — a staircase, wherever a zone rounds to whole pixels.
   */
  contentWidth?: (scale: number, viewport: { width: number; height: number }) => number;
  /**
   * A floor the zone declares outright, for one it knows without measuring:
   * the stage ruler will not go under 100%, where a day is already as narrow
   * as it may be drawn. Held inside the range and never above 1.
   */
  minScale?: number;
}

export interface StageZoom extends ZoomControls {
  /** Two fingers are on the zone: ignore drags until they lift. */
  pinching: boolean;
  /** Put this on the scroll box that holds the zone. */
  viewportRef: RefObject<HTMLDivElement>;
  /** The scroll box's own size, measured — 0×0 until the first layout. */
  viewport: { width: number; height: number };
}

export function useStageZoom({
  wheel = 'modifier',
  fixed,
  contentWidth,
  minScale,
}: StageZoomOptions = {}): StageZoom {
  // Read through refs so a caller passing a fresh object or arrow literal
  // cannot re-run the effects.
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;
  const contentRef = useRef(contentWidth);
  contentRef.current = contentWidth;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  scaleRef.current = scale;
  const [pinching, setPinching] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // The box the picture is fitted into. `clientWidth`/`clientHeight`, not the
  // bounding rect: on a platform with classic scrollbars the rect still counts
  // the gutter the picture cannot use.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // How far out this zone may go: whichever is higher of the floor it declares
  // and the scale at which its content stops filling the box. Derived every
  // render — the viewport is state, so a resize moves it — and kept in a ref
  // for the gesture handlers, which are attached once.
  const fx = fixed?.x ?? 0;
  const floor = zoomFloor(
    Math.max(
      minScale ?? MIN_STAGE_ZOOM,
      contentWidth
        ? minScaleToFill((s) => fx + contentWidth(s, viewport), viewport.width)
        : MIN_STAGE_ZOOM,
    ),
  );
  const floorRef = useRef(floor);
  floorRef.current = floor;

  // The scroll correction owed to the next layout: where the anchor was, the
  // scale the scroll box is STILL showing, and the scroll it was showing it
  // at. Applied after React has resized the stage.
  const pending = useRef<{
    x: number;
    y: number;
    prev: number;
    scroll: { left: number; top: number };
  } | null>(null);

  const zoomTo = useCallback((next: number, anchor?: { clientX: number; clientY: number }) => {
    const prev = scaleRef.current;
    const z = clampZoom(next, floorRef.current);
    if (z === prev) return;
    const el = viewportRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      pending.current = {
        x: anchor ? anchor.clientX - rect.left : el.clientWidth / 2,
        y: anchor ? anchor.clientY - rect.top : el.clientHeight / 2,
        // A wheel spins out several events before React renders once, and each
        // of them raises the scale. The correction is measured from the scale
        // the box is still LAID OUT at — the first of the batch — not from the
        // one the last event started from, or a fast scroll drifts a little
        // further off the pointer with every notch.
        prev: pending.current?.prev ?? prev,
        // And from the scroll it had THEN. Reading it back after the layout
        // works while the content grows and lies when it shrinks: the browser
        // has already clamped the scroll into the smaller content, so the
        // correction projects a position that was never asked for — measured,
        // a zoom-out that overshot the floor jumped to the start of the track.
        scroll: pending.current?.scroll ?? { left: el.scrollLeft, top: el.scrollTop },
      };
    }
    scaleRef.current = z;
    setScale(z);
  }, []);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    const owed = pending.current;
    pending.current = null;
    if (!el || !owed) return;
    // How much the content actually grew between the scale the box is still
    // laid out at and the one it is going to. A zone that is proportional to
    // the scale says nothing and gets the scale ratio.
    const content = contentRef.current;
    const box = { width: el.clientWidth, height: el.clientHeight };
    const grew = content
      ? {
          x: growthRatio(
            content(owed.prev, box),
            content(scale, box),
            scale / owed.prev,
          ),
        }
      : undefined;
    const next = scrollAfterZoom(
      owed.scroll,
      owed,
      owed.prev,
      scale,
      { fixed: fixedRef.current, grew },
    );
    el.scrollLeft = next.left;
    el.scrollTop = next.top;
  }, [scale]);

  // Wheel. Attached natively and NOT passively: React's wheel handler is
  // passive, so preventDefault there is ignored and the browser zooms the page
  // instead of the stage.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!wheelZooms(e, wheel)) return;
      e.preventDefault();
      zoomTo(zoomByWheel(scaleRef.current, e.deltaY, floorRef.current), e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo, wheel]);

  // Touch pinch. Listened for in the CAPTURE phase, so the stage's canvas —
  // which stops nothing but does capture the first pointer — cannot hide the
  // second finger from us.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const touches = new Map<number, { x: number; y: number }>();
    let gesture: { distance: number; scale: number } | null = null;

    const centre = () => {
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

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        gesture = { distance: spread(), scale: scaleRef.current };
        setPinching(true);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      const before = touches.size === 2 ? centre() : null;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2 || !gesture || !before) return;
      e.preventDefault();
      const after = centre();
      // Pan first, on the raw movement of the fingers' centre: the zoom's own
      // correction is then measured from a scroll that is already up to date.
      el.scrollLeft -= after.x - before.x;
      el.scrollTop -= after.y - before.y;
      const distance = spread();
      if (gesture.distance > 0) {
        zoomTo(zoomByPinch(gesture.scale, distance / gesture.distance, floorRef.current), {
          clientX: after.x,
          clientY: after.y,
        });
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (touches.size < 2) {
        gesture = null;
        setPinching(false);
      }
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onUp, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
    };
  }, [zoomTo]);

  const zoomIn = useCallback(() => zoomTo(stepZoom(scaleRef.current, 1, floorRef.current)), [zoomTo]);
  const zoomOut = useCallback(
    () => zoomTo(stepZoom(scaleRef.current, -1, floorRef.current)),
    [zoomTo],
  );
  const reset = useCallback(() => zoomTo(1), [zoomTo]);

  // A box that grows under a zoomed-out zone raises the floor. Going back
  // through `zoomTo` rather than setting the scale queues the usual scroll
  // correction, anchored on the box's centre, so the content grows back about
  // its middle instead of snapping to the left edge.
  useEffect(() => {
    if (scaleRef.current < floor) zoomTo(floor);
  }, [floor, zoomTo]);

  return {
    scale,
    label: zoomLabel(scale),
    canZoomIn: scale < MAX_STAGE_ZOOM,
    canZoomOut: scale > floor,
    zoomIn,
    zoomOut,
    reset,
    pinching,
    viewportRef,
    viewport,
  };
}
