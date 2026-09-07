/**
 * View zoom for an editor stage: the picture is drawn bigger or smaller inside
 * a scroll box, and nothing about the document changes.
 *
 * The scale is applied by the CONSUMER, as layout size — the Studio multiplies
 * the canvas's max width/height, the badge stage multiplies its measured box —
 * so the scroll extent is the browser's own arithmetic and panning is native
 * scrolling (trackpad, scrollbars, shift-wheel). A CSS transform would have
 * left the scroll box measuring the unscaled element.
 *
 * Gestures:
 * - the +/− buttons of `StageZoomControl`, anchored on the viewport's centre;
 * - ctrl/⌘-wheel, which is also what a trackpad pinch sends, anchored on the
 *   pointer. A bare wheel is deliberately left alone: over the badge stage it
 *   already frames the picture inside the frame, a document edit;
 * - a two-finger pinch on a touchscreen, anchored on the fingers' centre, which
 *   also pans by that centre's movement (the stages set `touch-none`, so there
 *   is no native scrolling to inherit there).
 *
 * While two fingers are down `pinching` is true and the stage's own drag
 * handlers must stand down, or the first finger would drag an element across
 * the frame under the gesture.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_STAGE_ZOOM,
  MIN_STAGE_ZOOM,
  clampZoom,
  scrollAfterZoom,
  stepZoom,
  zoomByPinch,
  wheelZooms,
  zoomByWheel,
  zoomLabel,
  zoomedFit,
  type WheelZoom,
} from './stage-zoom';

export interface StageZoomOptions {
  /**
   * What a bare wheel does. Defaults to `modifier` — the editor stages leave
   * it to the page and to the badge stage's own framing zoom. The trip
   * overview's zones pass `any`: nothing else there wants the wheel.
   */
  wheel?: WheelZoom;
  /**
   * Pixels of content that do NOT scale, before the part that does — the day
   * grid's weekday rail. Only affects where the zoom leaves the scroll.
   */
  fixed?: { x?: number; y?: number };
}

export interface StageZoom {
  /** 1 = the picture at its fitted size. */
  scale: number;
  label: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Two fingers are on the stage: ignore drags until they lift. */
  pinching: boolean;
  /** Put this on the scroll box that holds the stage. */
  viewportRef: RefObject<HTMLDivElement>;
  /** The scroll box's own size, measured — 0×0 until the first layout. */
  viewport: { width: number; height: number };
  /** `max-width`/`max-height` for a picture fitted into that box at `scale`. */
  fit: { maxWidth: string; maxHeight: string };
}

export function useStageZoom({ wheel = 'modifier', fixed }: StageZoomOptions = {}): StageZoom {
  // Read through a ref so a caller passing a fresh object literal cannot
  // re-run the layout effect.
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;
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

  // The scroll correction owed to the next layout: where the anchor was, and
  // the scale the scroll box is STILL showing. Applied after React has resized
  // the stage.
  const pending = useRef<{ x: number; y: number; prev: number } | null>(null);

  const zoomTo = useCallback((next: number, anchor?: { clientX: number; clientY: number }) => {
    const prev = scaleRef.current;
    const z = clampZoom(next);
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
    const next = scrollAfterZoom(
      { left: el.scrollLeft, top: el.scrollTop },
      owed,
      owed.prev,
      scale,
      fixedRef.current,
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
      zoomTo(zoomByWheel(scaleRef.current, e.deltaY), e);
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
        zoomTo(zoomByPinch(gesture.scale, distance / gesture.distance), {
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

  const zoomIn = useCallback(() => zoomTo(stepZoom(scaleRef.current, 1)), [zoomTo]);
  const zoomOut = useCallback(() => zoomTo(stepZoom(scaleRef.current, -1)), [zoomTo]);
  const reset = useCallback(() => zoomTo(1), [zoomTo]);

  return {
    scale,
    label: zoomLabel(scale),
    canZoomIn: scale < MAX_STAGE_ZOOM,
    canZoomOut: scale > MIN_STAGE_ZOOM,
    zoomIn,
    zoomOut,
    reset,
    pinching,
    viewportRef,
    viewport,
    fit: zoomedFit(viewport, scale),
  };
}
