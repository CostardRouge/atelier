/**
 * A PRESS that a finger can see (`docs/press-feedback.md`).
 *
 * Before this, the suite's only pressed state was `active:scale-[0.98]` — a
 * quarter of a pixel a side on a 28px glyph, gone at the lift — and Tailwind
 * v4 draws every `hover:` only where the device can hover, so under a finger
 * a control answered nothing at all. A fingertip also COVERS the glyph it
 * presses: whatever ends with the lift is never seen. So the pressed state is
 * set on `pointerdown` and held a little AFTER the lift (`press-dom.ts` sets
 * a `data-pressed` attribute; the recipes style it as a key going down).
 *
 * This module is the arithmetic, DOM-free and tested.
 */

/**
 * What a PRESSED control looks like: a key going down — one pixel, an inset
 * shade under its top edge (`--shadow-press`, redefined on a dark ground),
 * at once (`duration-0`, so a tap shorter than the transition is still drawn
 * whole) and easing back up. A recipe adds its own pressed GROUND beside it.
 * The pixel moves on PRESS, never on hover: «nothing moves under the pointer»
 * is about a target sliding away from a hovering pointer (`frontend.md`).
 */
export const PRESS_LOOK = 'data-pressed:translate-y-px data-pressed:shadow-press data-pressed:duration-0';

/** How long a press stays drawn after the lift, for a finger. */
export const PRESS_HOLD_MS = 120;

/**
 * Everything that can be pressed. The attribute lands on any of them; only
 * the recipes that style `data-pressed` (`Button`, `IconButton`, `Segmented`,
 * a menu row, the Develop well's own verbs) draw it.
 */
export const PRESS_TARGET = [
  'button',
  'a[href]',
  'label',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="option"]',
].join(', ');

/**
 * How long the pressed state stays after the lift.
 *
 * A finger (or a pen) hid the control for the whole press, so what is seen is
 * what stays after it: always the hold. A mouse saw the press while it lasted,
 * so only a click quicker than the hold is topped up to it.
 */
export function releaseDelay(
  pointerType: string,
  downAt: number,
  upAt: number,
  hold: number = PRESS_HOLD_MS,
): number {
  if (pointerType === 'touch' || pointerType === 'pen') return hold;
  return Math.max(0, hold - Math.max(0, upAt - downAt));
}

/** What a press asks of the thing pressed. */
export interface PressCandidate {
  disabled?: boolean;
  ariaDisabled?: string | null;
  inert?: boolean;
}

/**
 * Whether a press should draw. A disabled control does not go down — and an
 * `aria-disabled` one is still touchable (so a tap can say WHY it is grey,
 * `use-verb.ts`) but must not look like it did something.
 */
export function canPress(el: PressCandidate): boolean {
  if (el.disabled) return false;
  if (el.ariaDisabled === 'true') return false;
  if (el.inert) return false;
  return true;
}

/**
 * The size a control takes under the hand that uses it (C5): a finger's
 * (`md`, 34 px) on a phone's shell or wherever the pointer is coarse — an
 * iPad in landscape is a WIDE shell held by a finger, and it was given the
 * mouse's 28 px — else a mouse's (`sm`).
 */
export function fingerSize(compact: boolean, coarse: boolean): 'md' | 'sm' {
  return compact || coarse ? 'md' : 'sm';
}
