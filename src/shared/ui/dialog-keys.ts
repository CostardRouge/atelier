/**
 * Who owns Enter and Escape while a sheet is up.
 *
 * Every modal in the suite already closed on Escape through its own `window`
 * listener; none of them acted on Enter, so filling a form ended with a reach
 * for the mouse — typing a date and pressing Enter did nothing at all. Enter
 * is the primary action of the sheet in hand ("Save", "Create trip", "Add to
 * library"), bound the same way, which is why the decision lives here: a
 * global key press must stand down whenever the focused element has a better
 * claim to it, exactly as `transport-keys.ts` decides for space.
 *
 * Pure and DOM-free: the hook feeds it a plain description of the event.
 */

import { describeKeyTarget, type KeyTarget } from '../media/transport-keys';

export interface DialogTarget extends KeyTarget {
  /** Lowercase `type` of an `<input>`, or null. */
  type: string | null;
}

/** The half of a `KeyboardEvent` the decision needs. */
export interface DialogKeyPress {
  key: string;
  repeat: boolean;
  /** Set by a field that already handled Enter itself (a place search). */
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: DialogTarget | null;
}

export type DialogKeyAction = 'confirm' | 'cancel' | null;

/** Enter types a newline, or is the element's own activation key. */
const ENTER_TAGS = new Set([
  'TEXTAREA',
  'BUTTON',
  'A', // A link navigates on Enter.
  'SUMMARY',
  'OPTION',
]);

/**
 * `<input>` types Enter activates rather than submits. A text field is
 * deliberately absent: Enter in one submitting the form is the browser's own
 * behaviour, and the whole point of this module. A `<select>` is absent for
 * the same reason — native Enter in a select submits.
 */
const ENTER_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'file',
  'image',
  'checkbox',
  'radio',
]);

/** Widgets that behave like the tags above without using them. */
const ENTER_ROLES = new Set([
  'button',
  'checkbox',
  'combobox', // Enter picks the highlighted suggestion.
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'switch',
  'tab',
  'textbox',
]);

/**
 * True when the focused element has a stronger claim to an Enter press than
 * the sheet's primary action does — the sheet must then ignore the key
 * entirely (no confirm, and no `preventDefault`, or the focused button would
 * never fire).
 */
export function targetOwnsEnter(target: DialogTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  if (ENTER_TAGS.has(target.tagName)) return true;
  if (target.tagName === 'INPUT' && target.type !== null && ENTER_INPUT_TYPES.has(target.type)) {
    return true;
  }
  return target.role !== null && ENTER_ROLES.has(target.role.toLowerCase());
}

/**
 * What a key press means to an open sheet.
 *
 * `hasConfirm` is false when the sheet has no primary action to run right now
 * — a disabled CTA, or a question already on screen waiting for its own
 * answer. Enter then does nothing at all rather than guessing.
 */
export function dialogKeyAction(
  press: DialogKeyPress,
  { hasConfirm }: { hasConfirm: boolean },
): DialogKeyAction {
  if (press.defaultPrevented) return null;
  if (press.key === 'Escape') return 'cancel';
  if (press.key !== 'Enter') return null;
  if (!hasConfirm) return null;
  // A held key would fire the action repeatedly, and a modified Enter belongs
  // to whatever shortcut the platform gives it.
  if (press.repeat || press.altKey || press.ctrlKey || press.metaKey || press.shiftKey) {
    return null;
  }
  if (targetOwnsEnter(press.target)) return null;
  return 'confirm';
}

/** Describe a DOM event target for {@link dialogKeyAction}. */
export function describeDialogTarget(target: EventTarget | null): DialogTarget | null {
  const described = describeKeyTarget(target);
  if (!described) return null;
  const el = target as HTMLInputElement;
  const type = typeof el.type === 'string' ? el.type.toLowerCase() : null;
  return { ...described, type };
}
