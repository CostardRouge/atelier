/**
 * Who owns ⌘Z.
 *
 * The third of the suite's key-ownership modules, beside `transport-keys.ts`
 * (space) and `dialog-keys.ts` (Enter and Escape), and it answers the same
 * question: a shortcut bound on `window` has to stand down whenever the focused
 * element has a better claim to the press. For undo that claim is narrow but
 * absolute — inside a text field, ⌘Z is the browser's own undo of the letters
 * being typed, and taking it would throw away a half-typed name to step the
 * whole document back instead. Everywhere else the document owns it, a focused
 * button included: a button does not undo anything.
 *
 * Pure and DOM-free: the hook feeds it a plain description of the event.
 */

import { type KeyTarget } from '../media/transport-keys';

/**
 * Input types that hold no text, and so have no undo of their own to protect.
 *
 * A slider is the one that matters: every number in the suite is an `<input
 * type="range">` (`RangeField`), and dragging one leaves it focused — so
 * standing down for "a field" swallowed every ⌘Z from the first edit onwards,
 * which is what made undo look broken in the Develop tool, where a slider is
 * most of the tool. An unknown type keeps the field's claim: guessing wrong
 * that way only costs a step, the other way it eats a half-typed word.
 */
const TEXTLESS_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'color',
  'file',
  'button',
  'submit',
  'reset',
  'image',
  'hidden',
]);

/** True where ⌘Z is the browser's undo of the letters being typed, and not the document's. */
function fieldOwnsUndo(target: KeyTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA') return true;
  // A `<select>` types nothing either — only a field being typed IN wins.
  if (target.tagName !== 'INPUT') return false;
  return !TEXTLESS_INPUT_TYPES.has((target.inputType ?? '').toLowerCase());
}

/** The half of a `KeyboardEvent` the decision needs. */
export interface UndoKeyPress {
  key: string;
  /** Set by a control that already handled the chord itself. */
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: KeyTarget | null;
}

export type UndoKeyAction = 'undo' | 'redo' | null;

/**
 * What a key press means to the open document.
 *
 * Both accelerators are accepted on every platform rather than sniffing for a
 * Mac: ⌘Z / ⇧⌘Z is what a Mac sends, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z what
 * Windows and Linux send, and a browser on either can be driven by an external
 * keyboard of the other kind. Exactly one of the two modifiers has to be held
 * — both together is somebody else's chord — and Alt is left alone for the
 * same reason.
 *
 * A HELD key repeats, deliberately, unlike the suite's other global keys: space
 * is a toggle, where a repeat would flip the transport forever, while holding
 * undo to walk back through a stack is what every editor does and what a hand
 * expects.
 */
export function undoKeyAction(press: UndoKeyPress): UndoKeyAction {
  if (press.defaultPrevented || press.altKey) return null;
  // Exactly one of ⌘ / Ctrl.
  if (press.metaKey === press.ctrlKey) return null;
  // A field's own undo is the text being typed in it, and it wins.
  if (fieldOwnsUndo(press.target)) return null;
  const key = press.key.toLowerCase();
  if (key === 'z') return press.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !press.shiftKey) return 'redo';
  return null;
}
