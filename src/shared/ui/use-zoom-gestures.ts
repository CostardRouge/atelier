import { useEffect, useRef, type RefObject } from 'react';
import { blockNativeZoom } from './native-gestures';
import {
  ZoomGestureMachine,
  type GesturePointer,
  type ZoomGestureOptions,
  type ZoomTarget,
} from './zoom-gestures';

export interface UseZoomGesturesOptions extends ZoomGestureOptions {
  /** The box the gestures are heard on — the box a picture is centred IN, never the picture. */
  ref: RefObject<HTMLElement | null>;
  /** The surface's answers. Read live: a new object every render is fine. */
  target: ZoomTarget;
  /** Listen in the capture phase (a deck whose slots must not hide a finger). */
  capture?: boolean;
  /** Re-bind when this changes — for an element that is mounted conditionally. */
  active?: unknown;
  /** False binds nothing at all: a stage with nothing to zoom leaves the wheel to the page. */
  enabled?: boolean;
}

/**
 * The DOM half of `zoom-gestures.ts`: native, non-passive listeners on one
 * element, feeding one `ZoomGestureMachine` for the element's life.
 *
 * Native because React's own `wheel` handler is passive, so a `preventDefault`
 * there is ignored and the page scrolls (or zooms) away under the picture.
 * Attached and detached in the SAME effect: a hook that attached in a ref
 * callback and detached in an effect was dead under StrictMode's simulated
 * remount (`frontend.md`). The effect re-runs only when the element could
 * have changed (`active`); everything the machine needs from the surface
 * goes through a ref, so a listener bound once never reads a stale closure.
 *
 * `blockNativeZoom` is bound here too, on the same element: WebKit's own pinch
 * would otherwise magnify the app and cancel the very pointers the machine is
 * reading, and it must never be taken from the document.
 */
export function useZoomGestures({
  ref,
  target,
  capture = false,
  active,
  enabled = true,
  wheel,
  slop,
}: UseZoomGesturesOptions): void {
  const live = useRef(target);
  live.current = target;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    // The target the machine holds forwards to whatever the surface last
    // rendered, so the machine itself lives as long as the element.
    const machine = new ZoomGestureMachine(
      {
        scaleAt: (at) => live.current.scaleAt(at),
        zoomTo: (s, a, by) => live.current.zoomTo(s, a, by),
        panBy: (dx, dy, at, by) => live.current.panBy(dx, dy, at, by),
        drag: (s) => live.current.drag?.(s) ?? null,
        onTakeover: () => live.current.onTakeover?.(),
        onPinch: (on) => live.current.onPinch?.(on),
        onGesture: () => live.current.onGesture?.(),
        onDragging: (on) => live.current.onDragging?.(on),
        capture: (id) => {
          try {
            el.setPointerCapture(id);
          } catch {
            /* not a live pointer (a synthetic one) */
          }
        },
      },
      { wheel, slop },
    );

    const read = (e: PointerEvent): GesturePointer => ({
      id: e.pointerId,
      kind: e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse',
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      overControl: Boolean((e.target as Element | null)?.closest?.('button, [data-pan-ignore]')),
      target: e.target,
      t: e.timeStamp,
    });

    const onWheel = (e: WheelEvent) => {
      const took = machine.onWheel({
        x: e.clientX,
        y: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
      if (took) e.preventDefault();
    };
    const onDown = (e: PointerEvent) => machine.onDown(read(e));
    const onMove = (e: PointerEvent) => {
      if (machine.onMove(read(e))) e.preventDefault();
    };
    const onUp = (e: PointerEvent) => machine.onUp(read(e), false);
    const onCancel = (e: PointerEvent) => machine.onUp(read(e), true);

    const unblock = blockNativeZoom(el);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown, capture);
    el.addEventListener('pointermove', onMove, capture);
    el.addEventListener('pointerup', onUp, capture);
    el.addEventListener('pointercancel', onCancel, capture);
    return () => {
      unblock();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown, capture);
      el.removeEventListener('pointermove', onMove, capture);
      el.removeEventListener('pointerup', onUp, capture);
      el.removeEventListener('pointercancel', onCancel, capture);
    };
  }, [ref, capture, active, enabled, wheel, slop]);
}
