/**
 * The lightbox's hands: pinch and wheel to zoom, drag to pan, swipe to page.
 *
 * A deck of three slots — previous · current · next — laid over the viewport
 * and moved as one by `offset`, so a swipe reveals the neighbour progressively
 * instead of cutting to it. The current slot's picture carries its own `view`
 * (scale + offset), which is what zoom and pan move.
 *
 * Everything is a TRANSFORM, never layout size or scrolling: a deck has to
 * follow the finger past its own edges, which no scroll box does. The
 * arithmetic — pan limits, the rubber band, when a drag becomes a page — is
 * `pan-zoom.ts`, DOM-free and tested; this file is events only.
 *
 * What each gesture means, and why:
 * - ⌘/ctrl-wheel zooms about the pointer. That is also what a trackpad pinch
 *   sends, so the two are the same code by construction.
 * - A bare VERTICAL wheel zooms too. There is nothing else to do with it here,
 *   and a mouse has no other way to zoom.
 * - A bare HORIZONTAL wheel — a two-finger trackpad swipe — pages the deck,
 *   and pans instead once the picture is zoomed in and has somewhere to go.
 *   It arrives as a stream with no end event, so a short idle ends it.
 * - A drag pans when zoomed and swipes when not: at the fitted size there is
 *   nothing to pan, so the same gesture is free to mean the other thing.
 * - Two fingers pinch to zoom AND pan by their centre, which is why the
 *   viewport must be `touch-none`: there is no native scrolling to inherit.
 *
 * Deliberately NOT here: a swipe that continues out of a zoomed picture once
 * it hits an edge. iOS does it; it costs a per-axis "how far past the edge did
 * this drag push" state machine, and paging is one pinch away.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  FITTED,
  MAX_VIEW_ZOOM,
  MIN_VIEW_ZOOM,
  clampView,
  containedSize,
  rubberBand,
  stepViewZoom,
  swipeCommit,
  zoomAbout,
  zoomByPinchRatio,
  zoomByWheelDelta,
  type Box,
  type Point,
  type View,
} from './pan-zoom';
import type { ZoomControls } from './stage-zoom';

/** Paper between two slots, so the neighbour arrives as a separate sheet. */
export const DECK_GAP = 24;
/** How long the deck takes to settle, here and in the CSS that animates it. */
export const DECK_SETTLE_MS = 280;
/** A wheel gesture has no end event; this much quiet is its release. */
const WHEEL_IDLE_MS = 140;
/** Pixels before a drag has to say whether it is a pan or a swipe. */
const DRAG_SLOP = 6;
/**
 * The strip along the bottom of a clip where its native controls live, which
 * the deck keeps its hands off — a drag across the scrubber is a seek. A
 * heuristic (the browser does not expose the control bar) sized for the
 * tallest of them; above it a clip swipes like a picture, and everywhere a tap
 * still reaches the controls, because nothing is prevented before the slop.
 */
const VIDEO_CONTROLS_STRIP = 56;

export interface MediaViewerOptions {
  /** How many media the deck can reach. Under 2, nothing pages. */
  count: number;
  index: number;
  onIndex: (index: number) => void;
  /**
   * The current media's own pixel size, when the caller already knows it —
   * Winnow's row carries it. Without it the pan limits are measured off the
   * box, which lets a letterboxed picture pan into its own bars; the media
   * reports it through `onMeasured` as soon as it loads.
   */
  natural?: Box | null;
}

export interface MediaViewer {
  /** The box the deck is laid over. */
  viewportRef: RefObject<HTMLDivElement>;
  viewport: Box;
  /** Where the current picture sits inside its slot. */
  view: View;
  /** `transform` for it — apply to the media itself. */
  transform: string;
  /** Whether that transform should animate (a button, not a finger). */
  viewSettling: boolean;
  /** Pixels the whole deck is dragged by; 0 at rest. */
  offset: number;
  /** Whether the deck should animate back to `offset`. */
  settling: boolean;
  dragging: boolean;
  zoomed: boolean;
  zoom: ZoomControls;
  /** The three media the deck keeps mounted, in the order it draws them. */
  slots: { slot: -1 | 0 | 1; index: number }[];
  /**
   * Page by one, sliding. The arrows and the arrow KEYS go through it rather
   * than moving the index themselves, so every way of changing picture looks
   * the same and none of them can leave the deck mid-drag.
   */
  pageBy: (direction: -1 | 1) => void;
  /** The media's own pixel size, once it has loaded and can say. */
  onMeasured: (natural: Box) => void;
}

