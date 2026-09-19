import { useCallback, useRef } from 'react';
import { blendVelocity, flingStep, swipeIntent, throwVelocity } from './fling';
import { prefersReducedMotion } from './reduced-motion';

export interface FlingPanOptions {
  /**
   * Move the content sideways by `px` — positive brings what is on the RIGHT
   * in, the sign `scrollLeft` uses, so the content follows the finger.
   * Return `false` when nothing moved at all (an edge): a glide that cannot
   * travel any further stops there instead of spinning against the end.
   */
  onPan: (px: number) => boolean | void;
  /**
   * True while the surface runs a drag of its OWN — a leg being moved on the
   * ruler. The swipe stands down (one gesture, one meaning), and the browser
   * is kept out of that drag exactly as it is kept out of a swipe.
   */
  holding?: () => boolean;
  /**
   * The press stopped being a candidate for a HOLD: it travelled, whichever
   * way, or it ended. A surface that picks something up after a still press
   * (`press-intent.ts`) cancels its timer here — a finger that travels is
   * scrolling or swiping, and one that lifts early never picked anything up.
   */
  onSettle?: () => void;
}

/**
 * A surface panned sideways by a finger, with the throw a phone expects.
 *
 * Why it exists rather than a `touch-action` and the browser's own scrolling:
 * the stage ruler's sideways travel is not a scroll box at all past a certain
 * length — it moves the loupe's WINDOW over the trip, a week at a time — so
 * the pixels have to be read and answered here.
 *
 * **What was broken and is the rule now.** A pan that only set
 * `touch-action: pan-y` and read `pointermove` lost the gesture to the
 * browser on a phone after the first instant: `pan-y` leaves the vertical
 * axis to the page, so the moment a real swipe's small vertical component
 * started the page scrolling, the pointer was CANCELLED and the pan died
 * one frame in. `touch-action` is decided before anyone knows which way the
 * finger went; it cannot be the whole answer. So: the direction is decided
 * here on the first travel past the slop (`swipeIntent`), and a swipe that
 * is ours is then held with `preventDefault` on a NON-PASSIVE `touchmove` —
 * the same remedy the loupe's body drag already uses (`LoupeBrush`), and the
 * only one that survives a diagonal finger.
 *
 * The surface still needs `touch-pan-y` (never `touch-none`): a finger
 * travelling UP it is reading the page, and must keep that.
 *
 * A press that never travelled is left alone entirely — it stays the plain
 * click the surface already answered. A swipe swallows the click it would
 * otherwise end in.
 */
export function useFlingPan(options: FlingPanOptions): (node: HTMLElement | null) => void {
  const live = useRef(options);
  live.current = options;
  const detach = useRef<(() => void) | null>(null);

  /**
   * Attaching and detaching are BOTH the ref's, and there is deliberately no
   * unmount effect beside it: in StrictMode an effect's cleanup runs on the
   * simulated remount, and a teardown living there pulled every listener off
   * an element React never handed back — the surface then looked bound (it
   * was the right node, it kept its classes) and answered nothing. A ref
   * callback is called with `null` on the real unmount, which is the whole
   * lifecycle this needs.
   */
  return useCallback((node: HTMLElement | null) => {
    detach.current?.();
    detach.current = node ? bind(node, live) : null;
  }, []);
}

interface Press {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  claimed: boolean;
  settled: boolean;
}

function bind(el: HTMLElement, live: { current: FlingPanOptions }): () => void {
  let press: Press | null = null;
  let glide = 0;
  // The click a swipe ends in is not a tap; swallowed in the capture phase,
  // like the loupe's. A touch that moved may produce no click at all, so the
  // flag is dropped on the next tick rather than waiting for one.
  let swallow = false;

  const stopGlide = () => {
    if (glide) cancelAnimationFrame(glide);
    glide = 0;
  };
  /** Returns false only when the surface positively could not move. */
  const pan = (px: number) => live.current.onPan(px) !== false;
  const settle = () => {
    if (!press || press.settled) return;
    press.settled = true;
    live.current.onSettle?.();
  };

  const down = (e: PointerEvent) => {
    // A finger landing on a moving band stops it, wherever it lands.
    stopGlide();
    if (press || e.button !== 0 || !e.isPrimary) return;
    press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastAt: e.timeStamp,
      velocity: 0,
      claimed: false,
      settled: false,
    };
  };

  const move = (e: PointerEvent) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    if (!p.claimed) {
      const intent = swipeIntent(e.clientX - p.x, e.clientY - p.y);
      if (intent === 'pending') return;
      settle();
      if (intent === 'release' || live.current.holding?.() === true) {
        press = null;
        return;
      }
      p.claimed = true;
      try {
        el.setPointerCapture(p.id);
      } catch {
        // The pointer is already gone; the next event ends the press.
      }
    }
    // Content follows the finger: travelling left brings what is right in.
    const dx = p.lastX - e.clientX;
    p.velocity = blendVelocity(p.velocity, dx, e.timeStamp - p.lastAt);
    p.lastX = e.clientX;
    p.lastAt = e.timeStamp;
    pan(dx);
  };

  const up = (e: PointerEvent) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    settle();
    press = null;
    if (el.hasPointerCapture(p.id)) el.releasePointerCapture(p.id);
    if (!p.claimed) return;
    swallow = true;
    window.setTimeout(() => {
      swallow = false;
    }, 0);
    const velocity = throwVelocity({
      velocity: p.velocity,
      sinceLastMoveMs: e.timeStamp - p.lastAt,
      cancelled: e.type === 'pointercancel' || prefersReducedMotion(),
    });
    if (velocity === 0) return;
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      glide = 0;
      const frame = flingStep(v, now - last);
      last = now;
      v = frame.velocity;
      if (!pan(frame.dx) || frame.done) return;
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };

  // Non-passive, and the reason is the whole point of this hook: only a
  // cancelled `touchmove` keeps the browser from panning the page under a
  // gesture that is ours — and from cancelling the pointer with it.
  const touchmove = (e: TouchEvent) => {
    if ((press?.claimed || live.current.holding?.() === true) && e.cancelable) e.preventDefault();
  };
  const click = (e: MouseEvent) => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('touchmove', touchmove, { passive: false });
  el.addEventListener('click', click, true);
  return () => {
    stopGlide();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('touchmove', touchmove);
    el.removeEventListener('click', click, true);
  };
}
