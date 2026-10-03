/**
 * The press, watched ONCE for the whole suite (`press.ts` holds the rules).
 *
 * A document listener rather than a handler in each component, for two
 * reasons: the recipes are class strings used on `<button>`, `<label>` and
 * `<a>` alike (`buttonClass`), and composing an `onPointerDown` into every
 * caller's own would be a hundred places to forget one. The listener only
 * sets `data-pressed` on the control under the pointer; what that LOOKS like
 * is each recipe's (`Button.tsx` → `PRESS_LOOK`).
 *
 * Capture phase and passive: it runs before any handler can stop the event,
 * and it never prevents anything — a press that turns into a scroll is
 * cancelled by the browser (`pointercancel`) and the control comes back up
 * at once.
 */

import { PRESS_HOLD_MS, PRESS_TARGET, canPress, releaseDelay } from './press';

const ATTR = 'data-pressed';

interface Held {
  el: HTMLElement;
  pointerId: number;
  pointerType: string;
  downAt: number;
}

let held: Held | null = null;
const releases = new WeakMap<HTMLElement, number>();

function pressable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(PRESS_TARGET);
  if (!(el instanceof HTMLElement)) return null;
  const candidate = {
    disabled: 'disabled' in el ? Boolean((el as HTMLButtonElement).disabled) : false,
    ariaDisabled: el.getAttribute('aria-disabled'),
    inert: el.closest('[inert]') !== null,
  };
  return canPress(candidate) ? el : null;
}

function press(el: HTMLElement) {
  const pending = releases.get(el);
  if (pending !== undefined) window.clearTimeout(pending);
  releases.delete(el);
  el.setAttribute(ATTR, '');
}

function release(el: HTMLElement, delay: number) {
  const pending = releases.get(el);
  if (pending !== undefined) window.clearTimeout(pending);
  if (delay <= 0) {
    releases.delete(el);
    el.removeAttribute(ATTR);
    return;
  }
  releases.set(
    el,
    window.setTimeout(() => {
      releases.delete(el);
      el.removeAttribute(ATTR);
    }, delay),
  );
}

let installed = false;

/** Starts watching presses. Idempotent; called once from `main.tsx`. */
export function installPressFeedback(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const opts = { capture: true, passive: true } as const;

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const el = pressable(e.target);
      if (!el) return;
      if (held && held.el !== el) release(held.el, 0);
      held = { el, pointerId: e.pointerId, pointerType: e.pointerType, downAt: e.timeStamp };
      press(el);
    },
    opts,
  );

  document.addEventListener(
    'pointerup',
    (e) => {
      if (!held || e.pointerId !== held.pointerId) return;
      release(held.el, releaseDelay(held.pointerType, held.downAt, e.timeStamp));
      held = null;
    },
    opts,
  );

  // The browser took the gesture (a scroll, a pinch): the control was never
  // really pressed, so it comes back up at once.
  document.addEventListener(
    'pointercancel',
    (e) => {
      if (!held || e.pointerId !== held.pointerId) return;
      release(held.el, 0);
      held = null;
    },
    opts,
  );

  // A mouse dragged OFF the control while still down: up while it is out,
  // down again if it comes back — the click would land only inside. A touch
  // is captured to its target, so this never fires mid-press for a finger.
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!held || e.pointerId !== held.pointerId) return;
      const to = e.relatedTarget;
      if (to instanceof Node && held.el.contains(to)) return;
      release(held.el, 0);
    },
    opts,
  );
  document.addEventListener(
    'pointerover',
    (e) => {
      if (!held || e.pointerId !== held.pointerId) return;
      if (e.target instanceof Node && held.el.contains(e.target)) press(held.el);
    },
    opts,
  );

  // A control pressed by the KEYBOARD (Enter or Space activates a button with
  // a click whose `detail` is 0) goes down for the hold too, so a press is
  // seen whatever pressed it.
  document.addEventListener(
    'click',
    (e) => {
      if (e.detail !== 0 || !e.isTrusted) return;
      const el = pressable(e.target);
      if (!el) return;
      press(el);
      release(el, PRESS_HOLD_MS);
    },
    opts,
  );
}