export function useMediaViewer({
  count,
  index,
  onIndex,
  natural = null,
}: MediaViewerOptions): MediaViewer {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Box>({ width: 0, height: 0 });
  const [measured, setMeasured] = useState<Box | null>(null);
  const known = natural ?? measured;
  const [view, setView] = useState<View>(FITTED);
  const [viewSettling, setViewSettling] = useState(false);
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Handlers are attached once and read the world through refs.
  const viewRef = useRef(view);
  viewRef.current = view;
  const contentRef = useRef<Box>(viewport);
  contentRef.current = containedSize(known, viewport);
  const viewportBoxRef = useRef(viewport);
  viewportBoxRef.current = viewport;
  const indexRef = useRef(index);
  indexRef.current = index;
  const countRef = useRef(count);
  countRef.current = count;
  const onIndexRef = useRef(onIndex);
  onIndexRef.current = onIndex;
  /**
   * A page is in flight. A gesture arriving now does not wait for it and is
   * not dropped: it LANDS it (`land`) and starts from there. Dropping was the
   * one place the deck genuinely refused a swipe, and it read as the picture
   * not being loaded yet.
   */
  const busy = useRef(false);
  const pending = useRef<-1 | 1 | null>(null);
  const settleTimer = useRef<number | null>(null);

  // A new picture is looked at whole, and the last one's measurement is not
  // its own. What the caller knows outright arrives as a prop and needs no
  // clearing.
  useEffect(() => {
    setView(FITTED);
    setViewSettling(false);
    setMeasured(null);
  }, [index]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // `clientWidth`, not the bounding rect: a classic scrollbar's gutter is
    // not room the picture may use.
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

  // A box that shrinks under a zoomed picture leaves it hanging off an edge.
  useEffect(() => {
    setView((v) => clampView(v, viewportBoxRef.current, contentRef.current));
  }, [viewport, known?.width, known?.height]);

  /** The travel of one page: the slot plus the paper between two of them. */
  const slotTravel = useCallback(
    () => (viewportRef.current?.clientWidth ?? 0) + DECK_GAP,
    [],
  );

  const clearSettle = () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
  };

  /**
   * The end of a page, whenever it comes: on the timer, or early because a
   * new gesture wants the deck. The neighbour is already where the middle
   * slot is, so swapping the slots and dropping the offset in one commit
   * shows no seam.
   */
  const land = useCallback(() => {
    const dir = pending.current;
    clearSettle();
    pending.current = null;
    busy.current = false;
    if (dir === null) return;
    setSettling(false);
    setOffset(0);
    setView(FITTED);
    const at = (indexRef.current + dir + countRef.current) % countRef.current;
    // Eagerly, because a gesture that landed this page reads the index again
    // in the same event, before React has re-rendered and refreshed the ref.
    indexRef.current = at;
    onIndexRef.current(at);
  }, []);

  /** Back to rest, animated — a drag that did not earn a page. */
  const settleBack = useCallback(() => {
    clearSettle();
    setSettling(true);
    setOffset(0);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      setSettling(false);
    }, DECK_SETTLE_MS);
  }, []);

  /**
   * Page by one: slide the deck a whole slot, and let `land` finish it.
   *
   * A timer rather than `transitionend`, which does not fire when the offset
   * is already at its target and would leave the deck stuck.
   */
  const page = useCallback(
    (dir: -1 | 1) => {
      const travel = slotTravel();
      if (countRef.current < 2 || travel === 0) {
        settleBack();
        return;
      }
      clearSettle();
      busy.current = true;
      pending.current = dir;
      setSettling(true);
      setOffset(-dir * travel);
      settleTimer.current = window.setTimeout(land, DECK_SETTLE_MS);
    },
    [land, settleBack, slotTravel],
  );

  useEffect(() => clearSettle, []);

  /** Move the deck under a gesture, resisting where there is no neighbour. */
  const dragTo = useCallback((distance: number) => {
    const travel = slotTravel();
    if (countRef.current < 2) {
      setOffset(rubberBand(distance, travel));
      return;
    }
    setOffset(Math.min(travel, Math.max(-travel, distance)));
  }, [slotTravel]);

  const panBy = useCallback((dx: number, dy: number) => {
    setView((v) =>
      clampView(
        { scale: v.scale, x: v.x + dx, y: v.y + dy },
        viewportBoxRef.current,
        contentRef.current,
      ),
    );
  }, []);

  /** `anchor` is measured from the viewport's CENTRE, where the origin is. */
  const zoomTo = useCallback((next: number, anchor: Point = { x: 0, y: 0 }) => {
    setView((v) => zoomAbout(v, next, anchor, viewportBoxRef.current, contentRef.current));
  }, []);

  const anchorOf = (clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: clientX - rect.left - el.clientWidth / 2,
      y: clientY - rect.top - el.clientHeight / 2,
    };
  };

  // Wheel. Native and NOT passive: React's own wheel handler is passive, so
  // `preventDefault` there is ignored and the browser zooms the page instead.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let swept = 0;
    let idle: number | null = null;

    const endSweep = () => {
      idle = null;
      const dir = swipeCommit(swept, slotTravel(), 0);
      swept = 0;
      if (dir) page(dir);
      else settleBack();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (busy.current) land();
      setViewSettling(false);
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      // A trackpad pinch arrives as a ctrl-wheel; so does a real one.
      if (e.ctrlKey || e.metaKey || !sideways) {
        zoomTo(zoomByWheelDelta(viewRef.current.scale, e.deltaY), anchorOf(e.clientX, e.clientY));
        return;
      }
      if (viewRef.current.scale > MIN_VIEW_ZOOM) {
        panBy(-e.deltaX, 0);
        return;
      }
      swept -= e.deltaX;
      dragTo(swept);
      if (idle !== null) window.clearTimeout(idle);
      idle = window.setTimeout(endSweep, WHEEL_IDLE_MS);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (idle !== null) window.clearTimeout(idle);
    };
  }, [dragTo, land, page, panBy, settleBack, slotTravel, zoomTo]);

  // Pointers: one drag pans or swipes, two fingers pinch.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const touches = new Map<number, Point>();
    let pinch: { spread: number; scale: number } | null = null;
    let drag:
      | {
          id: number;
          startX: number;
          startY: number;
          lastX: number;
          lastY: number;
          lastAt: number;
          speed: number;
          mode: 'idle' | 'pan' | 'swipe';
        }
      | null = null;

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
    const dropDrag = () => {
      drag = null;
      setDragging(false);
    };

    const onDown = (e: PointerEvent) => {
      if (busy.current) land();
      setViewSettling(false);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          // The first finger was dragging; two of them are a pinch instead,
          // and whatever it had moved stays where it left it.
          pinch = { spread: spread(), scale: viewRef.current.scale };
          if (drag?.mode === 'swipe') settleBack();
          dropDrag();
          return;
        }
        if (touches.size > 2) return;
      } else if (e.button !== 0) return;
      // A clip's own controls own the bottom of it: a drag across the
      // scrubber is a seek, not a swipe.
      const clip = (e.target as Element | null)?.closest?.('video');
      if (clip) {
        const box = clip.getBoundingClientRect();
        if (e.clientY > box.bottom - VIDEO_CONTROLS_STRIP) return;
      }
      if (pinch) return;
      drag = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastAt: e.timeStamp,
        speed: 0,
        mode: 'idle',
      };
      setDragging(true);
      // Capture so a mouse that leaves the frame mid-drag still reports; a
      // pointer the browser no longer knows about (a synthetic one) throws
      // rather than answering, and a drag works without it either way.
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
          // Pan on the raw movement of the fingers' centre first, so the
          // zoom's own correction is measured from an offset already updated.
          panBy(after.x - before.x, after.y - before.y);
          if (pinch.spread > 0) {
            zoomTo(
              zoomByPinchRatio(pinch.scale, spread() / pinch.spread),
              anchorOf(after.x, after.y),
            );
          }
          return;
        }
      }
      if (!drag || e.pointerId !== drag.id || busy.current) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      const total = e.clientX - drag.startX;
      if (drag.mode === 'idle') {
        if (Math.abs(total) < DRAG_SLOP && Math.abs(e.clientY - drag.startY) < DRAG_SLOP) {
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          return;
        }
        // Zoomed in there is somewhere to go, so the drag goes there;
        // fitted there is not, so it means the deck.
        drag.mode = viewRef.current.scale > MIN_VIEW_ZOOM ? 'pan' : 'swipe';
      }
      const dt = e.timeStamp - drag.lastAt;
      if (dt > 0) drag.speed = dx / dt;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.lastAt = e.timeStamp;
      e.preventDefault();
      if (drag.mode === 'pan') panBy(dx, dy);
      else dragTo(total);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
      }
      if (!drag || e.pointerId !== drag.id) return;
      const mode = drag.mode;
      const total = e.clientX - drag.startX;
      const speed = drag.speed;
      dropDrag();
      if (mode !== 'swipe' || busy.current) return;
      const dir = swipeCommit(total, slotTravel(), speed);
      if (dir && countRef.current > 1) page(dir);
      else settleBack();
    };

    // Capture, so nothing inside the slot can hide a finger from the deck.
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
  }, [dragTo, land, page, panBy, settleBack, slotTravel, zoomTo]);

  const byButton = useCallback(
    (next: number) => {
      setViewSettling(true);
      zoomTo(next);
    },
    [zoomTo],
  );

  const slots: MediaViewer['slots'] =
    count > 1
      ? ([-1, 0, 1] as const).map((slot) => ({
          slot,
          index: (index + slot + count) % count,
        }))
      : [{ slot: 0, index }];

  return {
    viewportRef,
    viewport,
    view,
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
    viewSettling,
    offset,
    settling,
    dragging,
    zoomed: view.scale > MIN_VIEW_ZOOM,
    zoom: {
      scale: view.scale,
      label: `${Math.round(view.scale * 100)}%`,
      canZoomIn: view.scale < MAX_VIEW_ZOOM,
      canZoomOut: view.scale > MIN_VIEW_ZOOM,
      zoomIn: () => byButton(stepViewZoom(viewRef.current.scale, 1)),
      zoomOut: () => byButton(stepViewZoom(viewRef.current.scale, -1)),
      reset: () => byButton(MIN_VIEW_ZOOM),
    },
    slots,
    pageBy: page,
    onMeasured: setMeasured,
  };
}
