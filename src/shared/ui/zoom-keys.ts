/**
 * Who owns `Z` and the arrows over a picture being LOOKED at.
 *
 * The fourth of the suite's key-ownership modules, beside `transport-keys.ts`
 * (space), `dialog-keys.ts` (Enter, Escape) and `undo-keys.ts` (⌘Z), and
 * it answers the same question: a shortcut bound on `window` stands down
 * whenever the focused element has a better claim. `Z` toggles the view
 * between the fit and a first zoom; the arrows pan a ZOOMED view and mean
 * nothing at the fit — a fitted picture has nowhere to go, so a surface with
 * another use for them (the lightbox pages its deck) keeps that use there.
 *
 * Only the *Looking* surfaces read this: a *Placing* surface (Trips' badge
 * stage) already gives its arrows to the selected element, and the Develop
 * workbench gives them to the roll (`roll-editor.ts`, which maps `Z` itself).
 *
 * Pure and DOM-free: the hook feeds it a plain description of the event.
 */

import { describeKeyTarget, targetOwnsTyping, type KeyTarget } from '../media/transport-keys';

/** Pixels one arrow press pans; Shift makes it a stride. */
export const ARROW_PAN_PX = 40;
export const ARROW_PAN_STRIDE_PX = 200;

export interface ZoomKeyPress {
  key: string;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: KeyTarget | null;
}

export type ZoomKeyAction = { kind: 'toggle' } | { kind: 'pan'; dx: number; dy: number } | null;

/**
 * A DOM event as the record above. Spelled out field by field: `key`,
 * `shiftKey` and the rest are getters on the event's prototype, which a
 * spread never copies — `{ ...e }` gives a record with none of them.
 */
export function describeZoomKey(e: KeyboardEvent): ZoomKeyPress {
  return {
    key: e.key,
    defaultPrevented: e.defaultPrevented,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    target: describeKeyTarget(e.target),
  };
}

/**
 * What a key press means over a picture whose view is `zoomed` or not.
 * A modified press (⌘Z is undo, ⌥→ is the browser's) is never ours.
 */
export function zoomKeyAction(press: ZoomKeyPress, zoomed: boolean): ZoomKeyAction {
  if (press.defaultPrevented) return null;
  if (press.altKey || press.ctrlKey || press.metaKey) return null;
  if (targetOwnsTyping(press.target)) return null;
  if (press.key === 'z' || press.key === 'Z') return { kind: 'toggle' };
  if (!zoomed) return null;
  const step = press.shiftKey ? ARROW_PAN_STRIDE_PX : ARROW_PAN_PX;
  switch (press.key) {
    case 'ArrowLeft':
      return { kind: 'pan', dx: step, dy: 0 };
    case 'ArrowRight':
      return { kind: 'pan', dx: -step, dy: 0 };
    case 'ArrowUp':
      return { kind: 'pan', dx: 0, dy: step };
    case 'ArrowDown':
      return { kind: 'pan', dx: 0, dy: -step };
    default:
      return null;
  }
}
